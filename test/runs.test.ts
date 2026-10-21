import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutRuns } from '../src/runs.ts';

const a = (id: string, weekId: string, projectId: string, milestoneId?: string) =>
  ({ id, personId: 'p', weekId, projectId, ...(milestoneId ? { milestoneId } : {}) });

test('consecutive weeks on the same project join into one run', () => {
  const { slots } = layoutRuns([a('1', 'w0', 'x'), a('2', 'w1', 'x'), a('3', 'w2', 'x')], ['w0', 'w1', 'w2']);
  assert.deepEqual(slots['1'], { lane: 0, joinPrev: false, joinNext: true });
  assert.deepEqual(slots['2'], { lane: 0, joinPrev: true, joinNext: true });
  assert.deepEqual(slots['3'], { lane: 0, joinPrev: true, joinNext: false });
});

test('a run keeps its lane when another project starts above it', () => {
  const { slots, lanesByPerson } = layoutRuns(
    [a('1', 'w0', 'x'), a('2', 'w1', 'y'), a('3', 'w1', 'x')],
    ['w0', 'w1'],
  );
  assert.equal(slots['3'].lane, 0);
  assert.equal(slots['3'].joinPrev, true);
  assert.deepEqual(slots['2'], { lane: 1, joinPrev: false, joinNext: false });
  assert.equal(lanesByPerson.p.count, 2);
});

test('different milestones, collapsed iterations, and N/A weeks break runs', () => {
  const { slots } = layoutRuns(
    [
      a('1', 'w0', 'x', 'm1'), a('2', 'w1', 'x', 'm2'),
      a('3', 'w2', 'x'), a('4', 'w3', 'x'),
      a('5', 'w4', 'x'), a('6', 'w4', '__unavailable__'), a('7', 'w5', 'x'),
    ],
    ['w0', 'w1', 'w2', null, 'w3', 'w4', 'w5'],
    { isBlocker: x => x.projectId === '__unavailable__' },
  );
  assert.equal(slots['1'].joinNext, false);
  assert.equal(slots['3'].joinNext, false);
  assert.equal(slots['4'].joinNext, false);
  assert.equal(slots['5'], undefined);
  assert.equal(slots['7'].joinPrev, false);
});
