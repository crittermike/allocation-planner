const STORAGE_KEY = 'allocation-planner.visited.v1';

export type VisitedRecord = {
  slug: string;
  visitedAt: number;
};

type Stored = Record<string, number>;

function read(): Stored {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed as Stored;
    return {};
  } catch {
    return {};
  }
}

function write(s: Stored) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // ignore quota / privacy mode failures
  }
}

export function recordVisit(slug: string) {
  if (!slug) return;
  const s = read();
  s[slug] = Date.now();
  write(s);
}

export function getVisited(): VisitedRecord[] {
  const s = read();
  return Object.entries(s)
    .map(([slug, visitedAt]) => ({ slug, visitedAt }))
    .sort((a, b) => b.visitedAt - a.visitedAt);
}

export function forgetVisit(slug: string) {
  const s = read();
  if (slug in s) {
    delete s[slug];
    write(s);
  }
}
