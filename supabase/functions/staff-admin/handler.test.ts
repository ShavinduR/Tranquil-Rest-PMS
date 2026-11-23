import { describe, expect, it, vi } from 'vitest';
import { emailSlug, handleStaffAdmin, type StaffAdminDeps } from './handler';

const UID = '11111111-2222-3333-4444-555555555555';

const fakeDeps = (over: Partial<StaffAdminDeps> = {}): StaffAdminDeps & { calls: string[] } => {
  const calls: string[] = [];
  return {
    calls,
    getCaller: vi.fn(async () => ({ id: 'owner', isAdmin: true })),
    createAuthUser: vi.fn(async (p) => { calls.push(`create:${p.email}`); return { id: UID }; }),
    setupProfile: vi.fn(async (_a, id, p) => { calls.push(`profile:${id}:${p.role}:${p.display_name}:${p.pin}`); }),
    setPassword: vi.fn(async (id) => { calls.push(`password:${id}`); return {}; }),
    deleteAuthUser: vi.fn(async (id) => { calls.push(`delete:${id}`); }),
    randomSuffix: () => 'ab12',
    ...over,
  };
};

const post = (body: unknown, auth = 'Bearer token') =>
  new Request('http://x/staff-admin', { method: 'POST', headers: auth ? { Authorization: auth } : {}, body: JSON.stringify(body) });

const create = { action: 'create', display_name: 'Sunil Perera', role: 'caretaker', password: 'river-stone-42', pin: '4826' };

describe('staff-admin edge function', () => {
  it('answers CORS preflight', async () => {
    const r = await handleStaffAdmin(new Request('http://x', { method: 'OPTIONS' }), fakeDeps());
    expect(r.status).toBe(200);
    expect(r.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('rejects anonymous callers and non-admins', async () => {
    expect((await handleStaffAdmin(post(create, ''), fakeDeps())).status).toBe(401);
    const caretaker = fakeDeps({ getCaller: async () => ({ id: 'c', isAdmin: false }) });
    const r = await handleStaffAdmin(post(create), caretaker);
    expect(r.status).toBe(403);
    expect(caretaker.calls).toEqual([]);
  });

  it('creates a caretaker with an auto-generated login email, role, name and PIN', async () => {
    const deps = fakeDeps();
    const r = await handleStaffAdmin(post(create), deps);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, user_id: UID, email: 'sunil.perera.ab12@staff.tranquilrest.local' });
    expect(deps.calls).toEqual(['create:sunil.perera.ab12@staff.tranquilrest.local', `profile:${UID}:caretaker:Sunil Perera:4826`]);
  });

  it('uses a provided email, lower-cased', async () => {
    const deps = fakeDeps();
    const r = await handleStaffAdmin(post({ ...create, email: ' Sunil@Gmail.com ' }), deps);
    expect((await r.json()).email).toBe('sunil@gmail.com');
  });

  it('validates input before touching anything', async () => {
    const cases: [Record<string, unknown>, RegExp][] = [
      [{ ...create, display_name: '  ' }, /Name/],
      [{ ...create, role: 'owner' }, /Role/],
      [{ ...create, password: 'short' }, /at least 8/],
      [{ ...create, pin: '12' }, /4-digit PIN/],
      [{ ...create, pin: undefined }, /4-digit PIN/],
      [{ ...create, email: 'not-an-email' }, /email/],
      [{ action: 'explode' }, /Unknown action/],
    ];
    for (const [body, msg] of cases) {
      const deps = fakeDeps();
      const r = await handleStaffAdmin(post(body), deps);
      expect(r.status).toBe(400);
      expect((await r.json()).error).toMatch(msg);
      expect(deps.calls).toEqual([]);
    }
  });

  it('admins do not need a PIN', async () => {
    const deps = fakeDeps();
    const r = await handleStaffAdmin(post({ ...create, role: 'admin', pin: null }), deps);
    expect(r.status).toBe(200);
    expect(deps.calls[1]).toBe(`profile:${UID}:admin:Sunil Perera:null`);
  });

  it('reports a duplicate email clearly', async () => {
    const deps = fakeDeps({ createAuthUser: async () => ({ error: 'A user with this email address has already been registered', duplicate: true }) });
    const r = await handleStaffAdmin(post(create), deps);
    expect(r.status).toBe(409);
    expect((await r.json()).error).toMatch(/already exists/);
  });

  it('deletes the new login if profile setup fails (no half-made accounts)', async () => {
    const deps = fakeDeps({ setupProfile: async () => { throw new Error('rls denied'); } });
    const r = await handleStaffAdmin(post(create), deps);
    expect(r.status).toBe(500);
    expect(deps.calls).toContain(`delete:${UID}`);
  });

  it('resets a password', async () => {
    const deps = fakeDeps();
    const r = await handleStaffAdmin(post({ action: 'reset_password', user_id: UID, password: 'new-pass-99' }), deps);
    expect(r.status).toBe(200);
    expect(deps.calls).toEqual([`password:${UID}`]);
    expect((await handleStaffAdmin(post({ action: 'reset_password', user_id: 'x', password: 'new-pass-99' }), deps)).status).toBe(400);
    expect((await handleStaffAdmin(post({ action: 'reset_password', user_id: UID, password: 'short' }), deps)).status).toBe(400);
  });

  it('makes readable email slugs', () => {
    expect(emailSlug('Sunil Perera')).toBe('sunil.perera');
    expect(emailSlug('සුනිල්')).toBe('staff');
    expect(emailSlug("D'Silva  Jr.")).toBe('d.silva.jr');
  });
});
