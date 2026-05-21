import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

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

// --- Migrations: password protection columns (idempotent). ---
const planCols = new Set(db.prepare("PRAGMA table_info(plans)").all().map((c) => c.name));
if (!planCols.has('password_hash')) {
  db.exec('ALTER TABLE plans ADD COLUMN password_hash TEXT');
}
if (!planCols.has('password_version')) {
  db.exec('ALTER TABLE plans ADD COLUMN password_version INTEGER NOT NULL DEFAULT 0');
}

// --- Server secret for signing unlock tokens. ---
// Persisted in DATA_DIR so restarts don't invalidate all tokens.
const SECRET_FILE = path.join(DATA_DIR, '.token-secret');
let SERVER_SECRET;
if (process.env.PLAN_TOKEN_SECRET) {
  SERVER_SECRET = Buffer.from(process.env.PLAN_TOKEN_SECRET, 'utf8');
} else if (fs.existsSync(SECRET_FILE)) {
  SERVER_SECRET = fs.readFileSync(SECRET_FILE);
} else {
  SERVER_SECRET = crypto.randomBytes(32);
  fs.writeFileSync(SECRET_FILE, SERVER_SECRET, { mode: 0o600 });
}

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

const getPlan = (slug) =>
  db.prepare(
    'SELECT slug, name, state, updated_at, password_hash, password_version FROM plans WHERE slug = ?',
  ).get(slug);
const listPlans = () =>
  db.prepare('SELECT slug, name, updated_at FROM plans ORDER BY updated_at DESC LIMIT 100').all();
const insertPlan = db.prepare(
  'INSERT INTO plans (slug, name, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
);
const updatePlan = db.prepare(
  'UPDATE plans SET state = ?, name = ?, updated_at = ? WHERE slug = ?',
);
const updatePlanPassword = db.prepare(
  'UPDATE plans SET password_hash = ?, password_version = password_version + 1, updated_at = ? WHERE slug = ?',
);
const deletePlan = db.prepare('DELETE FROM plans WHERE slug = ?');

// --- Password hashing (scrypt; encoded as scrypt$<saltHex>$<hashHex>). ---
const SCRYPT_KEYLEN = 32;
const hashPassword = (plaintext) => {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(plaintext, salt, SCRYPT_KEYLEN);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
};
const verifyPassword = (plaintext, stored) => {
  if (!stored) return false;
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  let salt, expected;
  try {
    salt = Buffer.from(parts[1], 'hex');
    expected = Buffer.from(parts[2], 'hex');
  } catch {
    return false;
  }
  let actual;
  try {
    actual = crypto.scryptSync(plaintext, salt, expected.length);
  } catch {
    return false;
  }
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
};

// --- Unlock tokens (HMAC over slug:passwordVersion, no DB lookup needed). ---
const issueToken = (slug, passwordVersion) => {
  const mac = crypto
    .createHmac('sha256', SERVER_SECRET)
    .update(`${slug}:${passwordVersion}`)
    .digest();
  return mac.toString('base64url');
};
const verifyToken = (slug, passwordVersion, token) => {
  if (!token || typeof token !== 'string') return false;
  let provided;
  try {
    provided = Buffer.from(token, 'base64url');
  } catch {
    return false;
  }
  const expected = crypto
    .createHmac('sha256', SERVER_SECRET)
    .update(`${slug}:${passwordVersion}`)
    .digest();
  if (provided.length !== expected.length) return false;
  return crypto.timingSafeEqual(provided, expected);
};

const tokenFromReq = (req) => {
  const auth = req.headers && req.headers.authorization;
  if (auth && typeof auth === 'string' && auth.startsWith('Bearer ')) {
    return auth.slice(7).trim();
  }
  return null;
};
const tokenFromUrl = (rawUrl) => {
  // Pulled out of req.url since the WS upgrade handler doesn't parse query strings.
  const qi = rawUrl.indexOf('?');
  if (qi === -1) return null;
  const params = new URLSearchParams(rawUrl.slice(qi + 1));
  return params.get('token');
};

// --- Crude per-slug+IP rate limit for /unlock to slow brute force. ---
const attempts = new Map(); // key -> { count, resetAt }
const ATTEMPT_WINDOW_MS = 60_000;
const ATTEMPT_MAX = 8;
const checkRateLimit = (key) => {
  const now = Date.now();
  const cur = attempts.get(key);
  if (!cur || cur.resetAt < now) {
    attempts.set(key, { count: 1, resetAt: now + ATTEMPT_WINDOW_MS });
    return true;
  }
  if (cur.count >= ATTEMPT_MAX) return false;
  cur.count++;
  return true;
};
const clearRateLimit = (key) => attempts.delete(key);

const MS_PER_DAY = 86400000;
const mondayOf = (d) => {
  const day = d.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  return new Date(d.getTime() + offset * MS_PER_DAY);
};
const toISODate = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const uid = () => Math.random().toString(36).slice(2, 10);

const initialIterations = () => {
  const start = mondayOf(new Date());
  return [0, 1, 2].map((i) => ({
    id: uid(),
    startDate: toISODate(new Date(start.getTime() + i * 14 * MS_PER_DAY)),
  }));
};

const initialPeople = () => [1, 2, 3].map((n) => ({ id: uid(), name: `Person ${n}` }));

const freshState = (title) => ({
  title,
  people: initialPeople(),
  projects: [],
  iterations: initialIterations(),
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
  const hasPassword = !!row.password_hash;
  if (hasPassword) {
    const token = tokenFromReq(req);
    if (!verifyToken(row.slug, row.password_version, token)) {
      return res.status(401).json({ error: 'auth_required', requiresPassword: true, name: row.name, slug: row.slug });
    }
  }
  res.json({
    slug: row.slug,
    name: row.name,
    state: JSON.parse(row.state),
    updated_at: row.updated_at,
    hasPassword,
  });
});

app.post('/api/plans/:slug/unlock', (req, res) => {
  const row = getPlan(req.params.slug);
  if (!row) return res.status(404).json({ error: 'not found' });
  if (!row.password_hash) return res.json({ token: issueToken(row.slug, row.password_version), hasPassword: false });

  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const rlKey = `unlock:${row.slug}:${ip}`;
  if (!checkRateLimit(rlKey)) {
    return res.status(429).json({ error: 'too_many_attempts', message: 'Too many attempts. Wait a minute and try again.' });
  }

  const password = String(req.body?.password ?? '');
  if (!password || !verifyPassword(password, row.password_hash)) {
    return res.status(401).json({ error: 'wrong_password' });
  }
  clearRateLimit(rlKey);
  res.json({ token: issueToken(row.slug, row.password_version), hasPassword: true });
});

app.post('/api/plans/:slug/password', (req, res) => {
  const row = getPlan(req.params.slug);
  if (!row) return res.status(404).json({ error: 'not found' });
  const currentlyHasPw = !!row.password_hash;

  // Changing or removing requires either the old password OR a currently-valid token.
  if (currentlyHasPw) {
    const token = tokenFromReq(req);
    const currentPassword = req.body?.currentPassword;
    const hasValidToken = verifyToken(row.slug, row.password_version, token);
    const hasValidPassword =
      typeof currentPassword === 'string' &&
      currentPassword.length > 0 &&
      verifyPassword(currentPassword, row.password_hash);
    if (!hasValidToken && !hasValidPassword) {
      return res.status(401).json({ error: 'auth_required' });
    }
  }

  const raw = req.body?.newPassword;
  const removing = raw === null;
  const newPassword = typeof raw === 'string' ? raw : '';
  if (!removing) {
    if (newPassword.length < 4) {
      return res.status(400).json({ error: 'password_too_short', message: 'Password must be at least 4 characters.' });
    }
    if (newPassword.length > 256) {
      return res.status(400).json({ error: 'password_too_long' });
    }
  }

  const nextHash = removing ? null : hashPassword(newPassword);
  updatePlanPassword.run(nextHash, Date.now(), row.slug);

  const after = getPlan(row.slug);
  if (!after) return res.status(500).json({ error: 'lost_row' });
  if (removing) {
    return res.json({ token: null, hasPassword: false });
  }
  res.json({ token: issueToken(after.slug, after.password_version), hasPassword: true });
});

app.delete('/api/plans/:slug', (req, res) => {
  const row = getPlan(req.params.slug);
  if (!row) return res.json({ ok: true });
  if (row.password_hash) {
    const token = tokenFromReq(req);
    if (!verifyToken(row.slug, row.password_version, token)) {
      return res.status(401).json({ error: 'auth_required' });
    }
  }
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
  if (row.password_hash) {
    const token = tokenFromUrl(req.url);
    if (!verifyToken(row.slug, row.password_version, token)) {
      // Custom 4401 close so the client can distinguish auth failure from network errors.
      socket.write(
        'HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n',
      );
      socket.destroy();
      return;
    }
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

