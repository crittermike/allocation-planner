export type ID = string;

export type Person = { id: ID; name: string };
export type Project = {
  id: ID;
  name: string;
  color: string;
  driId: ID | null;
  url?: string;
  estimatedWeeks?: number;
};
export type Iteration = { id: ID; startDate: string };
export type Assignment = { id: ID; personId: ID; weekId: string; projectId: ID };

export type PlanState = {
  title: string;
  people: Person[];
  projects: Project[];
  iterations: Iteration[];
  assignments: Assignment[];
};

export type PlanSummary = {
  slug: string;
  name: string;
  updated_at: number;
};
