/**
 * Staff account management for admins: create a staff login, or reset a staff
 * member's password. Pure logic with injected dependencies so it can be unit
 * tested outside Deno; index.ts wires the real Supabase clients.
 *
 * Security model:
 *  - The caller's JWT must belong to an active admin (checked server-side).
 *  - Only the auth operations (create user / set password / delete user) use the
 *    service-role key, which never leaves the server.
 *  - Name, role and PIN are written with the CALLER's own permissions, so the
 *    normal RLS + set_staff_pin() checks still apply.
 */

export type Role = 'admin' | 'caretaker';

export type CreateStaffInput = {
  action: 'create';
  display_name: string;
  role: Role;
  email?: string | null;
  password: string;
  pin?: string | null;
};

export type ResetPasswordInput = { action: 'reset_password'; user_id: string; password: string };

export type StaffAdminDeps = {
  /** Resolves the caller from the Authorization header; null if not signed in. */
  getCaller(authHeader: string): Promise<{ id: string; isAdmin: boolean } | null>;
  createAuthUser(p: { email: string; password: string; displayName: string }): Promise<{ id: string } | { error: string; duplicate?: boolean }>;
  /** Runs with the caller's token: updates profile role/name and sets the PIN. */
  setupProfile(authHeader: string, userId: string, p: { role: Role; display_name: string; pin: string | null }): Promise<void>;
  setPassword(userId: string, password: string): Promise<{ error?: string }>;
  deleteAuthUser(userId: string): Promise<void>;
  /** Used for auto-generated login emails. */
  randomSuffix(): string;
};

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const STAFF_EMAIL_DOMAIN = 'staff.tranquilrest.local';
export const MIN_PASSWORD = 8;

/** 'Sunil Perera' → 'sunil.perera'; Sinhala-only names fall back to 'staff'. */
export const emailSlug = (name: string): string =>
  name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '').slice(0, 30) || 'staff';

/** Untrusted request body: every field optional until validated. */
type RequestBody = {
  action?: string;
  display_name?: string;
  role?: string;
  email?: string | null;
  password?: unknown;
  pin?: string | null;
  user_id?: string;
};

const validateCreate = (b: RequestBody): string | null => {
  const name = (b.display_name ?? '').trim();
  if (!name || name.length > 60) return 'Name is required (max 60 characters).';
  if (b.role !== 'admin' && b.role !== 'caretaker') return 'Role must be caretaker or admin.';
  if (b.email && !EMAIL_RE.test(b.email.trim())) return 'That email address is not valid.';
  if (typeof b.password !== 'string' || b.password.length < MIN_PASSWORD) return `Password must be at least ${MIN_PASSWORD} characters.`;
  if (b.role === 'caretaker' && !/^\d{4}$/.test(b.pin ?? '')) return 'Caretakers need a 4-digit PIN.';
  if (b.pin && !/^\d{4}$/.test(b.pin)) return 'PIN must be exactly 4 digits.';
  return null;
};

export const handleStaffAdmin = async (req: Request, deps: StaffAdminDeps): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const auth = req.headers.get('Authorization') ?? '';
  const caller = auth ? await deps.getCaller(auth) : null;
  if (!caller) return json(401, { error: 'Please sign in again.' });
  if (!caller.isAdmin) return json(403, { error: 'Only the owner (admin) can manage staff accounts.' });

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'Invalid request.' });
  }

  if (body.action === 'reset_password') {
    if (!body.user_id || !UUID_RE.test(body.user_id)) return json(400, { error: 'Unknown staff member.' });
    if (typeof body.password !== 'string' || body.password.length < MIN_PASSWORD) {
      return json(400, { error: `Password must be at least ${MIN_PASSWORD} characters.` });
    }
    const r = await deps.setPassword(body.user_id, body.password);
    if (r.error) return json(400, { error: r.error });
    return json(200, { ok: true });
  }

  if (body.action !== 'create') return json(400, { error: 'Unknown action.' });
  const problem = validateCreate(body);
  if (problem) return json(400, { error: problem });

  const display_name = body.display_name!.trim();
  const email = (body.email?.trim() || `${emailSlug(display_name)}.${deps.randomSuffix()}@${STAFF_EMAIL_DOMAIN}`).toLowerCase();
  const created = await deps.createAuthUser({ email, password: body.password as string, displayName: display_name });
  if ('error' in created) {
    return json(created.duplicate ? 409 : 400, { error: created.duplicate ? 'A login with this email already exists.' : created.error });
  }

  try {
    await deps.setupProfile(auth, created.id, { role: body.role as Role, display_name, pin: body.pin ?? null });
  } catch (e) {
    // Never leave a half-made account behind.
    await deps.deleteAuthUser(created.id).catch(() => undefined);
    return json(500, { error: `Could not finish setting up the account: ${e instanceof Error ? e.message : 'unknown error'}` });
  }

  return json(200, { ok: true, user_id: created.id, email });
};
