import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.resolve(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, 'gantt.db');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS plans (
    slug       TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    state      TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
`);

const slugify = (s) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'plan';

const uniqueSlug = (base) => {
  const exists = db.prepare('SELECT 1 FROM plans WHERE slug = ?');
  if (!exists.get(base)) return base;
  for (let i = 2; i < 10000; i++) {
    const cand = `${base}-${i}`;
    if (!exists.get(cand)) return cand;
  }
  throw new Error('Could not allocate slug');
};

const getPlan = (slug) => db.prepare('SELECT slug, name, state, updated_at FROM plans WHERE slug = ?').get(slug);
const listPlans = () =>
  db.prepare('SELECT slug, name, updated_at FROM plans ORDER BY updated_at DESC LIMIT 100').all();
const insertPlan = db.prepare(
  'INSERT INTO plans (slug, name, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
);
const updatePlan = db.prepare(
  'UPDATE plans SET state = ?, name = ?, updated_at = ? WHERE slug = ?',
);
const deletePlan = db.prepare('DELETE FROM plans WHERE slug = ?');

const freshState = (title) => ({
  title,
  people: [],
  projects: [],
  iterations: [],
  assignments: [],
});

/* ------------ HTTP ------------ */

const app = express();
app.use(express.json({ limit: '4mb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.get('/api/plans', (_req, res) => res.json(listPlans()));

app.post('/api/plans', (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  if (!name) return res.status(400).json({ error: 'name required' });
  const base = slugify(name);
  const slug = uniqueSlug(base);
  const now = Date.now();
  const state = freshState(name);
  insertPlan.run(slug, name, JSON.stringify(state), now, now);
  res.json({ slug, name });
});

app.get('/api/plans/:slug', (req, res) => {
  const row = getPlan(req.params.slug);
  if (!row) return res.status(404).json({ error: 'not found' });
  res.json({ slug: row.slug, name: row.name, state: JSON.parse(row.state), updated_at: row.updated_at });
});

app.delete('/api/plans/:slug', (req, res) => {
  deletePlan.run(req.params.slug);
  res.json({ ok: true });
});

/* ------------ Static frontend (production) ------------ */

const DIST_DIR = path.resolve(__dirname, '..', 'dist');
if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR, { index: false, maxAge: '1h' }));
  // SPA fallback: any non-API GET serves index.html
  app.get(/^(?!\/api\/|\/ws\/).*/, (_req, res) => {
    res.sendFile(path.join(DIST_DIR, 'index.html'));
  });
}

/* ------------ WebSocket ------------ */

const server = createServer(app);
const wss = new WebSocketServer({ noServer: true });

/** Map<slug, Set<WebSocket>> */
const rooms = new Map();

const join = (slug, ws) => {
  let set = rooms.get(slug);
  if (!set) rooms.set(slug, (set = new Set()));
  set.add(ws);
  return set;
};
const leave = (slug, ws) => {
  const set = rooms.get(slug);
  if (!set) return;
  set.delete(ws);
  if (set.size === 0) rooms.delete(slug);
};
const broadcast = (slug, fromWs, payload) => {
  const set = rooms.get(slug);
  if (!set) return;
  const data = JSON.stringify(payload);
  for (const ws of set) {
    if (ws !== fromWs && ws.readyState === ws.OPEN) ws.send(data);
  }
};

server.on('upgrade', (req, socket, head) => {
  const m = req.url && req.url.match(/^\/ws\/([^/?#]+)/);
  if (!m) {
    socket.destroy();
    return;
  }
  const slug = decodeURIComponent(m[1]);
  const row = getPlan(slug);
  if (!row) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    ws._slug = slug;
    join(slug, ws);
    // Send hello with current state + presence count
    const set = rooms.get(slug);
    ws.send(JSON.stringify({ type: 'hello', state: JSON.parse(row.state), name: row.name, peers: set.size }));
    // Notify others of new presence
    broadcast(slug, ws, { type: 'peers', peers: set.size });

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(String(raw)); } catch { return; }
      if (msg.type === 'update' && msg.state && typeof msg.state === 'object') {
        const name = String(msg.state.title ?? row.name).slice(0, 200) || row.name;
        updatePlan.run(JSON.stringify(msg.state), name, Date.now(), slug);
        broadcast(slug, ws, { type: 'state', state: msg.state });
      }
    });

    ws.on('close', () => {
      leave(slug, ws);
      const peers = rooms.get(slug)?.size ?? 0;
      broadcast(slug, ws, { type: 'peers', peers });
    });
  });
});

const PORT = Number(process.env.PORT || 8787);
server.listen(PORT, () => {
  console.log(`[gantt] server listening on http://localhost:${PORT}`);
});
