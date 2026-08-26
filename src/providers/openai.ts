/**
 * OpenAI Chat Completions.
 *
 * Also the shared implementation for every server that speaks the same wire
 * format — Ollama, LM Studio, OpenRouter, proxies — which `openai-compatible.ts`
 * reuses rather than copies. The only differences are the base URL, the
 * advertised id/label, and whether a key is required at all.
 *
 * Nothing here lets a vendor error object escape: every failure leaves this
 * file as an `AppError` with a specific code (architecture §7).
 */

import { AppError, estimateTokensByChars } from '../core/types';
import type {
  CompletionRequest,
  CompletionResult,
  IAIProvider,
  ProviderConfig,
  ProviderFactory,
  ProviderId,
  TokenUsage,
  ValidationOutcome,
} from '../core/types';

const OPENAI_BASE_URL = 'https://api.openai.com/v1';

/**
 * `TIMEOUT` is retryable (§8), so it has to be able to fire without a caller
 * supplying a signal. A connection test gets a much shorter fuse than a real
 * completion: a settings dialog that hangs for a minute is a broken dialog.
 */
export const COMPLETE_TIMEOUT_MS = 60_000;
export const VALIDATE_TIMEOUT_MS = 10_000;

/** Composes with the caller's signal rather than replacing it. Exported for its test. */
export const timeoutSignal = (ms: number, signal?: AbortSignal): AbortSignal =>
  signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms);

interface WireOptions {
  readonly id: ProviderId;
  readonly label: string;
  /** Used when the config carries no `baseUrl`. Absent = a URL is mandatory. */
  readonly defaultBaseUrl?: string;
  /** Ollama and LM Studio serve unauthenticated; OpenAI does not. */
  readonly requiresApiKey: boolean;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

const badShape = (why: string): AppError => new AppError('BAD_RESPONSE_SHAPE', { context: { why } });

/**
 * Anything thrown by `fetch` itself. Aborts arrive as `AbortError` (caller
 * cancelled) or `TimeoutError` (`AbortSignal.timeout`); both mean "no answer
 * came back", which is what TIMEOUT tells the user.
 */
const fromThrown = (e: unknown): AppError => {
  if (e instanceof AppError) return e;
  const name = e instanceof Error ? e.name : '';
  if (name === 'AbortError' || name === 'TimeoutError') return new AppError('TIMEOUT', { cause: e });
  if (e instanceof TypeError) return new AppError('NETWORK', { cause: e });
  return AppError.from(e, 'PROVIDER_ERROR');
};

/** The whole vendor→AppError table. `body` goes to `cause` only — never to the UI. */
const fromStatus = (status: number, body: string, endpoint: string, model: string): AppError => {
  const cause = body.slice(0, 500);
  const init = { cause, context: { status } } as const;
  const lower = body.toLowerCase();
  const aboutModel =
    (model !== '' && lower.includes(model.toLowerCase())) ||
    lower.includes('model not found') ||
    lower.includes('does not exist');

  if (status === 401 || status === 403) return new AppError('AUTH_FAILED', init);
  if (status === 429) return new AppError('RATE_LIMITED', init);
  if (status === 404 && !aboutModel) {
    // Typing `http://localhost:11434` without `/v1` is the likeliest cause here,
    // and telling that user to change their model sends them the wrong way.
    return new AppError('PROVIDER_ERROR', {
      ...init,
      userMessage: `Nothing answered at ${endpoint}. Check the server URL in settings — Ollama and LM Studio need the /v1 suffix.`,
      action: 'open_settings',
    });
  }
  if (status === 404 || aboutModel) return new AppError('MODEL_UNAVAILABLE', init);
  if (status === 400 && (lower.includes('context length') || lower.includes('context_length_exceeded') || lower.includes('maximum context') || lower.includes('too many tokens'))) {
    return new AppError('CONTEXT_TOO_LARGE', init);
  }
  return new AppError('PROVIDER_ERROR', init);
};

const authHeaders = (apiKey: string): Record<string, string> => {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (apiKey) headers['authorization'] = `Bearer ${apiKey}`;
  return headers;
};

const resolveBaseUrl = (config: ProviderConfig, opts: WireOptions): string => {
  const base = config.baseUrl?.trim() || opts.defaultBaseUrl;
  if (!base) throw new AppError('NO_PROVIDER_CONFIGURED');
  return base.replace(/\/+$/, '');
};

/** One round trip. Returns the parsed body as `unknown`; throws `AppError` for everything else. */
const send = async (url: string, init: RequestInit, model: string): Promise<unknown> => {
  let response: Response;
  let raw: string;
  try {
    response = await fetch(url, init);
    raw = await response.text();
  } catch (e) {
    throw fromThrown(e);
  }
  if (!response.ok) throw fromStatus(response.status, raw, url, model);
  try {
    return JSON.parse(raw) as unknown;
  } catch (e) {
    throw new AppError('BAD_RESPONSE_SHAPE', { cause: e, context: { status: response.status } });
  }
};

const textOf = (body: unknown): string => {
  if (!isRecord(body)) throw badShape('body is not an object');
  const choices = body['choices'];
  const first: unknown = Array.isArray(choices) ? choices[0] : undefined;
  if (!isRecord(first)) throw badShape('no choices[0]');
  const message = first['message'];
  if (!isRecord(message)) throw badShape('no choices[0].message');
  const content = message['content'];
  if (typeof content !== 'string') throw badShape('message.content is not a string');
  return content;
};

const usageOf = (body: unknown, prompt: string, text: string): TokenUsage & { readonly estimated: boolean } => {
  const usage = isRecord(body) ? body['usage'] : undefined;
  if (isRecord(usage)) {
    const input = usage['prompt_tokens'];
    const output = usage['completion_tokens'];
    if (typeof input === 'number' && typeof output === 'number') return { input, output, estimated: false };
  }
  return { input: estimateTokensByChars(prompt), output: estimateTokensByChars(text), estimated: true };
};

const modelOf = (body: unknown, fallback: string): string => {
  const model = isRecord(body) ? body['model'] : undefined;
  return typeof model === 'string' && model ? model : fallback;
};

const complete = async (
  config: ProviderConfig,
  opts: WireOptions,
  req: CompletionRequest,
  signal?: AbortSignal,
  timeoutMs: number = COMPLETE_TIMEOUT_MS,
): Promise<CompletionResult> => {
  const body = {
    model: config.model,
    messages: [
      { role: 'system', content: req.system },
      { role: 'user', content: req.user },
    ],
    temperature: req.temperature,
    max_tokens: req.maxOutputTokens,
    ...(req.expectJson ? { response_format: { type: 'json_object' } } : {}),
  };

  const parsed = await send(
    `${resolveBaseUrl(config, opts)}/chat/completions`,
    {
      method: 'POST',
      headers: authHeaders(config.apiKey),
      body: JSON.stringify(body),
      signal: timeoutSignal(timeoutMs, signal),
    },
    config.model,
  );

  const text = textOf(parsed);
  if (req.expectJson) {
    try {
      JSON.parse(text) as unknown;
    } catch (e) {
      throw new AppError('BAD_RESPONSE_SHAPE', { cause: e, context: { why: 'expectJson but content is not JSON' } });
    }
  }

  return { text, usage: usageOf(parsed, req.system + req.user, text), model: modelOf(parsed, config.model) };
};

/** Model ids the server admits to, or `null` when it has no `/models` endpoint. */
const listModels = async (baseUrl: string, apiKey: string, model: string): Promise<readonly string[] | null> => {
  const url = `${baseUrl}/models`;
  let response: Response;
  let raw: string;
  try {
    response = await fetch(url, { headers: authHeaders(apiKey), signal: timeoutSignal(VALIDATE_TIMEOUT_MS) });
    raw = await response.text();
  } catch (e) {
    throw fromThrown(e);
  }
  if (response.status === 404) return null; // a proxy that only implements /chat/completions
  if (!response.ok) throw fromStatus(response.status, raw, url, model);

  try {
    const body: unknown = JSON.parse(raw);
    const data = isRecord(body) ? body['data'] : undefined;
    if (!Array.isArray(data)) return null;
    return data.flatMap((entry: unknown) => {
      const id = isRecord(entry) ? entry['id'] : undefined;
      return typeof id === 'string' ? [id] : [];
    });
  } catch {
    return null; // unreadable list is not worth failing a connection test over
  }
};

/**
 * GET /models rather than a throwaway completion: it costs no tokens, every
 * OpenAI-compatible server implements it, and it separates "key rejected" from
 * "model not on this account" precisely. Servers that answer 404 fall back to a
 * one-token completion so proxies without the endpoint still get a real test.
 */
const validate = async (config: ProviderConfig, opts: WireOptions): Promise<ValidationOutcome> => {
  try {
    if (opts.requiresApiKey && !config.apiKey) throw new AppError('NO_API_KEY');
    const baseUrl = resolveBaseUrl(config, opts);
    const models = await listModels(baseUrl, config.apiKey, config.model);

    if (models === null) {
      const ping = { system: '', user: 'ping', expectJson: false, maxOutputTokens: 1, temperature: 0 };
      await complete(config, opts, ping, undefined, VALIDATE_TIMEOUT_MS);
    } else if (!models.includes(config.model)) {
      throw new AppError('MODEL_UNAVAILABLE', { context: { model: config.model } });
    }
    return { ok: true, model: config.model };
  } catch (e) {
    return { ok: false, error: AppError.from(e, 'PROVIDER_ERROR') };
  }
};

/** Shared by `openai` and `openai-compatible`; not exported beyond `src/providers/`. */
export const createWireProvider = (config: ProviderConfig, opts: WireOptions): IAIProvider => ({
  id: opts.id,
  label: opts.label,
  complete: (req, signal) => complete(config, opts, req, signal),
  estimateTokens: estimateTokensByChars,
  validate: () => validate(config, opts),
});

export const createOpenAiProvider: ProviderFactory = (config) =>
  createWireProvider(config, {
    id: 'openai',
    label: 'OpenAI',
    defaultBaseUrl: OPENAI_BASE_URL,
    requiresApiKey: true,
  });
