import type { Assignment, ID } from './types';

/** Where one assignment sits in its person's lanes, and whether it joins the
 *  same project (and milestone) in the neighboring visible weeks. */
export type RunSlot = { lane: number; joinPrev: boolean; joinNext: boolean };
export type PersonLanes = { count: number; tall: boolean[] };
export type RunLayout = {
  slots: Record<ID, RunSlot>;
  lanesByPerson: Record<ID, PersonLanes>;
};

const runKey = (a: Assignment) => `${a.projectId}\0${a.milestoneId ?? ''}`;

/** Lays out each person's assignments in lanes so a run of consecutive weeks on
 *  the same project and milestone stays in one lane and can be drawn as one bar.
 *  `columns` lists the visible week ids in chart order; `null` marks a collapsed
 *  iteration, which breaks runs. Cells with a blocking assignment (N/A) are left out. */
export function layoutRuns(
  assignments: Assignment[],
  columns: (string | null)[],
  opts: { isBlocker?: (a: Assignment) => boolean; isTall?: (a: Assignment) => boolean } = {},
): RunLayout {
  const byCell = new Map<string, Assignment[]>();
  const blocked = new Set<string>();
  for (const a of assignments) {
    const cell = `${a.personId}\0${a.weekId}`;
    if (opts.isBlocker?.(a)) blocked.add(cell);
    const list = byCell.get(cell);
    if (list) list.push(a);
    else byCell.set(cell, [a]);
  }
  const people = [...new Set(assignments.map(a => a.personId))];
  const slots: Record<ID, RunSlot> = {};
  const lanesByPerson: Record<ID, PersonLanes> = {};

  for (const personId of people) {
    const cellAt = (i: number): Assignment[] => {
      const weekId = columns[i];
      if (weekId == null) return [];
      const cell = `${personId}\0${weekId}`;
      return blocked.has(cell) ? [] : byCell.get(cell) ?? [];
    };
    const tall: boolean[] = [];
    let count = 0;
    let prev = new Map<string, { id: ID; lane: number }>();
    for (let i = 0; i < columns.length; i++) {
      const cell = cellAt(i);
      const next = new Map<string, { id: ID; lane: number }>();
      const used = new Set<number>();
      const fresh: Assignment[] = [];
      for (const a of cell) {
        const before = prev.get(runKey(a));
        if (before) {
          slots[a.id] = { lane: before.lane, joinPrev: true, joinNext: false };
          slots[before.id].joinNext = true;
          used.add(before.lane);
          next.set(runKey(a), { id: a.id, lane: before.lane });
        } else {
          fresh.push(a);
        }
      }
      for (const a of fresh) {
        let lane = 0;
        while (used.has(lane)) lane++;
        used.add(lane);
        slots[a.id] = { lane, joinPrev: false, joinNext: false };
        next.set(runKey(a), { id: a.id, lane });
      }
      for (const a of cell) {
        const { lane } = slots[a.id];
        count = Math.max(count, lane + 1);
        if (opts.isTall?.(a)) tall[lane] = true;
      }
      prev = next;
    }
    lanesByPerson[personId] = {
      count,
      tall: Array.from({ length: count }, (_, i) => !!tall[i]),
    };
  }
  return { slots, lanesByPerson };
}
