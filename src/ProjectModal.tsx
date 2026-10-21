import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { replaceSearchParam, searchParam } from './router';
import { milestoneLabel } from './milestones';
import { LoadingScope, ScopePanel, scopeSourceFor, type FoundMilestone, type ScopeStatus } from './ScopePanel';
import { hadScope, rememberScope, useScopeConfig } from './scopeApi';
import type { Milestone, Person, Project } from './types';
import { useModalFocus } from './useModalFocus';

/** Chip-style EM values offered in the picker. Must stay in sync with the
 *  EM_CHIPS used in Capacity.tsx (the picker logic mirrors what's there). */
export const EM_CHIPS = [0.5, 1, 1.5, 2, 2.5, 3, 4, 5];

/** Project color palette. Must match the bg colors in Plan.tsx PALETTE. */
const COLORS = [
  '#fecaca', '#fed7aa', '#fef3c7', '#d9f99d', '#bbf7d0',
  '#a5f3fc', '#bfdbfe', '#ddd6fe', '#fbcfe8', '#e2e8f0',
];
const INK_BY_BG: Record<string, string> = {
  '#fecaca': '#7f1d1d', '#fed7aa': '#7c2d12', '#fef3c7': '#713f12',
  '#d9f99d': '#365314', '#bbf7d0': '#14532d', '#a5f3fc': '#155e75',
  '#bfdbfe': '#1e3a8a', '#ddd6fe': '#4c1d95', '#fbcfe8': '#831843',
  '#e2e8f0': '#1e293b',
};
const inkFor = (bg: string) => INK_BY_BG[bg.toLowerCase()] ?? '#1e293b';

const fmtWk = (n: number): string => `${Math.round(n * 10) / 10}`;

const fmtReleaseDate = (iso: string): string => {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  if (Number.isNaN(date.getTime())) return iso;
  const sameYear = y === new Date().getFullYear();
  return date.toLocaleDateString('en-US', sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
};

export function ReleaseDatePicker({ value, name, onChange, title = "The date you've communicated this project will ship", compact }: {
  value: string | undefined;
  /** Fill a narrow fixed-width parent instead of keeping the default minimum width. */
  compact?: boolean;
  /** What ships on this date, for accessible labels. */
  name: string;
  onChange: (date: string | undefined) => void;
  title?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const openPicker = () => {
    const input = inputRef.current;
    if (!input) return;
    try {
      input.showPicker();
    } catch {
      input.focus();
      input.click();
    }
  };
  return (
    <div className={(compact ? 'w-full ' : 'w-full min-w-[120px] max-w-[160px] ') + 'relative flex h-8 items-center rounded-md border border-ink-200 bg-white transition-colors hover:border-ink-300 focus-within:border-brand-400 focus-within:ring-2 focus-within:ring-brand-200'}>
      <input
        ref={inputRef}
        type="date"
        min="0001-01-01"
        max="9999-12-31"
        value={value ?? ''}
        tabIndex={-1}
        aria-hidden
        onChange={e => onChange(e.currentTarget.value || undefined)}
        className="pointer-events-none absolute inset-0 h-full w-full opacity-0"
      />
      <button
        type="button"
        onClick={openPicker}
        title={title}
        aria-label={`Release date for ${name}: ${value ? fmtReleaseDate(value) : 'none'}`}
        className="relative flex h-full min-w-0 flex-1 items-center bg-transparent px-2 text-left text-[12px] tabular-nums text-ink-700 outline-none"
      >
        {value ? (
          <span className="truncate">{fmtReleaseDate(value)}</span>
        ) : (
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" className="text-ink-300" aria-hidden>
            <rect x="2" y="3" width="12" height="11" rx="1.5" />
            <path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" strokeLinecap="round" />
          </svg>
        )}
      </button>
      {value && (
        <button
          type="button"
          onClick={() => onChange(undefined)}
          title="Clear release date"
          aria-label={`Clear release date for ${name}`}
          className="relative mr-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden>
            <path d="m3 3 6 6m0-6-6 6" />
          </svg>
        </button>
      )}
    </div>
  );
}

/* ============================================================ */
/* ColorPopover                                                  */
/* ============================================================ */

export function ColorPopover(props: {
  rect: DOMRect;
  value: string;
  onPick: (c: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) props.onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') props.onClose(); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [props]);

  const w = 200;
  let top = props.rect.bottom + 6;
  let left = props.rect.left;
  if (top + 100 > window.innerHeight) top = props.rect.top - 100 - 6;
  if (left + w > window.innerWidth) left = window.innerWidth - w - 8;

  return (
    <div
      ref={ref}
      className="anim-pop-in fixed z-50 rounded-xl border border-ink-200 bg-white p-3 shadow-2xl"
      style={{ top, left, width: w }}
    >
      <div className="grid grid-cols-5 gap-2">
        {COLORS.map(c => (
          <button
            key={c}
            onClick={() => props.onPick(c)}
            className={
              'h-7 w-7 rounded-full border-2 transition hover:scale-110 ' +
              (c === props.value ? 'border-ink-900 ring-2 ring-white ring-offset-1 ring-offset-ink-200' : 'border-transparent')
            }
            style={{ background: c, boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.6), 0 1px 2px rgba(15,23,42,0.08)' }}
          />
        ))}
      </div>
    </div>
  );
}

/* ============================================================ */
/* EM chip picker (chips for common values + free-form input)    */
/* ============================================================ */

function EmPicker({
  value,
  onChange,
}: {
  value: number | undefined;
  onChange: (n: number | undefined) => void;
}) {
  const isCustom = value != null && !EM_CHIPS.includes(value);
  const [customStr, setCustomStr] = useState<string>(() =>
    isCustom ? String(value) : ''
  );
  useEffect(() => {
    if (value != null && !EM_CHIPS.includes(value)) setCustomStr(String(value));
    else setCustomStr('');
  }, [value]);

  const commitCustom = () => {
    if (customStr === '') return;
    const n = parseFloat(customStr);
    if (!isFinite(n) || n < 0) {
      setCustomStr('');
      return;
    }
    onChange(n);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1">
        {EM_CHIPS.map(v => (
          <button
            key={v}
            type="button"
            onClick={() => onChange(v)}
            className={
              'inline-flex h-7 min-w-[32px] items-center justify-center rounded border px-2 text-[12px] font-semibold tabular-nums transition ' +
              (value === v
                ? 'border-brand-600 bg-brand-600 text-white'
                : 'border-ink-200 bg-white text-ink-600 hover:border-brand-300 hover:text-brand-700')
            }
          >
            {fmtWk(v)}
          </button>
        ))}
        <input
          type="number"
          step={0.5}
          min={0}
          value={customStr}
          onChange={e => setCustomStr(e.target.value)}
          onBlur={commitCustom}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault();
              (e.target as HTMLInputElement).blur();
            }
          }}
          placeholder="#"
          title="Custom EM value (e.g. 6, 7.5)"
          className={
            'ml-0.5 h-7 w-[60px] rounded border px-2 text-right text-[12px] font-semibold tabular-nums outline-none transition placeholder:text-ink-300 focus:border-brand-400 focus:ring-2 focus:ring-brand-200 ' +
            (customStr !== ''
              ? 'border-brand-600 bg-brand-50 text-brand-700'
              : 'border-ink-200 bg-white text-ink-700 hover:border-ink-400')
          }
        />
        {value != null && (
          <button
            type="button"
            onClick={() => onChange(undefined)}
            title="Clear estimate"
            className="ml-1 inline-flex h-7 items-center rounded border border-transparent px-1.5 text-[11px] text-ink-400 hover:border-ink-200 hover:text-ink-700"
          >
            clear
          </button>
        )}
      </div>
    </div>
  );
}

/* ============================================================ */
/* Milestones                                                    */
/* ============================================================ */

function MilestonesSection(props: {
  project: Project;
  assignedByMilestone: Record<string, number>;
  onAdd: (items: Omit<Milestone, 'id'>[]) => void;
  onUpdate: (milestoneId: string, patch: Partial<Omit<Milestone, 'id'>>) => void;
  onRemove: (milestoneId: string) => void;
}) {
  const { project } = props;
  const milestones = project.milestones ?? [];
  const listRef = useRef<HTMLUListElement>(null);
  const focusNew = useRef(false);
  useEffect(() => {
    if (!focusNew.current) return;
    focusNew.current = false;
    const inputs = listRef.current?.querySelectorAll<HTMLInputElement>('input[data-milestone-name]');
    inputs?.[inputs.length - 1]?.focus();
  }, [milestones.length]);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-500">Milestones</span>
        <span className="flex-1" />
      </div>
      {milestones.length > 0 && (
        <ul ref={listRef} className="flex flex-col gap-1.5">
          {milestones.map(m => {
            const label = milestoneLabel(m);
            const weeks = props.assignedByMilestone[m.id] ?? 0;
            return (
              <li key={m.id} className="flex items-center gap-2">
                <span
                  className="inline-block h-2 w-2 shrink-0 rotate-45 rounded-[1px] border border-black/10"
                  style={{ background: project.color }}
                  aria-hidden
                />
                <input
                  data-milestone-name
                  value={m.name}
                  onChange={e => props.onUpdate(m.id, { name: e.target.value })}
                  readOnly={m.github && !m.goneFromGitHub}
                  title={m.goneFromGitHub
                    ? 'Not on GitHub anymore: no longer a Batch sub-issue of the epic. Kept so its ship date and assignments are not lost; remove it when you are done with it.'
                    : m.github ? `${m.name} (synced from GitHub)` : m.name || undefined}
                  placeholder="Milestone name"
                  aria-label="Milestone name"
                  className={(m.goneFromGitHub ? 'line-through decoration-amber-500 !border-amber-300 !bg-amber-50 ' : '') + (m.github && !m.goneFromGitHub ? 'bg-ink-50 ' : '') + "h-8 min-w-0 flex-1 rounded-md border border-ink-200 bg-white px-2.5 text-[12.5px] text-ink-800 outline-none transition hover:border-ink-300 focus:border-brand-400 focus:ring-2 focus:ring-brand-200"}
                />
                <div className="w-[124px] shrink-0">
                  <ReleaseDatePicker
                    compact
                    value={m.releaseDate}
                    name={`${project.name || 'Untitled project'} · ${label}`}
                    title="The date you've communicated this milestone will ship"
                    onChange={releaseDate => props.onUpdate(m.id, { releaseDate })}
                  />
                </div>
                <span
                  className={'w-9 shrink-0 whitespace-nowrap text-right text-[11px] tabular-nums ' + (weeks ? 'text-ink-500' : 'text-ink-300')}
                  title={`${weeks} assignment-week${weeks === 1 ? '' : 's'} planned on this milestone`}
                >
                  {weeks} wk
                </span>
                <div className="flex shrink-0 items-center gap-0.5">
                {m.url ? (
                  <a
                    href={m.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={`Open ${m.url}`}
                    className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-400 transition hover:bg-brand-50 hover:text-brand-600"
                  >
                    ↗
                  </a>
                ) : (
                  <span className="w-7 shrink-0" aria-hidden />
                )}
                <button
                  type="button"
                  onClick={() => props.onRemove(m.id)}
                  title="Remove milestone"
                  aria-label={`Remove milestone ${label}`}
                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-400 transition hover:bg-rose-50 hover:text-rose-600"
                >
                  ×
                </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <button
        type="button"
        onClick={() => {
          focusNew.current = true;
          props.onAdd([{ name: '' }]);
        }}
        className="self-start rounded-md px-1.5 py-1 text-[12px] font-medium text-brand-600 transition hover:bg-brand-50"
      >
        + Add milestone
      </button>
    </div>
  );
}

/* ============================================================ */
/* ProjectEditModal                                              */
/* ============================================================ */

export function ProjectEditModal(props: {
  project: Project;
  people: Person[];
  planned: number;
  weeksPerEM: number;
  onUpdate: (patch: Partial<Project>) => void;
  onRemove: () => void;
  onClose: () => void;
  isNew?: boolean;
  /** The plan's slug, for loading scope from the server. */
  slug?: string;
  /** All projects in the plan, so milestones can show linked projects' release dates. */
  projects?: Project[];
  onAddMilestones: (items: Omit<Milestone, 'id'>[]) => void;
  /** Sync the project's milestones with those found on its GitHub epic. */
  onSyncMilestones: (found: FoundMilestone[]) => void;
  onUpdateMilestone: (milestoneId: string, patch: Partial<Omit<Milestone, 'id'>>) => void;
  onRemoveMilestone: (milestoneId: string) => void;
  /** Assignment-weeks per milestone of this project. */
  assignedByMilestone?: Record<string, number>;
}) {
  const { project, planned, weeksPerEM } = props;
  const swatchRef = useRef<HTMLButtonElement>(null);
  const [colorOpen, setColorOpen] = useState(false);
  const [colorRect, setColorRect] = useState<DOMRect | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalFocus(dialogRef);
  const scopeConfig = useScopeConfig();
  const [scope, setScope] = useState<{ url: string; status: ScopeStatus } | null>(null);
  const onScopeStatus = useCallback((status: ScopeStatus, url: string) => {
    setScope({ url, status });
    if (status !== 'loading') rememberScope(url, status === 'content');
  }, []);
  // Links can point at one milestone: /<slug>/p/<projectId>?milestone=<issue number>.
  const [milestone, setMilestone] = useState(() => Number(searchParam('milestone')) || undefined);
  const onMilestoneChange = useCallback((next: number | null) => {
    setMilestone(next ?? undefined);
    replaceSearchParam('milestone', next == null ? null : String(next));
  }, []);
  const openedUrl = useRef(props.project.url);
  const scopeUrl = props.slug ? scopeSourceFor(props.project.url, scopeConfig)?.issue.url : undefined;
  const latestScopeUrl = useRef(scopeUrl);
  latestScopeUrl.current = scopeUrl;
  const syncMilestones = useRef(props.onSyncMilestones);
  syncMilestones.current = props.onSyncMilestones;
  const onMilestonesFound = useCallback(
    (items: FoundMilestone[]) => { if (scopeUrl && latestScopeUrl.current === scopeUrl) syncMilestones.current(items); },
    [scopeUrl],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') props.onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [props]);

  const ink = inkFor(project.color);
  const est = project.estimateEM;
  const plannedEM = weeksPerEM > 0 ? planned / weeksPerEM : 0;
  let badgeClass = 'bg-ink-100 text-ink-500 border-ink-200';
  let badgeText = fmtWk(plannedEM);
  if (est != null && est > 0) {
    badgeText = `${fmtWk(plannedEM)} / ${fmtWk(est)}`;
    if (plannedEM > est + 0.01) badgeClass = 'bg-rose-50 text-rose-700 border-rose-200 font-semibold';
    else if (Math.abs(plannedEM - est) <= 0.01) badgeClass = 'bg-emerald-50 text-emerald-700 border-emerald-200 font-semibold';
    else badgeClass = 'bg-ink-100 text-ink-700 border-ink-200';
  } else if (plannedEM === 0) {
    badgeClass = 'bg-transparent text-ink-400 border-transparent';
  }
  // Projects linked to a GitHub issue the planner can read get scope tracking automatically.
  const tracked = props.slug ? scopeSourceFor(project.url, scopeConfig) : null;
  const trackedUrl = tracked?.issue.url;
  const scopeStatus: ScopeStatus = trackedUrl && scope?.url === trackedUrl ? scope.status : 'loading';
  // A link's milestone belongs to the issue the project pointed at when it opened.
  const linkMilestone = project.url === openedUrl.current ? milestone : undefined;
  // Open wide right away for issues that showed scope before, instead of growing once loaded.
  const expectScope = useMemo(
    () => !!trackedUrl && (linkMilestone != null || hadScope(trackedUrl)),
    [trackedUrl, linkMilestone],
  );
  const wide = !!tracked && (scopeStatus === 'content' || (scopeStatus === 'loading' && expectScope));

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink-900/40 px-4 py-12 backdrop-blur-sm"
      onMouseDown={e => { if (e.target === e.currentTarget) props.onClose(); }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={project.name || 'Project'}
        tabIndex={-1}
        className={
          'anim-pop-in w-full outline-none rounded-2xl border border-ink-200 bg-white shadow-2xl ' +
          (wide ? 'max-w-[1200px] lg:grid lg:grid-cols-[512px_minmax(0,1fr)]' : 'max-w-lg')
        }
      >
        <div className="flex items-center justify-between gap-3 border-b border-ink-100 px-5 py-3.5 lg:col-span-2">
          <div className="flex items-center gap-3">
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">Project</span>
            {tracked && scopeStatus === 'loading' && !wide && <LoadingScope />}
          </div>
          <button
            type="button"
            onClick={props.onClose}
            title="Close"
            aria-label="Close"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-500 hover:bg-ink-100 hover:text-ink-800"
          >
            ×
          </button>
        </div>
        <div className="flex flex-col gap-4 px-5 py-5">
          <div className="flex items-end gap-3">
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-500">Color</span>
              <button
                ref={swatchRef}
                type="button"
                onClick={() => {
                  if (swatchRef.current) setColorRect(swatchRef.current.getBoundingClientRect());
                  setColorOpen(true);
                }}
                title="Click to change color"
                className="inline-flex h-9 w-12 items-center justify-center rounded-full border shadow-[inset_0_1px_0_rgba(255,255,255,0.6),0_1px_2px_rgba(15,23,42,0.06)] transition hover:-translate-y-px hover:shadow-md"
                style={{ background: project.color, color: ink, borderColor: 'rgba(15,23,42,0.08)' }}
              >
                <span className="text-[10px] tracking-tighter opacity-50">⋮⋮</span>
              </button>
              {colorOpen && colorRect && (
                <ColorPopover
                  rect={colorRect}
                  value={project.color}
                  onPick={c => { props.onUpdate({ color: c }); setColorOpen(false); }}
                  onClose={() => setColorOpen(false)}
                />
              )}
            </div>
            <label className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-500">Name</span>
              <input
                autoFocus
                className="h-9 w-full rounded-md border border-ink-200 bg-white px-3 text-[14px] font-semibold text-ink-900 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-200"
                value={project.name}
                onChange={e => props.onUpdate({ name: e.target.value })}
                placeholder="Untitled project"
                onKeyDown={e => { if (e.key === 'Enter') props.onClose(); }}
              />
            </label>
          </div>

          <div className="flex flex-col gap-1">
            <div className="flex items-baseline gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-500">Estimated EM</span>
              <span className="flex-1" />
              <div className="flex items-baseline gap-1">
                <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-500">Planned</span>
                <span
                  className={'inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-[2px] text-[11.5px] tabular-nums ' + badgeClass}
                  title={est != null && est > 0 ? `${fmtWk(plannedEM)} planned / ${fmtWk(est)} estimated EM` : 'Planned EM across all assignments'}
                >
                  {badgeText} <span className="text-[10px] opacity-70">EM</span>
                </span>
              </div>
            </div>
            <EmPicker
              value={project.estimateEM}
              onChange={n => props.onUpdate({ estimateEM: n })}
            />
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-500">DRI</span>
            <select
              className="h-9 rounded-md border border-ink-200 bg-white px-2 text-[13px] outline-none transition hover:border-ink-300 focus:border-brand-400 focus:ring-2 focus:ring-brand-200"
              value={project.driId ?? ''}
              onChange={e => props.onUpdate({ driId: e.target.value || null })}
            >
              <option value="">— None —</option>
              {props.people.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>

          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-500">Release date</span>
            <ReleaseDatePicker
              value={project.releaseDate}
              name={project.name || 'Untitled project'}
              onChange={releaseDate => props.onUpdate({ releaseDate })}
            />
          </div>

          <MilestonesSection
            project={project}
            assignedByMilestone={props.assignedByMilestone ?? {}}
            onAdd={props.onAddMilestones}
            onUpdate={props.onUpdateMilestone}
            onRemove={props.onRemoveMilestone}
          />

          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-500">URL</span>
            <div className="flex items-center gap-1.5">
              <input
                type="url"
                placeholder="https://github.com/.../issues/123"
                value={project.url ?? ''}
                onChange={e => props.onUpdate({ url: e.target.value || undefined })}
                className="h-9 min-w-0 flex-1 rounded-md border border-ink-200 bg-white px-3 text-[13px] outline-none transition hover:border-ink-300 focus:border-brand-400 focus:ring-2 focus:ring-brand-200"
                onKeyDown={e => { if (e.key === 'Enter') props.onClose(); }}
              />
              {project.url && (
                <a
                  href={project.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={`Open ${project.url}`}
                  aria-label="Open project URL"
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-ink-200 bg-white text-ink-500 transition hover:bg-brand-50 hover:text-brand-600"
                >
                  ↗
                </a>
              )}
            </div>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-500">Notes</span>
            <textarea
              value={project.notes ?? ''}
              onChange={e => props.onUpdate({ notes: e.target.value || undefined })}
              rows={3}
              placeholder="Scope, dependencies, risks, links to docs…"
              className="resize-y rounded-md border border-ink-200 bg-white px-3 py-2 text-[13px] text-ink-800 outline-none transition placeholder:text-ink-300 focus:border-brand-400 focus:ring-2 focus:ring-brand-200"
            />
          </label>
        </div>
        {tracked && props.slug && (
          <div
            className={'min-w-0 border-t border-ink-100 px-5 ' + (
              wide ? 'py-5 lg:border-l lg:border-t-0' : scopeStatus === 'notice' ? 'py-3' : 'hidden'
            )}
          >
            <ScopePanel
              key={tracked.issue.url}
              slug={props.slug}
              issue={tracked.issue}
              source={tracked.source}
              releaseDate={project.releaseDate}
              projects={props.projects ?? []}
              settleMs={project.url === openedUrl.current ? 0 : undefined}
              onStatusChange={onScopeStatus}
              milestone={linkMilestone}
              onMilestoneChange={onMilestoneChange}
              milestones={project.milestones}
              onMilestonesFound={onMilestonesFound}
            />
          </div>
        )}
        {!props.isNew && (
          <div className="sticky -bottom-12 flex items-center rounded-b-2xl border-t border-ink-100 bg-white px-5 py-2.5 lg:col-span-2">
            <button
              type="button"
              onClick={() => {
                props.onRemove();
                props.onClose();
              }}
              className="inline-flex h-8 items-center gap-1 rounded-md border border-rose-200 bg-white px-3 text-[12.5px] text-rose-600 transition hover:bg-rose-50"
            >
              Delete project
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
