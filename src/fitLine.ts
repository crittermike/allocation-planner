import type { ID, Project } from './types';

/** Index of the first project (in priority order) whose cumulative estimate
 *  exceeds capacity, or -1 when everything fits or no quarter is configured. */
export function fitLineIndex(ranked: Project[], capacityEM: number, hasConfiguredQuarter: boolean): number {
  if (!hasConfiguredQuarter) return -1;
  let cum = 0;
  for (let i = 0; i < ranked.length; i++) {
    cum += ranked[i].estimateEM ?? 0;
    if (cum > capacityEM + 0.0001) return i;
  }
  return -1;
}

/** Projects at or past the fit line. */
export function belowLineIds(ranked: Project[], fitIndex: number): Set<ID> {
  return new Set(fitIndex === -1 ? [] : ranked.slice(fitIndex).map(p => p.id));
}
