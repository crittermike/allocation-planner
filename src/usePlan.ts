import { useCallback, useEffect, useRef, useState } from 'react';
import type { PlanState } from './types';
import { recordVisit } from './visited';

export type ConnState = 'connecting' | 'open' | 'closed' | 'missing';

export type UsePlan = {
  state: PlanState | null;
  setState: (updater: (s: PlanState) => PlanState) => void;
  conn: ConnState;
  peers: number;
};

const SEND_DEBOUNCE_MS = 120;

export function usePlan(slug: string | null): UsePlan {
  const [state, setLocalState] = useState<PlanState | null>(null);
  const [conn, setConn] = useState<ConnState>('connecting');
  const [peers, setPeers] = useState(1);
  const wsRef = useRef<WebSocket | null>(null);
  const pendingRef = useRef<PlanState | null>(null);
  const sendTimerRef = useRef<number | null>(null);
  const slugRef = useRef<string | null>(slug);
  slugRef.current = slug;

  // Flush pending updates over the socket.
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

  // Setter that updates local state optimistically and schedules a send.
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

    const open = () => {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${proto}//${window.location.host}/ws/${encodeURIComponent(slug)}`;
      const ws = new WebSocket(url);
      wsRef.current = ws;
      setConn('connecting');

      ws.onopen = () => {
        if (stopped) return;
        retryDelay = 500;
        setConn('open');
        // If there is a pending unsent change from before reconnect, send it.
        if (pendingRef.current) flush();
      };

      ws.onmessage = (ev) => {
        if (stopped) return;
        let msg: any;
        try { msg = JSON.parse(ev.data); } catch { return; }
        if (msg.type === 'hello') {
          setLocalState(msg.state);
          setPeers(msg.peers ?? 1);
        } else if (msg.type === 'state') {
          setLocalState(msg.state);
        } else if (msg.type === 'peers') {
          setPeers(msg.peers ?? 1);
        }
      };

      ws.onclose = (ev) => {
        if (stopped) return;
        wsRef.current = null;
        if (ev.code === 1006 || ev.code === 1011) {
          // Network or server problem — try to reconnect.
        }
        // If the URL was rejected (slug not found), we treat as missing.
        if (ev.code === 1006 && state === null) {
          // First open failed entirely — could be network OR missing plan.
        }
        setConn('closed');
        retryTimer = window.setTimeout(open, retryDelay);
        retryDelay = Math.min(retryDelay * 2, 8000);
      };

      ws.onerror = () => {
        // onclose will follow.
      };
    };

    // Probe HTTP first to distinguish "missing plan" from "network".
    fetch(`/api/plans/${encodeURIComponent(slug)}`)
      .then(async r => {
        if (r.status === 404) {
          if (!stopped) setConn('missing');
          return;
        }
        if (!r.ok) throw new Error('http ' + r.status);
        const data = await r.json();
        if (stopped) return;
        setLocalState(data.state);
        recordVisit(slug);
        open();
      })
      .catch(() => {
        if (stopped) return;
        // Try opening WS anyway; it may succeed if the server comes up.
        open();
      });

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  // Flush on unload so quick edits aren't lost.
  useEffect(() => {
    const handler = () => flush();
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [flush]);

  return { state, setState, conn, peers };
}
