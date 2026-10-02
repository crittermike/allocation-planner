/**
 * GitHub scope tracking for projects whose URL is a GitHub issue.
 *
 * Reads the issue's sub-issue tree and every issue's history (sub-issues added
 * and removed, closed and reopened) from GitHub's GraphQL API. The browser
 * rebuilds scope over time from that history (see `trackingFromHistory` in
 * src/scope.ts), so nothing has to be collected ahead of time.
 *
 * The last complete result per issue is cached in SQLite. A failed or partial
 * refresh never replaces it; the error is reported alongside the cached data.
 */

const GITHUB_GRAPHQL = 'https://api.github.com/graphql';
/** Cached data older than this is served while a refresh runs in the background. */
const STALE_MS = 15 * 60_000;
/** Manual refreshes closer together than this reuse the latest result. */
const MIN_REFRESH_MS = 30_000;
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_ISSUES = 1500;
const MAX_DEPTH = 6;
const BATCH_SIZE = 10;
/** A milestone's parent epic is fetched too (for moves and finished milestones' pace) if it's this small. */
const MAX_CONTEXT_CHILDREN = 30;

const ISSUE_URL = /^https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/issues\/(\d+)\/?(?:[?#].*)?$/i;

export function parseIssueUrl(url) {
  const m = typeof url === 'string' ? url.trim().match(ISSUE_URL) : null;
  return m ? { owner: m[1], repo: m[2], number: Number(m[3]) } : null;
}

export const issueKey = (ref) => `${ref.owner}/${ref.repo}#${ref.number}`.toLowerCase();
const repoKey = (ref) => `${ref.owner}/${ref.repo}`.toLowerCase();

class GitHubError extends Error {
  constructor(message, kind) {
    super(message);
    this.kind = kind;
  }
}

const EVENT_TYPES = [
  'SUB_ISSUE_ADDED_EVENT',
  'SUB_ISSUE_REMOVED_EVENT',
  'PARENT_ISSUE_REMOVED_EVENT',
  'CLOSED_EVENT',
  'REOPENED_EVENT',
].join(', ');

const EVENT_FIELDS = `
  __typename
  ... on SubIssueAddedEvent { createdAt subIssue { id } }
  ... on SubIssueRemovedEvent { createdAt subIssue { id } }
  ... on ParentIssueRemovedEvent { createdAt parent { id number title } }
  ... on ClosedEvent { createdAt stateReason }
  ... on ReopenedEvent { createdAt }`;

const ISSUE_FIELDS = `
  id number title url createdAt state stateReason closedAt
  subIssues(first: 100) { totalCount pageInfo { hasNextPage endCursor } nodes { id } }
  timelineItems(first: 100, itemTypes: [${EVENT_TYPES}]) {
    pageInfo { hasNextPage endCursor }
    nodes { ${EVENT_FIELDS} }
  }`;

const closeReason = (r) => (r === 'NOT_PLANNED' ? 'not_planned' : r === 'DUPLICATE' ? 'duplicate' : 'completed');

async function graphql(token, query, variables) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(GITHUB_GRAPHQL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        authorization: `bearer ${token}`,
        'content-type': 'application/json',
        'user-agent': 'allocation-planner',
      },
      body: JSON.stringify({ query, variables }),
    });
  } catch (e) {
    throw new GitHubError(e?.name === 'AbortError' ? 'GitHub took too long to respond' : "Couldn't reach GitHub", 'network');
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 401) throw new GitHubError("GitHub didn't accept the token. It may have expired", 'auth');
  if (res.status === 403 || res.status === 429) {
    const limited = res.status === 429 || res.headers.get('x-ratelimit-remaining') === '0';
    throw new GitHubError(limited ? 'GitHub API rate limit exceeded' : 'GitHub denied the request', limited ? 'rate' : 'auth');
  }
  if (!res.ok) throw new GitHubError(`GitHub returned HTTP ${res.status}`, 'network');
  const body = await res.json();
  const errors = Array.isArray(body.errors) ? body.errors : [];
  if (errors.some(e => e.type === 'RATE_LIMITED')) throw new GitHubError('GitHub API rate limit exceeded', 'rate');
  if (!body.data) throw new GitHubError(errors[0]?.message || 'GitHub returned no data', 'graphql');
  return body;
}

function normalizeEvent(node) {
  switch (node?.__typename) {
    case 'SubIssueAddedEvent':
      return node.subIssue ? { t: 'add', at: node.createdAt, id: node.subIssue.id } : null;
    case 'SubIssueRemovedEvent':
      return node.subIssue ? { t: 'remove', at: node.createdAt, id: node.subIssue.id } : null;
    case 'ParentIssueRemovedEvent':
      return node.parent
        ? { t: 'unparent', at: node.createdAt, parent: { id: node.parent.id, number: node.parent.number, title: node.parent.title } }
        : null;
    case 'ClosedEvent':
      return { t: 'close', at: node.createdAt, reason: closeReason(node.stateReason) };
    case 'ReopenedEvent':
      return { t: 'reopen', at: node.createdAt };
    default:
      return null;
  }
}

/** Fetches any further pages of an issue's sub-issues and history. */
async function completeIssue(token, node, issue) {
  let subs = node.subIssues;
  while (subs.pageInfo.hasNextPage) {
    const res = await graphql(token, `query($id: ID!, $after: String) {
      node(id: $id) { ... on Issue { subIssues(first: 100, after: $after) { pageInfo { hasNextPage endCursor } nodes { id } } } }
    }`, { id: node.id, after: subs.pageInfo.endCursor });
    subs = res.data.node.subIssues;
    issue.children.push(...subs.nodes.filter(Boolean).map(n => n.id));
  }
  let timeline = node.timelineItems;
  while (timeline.pageInfo.hasNextPage) {
    const res = await graphql(token, `query($id: ID!, $after: String) {
      node(id: $id) { ... on Issue { timelineItems(first: 100, after: $after, itemTypes: [${EVENT_TYPES}]) {
        pageInfo { hasNextPage endCursor } nodes { ${EVENT_FIELDS} }
      } } }
    }`, { id: node.id, after: timeline.pageInfo.endCursor });
    timeline = res.data.node.timelineItems;
    issue.events.push(...timeline.nodes.map(normalizeEvent).filter(Boolean));
  }
}

/** Reads the tracked issue's tree and history. A milestone's small parent epic is
 *  included as context, so moves between milestones and finished milestones'
 *  pace are visible. Throws on any failure: results are complete or nothing. */
async function fetchHistory(token, ref) {
  const head = await graphql(token, `query($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) {
      issue(number: $number) {
        id number
        parent { id subIssuesSummary { total } }
        subIssues(first: 100) { nodes { subIssuesSummary { total } } }
      }
    }
  }`, { owner: ref.owner, name: ref.repo, number: ref.number });
  const tracked = head.data.repository?.issue;
  if (!tracked) {
    const forbidden = (head.errors ?? []).find(e => e.type === 'FORBIDDEN');
    if (forbidden) throw new GitHubError(forbidden.message || 'GitHub denied access to this issue', 'auth');
    return { unreadable: true };
  }

  const isEpic = tracked.subIssues.nodes.filter(n => n && n.subIssuesSummary.total > 0).length >= 2;
  const parent = tracked.parent;
  const contextId = parent && !isEpic && parent.subIssuesSummary.total <= MAX_CONTEXT_CHILDREN ? parent.id : tracked.id;

  const issues = new Map();
  const depth = new Map([[contextId, 0]]);
  let unreadable = 0;
  // Walk one level of the tree at a time, fetching each level's batches in parallel.
  for (let level = [contextId]; level.length > 0;) {
    const batches = [];
    for (let i = 0; i < level.length; i += BATCH_SIZE) batches.push(level.slice(i, i + BATCH_SIZE));
    const results = await Promise.all(batches.map(ids =>
      graphql(token, `query($ids: [ID!]!) { nodes(ids: $ids) { ... on Issue { ${ISSUE_FIELDS} } } }`, { ids })));
    const next = [];
    for (let b = 0; b < batches.length; b++) {
      for (let i = 0; i < batches[b].length; i++) {
        const node = results[b].data.nodes?.[i];
        if (!node?.id) {
          if (batches[b][i] === contextId) return { unreadable: true };
          // Deleted or hidden issues from history. Hidden current sub-issues are counted below.
          continue;
        }
        const issue = {
          id: node.id,
          number: node.number,
          title: node.title,
          url: node.url,
          createdAt: node.createdAt,
          state: node.state === 'CLOSED' ? 'closed' : 'open',
          ...(node.state === 'CLOSED' ? { closeReason: closeReason(node.stateReason), closedAt: node.closedAt } : {}),
          children: node.subIssues.nodes.filter(Boolean).map(n => n.id),
          events: node.timelineItems.nodes.map(normalizeEvent).filter(Boolean),
        };
        await completeIssue(token, node, issue);
        unreadable += Math.max(0, node.subIssues.totalCount - issue.children.length);
        issues.set(issue.id, issue);

        const linked = new Set(issue.children);
        for (const e of issue.events) if (e.t === 'add' || e.t === 'remove') linked.add(e.id);
        const childDepth = (depth.get(issue.id) ?? 0) + 1;
        for (const id of linked) {
          if (depth.has(id) || childDepth > MAX_DEPTH) continue;
          depth.set(id, childDepth);
          next.push(id);
        }
      }
    }
    if (depth.size > MAX_ISSUES) {
      throw new GitHubError(`This issue has more than ${MAX_ISSUES} issues below it`, 'too_big');
    }
    level = next;
  }

  return {
    history: {
      fetchedAt: new Date().toISOString(),
      root: { id: tracked.id, number: tracked.number },
      contextId,
      issues: [...issues.values()],
      unreadable,
    },
  };
}

export function createScopeService({ db, token, repos }) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS scope_cache (
      issue_key    TEXT PRIMARY KEY,
      history      TEXT,
      fetched_at   INTEGER,
      attempted_at INTEGER NOT NULL,
      unreadable   INTEGER NOT NULL DEFAULT 0,
      error        TEXT
    );
  `);
  const getRow = db.prepare('SELECT * FROM scope_cache WHERE issue_key = ?');
  const saveGood = db.prepare(`
    INSERT INTO scope_cache (issue_key, history, fetched_at, attempted_at, unreadable, error)
    VALUES (@key, @history, @now, @now, 0, NULL)
    ON CONFLICT(issue_key) DO UPDATE SET history = @history, fetched_at = @now, attempted_at = @now, unreadable = 0, error = NULL
  `);
  const saveUnreadable = db.prepare(`
    INSERT INTO scope_cache (issue_key, history, fetched_at, attempted_at, unreadable, error)
    VALUES (@key, NULL, NULL, @now, 1, NULL)
    ON CONFLICT(issue_key) DO UPDATE SET history = NULL, fetched_at = NULL, attempted_at = @now, unreadable = 1, error = NULL
  `);
  const saveError = db.prepare(`
    INSERT INTO scope_cache (issue_key, history, fetched_at, attempted_at, unreadable, error)
    VALUES (@key, NULL, NULL, @now, 0, @error)
    ON CONFLICT(issue_key) DO UPDATE SET attempted_at = @now, error = @error
  `);

  const allowed = (repos ?? []).map(r => r.trim().toLowerCase()).filter(Boolean);
  const inflight = new Map();

  const refresh = (ref) => {
    const key = issueKey(ref);
    let pending = inflight.get(key);
    if (!pending) {
      pending = (async () => {
        const now = Date.now();
        try {
          const result = await fetchHistory(token, ref);
          if (result.unreadable) saveUnreadable.run({ key, now });
          else saveGood.run({ key, now, history: JSON.stringify(result.history) });
        } catch (e) {
          const message = e instanceof GitHubError ? e.message : 'Unexpected error while reading GitHub';
          if (!(e instanceof GitHubError)) console.error('[scope] refresh failed', key, e);
          saveError.run({ key, now, error: message });
        }
      })().finally(() => inflight.delete(key));
      inflight.set(key, pending);
    }
    return pending;
  };

  const respond = (row, refreshing) => {
    if (row.history) {
      const failedLater = row.error && row.attempted_at > row.fetched_at;
      return {
        status: 'ready',
        history: JSON.parse(row.history),
        checkedAt: new Date(row.fetched_at).toISOString(),
        refreshError: failedLater ? { at: new Date(row.attempted_at).toISOString(), message: row.error } : null,
        refreshing,
      };
    }
    if (row.unreadable) return { status: 'unreadable', at: new Date(row.attempted_at).toISOString() };
    return { status: 'error', message: row.error || 'No data yet', at: new Date(row.attempted_at).toISOString(), refreshing };
  };

  return {
    enabled: Boolean(token),
    repos: allowed,
    allows: (ref) => allowed.length === 0 || allowed.includes(repoKey(ref)),

    /** Cached data, refreshed in the background when stale. Waits only if nothing good is cached. */
    async get(ref) {
      const key = issueKey(ref);
      let row = getRow.get(key);
      const age = row ? Date.now() - row.attempted_at : Infinity;
      if (!row || (!row.history && age > MIN_REFRESH_MS)) {
        await refresh(ref);
        row = getRow.get(key);
      } else if (row.history && age > STALE_MS && !inflight.has(key)) {
        refresh(ref);
      }
      return respond(row, inflight.has(key));
    },

    /** Refreshes now, unless the last attempt was moments ago. */
    async refresh(ref) {
      const key = issueKey(ref);
      const row = getRow.get(key);
      if (!row || Date.now() - row.attempted_at > MIN_REFRESH_MS || inflight.has(key)) await refresh(ref);
      return respond(getRow.get(key), false);
    },
  };
}
