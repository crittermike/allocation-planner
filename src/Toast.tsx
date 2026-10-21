import { useEffect } from 'react';
import { UNDO_TOAST_MS } from './undoToast';

export function UndoToast({ id, message, onUndo, onDismiss }: {
  id: number;
  message: string;
  onUndo: () => void;
  onDismiss: () => void;
}) {
  useEffect(() => {
    const t = window.setTimeout(onDismiss, UNDO_TOAST_MS);
    return () => window.clearTimeout(t);
  }, [id, onDismiss]);

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-5 left-1/2 z-[100] flex max-w-[90vw] -translate-x-1/2 items-center gap-3 rounded-md bg-ink-900 py-1.5 pl-3.5 pr-1.5 text-[12.5px] text-white shadow-lg"
    >
      <span className="truncate">{message}</span>
      <button
        type="button"
        onClick={onUndo}
        className="rounded px-2 py-1 font-medium text-white/90 transition hover:bg-white/10 hover:text-white"
      >
        Undo
      </button>
    </div>
  );
}
