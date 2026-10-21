import { useEffect, useState } from 'react';
import type { ConnState } from './usePlan';
import { offlineWatcher } from './offline';

export function OfflineBanner({ conn }: { conn: ConnState }) {
  const [offline, setOffline] = useState(false);
  const [watcher] = useState(() => offlineWatcher(setOffline));
  useEffect(() => watcher.update(conn), [watcher, conn]);
  useEffect(() => watcher.dispose, [watcher]);
  if (!offline) return null;
  return (
    <div
      role="status"
      className="anim-pop-in fixed bottom-4 left-1/2 z-50 inline-flex -translate-x-1/2 items-center gap-2 rounded-md bg-ink-800 px-3 py-1.5 text-[12px] font-medium text-[#fff] shadow-lg"
    >
      <span className="h-2 w-2 animate-pulse rounded-full bg-amber-400" aria-hidden />
      Offline — changes will sync when reconnected
    </div>
  );
}

export function LoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex h-screen w-screen items-center justify-center p-6">
      <div role="alert" className="max-w-md rounded-2xl border border-ink-200 bg-white p-8 text-center shadow-sm">
        <h1 className="text-[20px] font-semibold text-ink-900">Couldn’t load this plan</h1>
        <button
          className="mt-5 inline-flex h-9 items-center rounded-lg bg-brand-600 px-4 text-[13px] font-semibold text-[#fff] shadow-sm transition hover:bg-brand-700 active:scale-[0.98]"
          onClick={onRetry}
        >
          Retry
        </button>
      </div>
    </div>
  );
}
