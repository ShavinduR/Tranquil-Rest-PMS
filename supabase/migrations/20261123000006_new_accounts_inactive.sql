-- Defence in depth: a brand-new auth account has NO access until an admin activates it.
-- (Public sign-ups are also disabled in the project's auth settings; this protects the
-- data even if that setting is ever switched back on.)
-- Staff created through Admin → Settings → Add staff member are activated by the
-- staff-admin function; the owner account is activated by the SQL in the README.

alter table public.profiles alter column active set default false;

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, active)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)), false)
  on conflict (id) do nothing;
  return new;
end $$;
