/**
 * Access to the extension APIs, resolved at call time.
 *
 * Chrome exposes `chrome`, Firefox exposes `browser`, and the two agree on the
 * shapes used here. Resolving structurally off `globalThis` keeps these modules
 * loadable — and testable — outside an extension host, which is the same
 * approach `shared/storage.ts` already takes. A polyfill would add a second
 * mechanism for the same job.
 */

import { AppError } from '../core/types';

export interface RuntimeApi {
  sendMessage(message: unknown): Promise<unknown>;
  readonly onMessage: {
    addListener(listener: (message: unknown, sender: unknown) => void): void;
  };
  readonly lastError?: { message?: string } | undefined;
}

export interface ScriptingApi {
  executeScript(injection: { target: { tabId: number }; files: string[] }): Promise<unknown>;
}

export interface ActionApi {
  readonly onClicked: {
    addListener(listener: (tab: { id?: number; url?: string }) => void): void;
  };
  setBadgeText(details: { text: string; tabId?: number }): void;
  setBadgeBackgroundColor(details: { color: string; tabId?: number }): void;
  setTitle(details: { title: string; tabId?: number }): void;
}

interface ExtensionGlobal {
  readonly runtime?: RuntimeApi;
  readonly scripting?: ScriptingApi;
  readonly action?: ActionApi;
}

const host = (): ExtensionGlobal | undefined => {
  const global = globalThis as { chrome?: ExtensionGlobal; browser?: ExtensionGlobal };
  return global.chrome ?? global.browser;
};

const require$ = <T>(value: T | undefined, name: string): T => {
  if (value === undefined) {
    throw new AppError('UNKNOWN', {
      userMessage: 'This page cannot be read by the extension. Try reloading the tab.',
      context: { missing: name },
    });
  }
  return value;
};

export const runtime = (): RuntimeApi => require$(host()?.runtime, 'runtime');
export const scripting = (): ScriptingApi => require$(host()?.scripting, 'scripting');
export const action = (): ActionApi => require$(host()?.action, 'action');
