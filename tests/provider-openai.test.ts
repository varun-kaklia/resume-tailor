import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  COMPLETE_TIMEOUT_MS,
  VALIDATE_TIMEOUT_MS,
  createOpenAiProvider,
  timeoutSignal,
} from '../src/providers/openai';
import { createOpenAiCompatibleProvider } from '../src/providers/openai-compatible';
import { createProvider } from '../src/providers/registry';
import { AppError, isAppError } from '../src/core/types';
import type { CompletionRequest, ErrorCode, ProviderConfig } from '../src/core/types';

const config: ProviderConfig = { id: 'openai', model: 'gpt-test', apiKey: 'sk-not-real' };

const req: CompletionRequest = {
  system: 'You tailor resumes.',
  user: 'e1,e2',
  expectJson: false,
  maxOutputTokens: 512,
  temperature: 0,
};

const completion = (content: string, usage?: Record<string, number>) => ({
  model: 'gpt-test-0613',
  choices: [{ message: { role: 'assistant', content } }],
  ...(usage ? { usage } : {}),
});

/** Stubs `fetch` with a fixed response and hands back the mock for assertions. */
const stubFetch = (body: unknown, status = 200) => {
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  const mock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(raw, { status }));
  vi.stubGlobal('fetch', mock);
  return mock;
};

const stubThrow = (thrown: unknown) => {
  const mock = vi.fn(async (_url: string, _init?: RequestInit) => {
    throw thrown;
  });
  vi.stubGlobal('fetch', mock);
  return mock;
};

const codeOf = async (promise: Promise<unknown>): Promise<ErrorCode> => {
  try {
    await promise;
  } catch (e) {
    if (isAppError(e)) return e.code;
    throw e;
  }
  throw new Error('expected the call to reject');
};

const named = (name: string): Error => Object.assign(new Error(name), { name });

afterEach(() => vi.unstubAllGlobals());

describe('openai provider — completion', () => {
  it('posts to chat/completions and returns reported usage', async () => {
    const fetchMock = stubFetch(completion('plan', { prompt_tokens: 120, completion_tokens: 40 }));
    const result = await createOpenAiProvider(config).complete(req);

    expect(result).toEqual({
      text: 'plan',
      usage: { input: 120, output: 40, estimated: false },
      model: 'gpt-test-0613',
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(init.headers).toMatchObject({ authorization: 'Bearer sk-not-real' });
    expect(JSON.parse(String(init.body)) as unknown).toEqual({
      model: 'gpt-test',
      messages: [
        { role: 'system', content: req.system },
        { role: 'user', content: req.user },
      ],
      temperature: 0,
      max_tokens: 512,
    });
  });

  it('estimates usage when the provider omits it, and says so', async () => {
    stubFetch(completion('plan'));
    const { usage } = await createOpenAiProvider(config).complete(req);

    expect(usage.estimated).toBe(true);
    expect(usage.input).toBe(createOpenAiProvider(config).estimateTokens(req.system + req.user));
  });

  it('asks for a JSON object when expectJson is set', async () => {
    const fetchMock = stubFetch(completion('{"sections":[]}'));
    const result = await createOpenAiProvider(config).complete({ ...req, expectJson: true });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body)) as { response_format?: unknown }).toMatchObject({
      response_format: { type: 'json_object' },
    });
    expect(result.text).toBe('{"sections":[]}');
  });

  it('honours the caller signal so a cancelled call leaves nothing pending', async () => {
    const fetchMock = stubFetch(completion('plan'));
    const controller = new AbortController();
    await createOpenAiProvider(config).complete(req, controller.signal);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.signal?.aborted).toBe(false);
    controller.abort();
    expect(init.signal?.aborted).toBe(true);
  });

  it('aborts on its own when nobody passes a signal, so TIMEOUT can fire', async () => {
    const fetchMock = stubFetch(completion('plan'));
    await createOpenAiProvider(config).complete(req);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(COMPLETE_TIMEOUT_MS).toBeGreaterThan(VALIDATE_TIMEOUT_MS);
  });

  it('timeoutSignal fires on its own and still respects the caller', async () => {
    const alone = timeoutSignal(1);
    const composed = timeoutSignal(1, new AbortController().signal);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(alone.aborted).toBe(true);
    expect(composed.aborted).toBe(true);
  });
});

describe('openai provider — error mapping', () => {
  const cases: ReadonlyArray<readonly [label: string, status: number, body: unknown, code: ErrorCode]> = [
    ['401', 401, { error: { message: 'Incorrect API key provided' } }, 'AUTH_FAILED'],
    ['403', 403, { error: { message: 'forbidden' } }, 'AUTH_FAILED'],
    ['429', 429, { error: { message: 'Rate limit reached' } }, 'RATE_LIMITED'],
    ['404 naming the model', 404, { error: { message: 'The model `gpt-test` does not exist' } }, 'MODEL_UNAVAILABLE'],
    ['404 from a wrong endpoint', 404, '404 page not found', 'PROVIDER_ERROR'],
    ['model not found body', 400, { error: { message: 'The model `x` does not exist' } }, 'MODEL_UNAVAILABLE'],
    ['400 context length', 400, { error: { code: 'context_length_exceeded' } }, 'CONTEXT_TOO_LARGE'],
    ['400 other', 400, { error: { message: 'bad request' } }, 'PROVIDER_ERROR'],
    ['500', 500, 'upstream exploded', 'PROVIDER_ERROR'],
    ['503', 503, 'overloaded', 'PROVIDER_ERROR'],
  ];

  it.each(cases)('maps %s to %s', async (_label, status, body, code) => {
    stubFetch(body, status);
    expect(await codeOf(createOpenAiProvider(config).complete(req))).toBe(code);
  });

  it('maps a network failure to NETWORK', async () => {
    stubThrow(new TypeError('fetch failed'));
    expect(await codeOf(createOpenAiProvider(config).complete(req))).toBe('NETWORK');
  });

  it('maps an aborted or timed-out request to TIMEOUT', async () => {
    stubThrow(named('AbortError'));
    expect(await codeOf(createOpenAiProvider(config).complete(req))).toBe('TIMEOUT');

    stubThrow(named('TimeoutError'));
    expect(await codeOf(createOpenAiProvider(config).complete(req))).toBe('TIMEOUT');
  });

  it('maps an unparseable body to BAD_RESPONSE_SHAPE', async () => {
    stubFetch('<html>gateway</html>');
    expect(await codeOf(createOpenAiProvider(config).complete(req))).toBe('BAD_RESPONSE_SHAPE');
  });

  it('maps a well-formed body with the wrong shape to BAD_RESPONSE_SHAPE', async () => {
    stubFetch({ choices: [] });
    expect(await codeOf(createOpenAiProvider(config).complete(req))).toBe('BAD_RESPONSE_SHAPE');
  });

  it('rejects non-JSON content when expectJson was requested', async () => {
    stubFetch(completion('Sure! Here is your plan:'));
    expect(await codeOf(createOpenAiProvider(config).complete({ ...req, expectJson: true }))).toBe('BAD_RESPONSE_SHAPE');
  });

  it('sends a wrong base URL to settings, not to the model picker', async () => {
    stubFetch('404 page not found', 404);
    const local = { id: 'openai-compatible', model: 'llama3', apiKey: '', baseUrl: 'http://localhost:11434' } as const;
    try {
      await createOpenAiCompatibleProvider(local).complete(req);
      expect.unreachable();
    } catch (e) {
      const error = e as AppError;
      expect(error.code).toBe('PROVIDER_ERROR');
      expect(error.action).toBe('open_settings');
      expect(error.userMessage).toContain('http://localhost:11434/chat/completions');
      expect(error.userMessage).toContain('/v1');
    }
  });

  it('never leaks a vendor error object', async () => {
    // Providers echo the offending key back in error bodies. It must not survive
    // into anything the UI renders.
    const leaked = 'sk-EXAMPLE-NOT-A-REAL-KEY';
    stubFetch({ error: { message: `Incorrect API key ${leaked}` } }, 401);
    try {
      await createOpenAiProvider(config).complete(req);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).context).toEqual({ status: 401 });
      expect((e as AppError).userMessage).not.toContain(leaked);
      expect((e as AppError).message).not.toContain(leaked);
    }
  });
});

describe('openai provider — validate', () => {
  it('accepts a key whose model is listed', async () => {
    const fetchMock = stubFetch({ data: [{ id: 'gpt-test' }, { id: 'gpt-other' }] });
    expect(await createOpenAiProvider(config).validate()).toEqual({ ok: true, model: 'gpt-test' });
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.openai.com/v1/models');
  });

  it('returns ok:false on a bad key rather than throwing', async () => {
    stubFetch({ error: { message: 'Incorrect API key provided' } }, 401);
    const outcome = await createOpenAiProvider(config).validate();

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.code).toBe('AUTH_FAILED');
  });

  it('reports MODEL_UNAVAILABLE when the account cannot see the model', async () => {
    stubFetch({ data: [{ id: 'gpt-other' }] });
    const outcome = await createOpenAiProvider(config).validate();

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.code).toBe('MODEL_UNAVAILABLE');
  });

  it('reports NO_API_KEY without a round trip', async () => {
    const fetchMock = stubFetch(completion('unused'));
    const outcome = await createOpenAiProvider({ ...config, apiKey: '' }).validate();

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.code).toBe('NO_API_KEY');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls back to a one-token completion when /models is absent', async () => {
    const mock = vi
      .fn()
      .mockResolvedValueOnce(new Response('nope', { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(completion('hi')), { status: 200 }));
    vi.stubGlobal('fetch', mock);

    expect(await createOpenAiProvider(config).validate()).toEqual({ ok: true, model: 'gpt-test' });
    const [, init] = mock.mock.calls[1] as [string, RequestInit];
    expect(JSON.parse(String(init.body)) as { max_tokens: number }).toMatchObject({ max_tokens: 1 });
  });
});

describe('openai-compatible provider', () => {
  const local: ProviderConfig = {
    id: 'openai-compatible',
    model: 'llama3',
    apiKey: '',
    baseUrl: 'http://localhost:11434/v1/',
  };

  it('talks to the configured server, with no key and no trailing-slash surprise', async () => {
    const fetchMock = stubFetch(completion('plan'));
    await createOpenAiCompatibleProvider(local).complete(req);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:11434/v1/chat/completions');
    expect(init.headers).not.toHaveProperty('authorization');
  });

  it('refuses to be built without a baseUrl', () => {
    expect(() => createOpenAiCompatibleProvider({ ...local, baseUrl: '  ' })).toThrowError(
      expect.objectContaining({ code: 'NO_PROVIDER_CONFIGURED' }) as Error,
    );
  });

  it('does not demand an API key from a local server', async () => {
    stubFetch({ data: [{ id: 'llama3' }] });
    expect(await createOpenAiCompatibleProvider(local).validate()).toEqual({ ok: true, model: 'llama3' });
  });
});

describe('registry', () => {
  it('builds the providers it knows', () => {
    expect(createProvider(config).id).toBe('openai');
  });

  it('rejects an id with no implementation', () => {
    expect(codeOfSync(() => createProvider({ ...config, id: 'anthropic' }))).toBe('NO_PROVIDER_CONFIGURED');
  });
});

/** Synchronous twin of `codeOf`, for factories that throw on construction. */
function codeOfSync(fn: () => unknown): ErrorCode {
  try {
    fn();
  } catch (e) {
    if (isAppError(e)) return e.code;
    throw e;
  }
  throw new Error('expected the call to throw');
}
