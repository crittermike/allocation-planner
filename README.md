# Allocation Planner

A lightweight, real-time team allocation grid. People on rows, two-week iterations on columns, colored project chips in each cell. Live multi-user editing — share the URL, anyone with the link can edit.

Not really a Gantt chart (no time-spanning bars, no dependencies) — it's a capacity / allocation grid modeled on the kind of Google Sheet teams maintain to plan who's working on what each iteration.

## Features

- Multiple plans, each at its own slug-based URL (`/q4-big-orca-plan`)
- Real-time sync across browsers via WebSockets (last-write-wins per update)
- People, projects, and DRI (lead) marking
- Project release dates with an inline date picker and color-coded weekly release markers
- Two-week iterations with auto-computed working-week labels
- Drag-and-drop or click-to-pick assignment, to a whole project or one of its milestones
- Project milestones with their own ship dates, importable from a GitHub epic's milestone sub-issues
- Estimated vs. planned eng-week tracking per project
- Scope tracking for projects linked to GitHub issues: milestones, scope creep, and finish forecasts (optional; needs a GitHub token)
- Shareable project links: while a project is open, the address bar links to it (`/<plan>/p/<project-id>`)
- No login or auth (anyone with the link can view and edit)

## Stack

- **Frontend:** Vite + React 18 + TypeScript + Tailwind v4
- **Backend:** Node 20 + Express + `ws` + better-sqlite3
- **Deployment:** Single Docker container (server serves both the API and the built frontend)

## Local development

```bash
npm install
npm run dev         # vite on :5173, server on :8787 (vite proxies /api and /ws)
```

Then open http://localhost:5173/.

The SQLite database lives at `./data/gantt.db` (override with `DATA_DIR=…`).

## Production build

```bash
npm run build       # compiles TS, builds frontend into ./dist
npm start           # serves dist + API + WS on $PORT (default 8787)
```

## Deploy to Fly.io

A `Dockerfile` and `fly.toml` are included. SQLite lives on a Fly volume mounted at `/data`.

```bash
# 1. Install flyctl: https://fly.io/docs/flyctl/install/
fly auth signup        # or `fly auth login`

# 2. Create the app (edit `app` in fly.toml first if the name is taken).
fly apps create allocation-planner

# 3. Create the persistent volume in your primary region.
fly volumes create data --region ord --size 1

# 4. Deploy.
fly deploy
```

Cost: ~$2-3/month for a `shared-cpu-1x` 256MB machine + 1GB volume, kept warm for snappy WebSocket reconnects (`min_machines_running = 1` in `fly.toml`). Set it to `0` to scale to zero (sleeps when idle, wakes on first request — saves money but adds a cold-start delay).

## GitHub scope tracking

When a project's URL is a GitHub issue that the server can read, the project editor shows how its scope changed over time: work finished, new issues added after work started (scope creep), and when the remaining work should finish at none, the current, or double the creep rate. Only direct sub-issues with the GitHub issue type **Batch** appear as milestones under an epic or are offered for milestone import. Other sub-issues remain counted as work outside milestones. A milestone's target is the ship date of the project's own milestone for that issue, or else the release date of a project linked to that milestone's issue.

History comes from GitHub's record of sub-issues being added, removed, closed, and reopened, so a newly linked issue shows its full history right away. Counting rules:

- Only sub-issues without sub-issues of their own count, so parent issues aren't counted twice.
- Closed as completed counts as finished. Closed as not planned or duplicate, or removed, reduces scope instead.
- Work starts when the first issue is finished. New issues before that are planning, not creep. Splits and moves between milestones aren't creep either.

To turn it on, give the server a GitHub token:

| Variable | Purpose |
|---|---|
| `GITHUB_TOKEN` | Fine-grained personal access token with read-only **Issues** access to the repos you track. Without it, the feature is off. |
| `GITHUB_SCOPE_REPOS` | Optional comma-separated allowlist, e.g. `github/security-products-enablement`. Issues in other repos are ignored. |

Locally, put them in `.env` at the repo root (it's gitignored) and restart `npm run dev`. On Fly.io, use `fly secrets set GITHUB_TOKEN=… GITHUB_SCOPE_REPOS=…`.

The server only reads issues that the plan links to, using the plan's password check if it has one. Anyone who can open a plan can see the scope, including issue titles, for the issues it links to, so password-protect plans that link private issues. The last complete result per issue is cached in SQLite and refreshed in the background after 15 minutes; click "Updated … ago" to refresh now. A failed refresh keeps the last good data and says so.

To share an epic's scope, copy the address bar while the project is open. Selecting a milestone adds `?milestone=<issue number>`, so the link opens that milestone.

Dev builds also show fictional demo data for `acme-demo/invoice-exports` issue URLs, for working on the UI without a token.

## Data model

```ts
type State = {
  title: string;
  people: { id; name }[];
  projects: {
    id; name; color; driId; url?; releaseDate? /* YYYY-MM-DD */; estimateEM?; priority?; bigRock?; descoped?; notes?;
    milestones?: { id; name; releaseDate? /* YYYY-MM-DD */; url? }[];
  }[];
  iterations: { id; startDate /* YYYY-MM-DD Monday */; goal? }[];
  assignments: { id; personId; weekId /* `${iterId}:0|1` */; projectId; milestoneId? }[];
  quarter?: { engineers; weeksInQuarter; firstResponderWeeks; weeksPerEM; buffers: { id; label; pct; note? }[]; engineersNote? };
};
```

Reserved `projectId` sentinels (an assignment with one of these IDs is non-project
work and is excluded from per-project planned-EM totals):

- `__pto__` — vacation / time off
- `__fr__` — first-responder duty (capacity already deducts `quarter.firstResponderWeeks`)
- `__unavailable__` — person not on team that week

The server stores the full state per plan as JSON in a single SQLite row.

Release dates are the ship dates communicated to stakeholders, not dates inferred
from assignments or estimates. Set or clear them in the projects table or project
editor. Active projects appear above the matching week's notes in either schedule
orientation, including in collapsed iterations. Weeks include Monday through
Sunday, so weekend releases stay with that week. Dates outside the plan's
iterations remain in the projects table and markdown export.

## Milestones

Add milestones in the project editor. For a project linked to a GitHub epic, "+ N
from GitHub" adds the epic's milestone sub-issues (adding them again is a no-op).
In the chart's picker, a project's milestones are listed under it; choose the
project itself for work that isn't tied to one milestone. Hover an assignment and
click ◆ to move it to a different milestone. Dragging, moving, and extending an
assignment keep its milestone. A milestone's ship date shows on the Releases row
as "Project · Milestone" and is the target for that milestone in the scope view.
Capacity and planned EM still count milestone work toward its project, once.

## License

MIT
