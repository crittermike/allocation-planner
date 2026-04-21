# Allocation Planner

A lightweight, real-time team allocation grid. People on rows, two-week iterations on columns, colored project chips in each cell. Live multi-user editing — share the URL, anyone with the link can edit.

Not really a Gantt chart (no time-spanning bars, no dependencies) — it's a capacity / allocation grid modeled on the kind of Google Sheet teams maintain to plan who's working on what each iteration.

## Features

- Multiple plans, each at its own slug-based URL (`/q4-big-orca-plan`)
- Real-time sync across browsers via WebSockets (last-write-wins per update)
- People, projects, and DRI (lead) marking
- Two-week iterations with auto-computed working-week labels
- Drag-and-drop or click-to-pick assignment
- Estimated vs. planned eng-week tracking per project
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

## Data model

```ts
type State = {
  title: string;
  people: { id; name }[];
  projects: { id; name; color; driId; url?; estimatedWeeks? }[];
  iterations: { id; startDate /* YYYY-MM-DD Monday */ }[];
  assignments: { id; personId; weekId /* `${iterId}:0|1` */; projectId }[];
};
```

The server stores the full state per plan as JSON in a single SQLite row.

## License

MIT
