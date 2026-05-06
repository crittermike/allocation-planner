import { useEffect, useMemo, useRef, useState } from 'react';
import { navigate } from './router';
import { usePlan, type ConnState } from './usePlan';

type ID = string;

type Person = { id: ID; name: string };
type Project = {
  id: ID;
  name: string;
  color: string;
  driId: ID | null;
  url?: string;
  estimatedWeeks?: number;
};
type Iteration = { id: ID; startDate: string };
type Assignment = { id: ID; personId: ID; weekId: string; projectId: ID };

type State = {
  title: string;
  people: Person[];
  projects: Project[];
  iterations: Iteration[];
  assignments: Assignment[];
  weekNotes?: Record<string, string>;
};

const PANEL_KEY = 'gantt-maker-panel-v1';
const TRANSPOSED_KEY = 'gantt-maker-transposed-v1';
const COLLAPSED_ITERATIONS_KEY = 'gantt-maker-collapsed-iterations-v1';

/** Soft, characterful palette — paired bg + ink colors for legible chips. */
const PALETTE = [
  { bg: '#fecaca', ink: '#7f1d1d' }, // rose
  { bg: '#fed7aa', ink: '#7c2d12' }, // orange
  { bg: '#fef3c7', ink: '#713f12' }, // amber
  { bg: '#d9f99d', ink: '#365314' }, // lime
  { bg: '#bbf7d0', ink: '#14532d' }, // green
  { bg: '#a5f3fc', ink: '#155e75' }, // cyan
  { bg: '#bfdbfe', ink: '#1e3a8a' }, // blue
  { bg: '#ddd6fe', ink: '#4c1d95' }, // violet
  { bg: '#fbcfe8', ink: '#831843' }, // pink
  { bg: '#e2e8f0', ink: '#1e293b' }, // slate
];
const COLORS = PALETTE.map(p => p.bg);

/** Find a sensible ink (text) color for a given chip bg. */
function inkFor(bg: string): string {
  const m = PALETTE.find(p => p.bg.toLowerCase() === bg.toLowerCase());
  return m ? m.ink : '#1e293b';
}

const uid = () => Math.random().toString(36).slice(2, 10);

/* ---------- PTO sentinel ----------
 * PTO is an assignment kind that isn't a project. We model it by reserving a
 * fixed "project id" so it flows through the same Assignment record without
 * touching state.projects (so it never shows up in the projects table or
 * planned-eng-weeks counts).
 */
const PTO_ID: ID = '__pto__';
const PTO_PROJECT: Project = {
  id: PTO_ID,
  name: 'PTO',
  color: '#e2e8f0',
  driId: null,
};
const isPto = (id: ID) => id === PTO_ID;
const lookupProject = (
  projectsById: Record<ID, Project>,
  id: ID,
): Project | undefined => (isPto(id) ? PTO_PROJECT : projectsById[id]);

/* ---------- date helpers ---------- */
const MS_PER_DAY = 86400000;
const parseISODate = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const toISODate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * MS_PER_DAY);
const mondayOf = (d: Date) => {
  const day = d.getDay();
  return addDays(d, day === 0 ? -6 : 1 - day);
};
const weekLabel = (monday: Date) => {
  const fri = addDays(monday, 4);
  const m1 = monday.toLocaleString('en-US', { month: 'short' });
  const m2 = fri.toLocaleString('en-US', { month: 'short' });
  return m1 === m2
    ? `${m1} ${monday.getDate()}–${fri.getDate()}`
    : `${m1} ${monday.getDate()}–${m2} ${fri.getDate()}`;
};

type IterationTone = 'past' | 'current' | 'future';

const startOfToday = () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
};

const iterationTone = (iter: Iteration, today: Date): IterationTone => {
  const start = parseISODate(iter.startDate);
  const end = addDays(start, 14);
  if (today >= start && today < end) return 'current';
  if (today >= end) return 'past';
  return 'future';
};

const readCollapsedIterationIds = (slug: string): Set<ID> => {
  try {
    const raw = localStorage.getItem(COLLAPSED_ITERATIONS_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return new Set();
    const ids = (parsed as Record<string, unknown>)[slug];
    if (!Array.isArray(ids)) return new Set();
    return new Set(ids.filter((id): id is ID => typeof id === 'string'));
  } catch {
    return new Set();
  }
};

const writeCollapsedIterationIds = (slug: string, ids: ID[]) => {
  try {
    const raw = localStorage.getItem(COLLAPSED_ITERATIONS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    const bySlug =
      parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : {};
    localStorage.setItem(COLLAPSED_ITERATIONS_KEY, JSON.stringify({ ...bySlug, [slug]: ids }));
  } catch {}
};

type WeekInfo = { id: string; label: string; iterationId: ID; index: 0 | 1 };
const weeksOfIteration = (iter: Iteration): WeekInfo[] => {
  const start = parseISODate(iter.startDate);
  return [0, 1].map(i => ({
    id: `${iter.id}:${i}`,
    label: weekLabel(addDays(start, i * 7)),
    iterationId: iter.id,
    index: i as 0 | 1,
  }));
};

/* ---------- seed ---------- */

/* ============================================================ */

export default function Plan({ slug }: { slug: string }) {
  const { state: liveState, setState: setLiveState, conn, peers } = usePlan(slug);

  if (conn === 'missing') {
    return (
      <div className="flex h-screen w-screen items-center justify-center p-6">
        <div className="max-w-md rounded-2xl border border-ink-200 bg-white p-8 text-center shadow-sm">
          <h1 className="text-[20px] font-semibold text-ink-900">Plan not found</h1>
          <p className="mt-2 text-[13px] text-ink-500">
            No plan exists at <span className="font-mono">/{slug}</span>.
          </p>
          <button
            className="mt-5 inline-flex h-9 items-center rounded-lg bg-gradient-to-b from-brand-600 to-brand-700 px-4 text-[13px] font-semibold text-white shadow-sm transition hover:from-brand-700 active:scale-[0.98]"
            onClick={() => navigate('/')}
          >
            ← Back to plans
          </button>
        </div>
      </div>
    );
  }

  if (!liveState) {
    return (
      <div className="flex h-screen w-screen items-center justify-center text-[13px] text-ink-500">
        Loading…
      </div>
    );
  }

  return <PlanView slug={slug} state={liveState} setState={setLiveState} conn={conn} peers={peers} />;
}

function PlanView({
  slug,
  state,
  setState,
  conn,
  peers,
}: {
  slug: string;
  state: State;
  setState: (updater: (s: State) => State) => void;
  conn: ConnState;
  peers: number;
}) {
  const projectsById = useMemo(
    () => Object.fromEntries(state.projects.map(p => [p.id, p])),
    [state.projects],
  );
  const peopleById = useMemo(
    () => Object.fromEntries(state.people.map(p => [p.id, p])),
    [state.people],
  );
  const allWeeks = useMemo(
    () => state.iterations.flatMap(weeksOfIteration),
    [state.iterations],
  );
  const iterationToneById = useMemo(() => {
    const today = startOfToday();
    const tones: Record<ID, IterationTone> = {};
    for (const iter of state.iterations) {
      tones[iter.id] = iterationTone(iter, today);
    }
    return tones;
  }, [state.iterations]);
  const currentIterationId = useMemo<ID | null>(
    () => state.iterations.find(iter => iterationToneById[iter.id] === 'current')?.id ?? null,
    [iterationToneById, state.iterations],
  );
  const plannedByProject = useMemo(() => {
    const map: Record<ID, number> = {};
    for (const a of state.assignments) {
      if (isPto(a.projectId)) continue;
      map[a.projectId] = (map[a.projectId] ?? 0) + 1;
    }
    return map;
  }, [state.assignments]);

  /* mutations */
  const setTitle = (title: string) => setState(s => ({ ...s, title }));
  const addPerson = (name = 'New person') =>
    setState(s => ({ ...s, people: [...s.people, { id: uid(), name }] }));
  const renamePerson = (id: ID, name: string) =>
    setState(s => ({ ...s, people: s.people.map(p => (p.id === id ? { ...p, name } : p)) }));
  const removePerson = (id: ID) =>
    setState(s => ({
      ...s,
      people: s.people.filter(p => p.id !== id),
      assignments: s.assignments.filter(a => a.personId !== id),
    }));
  const addProject = (): ID => {
    const id = uid();
    setState(s => ({
      ...s,
      projects: [
        ...s.projects,
        { id, name: 'New project', color: COLORS[s.projects.length % COLORS.length], driId: null },
      ],
    }));
    return id;
  };
  const updateProject = (id: ID, patch: Partial<Project>) =>
    setState(s => ({
      ...s,
      projects: s.projects.map(p => (p.id === id ? { ...p, ...patch } : p)),
    }));
  const removeProject = (id: ID) =>
    setState(s => ({
      ...s,
      projects: s.projects.filter(p => p.id !== id),
      assignments: s.assignments.filter(a => a.projectId !== id),
    }));
  const addIteration = () =>
    setState(s => {
      const nextStart =
        s.iterations.length === 0
          ? mondayOf(new Date())
          : addDays(parseISODate(s.iterations[s.iterations.length - 1].startDate), 14);
      const next = [...s.iterations, { id: uid(), startDate: toISODate(nextStart) }];
      next.sort((a, b) => a.startDate.localeCompare(b.startDate));
      return { ...s, iterations: next };
    });
  const addPastIteration = () =>
    setState(s => {
      const prevStart =
        s.iterations.length === 0
          ? mondayOf(new Date())
          : addDays(parseISODate(s.iterations[0].startDate), -14);
      const next = [{ id: uid(), startDate: toISODate(prevStart) }, ...s.iterations];
      next.sort((a, b) => a.startDate.localeCompare(b.startDate));
      return { ...s, iterations: next };
    });
  const setIterationStart = (id: ID, isoDate: string) =>
    setState(s => {
      const d = parseISODate(isoDate);
      if (isNaN(d.getTime())) return s;
      const anchor = mondayOf(d);
      const anchorIdx = s.iterations.findIndex(i => i.id === id);
      if (anchorIdx === -1) return s;
      // Re-derive every iteration's start date relative to the anchor,
      // keeping the fixed 2-week cadence between them.
      const next = s.iterations.map((iter, idx) => ({
        ...iter,
        startDate: toISODate(addDays(anchor, (idx - anchorIdx) * 14)),
      }));
      return { ...s, iterations: next };
    });
  const removeIteration = (iterationId: ID) =>
    setState(s => {
      const weekIds = new Set([`${iterationId}:0`, `${iterationId}:1`]);
      return {
        ...s,
        iterations: s.iterations.filter(i => i.id !== iterationId),
        assignments: s.assignments.filter(a => !weekIds.has(a.weekId)),
      };
    });
  const addAssignment = (personId: ID, weekId: string, projectId: ID) =>
    setState(s => {
      if (s.assignments.some(a => a.personId === personId && a.weekId === weekId && a.projectId === projectId))
        return s;
      return { ...s, assignments: [...s.assignments, { id: uid(), personId, weekId, projectId }] };
    });
  const moveAssignment = (assignmentId: ID, personId: ID, weekId: string) =>
    setState(s => {
      const a = s.assignments.find(x => x.id === assignmentId);
      if (!a) return s;
      const dup = s.assignments.some(
        x => x.id !== assignmentId && x.personId === personId && x.weekId === weekId && x.projectId === a.projectId,
      );
      if (dup) return { ...s, assignments: s.assignments.filter(x => x.id !== assignmentId) };
      return {
        ...s,
        assignments: s.assignments.map(x => (x.id === assignmentId ? { ...x, personId, weekId } : x)),
      };
    });
  const removeAssignment = (id: ID) =>
    setState(s => ({ ...s, assignments: s.assignments.filter(a => a.id !== id) }));
  const clearAssignments = () => {
    if (confirm('Clear all assignments?')) setState(s => ({ ...s, assignments: [] }));
  };
  const setWeekNote = (weekId: string, text: string) =>
    setState(s => {
      const next = { ...(s.weekNotes ?? {}) };
      const trimmed = text.trim();
      if (trimmed === '') delete next[weekId];
      else next[weekId] = text;
      return { ...s, weekNotes: next };
    });

  /* Auto-scroll the chart so the current iteration is the first one visible.
   * Runs when the current iteration changes (e.g. after the plan loads from
   * the server, or after editing iteration dates). Past iterations remain
   * accessible by scrolling left. */
  const chartScrollRef = useRef<HTMLDivElement | null>(null);
  const lastScrolledIterRef = useRef<ID | null>(null);
  const [collapsedIterationIds, setCollapsedIterationIds] = useState<Set<ID>>(
    () => readCollapsedIterationIds(slug),
  );

  useEffect(() => {
    const validIds = new Set(state.iterations.map(iter => iter.id));
    setCollapsedIterationIds(prev => {
      let changed = false;
      const next = new Set<ID>();
      for (const id of prev) {
        if (validIds.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [state.iterations]);

  useEffect(() => {
    const validIds = new Set(state.iterations.map(iter => iter.id));
    const ids = [...collapsedIterationIds].filter(id => validIds.has(id));
    writeCollapsedIterationIds(slug, ids);
  }, [slug, collapsedIterationIds, state.iterations]);

  const toggleIterationCollapsed = (id: ID) => {
    lastScrolledIterRef.current = null;
    setCollapsedIterationIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /* projects panel state */
  const [transposed, setTransposed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(TRANSPOSED_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [editingProjectId, setEditingProjectId] = useState<ID | null>(null);
  useEffect(() => {
    try { localStorage.setItem(TRANSPOSED_KEY, transposed ? '1' : '0'); } catch {}
    // re-trigger auto-scroll on layout swap
    lastScrolledIterRef.current = null;
  }, [transposed]);

  useEffect(() => {
    if (!currentIterationId) return;
    if (lastScrolledIterRef.current === currentIterationId) return;
    const scroller = chartScrollRef.current;
    if (!scroller) return;
    const target = scroller.querySelector<HTMLElement>(
      `[data-iter-id="${currentIterationId}"]`,
    );
    if (!target) return;
    if (transposed) {
      const stickyOffset = 36;
      const top = target.offsetTop - stickyOffset - 8;
      scroller.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    } else {
      const stickyOffset = 200;
      const left = target.offsetLeft - stickyOffset - 8;
      scroller.scrollTo({ left: Math.max(0, left), behavior: 'smooth' });
    }
    lastScrolledIterRef.current = currentIterationId;
  }, [collapsedIterationIds, currentIterationId, transposed]);

  const [panel, setPanel] = useState<{ collapsed: boolean; height: number }>(() => {
    try {
      const raw = localStorage.getItem(PANEL_KEY);
      if (raw) return JSON.parse(raw);
    } catch {}
    return { collapsed: false, height: 320 };
  });
  useEffect(() => {
    localStorage.setItem(PANEL_KEY, JSON.stringify(panel));
  }, [panel]);

  const onResizeStart = (e: React.MouseEvent) => {
    if (panel.collapsed) return;
    e.preventDefault();
    if (transposed) {
      const startX = e.clientX;
      const startW = panel.height; // reuse field as width when transposed
      const onMove = (ev: MouseEvent) => {
        const dx = startX - ev.clientX;
        const next = Math.max(280, Math.min(window.innerWidth - 280, startW + dx));
        setPanel(p => ({ ...p, height: next }));
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      return;
    }
    const startY = e.clientY;
    const startH = panel.height;
    const onMove = (ev: MouseEvent) => {
      const dy = startY - ev.clientY;
      const next = Math.max(160, Math.min(window.innerHeight - 220, startH + dy));
      setPanel(p => ({ ...p, height: next }));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const editingProject = useMemo(
    () => state.projects.find(p => p.id === editingProjectId) ?? null,
    [state.projects, editingProjectId],
  );

  return (
    <>
    <div className="flex h-screen w-screen flex-col">
      {/* Toolbar */}
      <div className="relative z-10 flex items-center gap-2 border-b border-ink-200/80 bg-white/70 px-4 py-2.5 backdrop-blur-md">
        <button
          onClick={() => navigate('/')}
          className="mr-1 inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12px] font-medium text-ink-500 transition hover:bg-ink-100 hover:text-ink-900"
          title="Back to all plans"
        >
          ← Plans
        </button>
        <input
          className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2.5 py-1.5 text-[14px] font-semibold text-ink-900 outline-none transition hover:bg-ink-100/70 focus:border-ink-300 focus:bg-white focus:ring-2 focus:ring-brand-200"
          value={state.title}
          onChange={e => setTitle(e.target.value)}
        />
        <Presence conn={conn} peers={peers} />
        <ToolbarButton subtle onClick={addPastIteration} title="Add an iteration before the first one">
          ← Past iteration
        </ToolbarButton>
        <ToolbarButton onClick={addIteration}>+ Iteration</ToolbarButton>
        <ToolbarButton onClick={() => addPerson()}>+ Person</ToolbarButton>
        <ToolbarButton
          subtle
          onClick={() => setTransposed(t => !t)}
          title={transposed ? 'Switch back to people-as-rows view' : 'Swap rows and columns (weeks as rows)'}
        >
          {transposed ? '⇆ People as rows' : '⇆ Weeks as rows'}
        </ToolbarButton>
        <ToolbarButton subtle onClick={clearAssignments}>Clear chart</ToolbarButton>
      </div>

      <div className={'flex min-h-0 flex-1 ' + (transposed ? 'flex-row' : 'flex-col')}>
        {/* Chart pane */}
        <div ref={chartScrollRef} className={'min-h-0 min-w-0 flex-1 overflow-auto ' + (transposed ? 'm-4 mr-2' : 'm-4 mb-6')}>
          {transposed ? (
            <ChartTransposed
              state={state}
              allWeeks={allWeeks}
              projectsById={projectsById}
              collapsedIterationIds={collapsedIterationIds}
              currentIterationId={currentIterationId}
              iterationToneById={iterationToneById}
              toggleIterationCollapsed={toggleIterationCollapsed}
              renamePerson={renamePerson}
              removePerson={removePerson}
              addPerson={addPerson}
              removeIteration={removeIteration}
              setIterationStart={setIterationStart}
              addAssignment={addAssignment}
              moveAssignment={moveAssignment}
              removeAssignment={removeAssignment}
              setWeekNote={setWeekNote}
            />
          ) : (
            <Chart
              state={state}
              allWeeks={allWeeks}
              projectsById={projectsById}
              collapsedIterationIds={collapsedIterationIds}
              currentIterationId={currentIterationId}
              iterationToneById={iterationToneById}
              toggleIterationCollapsed={toggleIterationCollapsed}
              renamePerson={renamePerson}
              removePerson={removePerson}
              addPerson={addPerson}
              removeIteration={removeIteration}
              setIterationStart={setIterationStart}
              addAssignment={addAssignment}
              moveAssignment={moveAssignment}
              removeAssignment={removeAssignment}
              setWeekNote={setWeekNote}
            />
          )}
        </div>

        {/* Resize grabber (only when expanded) */}
        {!panel.collapsed && (
          <div
            className={
              transposed
                ? 'group relative w-2 cursor-col-resize border-x border-ink-200 bg-ink-50/60'
                : 'group relative h-2 cursor-row-resize border-y border-ink-200 bg-ink-50/60'
            }
            onMouseDown={onResizeStart}
            title="Drag to resize"
          >
            <div
              className={
                transposed
                  ? 'pointer-events-none absolute left-1/2 top-1/2 h-9 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink-300 opacity-60 transition group-hover:bg-ink-400 group-hover:opacity-100'
                  : 'pointer-events-none absolute left-1/2 top-1/2 h-[3px] w-9 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink-300 opacity-60 transition group-hover:bg-ink-400 group-hover:opacity-100'
              }
            />
          </div>
        )}

        {/* Projects panel */}
        <div
          className={
            transposed
              ? 'flex flex-col overflow-hidden border-l border-ink-200 bg-white shadow-[-2px_0_24px_rgba(15,23,42,0.04)] transition-[width] duration-200 ease-out'
              : 'flex flex-col overflow-hidden border-t border-ink-200 bg-white shadow-[0_-2px_24px_rgba(15,23,42,0.04)] transition-[height] duration-200 ease-out'
          }
          style={transposed ? { width: panel.collapsed ? 48 : panel.height } : { height: panel.collapsed ? 48 : panel.height }}
        >
          <div className="flex shrink-0 items-center gap-3 border-b border-ink-200 bg-gradient-to-b from-ink-50/60 to-white px-5 py-2.5">
            <button
              className="-ml-1 flex h-7 w-7 items-center justify-center rounded-md text-ink-500 transition hover:bg-ink-100 hover:text-ink-900"
              onClick={() => setPanel(p => ({ ...p, collapsed: !p.collapsed }))}
              title={panel.collapsed ? 'Expand projects' : 'Collapse projects'}
              aria-label="Toggle projects panel"
            >
              <Chevron open={!panel.collapsed} />
            </button>
            <h2 className="text-[15px] font-semibold tracking-tight text-ink-900">
              Projects
            </h2>
            <span className="rounded-full bg-ink-100 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-ink-600">
              {state.projects.length}
            </span>
            {!panel.collapsed && (
              <span className="hidden text-[12px] text-ink-500 md:inline">
                Drag the colored chip onto a cell, or click any cell to pick.
              </span>
            )}
            <span className="flex-1" />
            <button
              className="inline-flex h-7 items-center gap-1 rounded-md bg-gradient-to-b from-brand-600 to-brand-700 px-3 text-[12px] font-semibold text-white shadow-sm transition hover:from-brand-700 hover:to-brand-700 active:scale-[0.98]"
              onClick={() => {
                if (panel.collapsed) setPanel(p => ({ ...p, collapsed: false }));
                const id = addProject();
                setEditingProjectId(id);
              }}
            >
              <span className="text-[14px] leading-none">+</span> Add project
            </button>
          </div>
          {!panel.collapsed && (
            <div className="flex-1 overflow-auto">
              <ProjectsTable
                projects={state.projects}
                people={state.people}
                peopleById={peopleById}
                plannedByProject={plannedByProject}
                updateProject={updateProject}
                removeProject={removeProject}
                compact={transposed}
                editingId={editingProjectId}
                onStartEdit={id => setEditingProjectId(id)}
                onStopEdit={() => setEditingProjectId(null)}
              />
            </div>
          )}
        </div>
      </div>
    </div>
    {editingProject && (
      <ProjectEditModal
        project={editingProject}
        people={state.people}
        planned={plannedByProject[editingProject.id] ?? 0}
        onUpdate={patch => updateProject(editingProject.id, patch)}
        onRemove={() => removeProject(editingProject.id)}
        onClose={() => setEditingProjectId(null)}
      />
    )}
    </>
  );
}

/* ============================================================ */
/* Brand + tiny widgets                                          */
/* ============================================================ */

function Presence({ conn, peers }: { conn: ConnState; peers: number }) {
  const dotColor =
    conn === 'open' ? 'bg-emerald-500'
    : conn === 'connecting' ? 'bg-amber-500 animate-pulse'
    : 'bg-rose-500';
  const label =
    conn === 'open' ? (peers > 1 ? `${peers} live` : 'Live')
    : conn === 'connecting' ? 'Connecting…'
    : 'Offline';
  const title =
    conn === 'open'
      ? `${peers} ${peers === 1 ? 'person' : 'people'} on this plan`
      : conn === 'connecting' ? 'Connecting to live sync'
      : 'Disconnected — changes will sync when reconnected';
  return (
    <div
      className="inline-flex h-7 items-center gap-1.5 rounded-md border border-ink-200 bg-white px-2.5 text-[11px] font-medium text-ink-600 shadow-sm"
      title={title}
    >
      <span className={'h-2 w-2 rounded-full ' + dotColor} />
      {label}
    </div>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      className={'transition-transform duration-200 ' + (open ? '' : '-rotate-90')}
      aria-hidden
    >
      <path d="M3 5l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ToolbarButton(props: {
  children: React.ReactNode;
  onClick?: () => void;
  subtle?: boolean;
  title?: string;
}) {
  const base =
    'inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12px] font-medium transition active:scale-[0.98]';
  const styled = props.subtle
    ? 'text-ink-500 hover:bg-ink-100 hover:text-ink-900'
    : 'border border-ink-200 bg-white text-ink-800 shadow-sm hover:border-ink-300 hover:bg-ink-50';
  return (
    <button className={base + ' ' + styled} onClick={props.onClick} title={props.title}>
      {props.children}
    </button>
  );
}

function IconButton(props: {
  onClick?: (e: React.MouseEvent) => void;
  title?: string;
  danger?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={props.onClick}
      title={props.title}
      className={
        'inline-flex h-[22px] w-[22px] items-center justify-center rounded text-[14px] leading-none text-ink-400 transition ' +
        (props.danger
          ? 'hover:bg-rose-50 hover:text-rose-600'
          : 'hover:bg-ink-100 hover:text-ink-800') +
        (props.className ? ' ' + props.className : '')
      }
    >
      {props.children}
    </button>
  );
}

/* ============================================================ */
/* Chart                                                         */
/* ============================================================ */

function Chart(props: {
  state: State;
  allWeeks: WeekInfo[];
  projectsById: Record<ID, Project>;
  collapsedIterationIds: Set<ID>;
  currentIterationId: ID | null;
  iterationToneById: Record<ID, IterationTone>;
  toggleIterationCollapsed: (id: ID) => void;
  renamePerson: (id: ID, name: string) => void;
  removePerson: (id: ID) => void;
  addPerson: (name?: string) => void;
  removeIteration: (id: ID) => void;
  setIterationStart: (id: ID, isoDate: string) => void;
  addAssignment: (personId: ID, weekId: string, projectId: ID) => void;
  moveAssignment: (assignmentId: ID, personId: ID, weekId: string) => void;
  removeAssignment: (id: ID) => void;
  setWeekNote: (weekId: string, text: string) => void;
}) {
  const { state, allWeeks, projectsById } = props;
  const [picker, setPicker] = useState<{ personId: ID; weekId: string; rect: DOMRect } | null>(null);
  const iterationRows = useMemo(
    () => state.iterations.map((iter, idx) => ({
      iter,
      idx,
      tone: props.iterationToneById[iter.id] ?? 'future',
      isCollapsed: props.collapsedIterationIds.has(iter.id),
      weeks: allWeeks.filter(w => w.iterationId === iter.id),
    })),
    [allWeeks, props.collapsedIterationIds, props.iterationToneById, state.iterations],
  );
  const visibleWeeks = useMemo(
    () => iterationRows.flatMap(row => row.isCollapsed ? [] : row.weeks),
    [iterationRows],
  );
  const visibleWeekIndexById = useMemo(() => {
    const indexById: Record<string, number> = {};
    visibleWeeks.forEach((week, idx) => {
      indexById[week.id] = idx;
    });
    return indexById;
  }, [visibleWeeks]);
  const timelineColumnCount = iterationRows.reduce(
    (count, row) => count + (row.isCollapsed ? 1 : row.weeks.length),
    0,
  );

  /* ------ Click-drag-to-extend ------
   * When the user grabs the right edge of a chip and drags right, we add
   * assignments for the same project in the consecutive weeks they hover.
   * Live preview is stored in `extending`; we commit on mouseup.
   */
  const [extending, setExtending] = useState<null | {
    personId: ID;
    projectId: ID;
    fromIdx: number;
    toIdx: number;
  }>(null);

  const startExtend = (personId: ID, projectId: ID, weekId: string) => {
    const fromIdx = visibleWeeks.findIndex(w => w.id === weekId);
    if (fromIdx === -1) return;
    setExtending({ personId, projectId, fromIdx, toIdx: fromIdx });

    const onMove = (e: MouseEvent) => {
      const el = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest(
        '[data-cell="1"]',
      ) as HTMLElement | null;
      if (!el) return;
      if (el.dataset.pid !== personId) return;
      const idx = visibleWeeks.findIndex(w => w.id === el.dataset.wid);
      if (idx < fromIdx) return; // only extend forward
      setExtending(prev => (prev && prev.toIdx !== idx ? { ...prev, toIdx: idx } : prev));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      setExtending(curr => {
        if (curr) {
          for (let i = curr.fromIdx + 1; i <= curr.toIdx; i++) {
            const w = visibleWeeks[i];
            if (w) props.addAssignment(curr.personId, w.id, curr.projectId);
          }
        }
        return null;
      });
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <div
      className={
        'inline-block min-w-full overflow-clip rounded-2xl border border-ink-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-12px_rgba(15,23,42,0.08)]' +
        (extending ? ' select-none' : '')
      }
    >
      <table className="border-separate border-spacing-0">
        <thead>
          {/* Iteration row */}
          <tr>
            <th
              rowSpan={2}
              className="sticky left-0 top-0 z-30 w-[200px] min-w-[200px] border-b border-r-2 border-ink-200 border-r-ink-300 bg-ink-50 pl-5 pr-2 py-3 text-left align-bottom text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-500"
            >
              <div className="flex items-center justify-between gap-2">
                <span>Person</span>
                <button
                  type="button"
                  onClick={() => props.addPerson()}
                  title="Add person"
                  className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-ink-200 bg-white text-[14px] font-semibold leading-none text-ink-600 shadow-sm transition hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700"
                >
                  +
                </button>
              </div>
            </th>
            {iterationRows.map(({ iter, idx, tone, isCollapsed }) => {
              const isCurrent = tone === 'current';
              const isPast = tone === 'past';
              return (
                <th
                  key={iter.id}
                  data-iter-id={iter.id}
                  colSpan={isCollapsed ? 1 : 2}
                  className={
                    'sticky top-0 z-20 h-9 border-b-2 border-r-2 px-2 text-[11px] font-semibold uppercase tracking-[0.08em] ' +
                    (isCurrent
                      ? 'border-amber-500 border-r-amber-400/70 bg-amber-100 text-amber-800'
                      : isPast
                        ? 'border-ink-200 border-r-ink-300 bg-ink-100 text-ink-500'
                        : (idx % 2 === 0
                            ? 'border-ink-200 border-r-ink-300 bg-brand-50 text-brand-700'
                            : 'border-ink-200 border-r-ink-300 bg-indigo-50 text-indigo-700'))
                  }
                >
                  <div className="flex items-center justify-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => props.toggleIterationCollapsed(iter.id)}
                      title={isCollapsed ? 'Expand iteration' : 'Collapse iteration'}
                      aria-label={isCollapsed ? 'Expand iteration' : 'Collapse iteration'}
                      className="inline-flex h-4 w-4 items-center justify-center rounded text-current opacity-60 transition hover:bg-white/50 hover:opacity-100"
                    >
                      <Chevron open={!isCollapsed} />
                    </button>
                    <span>Iteration</span>
                    <span
                      className={
                        'rounded px-1 py-px text-[10px] font-medium ' +
                        (isCurrent
                          ? 'bg-white/80 text-amber-700'
                          : isPast ? 'bg-white/70 text-ink-500' : 'bg-white/60 text-ink-500')
                      }
                    >
                      {idx + 1}
                    </span>
                    {isCurrent && (
                      <span
                        className="rounded-full bg-amber-500 px-1.5 py-px text-[9px] font-bold uppercase tracking-[0.08em] text-white"
                        title="Today is in this iteration"
                      >
                        Now
                      </span>
                    )}
                    <label
                      className="relative ml-0.5 inline-flex h-4 w-4 cursor-pointer items-center justify-center rounded text-current opacity-50 transition hover:bg-white/50 hover:opacity-100"
                      title={`Set start date (currently ${iter.startDate})`}
                    >
                      <svg width="11" height="11" viewBox="0 0 14 14" fill="none" aria-hidden>
                        <rect x="2" y="3" width="10" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
                        <path d="M2 6h10" stroke="currentColor" strokeWidth="1.3" />
                        <path d="M5 2v2M9 2v2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                      </svg>
                      <input
                        type="date"
                        value={iter.startDate}
                        onChange={e => {
                          if (e.target.value) props.setIterationStart(iter.id, e.target.value);
                        }}
                        className="absolute inset-0 cursor-pointer opacity-0"
                        aria-label="Iteration start date"
                      />
                    </label>
                    <button
                      onClick={() => {
                        if (confirm('Remove this iteration (both weeks)?')) props.removeIteration(iter.id);
                      }}
                      title="Remove iteration"
                      className="ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded text-current opacity-50 hover:bg-white/50 hover:opacity-100"
                    >
                      ×
                    </button>
                  </div>
                </th>
              );
            })}
            {state.iterations.length === 0 && (
              <th
                rowSpan={2}
                className="sticky top-0 z-20 border-b border-ink-200 bg-ink-50 px-6 py-3 text-left text-[12px] font-normal text-ink-500"
              >
                Click <span className="rounded bg-white px-1.5 py-0.5 font-medium text-ink-700 ring-1 ring-ink-200">+ Iteration</span> to add 2 weeks.
              </th>
            )}
          </tr>
          {/* Week row */}
          <tr>
            {iterationRows.map(({ iter, tone, isCollapsed, weeks }) => {
              const isCurrent = tone === 'current';
              const isPast = tone === 'past';
              const weekToneClass = isCurrent
                ? 'border-amber-300 bg-amber-50 text-amber-800'
                : isPast
                  ? 'border-ink-200 bg-ink-50 text-ink-400'
                  : 'border-ink-200 bg-ink-50/70 text-ink-600';
              if (isCollapsed) {
                return (
                  <th
                    key={`${iter.id}:collapsed`}
                    className={
                      'sticky top-9 z-20 h-8 min-w-[72px] border-b border-r-2 border-r-ink-300 px-2 text-center text-[10px] font-semibold uppercase tracking-[0.06em] ' +
                      weekToneClass
                    }
                  >
                    <button
                      type="button"
                      onClick={() => props.toggleIterationCollapsed(iter.id)}
                      className="rounded px-1.5 py-0.5 transition hover:bg-white/70"
                      title="Expand iteration"
                    >
                      2 wk hidden
                    </button>
                  </th>
                );
              }
              return weeks.map((w, weekIdx) => {
                const isIterEnd = weekIdx === weeks.length - 1;
                return (
                  <th
                    key={w.id}
                    className={
                      'sticky top-9 z-20 h-8 min-w-[132px] border-b px-2 text-center text-[11px] font-medium tabular-nums ' +
                      weekToneClass +
                      ' border-r ' +
                      (isIterEnd
                        ? (isCurrent ? 'border-r-2 border-r-amber-400/70' : 'border-r-2 border-r-ink-300')
                        : (isCurrent ? 'border-r-amber-200' : 'border-r-ink-200'))
                    }
                  >
                    {w.label}
                  </th>
                );
              });
            })}
          </tr>
        </thead>
        <tbody>
          {state.people.map((person, rowIdx) => (
            <tr key={person.id} className="group/row">
              <td
                className={
                  'sticky left-0 z-10 w-[200px] min-w-[200px] border-b border-r-2 border-ink-200 border-r-ink-300 px-3 py-2 align-middle ' +
                  (rowIdx % 2 === 0 ? 'bg-white' : 'bg-ink-50')
                }
              >
                <div className="flex items-center gap-1">
                  <input
                    value={person.name}
                    onChange={e => props.renamePerson(person.id, e.target.value)}
                    className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-2 py-1 text-[13px] font-medium text-ink-900 outline-none transition hover:bg-white hover:shadow-sm focus:border-ink-300 focus:bg-white focus:ring-2 focus:ring-brand-200"
                  />
                  <IconButton
                    danger
                    title="Remove person"
                    className="opacity-0 group-hover/row:opacity-100 focus:opacity-100"
                    onClick={() => {
                      if (confirm(`Remove ${person.name}?`)) props.removePerson(person.id);
                    }}
                  >
                    ×
                  </IconButton>
                </div>
              </td>
              {iterationRows.map(({ iter, tone, isCollapsed, weeks }) => {
                if (isCollapsed) {
                  const weekIds = new Set(weeks.map(w => w.id));
                  const collapsedAssigns = state.assignments.filter(
                    a => a.personId === person.id && weekIds.has(a.weekId),
                  );
                  const isDri = collapsedAssigns.some(
                    a => lookupProject(projectsById, a.projectId)?.driId === person.id,
                  );
                  return (
                    <CollapsedIterationCell
                      key={`${iter.id}:collapsed:${person.id}`}
                      rowAlt={rowIdx % 2 === 1}
                      tone={tone}
                      assignmentCount={collapsedAssigns.length}
                      isDri={isDri}
                      isIterEnd
                      onExpand={() => props.toggleIterationCollapsed(iter.id)}
                    />
                  );
                }
                return weeks.map((w, weekIdx) => {
                  const cellAssigns = state.assignments.filter(
                    a => a.personId === person.id && a.weekId === w.id,
                  );
                  const isDri = cellAssigns.some(
                    a => lookupProject(projectsById, a.projectId)?.driId === person.id,
                  );
                  const visibleWeekIdx = visibleWeekIndexById[w.id] ?? -1;
                  const inExtendPreview =
                    !!extending &&
                    extending.personId === person.id &&
                    visibleWeekIdx > extending.fromIdx &&
                    visibleWeekIdx <= extending.toIdx;
                  const extendPreviewProject = inExtendPreview
                    ? lookupProject(projectsById, extending!.projectId)
                    : undefined;
                  return (
                    <Cell
                      key={w.id}
                      rowAlt={rowIdx % 2 === 1}
                      personId={person.id}
                      weekId={w.id}
                      assignments={cellAssigns}
                      projectsById={projectsById}
                      isDri={isDri}
                      isIterEnd={weekIdx === weeks.length - 1}
                      isCurrentWeek={tone === 'current'}
                      isPastWeek={tone === 'past'}
                      extendPreviewProject={extendPreviewProject}
                      onAdd={pid => props.addAssignment(person.id, w.id, pid)}
                      onMove={aid => props.moveAssignment(aid, person.id, w.id)}
                      onRemove={props.removeAssignment}
                      onPick={rect => setPicker({ personId: person.id, weekId: w.id, rect })}
                      onStartExtend={(projectId) => startExtend(person.id, projectId, w.id)}
                    />
                  );
                });
              })}
            </tr>
          ))}
          <tr className="group/notesrow">
            <td
              className="sticky left-0 z-10 w-[200px] min-w-[200px] border-t-2 border-b border-r-2 border-ink-200 border-r-ink-300 bg-ink-50 px-5 py-2 align-middle text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-500"
            >
              Notes
            </td>
            {iterationRows.map(({ iter, tone, isCollapsed, weeks }) => {
              if (isCollapsed) {
                const noteCount = weeks.filter(w => state.weekNotes?.[w.id]?.trim()).length;
                return (
                  <CollapsedNotesCell
                    key={`${iter.id}:notes-collapsed`}
                    tone={tone}
                    noteCount={noteCount}
                    topBorder
                    onExpand={() => props.toggleIterationCollapsed(iter.id)}
                  />
                );
              }
              return weeks.map((w, weekIdx) => {
                const note = state.weekNotes?.[w.id] ?? '';
                return (
                  <td
                    key={w.id}
                    className={
                      'h-[44px] min-w-[132px] border-t-2 border-b border-r border-ink-200 p-1 align-middle ' +
                      (tone === 'current'
                        ? 'bg-amber-50/40'
                        : tone === 'past' ? 'bg-ink-50/70' : 'bg-white') +
                      (weekIdx === weeks.length - 1 ? ' border-r-2 border-r-ink-300' : '')
                    }
                  >
                    <WeekNoteTextarea
                      value={note}
                      onChange={text => props.setWeekNote(w.id, text)}
                      title={note || 'Add a note for this week'}
                      muted={tone === 'past'}
                    />
                  </td>
                );
              });
            })}
          </tr>
          {state.people.length === 0 && (
            <tr>
              <td
                colSpan={Math.max(1, 1 + timelineColumnCount)}
                className="px-6 py-10 text-center text-[13px] text-ink-500"
              >
                Add a person above to get started.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {picker && (
        <ProjectPicker
          rect={picker.rect}
          projects={state.projects}
          onPick={pid => {
            props.addAssignment(picker.personId, picker.weekId, pid);
            setPicker(null);
          }}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  );
}

function CollapsedIterationCell(props: {
  rowAlt: boolean;
  tone: IterationTone;
  assignmentCount: number;
  isDri: boolean;
  isIterEnd?: boolean;
  onExpand: () => void;
}) {
  const bg =
    props.tone === 'current'
      ? (props.rowAlt ? 'bg-amber-50/60 hover:bg-amber-50' : 'bg-amber-50/40 hover:bg-amber-50')
      : props.tone === 'past'
        ? (props.rowAlt ? 'bg-ink-100/70 hover:bg-ink-100' : 'bg-ink-50/80 hover:bg-ink-100')
        : props.rowAlt
          ? 'bg-ink-50/40 hover:bg-brand-50/40'
          : 'bg-white hover:bg-brand-50/40';

  return (
    <td
      className={
        'h-[64px] min-w-[72px] cursor-pointer border-b border-r border-ink-200 px-1.5 py-1 align-middle text-center transition-colors ' +
        bg +
        (props.isIterEnd ? ' border-r-2 border-r-ink-300' : '')
      }
      onClick={props.onExpand}
      title="Iteration is collapsed. Click to expand."
    >
      <div className="flex flex-col items-center justify-center gap-0.5 text-ink-400">
        <span className="inline-flex min-w-6 items-center justify-center gap-1 rounded-full border border-ink-200 bg-white/70 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-ink-500">
          {props.isDri && <span className="text-[9px] text-amber-500">★</span>}
          {props.assignmentCount || '—'}
        </span>
        <span className="text-[8.5px] font-semibold uppercase tracking-[0.08em]">
          Hidden
        </span>
      </div>
    </td>
  );
}

function CollapsedNotesCell(props: {
  tone: IterationTone;
  noteCount: number;
  topBorder?: boolean;
  onExpand: () => void;
}) {
  const bg =
    props.tone === 'current'
      ? 'bg-amber-50/40 hover:bg-amber-50'
      : props.tone === 'past'
        ? 'bg-ink-50/70 hover:bg-ink-100'
        : 'bg-white hover:bg-brand-50/40';

  return (
    <td
      className={
        'h-[44px] min-w-[72px] cursor-pointer border-b border-r-2 border-r-ink-300 border-ink-200 px-1.5 py-1 align-middle text-center transition-colors ' +
        bg +
        (props.topBorder ? ' border-t-2' : '')
      }
      onClick={props.onExpand}
      title="Iteration notes are collapsed. Click to expand."
    >
      <span className="text-[10px] font-medium text-ink-400">
        {props.noteCount ? `${props.noteCount} note${props.noteCount === 1 ? '' : 's'}` : 'Hidden'}
      </span>
    </td>
  );
}

function WeekNoteTextarea(props: {
  value: string;
  onChange: (text: string) => void;
  title?: string;
  compact?: boolean;
  muted?: boolean;
}) {
  return (
    <textarea
      value={props.value}
      onChange={e => props.onChange(e.target.value)}
      placeholder="Add note…"
      title={props.title}
      rows={props.compact ? 2 : 3}
      className={
        'block w-full resize-y rounded border border-transparent bg-transparent px-2 py-1.5 text-[12px] leading-snug outline-none transition placeholder:text-ink-300 hover:bg-white hover:shadow-sm focus:border-ink-300 focus:bg-white focus:ring-2 focus:ring-brand-200 ' +
        (props.compact ? 'min-h-[56px] ' : 'min-h-[72px] ') +
        (props.muted ? 'text-ink-500' : 'text-ink-700')
      }
    />
  );
}

/* ============================================================ */
/* ChartTransposed — weeks as rows, people as columns           */
/* ============================================================ */

function ChartTransposed(props: {
  state: State;
  allWeeks: WeekInfo[];
  projectsById: Record<ID, Project>;
  collapsedIterationIds: Set<ID>;
  currentIterationId: ID | null;
  iterationToneById: Record<ID, IterationTone>;
  toggleIterationCollapsed: (id: ID) => void;
  renamePerson: (id: ID, name: string) => void;
  removePerson: (id: ID) => void;
  addPerson: (name?: string) => void;
  removeIteration: (id: ID) => void;
  setIterationStart: (id: ID, isoDate: string) => void;
  addAssignment: (personId: ID, weekId: string, projectId: ID) => void;
  moveAssignment: (assignmentId: ID, personId: ID, weekId: string) => void;
  removeAssignment: (id: ID) => void;
  setWeekNote: (weekId: string, text: string) => void;
}) {
  const { state, allWeeks, projectsById } = props;
  const [picker, setPicker] = useState<{ personId: ID; weekId: string; rect: DOMRect } | null>(null);
  const iterationRows = useMemo(
    () => state.iterations.map((iter, idx) => ({
      iter,
      idx,
      tone: props.iterationToneById[iter.id] ?? 'future',
      isCollapsed: props.collapsedIterationIds.has(iter.id),
      weeks: allWeeks.filter(w => w.iterationId === iter.id),
    })),
    [allWeeks, props.collapsedIterationIds, props.iterationToneById, state.iterations],
  );
  const visibleWeeks = useMemo(
    () => iterationRows.flatMap(row => row.isCollapsed ? [] : row.weeks),
    [iterationRows],
  );
  const visibleWeekIndexById = useMemo(() => {
    const indexById: Record<string, number> = {};
    visibleWeeks.forEach((week, idx) => {
      indexById[week.id] = idx;
    });
    return indexById;
  }, [visibleWeeks]);
  const [extending, setExtending] = useState<null | {
    personId: ID;
    projectId: ID;
    fromIdx: number;
    toIdx: number;
  }>(null);

  const startExtend = (personId: ID, projectId: ID, weekId: string) => {
    const fromIdx = visibleWeeks.findIndex(w => w.id === weekId);
    if (fromIdx === -1) return;
    setExtending({ personId, projectId, fromIdx, toIdx: fromIdx });
    const onMove = (e: MouseEvent) => {
      const el = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest(
        '[data-cell="1"]',
      ) as HTMLElement | null;
      if (!el) return;
      if (el.dataset.pid !== personId) return;
      const idx = visibleWeeks.findIndex(w => w.id === el.dataset.wid);
      if (idx < fromIdx) return;
      setExtending(prev => (prev && prev.toIdx !== idx ? { ...prev, toIdx: idx } : prev));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      setExtending(curr => {
        if (curr) {
          for (let i = curr.fromIdx + 1; i <= curr.toIdx; i++) {
            const w = visibleWeeks[i];
            if (w) props.addAssignment(curr.personId, w.id, curr.projectId);
          }
        }
        return null;
      });
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // Sticky column widths
  const ITER_W = 96;
  const WEEK_W = 96;

  return (
    <div
      className={
        'inline-block min-w-full overflow-clip rounded-2xl border border-ink-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-12px_rgba(15,23,42,0.08)]' +
        (extending ? ' select-none' : '')
      }
    >
      <table className="w-full border-separate border-spacing-0">
        <thead>
          <tr>
            {/* corner: iteration col */}
            <th
              style={{ left: 0, width: ITER_W, minWidth: ITER_W }}
              className="sticky top-0 z-30 h-9 border-b border-r border-ink-200 bg-ink-50 px-2 py-2 text-left align-middle text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-500"
            >
              Iteration
            </th>
            {/* corner: week col */}
            <th
              style={{ left: ITER_W, width: WEEK_W, minWidth: WEEK_W }}
              className="sticky top-0 z-30 h-9 border-b border-r border-ink-200 bg-ink-50 px-2 py-2 text-left align-middle text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-500"
            >
              Week
            </th>
            {state.people.map(person => (
              <th
                key={person.id}
                className="group/col sticky top-0 z-20 h-9 min-w-[140px] border-b border-r border-ink-200 bg-ink-50 px-2 py-1 text-left align-middle"
              >
                <div className="flex items-center gap-1">
                  <input
                    value={person.name}
                    onChange={e => props.renamePerson(person.id, e.target.value)}
                    className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-2 py-1 text-[12.5px] font-semibold text-ink-900 outline-none transition hover:bg-white hover:shadow-sm focus:border-ink-300 focus:bg-white focus:ring-2 focus:ring-brand-200"
                  />
                  <IconButton
                    danger
                    title="Remove person"
                    className="opacity-0 group-hover/col:opacity-100 focus:opacity-100"
                    onClick={() => {
                      if (confirm(`Remove ${person.name}?`)) props.removePerson(person.id);
                    }}
                  >
                    ×
                  </IconButton>
                </div>
              </th>
            ))}
            {/* + Person */}
            <th className="sticky top-0 z-20 h-9 w-10 border-b border-r border-ink-200 bg-ink-50 px-1 align-middle">
              <button
                type="button"
                onClick={() => props.addPerson()}
                title="Add person"
                className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-ink-200 bg-white text-[14px] font-semibold leading-none text-ink-600 shadow-sm transition hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700"
              >
                +
              </button>
            </th>
            {/* Notes col */}
            <th className="sticky top-0 z-20 h-9 w-[220px] min-w-[180px] border-b border-ink-200 bg-ink-50 px-3 align-middle text-left text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-500">
              Notes
            </th>
          </tr>
        </thead>
        <tbody>
          {state.iterations.length === 0 && (
            <tr>
              <td
                colSpan={4 + state.people.length}
                className="px-6 py-10 text-center text-[13px] text-ink-500"
              >
                Click <span className="rounded bg-white px-1.5 py-0.5 font-medium text-ink-700 ring-1 ring-ink-200">+ Iteration</span> to add 2 weeks.
              </td>
            </tr>
          )}
          {iterationRows.map(({ iter, idx: iterIdx, tone, isCollapsed, weeks }) => {
            const isCurrent = tone === 'current';
            const isPast = tone === 'past';
            const iterBg = isCurrent
              ? 'bg-amber-100 text-amber-800'
              : isPast
                ? 'bg-ink-100 text-ink-500'
                : (iterIdx % 2 === 0 ? 'bg-brand-50 text-brand-700' : 'bg-indigo-50 text-indigo-700');
            const weekBg = isCurrent
              ? 'bg-amber-50 text-amber-800'
              : isPast ? 'bg-ink-50 text-ink-400' : 'bg-ink-50/70 text-ink-600';
            const iterationControls = (
              <div className="flex flex-col items-start gap-1">
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => props.toggleIterationCollapsed(iter.id)}
                    title={isCollapsed ? 'Expand iteration' : 'Collapse iteration'}
                    aria-label={isCollapsed ? 'Expand iteration' : 'Collapse iteration'}
                    className="inline-flex h-4 w-4 items-center justify-center rounded text-current opacity-60 transition hover:bg-white/50 hover:opacity-100"
                  >
                    <Chevron open={!isCollapsed} />
                  </button>
                  <span>Iter {iterIdx + 1}</span>
                  {isCurrent && (
                    <span
                      className="rounded-full bg-amber-500 px-1.5 py-px text-[8px] font-bold uppercase tracking-[0.08em] text-white"
                      title="Today is in this iteration"
                    >
                      Now
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-0.5">
                  <label
                    className="relative inline-flex h-4 w-4 cursor-pointer items-center justify-center rounded text-current opacity-50 transition hover:bg-white/50 hover:opacity-100"
                    title={`Set start date (currently ${iter.startDate})`}
                  >
                    <svg width="11" height="11" viewBox="0 0 14 14" fill="none" aria-hidden>
                      <rect x="2" y="3" width="10" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
                      <path d="M2 6h10" stroke="currentColor" strokeWidth="1.3" />
                      <path d="M5 2v2M9 2v2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                    </svg>
                    <input
                      type="date"
                      value={iter.startDate}
                      onChange={e => {
                        if (e.target.value) props.setIterationStart(iter.id, e.target.value);
                      }}
                      className="absolute inset-0 cursor-pointer opacity-0"
                      aria-label="Iteration start date"
                    />
                  </label>
                  <button
                    onClick={() => {
                      if (confirm('Remove this iteration (both weeks)?')) props.removeIteration(iter.id);
                    }}
                    title="Remove iteration"
                    className="inline-flex h-4 w-4 items-center justify-center rounded text-current opacity-50 hover:bg-white/50 hover:opacity-100"
                  >
                    ×
                  </button>
                </div>
              </div>
            );

            if (isCollapsed) {
              const weekIds = new Set(weeks.map(w => w.id));
              const noteCount = weeks.filter(w => state.weekNotes?.[w.id]?.trim()).length;
              return (
                <tr key={`${iter.id}:collapsed`} className="group/row">
                  <td
                    data-iter-id={iter.id}
                    style={{ left: 0, width: ITER_W, minWidth: ITER_W }}
                    className={
                      'sticky z-10 border-b border-r border-ink-200 px-2 py-2 align-top text-[11px] font-semibold uppercase tracking-[0.06em] ' +
                      iterBg
                    }
                  >
                    {iterationControls}
                  </td>
                  <td
                    style={{ left: ITER_W, width: WEEK_W, minWidth: WEEK_W }}
                    className={
                      'sticky z-10 border-b border-r border-ink-200 px-2 py-2 align-middle text-center text-[10px] font-semibold uppercase tracking-[0.06em] ' +
                      weekBg
                    }
                  >
                    <button
                      type="button"
                      onClick={() => props.toggleIterationCollapsed(iter.id)}
                      className="rounded px-1.5 py-0.5 transition hover:bg-white/70"
                      title="Expand iteration"
                    >
                      2 wk hidden
                    </button>
                  </td>
                  {state.people.map((person, colIdx) => {
                    const collapsedAssigns = state.assignments.filter(
                      a => a.personId === person.id && weekIds.has(a.weekId),
                    );
                    const isDri = collapsedAssigns.some(
                      a => lookupProject(projectsById, a.projectId)?.driId === person.id,
                    );
                    return (
                      <CollapsedIterationCell
                        key={person.id}
                        rowAlt={colIdx % 2 === 1}
                        tone={tone}
                        assignmentCount={collapsedAssigns.length}
                        isDri={isDri}
                        onExpand={() => props.toggleIterationCollapsed(iter.id)}
                      />
                    );
                  })}
                  <td className={'border-b border-r border-ink-200 ' + (isCurrent ? 'bg-amber-50/40' : isPast ? 'bg-ink-50/70' : '')}></td>
                  <CollapsedNotesCell
                    tone={tone}
                    noteCount={noteCount}
                    onExpand={() => props.toggleIterationCollapsed(iter.id)}
                  />
                </tr>
              );
            }

            return weeks.map((w, weekIdx) => {
              const visibleWeekIdx = visibleWeekIndexById[w.id] ?? -1;
              return (
                <tr key={w.id} className="group/row">
                  {weekIdx === 0 && (
                    <td
                      data-iter-id={iter.id}
                      rowSpan={weeks.length}
                      style={{ left: 0, width: ITER_W, minWidth: ITER_W }}
                      className={
                        'sticky z-10 border-b border-r border-ink-200 px-2 py-2 align-top text-[11px] font-semibold uppercase tracking-[0.06em] ' +
                        iterBg
                      }
                    >
                      {iterationControls}
                    </td>
                  )}
                  <td
                    style={{ left: ITER_W, width: WEEK_W, minWidth: WEEK_W }}
                    className={
                      'sticky z-10 border-b border-r border-ink-200 px-2 py-2 align-middle text-[11px] font-medium tabular-nums ' +
                      weekBg
                    }
                  >
                    {w.label}
                  </td>
                  {state.people.map((person, colIdx) => {
                    const cellAssigns = state.assignments.filter(
                      a => a.personId === person.id && a.weekId === w.id,
                    );
                    const isDri = cellAssigns.some(
                      a => lookupProject(projectsById, a.projectId)?.driId === person.id,
                    );
                    const inExtendPreview =
                      !!extending &&
                      extending.personId === person.id &&
                      visibleWeekIdx > extending.fromIdx &&
                      visibleWeekIdx <= extending.toIdx;
                    const extendPreviewProject = inExtendPreview
                      ? lookupProject(projectsById, extending!.projectId)
                      : undefined;
                    return (
                      <Cell
                        key={person.id}
                        rowAlt={colIdx % 2 === 1}
                        personId={person.id}
                        weekId={w.id}
                        assignments={cellAssigns}
                        projectsById={projectsById}
                        isDri={isDri}
                        isIterEnd={false}
                        isCurrentWeek={isCurrent}
                        isPastWeek={isPast}
                        extendPreviewProject={extendPreviewProject}
                        onAdd={pid => props.addAssignment(person.id, w.id, pid)}
                        onMove={aid => props.moveAssignment(aid, person.id, w.id)}
                        onRemove={props.removeAssignment}
                        onPick={rect => setPicker({ personId: person.id, weekId: w.id, rect })}
                        onStartExtend={(projectId) => startExtend(person.id, projectId, w.id)}
                      />
                    );
                  })}
                  {/* + Person spacer cell to match header */}
                  <td className={'border-b border-r border-ink-200 ' + (isCurrent ? 'bg-amber-50/40' : isPast ? 'bg-ink-50/70' : '')}></td>
                  {/* Notes col */}
                  <td
                    className={
                      'border-b border-l border-ink-200 p-1 align-middle ' +
                      (isCurrent ? 'bg-amber-50/40' : isPast ? 'bg-ink-50/70' : 'bg-white')
                    }
                  >
                    <WeekNoteTextarea
                      value={state.weekNotes?.[w.id] ?? ''}
                      onChange={text => props.setWeekNote(w.id, text)}
                      title={state.weekNotes?.[w.id] || 'Add a note for this week'}
                      compact
                      muted={isPast}
                    />
                  </td>
                </tr>
              );
            });
          })}
        </tbody>
      </table>

      {picker && (
        <ProjectPicker
          rect={picker.rect}
          projects={state.projects}
          onPick={pid => {
            props.addAssignment(picker.personId, picker.weekId, pid);
            setPicker(null);
          }}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  );
}

function Cell(props: {
  personId: ID;
  weekId: string;
  assignments: Assignment[];
  projectsById: Record<ID, Project>;
  isDri: boolean;
  isIterEnd: boolean;
  isCurrentWeek: boolean;
  isPastWeek: boolean;
  rowAlt: boolean;
  extendPreviewProject?: Project;
  onAdd: (projectId: ID) => void;
  onMove: (assignmentId: ID) => void;
  onRemove: (assignmentId: ID) => void;
  onPick: (rect: DOMRect) => void;
  onStartExtend: (projectId: ID) => void;
}) {
  const [hover, setHover] = useState(false);
  const cellRef = useRef<HTMLTableCellElement>(null);

  const onDragOver = (e: React.DragEvent) => {
    if (
      e.dataTransfer.types.includes('application/x-project') ||
      e.dataTransfer.types.includes('application/x-assignment')
    ) {
      e.preventDefault();
      e.dataTransfer.dropEffect = e.dataTransfer.types.includes('application/x-assignment') ? 'move' : 'copy';
      setHover(true);
    }
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setHover(false);
    const aid = e.dataTransfer.getData('application/x-assignment');
    if (aid) return props.onMove(aid);
    const pid = e.dataTransfer.getData('application/x-project');
    if (pid) props.onAdd(pid);
  };

  const baseBg = props.isCurrentWeek
    ? (props.rowAlt ? 'bg-amber-50/60 hover:bg-amber-50' : 'bg-amber-50/40 hover:bg-amber-50')
    : props.isPastWeek
    ? (props.rowAlt ? 'bg-ink-100/70 hover:bg-ink-100' : 'bg-ink-50/80 hover:bg-ink-100')
    : props.rowAlt
    ? 'bg-ink-50/40 hover:bg-brand-50/40'
    : 'bg-white hover:bg-brand-50/40';

  return (
    <td
      ref={cellRef}
      data-cell="1"
      data-pid={props.personId}
      data-wid={props.weekId}
      className={
        'group/cell relative h-[64px] min-w-[132px] cursor-pointer border-b border-r border-ink-200 p-1 align-middle transition-colors ' +
        baseBg +
        (props.isIterEnd ? ' border-r-2 border-r-ink-300' : '') +
        (hover ? ' !bg-brand-50 ring-2 ring-inset ring-brand-400' : '') +
        (props.extendPreviewProject ? ' ring-2 ring-inset ring-brand-400/70' : '')
      }
      onDragOver={onDragOver}
      onDragLeave={() => setHover(false)}
      onDrop={onDrop}
      onClick={() => cellRef.current && props.onPick(cellRef.current.getBoundingClientRect())}
      title="Click to add a project, or drag one in"
    >
      <div className="flex min-h-[56px] flex-col items-center justify-center gap-1">
        {props.assignments.length === 0 && !props.extendPreviewProject && (
          <span
            className={
              'pointer-events-none select-none text-ink-300 transition ' +
              (hover
                ? 'text-[11px] italic font-medium text-brand-600 opacity-100'
                : 'text-[18px] font-light opacity-0 group-hover/cell:opacity-60')
            }
          >
            {hover ? 'drop here' : '+'}
          </span>
        )}
        {props.extendPreviewProject && (
          <span
            className={
              'pointer-events-none select-none rounded-full border border-dashed border-brand-500/70 px-2.5 py-[3px] text-[11px] font-semibold leading-none opacity-80'
            }
            style={{
              background: isPto(props.extendPreviewProject.id)
                ? 'transparent'
                : props.extendPreviewProject.color,
              color: isPto(props.extendPreviewProject.id)
                ? '#475569'
                : inkFor(props.extendPreviewProject.color),
            }}
          >
            {props.extendPreviewProject.name}
          </span>
        )}
        {props.assignments.map(a => {
          const proj = lookupProject(props.projectsById, a.projectId);
          if (!proj) return null;
          return (
            <AssignChip
              key={a.id}
              project={proj}
              isPto={isPto(a.projectId)}
              isOwnDri={proj.driId === props.personId}
              muted={props.isPastWeek}
              onDragStart={e => {
                e.dataTransfer.setData('application/x-assignment', a.id);
                e.dataTransfer.effectAllowed = 'move';
              }}
              onClick={e => {
                e.stopPropagation();
                if (proj.url) window.open(proj.url, '_blank', 'noopener,noreferrer');
              }}
              onRemove={() => props.onRemove(a.id)}
              onStartExtend={() => props.onStartExtend(a.projectId)}
            />
          );
        })}
      </div>
    </td>
  );
}

function AssignChip(props: {
  project: Project;
  isPto?: boolean;
  isOwnDri: boolean;
  muted?: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onClick: (e: React.MouseEvent) => void;
  onRemove: () => void;
  onStartExtend: () => void;
}) {
  const { project, isOwnDri, isPto: pto } = props;
  const ink = pto ? '#475569' : inkFor(project.color);
  const baseClass =
    'group/chip relative inline-flex max-w-full min-w-0 cursor-grab items-center gap-1 rounded-full px-2.5 py-[3px] pr-3 text-left text-[11px] font-semibold leading-tight transition-transform active:cursor-grabbing hover:-translate-y-px';
  const chipStyle = pto ? { color: ink } : { background: project.color, color: ink };
  const mutedStyle = props.muted
    ? { ...chipStyle, filter: 'saturate(0.55)', opacity: 0.72 }
    : chipStyle;
  return (
    <span
      draggable
      onDragStart={props.onDragStart}
      onClick={props.onClick}
      title={
        pto
          ? 'PTO'
          : project.name +
            (isOwnDri ? ' · DRI' : '') +
            (project.url ? `\nClick to open ${project.url}` : '')
      }
      className={
        baseClass +
        ' ' +
        (pto
          ? 'border border-dashed border-ink-400/60 bg-[repeating-linear-gradient(135deg,#f1f5f9_0_6px,#e2e8f0_6px_12px)] uppercase tracking-[0.06em]'
          : 'border border-black/[0.06] shadow-[inset_0_1px_0_rgba(255,255,255,0.5),0_1px_1px_rgba(15,23,42,0.05)]') +
        (project.url && !pto ? ' cursor-pointer' : '')
      }
      style={mutedStyle}
    >
      {pto ? (
        <span className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center text-[10px]" aria-hidden>
          ☀
        </span>
      ) : (
        isOwnDri && (
          <span
            className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-white/70 text-[8px] font-bold"
            title="DRI"
          >
            ★
          </span>
        )
      )}
      <span className="min-w-0 whitespace-normal break-words leading-tight">
        {project.name}
      </span>
      <span
        onClick={e => {
          e.stopPropagation();
          props.onRemove();
        }}
        className="ml-0.5 inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold opacity-0 transition group-hover/chip:opacity-60 hover:!opacity-100 hover:bg-black/15"
      >
        ×
      </span>
      {/* Right-edge handle: drag to extend this assignment across consecutive weeks */}
      <span
        onMouseDown={e => {
          // Suppress native HTML5 drag (the chip itself is draggable for moves)
          // and the cell-click that would open the picker, then start extend.
          e.preventDefault();
          e.stopPropagation();
          props.onStartExtend();
        }}
        onClick={e => e.stopPropagation()}
        onDragStart={e => e.preventDefault()}
        title="Drag right to extend across more weeks"
        className="absolute right-0 top-0 z-10 flex h-full w-2 cursor-col-resize items-center justify-center opacity-0 transition group-hover/chip:opacity-100"
      >
        <span
          className="block h-3 w-[2px] rounded-full bg-current opacity-60"
          aria-hidden
        />
      </span>
    </span>
  );
}

/* ============================================================ */
/* Projects table                                                */
/* ============================================================ */

type SortKey = 'name' | 'estimated' | 'planned';
type SortDir = 'asc' | 'desc';

function ProjectsTable(props: {
  projects: Project[];
  people: Person[];
  peopleById: Record<ID, Person>;
  plannedByProject: Record<ID, number>;
  updateProject: (id: ID, p: Partial<Project>) => void;
  removeProject: (id: ID) => void;
  compact?: boolean;
  editingId: ID | null;
  onStartEdit: (id: ID) => void;
  onStopEdit: () => void;
}) {
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const sortedProjects = useMemo(() => {
    if (!sortKey) return props.projects;
    const arr = [...props.projects];
    const dir = sortDir === 'asc' ? 1 : -1;
    arr.sort((a, b) => {
      let av: number | string;
      let bv: number | string;
      if (sortKey === 'name') {
        av = a.name.toLowerCase();
        bv = b.name.toLowerCase();
      } else if (sortKey === 'estimated') {
        av = a.estimatedWeeks ?? -Infinity;
        bv = b.estimatedWeeks ?? -Infinity;
      } else {
        av = props.plannedByProject[a.id] ?? 0;
        bv = props.plannedByProject[b.id] ?? 0;
      }
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
    return arr;
  }, [props.projects, props.plannedByProject, sortKey, sortDir]);

  const totals = useMemo(() => {
    let planned = 0;
    let estimated = 0;
    for (const p of props.projects) {
      planned += props.plannedByProject[p.id] ?? 0;
      if (typeof p.estimatedWeeks === 'number') estimated += p.estimatedWeeks;
    }
    return { planned, estimated };
  }, [props.projects, props.plannedByProject]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'name' ? 'asc' : 'desc');
    }
  };

  const arrow = (key: SortKey) => {
    if (sortKey !== key) return <span className="ml-1 text-ink-300">↕</span>;
    return <span className="ml-1 text-brand-600">{sortDir === 'asc' ? '↑' : '↓'}</span>;
  };

  const sortBtn = (label: string, key: SortKey, extra?: React.ReactNode) => (
    <button
      type="button"
      onClick={() => toggleSort(key)}
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-500 hover:bg-ink-100"
    >
      {label}
      {extra}
      {arrow(key)}
    </button>
  );

  return (
    <div className="flex flex-col">
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-ink-200 bg-ink-50/80 px-3 py-2 backdrop-blur">
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-500">Sort:</span>
        {sortBtn('Project', 'name')}
        {sortBtn('Est.', 'estimated', totals.estimated > 0 && (
          <span className="ml-0.5 normal-case tracking-normal text-ink-400">· {totals.estimated} wk</span>
        ))}
        {sortBtn('Planned', 'planned', (
          <span className="ml-0.5 normal-case tracking-normal text-ink-400">
            · {totals.planned}{totals.estimated > 0 ? ` / ${totals.estimated}` : ''} wk
          </span>
        ))}
      </div>
      {sortedProjects.length === 0 && (
        <div className="px-6 py-12 text-center">
          <div className="mx-auto max-w-sm text-ink-500">
            <div className="mb-2 text-[20px]">🗂️</div>
            <div className="text-[13px]">No projects yet. Click <span className="rounded bg-ink-100 px-1.5 py-0.5 font-semibold">+ Add project</span> above to create one.</div>
          </div>
        </div>
      )}
      <div className="flex flex-col">
        {sortedProjects.map(p => (
          <ProjectRow
            key={p.id}
            project={p}
            people={props.people}
            peopleById={props.peopleById}
            planned={props.plannedByProject[p.id] ?? 0}
            onStartEdit={() => props.onStartEdit(p.id)}
            onUpdate={patch => props.updateProject(p.id, patch)}
            onRemove={() => {
              if (confirm(`Delete project "${p.name}"?`)) {
                if (props.editingId === p.id) props.onStopEdit();
                props.removeProject(p.id);
              }
            }}
            compact={!!props.compact}
          />
        ))}
      </div>
    </div>
  );
}

function ProjectRow(props: {
  project: Project;
  people: Person[];
  peopleById: Record<ID, Person>;
  planned: number;
  onStartEdit: () => void;
  onUpdate: (patch: Partial<Project>) => void;
  onRemove: () => void;
  compact: boolean;
}) {
  const { project, planned } = props;
  const [colorOpen, setColorOpen] = useState(false);
  const swatchRef = useRef<HTMLSpanElement>(null);
  const [colorRect, setColorRect] = useState<DOMRect | null>(null);

  const onChipDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData('application/x-project', project.id);
    e.dataTransfer.effectAllowed = 'copy';
  };

  const est = project.estimatedWeeks;
  let badgeClass = 'bg-ink-100 text-ink-500 border-ink-200';
  let badgeText = `${planned}`;
  if (est != null && est > 0) {
    badgeText = `${planned} / ${est}`;
    if (planned > est) badgeClass = 'bg-rose-50 text-rose-700 border-rose-200 font-semibold';
    else if (planned === est) badgeClass = 'bg-emerald-50 text-emerald-700 border-emerald-200 font-semibold';
    else badgeClass = 'bg-ink-100 text-ink-700 border-ink-200';
  } else if (planned === 0) {
    badgeClass = 'bg-transparent text-ink-400 border-transparent';
  }

  const ink = inkFor(project.color);
  const dri = project.driId ? props.peopleById[project.driId] : null;

  const chip = (
    <>
      <span
        ref={swatchRef}
        draggable
        onDragStart={onChipDragStart}
        onClick={() => {
          if (swatchRef.current) setColorRect(swatchRef.current.getBoundingClientRect());
          setColorOpen(true);
        }}
        title="Drag onto a cell to assign · Click to change color"
        className="inline-flex h-7 w-10 shrink-0 cursor-grab items-center justify-center rounded-full border shadow-[inset_0_1px_0_rgba(255,255,255,0.6),0_1px_2px_rgba(15,23,42,0.06)] transition hover:-translate-y-px hover:shadow-md active:cursor-grabbing"
        style={{ background: project.color, color: ink, borderColor: 'rgba(15,23,42,0.08)' }}
      >
        <span className="text-[9px] tracking-tighter opacity-50">⋮⋮</span>
      </span>
      {colorOpen && colorRect && (
        <ColorPopover
          rect={colorRect}
          value={project.color}
          onPick={c => { props.onUpdate({ color: c }); setColorOpen(false); }}
          onClose={() => setColorOpen(false)}
        />
      )}
    </>
  );

  const plannedBadge = (
    <span
      className={'inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-[3px] text-[12px] tabular-nums ' + badgeClass}
      title={est != null && est > 0 ? `${planned} planned / ${est} estimated eng-weeks` : 'Planned eng-weeks across all assignments'}
    >
      {badgeText} <span className="text-[10.5px] opacity-70">wk</span>
    </span>
  );

  const driBadge = dri ? (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-full border border-ink-200 bg-white px-2.5 py-[3px] text-[12px] text-ink-700"
      title={`DRI: ${dri.name}`}
    >
      <span className="text-[11px] text-amber-500">★</span>
      {dri.name}
    </span>
  ) : (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-full border border-dashed border-ink-200 bg-transparent px-2.5 py-[3px] text-[12px] text-ink-400"
      title="No DRI assigned"
    >
      No DRI
    </span>
  );

  const editBtn = (
    <button
      type="button"
      onClick={props.onStartEdit}
      title="Edit project"
      className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-ink-200 bg-white px-2 text-[12px] text-ink-600 transition hover:bg-ink-50 hover:text-ink-800"
    >
      ✎ Edit
    </button>
  );

  const deleteBtn = (
    <IconButton danger title="Delete project" onClick={props.onRemove}>×</IconButton>
  );

  const titleNode = project.url ? (
    <a
      href={project.url}
      target="_blank"
      rel="noopener noreferrer"
      className="block truncate text-[13px] font-semibold text-ink-900 hover:text-brand-700 hover:underline"
      title={`Open ${project.url}`}
    >
      {project.name || 'Untitled project'}
    </a>
  ) : (
    <span className="block truncate text-[13px] font-semibold text-ink-900">{project.name || 'Untitled project'}</span>
  );

  return (
    <div className="group/row border-b border-ink-100 transition hover:bg-ink-50/60">
      {props.compact ? (
        <div className="flex items-center gap-2 px-3 py-2.5">
          {chip}
          <div className="min-w-0 flex-1">
            {titleNode}
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              {driBadge}
              {plannedBadge}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {editBtn}
            {deleteBtn}
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3 px-4 py-2.5">
          {chip}
          <div className="min-w-0 flex-1">{titleNode}</div>
          {driBadge}
          {plannedBadge}
          {editBtn}
          {deleteBtn}
        </div>
      )}
    </div>
  );
}

function ProjectEditModal(props: {
  project: Project;
  people: Person[];
  planned: number;
  onUpdate: (patch: Partial<Project>) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const { project, planned } = props;
  const swatchRef = useRef<HTMLButtonElement>(null);
  const [colorOpen, setColorOpen] = useState(false);
  const [colorRect, setColorRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') props.onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [props]);

  const ink = inkFor(project.color);
  const est = project.estimatedWeeks;
  let badgeClass = 'bg-ink-100 text-ink-500 border-ink-200';
  let badgeText = `${planned}`;
  if (est != null && est > 0) {
    badgeText = `${planned} / ${est}`;
    if (planned > est) badgeClass = 'bg-rose-50 text-rose-700 border-rose-200 font-semibold';
    else if (planned === est) badgeClass = 'bg-emerald-50 text-emerald-700 border-emerald-200 font-semibold';
    else badgeClass = 'bg-ink-100 text-ink-700 border-ink-200';
  } else if (planned === 0) {
    badgeClass = 'bg-transparent text-ink-400 border-transparent';
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink-900/40 px-4 py-12 backdrop-blur-sm"
      onMouseDown={e => { if (e.target === e.currentTarget) props.onClose(); }}
    >
      <div className="anim-pop-in w-full max-w-lg rounded-2xl border border-ink-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-ink-100 px-5 py-3.5">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">Project</span>
          <button
            type="button"
            onClick={props.onClose}
            title="Close"
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
          <div className="grid grid-cols-[minmax(0,1fr)_110px_auto] items-end gap-3">
            <label className="flex min-w-0 flex-col gap-1">
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
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-500">Estimated wk</span>
              <input
                type="number"
                min={0}
                step={1}
                placeholder="—"
                value={project.estimatedWeeks ?? ''}
                onChange={e => {
                  const v = e.target.value;
                  props.onUpdate({ estimatedWeeks: v === '' ? undefined : Math.max(0, Number(v)) });
                }}
                className="h-9 rounded-md border border-ink-200 bg-white px-2 text-right text-[13px] tabular-nums outline-none transition hover:border-ink-300 focus:border-brand-400 focus:ring-2 focus:ring-brand-200"
              />
            </label>
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-500">Planned</span>
              <div className="flex h-9 items-center">
                <span
                  className={'inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-[3px] text-[12px] tabular-nums ' + badgeClass}
                  title={est != null && est > 0 ? `${planned} planned / ${est} estimated eng-weeks` : 'Planned eng-weeks across all assignments'}
                >
                  {badgeText} <span className="text-[10.5px] opacity-70">wk</span>
                </span>
              </div>
            </div>
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-500">URL (e.g. tracking issue)</span>
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
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-ink-200 bg-white text-ink-500 transition hover:bg-brand-50 hover:text-brand-600"
                >
                  ↗
                </a>
              )}
            </div>
          </label>
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-ink-100 bg-ink-50/40 px-5 py-3">
          <button
            type="button"
            onClick={() => {
              if (confirm(`Delete project "${project.name}"?`)) {
                props.onRemove();
                props.onClose();
              }
            }}
            className="inline-flex h-8 items-center gap-1 rounded-md border border-rose-200 bg-white px-3 text-[12.5px] text-rose-600 transition hover:bg-rose-50"
          >
            Delete project
          </button>
          <button
            type="button"
            onClick={props.onClose}
            className="inline-flex h-8 items-center gap-1 rounded-md bg-gradient-to-b from-brand-600 to-brand-700 px-4 text-[12.5px] font-semibold text-white shadow-sm transition hover:from-brand-700 hover:to-brand-700 active:scale-[0.98]"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

/* ============================================================ */
/* Popovers                                                      */
/* ============================================================ */

function ColorPopover(props: {
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

function ProjectPicker(props: {
  rect: DOMRect;
  projects: Project[];
  onPick: (id: ID) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
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

  const filtered = props.projects.filter(p =>
    p.name.toLowerCase().includes(q.trim().toLowerCase()),
  );

  const w = 280;
  const h = 340;
  let top = props.rect.bottom + 6;
  let left = props.rect.left;
  if (top + h > window.innerHeight) top = props.rect.top - h - 6;
  if (left + w > window.innerWidth) left = window.innerWidth - w - 8;

  return (
    <div
      ref={ref}
      className="anim-pop-in fixed z-50 flex flex-col overflow-hidden rounded-xl border border-ink-200 bg-white shadow-2xl"
      style={{ top, left, width: w, maxHeight: h }}
    >
      <div className="border-b border-ink-200 bg-ink-50/60 px-3 py-2">
        <input
          autoFocus
          placeholder="Filter projects…"
          value={q}
          onChange={e => setQ(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && filtered[0]) props.onPick(filtered[0].id);
          }}
          className="w-full rounded-md border border-ink-200 bg-white px-2.5 py-1.5 text-[13px] outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-200"
        />
      </div>
      <div className="flex-1 overflow-y-auto p-1.5">
        <button
          className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13px] text-ink-700 transition hover:bg-ink-100"
          onClick={() => props.onPick(PTO_ID)}
          title="Mark this week as PTO (not a project)"
        >
          <span
            className="inline-block h-3.5 w-3.5 rounded-full border border-ink-300/70 bg-[repeating-linear-gradient(135deg,#f1f5f9_0_3px,#e2e8f0_3px_6px)]"
            aria-hidden
          />
          <span className="font-semibold uppercase tracking-[0.06em] text-ink-600">PTO</span>
          <span className="ml-auto text-[11px] text-ink-400">time off</span>
        </button>
        {props.projects.length > 0 && (
          <div className="my-1.5 border-t border-ink-100" />
        )}
        {filtered.length === 0 && props.projects.length > 0 && (
          <div className="px-3 py-6 text-center text-[12px] text-ink-500">No projects match.</div>
        )}
        {props.projects.length === 0 && (
          <div className="px-3 py-4 text-center text-[12px] text-ink-500">
            No projects yet — add one in the Projects panel below.
          </div>
        )}
        {filtered.map(p => (
          <button
            key={p.id}
            className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13px] text-ink-800 transition hover:bg-ink-100"
            onClick={() => props.onPick(p.id)}
          >
            <span
              className="inline-block h-3.5 w-3.5 rounded-full border border-black/5"
              style={{ background: p.color }}
            />
            <span className="truncate">{p.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
