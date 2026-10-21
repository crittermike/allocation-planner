import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_POINTS, netChanges, pointsOf, targetStatus, type ScopeEvent, type ScopeSummary } from '../src/scope.ts';
import { pointsFrom } from '../server/scope.js';

test('pointsOf defaults to 3 when unset or invalid', () => {
  assert.equal(DEFAULT_POINTS, 3);
  assert.equal(pointsOf({ points: null }), 3);
  assert.equal(pointsOf({}), 3);
  assert.equal(pointsOf({ points: 0 }), 3);
  assert.equal(pointsOf({ points: 8 }), 8);
});

test('pointsFrom takes the first numeric Points value', () => {
  assert.equal(pointsFrom({ nodes: [{ fieldValueByName: null }, { fieldValueByName: { name: '5' } }] }), 5);
  assert.equal(pointsFrom({ nodes: [{ fieldValueByName: { name: 'XL' } }] }), null);
  assert.equal(pointsFrom({ nodes: [{ fieldValueByName: { name: '5XL' } }, { fieldValueByName: { name: '2' } }] }), 2);
  assert.equal(pointsFrom({ nodes: [{ fieldValueByName: { number: 2 } }] }), 2);
  assert.equal(pointsFrom(undefined), null);
});

const asOf = new Date(2026, 9, 19, 12).toISOString(); // a Monday
const summary = (over: Partial<ScopeSummary>, rates: [number, number][] = [[1, 0]]): ScopeSummary => ({
  asOf,
  status: 'converging',
  remaining: 2.3,
  pace: {
    own: null, ownWeight: 1, references: [],
    scenarios: rates.map(([completionRate, creepRate]) => ({ label: 'x', completionRate, creepRate })),
    completionRate: rates[0][0],
    creepRate: rates[0][1],
  },
  ...over,
} as ScopeSummary);

test('targetStatus: a converging forecast that finishes after the target is late', () => {
  // 2.3 weeks at 1 pt/week finishes Wednesday Nov 4.
  assert.equal(targetStatus(summary({}), '2026-11-06'), 'on-track');
  assert.equal(targetStatus(summary({}), '2026-11-02'), 'at-risk');
  assert.equal(targetStatus(summary({}), '2026-10-30'), 'late');
  assert.equal(targetStatus(summary({}, [[1, 1]]), '2027-06-01'), 'late');
});

test('targetStatus: ranges are at risk when only some estimates miss', () => {
  assert.equal(targetStatus(summary({ status: 'just-started' }, [[2, 0], [0.5, 0]]), '2026-11-06'), 'at-risk');
  assert.equal(targetStatus(summary({ status: 'just-started' }, [[2, 0], [1.5, 0]]), '2026-11-06'), 'on-track');
});

test('targetStatus: a passed target is late; nothing to compare is null', () => {
  assert.equal(targetStatus(summary({ status: 'too-early', pace: null }), '2026-10-16'), 'late');
  assert.equal(targetStatus(summary({ status: 'too-early', pace: null }), '2026-11-06'), null);
  assert.equal(targetStatus(summary({ status: 'done', remaining: 0 }), '2026-10-16'), null);
  assert.equal(targetStatus(summary({}), undefined), null);
});

const issue = (n: number) => ({ id: `i${n}`, number: n, title: `#${n}` }) as ScopeEvent['issue'];
const ev = (day: number, kind: ScopeEvent['kind'], n: number): ScopeEvent => ({ at: `2026-10-${String(day).padStart(2, '0')}T12:00:00Z`, kind, issue: issue(n) });

test('netChanges collapses repeats per issue to the net change', () => {
  const newestFirst = (...e: ScopeEvent[]) => e.reverse();
  const events = newestFirst(
    ev(1, 'completed', 1), ev(2, 'added', 2), ev(5, 'reopened', 1), ev(6, 'completed', 2),
    ev(7, 'completed', 1), ev(8, 'added', 3), ev(9, 'removed', 3),
  );
  assert.deepEqual(netChanges(events).map(e => `${e.at.slice(8, 10)} ${e.kind} ${e.issue.number}`), [
    '07 completed 1',
    '06 completed 2',
    '02 added 2',
  ]);
});
