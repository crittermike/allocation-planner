import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canUndoToast } from '../src/undoToast.ts';

test('toast can undo while its checkpoint is the newest undo entry', () => {
  const before = { people: ['Alice', 'Bob'] };
  const stack = [{ people: [] }, before];
  assert.equal(canUndoToast(stack, { id: 1, message: 'Removed Alice', checkpoint: before }), true);
});

test('toast cannot undo once a later edit, undo, or nothing is on top', () => {
  const before = { people: ['Alice', 'Bob'] };
  const toast = { id: 1, message: 'Removed Alice', checkpoint: before };
  assert.equal(canUndoToast([before, { people: ['Bob'] }], toast), false);
  assert.equal(canUndoToast([], toast), false);
  assert.equal(canUndoToast([before], null), false);
});
