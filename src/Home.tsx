import { useEffect, useMemo, useState } from 'react';
import { navigate } from './router';
import type { PlanSummary } from './types';
import { forgetVisit, getVisited } from './visited';

const slugifyClient = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

const fmtTime = (ms: number) => {
  const d = new Date(ms);
  const now = Date.now();
  const dayMs = 86400000;
  const diff = now - ms;
  if (diff < 60_000) return 'just now';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < dayMs) return `${Math.floor(diff / 3600_000)}h ago`;
  if (diff < 7 * dayMs) return `${Math.floor(diff / dayMs)}d ago`;
  return d.toLocaleDateString();
};

export function Home() {
  const [name, setName] = useState('');
  const [plans, setPlans] = useState<PlanSummary[] | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [visited, setVisited] = useState(() => getVisited());

  useEffect(() => {
    let alive = true;
    fetch('/api/plans')
      .then(r => r.json())
      .then(data => { if (alive) setPlans(data); })
      .catch(() => { if (alive) setPlans([]); });
    return () => { alive = false; };
  }, []);

  const myPlans = useMemo(() => {
    if (!plans) return null;
    const visitedAtBySlug = new Map(visited.map(v => [v.slug, v.visitedAt]));
    return plans
      .filter(p => visitedAtBySlug.has(p.slug))
      .sort((a, b) => (visitedAtBySlug.get(b.slug) ?? 0) - (visitedAtBySlug.get(a.slug) ?? 0));
  }, [plans, visited]);

  const missingVisited = useMemo(() => {
    if (!plans) return [] as string[];
    const known = new Set(plans.map(p => p.slug));
    return visited.map(v => v.slug).filter(s => !known.has(s));
  }, [plans, visited]);

  useEffect(() => {
    if (missingVisited.length === 0) return;
    missingVisited.forEach(forgetVisit);
    setVisited(getVisited());
  }, [missingVisited]);

  const slugPreview = slugifyClient(name);

  const create = async () => {
    if (!name.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const r = await fetch('/api/plans', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (!r.ok) throw new Error(await r.text());
      const { slug } = await r.json();
      navigate('/' + slug);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to create plan');
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen w-full">
      <div className="mx-auto flex min-h-screen max-w-2xl flex-col items-stretch gap-10 px-6 py-16">
        <header className="text-center">
          <h1 className="text-[28px] font-semibold tracking-tight text-ink-900">
            Allocation Planner
          </h1>
          <p className="mt-1.5 text-[14px] text-ink-500">
            Lightweight team allocation charts. Live-synced — share the URL with your team.
          </p>
        </header>

        <section className="rounded-2xl border border-ink-200 bg-white p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-12px_rgba(15,23,42,0.08)]">
          <label className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-500">
            Create a new plan
          </label>
          <form
            onSubmit={e => { e.preventDefault(); create(); }}
            className="flex flex-col gap-3 sm:flex-row sm:items-center"
          >
            <input
              autoFocus
              placeholder="e.g. Q4 Big Orca Plan"
              value={name}
              onChange={e => setName(e.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-ink-200 bg-white px-3.5 py-2.5 text-[15px] outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-200"
            />
            <button
              type="submit"
              disabled={!name.trim() || submitting}
              className="inline-flex h-[42px] items-center justify-center gap-1 rounded-lg bg-gradient-to-b from-brand-600 to-brand-700 px-5 text-[14px] font-semibold text-white shadow-sm transition enabled:hover:from-brand-700 enabled:active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? 'Creating…' : 'Create plan'}
            </button>
          </form>
          {slugPreview && (
            <div className="mt-2.5 text-[12px] text-ink-500">
              URL preview: <span className="rounded bg-ink-100 px-1.5 py-0.5 font-mono text-ink-700">/{slugPreview}</span>
            </div>
          )}
          {error && (
            <div className="mt-2.5 text-[12px] text-rose-600">{error}</div>
          )}
        </section>

        <section>
          <h2 className="mb-3 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-500">
            Recent plans
          </h2>
          <div className="overflow-hidden rounded-2xl border border-ink-200 bg-white shadow-sm">
            {plans === null && (
              <div className="px-5 py-6 text-center text-[13px] text-ink-500">Loading…</div>
            )}
            {myPlans && myPlans.length === 0 && (
              <div className="px-5 py-8 text-center text-[13px] text-ink-500">
                No recent plans. Plans you open will show up here.
              </div>
            )}
            {myPlans && myPlans.length > 0 && (
              <ul className="divide-y divide-ink-100">
                {myPlans.map(p => (
                  <li key={p.slug}>
                    <a
                      href={'/' + p.slug}
                      onClick={e => { e.preventDefault(); navigate('/' + p.slug); }}
                      className="flex items-center gap-3 px-5 py-3 transition hover:bg-ink-50"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[14px] font-medium text-ink-900">{p.name}</div>
                        <div className="truncate font-mono text-[11px] text-ink-500">/{p.slug}</div>
                      </div>
                      <div className="shrink-0 text-[12px] text-ink-500">{fmtTime(p.updated_at)}</div>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <footer className="mt-auto pt-6 text-center text-[11px] text-ink-400">
          Anyone with the link can view and edit. No login required.
        </footer>
      </div>
    </div>
  );
}
