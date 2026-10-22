import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

const SERVER = path.resolve(import.meta.dirname, '..', 'server', 'index.js');
const dataDir = mkdtempSync(path.join(tmpdir(), 'planner-test-'));
let port = 0;
let proc: ChildProcess | null = null;
const base = () => `http://127.0.0.1:${port}`;

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const s = createServer().listen(0, () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => resolve(p));
    }).on('error', reject);
  });

const start = async () => {
  // Empty GITHUB_TOKEN stops a local .env from enabling GitHub calls.
  proc = spawn(process.execPath, [SERVER], {
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, GITHUB_TOKEN: '', PLAN_TOKEN_SECRET: '' },
    stdio: 'ignore',
  });
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${base()}/api/health`)).ok) return;
    } catch {}
    await new Promise(r => setTimeout(r, 50));
  }
  throw new Error('server did not start');
};

const stop = () =>
  new Promise<void>(resolve => {
    if (!proc || proc.exitCode !== null) return resolve();
    proc.once('exit', () => resolve());
    proc.kill();
  });

const api = async (method: string, url: string, body?: unknown, token?: string) => {
  const res = await fetch(base() + url, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};

const createPlan = async (name: string) => (await api('POST', '/api/plans', { name })).body.slug as string;

/** Opens a socket and resolves with it once the server's hello arrives. */
const connect = (slug: string, token?: string) =>
  new Promise<{ ws: WebSocket; hello: any; next: () => Promise<any> }>((resolve, reject) => {
    const qs = token ? `?token=${encodeURIComponent(token)}` : '';
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/${slug}${qs}`);
    const queue: any[] = [];
    const waiters: ((m: any) => void)[] = [];
    ws.onmessage = e => {
      const msg = JSON.parse(String(e.data));
      const w = waiters.shift();
      if (w) w(msg);
      else queue.push(msg);
    };
    const next = () =>
      queue.length
        ? Promise.resolve(queue.shift())
        : new Promise((r, fail) => {
            waiters.push(r);
            setTimeout(() => fail(new Error('no message within 2s')), 2000).unref();
          });
    ws.onerror = () => reject(new Error('socket error'));
    next().then(hello => resolve({ ws, hello, next }));
  });

before(async () => {
  port = await freePort();
  await start();
});

after(async () => {
  await stop();
  rmSync(dataDir, { recursive: true, force: true });
});

test('creates plans with unique slugs and serves them', async () => {
  const slug = await createPlan('Team Plan');
  assert.equal(slug, 'team-plan');
  assert.equal(await createPlan('Team Plan'), 'team-plan-2');

  const { status, body } = await api('GET', `/api/plans/${slug}`);
  assert.equal(status, 200);
  assert.equal(body.state.title, 'Team Plan');
  assert.equal(body.state.people.length, 3);
  assert.equal(body.state.iterations.length, 3);
  assert.equal(body.hasPassword, false);

  const list = (await api('GET', '/api/plans')).body as { slug: string }[];
  assert.ok(list.some(p => p.slug === slug));

  assert.equal((await api('POST', '/api/plans', { name: '  ' })).status, 400);
  assert.equal((await api('GET', '/api/plans/missing')).status, 404);
});

test('syncs updates between clients and saves them', async () => {
  const slug = await createPlan('Sync');
  const a = await connect(slug);
  const b = await connect(slug);
  assert.equal(a.hello.state.title, 'Sync');
  assert.equal((await a.next()).peers, 2);

  const state = { ...b.hello.state, title: 'Renamed', assignments: [{ id: 'x', personId: 'p', weekId: 'w:0', projectId: '__pto__' }] };
  b.ws.send(JSON.stringify({ type: 'update', state }));
  const msg = await a.next();
  assert.equal(msg.type, 'state');
  assert.deepEqual(msg.state, state);

  const saved = (await api('GET', `/api/plans/${slug}`)).body;
  assert.deepEqual(saved.state, state);
  assert.equal(saved.name, 'Renamed');
  a.ws.close();
  b.ws.close();
});

test('password protects HTTP and WebSocket access', async () => {
  const slug = await createPlan('Secret');
  const set = await api('POST', `/api/plans/${slug}/password`, { newPassword: 'hunter2' });
  assert.equal(set.status, 200);
  const token = set.body.token as string;

  assert.equal((await api('GET', `/api/plans/${slug}`)).status, 401);
  assert.equal((await api('DELETE', `/api/plans/${slug}`)).status, 401);
  assert.equal((await api('POST', `/api/plans/${slug}/unlock`, { password: 'nope' })).status, 401);
  await assert.rejects(connect(slug));

  const unlocked = await api('POST', `/api/plans/${slug}/unlock`, { password: 'hunter2' });
  assert.equal(unlocked.status, 200);
  assert.equal((await api('GET', `/api/plans/${slug}`, undefined, unlocked.body.token)).status, 200);
  const { ws } = await connect(slug, token);
  ws.close();

  // Changing the password invalidates old tokens.
  const changed = await api('POST', `/api/plans/${slug}/password`, { newPassword: 'better', currentPassword: 'hunter2' });
  assert.equal((await api('GET', `/api/plans/${slug}`, undefined, token)).status, 401);
  assert.equal((await api('GET', `/api/plans/${slug}`, undefined, changed.body.token)).status, 200);

  assert.equal((await api('DELETE', `/api/plans/${slug}`, undefined, changed.body.token)).status, 200);
  assert.equal((await api('GET', `/api/plans/${slug}`)).status, 404);
});

test('plans and unlock tokens survive a restart', async () => {
  const slug = await createPlan('Durable');
  const { ws, hello } = await connect(slug);
  const state = { ...hello.state, title: 'Durable v2' };
  ws.send(JSON.stringify({ type: 'update', state }));
  // Wait until the server has stored the update.
  for (let i = 0; i < 50 && (await api('GET', `/api/plans/${slug}`)).body.state.title !== 'Durable v2'; i++) {
    await new Promise(r => setTimeout(r, 20));
  }
  ws.close();
  const token = (await api('POST', `/api/plans/${slug}/password`, { newPassword: 'pass' })).body.token;

  await stop();
  await start();

  const res = await api('GET', `/api/plans/${slug}`, undefined, token);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.state, state);
});
