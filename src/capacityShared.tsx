import type { PlanState, Quarter } from './types';

const PTO_ID = '__pto__';
const UNAVAILABLE_ID = '__unavailable__';

/** Fixed conversion: 1 engineering-month = 4 weeks. */
export const WEEKS_PER_EM = 4;

export const DEFAULT_QUARTER: Quarter = {
  engineers: 5,
  engineersNote: '',
  weeksInQuarter: 13,
  firstResponderWeeks: 0,
  weeksPerEM: WEEKS_PER_EM,
  buffers: [],
};

export type CapacityInfo = {
  /** Effective quarter (state.quarter ?? DEFAULT_QUARTER). */
  quarter: Quarter;
  /** True iff the user has actually configured a quarter (`state.quarter` is set). */
  hasConfiguredQuarter: boolean;
  /** engineers × weeksInQuarter */
  teamWeeks: number;
  /** teamWeeks − firstResponderWeeks */
  minusFR: number;
  /** Sum of buffer percentages. */
  bufferPctSum: number;
  /** 100 − bufferPctSum, clamped to >=0. */
  remainingPct: number;
  /** Engineering-months of capacity after FR + buffers. 0 if not configured. */
  capacityEM: number;
  /** Sum of estimateEM across non-descoped projects. */
  demandEM: number;
  /** capacityEM − demandEM. */
  gap: number;
  /** Planned eng-weeks per project, computed from non-sentinel assignments
   *  with fractional crediting for multi-project weeks. */
  plannedByProject: Record<string, number>;
};

/** One-stop derivation of all capacity-related numbers from a plan state.
 *  All consumers (capacity bar, projects table, markdown export) read from this
 *  to avoid drift between subtly different formulas. */
export function deriveCapacity(state: PlanState): CapacityInfo {
  const hasConfiguredQuarter = !!state.quarter;
  // Force weeksPerEM to the canonical value, ignoring any stale stored override.
  const quarter: Quarter = { ...(state.quarter ?? DEFAULT_QUARTER), weeksPerEM: WEEKS_PER_EM };

  const teamWeeks = (quarter.engineers || 0) * (quarter.weeksInQuarter || 0);
  const minusFR = teamWeeks - (quarter.firstResponderWeeks || 0);
  const bufferPctSum = (quarter.buffers || []).reduce((s, b) => s + (b.pct || 0), 0);
  const remainingPct = Math.max(0, 100 - bufferPctSum);
  const capacityEM = hasConfiguredQuarter
    ? (minusFR * (remainingPct / 100)) / WEEKS_PER_EM
    : 0;

  const demandEM = state.projects
    .filter(p => !p.descoped)
    .reduce((sum, p) => sum + (p.estimateEM ?? 0), 0);

  // Planned-per-project: each assignment contributes 1/N where N is the
  // number of non-sentinel assignments for that person in that week.
  const counts = new Map<string, number>();
  for (const a of state.assignments) {
    if (a.projectId === PTO_ID || a.projectId === UNAVAILABLE_ID) continue;
    const key = `${a.personId}\0${a.weekId}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const plannedByProject: Record<string, number> = {};
  for (const a of state.assignments) {
    if (a.projectId === PTO_ID || a.projectId === UNAVAILABLE_ID) continue;
    const key = `${a.personId}\0${a.weekId}`;
    const n = counts.get(key) ?? 1;
    plannedByProject[a.projectId] = (plannedByProject[a.projectId] ?? 0) + 1 / n;
  }

  return {
    quarter,
    hasConfiguredQuarter,
    teamWeeks,
    minusFR,
    bufferPctSum,
    remainingPct,
    capacityEM,
    demandEM,
    gap: capacityEM - demandEM,
    plannedByProject,
  };
}

/** Format an EM/week number for compact display. */
export function fmtNum(n: number, maxDecimals = 2): string {
  if (!Number.isFinite(n)) return '—';
  const rounded = Math.round(n * Math.pow(10, maxDecimals)) / Math.pow(10, maxDecimals);
  if (Number.isInteger(rounded)) return `${rounded}`;
  return rounded.toString();
}
