create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  role text not null check (role in ('admin', 'team')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Required by the public catalog visibility filter. If the column is new,
-- existing inventory remains publicly eligible by default only when status is
-- Available and quantity is greater than zero.
alter table public.items
add column if not exists public_visible boolean not null default true;

create or replace function public.current_profile_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role
  from public.profiles
  where id = auth.uid()
    and is_active = true
$$;

create or replace function public.current_profile_is_active()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select is_active
      from public.profiles
      where id = auth.uid()
    ),
    false
  )
$$;

create or replace function public.current_profile_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_profile_role() = 'admin'
$$;

create or replace function public.prevent_final_active_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  active_admin_count integer;
begin
  if old.role = 'admin'
    and old.is_active = true
    and (new.role <> 'admin' or new.is_active = false)
  then
    select count(*)
    into active_admin_count
    from public.profiles
    where role = 'admin'
      and is_active = true
      and id <> old.id;

    if active_admin_count = 0 then
      raise exception 'At least one active Admin must remain.';
    end if;
  end if;

  new.updated_at = now();
  return new;
end
$$;

drop trigger if exists profiles_prevent_final_active_admin on public.profiles;
create trigger profiles_prevent_final_active_admin
before update on public.profiles
for each row
execute function public.prevent_final_active_admin();

create or replace view public.public_catalog_items as
select
  id,
  title,
  curriculum,
  subject,
  grade_level,
  category,
  edition,
  isbn,
  final_price,
  quantity,
  image_url,
  created_at
from public.items
where coalesce(status, 'Available') = 'Available'
  and coalesce(public_visible, true) = true
  and coalesce(quantity, 0) > 0;

grant select on public.public_catalog_items to anon, authenticated;

-- Enable RLS for authentication/RBAC tables.
alter table public.profiles enable row level security;
alter table public.audit_logs enable row level security;

-- Enable RLS for inventory. Run this migration only after the new frontend and
-- backend are ready because anonymous direct reads from public.items will stop.
alter table public.items enable row level security;

drop policy if exists "profiles self read" on public.profiles;
create policy "profiles self read"
on public.profiles
for select
to authenticated
using (id = auth.uid() and is_active = true);

drop policy if exists "profiles admin read" on public.profiles;
create policy "profiles admin read"
on public.profiles
for select
to authenticated
using (public.current_profile_is_admin());

drop policy if exists "profiles admin insert" on public.profiles;
create policy "profiles admin insert"
on public.profiles
for insert
to authenticated
with check (public.current_profile_is_admin());

drop policy if exists "profiles admin update" on public.profiles;
create policy "profiles admin update"
on public.profiles
for update
to authenticated
using (public.current_profile_is_admin())
with check (public.current_profile_is_admin());

drop policy if exists "audit admin read" on public.audit_logs;
create policy "audit admin read"
on public.audit_logs
for select
to authenticated
using (public.current_profile_is_admin());

drop policy if exists "audit active staff insert" on public.audit_logs;
create policy "audit active staff insert"
on public.audit_logs
for insert
to authenticated
with check (public.current_profile_is_active());

drop policy if exists "items active staff read" on public.items;
create policy "items active staff read"
on public.items
for select
to authenticated
using (public.current_profile_is_active());

drop policy if exists "items active staff insert" on public.items;
create policy "items active staff insert"
on public.items
for insert
to authenticated
with check (public.current_profile_is_active());

drop policy if exists "items active staff update" on public.items;
create policy "items active staff update"
on public.items
for update
to authenticated
using (public.current_profile_is_active())
with check (public.current_profile_is_active());

drop policy if exists "items active staff delete" on public.items;
drop policy if exists "items active admin delete" on public.items;
create policy "items active admin delete"
on public.items
for delete
to authenticated
using (public.current_profile_is_admin());

-- Enable RLS for option-management tables used by the current app.
alter table if exists public.curriculum_options enable row level security;
alter table if exists public.subject_options enable row level security;
alter table if exists public.grade_options enable row level security;
alter table if exists public.category_options enable row level security;
alter table if exists public.location_options enable row level security;

drop policy if exists "curriculum options public read" on public.curriculum_options;
create policy "curriculum options public read"
on public.curriculum_options
for select
to anon, authenticated
using (true);

drop policy if exists "subject options public read" on public.subject_options;
create policy "subject options public read"
on public.subject_options
for select
to anon, authenticated
using (true);

drop policy if exists "grade options public read" on public.grade_options;
create policy "grade options public read"
on public.grade_options
for select
to anon, authenticated
using (true);

drop policy if exists "category options public read" on public.category_options;
create policy "category options public read"
on public.category_options
for select
to anon, authenticated
using (true);

drop policy if exists "location options staff read" on public.location_options;
create policy "location options staff read"
on public.location_options
for select
to authenticated
using (public.current_profile_is_active());

drop policy if exists "curriculum options staff write" on public.curriculum_options;
create policy "curriculum options staff write"
on public.curriculum_options
for all
to authenticated
using (public.current_profile_is_active())
with check (public.current_profile_is_active());

drop policy if exists "subject options staff write" on public.subject_options;
create policy "subject options staff write"
on public.subject_options
for all
to authenticated
using (public.current_profile_is_active())
with check (public.current_profile_is_active());

drop policy if exists "grade options staff write" on public.grade_options;
create policy "grade options staff write"
on public.grade_options
for all
to authenticated
using (public.current_profile_is_active())
with check (public.current_profile_is_active());

drop policy if exists "category options staff write" on public.category_options;
create policy "category options staff write"
on public.category_options
for all
to authenticated
using (public.current_profile_is_active())
with check (public.current_profile_is_active());

drop policy if exists "location options staff write" on public.location_options;
create policy "location options staff write"
on public.location_options
for all
to authenticated
using (public.current_profile_is_active())
with check (public.current_profile_is_active());

grant select, insert, update, delete on public.items to authenticated;
grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert on public.audit_logs to authenticated;
grant select on public.curriculum_options to anon, authenticated;
grant select on public.subject_options to anon, authenticated;
grant select on public.grade_options to anon, authenticated;
grant select on public.category_options to anon, authenticated;
grant select, insert, update, delete on public.curriculum_options to authenticated;
grant select, insert, update, delete on public.subject_options to authenticated;
grant select, insert, update, delete on public.grade_options to authenticated;
grant select, insert, update, delete on public.category_options to authenticated;
grant select, insert, update, delete on public.location_options to authenticated;
