# AGENTS.md

Guidance for agents working on this app.

## App overview

- This is a Vite + React 18 + TypeScript frontend with a Node 20 Express + `ws` backend.
- The app is a realtime allocation planner: people, projects, two-week iterations, assignment chips, and week notes.
- The server stores each plan as one JSON blob in SQLite (`plans.state`) and broadcasts full-state updates over WebSockets.
- Production is a single Docker container: the server serves `/api`, `/ws`, and the built frontend from `dist/`.

## Common commands

- Install dependencies: `npm install`
- Local dev: `npm run dev`
- Production build/typecheck: `npm run build`
- Production server: `npm start`
- Deploy: `fly deploy`

Run `npm run build` before claiming code changes are complete. There are no separate test or lint scripts at the time of writing.

## Important files

- `src/Plan.tsx`: main planner UI, chart rendering, drag/drop assignment behavior, project table, modals, and local UI preferences.
- `src/usePlan.ts`: HTTP/WS plan loading, optimistic local updates, debounced syncing, reconnect behavior, and visit tracking.
- `src/types.ts`: shared plan data shapes.
- `server/index.js`: SQLite schema, API routes, static frontend serving, WebSocket room management, and initial plan state.
- `fly.toml` and `Dockerfile`: Fly.io deployment and production container setup.

## State and sync notes

- Shared plan data belongs in the persisted `State` shape: `title`, `people`, `projects`, `iterations`, `assignments`, and optional `weekNotes`.
- Pure UI preferences should stay local unless explicitly intended to sync across users. Existing examples use `localStorage` in `src/Plan.tsx`.
- `setState` from `usePlan` updates locally first, then sends the whole state over WS after a short debounce.
- WebSocket updates are last-write-wins at the full-state level, so avoid making unrelated state rewrites in UI handlers.
- Assignment week IDs are derived from iteration IDs as `${iterationId}:0` and `${iterationId}:1`; changing iteration start dates should not change IDs.

## UI conventions

- Styling is Tailwind utility classes, mostly inline in JSX.
- Keep edits surgical in `src/Plan.tsx`; it is large and contains both chart orientations.
- When adding chart behavior, check both people-as-rows (`Chart`) and weeks-as-rows (`ChartTransposed`) paths.
- Project color chips should use `inkFor(project.color)` for readable text.
- PTO is represented by the `PTO_ID` sentinel assignment project and must not be added to `state.projects` or planned project totals.

## Data and deployment cautions

- SQLite data lives in `./data/gantt.db` locally and `/data/gantt.db` on Fly.io.
- Fly.io uses a persistent volume mounted at `/data`; do not remove or rename the mount without a migration plan.
- Do not commit local database files from `data/`.
- The app intentionally has no login/auth; anyone with a plan URL can view and edit it.
