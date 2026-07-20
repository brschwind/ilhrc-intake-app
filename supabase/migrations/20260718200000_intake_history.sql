create table if not exists public.intake_history (
  id uuid primary key default gen_random_uuid(),
  item_id text,
  isbn text not null default '',
  source_type text not null check (source_type in ('cover_analysis', 'google_books', 'open_library', 'isbn_only', 'manual')),
  imported_values jsonb not null default '{}'::jsonb,
  rule_values jsonb not null default '{}'::jsonb,
  final_values jsonb not null default '{}'::jsonb,
  manual_corrections jsonb not null default '{}'::jsonb,
  applied_rules jsonb not null default '[]'::jsonb,
  matched_rule_ids jsonb not null default '[]'::jsonb,
  unresolved_conflicts jsonb not null default '{}'::jsonb,
  duplicate_item boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists intake_history_isbn_idx
on public.intake_history (isbn)
where isbn <> '';

create index if not exists intake_history_created_at_idx
on public.intake_history (created_at desc);

alter table public.intake_history enable row level security;

drop policy if exists "intake history active staff insert" on public.intake_history;
create policy "intake history active staff insert"
on public.intake_history for insert to authenticated
with check (public.current_profile_is_active() and created_by = auth.uid());

drop policy if exists "intake history admin read" on public.intake_history;
create policy "intake history admin read"
on public.intake_history for select to authenticated
using (public.current_profile_is_admin());

grant insert on public.intake_history to authenticated;
grant select on public.intake_history to authenticated;
