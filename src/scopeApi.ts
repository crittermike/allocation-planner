import { useEffect, useState } from 'react';
import type { ScopeHistory } from './scope';
import { planAuthHeaders } from './usePlan';

/** Whether the server can read GitHub, and which repos it may read. */
export type ScopeConfig = { enabled: boolean; repos: string[] };

const DISABLED: ScopeConfig = { enabled: false, repos: [] };

let config: ScopeConfig | null = null;
const configRequest: Promise<ScopeConfig> = fetch('/api/config')
  .then(r => (r.ok ? r.json() : null))
  .then(body => (config = body?.scope ?? DISABLED))
  .catch(() => (config = DISABLED));

/** Server-side GitHub access, loaded once per page. Null until known. */
export function useScopeConfig(): ScopeConfig | null {
  const [value, setValue] = useState(config);
  useEffect(() => {
    if (!value) configRequest.then(setValue);
  }, [value]);
  return value;
}

const SEEN_KEY = 'scope-seen-v1';
const SEEN_LIMIT = 200;

function readSeen(): string[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((u): u is string => typeof u === 'string') : [];
  } catch {
    return [];
  }
}

/** Whether this browser saw scope for the issue before, so the editor can open wide right away. */
export function hadScope(url: string): boolean {
  return readSeen().includes(url);
}

export function rememberScope(url: string, has: boolean) {
  const seen = readSeen();
  if (seen.includes(url) === has) return;
  const next = has ? [url, ...seen].slice(0, SEEN_LIMIT) : seen.filter(u => u !== url);
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(next));
  } catch {}
}

export type ScopeResponse =
  | {
      status: 'ready';
      history: ScopeHistory;
      checkedAt: string;
      refreshError: { at: string; message: string } | null;
      /** A background refresh is running; ask again shortly for newer data. */
      refreshing: boolean;
    }
  | { status: 'unreadable'; at: string }
  | { status: 'error'; message: string; code?: number; refreshing?: boolean };

/** Last response per plan and issue, shared by the project editor and the Releases row. */
const responses = new Map<string, ScopeResponse>();
const listeners = new Set<() => void>();
const responseKey = (slug: string, url: string) => `${slug}\n${url}`;

export const lastScope = (slug: string, url: string) => responses.get(responseKey(slug, url));

export function storeScope(slug: string, url: string, res: ScopeResponse) {
  responses.set(responseKey(slug, url), res);
  listeners.forEach(l => l());
}

export function onScopeStored(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const SERVER_ERRORS: Record<number, string> = {
  401: 'Unlock this plan to see scope.',
  403: "This plan doesn't link to that issue, or the planner isn't allowed to read its repo.",
  503: "The planner isn't connected to GitHub.",
};

export async function requestScope(slug: string, url: string, refresh = false): Promise<ScopeResponse> {
  const path = `/api/plans/${encodeURIComponent(slug)}/scope${refresh ? '/refresh' : ''}?url=${encodeURIComponent(url)}`;
  let res: Response;
  try {
    res = await fetch(path, { method: refresh ? 'POST' : 'GET', headers: planAuthHeaders(slug) });
  } catch {
    return { status: 'error', message: "Couldn't reach the planner's server." };
  }
  if (res.ok) return res.json();
  return {
    status: 'error',
    code: res.status,
    message: SERVER_ERRORS[res.status] ?? `The planner's server returned HTTP ${res.status}.`,
  };
}
