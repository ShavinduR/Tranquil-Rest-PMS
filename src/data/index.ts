import { createDemoRepo } from './demoRepo';
import type { Repo } from './repo';
import { createSupabaseRepo } from './supabaseRepo';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** Without Supabase credentials the app runs in a self-contained demo mode. */
export const repo: Repo = url && key ? createSupabaseRepo(url, key) : createDemoRepo();
export const isDemo = repo.kind === 'demo';
