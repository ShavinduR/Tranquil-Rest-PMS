// Supabase Edge Function: staff-admin
// Deploy: supabase functions deploy staff-admin
// SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase automatically.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { handleStaffAdmin, type StaffAdminDeps } from './handler.ts';

const url = Deno.env.get('SUPABASE_URL')!;
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const asCaller = (authHeader: string) =>
  createClient(url, anonKey, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } });

const deps: StaffAdminDeps = {
  async getCaller(authHeader) {
    const client = asCaller(authHeader);
    const { data } = await client.auth.getUser(authHeader.replace(/^Bearer\s+/i, ''));
    if (!data.user) return null;
    const { data: isAdmin } = await client.rpc('is_admin');
    return { id: data.user.id, isAdmin: isAdmin === true };
  },
  async createAuthUser({ email, password, displayName }) {
    const { data, error } = await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // no confirmation e-mail: the owner hands the login over in person
      user_metadata: { display_name: displayName },
    });
    if (error || !data.user) {
      return { error: error?.message ?? 'Could not create the login.', duplicate: /already|registered|exists/i.test(error?.message ?? '') };
    }
    return { id: data.user.id };
  },
  async setupProfile(authHeader, userId, { role, display_name, pin }) {
    const client = asCaller(authHeader);
    const { error } = await client.from('profiles').update({ role, display_name, active: true }).eq('id', userId);
    if (error) throw new Error(error.message);
    if (pin) {
      const { error: pinError } = await client.rpc('set_staff_pin', { p_user_id: userId, p_pin: pin });
      if (pinError) throw new Error(pinError.message);
    }
  },
  async setPassword(userId, password) {
    const { error } = await service.auth.admin.updateUserById(userId, { password });
    return error ? { error: error.message } : {};
  },
  async deleteAuthUser(userId) {
    await service.auth.admin.deleteUser(userId);
  },
  randomSuffix: () => crypto.randomUUID().slice(0, 4),
};

Deno.serve((req) => handleStaffAdmin(req, deps));
