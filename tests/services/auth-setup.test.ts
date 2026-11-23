import { describe, expect, it } from 'vitest';
import { client, makeApp, OWNER, setupOwner } from '../helpers';

describe('first-run setup and auth', () => {
  it('reports setup needed, then creates the owner, the first workspace and a session', async () => {
    const { app } = await makeApp();
    const c = client(app);
    expect((await c.get('/api/setup')).json).toEqual({ needsSetup: true });

    const res = await c.post('/api/setup', OWNER);
    expect(res.status).toBe(201);
    expect(res.json.workspace.name).toBe('Personal');

    const me = await c.get('/api/me');
    expect(me.status).toBe(200);
    expect(me.json.user).toMatchObject({ name: OWNER.name, email: OWNER.email });
    expect((await c.get('/api/workspaces')).json.workspaces).toHaveLength(1);
    expect((await c.get('/api/setup')).json).toEqual({ needsSetup: false });
  });

  it('runs setup only once', async () => {
    const { app } = await makeApp();
    await setupOwner(app);
    const res = await client(app).post('/api/setup', { ...OWNER, email: 'mallory@example.com' });
    expect(res.status).toBe(409);
  });

  it('validates setup input', async () => {
    const { app } = await makeApp();
    const res = await client(app).post('/api/setup', { ...OWNER, password: 'short' });
    expect(res.status).toBe(400);
    expect(res.json.error.message).toMatch(/password/);
  });

  it('keeps public sign-up closed before and after setup', async () => {
    const { app } = await makeApp();
    const body = { name: 'Mallory', email: 'mallory@example.com', password: 'mallory-password-1' };
    expect((await client(app).post('/api/auth/sign-up/email', body)).status).toBe(403);
    await setupOwner(app);
    expect((await client(app).post('/api/auth/sign-up/email', body)).status).toBe(403);
  });

  it('signs in with the right password, rejects the wrong one, signs out', async () => {
    const { app } = await makeApp();
    await setupOwner(app);
    const c = client(app, '198.51.100.1');
    expect((await c.post('/api/auth/sign-in/email', { email: OWNER.email, password: 'wrong password!' })).status).toBe(401);
    const ok = await c.post('/api/auth/sign-in/email', { email: OWNER.email, password: OWNER.password });
    expect(ok.status).toBe(200);
    expect((await c.get('/api/me')).status).toBe(200);
    await c.post('/api/auth/sign-out');
    expect((await c.get('/api/me')).status).toBe(401);
  });

  it('rate limits sign-in to 5 attempts per minute per IP', async () => {
    const { app } = await makeApp();
    await setupOwner(app);
    const c = client(app, '198.51.100.99');
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      statuses.push((await c.post('/api/auth/sign-in/email', { email: OWNER.email, password: 'nope-nope-nope' })).status);
    }
    expect(statuses.slice(0, 5).every((s) => s === 401)).toBe(true);
    expect(statuses[5]).toBe(429);
  });

  it('reports health with migrations applied', async () => {
    const { app } = await makeApp();
    const res = await client(app).get('/api/health');
    expect(res.json).toMatchObject({ ok: true, db: 'libsql', migrations: 1 });
  });

  it('round-trips the storage adapter for the owner', async () => {
    const { app } = await makeApp();
    const { c } = await setupOwner(app);
    const res = await c.post('/api/selftest/storage');
    expect(res.json).toMatchObject({ ok: true, roundTrip: true, deleted: true });
  });

  it('rejects cross-origin form posts', async () => {
    const { app } = await makeApp();
    const res = await app.request('http://localhost/api/setup', {
      method: 'POST',
      headers: { origin: 'https://evil.example', 'content-type': 'application/x-www-form-urlencoded' },
      body: 'name=x',
    });
    expect(res.status).toBe(403);
  });
});
