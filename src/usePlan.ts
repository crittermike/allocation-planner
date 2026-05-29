import { useCallback, useEffect, useRef, useState } from 'react';
import type { PlanState } from './types';
import { recordVisit } from './visited';

export type ConnState = 'connecting' | 'open' | 'closed' | 'missing';

export type PasswordError = 'wrong_password' | 'too_many_attempts' | 'auth_required' | 'password_too_short' | 'password_too_long' | 'unknown';

/** Migrate plan state from older schemas so old plans keep working.
 *  Currently handles: legacy `Project.estimatedWeeks` (eng-weeks) →
 *  `Project.estimateEM` (eng-months) using the canonical 4-weeks-per-EM ratio. */
function migrateState(raw: any): PlanState {
  if (!raw || typeof raw !== 'object') return raw;
  const projects = Array.isArray(raw.projects)
    ? raw.projects.map((p: any) => {
        if (p && p.estimateEM == null && typeof p.estimatedWeeks === 'number') {
          return { ...p, estimateEM: p.estimatedWeeks / 4 };
        }
        return p;
      })
    : raw.projects;
  return { ...raw, projects } as PlanState;
}

export type UsePlan = {
  state: PlanState | null;
  setState: (updater: (s: PlanState) => PlanState) => void;
  conn: ConnState;
  peers: number;
  /** True while server requires a password and we have no valid token. */
  passwordRequired: boolean;
  /** Name of the plan (known even when locked). */
  planName: string | null;
  /** Whether this plan currently has a password set. */
  hasPassword: boolean;
  /** Submit a password to unlock the plan. */
  submitPassword: (password: string) => Promise<{ ok: true } | { ok: false; error: PasswordError; message?: string }>;
  /** Set / change / clear (newPassword === null) the plan password. */
  changePassword: (args: { currentPassword?: string; newPassword: string | null }) => Promise<
    { ok: true } | { ok: false; error: PasswordError; message?: string }
  >;
};

const SEND_DEBOUNCE_MS = 120;

const tokenKey = (slug: string) => `plan-token:${slug}`;
const readToken = (slug: string) => {
  try { return localStorage.getItem(tokenKey(slug)); } catch { return null; }
};
const writeToken = (slug: string, token: string | null) => {
  try {
    if (token == null) localStorage.removeItem(tokenKey(slug));
    else localStorage.setItem(tokenKey(slug), token);
  } catch {}
};

export function usePlan(slug: string | null): UsePlan {
  const [state, setLocalState] = useState<PlanState | null>(null);
  const [conn, setConn] = useState<ConnState>('connecting');
  const [peers, setPeers] = useState(1);
  const [passwordRequired, setPasswordRequired] = useState(false);
  const [planName, setPlanName] = useState<string | null>(null);
  const [hasPassword, setHasPassword] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const pendingRef = useRef<PlanState | null>(null);
  const sendTimerRef = useRef<number | null>(null);
  const tokenRef = useRef<string | null>(slug ? readToken(slug) : null);
  // Bumped to trigger the load/connect effect to re-run (e.g. after unlock).
  const [reloadKey, setReloadKey] = useState(0);

  const flush = useCallback(() => {
    if (sendTimerRef.current != null) {
      window.clearTimeout(sendTimerRef.current);
      sendTimerRef.current = null;
    }
    const ws = wsRef.current;
    const next = pendingRef.current;
    if (!ws || ws.readyState !== ws.OPEN || !next) return;
    ws.send(JSON.stringify({ type: 'update', state: next }));
    pendingRef.current = null;
  }, []);

  const setState = useCallback(
    (updater: (s: PlanState) => PlanState) => {
      setLocalState(prev => {
        if (!prev) return prev;
        const next = updater(prev);
        pendingRef.current = next;
        if (sendTimerRef.current != null) window.clearTimeout(sendTimerRef.current);
        sendTimerRef.current = window.setTimeout(flush, SEND_DEBOUNCE_MS);
        return next;
      });
    },
    [flush],
  );

  useEffect(() => {
    if (!slug) return;
    let stopped = false;
    let retryDelay = 500;
    let retryTimer: number | null = null;

    const openWs = () => {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const token = tokenRef.current;
      const qs = token ? `?token=${encodeURIComponent(token)}` : '';
      const url = `${proto}//${window.location.host}/ws/${encodeURIComponent(slug)}${qs}`;
      const ws = new WebSocket(url);
      wsRef.current = ws;
      setConn('connecting');

      ws.onopen = () => {
        if (stopped) return;
        retryDelay = 500;
        setConn('open');
        if (pendingRef.current) flush();
      };

      ws.onmessage = (ev) => {
        if (stopped) return;
        let msg: any;
        try { msg = JSON.parse(ev.data); } catch { return; }
        if (msg.type === 'hello') {
          setLocalState(migrateState(msg.state));
          setPeers(msg.peers ?? 1);
        } else if (msg.type === 'state') {
          setLocalState(migrateState(msg.state));
        } else if (msg.type === 'peers') {
          setPeers(msg.peers ?? 1);
        }
      };

      ws.onclose = () => {
        if (stopped) return;
        wsRef.current = null;
        setConn('closed');
        // If we have a password set and the WS closed unexpectedly, verify auth before
        // entering an infinite reconnect loop with a stale token.
        if (hasPassword) {
          probeAuth();
          return;
        }
        retryTimer = window.setTimeout(openWs, retryDelay);
        retryDelay = Math.min(retryDelay * 2, 8000);
      };

      ws.onerror = () => { /* onclose follows */ };
    };

    const probeAuth = async () => {
      try {
        const headers: Record<string, string> = {};
        if (tokenRef.current) headers.Authorization = `Bearer ${tokenRef.current}`;
        const r = await fetch(`/api/plans/${encodeURIComponent(slug)}`, { headers });
        if (stopped) return;
        if (r.status === 401) {
          writeToken(slug, null);
          tokenRef.current = null;
          setPasswordRequired(true);
          try {
            const body = await r.json();
            if (body?.name) setPlanName(body.name);
          } catch {}
          setHasPassword(true);
        } else if (r.ok) {
          // Still authorized — reopen WS.
          retryTimer = window.setTimeout(openWs, retryDelay);
          retryDelay = Math.min(retryDelay * 2, 8000);
        }
      } catch {
        // Network error — keep retrying WS.
        retryTimer = window.setTimeout(openWs, retryDelay);
        retryDelay = Math.min(retryDelay * 2, 8000);
      }
    };

    const load = async () => {
      try {
        const headers: Record<string, string> = {};
        if (tokenRef.current) headers.Authorization = `Bearer ${tokenRef.current}`;
        const r = await fetch(`/api/plans/${encodeURIComponent(slug)}`, { headers });
        if (stopped) return;
        if (r.status === 404) {
          setConn('missing');
          return;
        }
        if (r.status === 401) {
          // Token absent or stale — require password.
          writeToken(slug, null);
          tokenRef.current = null;
          let body: any = null;
          try { body = await r.json(); } catch {}
          if (body?.name) setPlanName(body.name);
          setHasPassword(true);
          setPasswordRequired(true);
          return;
        }
        if (!r.ok) throw new Error('http ' + r.status);
        const data = await r.json();
        if (stopped) return;
        setLocalState(data.state);
        setPlanName(data.name ?? null);
        setHasPassword(!!data.hasPassword);
        setPasswordRequired(false);
        recordVisit(slug);
        openWs();
      } catch {
        if (stopped) return;
        // Try opening WS anyway; it may succeed if the server comes up.
        openWs();
      }
    };

    load();

    return () => {
      stopped = true;
      if (retryTimer != null) window.clearTimeout(retryTimer);
      if (sendTimerRef.current != null) {
        window.clearTimeout(sendTimerRef.current);
        sendTimerRef.current = null;
      }
      const ws = wsRef.current;
      wsRef.current = null;
      if (ws && ws.readyState <= 1) {
        try { ws.close(); } catch {}
      }
    };
    // We intentionally exclude `hasPassword` and `flush` — they're refs/derived
    // and including them would trigger duplicate reconnects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, reloadKey]);

  useEffect(() => {
    const handler = () => flush();
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [flush]);

  const submitPassword = useCallback(
    async (password: string) => {
      if (!slug) return { ok: false as const, error: 'unknown' as const };
      let r: Response;
      try {
        r = await fetch(`/api/plans/${encodeURIComponent(slug)}/unlock`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password }),
        });
      } catch {
        return { ok: false as const, error: 'unknown' as const, message: 'Network error' };
      }
      if (r.status === 429) {
        let body: any = null;
        try { body = await r.json(); } catch {}
        return { ok: false as const, error: 'too_many_attempts' as const, message: body?.message };
      }
      if (r.status === 401) return { ok: false as const, error: 'wrong_password' as const };
      if (!r.ok) return { ok: false as const, error: 'unknown' as const };
      const body = await r.json();
      if (body?.token) {
        writeToken(slug, body.token);
        tokenRef.current = body.token;
      }
      setPasswordRequired(false);
      setHasPassword(!!body?.hasPassword);
      setReloadKey(k => k + 1);
      return { ok: true as const };
    },
    [slug],
  );

  const changePassword = useCallback(
    async ({ currentPassword, newPassword }: { currentPassword?: string; newPassword: string | null }) => {
      if (!slug) return { ok: false as const, error: 'unknown' as const };
      let r: Response;
      try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (tokenRef.current) headers.Authorization = `Bearer ${tokenRef.current}`;
        r = await fetch(`/api/plans/${encodeURIComponent(slug)}/password`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ currentPassword, newPassword }),
        });
      } catch {
        return { ok: false as const, error: 'unknown' as const, message: 'Network error' };
      }
      if (r.status === 401) return { ok: false as const, error: 'auth_required' as const };
      if (r.status === 400) {
        let body: any = null;
        try { body = await r.json(); } catch {}
        const err = (body?.error as PasswordError) || 'unknown';
        return { ok: false as const, error: err, message: body?.message };
      }
      if (!r.ok) return { ok: false as const, error: 'unknown' as const };
      const body = await r.json();
      if (body?.token) {
        writeToken(slug, body.token);
        tokenRef.current = body.token;
      } else if (body?.token === null) {
        writeToken(slug, null);
        tokenRef.current = null;
      }
      setHasPassword(!!body?.hasPassword);
      // Other live sessions' tokens are now invalid (version bumped); reconnect ours
      // to make sure we're using the fresh token end-to-end.
      const ws = wsRef.current;
      if (ws && ws.readyState <= 1) {
        try { ws.close(); } catch {}
      }
      setReloadKey(k => k + 1);
      return { ok: true as const };
    },
    [slug],
  );

  return {
    state,
    setState,
    conn,
    peers,
    passwordRequired,
    planName,
    hasPassword,
    submitPassword,
    changePassword,
  };
}
