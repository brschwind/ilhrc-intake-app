create table if not exists public.customer_requests (
  id uuid primary key default gen_random_uuid(),
  customer_name text not null,
  email text not null default '',
  phone text not null default '',
  preferred_contact text not null default 'email' check (preferred_contact in ('email', 'phone', 'either')),
  isbn text not null default '',
  title text not null default '',
  author text not null default '',
  curriculum text not null default '',
  subject text not null default '',
  grade_level text not null default '',
  notes text not null default '',
  status text not null default 'active' check (status in ('active', 'fulfilled', 'closed')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (email <> '' or phone <> ''),
  check (isbn <> '' or title <> '' or author <> '' or curriculum <> '' or subject <> '' or grade_level <> '')
);

create table if not exists public.customer_request_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null default 'running' check (status in ('running', 'completed', 'failed')),
  intake_from timestamptz not null,
  intake_through timestamptz not null,
  matches_created integer not null default 0,
  error_message text not null default '',
  started_by uuid references auth.users(id) on delete set null
);

create table if not exists public.customer_request_matches (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.customer_requests(id) on delete cascade,
  item_id text not null,
  intake_history_id uuid not null references public.intake_history(id) on delete cascade,
  match_strength text not null check (match_strength in ('exact', 'strong', 'possible')),
  match_reasons jsonb not null default '[]'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'contacted', 'fulfilled', 'not_match', 'still_waiting')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (request_id, intake_history_id)
);

create index if not exists customer_requests_status_idx on public.customer_requests(status, created_at desc);
create index if not exists customer_request_matches_status_idx on public.customer_request_matches(status, created_at desc);

alter table public.customer_requests enable row level security;
alter table public.customer_request_runs enable row level security;
alter table public.customer_request_matches enable row level security;

drop policy if exists "customer requests staff manage" on public.customer_requests;
create policy "customer requests staff manage" on public.customer_requests for all to authenticated
using (public.current_profile_is_active()) with check (public.current_profile_is_active());
drop policy if exists "customer request runs staff read" on public.customer_request_runs;
create policy "customer request runs staff read" on public.customer_request_runs for select to authenticated
using (public.current_profile_is_active());
drop policy if exists "customer request matches staff manage" on public.customer_request_matches;
create policy "customer request matches staff manage" on public.customer_request_matches for all to authenticated
using (public.current_profile_is_active()) with check (public.current_profile_is_active());

grant select, insert, update on public.customer_requests to authenticated;
grant select on public.customer_request_runs to authenticated;
grant select, update on public.customer_request_matches to authenticated;

create or replace function public.normalize_request_text(value text)
returns text language sql immutable as $$
  select regexp_replace(lower(coalesce(value, '')), '[^a-z0-9]+', '', 'g')
$$;

create or replace function public.run_customer_request_matching()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  run_id uuid;
  from_time timestamptz;
  through_time timestamptz := now();
  created_count integer := 0;
begin
  if auth.uid() is not null and not public.current_profile_is_active() then
    raise exception 'Active staff access is required.';
  end if;

  select coalesce(max(completed_at), '2020-01-01'::timestamptz) into from_time
  from public.customer_request_runs where status = 'completed';

  -- A request submitted after the last completed run has never been compared
  -- with older inventory. Give new requests one full-history check; conflicts
  -- below prevent previously recorded matches from being duplicated.
  if exists (
    select 1 from public.customer_requests
    where status = 'active' and created_at > from_time
  ) then
    from_time := '2020-01-01'::timestamptz;
  end if;

  insert into public.customer_request_runs (intake_from, intake_through, started_by)
  values (from_time, through_time, auth.uid()) returning id into run_id;

  insert into public.customer_request_matches
    (request_id, item_id, intake_history_id, match_strength, match_reasons)
  select
    request.id,
    history.item_id,
    history.id,
    case
      when public.normalize_request_text(request.isbn) <> ''
        and public.normalize_request_text(request.isbn) = public.normalize_request_text(coalesce(history.isbn, item.isbn)) then 'exact'
      when public.normalize_request_text(request.title) <> ''
        and public.normalize_request_text(coalesce(history.final_values->>'title', item.title)) = public.normalize_request_text(request.title) then 'strong'
      else 'possible'
    end,
    to_jsonb(array_remove(array[
      case when public.normalize_request_text(request.isbn) <> '' and public.normalize_request_text(request.isbn) = public.normalize_request_text(coalesce(history.isbn, item.isbn)) then 'ISBN' end,
      case when public.normalize_request_text(request.title) <> '' and public.normalize_request_text(coalesce(history.final_values->>'title', item.title)) like '%' || public.normalize_request_text(request.title) || '%' then 'Title' end,
      case when public.normalize_request_text(request.author) <> '' and public.normalize_request_text(history.final_values->>'author') like '%' || public.normalize_request_text(request.author) || '%' then 'Author' end,
      case when public.normalize_request_text(request.curriculum) <> '' and public.normalize_request_text(coalesce(history.final_values->>'curriculum', item.curriculum)) like '%' || public.normalize_request_text(request.curriculum) || '%' then 'Curriculum' end,
      case when public.normalize_request_text(request.subject) <> '' and public.normalize_request_text(coalesce(history.final_values->>'subject', item.subject)) = public.normalize_request_text(request.subject) then 'Subject' end,
      case when public.normalize_request_text(request.grade_level) <> '' and public.normalize_request_text(coalesce(history.final_values->>'grade_level', item.grade_level)) = public.normalize_request_text(request.grade_level) then 'Grade level' end
    ], null))
  from public.customer_requests request
  join public.intake_history history on history.created_at > from_time and history.created_at <= through_time
  join public.items item on item.id::text = history.item_id
  where request.status = 'active'
    and coalesce(item.status, 'Available') in ('Available', 'Hold')
    and coalesce(item.quantity, 0) > 0
    and (
      (public.normalize_request_text(request.isbn) <> '' and public.normalize_request_text(request.isbn) = public.normalize_request_text(coalesce(history.isbn, item.isbn)))
      or (public.normalize_request_text(request.title) <> '' and public.normalize_request_text(coalesce(history.final_values->>'title', item.title)) like '%' || public.normalize_request_text(request.title) || '%')
      or (public.normalize_request_text(request.author) <> '' and public.normalize_request_text(history.final_values->>'author') like '%' || public.normalize_request_text(request.author) || '%')
      or (public.normalize_request_text(request.curriculum) <> '' and public.normalize_request_text(coalesce(history.final_values->>'curriculum', item.curriculum)) like '%' || public.normalize_request_text(request.curriculum) || '%')
      or (public.normalize_request_text(request.subject) <> '' and public.normalize_request_text(coalesce(history.final_values->>'subject', item.subject)) = public.normalize_request_text(request.subject))
      or (public.normalize_request_text(request.grade_level) <> '' and public.normalize_request_text(coalesce(history.final_values->>'grade_level', item.grade_level)) = public.normalize_request_text(request.grade_level))
    )
  on conflict (request_id, intake_history_id) do nothing;

  get diagnostics created_count = row_count;
  update public.customer_request_runs set status = 'completed', completed_at = now(), matches_created = created_count where id = run_id;
  return created_count;
exception when others then
  if run_id is not null then
    update public.customer_request_runs set status = 'failed', completed_at = now(), error_message = sqlerrm where id = run_id;
  end if;
  raise;
end
$$;

grant execute on function public.run_customer_request_matching() to authenticated;

-- Runs at 10 PM Central during daylight-saving time and 9 PM Central otherwise.
create extension if not exists pg_cron;
do $$
begin
  if not exists (select 1 from cron.job where jobname = 'customer-request-evening-match') then
    perform cron.schedule('customer-request-evening-match', '0 3 * * *', 'select public.run_customer_request_matching();');
  end if;
end
$$;
