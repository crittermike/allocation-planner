export const UNDO_TOAST_MS = 6000;

export type UndoToast<S> = { id: number; message: string; checkpoint: S };

// The toast's Undo is only safe while its checkpoint is still the newest undo entry;
// otherwise it would revert a later, unrelated edit.
export function canUndoToast<S>(stack: readonly S[], toast: UndoToast<S> | null): boolean {
  return toast != null && stack.length > 0 && stack[stack.length - 1] === toast.checkpoint;
}
