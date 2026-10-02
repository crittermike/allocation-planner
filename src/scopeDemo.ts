/// <reference types="vite/client" />
/**
 * DEMO DATA for prototyping the scope-tracking UX.
 *
 * Every issue, title, and date here is fictional and generated relative to
 * today. Nothing is read from GitHub. Demo data is only available in dev
 * builds so it can never appear next to real plans in production.
 *
 * One fictional epic (#700) with milestones #701–#706. A project linked to the
 * epic shows the milestone table; a project linked to a milestone shows that
 * milestone on its own, from the same history.
 */
import { analyzeScope, type GitHubIssueRef, type ScopeIssue, type ScopeLoad, type ScopeSnapshot, type ScopeTracking } from './scope';

const DEMO_OWNER = 'acme-demo';

/** The fictional issues demo data exists for. */
export const isDemoIssue = (ref: GitHubIssueRef) => ref.owner.toLowerCase() === DEMO_OWNER;

export const DEMO_SCENARIOS = [
  { id: 'normal', label: 'Normal' },
  { id: 'stale', label: 'Refresh failing' },
  { id: 'unreadable', label: 'Issue not readable' },
  { id: 'empty', label: 'No sub-issues' },
] as const;

export type DemoScenario = (typeof DEMO_SCENARIOS)[number]['id'];

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const HISTORY_DAYS = 112;
const DEMO_ISSUE_URL = `https://github.com/${DEMO_OWNER}/invoice-exports/issues/`;
const EPIC = 700;
const MILESTONES = [701, 702, 703, 704, 705, 706];
/** Other issue numbers show one of these, so any GitHub issue URL gets demo data. */
const FALLBACKS = [EPIC, 703, 704, 705, 706];

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
  'API for managing schedules', 'Alert on missed schedule runs', 'Docs for scheduled exports',
];
const M3_NEW = [
  'Handle DST transitions in schedules', 'Limit schedules per account', 'Retry failed scheduled deliveries',
  'Validate cron expressions',
];
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
  'Admin override for legal holds', 'Retention settings API', 'Retention docs',
];
const M6 = ['Reduce export worker memory', 'Structured logging for export jobs', 'Chaos test worker restarts'];

type AddOptions = { closed?: boolean; number?: number; before?: string };

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

  add(key: string, title: string, parent?: string, opts: AddOptions = {}) {
    const number = opts.number ?? this.nextNumber++;
    this.issues.set(key, {
      id: `demo-${number}`,
      number,
      title,
      url: DEMO_ISSUE_URL + number,
      parentId: parent ? this.get(parent).id : this.rootId,
      state: opts.closed ? 'closed' : 'open',
      ...(opts.closed ? { closeReason: 'completed' as const } : {}),
    });
    const at = opts.before ? this.order.indexOf(opts.before) : this.order.length;
    this.order.splice(at, 0, key);
    this.dirty = true;
    return this;
  }

  addAll(parent: string, titles: readonly string[]) {
    titles.forEach((title, i) => this.add(`${parent}.${i}`, title, parent));
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
    const from = this.issues.get(this.keyOfId(this.get(key).parentId) ?? '');
    return this.update(key, {
      parentId: this.get(parent).id,
      movedFrom: from ? { number: from.number, title: from.title } : undefined,
    });
  }

  private keyOfId(id: string) {
    for (const [key, issue] of this.issues) if (issue.id === id) return key;
    return undefined;
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

/** Sixteen weeks of a fictional epic: M1–M2 finished, M3 converging but tight on
 *  its date, M4 growing faster than it's finished (deferring some work to M6),
 *  M5 just started, and M6 not started. */
function epicTree(now: number): DemoTree {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const t = new DemoTree(`demo-${EPIC}`, today.getTime() - HISTORY_DAYS * DAY, 710);
  t.day(0, 9)
    .add('planning', 'Epic planning', undefined, { closed: true })
    .add('m1', 'M1: Export foundations', undefined, { number: 701 }).addAll('m1', M1)
    .add('m6', 'M6: Hardening & follow-ups', undefined, { number: 706 }).addAll('m6', M6)
    .add('wrapup', 'Epic wrap-up');
  t.day(3).close('m1.0');
  t.day(8).close('m1.1');
  t.day(12).add('m1.n0', 'Handle exports with no invoices', 'm1');
  t.day(14).close('m1.2');
  t.day(19).close('m1.3');
  t.day(21).add('m2', 'M2: Async export worker', undefined, { number: 702, before: 'm6' }).addAll('m2', M2);
  t.day(23).close('m1.n0');
  t.day(27).close('m1.4');
  t.day(29).close('m2.0');
  t.day(31).close('m1.5');
  t.day(33).close('m2.1');
  t.day(35).add('m2.n0', 'Handle worker crashes mid-export', 'm2');
  t.day(36).close('m2.2');
  t.day(40).close('m2.3');
  t.day(43).close('m2.4');
  t.day(44).add('m2.n1', 'Rate-limit retries per account', 'm2');
  t.day(47).close('m2.5');
  t.day(50).close('m2.6').add('m3', 'M3: Scheduled exports', undefined, { number: 703, before: 'm6' }).addAll('m3', M3);
  t.day(53).close('m2.n0');
  t.day(55).close('m2.7');
  t.day(58).close('m2.8');
  t.day(61).close('m2.n1');
  t.day(64).close('m3.0');
  t.day(68).close('m3.1');
  t.day(70).add('m4', 'M4: Multi-account exports', undefined, { number: 704, before: 'm6' }).addAll('m4', M4);
  t.day(73).add('m3.n0', M3_NEW[0], 'm3');
  t.day(76).close('m3.2');
  t.day(78).add('m3.n3', M3_NEW[3], 'm3');
  t.day(80).close('m3.3', 'm4.0');
  t.day(82).add('m4.n0', M4_NEW[0], 'm4');
  t.day(85).close('m4.1').add('m4.n1', M4_NEW[1], 'm4');
  t.day(86).close('m3.4');
  t.day(87).add('m4.n2', M4_NEW[2], 'm4');
  t.day(88).close('m4.2');
  t.day(89).close('m3.5');
  t.day(90).add('m3.n1', M3_NEW[1], 'm3').add('m4.n3', M4_NEW[3], 'm4');
  t.day(91).move('m4.13', 'm6');
  t.day(92).close('m4.3').add('m4.n5', M4_NEW[5], 'm4');
  t.day(93).close('m3.6');
  t.day(94).add('m4.n6', M4_NEW[6], 'm4').drop('m4.9', 'duplicate');
  t.day(95).drop('m3.10')
    .add('m4.s0', M4_SPLIT[0], 'm4.4').add('m4.s1', M4_SPLIT[1], 'm4.4').add('m4.s2', M4_SPLIT[2], 'm4.4');
  t.day(96).close('m4.n1').add('m4.n7', M4_NEW[7], 'm4').add('m6.n0', 'Tune archive compression', 'm6');
  t.day(97).reopen('m3.6');
  t.day(98).close('m4.5').add('m5', 'M5: Export retention', undefined, { number: 705, before: 'm6' }).addAll('m5', M5);
  t.day(99).close('m3.6', 'm3.7').add('m4.n8', M4_NEW[8], 'm4');
  t.day(100).move('m4.n7', 'm6').add('m4.n9', M4_NEW[9], 'm4');
  t.day(101).add('m3.n2', M3_NEW[2], 'm3');
  t.day(102).move('m4.n9', 'm6');
  t.day(103).reopen('m4.5').add('m4.n10', M4_NEW[10], 'm4');
  t.day(104).close('m3.8', 'm4.7');
  t.day(105).close('m5.0').add('m4.n11', M4_NEW[11], 'm4');
  t.day(106).close('m4.5').move('m4.n10', 'm6');
  t.day(107).add('m6.n1', 'Dashboards for retention jobs', 'm6');
  t.day(108).close('m3.n0', 'm4.n0', 'm5.1');
  t.day(109).add('m4.n13', M4_NEW[13], 'm4').add('m5.n0', 'Backfill retention for existing exports', 'm5');
  t.day(111).add('m4.n15', M4_NEW[15], 'm4');
  t.flush();
  return t;
}

export function demoScope(ref: GitHubIssueRef, scenario: DemoScenario, now = Date.now()): ScopeLoad {
  const iso = (ms: number) => new Date(ms).toISOString();
  if (scenario === 'unreadable') return { status: 'unreadable', at: iso(now - 3 * MINUTE) };
  const checkedAt = iso(now - 12 * MINUTE);
  if (scenario === 'empty') {
    return {
      status: 'ready',
      tracking: {
        source: 'demo',
        root: { id: `demo-empty-${ref.number}`, number: ref.number },
        snapshots: [{ observedAt: iso(now - 2 * DAY), issues: [] }],
        checkedAt,
      },
    };
  }

  const tree = epicTree(now);
  const epic: ScopeTracking = {
    source: 'demo',
    root: { id: tree.rootId, number: ref.number },
    snapshots: tree.snapshots,
    checkedAt,
  };
  const number = ref.number === EPIC || MILESTONES.includes(ref.number)
    ? ref.number
    : FALLBACKS[ref.number % FALLBACKS.length];
  let tracking = epic;
  if (number !== EPIC) {
    // One milestone on its own. The rest of the epic stays in the snapshots as
    // context for moves; finished siblings set the pace for early estimates.
    const reference = analyzeScope(epic).reference.filter(r => r.number !== number);
    tracking = { ...epic, root: { id: `demo-${number}`, number: ref.number }, reference };
  }
  if (scenario === 'stale') {
    const lastGood = now - 3 * DAY;
    tracking = {
      ...tracking,
      snapshots: tracking.snapshots.filter(s => Date.parse(s.observedAt) <= lastGood),
      checkedAt: iso(lastGood),
      refreshError: { at: iso(now - 20 * MINUTE), message: 'GitHub API rate limit exceeded' },
    };
  }
  return { status: 'ready', tracking };
}
