# AGENTS.md

Guidance for agents working on this app.

## App overview

- This is a Vite + React 18 + TypeScript + Tailwind v4 frontend with a Node 20 Express + `ws` backend.
- The app is a realtime allocation planner: people, projects, two-week iterations, assignment chips, week notes, and quarter-level capacity planning (engineering-month estimates vs. computed capacity).
- The server stores each plan as one JSON blob in SQLite (`plans.state`) and broadcasts full-state updates over WebSockets to everyone watching the same slug.
- Production is a single Docker container: the server serves `/api`, `/ws`, and the built frontend from `dist/`.

## Common commands

- Install dependencies: `npm install`
- Local dev: `npm run dev` (Vite on :5173, server on :8787; Vite proxies `/api` and `/ws`)
- Typecheck + production build: `npm run build`
- Production server: `npm start`
- Deploy: `~/.fly/bin/flyctl deploy` (Fly.io app is `allocation-planner`; `fly deploy` works if `flyctl` is on PATH)

Run `npm run build` before claiming code changes are complete — it both typechecks (`tsc -b`) and bundles. There are no separate test or lint scripts at the time of writing. GitHub Actions (`.github/workflows/ci.yml`) runs the same build on every push to `main` and on every PR.

## Important files

### Frontend
- `src/main.tsx`, `src/App.tsx`, `src/router.ts`: bootstrap, slug-based routing (`/` → Home, `/<slug>` → Plan). Router is a tiny `pushState`/`popstate` hook plus a custom `app-navigate` event.
- `src/Home.tsx`: landing page — list of recent plans (from `/api/plans`), recently visited slugs (via `localStorage`), and the "new plan" form.
- `src/visited.ts`: `localStorage`-backed record of slugs this browser has opened (for the Home page recents list).
- `src/Plan.tsx`: main planner UI (~3.8k lines). Owns chart rendering in both orientations (`Chart` = people-as-rows, `ChartTransposed` = weeks-as-rows), drag/drop assignment behavior, projects table with DRI column and drag-to-reorder, the projects flyout (which embeds the capacity bars), per-week notes modal, and most local UI preferences (`localStorage`).
- `src/Capacity.tsx`: capacity-planning surface — `CapacityBars` (Estimate + Actual stacked bars), `QuarterModal` (engineers / weeks / first-responder weeks / buffer rows), `PrioritizationTable` (top-level orchestrator, "show what fits" mode), `DescopedDrawer`, and `exportPlanMarkdown`.
- `src/capacityShared.tsx`: single source of truth for capacity math. Exports `deriveCapacity(state)` which returns `CapacityInfo` (capacityEM, demandEM, gap, plannedByProject, frWeeksInPlan, etc.), plus the `WEEKS_PER_EM = 4` constant and the sentinel-id helpers. All capacity consumers (bars, projects table, markdown export) must read from `deriveCapacity` to avoid formula drift.
- `src/ProjectModal.tsx`: project edit modal, `ColorPopover`, and `EmPicker` (chip-style EM picker plus "weeks × engineers" auto-convert). Exports `EM_CHIPS` (must stay in sync with what `Capacity.tsx` displays).
- `src/usePlan.ts`: HTTP/WS plan loading, optimistic local updates, debounced syncing (`SEND_DEBOUNCE_MS = 120`), reconnect behavior, visit tracking, password unlock/change, and the `migrateState` shim that upgrades older saved plans on read.
- `src/types.ts`: shared plan data shapes (`PlanState`, `Project`, `Quarter`, `Buffer`, etc.).
- `src/styles.css`: small custom CSS layered on top of Tailwind v4.

### Backend / infra
- `server/index.js`: SQLite schema + migrations (password columns are idempotent `ALTER TABLE`s), REST API, static frontend serving, WebSocket room management (one room per slug), and the initial plan state used when a new plan is created.
- `Dockerfile`, `fly.toml`: Fly.io deployment and production container setup. `min_machines_running = 1` keeps WS reconnects snappy.
- `.github/workflows/ci.yml`: typecheck + build on push to `main` and on PRs.

## State and sync notes

- The persisted `PlanState` shape (see `src/types.ts`): `title`, `people`, `projects`, `iterations`, `assignments`, optional `weekNotes`, optional `quarter`.
- Capacity-planning project fields are all optional and additive: `estimateEM` (engineering-months), `priority`, `descoped`, `driId`, `url`, `notes`. Older saved plans without them keep working.
- `Quarter` carries the planning inputs: `engineers`, `weeksInQuarter`, `firstResponderWeeks`, `weeksPerEM`, and a list of `Buffer` rows (`{ id, label, pct, note? }`). `weeksPerEM` is always forced to the canonical `WEEKS_PER_EM = 4` when read, so any stale override is ignored.
- Pure UI preferences belong in `localStorage`, not in `PlanState`, unless they're explicitly meant to sync across users. Existing examples live in `src/Plan.tsx`.
- `setState` from `usePlan` updates locally first, then sends the whole state over WS after a short debounce. WebSocket updates are last-write-wins at the full-state level — avoid making unrelated state rewrites in UI handlers, and never read-modify-write off stale local state.
- Plan state migrations belong in `migrateState` in `src/usePlan.ts` (run on every load). When you change `PlanState`, add a migration there for older saved plans.
- Assignment week IDs are derived from iteration IDs as `` `${iterationId}:0` `` and `` `${iterationId}:1` `` — changing an iteration's start date must not change its ID (assignments would be orphaned).
- Capacity math: never recompute capacity / demand / gap / planned-per-project inline. Call `deriveCapacity(state)` from `src/capacityShared.tsx`.

## Sentinel project IDs

Some `Assignment.projectId` values are reserved sentinels. They represent non-project work, must **not** appear in `state.projects`, and are excluded from planned-EM totals via `isSentinel()` in `capacityShared.tsx`:

- `__pto__` — vacation / time off
- `__fr__` — first-responder duty (capacity already deducts `quarter.firstResponderWeeks`; the modal surfaces any mismatch between plan and config)
- `__unavailable__` — person not on the team that week

When adding new non-project assignment types, add a new sentinel ID and update `isSentinel`.

## UI conventions

- Styling is Tailwind v4 utility classes, mostly inline in JSX.
- Keep edits surgical in `src/Plan.tsx` and `src/Capacity.tsx`; both are large.
- When adding chart behavior, check both orientations (`Chart` and `ChartTransposed` in `src/Plan.tsx`).
- Project color chips should use `inkFor(project.color)` for readable foreground text. The `PALETTE_BG` array in `Capacity.tsx` and the `COLORS` array in `ProjectModal.tsx` must stay in sync.
- The capacity bars and the "show what fits" toggle live inside the projects flyout — no separate capacity tab.

## Password protection

- Plans can optionally have a password. Server columns: `password_hash`, `password_version` (idempotent migrations on startup).
- Unlock tokens are HMAC-signed with a per-install secret persisted to `${DATA_DIR}/.token-secret` (or `PLAN_TOKEN_SECRET` env var). Tokens are stored client-side in `localStorage` under `plan-token:<slug>`.
- All password-related flows (`submitPassword`, `changePassword`, `passwordRequired`) are in `src/usePlan.ts`.
- Without a password set, plans remain fully open — anyone with the URL can view and edit.

## Data and deployment cautions

- SQLite data lives in `./data/gantt.db` locally and `/data/gantt.db` on Fly.io. Override with `DATA_DIR=…`.
- Fly.io uses a persistent volume mounted at `/data`; do not remove or rename the mount, or rotate `PLAN_TOKEN_SECRET`, without a migration plan (rotating the secret invalidates all outstanding unlock tokens).
- Do not commit local database files from `data/`.
- The app has no global login/auth. Per-plan password protection is opt-in; otherwise anyone with a plan URL can view and edit.
