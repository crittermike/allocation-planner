import { test } from 'node:test';
import assert from 'node:assert/strict';
import { belowLineIds, fitLineIndex } from '../src/fitLine.ts';
import type { Project } from '../src/types.ts';

const p = (id: string, estimateEM?: number) => ({ id, name: id, color: '#bfdbfe', estimateEM }) as Project;
const ranked = [p('a', 3), p('b', 2.5), p('c', 2), p('d', 3)];

test('projects past the cumulative capacity line are below it', () => {
  const idx = fitLineIndex(ranked, 9.6, true);
  assert.equal(idx, 3);
  assert.deepEqual([...belowLineIds(ranked, idx)], ['d']);
});

test('nothing is below the line when everything fits or no quarter is set', () => {
  assert.equal(fitLineIndex(ranked, 20, true), -1);
  assert.equal(fitLineIndex(ranked, 1, false), -1);
  assert.equal(belowLineIds(ranked, -1).size, 0);
});
