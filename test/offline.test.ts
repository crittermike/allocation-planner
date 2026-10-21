import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { offlineWatcher } from '../src/offline.ts';

const setup = () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const calls: boolean[] = [];
  return { calls, w: offlineWatcher(v => calls.push(v), 2000) };
};

test('ignores disconnects shorter than the delay', (t) => {
  t.after(() => mock.timers.reset());
  const { calls, w } = setup();
  w.update('closed');
  mock.timers.tick(1500);
  w.update('connecting');
  mock.timers.tick(400);
  w.update('open');
  mock.timers.tick(5000);
  assert.deepEqual(calls, []);
});

test('reports offline after the delay across retries, then back online', (t) => {
  t.after(() => mock.timers.reset());
  const { calls, w } = setup();
  w.update('closed');
  mock.timers.tick(1000);
  w.update('connecting');
  mock.timers.tick(1000);
  assert.deepEqual(calls, [true]);
  w.update('closed');
  mock.timers.tick(5000);
  w.update('open');
  assert.deepEqual(calls, [true, false]);
});
