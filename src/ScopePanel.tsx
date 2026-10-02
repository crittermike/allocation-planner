import { useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ALL_VIEW,
  FORECAST_WINDOW_DAYS,
  MIN_COMPLETIONS,
  MIN_HISTORY_DAYS,
  analyzeScope,
  type ForecastBasis,
  type ForecastStatus,
  type GitHubIssueRef,
  type Projection,
  type RemainingIssue,
  type ScopeEvent,
  type ScopeIssue,
  type ScopeSummary,
  type ScopeTracking,
  type ScopeView,
} from './scope';
import { DEMO_SCENARIOS, SCOPE_DEMO_ENABLED, defaultDemoScenario, demoScope, type DemoScenario } from './scopeDemo';

/** Until the GitHub connector exists, the panel can only show demo data, so it's dev-only. */
export const scopeTrackingEnabled = SCOPE_DEMO_ENABLED;

const MINUTE = 60_000;
const DAY = 86_400_000;
const WEEK = 7 * DAY;

/* ---------- formatting ---------- */

const parseDay = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
};
const startOfDay = (ms: number) => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};
const mondayOf = (ms: number) => {
  const d = new Date(startOfDay(ms));
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  return d.getTime();
};
const fmtDay = (ms: number) => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const fmtWhen = (ms: number) =>
  new Date(ms).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const fmtRate = (n: number) => `${Math.round(n * 10) / 10}`;

function ago(ms: number): string {
  const minutes = Math.round((Date.now() - ms) / MINUTE);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${plural(Math.round(hours / 24), 'day')} ago`;
}

function dayLabel(ms: number): string {
  const diff = Math.round((startOfDay(Date.now()) - startOfDay(ms)) / DAY);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return fmtDay(ms);
}

/* ---------- status ---------- */

type Tone = 'good' | 'bad' | 'neutral';

const STATUS: Record<ForecastStatus, { label: string; tone: Tone }> = {
  converging: { label: 'Converging', tone: 'good' },
  'not-converging': { label: 'Not converging', tone: 'bad' },
  'no-progress': { label: 'No recent progress', tone: 'neutral' },
  'few-completions': { label: 'Too early to forecast', tone: 'neutral' },
  'short-history': { label: 'Too early to forecast', tone: 'neutral' },
  done: { label: 'Done', tone: 'good' },
  empty: { label: 'No sub-issues', tone: 'neutral' },
};
const TONE_PILL: Record<Tone, string> = {
  good: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  bad: 'border-rose-200 bg-rose-50 text-rose-700',
  neutral: 'border-ink-200 bg-ink-50 text-ink-600',
};
const TONE_DOT: Record<Tone, string> = { good: 'bg-emerald-500', bad: 'bg-rose-500', neutral: 'bg-ink-400' };

function explain(s: ScopeSummary, rootNumber: number): string {
  const b = s.forecast.basis;
  const window = b ? plural(Math.round(b.windowWeeks), 'week') : '';
  const facts = b
    ? `In the last ${window}: ${b.completed} completed, ${b.added} added, ${b.removed} removed. ` +
      `Remaining work went from ${b.remainingAtStart} to ${s.remaining}.`
    : '';
  switch (s.forecast.status) {
    case 'empty':
      return `#${rootNumber} has no sub-issues. Scope is counted from sub-issues, so tracking starts when they're added.`;
    case 'done':
      return `All ${plural(s.current.scope, 'tracked issue')} are closed. New sub-issues will show up here as remaining work.`;
    case 'short-history':
      return s.points.length === 1 && s.historyDays < 1
        ? `Baseline recorded ${ago(Date.parse(s.startAt))} with ${plural(s.current.scope, 'issue')}. ` +
            `A forecast needs ${MIN_HISTORY_DAYS} days of history.`
        : `Tracking for ${plural(Math.floor(s.historyDays), 'day')}. A forecast needs ${MIN_HISTORY_DAYS} days of history.`;
    case 'few-completions':
      return `${facts} A forecast needs at least ${MIN_COMPLETIONS} completions in that window.`;
    case 'no-progress':
      return `Nothing was completed or added in the last ${window}.`;
    case 'not-converging':
    case 'converging':
      return facts;
  }
}

/* ---------- panel ---------- */

/** Demo scenario picked per URL, kept while the page is open. */
const chosenScenarios = new Map<string, DemoScenario>();

export function ScopePanel({ issue, releaseDate }: { issue: GitHubIssueRef; releaseDate?: string }) {
  const headingId = useId();
  const [scenario, setScenario] = useState<DemoScenario>(
    () => chosenScenarios.get(issue.url) ?? defaultDemoScenario(issue),
  );
  const load = useMemo(() => demoScope(issue, scenario), [issue.url, scenario]);
  const tracking = load.status === 'ready' ? load.tracking : null;

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <h3 id={headingId} className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-500">Scope</h3>
        {tracking && (
          <span className="text-[11.5px] text-ink-500">
            Checked {ago(Date.parse(tracking.checkedAt))}
            {tracking.snapshots.length > 0 && ` · tracking since ${fmtDay(Date.parse(tracking.snapshots[0].observedAt))}`}
          </span>
        )}
        <span className="flex-1" />
        <label
          className="inline-flex items-center gap-1.5 rounded-full border border-amber-100 bg-amber-50 py-0.5 pl-2.5 pr-0.5 text-[11px] font-semibold text-amber-800"
          title="Fictional data for prototyping. Nothing here comes from GitHub."
        >
          Demo data
          <select
            value={scenario}
            onChange={e => {
              const next = e.target.value as DemoScenario;
              chosenScenarios.set(issue.url, next);
              setScenario(next);
            }}
            className="h-6 rounded-full border border-amber-100 bg-white px-1.5 text-[11px] font-medium text-ink-800 outline-none focus:ring-2 focus:ring-brand-200"
          >
            {DEMO_SCENARIOS.map(s => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
        </label>
      </div>
      {load.status === 'unreadable' ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-3 text-[12.5px] text-rose-700">
          <div className="font-semibold">Can't read {issue.owner}/{issue.repo}#{issue.number}</div>
          <p className="mt-1 leading-relaxed">
            The planner's GitHub access doesn't cover this repo, or the issue doesn't exist. Tracking starts
            automatically once the issue can be read. Last tried {ago(Date.parse(load.at))}.
          </p>
        </div>
      ) : (
        <ScopeDetails key={scenario} tracking={load.tracking} issue={issue} releaseDate={releaseDate} />
      )}
    </section>
  );
}

function ScopeDetails({ tracking, issue, releaseDate }: {
  tracking: ScopeTracking;
  issue: GitHubIssueRef;
  releaseDate?: string;
}) {
  const analysis = useMemo(() => analyzeScope(tracking), [tracking]);
  const [viewId, setViewId] = useState(ALL_VIEW);
  const view = analysis.views.find(v => v.id === viewId) ?? analysis.views[0];
  if (!view) return <p className="text-[12.5px] text-ink-500">Waiting for the first snapshot from GitHub…</p>;

  const s = view.summary;
  const demo = tracking.source === 'demo';
  // The release date belongs to the whole project, not to individual milestones.
  const target = view.id === ALL_VIEW ? releaseDate : undefined;
  const hasScope = s.forecast.status !== 'empty';

  return (
    <>
      {tracking.refreshError && (
        <div role="status" className="rounded-lg border border-amber-100 bg-amber-50 px-3.5 py-2.5 text-[12.5px] leading-relaxed text-amber-800">
          <span className="font-semibold">Couldn't refresh from GitHub</span> ({tracking.refreshError.message},
          last attempt {ago(Date.parse(tracking.refreshError.at))}). Showing data last confirmed{' '}
          {fmtWhen(Date.parse(tracking.checkedAt))}.
        </div>
      )}
      {analysis.hasBreakdown && <Breakdown views={analysis.views} selectedId={view.id} onSelect={setViewId} />}
      <Verdict view={view} showLabel={analysis.hasBreakdown} rootNumber={issue.number} />
      {hasScope && <Stats summary={s} />}
      {hasScope && (s.points.length > 1 || s.historyDays >= 1) && <BurnUpChart summary={s} target={target} />}
      {s.forecast.basis && (
        <ForecastDetails summary={s} basis={s.forecast.basis} target={target} showTarget={view.id === ALL_VIEW} />
      )}
      {s.events.length > 0 && <ChangeList key={`changes-${view.id}`} events={s.events} demo={demo} />}
      {s.remainingIssues.length > 0 && (
        <RemainingList key={`remaining-${view.id}`} items={s.remainingIssues} demo={demo} />
      )}
    </>
  );
}

/* ---------- milestone breakdown ---------- */

function Breakdown({ views, selectedId, onSelect }: {
  views: ScopeView[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-ink-200">
      <table className="w-full table-fixed text-[12.5px]">
        <colgroup>
          <col />
          <col className="w-[104px]" />
          <col className="w-[74px]" />
          <col className="w-[156px]" />
        </colgroup>
        <thead>
          <tr className="border-b border-ink-200 bg-ink-50/60 text-left text-[10px] font-semibold uppercase tracking-[0.06em] text-ink-500">
            <th scope="col" className="px-3 py-1.5">Milestone</th>
            <th scope="col" className="px-2 py-1.5">Done</th>
            <th scope="col" className="px-2 py-1.5" title="Issues added and removed since tracking started">Changed</th>
            <th scope="col" className="px-2 py-1.5">Status</th>
          </tr>
        </thead>
        <tbody>
          {views.map(v => {
            const s = v.summary;
            const selected = v.id === selectedId;
            const changed = s.addedSinceBaseline || s.removedSinceBaseline
              ? `+${s.addedSinceBaseline} −${s.removedSinceBaseline}`
              : '—';
            return (
              <tr
                key={v.id}
                onClick={() => onSelect(v.id)}
                className={'cursor-pointer border-b border-ink-100 transition last:border-b-0 ' + (selected ? 'bg-brand-50' : 'hover:bg-ink-50')}
              >
                <td className="px-3 py-1.5">
                  <button
                    type="button"
                    aria-pressed={selected}
                    onClick={e => { e.stopPropagation(); onSelect(v.id); }}
                    className={'block w-full truncate text-left outline-none focus-visible:underline ' + (v.id === ALL_VIEW ? 'font-semibold text-ink-900' : 'text-ink-800')}
                  >
                    {v.label}
                  </button>
                </td>
                <td className="px-2 py-1.5"><Progress done={s.current.completed} total={s.current.scope} /></td>
                <td className="px-2 py-1.5 tabular-nums text-ink-600">{changed}</td>
                <td className="px-2 py-1.5"><StatusPill status={s.forecast.status} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Progress({ done, total }: { done: number; total: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-10 shrink-0 overflow-hidden rounded-full bg-ink-100">
        <div className="h-full rounded-full bg-emerald-500" style={{ width: `${total > 0 ? (done / total) * 100 : 0}%` }} />
      </div>
      <span className="tabular-nums text-ink-600">{done}/{total}</span>
    </div>
  );
}

function StatusPill({ status }: { status: ForecastStatus }) {
  const { label, tone } = STATUS[status];
  return (
    <span className={'inline-flex max-w-full items-center gap-1.5 truncate rounded-full border px-2 py-[1px] text-[11px] font-medium ' + TONE_PILL[tone]}>
      <span className={'h-1.5 w-1.5 shrink-0 rounded-full ' + TONE_DOT[tone]} aria-hidden />
      {label}
    </span>
  );
}

/* ---------- verdict + stats ---------- */

function Verdict({ view, showLabel, rootNumber }: { view: ScopeView; showLabel: boolean; rootNumber: number }) {
  const s = view.summary;
  const { label, tone } = STATUS[s.forecast.status];
  const headline = s.forecast.status === 'done'
    ? 'All tracked work is done'
    : s.forecast.status === 'empty' ? 'No sub-issues yet' : label;
  return (
    <div>
      {showLabel && <div className="mb-1 truncate text-[12px] font-semibold text-ink-600">{view.label}</div>}
      <div className="flex items-center gap-2">
        <span className={'h-2.5 w-2.5 shrink-0 rounded-full ' + TONE_DOT[tone]} aria-hidden />
        <span className="text-[16px] font-semibold tracking-tight text-ink-900">{headline}</span>
      </div>
      <p className="mt-1 text-[12.5px] leading-relaxed text-ink-600">{explain(s, rootNumber)}</p>
    </div>
  );
}

function Stats({ summary: s }: { summary: ScopeSummary }) {
  const grew = s.baseline.scope !== s.current.scope;
  const items = [
    { label: 'Scope', value: grew ? `${s.baseline.scope} → ${s.current.scope}` : `${s.current.scope}`, hint: grew ? 'baseline → now' : 'same as baseline' },
    { label: 'Added / removed', value: `+${s.addedSinceBaseline} / −${s.removedSinceBaseline}`, hint: 'since baseline' },
    { label: 'Completed', value: `${s.current.completed}`, hint: `of ${s.current.scope}` },
    { label: 'Remaining', value: `${s.remaining}`, hint: 'open' },
  ];
  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {items.map(item => (
        <div key={item.label} className="rounded-lg border border-ink-200 px-3 py-2">
          <dt className="text-[10px] font-semibold uppercase tracking-[0.06em] text-ink-500">{item.label}</dt>
          <dd className="mt-0.5 text-[17px] font-semibold tabular-nums tracking-tight text-ink-900">{item.value}</dd>
          <dd className="text-[11px] text-ink-500">{item.hint}</dd>
        </div>
      ))}
    </dl>
  );
}

/* ---------- burn-up chart ---------- */

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.getBoundingClientRect().width);
    const observer = new ResizeObserver(entries => setWidth(entries[0].contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

function niceScale(peak: number) {
  const raw = (peak * 1.1) / 5;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const multiples = magnitude >= 10 ? [1, 2, 2.5, 5, 10] : [1, 2, 5, 10];
  const step = Math.max(1, multiples.map(m => m * magnitude).find(st => st >= raw) ?? raw);
  return { step, max: Math.ceil((peak * 1.1) / step) * step };
}

const CHART_H = 210;
const PAD = { l: 30, r: 18, t: 22, b: 22 };

function BurnUpChart({ summary: s, target }: { summary: ScopeSummary; target?: string }) {
  const [boxRef, width] = useWidth<HTMLDivElement>();
  const [hoverX, setHoverX] = useState<number | null>(null);

  const t0 = Date.parse(s.startAt);
  const tNow = Date.parse(s.asOf);
  const b = s.forecast.basis;
  // Trend lines only when the forecast is credible enough to give a date.
  const trend = !!b?.knownScope;
  const c = b?.completionRate ?? 0;
  const g = b?.growthRate ?? 0;
  const cur = s.current;
  const knownAt = trend && c > 0 ? tNow + (s.remaining / c) * WEEK : null;
  const meetAt = trend && c > g ? tNow + (s.remaining / (c - g)) * WEEK : null;
  const targetAt = target ? parseDay(target) : null;

  const history = Math.max(tNow - t0, DAY);
  // Show at least as much future as history, and always the target within 6 months.
  const targetAhead = targetAt && targetAt > tNow && targetAt - tNow <= 26 * WEEK ? targetAt + 3 * DAY : 0;
  const cap = Math.max(tNow + Math.max(history, 6 * WEEK), targetAhead);
  const wanted = [tNow + history * 0.03];
  if (targetAt && targetAt > tNow) wanted.push(targetAt + 3 * DAY);
  if (trend) wanted.push(meetAt ? meetAt + 4 * DAY : cap);
  if (knownAt) wanted.push(knownAt + 4 * DAY);
  const tEnd = Math.min(cap, Math.max(...wanted));

  const scopeAt = (t: number) => cur.scope + (g * (t - tNow)) / WEEK;
  const doneAt = (t: number) => cur.completed + (c * (t - tNow)) / WEEK;
  const trendEnd = meetAt ? Math.min(meetAt, tEnd) : tEnd;
  const peak = Math.max(...s.points.map(p => p.scope), trend ? scopeAt(trendEnd) : 0, 1);
  const { max: yMax, step: yStep } = niceScale(peak);

  const plotW = Math.max(1, width - PAD.l - PAD.r);
  const plotH = CHART_H - PAD.t - PAD.b;
  const x = (t: number) => PAD.l + ((t - t0) / (tEnd - t0)) * plotW;
  const y = (v: number) => PAD.t + plotH - (v / yMax) * plotH;

  const series = (key: 'scope' | 'completed') => {
    let d = `M${x(Date.parse(s.points[0].at))},${y(s.points[0][key])}`;
    for (const p of s.points.slice(1)) d += `H${x(Date.parse(p.at))}V${y(p[key])}`;
    return `${d}H${x(tNow)}`;
  };
  const donePath = series('completed');

  const xTicks: number[] = [];
  const maxTicks = Math.max(2, Math.floor(plotW / 74));
  const every = [1, 2, 4, 8, 13, 26].find(k => (tEnd - t0) / WEEK / k <= maxTicks) ?? 52;
  const tick = new Date(mondayOf(t0));
  if (tick.getTime() < t0) tick.setDate(tick.getDate() + 7);
  while (tick.getTime() <= tEnd) {
    xTicks.push(tick.getTime());
    tick.setDate(tick.getDate() + 7 * every);
  }
  const yTicks: number[] = [];
  for (let v = 0; v <= yMax; v += yStep) yTicks.push(v);

  const markers: { t: number; v: number; label: string }[] = [];
  if (knownAt && knownAt <= tEnd) markers.push({ t: knownAt, v: cur.scope, label: fmtDay(knownAt) });
  if (meetAt && g > 0 && meetAt <= tEnd) markers.push({ t: meetAt, v: scopeAt(meetAt), label: fmtDay(meetAt) });
  if (markers.length === 2 && Math.abs(x(markers[0].t) - x(markers[1].t)) < 48) markers.shift();

  const hoverT = hoverX == null ? null : t0 + ((hoverX - PAD.l) / plotW) * (tEnd - t0);
  const hovered = hoverT == null
    ? null
    : [...s.points].reverse().find(p => Date.parse(p.at) <= hoverT) ?? s.points[0];
  const clampLabel = (px: number) => Math.min(Math.max(px, PAD.l + 34), width - PAD.r - 34);

  return (
    <figure className="m-0">
      <div ref={boxRef} className="relative" style={{ height: CHART_H }}>
        {width > 0 && (
          <svg width={width} height={CHART_H} role="img" aria-label="Scope and completed issues over time" className="block overflow-visible">
            {yTicks.map(v => (
              <g key={v}>
                <line x1={PAD.l} x2={width - PAD.r} y1={y(v)} y2={y(v)} className="stroke-ink-100" />
                <text x={PAD.l - 6} y={y(v) + 3} textAnchor="end" className="fill-ink-400 text-[10px] tabular-nums">{v}</text>
              </g>
            ))}
            {xTicks.map(t => (
              <text key={t} x={x(t)} y={CHART_H - 6} textAnchor="middle" className="fill-ink-400 text-[10px]">{fmtDay(t)}</text>
            ))}

            {tEnd > tNow + DAY && (
              <line x1={x(tNow)} x2={x(tNow)} y1={PAD.t} y2={PAD.t + plotH} className="stroke-ink-200" />
            )}

            <line
              x1={x(t0)} x2={x(tNow)} y1={y(s.baseline.scope)} y2={y(s.baseline.scope)}
              className="stroke-ink-400" strokeDasharray="2 3"
            />

            <path d={`${donePath}V${y(0)}H${x(t0)}Z`} className="fill-emerald-500/15" />
            <path d={donePath} fill="none" className="stroke-emerald-500" strokeWidth={2} strokeLinejoin="round" />
            <path d={series('scope')} fill="none" className="stroke-ink-700" strokeWidth={2} strokeLinejoin="round" />

            {trend && (
              <g fill="none" strokeWidth={1.5} strokeDasharray="4 4">
                <line x1={x(tNow)} y1={y(cur.completed)} x2={x(trendEnd)} y2={y(doneAt(trendEnd))} className="stroke-emerald-500" />
                {knownAt && (
                  <line
                    x1={x(tNow)} y1={y(cur.scope)} x2={x(Math.min(knownAt, tEnd))} y2={y(cur.scope)}
                    className="stroke-ink-400"
                  />
                )}
                {g > 0 && (
                  <line x1={x(tNow)} y1={y(cur.scope)} x2={x(trendEnd)} y2={y(scopeAt(trendEnd))} className="stroke-ink-700" />
                )}
              </g>
            )}
            {markers.map(m => (
              <g key={m.t}>
                <circle cx={x(m.t)} cy={y(m.v)} r={3.5} className="fill-white stroke-emerald-600" strokeWidth={2} />
                <text x={x(m.t)} y={y(m.v) - 8} textAnchor="middle" className="fill-ink-600 text-[10px] font-semibold">
                  {m.label}
                </text>
              </g>
            ))}

            {targetAt != null && targetAt >= t0 && targetAt <= tEnd && (
              <g>
                <line x1={x(targetAt)} x2={x(targetAt)} y1={PAD.t - 4} y2={PAD.t + plotH} className="stroke-brand-500" strokeDasharray="3 3" />
                <text x={clampLabel(x(targetAt))} y={PAD.t - 9} textAnchor="middle" className="fill-brand-500 text-[10px] font-semibold">
                  Target {fmtDay(targetAt)}
                </text>
              </g>
            )}
            {targetAt != null && targetAt > tEnd && (
              <text x={width - PAD.r} y={PAD.t - 9} textAnchor="end" className="fill-brand-500 text-[10px] font-semibold">
                Target {fmtDay(targetAt)} →
              </text>
            )}

            {hovered && hoverX != null && (
              <line x1={hoverX} x2={hoverX} y1={PAD.t} y2={PAD.t + plotH} className="stroke-ink-300" />
            )}
            <rect
              x={PAD.l}
              y={PAD.t}
              width={Math.max(0, x(tNow) - PAD.l)}
              height={plotH}
              fill="transparent"
              onMouseMove={e => setHoverX(e.clientX - e.currentTarget.ownerSVGElement!.getBoundingClientRect().left)}
              onMouseLeave={() => setHoverX(null)}
            />
          </svg>
        )}
        {hovered && hoverX != null && hoverT != null && (
          <div
            className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 whitespace-nowrap rounded-md border border-ink-200 bg-white px-2 py-1 text-[11px] text-ink-700 shadow-md"
            style={{ left: Math.min(Math.max(hoverX, 90), width - 90) }}
          >
            <span className="font-semibold text-ink-900">{fmtDay(hoverT)}</span>
            {' · '}Scope {hovered.scope} · Done {hovered.completed} · Remaining {hovered.scope - hovered.completed}
          </div>
        )}
      </div>
      <figcaption className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-ink-500">
        <LegendItem swatch={<span className="h-0.5 w-4 rounded bg-ink-700" />}>Scope</LegendItem>
        <LegendItem swatch={<span className="h-2.5 w-4 border-t-2 border-emerald-500 bg-emerald-500/15" />}>Completed</LegendItem>
        <LegendItem swatch={<span className="w-4 border-t border-dashed border-ink-400" />}>Baseline</LegendItem>
        {trend && <LegendItem swatch={<span className="w-4 border-t-2 border-dotted border-emerald-500" />}>Trend</LegendItem>}
        {targetAt != null && <LegendItem swatch={<span className="h-3 border-l border-dashed border-brand-500" />}>Target</LegendItem>}
      </figcaption>
    </figure>
  );
}

function LegendItem({ swatch, children }: { swatch: ReactNode; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-flex w-4 items-center justify-center" aria-hidden>{swatch}</span>
      {children}
    </span>
  );
}

/* ---------- forecast ---------- */

function projectionText(p: Projection): string {
  if (!p.date) return 'More than a year';
  return `~${plural(p.weeks, 'week')} · week of ${fmtDay(mondayOf(parseDay(p.date)))}`;
}

function versusTarget(p: Projection | null, target?: string): { text: string; tone: Tone } | null {
  if (!p?.date || !target) return null;
  const weeks = Math.round((mondayOf(parseDay(p.date)) - mondayOf(parseDay(target))) / WEEK);
  if (weeks === 0) return { text: 'Same week as target', tone: 'neutral' };
  return weeks > 0
    ? { text: `${plural(weeks, 'week')} after target`, tone: 'bad' }
    : { text: `${plural(-weeks, 'week')} before target`, tone: 'good' };
}

function ForecastDetails({ summary: s, basis: b, target, showTarget }: {
  summary: ScopeSummary;
  basis: ForecastBasis;
  target?: string;
  showTarget: boolean;
}) {
  const credible = b.completed >= MIN_COMPLETIONS;
  const needMore = `Needs ${MIN_COMPLETIONS} completions in ${plural(Math.round(b.windowWeeks), 'week')}`;
  const known = b.knownScope ? projectionText(b.knownScope) : credible ? 'No completions to project from' : needMore;
  const growing = b.withGrowth
    ? projectionText(b.withGrowth)
    : b.completionRate <= b.growthRate && (b.completionRate > 0 || b.growthRate > 0)
      ? `Doesn't finish: scope grows ${b.completionRate < b.growthRate ? 'faster than' : 'as fast as'} work is completed`
      : credible ? '—' : needMore;
  const rows: { label: string; value: string; aside: { text: string; tone: Tone } | null }[] = [
    { label: 'If no more scope is added', value: known, aside: versusTarget(b.knownScope, target) },
    { label: 'If scope keeps growing', value: growing, aside: versusTarget(b.withGrowth, target) },
  ];
  if (showTarget) {
    rows.push({ label: 'Target', value: target ? `${fmtDay(parseDay(target))} · project release date` : 'No release date set', aside: null });
  }

  return (
    <div className="rounded-lg border border-ink-200">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 border-b border-ink-100 px-3 py-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-ink-500">Forecast</span>
        <span className="text-[11px] text-ink-500">
          Completing {fmtRate(b.completionRate)}/week · scope growing {fmtRate(b.growthRate)}/week ·{' '}
          {fmtDay(Date.parse(b.windowStart))}–{fmtDay(Date.parse(s.asOf))}
        </span>
      </div>
      <dl className="divide-y divide-ink-100 text-[12.5px]">
        {rows.map(row => (
          <div key={row.label} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3 py-2">
            <dt className="w-[178px] shrink-0 text-ink-600">{row.label}</dt>
            <dd className="min-w-0 flex-1 font-medium text-ink-900">{row.value}</dd>
            {row.aside && (
              <dd className={'rounded-full border px-2 py-[1px] text-[11px] font-medium ' + TONE_PILL[row.aside.tone]}>
                {row.aside.text}
              </dd>
            )}
          </div>
        ))}
      </dl>
      <details className="border-t border-ink-100 px-3 py-2 text-[11.5px] text-ink-600">
        <summary className="cursor-pointer select-none text-ink-500 hover:text-ink-800">How this is calculated</summary>
        <ul className="mt-1.5 list-disc space-y-1 pl-4 leading-relaxed">
          <li>
            Counts sub-issues that have no sub-issues of their own, so parent issues aren't counted twice. Splitting an
            issue raises the count but isn't treated as new scope.
          </li>
          <li>
            Closed as completed counts as done. Closed as not planned or duplicate, or moved out, reduces scope without
            counting as done. A reopened issue counts as remaining again.
          </li>
          <li>
            Rates come from changes observed in the last {FORECAST_WINDOW_DAYS / 7} weeks. Scope growth is net of
            removals and never below zero.
          </li>
          <li>
            No forecast until there are {MIN_HISTORY_DAYS} days of history and {MIN_COMPLETIONS} completions in the
            window. These are rough week-level estimates, not commitments.
          </li>
        </ul>
      </details>
    </div>
  );
}

/* ---------- changes + remaining ---------- */

const KIND: Record<ScopeEvent['kind'], { label: string; cls: string }> = {
  added: { label: 'Added', cls: 'bg-indigo-50 text-indigo-700' },
  removed: { label: 'Removed', cls: 'bg-ink-100 text-ink-600' },
  completed: { label: 'Done', cls: 'bg-emerald-50 text-emerald-700' },
  reopened: { label: 'Reopened', cls: 'bg-amber-50 text-amber-800' },
  split: { label: 'Split', cls: 'bg-ink-100 text-ink-600' },
};

function IssueLink({ issue, demo }: { issue: ScopeIssue; demo: boolean }) {
  return (
    <a
      href={issue.url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={demo ? e => e.preventDefault() : undefined}
      title={demo ? 'Demo issue: opens on GitHub once real data is connected' : `Open #${issue.number} on GitHub`}
      className="min-w-0 truncate text-ink-800 hover:text-brand-700 hover:underline"
    >
      <span className="tabular-nums text-ink-500">#{issue.number}</span> {issue.title}
    </a>
  );
}

function Disclosure({ title, count, aside, defaultOpen, children }: {
  title: string;
  count: number;
  aside?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details open={defaultOpen} className="group rounded-lg border border-ink-200">
      <summary className="flex cursor-pointer select-none list-none items-center gap-2 px-3 py-2 [&::-webkit-details-marker]:hidden">
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden className="text-ink-400 transition group-open:rotate-90">
          <path d="M3.5 2 7 5 3.5 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-ink-500">{title}</span>
        <span className="rounded-full bg-ink-100 px-1.5 text-[10.5px] font-semibold tabular-nums text-ink-600">{count}</span>
        {aside && <span className="text-[11.5px] text-ink-500">{aside}</span>}
      </summary>
      <div className="border-t border-ink-100 py-1">{children}</div>
    </details>
  );
}

const CHANGE_LIMIT = 8;

function ChangeList({ events, demo }: { events: ScopeEvent[]; demo: boolean }) {
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? events : events.slice(0, CHANGE_LIMIT);
  const days: { key: number; events: ScopeEvent[] }[] = [];
  for (const e of shown) {
    const key = startOfDay(Date.parse(e.at));
    if (days[days.length - 1]?.key === key) days[days.length - 1].events.push(e);
    else days.push({ key, events: [e] });
  }
  return (
    <Disclosure title="Changes" count={events.length} defaultOpen>
      {events.length === 0 ? (
        <p className="px-3 py-1.5 text-[12px] text-ink-500">No changes since the baseline.</p>
      ) : (
        <>
          {days.map(day => (
            <div key={day.key} className="px-3 py-1.5">
              <div className="mb-1 text-[11px] font-semibold text-ink-500">{dayLabel(day.key)}</div>
              <ul className="space-y-1">
                {day.events.map((e, i) => (
                  <li key={`${e.issue.id}-${e.kind}-${i}`} className="flex min-w-0 items-baseline gap-2 text-[12.5px]">
                    <span className={'inline-flex w-[62px] shrink-0 justify-center rounded px-1.5 py-[1px] text-[10.5px] font-semibold ' + KIND[e.kind].cls}>
                      {KIND[e.kind].label}
                    </span>
                    <IssueLink issue={e.issue} demo={demo} />
                    {e.note && <span className="shrink-0 text-[11.5px] text-ink-500">{e.note}</span>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {events.length > CHANGE_LIMIT && (
            <button
              type="button"
              onClick={() => setShowAll(v => !v)}
              className="mx-3 my-1 text-[12px] font-medium text-brand-700 hover:underline"
            >
              {showAll ? 'Show fewer' : `Show all ${events.length} changes`}
            </button>
          )}
        </>
      )}
    </Disclosure>
  );
}

function RemainingList({ items, demo }: { items: RemainingIssue[]; demo: boolean }) {
  const added = items.filter(item => item.addedAt);
  const baseline = items.filter(item => !item.addedAt);
  const group = (title: string, rows: RemainingIssue[]) => (
    <div className="px-3 py-1.5">
      <div className="mb-1 text-[11px] font-semibold text-ink-500">{title}</div>
      <ul className="space-y-1">
        {rows.map(({ issue, addedAt, note }) => (
          <li key={issue.id} className="flex min-w-0 items-baseline gap-2 text-[12.5px]">
            <IssueLink issue={issue} demo={demo} />
            {addedAt && (
              <span className="shrink-0 text-[11.5px] text-ink-500">
                Added {fmtDay(Date.parse(addedAt))}{note ? ` · ${note}` : ''}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
  return (
    <Disclosure
      title="Remaining"
      count={items.length}
      aside={added.length > 0 ? `${added.length} added since baseline` : undefined}
    >
      {added.length > 0 && group(`Added since baseline (${added.length})`, added)}
      {baseline.length > 0 && group(`In baseline (${baseline.length})`, baseline)}
    </Disclosure>
  );
}
