create table if not exists public.curriculum_inventory_matches (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references public.curriculum_materials(id) on delete cascade,
  inventory_item_id text not null,
  confirmed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (material_id, inventory_item_id)
);

create index if not exists curriculum_inventory_matches_material_idx
on public.curriculum_inventory_matches (material_id);

alter table public.curriculum_inventory_matches enable row level security;

drop policy if exists "curriculum inventory matches staff read" on public.curriculum_inventory_matches;
create policy "curriculum inventory matches staff read"
on public.curriculum_inventory_matches
for select to authenticated
using (public.current_profile_is_active());

drop policy if exists "curriculum inventory matches staff write" on public.curriculum_inventory_matches;
create policy "curriculum inventory matches staff write"
on public.curriculum_inventory_matches
for all to authenticated
using (public.current_profile_is_active())
with check (public.current_profile_is_active());

create or replace view public.public_curriculum_inventory_matches
with (security_barrier = true)
as
select material_id, inventory_item_id, created_at
from public.curriculum_inventory_matches;

grant select on public.public_curriculum_inventory_matches to anon, authenticated;
grant select, insert, update, delete on public.curriculum_inventory_matches to authenticated;

notify pgrst, 'reload schema';
