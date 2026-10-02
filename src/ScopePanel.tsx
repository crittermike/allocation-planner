import { useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  FORECAST_WINDOW_DAYS,
  HIGH_CREEP_RATIO,
  MIN_COMPLETIONS,
  MIN_HISTORY_DAYS,
  RAMP_WEEKS,
  analyzeScope,
  canForecast,
  isCreep,
  issueKey,
  maxCreepForTarget,
  parseGitHubIssueUrl,
  projectFinish,
  type FinishForecast,
  type ForecastStatus,
  type GitHubIssueRef,
  type Pace,
  type Projection,
  type RemainingIssue,
  type ScopeAnalysis,
  type ScopeEvent,
  type ScopeIssue,
  type ScopeSummary,
  type ScopeTracking,
  type ScopeView,
} from './scope';
import { DEMO_SCENARIOS, SCOPE_DEMO_ENABLED, demoScope, type DemoScenario } from './scopeDemo';
import type { Project } from './types';

/** Until the GitHub connector exists, the panel can only show demo data, so it's dev-only. */
export const scopeTrackingEnabled = SCOPE_DEMO_ENABLED;

const MINUTE = 60_000;
const DAY = 86_400_000;
const WEEK = 7 * DAY;

type Tone = 'good' | 'bad' | 'warn' | 'neutral';
type Target = { date: string; source: string };

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
const fmtMult = (n: number) => `${Math.round(n * 100) / 100}×`;
const roundWeeks = (w: number) => Math.max(1, Math.round(w));
const weekOf = (date: string) => fmtDay(mondayOf(parseDay(date)));

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

function listLabels(labels: string[]): string {
  if (labels.length <= 1) return labels[0] ?? '';
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(', ')}, and ${labels[labels.length - 1]}`;
}

/* ---------- status ---------- */

const STATUS: Record<ForecastStatus, { label: string; headline?: string; tone: Tone }> = {
  converging: { label: 'Converging', tone: 'good' },
  'not-converging': { label: 'Not converging', tone: 'bad' },
  'just-started': { label: 'Just started', tone: 'neutral' },
  'not-started': { label: 'Not started', tone: 'neutral' },
  'too-early': { label: 'Too early', headline: 'Too early to forecast', tone: 'neutral' },
  'no-progress': { label: 'No recent progress', tone: 'neutral' },
  done: { label: 'Done', headline: 'All issues are done', tone: 'good' },
  empty: { label: 'No sub-issues', headline: 'No sub-issues yet', tone: 'neutral' },
};
const TONE_PILL: Record<Tone, string> = {
  good: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  bad: 'border-rose-200 bg-rose-50 text-rose-700',
  warn: 'border-amber-100 bg-amber-50 text-amber-800',
  neutral: 'border-ink-200 bg-ink-50 text-ink-600',
};
const TONE_TEXT: Record<Tone, string> = {
  good: 'text-emerald-700',
  bad: 'text-rose-700',
  warn: 'text-amber-800',
  neutral: 'text-ink-900',
};
const TONE_DOT: Record<Tone, string> = {
  good: 'bg-emerald-500',
  bad: 'bg-rose-500',
  warn: 'bg-amber-500',
  neutral: 'bg-ink-400',
};

const creepTone = (s: ScopeSummary): Tone =>
  s.status === 'not-converging' ? 'bad' : s.highCreep ? 'warn' : 'neutral';

function explain(s: ScopeSummary, rootNumber: number): string {
  const own = s.pace?.own;
  const started = s.startedAt ? ago(Date.parse(s.startedAt)) : '';
  switch (s.status) {
    case 'empty':
      return `#${rootNumber} has no sub-issues yet. Scope is counted from sub-issues.`;
    case 'done': {
      const took = s.startedAt && s.finishedAt
        ? ` Took ${plural(roundWeeks((Date.parse(s.finishedAt) - Date.parse(s.startedAt)) / WEEK), 'week')} from the first finished issue to the last.`
        : '';
      return `All ${plural(s.current.scope, 'issue')} are closed.${took}`;
    }
    case 'not-started':
      return `${plural(s.current.scope, 'issue')} planned, none finished yet. Work counts as started when the first one is finished.`;
    case 'just-started':
      return `Work started ${started}. Until it's been ${RAMP_WEEKS} weeks, the forecast leans on ` +
        `${listLabels(s.pace?.references.map(r => r.label) ?? [])}'s pace.`;
    case 'too-early':
      return `Work started ${started}. A forecast needs ${MIN_HISTORY_DAYS} days and ${MIN_COMPLETIONS} finished ` +
        'issues, or a finished milestone to compare with.';
    case 'no-progress':
      return `Nothing was finished or added in the last ${plural(Math.round(own?.windowWeeks ?? 4), 'week')}.`;
    case 'converging':
    case 'not-converging': {
      if (!own) return '';
      const parts = [`${own.completed} finished`, `${own.creep} new`];
      if (own.movedOut) parts.push(`${own.movedOut} moved out`);
      if (own.dropped) parts.push(`${own.dropped} dropped`);
      let text = `In the last ${plural(Math.round(own.windowWeeks), 'week')}: ${parts.join(', ')}.`;
      if (s.highCreep && own.completionRate > 0) {
        text += ` That's ${fmtRate(own.creepRate / own.completionRate)} new issues for every one finished.`;
      }
      return text;
    }
  }
}

/** How a finish estimate compares with the release date, by calendar week. */
function versusTarget(f: FinishForecast | null, target: Target | null): { text: string; tone: Tone } | null {
  if (!f || !target) return null;
  const late = (p: Projection | null) => !p || !p.date || p.date > target.date;
  if (f.isRange) {
    if (late(f.fastest)) return { text: 'After target', tone: 'bad' };
    if (late(f.slowest)) return { text: 'Might miss target', tone: 'warn' };
    return { text: 'Before target', tone: 'good' };
  }
  const p = f.central;
  if (!p) return null;
  if (!p.date) return { text: 'After target', tone: 'bad' };
  const weeks = Math.round((mondayOf(parseDay(p.date)) - mondayOf(parseDay(target.date))) / WEEK);
  if (p.date <= target.date) {
    return { text: weeks === 0 ? 'Same week as target' : `${plural(-weeks, 'week')} before target`, tone: 'good' };
  }
  return weeks === 0
    ? { text: 'A few days after target', tone: 'warn' }
    : { text: `${plural(weeks, 'week')} after target`, tone: 'bad' };
}

/* ---------- panel ---------- */

/** Demo scenario picked per URL, kept while the page is open. */
const chosenScenarios = new Map<string, DemoScenario>();

export function ScopePanel({ issue, releaseDate, projects }: {
  issue: GitHubIssueRef;
  releaseDate?: string;
  projects: Project[];
}) {
  const headingId = useId();
  const [scenario, setScenario] = useState<DemoScenario>(() => chosenScenarios.get(issue.url) ?? 'normal');
  const load = useMemo(() => demoScope(issue, scenario), [issue.url, scenario]);
  const tracking = load.status === 'ready' ? load.tracking : null;

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <h3 id={headingId} className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-500">Scope</h3>
        {tracking && <span className="text-[11.5px] text-ink-500">Updated {ago(Date.parse(tracking.checkedAt))}</span>}
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
            The planner's GitHub access doesn't cover this repo, or the issue doesn't exist. Scope shows up
            automatically once the issue can be read. Last tried {ago(Date.parse(load.at))}.
          </p>
        </div>
      ) : (
        <ScopeDetails
          key={scenario}
          tracking={load.tracking}
          issue={issue}
          releaseDate={releaseDate}
          projects={projects}
        />
      )}
    </section>
  );
}

function ScopeDetails({ tracking, issue, releaseDate, projects }: {
  tracking: ScopeTracking;
  issue: GitHubIssueRef;
  releaseDate?: string;
  projects: Project[];
}) {
  const analysis = useMemo(() => analyzeScope(tracking), [tracking]);
  const [viewId, setViewId] = useState(analysis.defaultViewId);
  // Milestones get their release date from the planner project linked to them.
  const releaseByIssue = useMemo(() => {
    const out = new Map<string, { date: string; name: string }>();
    for (const p of projects) {
      const ref = parseGitHubIssueUrl(p.url);
      if (ref && p.releaseDate) out.set(issueKey(ref), { date: p.releaseDate, name: p.name });
    }
    return out;
  }, [projects]);

  const view = analysis.views.find(v => v.id === viewId) ?? analysis.views[0];
  if (!view) return <p className="text-[12.5px] text-ink-500">Waiting for data from GitHub…</p>;

  const targetFor = (v: ScopeView): Target | null => {
    if (!analysis.hasBreakdown) return releaseDate ? { date: releaseDate, source: "this project's release date" } : null;
    const ref = v.issue ? parseGitHubIssueUrl(v.issue.url) : null;
    const hit = ref ? releaseByIssue.get(issueKey(ref)) : undefined;
    return hit ? { date: hit.date, source: `release date of ${hit.name.trim() || 'a linked project'}` } : null;
  };

  return (
    <>
      {tracking.refreshError && (
        <div role="status" className="rounded-lg border border-amber-100 bg-amber-50 px-3.5 py-2.5 text-[12.5px] leading-relaxed text-amber-800">
          <span className="font-semibold">Couldn't refresh from GitHub</span> ({tracking.refreshError.message},
          last attempt {ago(Date.parse(tracking.refreshError.at))}). Showing data last confirmed{' '}
          {fmtWhen(Date.parse(tracking.checkedAt))}.
        </div>
      )}
      {analysis.hasBreakdown && (
        <MilestoneTable analysis={analysis} selectedId={view.id} onSelect={setViewId} targetFor={targetFor} />
      )}
      <MilestoneDetail
        key={view.id}
        view={view}
        target={targetFor(view)}
        showHeading={analysis.hasBreakdown}
        rootNumber={issue.number}
        demo={tracking.source === 'demo'}
      />
    </>
  );
}

/* ---------- epic: milestone table ---------- */

function MilestoneTable({ analysis, selectedId, onSelect, targetFor }: {
  analysis: ScopeAnalysis;
  selectedId: string;
  onSelect: (id: string) => void;
  targetFor: (v: ScopeView) => Target | null;
}) {
  return (
    <div>
      <div className="overflow-hidden rounded-lg border border-ink-200">
        <table className="w-full table-fixed text-[12.5px]">
          <colgroup>
            <col />
            <col className="w-[96px]" />
            <col className="w-[76px]" />
            <col className="w-[104px]" />
            <col className="w-[132px]" />
          </colgroup>
          <thead>
            <tr className="border-b border-ink-200 bg-ink-50/60 text-left text-[10px] font-semibold uppercase tracking-[0.06em] text-ink-500">
              <th scope="col" className="px-3 py-1.5">Milestone</th>
              <th scope="col" className="px-2 py-1.5">Done</th>
              <th scope="col" className="px-2 py-1.5" title="New issues per week, not counting splits or moves between milestones">Creep</th>
              <th scope="col" className="px-2 py-1.5" title="Week the remaining work finishes at the current creep rate">Finish</th>
              <th scope="col" className="px-2 py-1.5">Status</th>
            </tr>
          </thead>
          <tbody>
            {analysis.views.map(v => {
              const selected = v.id === selectedId;
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
                      className="block w-full truncate text-left text-ink-800 outline-none focus-visible:underline"
                    >
                      {v.label}
                    </button>
                  </td>
                  <td className="px-2 py-1.5"><Progress done={v.summary.current.completed} total={v.summary.current.scope} /></td>
                  <td className="px-2 py-1.5"><CreepCell summary={v.summary} /></td>
                  <td className="px-2 py-1.5"><FinishCell summary={v.summary} target={targetFor(v)} /></td>
                  <td className="px-2 py-1.5"><StatusPill status={v.summary.status} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {analysis.outside && (
        <p className="mt-1.5 text-[11.5px] text-ink-500">
          Plus {plural(analysis.outside.total, 'sub-issue')} outside milestones ({analysis.outside.open} open).
        </p>
      )}
    </div>
  );
}

function Progress({ done, total }: { done: number; total: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-8 shrink-0 overflow-hidden rounded-full bg-ink-100">
        <div className="h-full rounded-full bg-emerald-500" style={{ width: `${total > 0 ? (done / total) * 100 : 0}%` }} />
      </div>
      <span className="tabular-nums text-ink-600">{done}/{total}</span>
    </div>
  );
}

const established = (s: ScopeSummary) =>
  s.status === 'converging' || s.status === 'not-converging' || s.status === 'no-progress';

function CreepCell({ summary: s }: { summary: ScopeSummary }) {
  if (!established(s) || !s.pace) return <span className="text-ink-300">—</span>;
  const tone = creepTone(s);
  const { completionRate, creepRate } = s.pace;
  const ratio = completionRate > 0 ? `${fmtRate(creepRate / completionRate)} new per issue finished` : 'nothing finished';
  return (
    <span
      title={`${fmtRate(creepRate)} new issues/week · ${ratio}${s.highCreep ? ' (high)' : ''}`}
      className={'tabular-nums ' + (tone === 'neutral' ? 'text-ink-600' : `rounded-full border px-1.5 py-[1px] font-medium ${TONE_PILL[tone]}`)}
    >
      {fmtRate(creepRate)}/wk
    </span>
  );
}

function FinishCell({ summary: s, target }: { summary: ScopeSummary; target: Target | null }) {
  if (s.status === 'done') {
    return <span className="text-ink-500">{s.finishedAt ? fmtDay(Date.parse(s.finishedAt)) : 'Done'}</span>;
  }
  const f = projectFinish(s, 1);
  if (!f) return <span className="text-ink-300">—</span>;
  if (s.status === 'not-started') {
    return (
      <span className="text-ink-600" title="Once work starts, at the pace of finished milestones">
        {f.fastest ? `~${weekRange(f)}` : '—'}
      </span>
    );
  }
  const vs = versusTarget(f, target);
  const notFinishing = f.isRange ? !f.fastest : !f.central;
  const tone: Tone = notFinishing ? 'bad' : vs?.tone ?? 'neutral';
  const text = f.isRange
    ? f.fastest?.date
      ? `${weekOf(f.fastest.date)}${f.slowest?.date && weekOf(f.slowest.date) !== weekOf(f.fastest.date) ? `–${weekOf(f.slowest.date).replace(/^[A-Za-z]+ /, '')}` : ''}`
      : 'Not finishing'
    : f.central?.date ? weekOf(f.central.date) : f.central ? '1 year+' : 'Not finishing';
  return (
    <span
      className={'tabular-nums ' + (tone === 'neutral' ? 'text-ink-700' : TONE_TEXT[tone] + ' font-medium')}
      title={target ? `Target ${fmtDay(parseDay(target.date))} (${target.source})` : 'No release date'}
    >
      {text}
    </span>
  );
}

/** "5–6 wks" style range for not-started milestones. */
function weekRange(f: FinishForecast): string {
  const lo = f.fastest ? roundWeeks(f.fastest.weeks) : null;
  const hi = f.slowest ? roundWeeks(f.slowest.weeks) : null;
  if (lo == null) return '—';
  if (hi == null) return `${lo}+ wks`;
  return lo === hi ? `${lo} wks` : `${lo}–${hi} wks`;
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

/* ---------- milestone detail ---------- */

function MilestoneDetail({ view, target, showHeading, rootNumber, demo }: {
  view: ScopeView;
  target: Target | null;
  showHeading: boolean;
  rootNumber: number;
  demo: boolean;
}) {
  const [multiplier, setMultiplier] = useState(1);
  const s = view.summary;
  const forecastable = !!s.pace && canForecast(s.status);
  const showChart = s.status !== 'empty' && s.status !== 'not-started' && s.points.length > 1;

  return (
    <div className="flex flex-col gap-4">
      {showHeading && view.issue && (
        <div className="-mb-2 flex min-w-0 items-baseline gap-2 border-t border-ink-100 pt-4">
          <h4 className="min-w-0 truncate text-[13px] font-semibold text-ink-700">{view.label}</h4>
          <IssueNumberLink issue={view.issue} demo={demo} />
        </div>
      )}
      <Verdict summary={s} rootNumber={rootNumber} />
      {s.status !== 'empty' && s.status !== 'not-started' && <Stats summary={s} />}
      {showChart && (
        <BurnUpChart summary={s} multiplier={multiplier} target={target} showTrend={forecastable} />
      )}
      {forecastable && s.pace && (
        <ForecastBox summary={s} pace={s.pace} multiplier={multiplier} onMultiplier={setMultiplier} target={target} />
      )}
      {s.events.length > 0 && <ChangeList events={s.events} demo={demo} />}
      {s.remainingIssues.length > 0 && <RemainingList items={s.remainingIssues} demo={demo} planned={s.status === 'not-started'} />}
    </div>
  );
}

function Verdict({ summary: s, rootNumber }: { summary: ScopeSummary; rootNumber: number }) {
  const { label, headline, tone } = STATUS[s.status];
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <span className={'h-2.5 w-2.5 shrink-0 rounded-full ' + TONE_DOT[tone]} aria-hidden />
        <span className="text-[16px] font-semibold tracking-tight text-ink-900">{headline ?? label}</span>
        {s.highCreep && (
          <span className={'rounded-full border px-2 py-[1px] text-[11px] font-medium ' + TONE_PILL[creepTone(s)]}>
            High creep
          </span>
        )}
      </div>
      <p className="mt-1 text-[12.5px] leading-relaxed text-ink-600">{explain(s, rootNumber)}</p>
    </div>
  );
}

function Stats({ summary: s }: { summary: ScopeSummary }) {
  const grew = s.baseline.scope !== s.current.scope;
  const creepCount = s.events.filter(isCreep).length;
  const pace = s.pace;
  const creep = established(s) && pace
    ? {
        value: `${fmtRate(pace.creepRate)}/wk`,
        hint: pace.completionRate > 0 ? `${fmtRate(pace.creepRate / pace.completionRate)} per issue finished` : 'nothing finished',
        tone: creepTone(s),
      }
    : { value: `${creepCount} new`, hint: s.status === 'done' ? 'while in progress' : 'since work started', tone: 'neutral' as Tone };
  const items: { label: string; value: string; hint: string; tone?: Tone }[] = [
    { label: 'Scope', value: grew ? `${s.baseline.scope} → ${s.current.scope}` : `${s.current.scope}`, hint: grew ? 'at start → now' : 'same as at start' },
    { label: 'Creep', ...creep },
    { label: 'Finished', value: `${s.current.completed}`, hint: `of ${s.current.scope}` },
    { label: 'Remaining', value: `${s.remaining}`, hint: 'open' },
  ];
  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {items.map(item => (
        <div key={item.label} className="rounded-lg border border-ink-200 px-3 py-2">
          <dt className="text-[10px] font-semibold uppercase tracking-[0.06em] text-ink-500">{item.label}</dt>
          <dd className={'mt-0.5 text-[17px] font-semibold tabular-nums tracking-tight ' + TONE_TEXT[item.tone ?? 'neutral']}>{item.value}</dd>
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

function BurnUpChart({ summary: s, multiplier, target, showTrend }: {
  summary: ScopeSummary;
  multiplier: number;
  target: Target | null;
  showTrend: boolean;
}) {
  const [boxRef, width] = useWidth<HTMLDivElement>();
  const [hoverX, setHoverX] = useState<number | null>(null);

  const t0 = Date.parse(s.points[0].at);
  const tNow = Date.parse(s.asOf);
  const cur = s.current;
  const trend = showTrend && !!s.pace;
  const completion = trend ? s.pace!.completionRate : 0;
  const creep = trend ? s.pace!.creepRate * multiplier : 0;
  const net = completion - creep;
  const finishAt = trend && net > 1e-9 ? tNow + (s.remaining / net) * WEEK : null;
  const targetAt = target ? parseDay(target.date) : null;

  const history = Math.max(tNow - t0, DAY);
  // Show at least as much future as history, plus the target and finish if they're within 6 months.
  const within = (t: number | null) => (t && t > tNow && t - tNow <= 26 * WEEK ? t : 0);
  const targetAhead = within(targetAt) && targetAt! + 3 * DAY;
  const finishAhead = within(finishAt) && finishAt! + 4 * DAY;
  const cap = Math.max(tNow + Math.max(history, 6 * WEEK), targetAhead, finishAhead);
  const wanted = [tNow + history * 0.03];
  if (targetAhead) wanted.push(targetAhead);
  if (trend) wanted.push(finishAt ? finishAt + 4 * DAY : cap);
  const tEnd = Math.min(cap, Math.max(...wanted));

  const scopeAt = (t: number) => cur.scope + (creep * (t - tNow)) / WEEK;
  const doneAt = (t: number) => cur.completed + (completion * (t - tNow)) / WEEK;
  const trendEnd = finishAt ? Math.min(finishAt, tEnd) : tEnd;
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

  const hoverT = hoverX == null ? null : t0 + ((hoverX - PAD.l) / plotW) * (tEnd - t0);
  const hovered = hoverT == null
    ? null
    : [...s.points].reverse().find(p => Date.parse(p.at) <= hoverT) ?? s.points[0];
  const clampLabel = (px: number) => Math.min(Math.max(px, PAD.l + 34), width - PAD.r - 34);

  return (
    <figure className="m-0">
      <div ref={boxRef} className="relative" style={{ height: CHART_H }}>
        {width > 0 && (
          <svg width={width} height={CHART_H} role="img" aria-label="Scope and finished issues over time" className="block overflow-visible">
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
                <line x1={x(tNow)} y1={y(cur.scope)} x2={x(trendEnd)} y2={y(scopeAt(trendEnd))} className="stroke-ink-700" />
              </g>
            )}
            {finishAt && finishAt <= tEnd && (
              <g>
                <circle cx={x(finishAt)} cy={y(scopeAt(finishAt))} r={3.5} className="fill-white stroke-emerald-600" strokeWidth={2} />
                <text x={clampLabel(x(finishAt))} y={y(scopeAt(finishAt)) - 8} textAnchor="middle" className="fill-ink-600 text-[10px] font-semibold">
                  Week of {fmtDay(mondayOf(finishAt))}
                </text>
              </g>
            )}

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
            {' · '}Scope {hovered.scope} · Finished {hovered.completed} · Remaining {hovered.scope - hovered.completed}
          </div>
        )}
      </div>
      <figcaption className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-ink-500">
        <LegendItem swatch={<span className="h-0.5 w-4 rounded bg-ink-700" />}>Scope</LegendItem>
        <LegendItem swatch={<span className="h-2.5 w-4 border-t-2 border-emerald-500 bg-emerald-500/15" />}>Finished</LegendItem>
        <LegendItem swatch={<span className="w-4 border-t border-dashed border-ink-400" />}>Scope at start</LegendItem>
        {trend && <LegendItem swatch={<span className="w-4 border-t-2 border-dotted border-emerald-500" />}>Forecast</LegendItem>}
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

function finishText(f: FinishForecast | null, s: ScopeSummary): string {
  if (!f) return '—';
  const never = `Doesn't finish: new work arrives ${s.pace && s.pace.creepRate > s.pace.completionRate ? 'faster than' : 'as fast as'} it's finished`;
  if (s.status === 'not-started') {
    if (!f.fastest) return never;
    return `~${weekRange(f).replace('wks', 'weeks')}${f.slowest ? '' : '; may not finish'}`;
  }
  if (f.isRange) {
    if (!f.fastest?.date) return f.fastest ? 'More than a year' : never;
    const lo = roundWeeks(f.fastest.weeks);
    const hi = f.slowest ? roundWeeks(f.slowest.weeks) : null;
    const weeks = hi == null ? `~${lo}+ weeks` : lo === hi ? `~${plural(lo, 'week')}` : `~${lo}–${hi} weeks`;
    const first = weekOf(f.fastest.date);
    const lastWeek = f.slowest?.date ? weekOf(f.slowest.date) : null;
    const dates = lastWeek && lastWeek !== first ? `weeks of ${first}–${lastWeek}` : `week of ${first}`;
    return `${weeks} · ${dates}${hi == null ? '; may not finish' : ''}`;
  }
  if (!f.central) return never;
  if (!f.central.date) return 'More than a year';
  return `~${plural(roundWeeks(f.central.weeks), 'week')} · week of ${weekOf(f.central.date)}`;
}

function breakEvenText(s: ScopeSummary, target: Target): string | null {
  if (!s.pace || s.status === 'not-started') return null;
  const day = fmtDay(parseDay(target.date));
  const maxCreep = maxCreepForTarget(s, target.date);
  if (maxCreep == null) return 'The target date has passed.';
  const creep = s.pace.creepRate;
  if (maxCreep <= 0.05) return `Misses ${day} even with no new scope.`;
  if (creep <= 0) return `Hits ${day} if new issues stay under ${fmtRate(maxCreep)}/week.`;
  const m = maxCreep / creep;
  if (m >= 2) return `Hits ${day} even at 2× creep.`;
  return m >= 1
    ? `Hits ${day} as long as creep stays under ${fmtRate(maxCreep)}/week (${fmtMult(m)}).`
    : `Hits ${day} only if creep drops below ${fmtRate(maxCreep)}/week (${fmtMult(m)}).`;
}

function paceText(s: ScopeSummary, pace: Pace): string {
  const refs = listLabels(pace.references.map(r => r.label));
  if (s.status === 'not-started') {
    const c = pace.scenarios.map(x => x.completionRate);
    const n = pace.scenarios.map(x => x.creepRate);
    const span = (v: number[]) => {
      const lo = fmtRate(Math.min(...v));
      const hi = fmtRate(Math.max(...v));
      return lo === hi ? lo : `${lo}–${hi}`;
    };
    return `${refs}'s pace: finished ${span(c)}/week, ${span(n)} new/week`;
  }
  if (pace.references.length > 0) {
    const mine = Math.round(pace.ownWeight * 100);
    return `Finishing ~${fmtRate(pace.completionRate)}/week · ~${fmtRate(pace.creepRate)} new/week · ${mine}% this milestone, ${100 - mine}% ${refs}`;
  }
  const own = pace.own;
  const window = own ? ` · ${fmtDay(Date.parse(own.windowStart))}–${fmtDay(Date.parse(s.asOf))}` : '';
  return `Finishing ${fmtRate(pace.completionRate)}/week · ${fmtRate(pace.creepRate)} new/week${window}`;
}

function ForecastBox({ summary: s, pace, multiplier, onMultiplier, target }: {
  summary: ScopeSummary;
  pace: Pace;
  multiplier: number;
  onMultiplier: (m: number) => void;
  target: Target | null;
}) {
  const f = projectFinish(s, multiplier);
  const vs = s.status === 'not-started' ? null : versusTarget(f, target);
  const breakEven = target ? breakEvenText(s, target) : null;
  const maxCreep = target && s.status !== 'not-started' ? maxCreepForTarget(s, target.date) : null;
  const marker = maxCreep != null && maxCreep > 0.05 && pace.creepRate > 0 && maxCreep / pace.creepRate < 2
    ? maxCreep / pace.creepRate
    : null;

  return (
    <div className="rounded-lg border border-ink-200">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 border-b border-ink-100 px-3 py-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-ink-500">Forecast</span>
        <span className="text-[11px] text-ink-500">{paceText(s, pace)}</span>
      </div>
      <div className="border-b border-ink-100 px-3 pb-2 pt-2.5">
        <CreepSlider value={multiplier} onChange={onMultiplier} creepRate={pace.creepRate} breakEven={marker} />
      </div>
      <dl className="divide-y divide-ink-100 text-[12.5px]">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3 py-2">
          <dt className="w-[96px] shrink-0 text-ink-600">{s.status === 'not-started' ? 'Once started' : 'Finishes'}</dt>
          <dd className="min-w-0 flex-1 font-medium text-ink-900">{finishText(f, s)}</dd>
          {vs && (
            <dd className={'rounded-full border px-2 py-[1px] text-[11px] font-medium ' + TONE_PILL[vs.tone]}>{vs.text}</dd>
          )}
        </div>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3 py-2">
          <dt className="w-[96px] shrink-0 text-ink-600">Target</dt>
          <dd className="min-w-0 flex-1">
            {target ? (
              <>
                <span className="font-medium text-ink-900">{fmtDay(parseDay(target.date))}</span>
                <span className="text-ink-500"> · {target.source}</span>
                {breakEven && <div className="mt-0.5 text-ink-600">{breakEven}</div>}
              </>
            ) : (
              <span className="text-ink-500">No release date set</span>
            )}
          </dd>
        </div>
      </dl>
      <details className="border-t border-ink-100 px-3 py-2 text-[11.5px] text-ink-600">
        <summary className="cursor-pointer select-none text-ink-500 hover:text-ink-800">How this is calculated</summary>
        <ul className="mt-1.5 list-disc space-y-1 pl-4 leading-relaxed">
          <li>
            Counts sub-issues that have no sub-issues of their own, so parent issues aren't counted twice. Closed as
            not planned or duplicate, or moved out, reduces scope without counting as finished. Reopened issues count
            as remaining again.
          </li>
          <li>
            Work starts when the first issue is finished. Scope at start is the scope just before that; issues added
            earlier count as planning.
          </li>
          <li>
            Creep counts new issues added after work started. Issues split from existing ones or moved from another
            milestone don't count. The slider scales it: none, the current rate, or double.
          </li>
          <li>
            Rates come from the last {FORECAST_WINDOW_DAYS / 7} weeks. For the first {RAMP_WEEKS} weeks after work
            starts, they blend in the pace of finished milestones, and the estimate is a range with one end per
            finished milestone.
          </li>
          <li>
            Creep is high at {Math.round(1 / HIGH_CREEP_RATIO) === 2 ? '1 new issue for every 2 finished' : `${HIGH_CREEP_RATIO} new issues per finished issue`}.
            At 1 for every 1, a milestone never finishes.
          </li>
          <li>These are rough, week-level estimates, not commitments.</li>
        </ul>
      </details>
    </div>
  );
}

function CreepSlider({ value, onChange, creepRate, breakEven }: {
  value: number;
  onChange: (m: number) => void;
  creepRate: number;
  /** Multiplier at which the target is just met, when it's on the slider. */
  breakEven: number | null;
}) {
  const id = useId();
  const none = creepRate <= 0;
  // Keep labels aligned with the thumb, which travels 16px less than the track.
  const at = (m: number) => `calc(${(m / 2) * 100}% + ${8 - (m / 2) * 16}px)`;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-[12.5px] text-ink-600">Scope creep</label>
        <span className="text-[12.5px] font-medium tabular-nums text-ink-900">
          {none ? 'None observed' : value === 0 ? 'None' : `${fmtMult(value)} · ${fmtRate(value * creepRate)} new/week`}
        </span>
      </div>
      <div className="relative mt-1">
        <input
          id={id}
          type="range"
          min={0}
          max={2}
          step={0.05}
          value={value}
          disabled={none}
          onChange={e => onChange(Number(e.target.value))}
          aria-valuetext={value === 0 ? 'No new scope' : `${fmtMult(value)} the current creep rate`}
          className="h-4 w-full cursor-pointer accent-brand-600 disabled:cursor-not-allowed disabled:opacity-40"
        />
        {breakEven != null && (
          <span
            className="pointer-events-none absolute top-[17px] h-2 w-px -translate-x-1/2 bg-brand-500"
            style={{ left: at(breakEven) }}
            title="Highest creep that still hits the target"
            aria-hidden
          />
        )}
      </div>
      <div className="relative mt-1 h-3.5 text-[10.5px] text-ink-500">
        {[{ m: 0, label: 'None' }, { m: 1, label: 'Current' }, { m: 2, label: '2×' }].map(t => (
          <button
            key={t.m}
            type="button"
            disabled={none}
            onClick={() => onChange(t.m)}
            className={'absolute -translate-x-1/2 hover:text-ink-900 disabled:pointer-events-none ' + (value === t.m ? 'font-semibold text-ink-800' : '')}
            style={{ left: at(t.m) }}
          >
            {t.label}
          </button>
        ))}
        {breakEven != null && Math.abs(breakEven - 1) > 0.25 && breakEven > 0.25 && breakEven < 1.75 && (
          <span className="absolute -translate-x-1/2 text-brand-500" style={{ left: at(breakEven) }} aria-hidden>
            Target
          </span>
        )}
      </div>
    </div>
  );
}

/* ---------- changes + remaining ---------- */

const GRAY = 'bg-ink-100 text-ink-600';

function badge(e: ScopeEvent): { label: string; cls: string } {
  switch (e.kind) {
    case 'added':
      if (isCreep(e)) return { label: 'New', cls: 'bg-indigo-50 text-indigo-700' };
      return { label: e.origin === 'moved' ? 'Moved in' : e.origin === 'split' ? 'Split off' : 'Added', cls: GRAY };
    case 'removed':
      return { label: e.reason === 'moved' ? 'Moved out' : e.reason === 'dropped' ? 'Dropped' : 'Removed', cls: GRAY };
    case 'split':
      return { label: 'Split', cls: GRAY };
    case 'completed':
      return { label: 'Done', cls: 'bg-emerald-50 text-emerald-700' };
    case 'reopened':
      return { label: 'Reopened', cls: 'bg-amber-50 text-amber-800' };
  }
}

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

function IssueNumberLink({ issue, demo }: { issue: ScopeIssue; demo: boolean }) {
  return (
    <a
      href={issue.url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={demo ? e => e.preventDefault() : undefined}
      title={demo ? 'Demo issue: opens on GitHub once real data is connected' : `Open #${issue.number} on GitHub`}
      className="shrink-0 text-[12px] tabular-nums text-ink-500 hover:text-brand-700 hover:underline"
    >
      #{issue.number} ↗
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
  const creep = events.filter(isCreep).length;
  return (
    <Disclosure title="Changes since work started" count={events.length} aside={creep ? `${creep} new` : undefined} defaultOpen>
      {days.map(day => (
        <div key={day.key} className="px-3 py-1.5">
          <div className="mb-1 text-[11px] font-semibold text-ink-500">{dayLabel(day.key)}</div>
          <ul className="space-y-1">
            {day.events.map((e, i) => {
              const b = badge(e);
              return (
                <li key={`${e.issue.id}-${e.kind}-${i}`} className="flex min-w-0 items-baseline gap-2 text-[12.5px]">
                  <span className={'inline-flex w-[66px] shrink-0 justify-center rounded px-1.5 py-[1px] text-[10.5px] font-semibold ' + b.cls}>
                    {b.label}
                  </span>
                  <IssueLink issue={e.issue} demo={demo} />
                  {e.note && <span className="shrink-0 text-[11.5px] text-ink-500">{e.note}</span>}
                </li>
              );
            })}
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
    </Disclosure>
  );
}

function RemainingList({ items, demo, planned }: { items: RemainingIssue[]; demo: boolean; planned: boolean }) {
  const added = items.filter(item => item.addedAt);
  const baseline = items.filter(item => !item.addedAt);
  const describe = (item: RemainingIssue) => {
    const when = item.addedAt ? fmtDay(Date.parse(item.addedAt)) : '';
    const from = (item.note ?? '').replace(/^From/, 'from');
    if (item.origin === 'new') return `New ${when}`;
    if (item.origin === 'split') return `Split ${from} · ${when}`;
    if (item.origin === 'moved') return `Moved ${from} · ${when}`;
    return `${item.note ?? 'Added'} · ${when}`;
  };
  const group = (title: string, rows: RemainingIssue[]) => (
    <div className="px-3 py-1.5">
      <div className="mb-1 text-[11px] font-semibold text-ink-500">{title}</div>
      <ul className="space-y-1">
        {rows.map(item => (
          <li key={item.issue.id} className="flex min-w-0 items-baseline gap-2 text-[12.5px]">
            <IssueLink issue={item.issue} demo={demo} />
            {item.addedAt && <span className="shrink-0 text-[11.5px] text-ink-500">{describe(item)}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
  return (
    <Disclosure
      title={planned ? 'Planned' : 'Remaining'}
      count={items.length}
      aside={added.length > 0 ? `${added.length} added since work started` : undefined}
    >
      {added.length > 0 && group(`Added since work started (${added.length})`, added)}
      {baseline.length > 0 && group(planned ? `Issues (${baseline.length})` : `In scope at start (${baseline.length})`, baseline)}
    </Disclosure>
  );
}
