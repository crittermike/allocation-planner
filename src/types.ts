export type ID = string;

export type Person = { id: ID; name: string };
export type Project = {
  id: ID;
  name: string;
  color: string;
  driId: ID | null;
  url?: string;
  /** Capacity planning fields (all optional, additive). */
  priority?: number;
  descoped?: boolean;
  estimateEM?: number;
  notes?: string;
};
export type Iteration = { id: ID; startDate: string; goal?: string };
export type Assignment = { id: ID; personId: ID; weekId: string; projectId: ID };

export type Buffer = { id: ID; label: string; pct: number; note?: string };
export type Quarter = {
  engineers: number;
  engineersNote?: string;
  weeksInQuarter: number;
  firstResponderWeeks: number;
  weeksPerEM: number;
  buffers: Buffer[];
};

export type PlanState = {
  title: string;
  people: Person[];
  projects: Project[];
  iterations: Iteration[];
  assignments: Assignment[];
  weekNotes?: Record<string, string>;
  quarter?: Quarter;
};

export type PlanSummary = {
  slug: string;
  name: string;
  updated_at: number;
};
