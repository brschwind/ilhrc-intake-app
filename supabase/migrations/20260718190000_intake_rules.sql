create table if not exists public.intake_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  match_mode text not null default 'all' check (match_mode in ('all', 'any')),
  conditions jsonb not null default '[]'::jsonb,
  actions jsonb not null default '{}'::jsonb,
  priority integer not null default 0,
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint intake_rules_has_conditions check (jsonb_array_length(conditions) > 0),
  constraint intake_rules_has_actions check (actions <> '{}'::jsonb)
);

create or replace function public.touch_intake_rule_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end
$$;

drop trigger if exists intake_rules_touch_updated_at on public.intake_rules;
create trigger intake_rules_touch_updated_at
before update on public.intake_rules
for each row execute function public.touch_intake_rule_updated_at();

alter table public.intake_rules enable row level security;

drop policy if exists "intake rules active staff read" on public.intake_rules;
create policy "intake rules active staff read"
on public.intake_rules for select to authenticated
using (public.current_profile_is_active());

drop policy if exists "intake rules admin insert" on public.intake_rules;
create policy "intake rules admin insert"
on public.intake_rules for insert to authenticated
with check (public.current_profile_is_admin());

drop policy if exists "intake rules admin update" on public.intake_rules;
create policy "intake rules admin update"
on public.intake_rules for update to authenticated
using (public.current_profile_is_admin())
with check (public.current_profile_is_admin());

drop policy if exists "intake rules admin delete" on public.intake_rules;
create policy "intake rules admin delete"
on public.intake_rules for delete to authenticated
using (public.current_profile_is_admin());

grant select on public.intake_rules to authenticated;
grant insert, update, delete on public.intake_rules to authenticated;
