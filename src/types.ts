export type ID = string;

export type Person = { id: ID; name: string };
/** A plannable slice of a project. Assignments can target one, and its ship date
 *  shows on the chart's Releases row alongside project release dates. */
export type Milestone = {
  id: ID;
  name: string;
  /** Communicated ship date, stored as a YYYY-MM-DD calendar date. */
  releaseDate?: string;
  /** The milestone's GitHub sub-issue, when it came from scope tracking. */
  url?: string;
  /** Kept in sync with the project's GitHub epic: name, URL, and order come from GitHub. */
  github?: true;
  /** Synced from GitHub, but no longer a Batch sub-issue of the epic. Kept so its
   *  ship date and assignments aren't lost; the user can remove it. */
  goneFromGitHub?: true;
};
export type Project = {
  id: ID;
  name: string;
  color: string;
  driId: ID | null;
  url?: string;
  /** Communicated ship date, stored as a YYYY-MM-DD calendar date. */
  releaseDate?: string;
  /** Capacity planning fields (all optional, additive). */
  priority?: number;
  descoped?: boolean;
  estimateEM?: number;
  notes?: string;
  /** Ordered milestones people can be assigned to. */
  milestones?: Milestone[];
};
export type Iteration = { id: ID; startDate: string; goal?: string };
export type Assignment = {
  id: ID;
  personId: ID;
  weekId: string;
  projectId: ID;
  /** Optional milestone of `projectId`. Capacity still counts the assignment once, toward the project. */
  milestoneId?: ID;
};

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
