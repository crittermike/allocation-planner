import { test } from 'node:test';
import assert from 'node:assert/strict';
import { releasesByWeek, scheduledReleases, syncGitHubMilestones } from '../src/milestones.ts';

const ids = () => { let n = 0; return () => `new${++n}`; };
const A = { name: 'Alpha', url: 'https://github.com/o/r/issues/1' };
const B = { name: 'Beta', url: 'https://github.com/o/r/issues/2' };

test('adds found milestones when the project has none', () => {
  assert.deepEqual(syncGitHubMilestones(undefined, [A, B], ids()), [
    { id: 'new1', ...A, github: true },
    { id: 'new2', ...B, github: true },
  ]);
});

test('returns the same array when nothing changed', () => {
  const existing = syncGitHubMilestones(undefined, [A, B], ids());
  assert.equal(syncGitHubMilestones(existing, [A, B], ids()), existing);
  assert.equal(syncGitHubMilestones(undefined, [], ids()), undefined);
});

test('updates names, keeps ids and ship dates, follows GitHub order', () => {
  const existing = [
    { id: 'a', ...A, github: true as const, releaseDate: '2026-11-02' },
    { id: 'b', ...B, github: true as const },
  ];
  assert.deepEqual(syncGitHubMilestones(existing, [{ ...B, name: 'Beta 2' }, A], ids()), [
    { id: 'b', name: 'Beta 2', url: B.url, github: true },
    { id: 'a', ...A, github: true, releaseDate: '2026-11-02' },
  ]);
});

test('links an earlier manual import by URL', () => {
  const out = syncGitHubMilestones([{ id: 'a', name: 'old', url: A.url }], [A], ids());
  assert.deepEqual(out, [{ id: 'a', ...A, github: true }]);
});

test('flags synced milestones that are gone, and clears the flag when they return', () => {
  const existing = [{ id: 'a', ...A, github: true as const }, { id: 'b', ...B, github: true as const }];
  const gone = syncGitHubMilestones(existing, [B], ids())!;
  assert.deepEqual(gone, [{ id: 'a', ...A, github: true, goneFromGitHub: true }, { id: 'b', ...B, github: true }]);
  assert.equal(syncGitHubMilestones(gone, [B], ids()), gone);
  assert.deepEqual(syncGitHubMilestones(gone, [A, B], ids()), existing);
});

test('leaves manual milestones untouched and in place', () => {
  const manual = { id: 'm', name: 'Manual', releaseDate: '2026-12-01' };
  const out = syncGitHubMilestones([manual, { id: 'a', ...A, github: true }], [A, B], ids());
  assert.deepEqual(out, [manual, { id: 'a', ...A, github: true }, { id: 'new1', ...B, github: true }]);
  assert.equal(out![0], manual);
});

test('hides a project release when one of its milestones ships the same day', () => {
  const project = (releaseDate: string) => ({
    id: 'p', name: 'P', color: '#fff', driId: null, releaseDate,
    milestones: [{ id: 'm1', name: 'M1', releaseDate: '2026-11-13' }, { id: 'm2', name: 'M2', releaseDate: '2026-11-27' }],
  });
  assert.deepEqual(scheduledReleases([project('2026-11-27')]).map(r => r.key), ['p:m1', 'p:m2']);
  assert.deepEqual(scheduledReleases([project('2026-11-30')]).map(r => r.key), ['p:m1', 'p:m2', 'p']);
});

test('releasesByWeek attaches each release card forecast by key', () => {
  const project = {
    id: 'p', name: 'P', color: '#fff', driId: null, releaseDate: '2026-11-30',
    milestones: [{ id: 'm1', name: 'M1', releaseDate: '2026-11-26' }],
  };
  const late = { status: 'late' as const, finishWeek: '2027-03-22' };
  const byWeek = releasesByWeek([project], [{ id: 'w1', startDate: '2026-11-23' }, { id: 'w2', startDate: '2026-11-30' }], new Map([['p:m1', late]]));
  assert.deepEqual(byWeek.w1.map(r => r.forecast), [late]);
  assert.deepEqual(byWeek.w2.map(r => r.forecast), [undefined]);
});
