/** Scope tracking for projects whose URL is a GitHub issue.
 *
 *  A snapshot is one complete observation of the issue's sub-issue tree.
 *  Everything the UI shows — scope history, changes, creep, and forecasts —
 *  is derived from the snapshot list, so demo data and real GitHub data go
 *  through the same rules. */

export type GitHubIssueRef = { owner: string; repo: string; number: number; url: string };

const ISSUE_URL = /^https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/issues\/(\d+)\/?(?:[?#].*)?$/i;

/** Only GitHub issue URLs are tracked; repos, PRs, and other links are ignored. */
export function parseGitHubIssueUrl(url: string | undefined): GitHubIssueRef | null {
  const m = url?.trim().match(ISSUE_URL);
  if (!m) return null;
  const [, owner, repo, num] = m;
  return { owner, repo, number: Number(num), url: `https://github.com/${owner}/${repo}/issues/${num}` };
}

/** Matches the same issue across URLs that differ only in case or suffix. */
export const issueKey = (ref: { owner: string; repo: string; number: number }) =>
  `${ref.owner}/${ref.repo}#${ref.number}`.toLowerCase();

export type CloseReason = 'completed' | 'not_planned' | 'duplicate';

export type ScopeIssue = {
  /** Stable GitHub node ID. Numbers and titles are display-only. */
  id: string;
  number: number;
  title: string;
  url: string;
  /** Immediate parent: the tracked issue's ID for direct sub-issues. */
  parentId: string;
  state: 'open' | 'closed';
  closeReason?: CloseReason;
  /** Previous parent, when the issue was moved here from another issue. */
  movedFrom?: { number: number; title: string };
};

export type ScopeSnapshot = {
  observedAt: string;
  /** Every issue below the tracked issue, at any depth, in GitHub's order.
   *  May also include unrelated issues, such as sibling milestones, as context. */
  issues: ScopeIssue[];
};

/** Pace of a finished milestone, used to estimate milestones that just started. */
export type ReferencePace = {
  /** Short name like "M2", or the issue number. */
  label: string;
  number: number;
  completionRate: number;
  creepRate: number;
  /** From the first finished issue to the last. */
  weeks: number;
};

export type ScopeTracking = {
  source: 'demo' | 'github';
  root: { id: string; number: number };
  /** Complete observations, oldest first. */
  snapshots: ScopeSnapshot[];
  /** Last successful refresh; newer than the last snapshot when nothing changed. */
  checkedAt: string;
  /** Most recent failed refresh after `checkedAt`. */
  refreshError?: { at: string; message: string };
  /** Finished sibling milestones, for estimating a milestone tracked on its own. */
  reference?: ReferencePace[];
};

export type ScopeLoad =
  | { status: 'ready'; tracking: ScopeTracking }
  /** GitHub returns 404 for both missing issues and issues we can't read. */
  | { status: 'unreadable'; at: string };

const DAY = 86_400_000;
const WEEK = 7 * DAY;

/** Rates come from this trailing window. */
export const FORECAST_WINDOW_DAYS = 28;
/** Weeks after work starts until a milestone's own pace fully replaces finished milestones' pace. */
export const RAMP_WEEKS = 4;
/** With no finished milestone to compare with, no forecast until work has run this long… */
export const MIN_HISTORY_DAYS = 14;
/** …and this many issues were finished. */
export const MIN_COMPLETIONS = 5;
/** New issues per finished issue at which creep counts as high. */
export const HIGH_CREEP_RATIO = 0.5;
/** Projections further out are reported without a date. */
const MAX_PROJECTION_WEEKS = 52;

export const ALL_VIEW = 'all';

export type ScopeEvent = {
  at: string;
  kind: 'added' | 'removed' | 'completed' | 'reopened' | 'split';
  issue: ScopeIssue;
  note?: string;
  /** Additions: where the issue came from. */
  origin?: 'new' | 'moved' | 'split';
  /** Removals: why the issue left. */
  reason?: 'moved' | 'dropped' | 'unlinked';
  /** Removals and splits: the issue was still open, so remaining work went down. */
  wasOpen?: boolean;
};

/** Creep is newly discovered work: new open issues, not splits or moves between milestones. */
export const isCreep = (e: ScopeEvent) =>
  e.kind === 'added' && e.origin === 'new' && e.issue.state === 'open';

export type ScopePoint = { at: string; scope: number; completed: number };

export type OwnPace = {
  windowStart: string;
  windowWeeks: number;
  /** Finished minus reopened. */
  completed: number;
  creep: number;
  movedOut: number;
  dropped: number;
  completionRate: number;
  creepRate: number;
};

export type PaceScenario = { label: string; completionRate: number; creepRate: number };

export type Pace = {
  /** This milestone's observed pace; null before work starts. */
  own: OwnPace | null;
  /** Share of the estimate that comes from this milestone's own pace (0–1). */
  ownWeight: number;
  /** Finished milestones blended into the estimate. */
  references: ReferencePace[];
  /** One estimate per finished milestone, or just this milestone's own pace. */
  scenarios: PaceScenario[];
  /** Medians of the scenarios. */
  completionRate: number;
  creepRate: number;
};

export type ForecastStatus =
  | 'empty'
  | 'done'
  | 'not-started'
  | 'just-started'
  | 'too-early'
  | 'no-progress'
  | 'not-converging'
  | 'converging';

/** Statuses that come with a finish estimate. */
export const canForecast = (status: ForecastStatus) =>
  status === 'converging' || status === 'not-converging' || status === 'just-started' || status === 'not-started';

export type RemainingIssue = { issue: ScopeIssue; addedAt?: string; origin?: ScopeEvent['origin']; note?: string };

export type ScopeSummary = {
  asOf: string;
  /** When the first issue was finished; null if none has been. */
  startedAt: string | null;
  /** When the last remaining issue was finished. */
  finishedAt: string | null;
  weeksSinceStart: number;
  /** Starts at the baseline. */
  points: ScopePoint[];
  /** Scope just before the first issue was finished; current scope if work hasn't started. */
  baseline: ScopePoint;
  current: ScopePoint;
  remaining: number;
  addedSinceStart: number;
  removedSinceStart: number;
  /** Changes after the baseline, newest first. */
  events: ScopeEvent[];
  /** Issues added after the baseline first (newest first), then baseline issues. */
  remainingIssues: RemainingIssue[];
  status: ForecastStatus;
  pace: Pace | null;
  /** At least HIGH_CREEP_RATIO new issues per finished issue, once past the first weeks. */
  highCreep: boolean;
};

export type ScopeView = {
  id: string;
  label: string;
  /** The milestone issue; null for the single view of a non-epic. */
  issue: ScopeIssue | null;
  summary: ScopeSummary;
};

export type ScopeAnalysis = {
  views: ScopeView[];
  /** The tracked issue is an epic: one view per milestone, no combined view. */
  hasBreakdown: boolean;
  defaultViewId: string;
  /** Epics only: finished milestones' pace. */
  reference: ReferencePace[];
  /** Epics only: sub-issues that aren't in any milestone. */
  outside: { total: number; open: number } | null;
};

export type Projection = { weeks: number; date: string | null };

export type FinishForecast = {
  /** From the median rates. Null when new work arrives at least as fast as work is finished. */
  central: Projection | null;
  fastest: Projection | null;
  /** Null when some scenario never finishes. */
  slowest: Projection | null;
  /** Estimates come from several finished milestones. */
  isRange: boolean;
};

type Indexed = {
  at: number;
  observedAt: string;
  byId: Map<string, ScopeIssue>;
  /** IDs of issues that have sub-issues (rollups). */
  parents: Set<string>;
};

type Member = (issue: ScopeIssue, snap: Indexed) => boolean;

const index = (s: ScopeSnapshot): Indexed => ({
  at: Date.parse(s.observedAt),
  observedAt: s.observedAt,
  byId: new Map(s.issues.map(i => [i.id, i])),
  parents: new Set(s.issues.map(i => i.parentId)),
});

const iso = (ms: number) => new Date(ms).toISOString();

const isoDay = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const parseDay = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
};

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const outOfScope = (i: ScopeIssue) =>
  i.state === 'closed' && (i.closeReason === 'not_planned' || i.closeReason === 'duplicate');

const closedLabel = (i: ScopeIssue) => (i.closeReason === 'duplicate' ? 'duplicate' : 'not planned');

/** "M4" for milestone-style titles, otherwise the issue number. */
export function shortLabel(issue: { number: number; title: string }): string {
  const m = issue.title.match(/^\s*(M\d+)\b/i);
  return m ? m[1].toUpperCase() : `#${issue.number}`;
}

function isInside(issue: ScopeIssue, snap: Indexed, rootId: string): boolean {
  let cur: ScopeIssue | undefined = issue;
  for (let depth = 0; cur && depth < 32; depth++) {
    if (cur.parentId === rootId) return true;
    cur = snap.byId.get(cur.parentId);
  }
  return false;
}

/** The direct sub-issue of the tracked issue that contains `issue`. */
function topLevelId(issue: ScopeIssue, snap: Indexed, rootId: string): string | null {
  let cur = issue;
  for (let depth = 0; depth < 32; depth++) {
    if (cur.parentId === rootId) return cur.id;
    const parent = snap.byId.get(cur.parentId);
    if (!parent) return null;
    cur = parent;
  }
  return null;
}

/** Name of the outermost known issue containing `issue`, e.g. the milestone it sits in. */
function containerLabel(issue: ScopeIssue, snap: Indexed): string {
  let parent = snap.byId.get(issue.parentId);
  if (!parent) return 'the tracked issue';
  for (let depth = 0; depth < 32; depth++) {
    const up = snap.byId.get(parent.parentId);
    if (!up) break;
    parent = up;
  }
  return shortLabel(parent);
}

/** Counting rule: leaf issues only (rollups would double-count their children),
 *  excluding issues closed as not planned or duplicate. */
function scopeOf(snap: Indexed, member: Member): Map<string, ScopeIssue> {
  const out = new Map<string, ScopeIssue>();
  for (const issue of snap.byId.values()) {
    if (snap.parents.has(issue.id) || outOfScope(issue) || !member(issue, snap)) continue;
    out.set(issue.id, issue);
  }
  return out;
}

function diff(
  prev: Indexed,
  cur: Indexed,
  before: Map<string, ScopeIssue>,
  after: Map<string, ScopeIssue>,
): ScopeEvent[] {
  const at = cur.observedAt;
  const events: ScopeEvent[] = [];
  // In-scope leaves that gained sub-issues were decomposed, not removed.
  const split = new Set([...before.keys()].filter(id => cur.parents.has(id)));
  const splitAncestor = (issue: ScopeIssue): ScopeIssue | undefined => {
    let parent = cur.byId.get(issue.parentId);
    for (let depth = 0; parent && depth < 32; depth++) {
      if (split.has(parent.id)) return parent;
      parent = cur.byId.get(parent.parentId);
    }
    return undefined;
  };

  for (const [id, issue] of after) {
    const was = before.get(id);
    if (was) {
      if (was.state === 'open' && issue.state === 'closed') events.push({ at, kind: 'completed', issue });
      else if (was.state === 'closed' && issue.state === 'open') events.push({ at, kind: 'reopened', issue });
      continue;
    }
    const prior = prev.byId.get(id);
    const splitFrom = splitAncestor(issue);
    if (splitFrom) {
      events.push({ at, kind: 'added', issue, origin: 'split', note: `From #${splitFrom.number}` });
    } else if (prior && outOfScope(prior)) {
      events.push({ at, kind: 'added', issue, origin: 'new', note: `Reopened after being closed as ${closedLabel(prior)}` });
    } else if (prior && !prev.parents.has(id)) {
      events.push({ at, kind: 'added', issue, origin: 'moved', note: `From ${containerLabel(prior, prev)}` });
    } else if (!prior && issue.movedFrom) {
      events.push({ at, kind: 'added', issue, origin: 'moved', note: `From ${shortLabel(issue.movedFrom)}` });
    } else {
      events.push({
        at,
        kind: 'added',
        issue,
        origin: 'new',
        note: issue.state === 'closed' ? 'Already closed when added' : undefined,
      });
    }
  }

  for (const [id, was] of before) {
    if (after.has(id)) continue;
    const wasOpen = was.state === 'open';
    const now = cur.byId.get(id);
    if (now && split.has(id)) {
      const parts = [...after.values()].filter(i => splitAncestor(i)?.id === id).length;
      events.push({ at, kind: 'split', issue: now, note: `Into ${parts} sub-issues`, wasOpen });
    } else if (now && outOfScope(now)) {
      events.push({ at, kind: 'removed', issue: now, reason: 'dropped', note: `Closed as ${closedLabel(now)}`, wasOpen });
    } else if (now) {
      events.push({ at, kind: 'removed', issue: now, reason: 'moved', note: `To ${containerLabel(now, cur)}`, wasOpen });
    } else {
      events.push({ at, kind: 'removed', issue: was, reason: 'unlinked', note: 'No longer a sub-issue', wasOpen });
    }
  }
  return events;
}

function observe(events: ScopeEvent[], startedAt: number, asOf: number): OwnPace {
  const windowStart = Math.max(startedAt, asOf - FORECAST_WINDOW_DAYS * DAY);
  const recent = events.filter(e => Date.parse(e.at) >= windowStart);
  const count = (pred: (e: ScopeEvent) => boolean) => recent.filter(pred).length;
  const windowWeeks = Math.max(1 / 7, (asOf - windowStart) / WEEK);
  const completed = count(e => e.kind === 'completed') - count(e => e.kind === 'reopened');
  const creep = count(isCreep);
  return {
    windowStart: iso(windowStart),
    windowWeeks,
    completed,
    creep,
    movedOut: count(e => e.kind === 'removed' && e.reason === 'moved' && !!e.wasOpen),
    dropped: count(e => e.kind === 'removed' && e.reason === 'dropped' && !!e.wasOpen),
    completionRate: Math.max(0, completed) / windowWeeks,
    creepRate: creep / windowWeeks,
  };
}

/** Mixes a milestone's own pace with each finished milestone's pace. Early on, own
 *  rates come from less than RAMP_WEEKS of history but are weighted by elapsed time,
 *  so a few early completions count as if spread over the full ramp. */
function blend(own: OwnPace | null, ownWeight: number, refs: ReferencePace[]): Pace {
  const useRefs = refs.length > 0 && ownWeight < 1;
  const mix = (mine: number, theirs: number) => ownWeight * mine + (1 - ownWeight) * theirs;
  const scenarios: PaceScenario[] = useRefs
    ? refs.map(r => ({
        label: r.label,
        completionRate: mix(own?.completionRate ?? 0, r.completionRate),
        creepRate: mix(own?.creepRate ?? 0, r.creepRate),
      }))
    : [{ label: 'This milestone', completionRate: own?.completionRate ?? 0, creepRate: own?.creepRate ?? 0 }];
  return {
    own,
    ownWeight: useRefs ? ownWeight : 1,
    references: useRefs ? refs : [],
    scenarios,
    completionRate: median(scenarios.map(s => s.completionRate)),
    creepRate: median(scenarios.map(s => s.creepRate)),
  };
}

function summarize(snaps: Indexed[], member: Member, asOf: number, refs: ReferencePace[]): ScopeSummary {
  const scopes = snaps.map(s => scopeOf(s, member));
  const all: ScopePoint[] = snaps.map((s, i) => ({
    at: s.observedAt,
    scope: scopes[i].size,
    completed: [...scopes[i].values()].filter(issue => issue.state === 'closed').length,
  }));
  const last = all.length - 1;
  const current = all[last];
  const remaining = current.scope - current.completed;
  const firstDone = all.findIndex(p => p.completed > 0);
  // Baseline: the scope just before the first issue was finished. Earlier changes are planning.
  const b = firstDone === -1 ? last : Math.max(0, firstDone - 1);
  const startedAt = firstDone === -1 ? null : all[firstDone].at;

  const ascending: ScopeEvent[] = [];
  for (let i = b + 1; i <= last; i++) ascending.push(...diff(snaps[i - 1], snaps[i], scopes[i - 1], scopes[i]));

  const baselineScope = scopes[b];
  const currentScope = scopes[last];
  const lastAdded = new Map<string, ScopeEvent>();
  for (const e of ascending) if (e.kind === 'added') lastAdded.set(e.issue.id, e);
  const remainingIssues: RemainingIssue[] = [...currentScope.values()]
    .filter(issue => issue.state === 'open')
    .map(issue => {
      if (baselineScope.has(issue.id)) return { issue };
      const e = lastAdded.get(issue.id);
      return { issue, addedAt: e?.at, origin: e?.origin, note: e?.note };
    })
    .sort((x, y) =>
      x.addedAt && y.addedAt ? y.addedAt.localeCompare(x.addedAt) || x.issue.number - y.issue.number
        : x.addedAt ? -1
        : y.addedAt ? 1
        : x.issue.number - y.issue.number,
    );

  let finishedAt: string | null = null;
  if (current.scope > 0 && remaining === 0) {
    let lastOpen = -1;
    all.forEach((p, i) => { if (p.scope > p.completed) lastOpen = i; });
    finishedAt = all[Math.min(last, lastOpen + 1)].at;
  }

  const weeksSinceStart = startedAt ? (asOf - Date.parse(startedAt)) / WEEK : 0;
  let status: ForecastStatus;
  let pace: Pace | null = null;
  let highCreep = false;
  if (current.scope === 0) {
    status = 'empty';
  } else if (remaining === 0) {
    status = 'done';
  } else if (!startedAt) {
    status = 'not-started';
    if (refs.length > 0) pace = blend(null, 0, refs);
  } else {
    const own = observe(ascending, Date.parse(startedAt), asOf);
    const ramp = Math.min(1, weeksSinceStart / RAMP_WEEKS);
    if (ramp < 1 && refs.length > 0) {
      status = 'just-started';
      pace = blend(own, ramp, refs);
    } else {
      pace = blend(own, 1, []);
      if (ramp < 1 && (weeksSinceStart * 7 < MIN_HISTORY_DAYS || own.completed < MIN_COMPLETIONS)) status = 'too-early';
      else if (own.completed <= 0 && own.creep === 0) status = 'no-progress';
      else if (own.completionRate <= own.creepRate) status = 'not-converging';
      else status = 'converging';
      if (status !== 'too-early') {
        highCreep = own.completionRate > 0
          ? own.creepRate / own.completionRate >= HIGH_CREEP_RATIO
          : own.creepRate > 0;
      }
    }
  }

  return {
    asOf: iso(asOf),
    startedAt,
    finishedAt,
    weeksSinceStart,
    points: all.slice(b),
    baseline: all[b],
    current,
    remaining,
    addedSinceStart: [...currentScope.keys()].filter(id => !baselineScope.has(id)).length,
    removedSinceStart: [...baselineScope.keys()].filter(id => !currentScope.has(id)).length,
    events: ascending.reverse(),
    remainingIssues,
    status,
    pace,
    highCreep,
  };
}

function referencePace(milestone: ScopeIssue, s: ScopeSummary): ReferencePace | null {
  if (!s.startedAt || !s.finishedAt) return null;
  const weeks = Math.max(1, (Date.parse(s.finishedAt) - Date.parse(s.startedAt)) / WEEK);
  const finished = s.events.filter(e => e.kind === 'completed').length - s.events.filter(e => e.kind === 'reopened').length;
  return {
    label: shortLabel(milestone),
    number: milestone.number,
    completionRate: Math.max(0, finished) / weeks,
    creepRate: s.events.filter(isCreep).length / weeks,
    weeks,
  };
}

const ACTIVE: ForecastStatus[] = ['converging', 'not-converging', 'just-started', 'too-early', 'no-progress'];

/** For an epic (several sub-issues that have their own sub-issues), one view per
 *  milestone; a combined forecast would mix finished, active, and unstarted work.
 *  Otherwise, a single view of the whole tree. */
export function analyzeScope(t: ScopeTracking): ScopeAnalysis {
  const indexed = t.snapshots.map(index);
  const rootId = t.root.id;
  const inside: Member = (issue, snap) => isInside(issue, snap, rootId);
  const firstWithScope = indexed.findIndex(s => [...s.byId.values()].some(i => inside(i, s)));
  const snaps = firstWithScope > 0 ? indexed.slice(firstWithScope) : indexed;
  if (snaps.length === 0) {
    return { views: [], hasBreakdown: false, defaultViewId: ALL_VIEW, reference: [], outside: null };
  }
  const asOf = Math.max(Date.parse(t.checkedAt), snaps[snaps.length - 1].at);
  const latest = snaps[snaps.length - 1];

  const groups = new Map<string, ScopeIssue>();
  for (const s of snaps) {
    for (const issue of s.byId.values()) {
      if (issue.parentId === rootId && s.parents.has(issue.id)) groups.set(issue.id, issue);
    }
  }
  const groupOf = (issue: ScopeIssue, snap: Indexed) => {
    const top = topLevelId(issue, snap, rootId);
    return top && groups.has(top) ? top : null;
  };
  // Only an epic gets a per-milestone breakdown: several rollup sub-issues
  // holding most of the work. A task split into sub-issues isn't a milestone.
  const latestLeaves = [...scopeOf(latest, inside).values()];
  const grouped = latestLeaves.filter(issue => groupOf(issue, latest)).length;
  if (groups.size < 2 || grouped * 2 < latestLeaves.length) {
    const summary = summarize(snaps, inside, asOf, t.reference ?? []);
    return {
      views: [{ id: ALL_VIEW, label: 'All sub-issues', issue: null, summary }],
      hasBreakdown: false,
      defaultViewId: ALL_VIEW,
      reference: [],
      outside: null,
    };
  }

  // Keep GitHub's sub-issue order from the latest observation.
  const order = [...latest.byId.keys()];
  const position = (id: string) => {
    const i = order.indexOf(id);
    return i === -1 ? order.length : i;
  };
  const milestones = [...groups.values()].sort((a, b) => position(a.id) - position(b.id));
  const snapsFor = (g: ScopeIssue) => snaps.slice(Math.max(0, snaps.findIndex(s => s.byId.has(g.id))));
  const memberOf = (g: ScopeIssue): Member => (issue, snap) => groupOf(issue, snap) === g.id;

  // Finished milestones set the pace for ones that just started.
  const firstPass = milestones.map(g => ({ g, summary: summarize(snapsFor(g), memberOf(g), asOf, []) }));
  const reference = firstPass
    .filter(x => x.summary.status === 'done')
    .map(x => referencePace(x.g, x.summary))
    .filter((r): r is ReferencePace => r !== null);
  const views: ScopeView[] = firstPass.map(({ g, summary }) => ({
    id: g.id,
    label: g.title,
    issue: g,
    summary: summary.status === 'done' ? summary : summarize(snapsFor(g), memberOf(g), asOf, reference),
  }));

  const outsideLeaves = latestLeaves.filter(issue => !groupOf(issue, latest));
  const defaultView = views.find(v => ACTIVE.includes(v.summary.status))
    ?? views.find(v => v.summary.status !== 'done')
    ?? views[0];
  return {
    views,
    hasBreakdown: true,
    defaultViewId: defaultView.id,
    reference,
    outside: outsideLeaves.length
      ? { total: outsideLeaves.length, open: outsideLeaves.filter(i => i.state === 'open').length }
      : null,
  };
}

function projection(remaining: number, netRate: number, asOf: number): Projection | null {
  if (netRate <= 1e-9) return null;
  const weeks = remaining / netRate;
  return { weeks, date: weeks > MAX_PROJECTION_WEEKS ? null : isoDay(asOf + weeks * WEEK) };
}

/** Finish estimate with creep scaled by `multiplier` (0 = no more new issues, 1 = current rate). */
export function projectFinish(s: ScopeSummary, multiplier: number): FinishForecast | null {
  if (!s.pace || !canForecast(s.status) || s.remaining === 0) return null;
  const asOf = Date.parse(s.asOf);
  const project = (completionRate: number, creepRate: number) =>
    projection(s.remaining, completionRate - multiplier * creepRate, asOf);
  const each = s.pace.scenarios.map(sc => project(sc.completionRate, sc.creepRate));
  const finite = each.filter((p): p is Projection => p !== null).sort((a, b) => a.weeks - b.weeks);
  return {
    central: project(s.pace.completionRate, s.pace.creepRate),
    fastest: finite[0] ?? null,
    slowest: finite.length === each.length ? finite[finite.length - 1] : null,
    isRange: each.length > 1,
  };
}

/** Highest creep rate at which the remaining work still finishes by the end of `target`.
 *  Negative means it misses even with no new scope. Null without a started forecast,
 *  or once the target has passed. */
export function maxCreepForTarget(s: ScopeSummary, target: string): number | null {
  if (!s.pace || !canForecast(s.status) || s.status === 'not-started') return null;
  const weeksLeft = (parseDay(target) + DAY - Date.parse(s.asOf)) / WEEK;
  if (weeksLeft <= 0) return null;
  return s.pace.completionRate - s.remaining / weeksLeft;
}
