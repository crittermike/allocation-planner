import type { Assignment, ID, Milestone, PlanState, Project } from './types';

/* Project milestones: plannable slices of a project. An assignment may name one
 * through `milestoneId`, but it still belongs to `projectId`, so capacity (see
 * deriveCapacity) keeps counting it once, toward the project. */

export function milestoneOf(project: Project | undefined, milestoneId: ID | undefined): Milestone | undefined {
  return milestoneId ? project?.milestones?.find(m => m.id === milestoneId) : undefined;
}

export function milestoneLabel(m: Pick<Milestone, 'name'>): string {
  return m.name.trim() || 'Untitled milestone';
}

/** Same person, week, project, and milestone. "No milestone" is its own slot. */
export function sameSlot(
  a: Pick<Assignment, 'personId' | 'weekId' | 'projectId' | 'milestoneId'>,
  b: Pick<Assignment, 'personId' | 'weekId' | 'projectId' | 'milestoneId'>,
): boolean {
  return a.personId === b.personId
    && a.weekId === b.weekId
    && a.projectId === b.projectId
    && (a.milestoneId ?? null) === (b.milestoneId ?? null);
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Well-formed milestones from saved data; anything unusable is dropped. */
export function sanitizeMilestones(raw: unknown): Milestone[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const seen = new Set<ID>();
  const out: Milestone[] = [];
  for (const m of raw) {
    if (!m || typeof m !== 'object' || typeof m.id !== 'string' || !m.id || seen.has(m.id)) continue;
    seen.add(m.id);
    out.push({
      id: m.id,
      name: typeof m.name === 'string' ? m.name : '',
      releaseDate: typeof m.releaseDate === 'string' && ISO_DAY.test(m.releaseDate) ? m.releaseDate : undefined,
      url: typeof m.url === 'string' && m.url ? m.url : undefined,
    });
  }
  return out.length ? out : undefined;
}

/** Clear milestone references that no longer point at a milestone of the assignment's project. */
export function pruneMilestoneRefs(assignments: Assignment[], projects: Project[]): Assignment[] {
  const valid = new Map(projects.map(p => [p.id, new Set((p.milestones ?? []).map(m => m.id))]));
  let changed = false;
  const out = assignments.map(a => {
    if (a.milestoneId === undefined) return a;
    if (typeof a.milestoneId === 'string' && valid.get(a.projectId)?.has(a.milestoneId)) return a;
    changed = true;
    const { milestoneId: _drop, ...rest } = a;
    return rest;
  });
  return changed ? dedupeSlots(out) : assignments;
}

/** Keep the first assignment in each person/week/project/milestone slot. */
function dedupeSlots(assignments: Assignment[]): Assignment[] {
  const seen = new Set<string>();
  return assignments.filter(a => {
    const key = `${a.personId}\0${a.weekId}\0${a.projectId}\0${a.milestoneId ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Remove a milestone. Its assignments stay on the project, without a milestone. */
export function removeMilestone(state: PlanState, projectId: ID, milestoneId: ID): PlanState {
  const projects = state.projects.map(p => {
    if (p.id !== projectId || !p.milestones) return p;
    const milestones = p.milestones.filter(m => m.id !== milestoneId);
    return { ...p, milestones: milestones.length ? milestones : undefined };
  });
  return { ...state, projects, assignments: pruneMilestoneRefs(state.assignments, projects) };
}

/** Point an assignment at a different milestone of its project, or at none.
 *  If the person already has that exact slot that week, the assignment merges into it. */
export function setAssignmentMilestone(state: PlanState, assignmentId: ID, milestoneId: ID | undefined): PlanState {
  const a = state.assignments.find(x => x.id === assignmentId);
  if (!a || (a.milestoneId ?? undefined) === milestoneId) return state;
  const project = state.projects.find(p => p.id === a.projectId);
  if (milestoneId && !milestoneOf(project, milestoneId)) return state;
  const { milestoneId: _old, ...base } = a;
  const next: Assignment = milestoneId ? { ...base, milestoneId } : base;
  if (state.assignments.some(x => x.id !== assignmentId && sameSlot(x, next))) {
    return { ...state, assignments: state.assignments.filter(x => x.id !== assignmentId) };
  }
  return { ...state, assignments: state.assignments.map(x => (x.id === assignmentId ? next : x)) };
}

/** Milestones to add to a project. Ones linked to an issue the project already has
 *  a milestone for (matched by URL) are skipped, so importing twice adds nothing. */
export function newMilestonesFrom(
  existing: Milestone[] | undefined,
  items: Omit<Milestone, 'id'>[],
  makeId: () => ID,
): Milestone[] {
  const have = new Set((existing ?? []).map(m => m.url).filter(Boolean));
  return items.flatMap(item => {
    if (item.url) {
      if (have.has(item.url)) return [];
      have.add(item.url);
    }
    return [{ ...item, id: makeId() }];
  });
}

/* ---------- releases ---------- */

export type ScheduledRelease = {
  /** Unique across project and milestone releases. */
  key: string;
  project: Project;
  milestone?: Milestone;
  releaseDate: string;
};

/** Add whole calendar days to a YYYY-MM-DD date. Uses UTC so DST changes can't shift the day. */
export function addCalendarDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const date = new Date(0);
  date.setUTCFullYear(y, m - 1, d + days);
  return `${String(date.getUTCFullYear()).padStart(4, '0')}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

/** Ship dates of active projects and their milestones, by date. */
export function scheduledReleases(projects: Project[]): ScheduledRelease[] {
  const out: ScheduledRelease[] = [];
  for (const project of projects) {
    if (project.descoped) continue;
    if (project.releaseDate) out.push({ key: project.id, project, releaseDate: project.releaseDate });
    (project.milestones ?? []).forEach(milestone => {
      if (milestone.releaseDate) {
        out.push({ key: `${project.id}:${milestone.id}`, project, milestone, releaseDate: milestone.releaseDate });
      }
    });
  }
  const order = (r: ScheduledRelease) => (r.milestone ? (r.project.milestones ?? []).indexOf(r.milestone) : Infinity);
  return out.sort((a, b) =>
    a.releaseDate.localeCompare(b.releaseDate)
    || a.project.name.localeCompare(b.project.name)
    || (a.project.id === b.project.id ? order(a) - order(b) : a.project.id.localeCompare(b.project.id)));
}

/** Releases per chart week. A week runs from its Monday through the following Sunday. */
export function releasesByWeek(
  projects: Project[],
  weeks: { id: string; startDate: string }[],
): Record<string, ScheduledRelease[]> {
  const releases = scheduledReleases(projects);
  return Object.fromEntries(weeks.map(week => {
    const end = addCalendarDays(week.startDate, 7);
    return [week.id, releases.filter(r => r.releaseDate >= week.startDate && r.releaseDate < end)];
  }));
}
