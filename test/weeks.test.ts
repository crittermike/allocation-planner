import { test } from 'node:test';
import assert from 'node:assert/strict';
import { currentWeekId } from '../src/weeks.ts';

const weeks = [
  { id: 'it0:0', startDate: '2026-10-12' },
  { id: 'it0:1', startDate: '2026-10-19' },
  { id: 'it1:0', startDate: '2026-10-26' },
];

test('currentWeekId picks the week whose seven days include today', () => {
  assert.equal(currentWeekId(weeks, '2026-10-19'), 'it0:1');
  assert.equal(currentWeekId(weeks, '2026-10-25'), 'it0:1');
  assert.equal(currentWeekId(weeks, '2026-10-26'), 'it1:0');
});

test('currentWeekId is null outside the plan and across a month or DST change', () => {
  assert.equal(currentWeekId(weeks, '2026-10-11'), null);
  assert.equal(currentWeekId(weeks, '2026-11-02'), null);
  assert.equal(currentWeekId([{ id: 'w', startDate: '2026-10-30' }], '2026-11-05'), 'w');
});
