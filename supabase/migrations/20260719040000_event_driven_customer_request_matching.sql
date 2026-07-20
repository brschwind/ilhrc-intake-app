-- Event-driven customer request matching.
-- New requests scan available inventory once; new intake history rows are queued
-- for the lightweight nightly/manual processor.

alter table public.customer_requests
add column if not exists initial_inventory_scanned_at timestamptz;

create table if not exists public.customer_request_arrival_queue (
  id uuid primary key default gen_random_uuid(),
  intake_history_id uuid not null references public.intake_history(id) on delete cascade,
  item_id text not null,
  status text not null default 'queued' check (status in ('queued', 'processing', 'completed')),
  attempts integer not null default 0,
  queued_at timestamptz not null default now(),
  locked_at timestamptz,
  completed_at timestamptz,
  last_error text not null default '',
  unique (intake_history_id)
);

create index if not exists customer_request_arrival_queue_work_idx
on public.customer_request_arrival_queue (status, queued_at);

alter table public.customer_request_arrival_queue enable row level security;

drop policy if exists "customer request arrival queue staff read" on public.customer_request_arrival_queue;
create policy "customer request arrival queue staff read"
on public.customer_request_arrival_queue for select to authenticated
using (public.current_profile_is_active());

grant select on public.customer_request_arrival_queue to authenticated;

-- Earlier matching could create one match per receipt of the same inventory item.
-- Keep the most progressed review record and enforce one notification/review per
-- request and item from this point forward.
with ranked_matches as (
  select id, row_number() over (
    partition by request_id, item_id
    order by
      case status
        when 'fulfilled' then 1 when 'contacted' then 2
        when 'not_match' then 3 when 'still_waiting' then 4 else 5
      end,
      created_at,
      id
  ) as duplicate_number
  from public.customer_request_matches
)
delete from public.customer_request_matches match
using ranked_matches ranked
where match.id = ranked.id and ranked.duplicate_number > 1;

create unique index if not exists customer_request_matches_request_item_uidx
on public.customer_request_matches (request_id, item_id);

create or replace function public.match_customer_request_inventory(
  p_request_id uuid default null,
  p_intake_history_ids uuid[] default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  created_count integer := 0;
begin
  insert into public.customer_request_matches
    (request_id, item_id, intake_history_id, match_strength, match_reasons)
  select distinct on (request.id, history.item_id)
    request.id,
    history.item_id,
    history.id,
    case
      when public.normalize_request_text(request.isbn) <> ''
        and public.normalize_request_text(request.isbn) = public.normalize_request_text(coalesce(nullif(history.isbn, ''), item.isbn)) then 'exact'
      when public.normalize_request_text(request.title) <> ''
        and public.normalize_request_text(coalesce(history.final_values->>'title', item.title)) = public.normalize_request_text(request.title) then 'strong'
      else 'possible'
    end,
    to_jsonb(array_remove(array[
      case when public.normalize_request_text(request.isbn) <> '' and public.normalize_request_text(request.isbn) = public.normalize_request_text(coalesce(nullif(history.isbn, ''), item.isbn)) then 'ISBN' end,
      case when public.normalize_request_text(request.title) <> '' and public.normalize_request_text(coalesce(history.final_values->>'title', item.title)) like '%' || public.normalize_request_text(request.title) || '%' then 'Title' end,
      case when public.normalize_request_text(request.author) <> '' and public.normalize_request_text(coalesce(history.final_values->>'author', item.author)) like '%' || public.normalize_request_text(request.author) || '%' then 'Author' end,
      case when public.normalize_request_text(request.curriculum) <> '' and public.normalize_request_text(coalesce(history.final_values->>'curriculum', item.curriculum)) like '%' || public.normalize_request_text(request.curriculum) || '%' then 'Curriculum' end,
      case when public.normalize_request_text(request.subject) <> '' and public.normalize_request_text(coalesce(history.final_values->>'subject', item.subject)) = public.normalize_request_text(request.subject) then 'Subject' end,
      case when public.normalize_request_text(request.grade_level) <> '' and public.normalize_request_text(coalesce(history.final_values->>'grade_level', item.grade_level)) = public.normalize_request_text(request.grade_level) then 'Grade level' end
    ], null))
  from public.customer_requests request
  join public.intake_history history
    on (p_intake_history_ids is null or history.id = any(p_intake_history_ids))
  join public.items item on item.id::text = history.item_id
  where request.status = 'active'
    and (p_request_id is null or request.id = p_request_id)
    and coalesce(item.status, 'Available') in ('Available', 'Hold')
    and coalesce(item.quantity, 0) > 0
    and (
      (public.normalize_request_text(request.isbn) <> '' and public.normalize_request_text(request.isbn) = public.normalize_request_text(coalesce(nullif(history.isbn, ''), item.isbn)))
      or (public.normalize_request_text(request.title) <> '' and public.normalize_request_text(coalesce(history.final_values->>'title', item.title)) like '%' || public.normalize_request_text(request.title) || '%')
      or (public.normalize_request_text(request.author) <> '' and public.normalize_request_text(coalesce(history.final_values->>'author', item.author)) like '%' || public.normalize_request_text(request.author) || '%')
      or (public.normalize_request_text(request.curriculum) <> '' and public.normalize_request_text(coalesce(history.final_values->>'curriculum', item.curriculum)) like '%' || public.normalize_request_text(request.curriculum) || '%')
      or (public.normalize_request_text(request.subject) <> '' and public.normalize_request_text(coalesce(history.final_values->>'subject', item.subject)) = public.normalize_request_text(request.subject))
      or (public.normalize_request_text(request.grade_level) <> '' and public.normalize_request_text(coalesce(history.final_values->>'grade_level', item.grade_level)) = public.normalize_request_text(request.grade_level))
    )
  -- Prefer the oldest history row for stable idempotency when legacy inventory
  -- happens to have more than one receipt record.
  order by request.id, history.item_id, history.created_at, history.id
  on conflict (request_id, item_id) do nothing;

  get diagnostics created_count = row_count;
  return created_count;
end
$$;

revoke all on function public.match_customer_request_inventory(uuid, uuid[]) from public, anon, authenticated;

create or replace function public.scan_new_customer_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.match_customer_request_inventory(new.id, null);
  update public.customer_requests
  set initial_inventory_scanned_at = now()
  where id = new.id;
  return new;
end
$$;

revoke all on function public.scan_new_customer_request() from public, anon, authenticated;

drop trigger if exists customer_request_initial_inventory_scan on public.customer_requests;
create trigger customer_request_initial_inventory_scan
after insert on public.customer_requests
for each row execute function public.scan_new_customer_request();

create or replace function public.queue_customer_request_arrival()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.item_id is not null then
    insert into public.customer_request_arrival_queue (intake_history_id, item_id)
    values (new.id, new.item_id)
    on conflict (intake_history_id) do nothing;
  end if;
  return new;
end
$$;

revoke all on function public.queue_customer_request_arrival() from public, anon, authenticated;

drop trigger if exists intake_history_queue_customer_request_arrival on public.intake_history;
create trigger intake_history_queue_customer_request_arrival
after insert on public.intake_history
for each row execute function public.queue_customer_request_arrival();

create or replace function public.run_customer_request_matching(p_batch_size integer default 500)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  run_id uuid;
  selected_queue_ids uuid[];
  selected_history_ids uuid[];
  through_time timestamptz := now();
  created_count integer := 0;
begin
  if auth.uid() is not null and not public.current_profile_is_active() then
    raise exception 'Active staff access is required.';
  end if;
  if p_batch_size < 1 or p_batch_size > 5000 then
    raise exception 'Batch size must be between 1 and 5000.';
  end if;

  -- A worker that died before completing is safe to retry after 15 minutes.
  update public.customer_request_arrival_queue
  set status = 'queued', locked_at = null, last_error = 'Recovered stale processing lock.'
  where status = 'processing' and locked_at < now() - interval '15 minutes';

  select array_agg(id), array_agg(intake_history_id)
  into selected_queue_ids, selected_history_ids
  from (
    select id, intake_history_id
    from public.customer_request_arrival_queue
    where status = 'queued'
    order by queued_at
    limit p_batch_size
    for update skip locked
  ) queued;

  insert into public.customer_request_runs (intake_from, intake_through, started_by)
  values (through_time, through_time, auth.uid()) returning id into run_id;

  if coalesce(cardinality(selected_queue_ids), 0) = 0 then
    update public.customer_request_runs
    set status = 'completed', completed_at = now(), matches_created = 0
    where id = run_id;
    return 0;
  end if;

  update public.customer_request_arrival_queue
  set status = 'processing', attempts = attempts + 1, locked_at = now(), last_error = ''
  where id = any(selected_queue_ids);

  created_count := public.match_customer_request_inventory(null, selected_history_ids);

  update public.customer_request_arrival_queue
  set status = 'completed', completed_at = now(), locked_at = null
  where id = any(selected_queue_ids);

  update public.customer_request_runs
  set status = 'completed', completed_at = now(), matches_created = created_count
  where id = run_id;
  return created_count;
exception when others then
  if selected_queue_ids is not null then
    update public.customer_request_arrival_queue
    set status = 'queued', locked_at = null, last_error = left(sqlerrm, 1000)
    where id = any(selected_queue_ids);
  end if;
  if run_id is not null then
    update public.customer_request_runs
    set status = 'failed', completed_at = now(), error_message = left(sqlerrm, 1000)
    where id = run_id;
  end if;
  raise;
end
$$;

revoke all on function public.run_customer_request_matching(integer) from public;
grant execute on function public.run_customer_request_matching(integer) to authenticated;

-- Preserve the no-argument RPC used by the existing UI and cron job.
create or replace function public.run_customer_request_matching()
returns integer
language sql
security definer
set search_path = public
as $$ select public.run_customer_request_matching(500) $$;

revoke all on function public.run_customer_request_matching() from public;
grant execute on function public.run_customer_request_matching() to authenticated;

-- Queue arrivals that occurred after the most recent successful legacy run,
-- avoiding a full historical replay during deployment.
insert into public.customer_request_arrival_queue (intake_history_id, item_id)
select history.id, history.item_id
from public.intake_history history
where history.item_id is not null
  and history.created_at > coalesce(
    (select max(completed_at) from public.customer_request_runs where status = 'completed'),
    'epoch'::timestamptz
  )
on conflict (intake_history_id) do nothing;

notify pgrst, 'reload schema';
