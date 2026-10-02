/// <reference types="vite/client" />
/**
 * DEMO DATA for prototyping the scope-tracking UX.
 *
 * Every issue, title, and date here is fictional and generated relative to
 * today. Nothing is read from GitHub. Demo data is only available in dev
 * builds so it can never appear next to real plans in production.
 */
import type { GitHubIssueRef, ScopeIssue, ScopeLoad, ScopeSnapshot, ScopeTracking } from './scope';

export const SCOPE_DEMO_ENABLED = import.meta.env.DEV;

export const DEMO_SCENARIOS = [
  { id: 'epic', label: 'Epic with milestones' },
  { id: 'converging', label: 'Converging' },
  { id: 'outpacing', label: 'Scope outpacing completion' },
  { id: 'first-snapshot', label: 'First snapshot' },
  { id: 'stale', label: 'Refresh failing' },
  { id: 'unreadable', label: 'Issue not readable' },
  { id: 'empty', label: 'No sub-issues' },
] as const;

export type DemoScenario = (typeof DEMO_SCENARIOS)[number]['id'];

/** Deterministic default so different projects open in different states. */
export const defaultDemoScenario = (ref: GitHubIssueRef): DemoScenario =>
  DEMO_SCENARIOS[ref.number % DEMO_SCENARIOS.length].id;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const DEMO_ISSUE_URL = 'https://github.com/acme-demo/invoice-exports/issues/';

const M1 = [
  'Export job model and migrations', 'CSV writer for invoice rows', 'Store export files in blob storage',
  'Signed download links', 'Basic export audit events', 'Permission check for exports',
];
const M2 = [
  'Move export generation to a background worker', 'Worker retries with backoff', 'Progress reporting from the worker',
  'Expire stale export jobs', 'Worker metrics and dashboards', 'Chunk large invoice queries',
  'Email when an export is ready', 'Cancel a running export', 'Worker load test',
];
const M3 = [
  'Schedule model (daily, weekly, monthly)', 'Scheduler loop with leader election', 'Timezone-aware schedule times',
  'UI to create and edit schedules', 'Pause schedules for suspended accounts', 'Skip runs when nothing changed',
  'Deliver scheduled exports to S3', 'Deliver scheduled exports by email', 'Schedule run history page',
  'Alert on missed schedule runs', 'API for managing schedules', 'Docs for scheduled exports',
];
const M3_NEW = ['Handle DST transitions in schedules', 'Limit schedules per account', 'Retry failed scheduled deliveries'];
const M4 = [
  'Add account_id to export jobs', 'Batch exports by account', 'Paginate account list for large customers',
  'Per-account rate limiting', 'Retry failed account exports', 'Merge per-account files into one archive',
  'Email when a multi-account export finishes', 'Per-account progress in the UI', 'Cancel a multi-account export',
  'Clean up partial archives after cancel', 'Audit events for multi-account exports', 'API endpoint for multi-account exports',
  'Feature flag and staged rollout', 'Dashboards for export throughput', 'Alert on stuck multi-account exports',
  'Runbook for failed exports', 'Load test with 5,000 accounts',
];
const M4_NEW = [
  'Handle accounts deleted mid-export', 'Fix duplicate rows when a page is retried', 'Respect per-account data residency',
  'Timeouts for very large accounts', 'Backfill missing account names in archives', 'Paginate the progress endpoint',
  'Prevent concurrent exports for the same customer', 'Sanitize file names in archives', 'Handle currency rounding differences',
  'Re-enable the export button after a failure', 'Localize export emails', 'Idempotency key for the export API',
  'Archive size limit and warning', 'Resume merge after a worker restart', 'Skip accounts without invoices',
  'Warn before exports larger than 1 GB',
];
const M4_SPLIT = ['Classify transient vs. permanent errors', 'Persist retry attempt history', 'Show retry state in the UI'];
const M5 = [
  'Retention policy settings', 'Delete expired export files', 'Retention audit events',
  'Admin override for legal holds', 'Retention docs',
];
const M5_NEW = ['Backfill retention for existing exports'];
const M6 = ['Reduce export worker memory', 'Structured logging for export jobs', 'Chaos test worker restarts'];
const M6_NEW = ['Tune archive compression', 'Dashboards for retention jobs'];

/** Scripted sub-issue tree that records a snapshot whenever a day's changes land. */
class DemoTree {
  readonly snapshots: ScopeSnapshot[] = [];
  private issues = new Map<string, ScopeIssue>();
  private order: string[] = [];
  private time: number;
  private dirty = false;

  constructor(readonly rootId: string, private start: number, private nextNumber: number) {
    this.time = start;
  }

  day(day: number, hour = 14) {
    this.flush();
    this.time = this.start + day * DAY + hour * HOUR;
    return this;
  }

  flush() {
    if (!this.dirty) return;
    this.snapshots.push({
      observedAt: new Date(this.time).toISOString(),
      issues: this.order.map(key => ({ ...this.get(key) })),
    });
    this.dirty = false;
  }

  idOf(key: string) {
    return this.get(key).id;
  }

  add(key: string, title: string, parent?: string, opts: { closed?: boolean; after?: string } = {}) {
    const number = this.nextNumber++;
    this.issues.set(key, {
      id: `demo-${number}`,
      number,
      title,
      url: DEMO_ISSUE_URL + number,
      parentId: parent ? this.idOf(parent) : this.rootId,
      state: opts.closed ? 'closed' : 'open',
      ...(opts.closed ? { closeReason: 'completed' as const } : {}),
    });
    const at = opts.after ? this.order.indexOf(opts.after) + 1 : this.order.length;
    this.order.splice(at, 0, key);
    this.dirty = true;
    return this;
  }

  addAll(parent: string, titles: readonly string[], closedCount = 0) {
    titles.forEach((title, i) => this.add(`${parent}.${i}`, title, parent, { closed: i < closedCount }));
    return this;
  }

  close(...keys: string[]) {
    keys.forEach(key => this.update(key, { state: 'closed', closeReason: 'completed' }));
    return this;
  }

  drop(key: string, reason: 'not_planned' | 'duplicate' = 'not_planned') {
    return this.update(key, { state: 'closed', closeReason: reason });
  }

  reopen(key: string) {
    return this.update(key, { state: 'open', closeReason: undefined });
  }

  move(key: string, parent: string) {
    return this.update(key, { parentId: this.idOf(parent) });
  }

  private get(key: string) {
    const issue = this.issues.get(key);
    if (!issue) throw new Error(`Unknown demo issue ${key}`);
    return issue;
  }

  private update(key: string, patch: Partial<ScopeIssue>) {
    this.issues.set(key, { ...this.get(key), ...patch });
    this.dirty = true;
    return this;
  }
}

/** Six weeks of a fictional epic: M1–M2 finished, M3 converging, M4 growing
 *  faster than it's completed (with spillover moved to M6), M5 added late. */
function epicTree(now: number): DemoTree {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const t = new DemoTree('demo-700', today.getTime() - 42 * DAY, 701);
  t.day(0, 9)
    .add('m1', 'M1: Export foundations').addAll('m1', M1, M1.length)
    .add('m2', 'M2: Async export worker').addAll('m2', M2, 6)
    .add('m3', 'M3: Scheduled exports').addAll('m3', M3, 1)
    .add('m4', 'M4: Multi-account exports').addAll('m4', M4)
    .add('m6', 'M6: Hardening & follow-ups').addAll('m6', M6)
    .add('planning', 'Epic planning', undefined, { closed: true })
    .add('wrapup', 'Epic wrap-up');
  t.day(2).close('m3.1');
  t.day(3).close('m2.6').add('m4.n0', M4_NEW[0], 'm4');
  t.day(5).close('m3.2', 'm4.0');
  t.day(7).close('m2.7').add('m4.n1', M4_NEW[1], 'm4');
  t.day(9).close('m3.3').add('m3.n0', M3_NEW[0], 'm3');
  t.day(10).close('m4.1').add('m4.n2', M4_NEW[2], 'm4');
  t.day(12).close('m2.8', 'm3.4');
  t.day(15).close('m4.2').add('m4.n3', M4_NEW[3], 'm4').add('m4.n4', M4_NEW[4], 'm4');
  t.day(16).close('m3.5');
  t.day(17).drop('m3.10');
  t.day(18).move('m4.13', 'm6');
  t.day(19).close('m3.6', 'm6.0').add('m4.n5', M4_NEW[5], 'm4');
  t.day(21).close('m4.3').add('m4.n6', M4_NEW[6], 'm4');
  t.day(22).close('m3.7');
  t.day(23).reopen('m3.5');
  t.day(24).add('m4.n7', M4_NEW[7], 'm4').add('m4.n8', M4_NEW[8], 'm4').drop('m4.9', 'duplicate');
  t.day(25).close('m3.5').add('m3.n1', M3_NEW[1], 'm3');
  t.day(26).add('m4.s0', M4_SPLIT[0], 'm4.4').add('m4.s1', M4_SPLIT[1], 'm4.4').add('m4.s2', M4_SPLIT[2], 'm4.4');
  t.day(27).close('m3.8', 'm4.n1');
  t.day(28).close('m4.5').add('m4.n9', M4_NEW[9], 'm4');
  t.day(30).move('m4.n7', 'm6').move('m4.n9', 'm6').add('m6.n0', M6_NEW[0], 'm6');
  t.day(31).add('m5', 'M5: Export retention', undefined, { after: 'm4' }).addAll('m5', M5).close('m3.9');
  t.day(32).close('m4.6').add('m4.n10', M4_NEW[10], 'm4').add('m4.n11', M4_NEW[11], 'm4');
  t.day(33).close('m3.n0');
  t.day(34).reopen('m4.5');
  t.day(35).close('m4.7').add('m4.n12', M4_NEW[12], 'm4');
  t.day(36).add('m5.n0', M5_NEW[0], 'm5').add('m3.n2', M3_NEW[2], 'm3');
  t.day(37).move('m4.n10', 'm6').add('m6.n1', M6_NEW[1], 'm6');
  t.day(38).close('m4.5');
  t.day(39).close('m5.0').add('m4.n13', M4_NEW[13], 'm4').add('m4.n14', M4_NEW[14], 'm4');
  t.day(40, 11).close('m4.n0').add('m4.n15', M4_NEW[15], 'm4');
  t.flush();
  return t;
}

/** Track one milestone of the epic directly, as if the project URL pointed at it. */
function subtree(snapshots: ScopeSnapshot[], rootId: string): ScopeSnapshot[] {
  const out: ScopeSnapshot[] = [];
  let previous = '';
  for (const s of snapshots) {
    const byId = new Map(s.issues.map(i => [i.id, i]));
    if (!byId.has(rootId)) continue;
    const inside = s.issues.filter(issue => {
      let cur: ScopeIssue | undefined = issue;
      for (let depth = 0; cur && depth < 32; depth++) {
        if (cur.parentId === rootId) return true;
        cur = byId.get(cur.parentId);
      }
      return false;
    });
    const key = JSON.stringify(inside);
    if (key === previous) continue;
    previous = key;
    out.push({ observedAt: s.observedAt, issues: inside });
  }
  return out;
}

export function demoScope(ref: GitHubIssueRef, scenario: DemoScenario, now = Date.now()): ScopeLoad {
  const iso = (ms: number) => new Date(ms).toISOString();
  const checkedAt = iso(now - 12 * MINUTE);
  const ready = (rootId: string, snapshots: ScopeSnapshot[], extra: Partial<ScopeTracking> = {}): ScopeLoad => ({
    status: 'ready',
    tracking: { source: 'demo', root: { id: rootId, number: ref.number }, snapshots, checkedAt, ...extra },
  });

  if (scenario === 'unreadable') return { status: 'unreadable', at: iso(now - 3 * MINUTE) };
  if (scenario === 'empty') return ready('demo-root', [{ observedAt: iso(now - 2 * DAY), issues: [] }]);

  const epic = epicTree(now);
  const milestone = (key: string) => {
    const id = epic.idOf(key);
    return { id, snapshots: subtree(epic.snapshots, id) };
  };
  switch (scenario) {
    case 'epic':
      return ready(epic.rootId, epic.snapshots);
    case 'converging': {
      const m = milestone('m3');
      return ready(m.id, m.snapshots);
    }
    case 'outpacing': {
      const m = milestone('m4');
      return ready(m.id, m.snapshots);
    }
    case 'first-snapshot': {
      const m = milestone('m5');
      const observedAt = iso(now - 5 * MINUTE);
      return ready(m.id, [{ observedAt, issues: m.snapshots[0].issues }], { checkedAt: observedAt });
    }
    case 'stale': {
      const m = milestone('m3');
      const lastGood = now - 3 * DAY;
      return ready(m.id, m.snapshots.filter(s => Date.parse(s.observedAt) <= lastGood), {
        checkedAt: iso(lastGood),
        refreshError: { at: iso(now - 20 * MINUTE), message: 'GitHub API rate limit exceeded' },
      });
    }
  }
}
