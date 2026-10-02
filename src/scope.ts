/** Scope tracking for projects whose URL is a GitHub issue.
 *
 *  A snapshot is one complete observation of the issue's sub-issue tree.
 *  Everything the UI shows — scope history, changes, and forecasts — is
 *  derived from the snapshot list, so demo data and real GitHub data go
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
};

export type ScopeSnapshot = {
  observedAt: string;
  /** Every issue below the tracked issue, at any depth, in GitHub's order. */
  issues: ScopeIssue[];
};

export type ScopeTracking = {
  source: 'demo' | 'github';
  root: { id: string; number: number };
  /** Complete observations, oldest first. Stored only when something changed. */
  snapshots: ScopeSnapshot[];
  /** Last successful refresh; newer than the last snapshot when nothing changed. */
  checkedAt: string;
  /** Most recent failed refresh after `checkedAt`. */
  refreshError?: { at: string; message: string };
};

export type ScopeLoad =
  | { status: 'ready'; tracking: ScopeTracking }
  /** GitHub returns 404 for both missing issues and issues we can't read. */
  | { status: 'unreadable'; at: string };

const DAY = 86_400_000;
const WEEK = 7 * DAY;

/** Rates come from this trailing window of observations. */
export const FORECAST_WINDOW_DAYS = 28;
/** No forecast until history spans this long… */
export const MIN_HISTORY_DAYS = 14;
/** …and at least this many net completions happened in the window. */
export const MIN_COMPLETIONS = 5;
/** Projections further out are reported without a date. */
const MAX_PROJECTION_WEEKS = 52;

export const ALL_VIEW = 'all';
export const OTHER_VIEW = 'other';

export type ScopeEvent = {
  at: string;
  kind: 'added' | 'removed' | 'completed' | 'reopened' | 'split';
  issue: ScopeIssue;
  note?: string;
  /** Added by splitting an issue already in scope; not counted as growth. */
  fromSplit?: boolean;
  /** Removals only: the issue was still open, so remaining work went down. */
  wasOpen?: boolean;
};

export type ScopePoint = { at: string; scope: number; completed: number };

export type Projection = { weeks: number; date: string | null };

export type ForecastStatus =
  | 'empty'
  | 'done'
  | 'short-history'
  | 'few-completions'
  | 'no-progress'
  | 'not-converging'
  | 'converging';

export type ForecastBasis = {
  windowStart: string;
  windowWeeks: number;
  /** Net completions: completed minus reopened. */
  completed: number;
  /** Open issues added, excluding splits. */
  added: number;
  /** Open issues removed, moved out, or closed as not planned/duplicate. */
  removed: number;
  remainingAtStart: number;
  completionRate: number;
  /** Net growth per week, floored at zero so one-off descoping isn't extrapolated. */
  growthRate: number;
  /** Finish the scope known today. */
  knownScope: Projection | null;
  /** Keep growing at the observed rate. */
  withGrowth: Projection | null;
};

export type Forecast = { status: ForecastStatus; basis?: ForecastBasis };

export type RemainingIssue = { issue: ScopeIssue; addedAt?: string; note?: string };

export type ScopeSummary = {
  startAt: string;
  asOf: string;
  historyDays: number;
  points: ScopePoint[];
  baseline: ScopePoint;
  current: ScopePoint;
  remaining: number;
  addedSinceBaseline: number;
  removedSinceBaseline: number;
  /** Newest first. */
  events: ScopeEvent[];
  /** Issues added after the baseline first (newest first), then baseline issues. */
  remainingIssues: RemainingIssue[];
  forecast: Forecast;
};

export type ScopeView = { id: string; label: string; summary: ScopeSummary };

export type ScopeAnalysis = {
  /** 'all' first, then one per milestone-like sub-issue, then 'other' if needed. */
  views: ScopeView[];
  hasBreakdown: boolean;
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

const outOfScope = (i: ScopeIssue) =>
  i.state === 'closed' && (i.closeReason === 'not_planned' || i.closeReason === 'duplicate');

const closedLabel = (i: ScopeIssue) => (i.closeReason === 'duplicate' ? 'duplicate' : 'not planned');

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
  rootId: string,
): ScopeEvent[] {
  const at = cur.observedAt;
  const events: ScopeEvent[] = [];
  const where = (issue: ScopeIssue, snap: Indexed) => {
    const top = topLevelId(issue, snap, rootId);
    const group = top && top !== issue.id ? snap.byId.get(top) : undefined;
    return group ? group.title : 'the tracked issue';
  };
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
      events.push({ at, kind: 'added', issue, note: `Split from #${splitFrom.number}`, fromSplit: true });
    } else if (prior && outOfScope(prior)) {
      events.push({ at, kind: 'added', issue, note: `Reopened after being closed as ${closedLabel(prior)}` });
    } else if (prior && !prev.parents.has(id)) {
      events.push({ at, kind: 'added', issue, note: `Moved from ${where(prior, prev)}` });
    } else {
      events.push({ at, kind: 'added', issue, note: issue.state === 'closed' ? 'Already closed when added' : undefined });
    }
  }

  for (const [id, was] of before) {
    if (after.has(id)) continue;
    const wasOpen = was.state === 'open';
    const now = cur.byId.get(id);
    if (now && split.has(id)) {
      const parts = [...after.values()].filter(i => splitAncestor(i)?.id === id).length;
      events.push({ at, kind: 'split', issue: now, note: `Split into ${parts} sub-issues`, wasOpen });
    } else if (now && outOfScope(now)) {
      events.push({ at, kind: 'removed', issue: now, note: `Closed as ${closedLabel(now)}`, wasOpen });
    } else if (now) {
      events.push({ at, kind: 'removed', issue: now, note: `Moved to ${where(now, cur)}`, wasOpen });
    } else {
      events.push({ at, kind: 'removed', issue: was, note: 'No longer a sub-issue', wasOpen });
    }
  }
  return events;
}

const isoDay = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function project(remaining: number, perWeek: number, asOf: number): Projection {
  const weeks = Math.max(1, Math.ceil(remaining / perWeek));
  return { weeks, date: weeks > MAX_PROJECTION_WEEKS ? null : isoDay(asOf + weeks * WEEK) };
}

function forecastFor(points: ScopePoint[], events: ScopeEvent[], startAt: number, asOf: number): Forecast {
  const current = points[points.length - 1];
  const remaining = current.scope - current.completed;
  if (current.scope === 0) return { status: 'empty' };
  if (remaining === 0) return { status: 'done' };
  if (asOf - startAt < MIN_HISTORY_DAYS * DAY) return { status: 'short-history' };

  const windowStart = Math.max(startAt, asOf - FORECAST_WINDOW_DAYS * DAY);
  const recent = events.filter(e => Date.parse(e.at) > windowStart);
  const count = (pred: (e: ScopeEvent) => boolean) => recent.filter(pred).length;
  const completed = count(e => e.kind === 'completed') - count(e => e.kind === 'reopened');
  const added = count(e => e.kind === 'added' && !e.fromSplit && e.issue.state === 'open');
  const removed = count(e => e.kind === 'removed' && !!e.wasOpen);
  const windowWeeks = (asOf - windowStart) / WEEK;
  const completionRate = completed / windowWeeks;
  const growthRate = Math.max(0, (added - removed) / windowWeeks);
  const startPoint = [...points].reverse().find(p => Date.parse(p.at) <= windowStart) ?? points[0];
  const credible = completed >= MIN_COMPLETIONS;

  const basis: ForecastBasis = {
    windowStart: new Date(windowStart).toISOString(),
    windowWeeks,
    completed,
    added,
    removed,
    remainingAtStart: startPoint.scope - startPoint.completed,
    completionRate,
    growthRate,
    knownScope: credible && completionRate > 0 ? project(remaining, completionRate, asOf) : null,
    withGrowth: credible && completionRate > growthRate ? project(remaining, completionRate - growthRate, asOf) : null,
  };

  let status: ForecastStatus;
  if (completionRate <= growthRate) status = completed === 0 && growthRate === 0 ? 'no-progress' : 'not-converging';
  else status = credible ? 'converging' : 'few-completions';
  return { status, basis };
}

function summarize(snaps: Indexed[], member: Member, rootId: string, asOf: number): ScopeSummary {
  const scopes = snaps.map(s => scopeOf(s, member));
  const points = snaps.map((s, i) => ({
    at: s.observedAt,
    scope: scopes[i].size,
    completed: [...scopes[i].values()].filter(issue => issue.state === 'closed').length,
  }));
  const ascending: ScopeEvent[] = [];
  for (let i = 1; i < snaps.length; i++) {
    ascending.push(...diff(snaps[i - 1], snaps[i], scopes[i - 1], scopes[i], rootId));
  }

  const baselineScope = scopes[0];
  const currentScope = scopes[scopes.length - 1];
  const current = points[points.length - 1];
  const lastAdded = new Map<string, ScopeEvent>();
  for (const e of ascending) if (e.kind === 'added') lastAdded.set(e.issue.id, e);

  const remainingIssues: RemainingIssue[] = [...currentScope.values()]
    .filter(issue => issue.state === 'open')
    .map(issue => {
      if (baselineScope.has(issue.id)) return { issue };
      const e = lastAdded.get(issue.id);
      return { issue, addedAt: e?.at, note: e?.note };
    })
    .sort((a, b) =>
      a.addedAt && b.addedAt ? b.addedAt.localeCompare(a.addedAt) || a.issue.number - b.issue.number
        : a.addedAt ? -1
        : b.addedAt ? 1
        : a.issue.number - b.issue.number,
    );

  const startAt = snaps[0].at;
  return {
    startAt: snaps[0].observedAt,
    asOf: new Date(asOf).toISOString(),
    historyDays: (asOf - startAt) / DAY,
    points,
    baseline: points[0],
    current,
    remaining: current.scope - current.completed,
    addedSinceBaseline: [...currentScope.keys()].filter(id => !baselineScope.has(id)).length,
    removedSinceBaseline: [...baselineScope.keys()].filter(id => !currentScope.has(id)).length,
    events: ascending.reverse(),
    remainingIssues,
    forecast: forecastFor(points, ascending, startAt, asOf),
  };
}

/** Summaries for the whole tree and, when the tracked issue is an epic, for
 *  each milestone-like sub-issue (a direct sub-issue with its own sub-issues). */
export function analyzeScope(t: ScopeTracking): ScopeAnalysis {
  const snaps = t.snapshots.map(index);
  if (snaps.length === 0) return { views: [], hasBreakdown: false };
  const rootId = t.root.id;
  const asOf = Math.max(Date.parse(t.checkedAt), snaps[snaps.length - 1].at);

  const groups = new Map<string, ScopeIssue>();
  for (const s of snaps) {
    for (const issue of s.byId.values()) {
      if (issue.parentId === rootId && s.parents.has(issue.id)) groups.set(issue.id, issue);
    }
  }
  const latest = snaps[snaps.length - 1];
  const groupOf = (issue: ScopeIssue, snap: Indexed) => {
    const top = topLevelId(issue, snap, rootId);
    return top && groups.has(top) ? top : null;
  };
  // Only an epic gets a per-milestone breakdown: several rollup sub-issues
  // holding most of the work. A task split into sub-issues isn't a milestone.
  const latestLeaves = [...scopeOf(latest, () => true).values()];
  const grouped = latestLeaves.filter(issue => groupOf(issue, latest)).length;
  const all: ScopeView = { id: ALL_VIEW, label: 'All sub-issues', summary: summarize(snaps, () => true, rootId, asOf) };
  if (groups.size < 2 || grouped * 2 < latestLeaves.length) return { views: [all], hasBreakdown: false };

  // Keep GitHub's sub-issue order from the latest observation.
  const order = [...latest.byId.keys()];
  const position = (id: string) => {
    const i = order.indexOf(id);
    return i === -1 ? order.length : i;
  };
  const views = [all];
  for (const g of [...groups.values()].sort((a, b) => position(a.id) - position(b.id))) {
    const first = snaps.findIndex(s => s.byId.has(g.id));
    const member: Member = (issue, snap) => groupOf(issue, snap) === g.id;
    views.push({ id: g.id, label: g.title, summary: summarize(snaps.slice(first), member, rootId, asOf) });
  }
  const other = summarize(snaps, (issue, snap) => !groupOf(issue, snap), rootId, asOf);
  if (other.points.some(p => p.scope > 0)) views.push({ id: OTHER_VIEW, label: 'Other sub-issues', summary: other });
  return { views, hasBreakdown: true };
}
