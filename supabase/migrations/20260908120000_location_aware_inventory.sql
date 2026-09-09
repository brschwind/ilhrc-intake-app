-- Location-aware inventory phase 1.
-- `items` remains the SKU/catalog entity. Its legacy quantity/location columns are
-- retained as a compatibility cache while every authoritative count lives here.

create table if not exists public.inventory_locations (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  display_name text not null,
  location_type text not null default 'shelf'
    check (location_type in ('shelf', 'processing', 'hold', 'overflow', 'display', 'needs_review', 'legacy')),
  active boolean not null default true,
  last_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventory_locations_code_format check (code = upper(code) and code !~ '\\s'),
  constraint inventory_shelf_code_format check (location_type <> 'shelf' or code ~ '^[A-Z]+[0-9]+$'),
  unique (code)
);

insert into public.inventory_locations (code, display_name, location_type)
values
  ('PROCESSING', 'Processing', 'processing'),
  ('HOLD', 'Hold', 'hold'),
  ('OVERFLOW', 'Overflow', 'overflow'),
  ('DISPLAY', 'Display', 'display'),
  ('NEEDS_REVIEW', 'Needs Review', 'needs_review'),
  ('UNVERIFIED_LEGACY', 'Unverified Legacy Inventory', 'legacy')
on conflict (code) do update set active = true;

alter table public.items
add column if not exists needs_catalog_review boolean not null default false;

-- Preserve existing named shelf data without assuming that it is accurate.
insert into public.inventory_locations (code, display_name, location_type)
select distinct
  case
    when upper(trim(item.location)) ~ '^[A-Z]+[0-9]+$' then upper(trim(item.location))
    else 'LEGACY_' || upper(substr(md5(trim(item.location)), 1, 12))
  end,
  trim(item.location),
  case when upper(trim(item.location)) ~ '^[A-Z]+[0-9]+$' then 'shelf' else 'legacy' end
from public.items item
where nullif(trim(item.location), '') is not null
on conflict (code) do nothing;

create table if not exists public.inventory_by_location (
  id uuid primary key default gen_random_uuid(),
  item_id text not null,
  location_id uuid not null references public.inventory_locations(id) on delete restrict,
  quantity integer not null default 0 check (quantity >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (item_id, location_id)
);

create index if not exists inventory_by_location_item_idx
on public.inventory_by_location (item_id);
create index if not exists inventory_by_location_location_idx
on public.inventory_by_location (location_id) where quantity > 0;

-- Safe, idempotent backfill. A current shelf name is preserved; missing locations
-- become explicitly unverified rather than being presented as shelf-verified.
insert into public.inventory_by_location (item_id, location_id, quantity)
select
  item.id::text,
  coalesce(named_location.id, legacy_location.id),
  greatest(coalesce(item.quantity, 0), 0)
from public.items item
cross join public.inventory_locations legacy_location
left join public.inventory_locations named_location on named_location.code = case
  when upper(trim(item.location)) ~ '^[A-Z]+[0-9]+$' then upper(trim(item.location))
  when nullif(trim(item.location), '') is not null then 'LEGACY_' || upper(substr(md5(trim(item.location)), 1, 12))
  else null
end
where legacy_location.code = 'UNVERIFIED_LEGACY'
  and greatest(coalesce(item.quantity, 0), 0) > 0
on conflict (item_id, location_id) do nothing;

create table if not exists public.inventory_scan_sessions (
  id uuid primary key default gen_random_uuid(),
  mode text not null check (mode in ('intake', 'shelving', 'shelf_audit')),
  location_id uuid references public.inventory_locations(id) on delete restrict,
  user_id uuid references auth.users(id) on delete set null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null default 'active' check (status in ('active', 'review', 'completed', 'cancelled')),
  created_at timestamptz not null default now(),
  check ((mode <> 'shelf_audit') or location_id is not null)
);

create table if not exists public.inventory_scan_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.inventory_scan_sessions(id) on delete restrict,
  client_event_id text not null,
  item_id text not null,
  raw_scan text not null,
  from_location_id uuid references public.inventory_locations(id) on delete restrict,
  to_location_id uuid references public.inventory_locations(id) on delete restrict,
  quantity integer not null default 1 check (quantity > 0),
  undone_at timestamptz,
  created_at timestamptz not null default now(),
  unique (session_id, client_event_id)
);

create table if not exists public.inventory_audit_observations (
  session_id uuid not null references public.inventory_scan_sessions(id) on delete restrict,
  item_id text not null,
  observed_quantity integer not null default 0 check (observed_quantity >= 0),
  updated_at timestamptz not null default now(),
  primary key (session_id, item_id)
);

create table if not exists public.inventory_events (
  id uuid primary key default gen_random_uuid(),
  item_id text not null,
  from_location_id uuid references public.inventory_locations(id) on delete restrict,
  to_location_id uuid references public.inventory_locations(id) on delete restrict,
  quantity integer not null check (quantity > 0),
  quantity_delta integer not null,
  action_type text not null check (action_type in (
    'intake', 'shelving', 'discover', 'move', 'reconciliation', 'shelf_audit',
    'quick_add', 'manual_adjustment', 'removal', 'override', 'legacy_backfill', 'undo'
  )),
  user_id uuid references auth.users(id) on delete set null,
  scan_session_id uuid references public.inventory_scan_sessions(id) on delete set null,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists inventory_events_item_created_idx
on public.inventory_events (item_id, created_at desc);
create index if not exists inventory_events_session_idx
on public.inventory_events (scan_session_id) where scan_session_id is not null;

insert into public.inventory_events (
  item_id, to_location_id, quantity, quantity_delta, action_type, notes
)
select stock.item_id, stock.location_id, stock.quantity, stock.quantity, 'legacy_backfill',
  'Initial non-destructive migration from items.quantity.'
from public.inventory_by_location stock
where stock.quantity > 0
  and not exists (
    select 1 from public.inventory_events event
    where event.item_id = stock.item_id and event.action_type = 'legacy_backfill'
  );

create or replace view public.inventory_item_totals
with (security_invoker = true)
as
select stock.item_id, coalesce(sum(stock.quantity), 0)::integer as total_quantity
from public.inventory_by_location stock
join public.inventory_locations location on location.id = stock.location_id and location.active
group by stock.item_id;

create or replace view public.inventory_location_details
with (security_invoker = true)
as
select
  stock.item_id,
  stock.location_id,
  location.code,
  location.display_name,
  location.location_type,
  location.active,
  location.last_verified_at,
  stock.quantity,
  stock.updated_at
from public.inventory_by_location stock
join public.inventory_locations location on location.id = stock.location_id;

create or replace function public.inventory_item_exists(p_item_id text)
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.items where id::text = p_item_id) $$;

create or replace function public.sync_item_inventory_cache(p_item_id text)
returns void language plpgsql security definer set search_path = public
as $$
declare
  calculated_total integer;
  location_count integer;
  only_location text;
begin
  select coalesce(sum(stock.quantity), 0)::integer,
    count(*) filter (where stock.quantity > 0),
    min(location.display_name) filter (where stock.quantity > 0)
  into calculated_total, location_count, only_location
  from public.inventory_by_location stock
  join public.inventory_locations location on location.id = stock.location_id and location.active
  where stock.item_id = p_item_id;

  update public.items
  set quantity = calculated_total,
      location = case when location_count = 1 then only_location else null end
  where id::text = p_item_id
    and (quantity is distinct from calculated_total
      or location is distinct from case when location_count = 1 then only_location else null end);
end;
$$;

create or replace function public.after_location_stock_change()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  perform public.sync_item_inventory_cache(coalesce(new.item_id, old.item_id));
  return coalesce(new, old);
end;
$$;

drop trigger if exists inventory_stock_sync_item_cache on public.inventory_by_location;
create trigger inventory_stock_sync_item_cache
after insert or update or delete on public.inventory_by_location
for each row execute function public.after_location_stock_change();

-- Compatibility bridge for unconverted legacy writers. It can increase the
-- explicitly unverified pool and reduce only that pool. It will never guess which
-- verified shelf should lose stock.
create or replace function public.bridge_legacy_item_quantity_write()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  current_total integer;
  difference integer;
  legacy_id uuid;
  legacy_quantity integer;
begin
  if pg_trigger_depth() > 1 then return new; end if;
  select id into legacy_id from public.inventory_locations where code = 'UNVERIFIED_LEGACY';

  if tg_op = 'INSERT' then
    if coalesce(new.quantity, 0) > 0 then
      insert into public.inventory_by_location (item_id, location_id, quantity)
      values (new.id::text, legacy_id, new.quantity)
      on conflict (item_id, location_id) do update
      set quantity = excluded.quantity, updated_at = now();
    end if;
    return new;
  end if;

  if new.quantity is not distinct from old.quantity then return new; end if;
  select coalesce(sum(quantity), 0)::integer into current_total
  from public.inventory_by_location where item_id = new.id::text;
  difference := coalesce(new.quantity, 0) - current_total;
  if difference = 0 then return new; end if;

  select coalesce(quantity, 0) into legacy_quantity
  from public.inventory_by_location
  where item_id = new.id::text and location_id = legacy_id;

  if difference < 0 and coalesce(legacy_quantity, 0) < abs(difference) then
    raise exception 'This change needs a source location. Use Move/Adjust Stock; verified shelves were not changed.';
  end if;

  insert into public.inventory_by_location (item_id, location_id, quantity)
  values (new.id::text, legacy_id, greatest(difference, 0))
  on conflict (item_id, location_id) do update
  set quantity = inventory_by_location.quantity + difference, updated_at = now();
  return new;
end;
$$;

drop trigger if exists items_legacy_quantity_bridge on public.items;
create trigger items_legacy_quantity_bridge
after insert or update of quantity on public.items
for each row execute function public.bridge_legacy_item_quantity_write();

create or replace function public.adjust_inventory_at_location(
  p_item_id text,
  p_location_id uuid,
  p_quantity_delta integer,
  p_action_type text default 'manual_adjustment',
  p_notes text default null,
  p_scan_session_id uuid default null
) returns integer language plpgsql security definer set search_path = public
as $$
declare current_quantity integer; new_quantity integer;
begin
  if not public.current_profile_is_active() then raise exception 'Active staff access required.'; end if;
  if not public.inventory_item_exists(p_item_id) then raise exception 'Inventory item not found.'; end if;
  if p_quantity_delta = 0 then raise exception 'Quantity change cannot be zero.'; end if;
  perform 1 from public.inventory_locations where id = p_location_id and active for update;
  if not found then raise exception 'Active location not found.'; end if;

  insert into public.inventory_by_location (item_id, location_id, quantity)
  values (p_item_id, p_location_id, 0)
  on conflict (item_id, location_id) do nothing;
  select quantity into current_quantity from public.inventory_by_location
  where item_id = p_item_id and location_id = p_location_id for update;
  new_quantity := current_quantity + p_quantity_delta;
  if new_quantity < 0 then raise exception 'Insufficient stock at the source location.'; end if;

  update public.inventory_by_location set quantity = new_quantity, updated_at = now()
  where item_id = p_item_id and location_id = p_location_id;
  insert into public.inventory_events (
    item_id, from_location_id, to_location_id, quantity, quantity_delta,
    action_type, user_id, scan_session_id, notes
  ) values (
    p_item_id,
    case when p_quantity_delta < 0 then p_location_id end,
    case when p_quantity_delta > 0 then p_location_id end,
    abs(p_quantity_delta), p_quantity_delta, p_action_type, auth.uid(), p_scan_session_id, p_notes
  );
  return new_quantity;
end;
$$;

create or replace function public.inventory_event_defaults()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.user_id is null then new.user_id := auth.uid(); end if;
  return new;
end;
$$;

drop trigger if exists inventory_events_fill_user on public.inventory_events;
create trigger inventory_events_fill_user
before insert on public.inventory_events
for each row execute function public.inventory_event_defaults();

create or replace function public.move_inventory_stock(
  p_item_id text, p_from_location_id uuid, p_to_location_id uuid,
  p_quantity integer, p_notes text default null, p_scan_session_id uuid default null,
  p_action_type text default 'move'
) returns void language plpgsql security definer set search_path = public
as $$
declare source_quantity integer;
begin
  if not public.current_profile_is_active() then raise exception 'Active staff access required.'; end if;
  if p_quantity <= 0 or p_from_location_id = p_to_location_id then raise exception 'Invalid move.'; end if;
  select quantity into source_quantity from public.inventory_by_location
  where item_id = p_item_id and location_id = p_from_location_id for update;
  if coalesce(source_quantity, 0) < p_quantity then raise exception 'Insufficient stock at the source location.'; end if;
  perform 1 from public.inventory_locations where id = p_to_location_id and active for update;
  if not found then raise exception 'Destination location is not active.'; end if;

  update public.inventory_by_location set quantity = quantity - p_quantity, updated_at = now()
  where item_id = p_item_id and location_id = p_from_location_id;
  insert into public.inventory_by_location (item_id, location_id, quantity)
  values (p_item_id, p_to_location_id, p_quantity)
  on conflict (item_id, location_id) do update
  set quantity = inventory_by_location.quantity + excluded.quantity, updated_at = now();
  insert into public.inventory_events (
    item_id, from_location_id, to_location_id, quantity, quantity_delta,
    action_type, user_id, scan_session_id, notes
  ) values (
    p_item_id, p_from_location_id, p_to_location_id, p_quantity, 0,
    p_action_type, auth.uid(), p_scan_session_id, p_notes
  );
end;
$$;

create or replace function public.archive_inventory_item(p_item_id text, p_notes text default null)
returns void language plpgsql security definer set search_path = public
as $$
declare stock record;
begin
  if not public.current_profile_is_active() then raise exception 'Active staff access required.'; end if;
  if not public.inventory_item_exists(p_item_id) then raise exception 'Inventory item not found.'; end if;
  for stock in
    select location_id, quantity from public.inventory_by_location
    where item_id = p_item_id and quantity > 0 for update
  loop
    insert into public.inventory_events (
      item_id, from_location_id, quantity, quantity_delta, action_type, user_id, notes
    ) values (p_item_id, stock.location_id, stock.quantity, -stock.quantity, 'removal', auth.uid(), p_notes);
    update public.inventory_by_location set quantity = 0, updated_at = now()
    where item_id = p_item_id and location_id = stock.location_id;
  end loop;
  update public.items set status = 'Removed', public_visible = false where id::text = p_item_id;
end;
$$;

create or replace function public.lookup_inventory_scan(p_scan text)
returns setof public.items language sql stable security invoker set search_path = public
as $$
  select item.* from public.items item
  where upper(item.sku) = upper(trim(p_scan))
     or (
       nullif(regexp_replace(trim(p_scan), '[^0-9X]', '', 'g'), '') is not null
       and upper(regexp_replace(coalesce(item.isbn, ''), '[^0-9X]', '', 'g')) = upper(regexp_replace(trim(p_scan), '[^0-9X]', '', 'g'))
     )
     or upper(coalesce(item.publisher_barcode, '')) = upper(trim(p_scan))
  order by case when upper(item.sku) = upper(trim(p_scan)) then 0 else 1 end, item.created_at
  limit 2
$$;

create or replace function public.start_inventory_scan_session(p_mode text, p_location_id uuid default null)
returns public.inventory_scan_sessions language plpgsql security definer set search_path = public
as $$
declare created public.inventory_scan_sessions;
begin
  if not public.current_profile_is_active() then raise exception 'Active staff access required.'; end if;
  if p_mode not in ('intake', 'shelving', 'shelf_audit') then raise exception 'Unknown scan mode.'; end if;
  if p_mode = 'shelf_audit' and p_location_id is null then raise exception 'Shelf audits require a location.'; end if;
  insert into public.inventory_scan_sessions (mode, location_id, user_id)
  values (p_mode, p_location_id, auth.uid()) returning * into created;
  return created;
end;
$$;

create or replace function public.record_inventory_scan(
  p_session_id uuid, p_item_id text, p_raw_scan text, p_client_event_id text,
  p_destination_location_id uuid default null, p_discover boolean default false
) returns public.inventory_scan_events language plpgsql security definer set search_path = public
as $$
declare
  scan_session public.inventory_scan_sessions;
  scan_event public.inventory_scan_events;
  processing_id uuid;
  processing_quantity integer;
begin
  if not public.current_profile_is_active() then raise exception 'Active staff access required.'; end if;
  select * into scan_session from public.inventory_scan_sessions
  where id = p_session_id and status = 'active' for update;
  if not found then raise exception 'Active scan session not found.'; end if;
  if not public.inventory_item_exists(p_item_id) then raise exception 'Inventory item not found.'; end if;
  select * into scan_event from public.inventory_scan_events
  where session_id = p_session_id and client_event_id = p_client_event_id;
  if found then return scan_event; end if;

  if scan_session.mode = 'shelf_audit' then
    insert into public.inventory_audit_observations (session_id, item_id, observed_quantity)
    values (p_session_id, p_item_id, 1)
    on conflict (session_id, item_id) do update
    set observed_quantity = inventory_audit_observations.observed_quantity + 1, updated_at = now();
  elsif scan_session.mode = 'intake' then
    select id into processing_id from public.inventory_locations where code = 'PROCESSING';
    perform public.adjust_inventory_at_location(p_item_id, processing_id, 1, 'intake', 'Intake scan', p_session_id);
  elsif scan_session.mode = 'shelving' then
    if p_destination_location_id is null then raise exception 'Shelving requires a destination.'; end if;
    select id into processing_id from public.inventory_locations where code = 'PROCESSING';
    select quantity into processing_quantity from public.inventory_by_location
    where item_id = p_item_id and location_id = processing_id for update;
    if coalesce(processing_quantity, 0) > 0 and not p_discover then
      perform public.move_inventory_stock(p_item_id, processing_id, p_destination_location_id, 1,
        'Shelving scan approved by staff.', p_session_id, 'shelving');
    else
      perform public.adjust_inventory_at_location(p_item_id, p_destination_location_id, 1,
        case when p_discover then 'discover' else 'shelving' end,
        case when p_discover then 'Copy documented at another location; other locations preserved.' else 'No Processing copy existed; location documented.' end,
        p_session_id);
    end if;
  end if;

  insert into public.inventory_scan_events (
    session_id, client_event_id, item_id, raw_scan, from_location_id, to_location_id
  ) values (
    p_session_id, p_client_event_id, p_item_id, p_raw_scan,
    case when scan_session.mode = 'shelving' and coalesce(processing_quantity, 0) > 0 and not p_discover then processing_id end,
    case when scan_session.mode = 'intake' then processing_id when scan_session.mode = 'shelving' then p_destination_location_id else null end
  ) returning * into scan_event;
  return scan_event;
end;
$$;

create or replace function public.review_shelf_audit(p_session_id uuid)
returns table(item_id text, expected_quantity integer, observed_quantity integer, difference integer)
language sql stable security definer set search_path = public
as $$
  with session_location as (
    select location_id from public.inventory_scan_sessions
    where id = p_session_id and mode = 'shelf_audit' and status in ('active', 'review')
      and public.current_profile_is_active()
  ), expected as (
    select stock.item_id, stock.quantity from public.inventory_by_location stock
    join session_location session on session.location_id = stock.location_id
    where stock.quantity > 0
  ), observed as (
    select observation.item_id, observation.observed_quantity
    from public.inventory_audit_observations observation where observation.session_id = p_session_id
  )
  select coalesce(expected.item_id, observed.item_id), coalesce(expected.quantity, 0)::integer,
    coalesce(observed.observed_quantity, 0)::integer,
    (coalesce(observed.observed_quantity, 0) - coalesce(expected.quantity, 0))::integer
  from expected full join observed using (item_id)
  order by abs(coalesce(observed.observed_quantity, 0) - coalesce(expected.quantity, 0)) desc
$$;

create or replace function public.reconcile_shelf_audit(p_session_id uuid, p_notes text default null)
returns integer language plpgsql security definer set search_path = public
as $$
declare
  scan_session public.inventory_scan_sessions;
  discrepancy record;
  changed_count integer := 0;
begin
  if not public.current_profile_is_active() then raise exception 'Active staff access required.'; end if;
  select * into scan_session from public.inventory_scan_sessions
  where id = p_session_id and mode = 'shelf_audit' and status in ('active', 'review') for update;
  if not found then raise exception 'Open shelf audit not found.'; end if;

  for discrepancy in select * from public.review_shelf_audit(p_session_id) loop
    if discrepancy.difference <> 0 then
      insert into public.inventory_by_location (item_id, location_id, quantity)
      values (discrepancy.item_id, scan_session.location_id, discrepancy.observed_quantity)
      on conflict (item_id, location_id) do update
      set quantity = excluded.quantity, updated_at = now();
      insert into public.inventory_events (
        item_id, from_location_id, to_location_id, quantity, quantity_delta,
        action_type, user_id, scan_session_id, notes, metadata
      ) values (
        discrepancy.item_id,
        case when discrepancy.difference < 0 then scan_session.location_id end,
        case when discrepancy.difference > 0 then scan_session.location_id end,
        abs(discrepancy.difference), discrepancy.difference, 'reconciliation', auth.uid(), p_session_id, p_notes,
        jsonb_build_object('expected', discrepancy.expected_quantity, 'observed', discrepancy.observed_quantity)
      );
      changed_count := changed_count + 1;
    end if;
  end loop;
  update public.inventory_locations set last_verified_at = now(), updated_at = now()
  where id = scan_session.location_id;
  update public.inventory_scan_sessions set status = 'completed', completed_at = now()
  where id = p_session_id;
  return changed_count;
end;
$$;

create or replace function public.cancel_inventory_scan_session(p_session_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
declare scan_session public.inventory_scan_sessions;
begin
  if not public.current_profile_is_active() then raise exception 'Active staff access required.'; end if;
  select * into scan_session from public.inventory_scan_sessions where id = p_session_id and status = 'active' for update;
  if not found then raise exception 'Active scan session not found.'; end if;
  if scan_session.mode <> 'shelf_audit' and exists (
    select 1 from public.inventory_scan_events where session_id = p_session_id and undone_at is null
  ) then raise exception 'This session already changed inventory. Undo scans before cancelling.'; end if;
  update public.inventory_scan_sessions set status = 'cancelled', completed_at = now() where id = p_session_id;
end;
$$;

create or replace function public.complete_inventory_scan_session(p_session_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
declare scan_mode text;
begin
  if not public.current_profile_is_active() then raise exception 'Active staff access required.'; end if;
  select mode into scan_mode from public.inventory_scan_sessions
  where id = p_session_id and status = 'active' for update;
  if not found then raise exception 'Active scan session not found.'; end if;
  if scan_mode = 'shelf_audit' then raise exception 'Shelf audits must be reconciled or cancelled.'; end if;
  update public.inventory_scan_sessions set status = 'completed', completed_at = now()
  where id = p_session_id;
end;
$$;

create or replace function public.undo_last_inventory_scan(p_session_id uuid)
returns public.inventory_scan_events language plpgsql security definer set search_path = public
as $$
declare scan_session public.inventory_scan_sessions; scan_event public.inventory_scan_events;
begin
  if not public.current_profile_is_active() then raise exception 'Active staff access required.'; end if;
  select * into scan_session from public.inventory_scan_sessions where id = p_session_id and status = 'active' for update;
  select * into scan_event from public.inventory_scan_events
  where session_id = p_session_id and undone_at is null order by created_at desc limit 1 for update;
  if not found then raise exception 'There is no scan to undo.'; end if;
  if scan_session.mode = 'shelf_audit' then
    update public.inventory_audit_observations set observed_quantity = observed_quantity - 1, updated_at = now()
    where session_id = p_session_id and item_id = scan_event.item_id and observed_quantity > 0;
  elsif scan_session.mode = 'intake' then
    perform public.adjust_inventory_at_location(scan_event.item_id, scan_event.to_location_id, -1, 'undo', 'Undid intake scan', p_session_id);
  elsif scan_event.from_location_id is not null then
    perform public.move_inventory_stock(scan_event.item_id, scan_event.to_location_id, scan_event.from_location_id, 1,
      'Undid shelving scan', p_session_id, 'undo');
  else
    perform public.adjust_inventory_at_location(scan_event.item_id, scan_event.to_location_id, -1, 'undo', 'Undid discovered copy', p_session_id);
  end if;
  update public.inventory_scan_events set undone_at = now() where id = scan_event.id returning * into scan_event;
  return scan_event;
end;
$$;

create or replace function public.get_shelving_recommendations(p_item_id text)
returns table(location_id uuid, code text, display_name text, score numeric, source text, reason text)
language sql stable security invoker set search_path = public
as $$
  with exact_locations as (
    select stock.location_id, location.code, location.display_name,
      (1000 + stock.quantity)::numeric as score, 'exact_sku'::text as source,
      ('Recommended ' || location.code || ' because ' || stock.quantity || ' other ' ||
       case when stock.quantity = 1 then 'copy is' else 'copies are' end || ' already there.')::text as reason
    from public.inventory_by_location stock
    join public.inventory_locations location on location.id = stock.location_id
    where stock.item_id = p_item_id and stock.quantity > 0 and location.location_type in ('shelf', 'display', 'overflow') and location.active
  ), related_materials as (
    select distinct related_match.inventory_item_id
    from public.curriculum_inventory_matches target_match
    join public.curriculum_package_items target_package_item on target_package_item.material_id = target_match.material_id
    join public.curriculum_package_items related_package_item on related_package_item.package_id = target_package_item.package_id
    join public.curriculum_inventory_matches related_match on related_match.material_id = related_package_item.material_id
    where target_match.inventory_item_id = p_item_id and related_match.inventory_item_id <> p_item_id
  ), curriculum_locations as (
    select stock.location_id, location.code, location.display_name,
      (500 + sum(stock.quantity))::numeric as score, 'curriculum'::text as source,
      ('Recommended ' || location.code || ' because related curriculum books are concentrated there.')::text as reason
    from related_materials related
    join public.inventory_by_location stock on stock.item_id = related.inventory_item_id and stock.quantity > 0
    join public.inventory_locations location on location.id = stock.location_id
    where location.location_type in ('shelf', 'display', 'overflow') and location.active
      and not exists (select 1 from exact_locations)
    group by stock.location_id, location.code, location.display_name
  ), fallback_locations as (
    select stock.location_id, location.code, location.display_name,
      (100 + count(distinct candidate.id))::numeric as score, 'metadata'::text as source,
      ('Recommended ' || location.code || ' because similar catalog items are shelved there.')::text as reason
    from public.items target
    join public.items candidate on candidate.id::text <> target.id::text and (
      (nullif(target.category, '') is not null and lower(candidate.category) = lower(target.category)) or
      (nullif(target.subject, '') is not null and lower(candidate.subject) = lower(target.subject)) or
      (nullif(target.publisher, '') is not null and lower(candidate.publisher) = lower(target.publisher))
    )
    join public.inventory_by_location stock on stock.item_id = candidate.id::text and stock.quantity > 0
    join public.inventory_locations location on location.id = stock.location_id
    where target.id::text = p_item_id and location.location_type in ('shelf', 'display', 'overflow') and location.active
      and not exists (select 1 from exact_locations) and not exists (select 1 from curriculum_locations)
    group by stock.location_id, location.code, location.display_name
  ), needs_review as (
    select location.id, location.code, location.display_name, 0::numeric, 'needs_review'::text,
      'No confident shelf match was found; staff review is needed.'::text
    from public.inventory_locations location
    where location.code = 'NEEDS_REVIEW'
      and not exists (select 1 from exact_locations)
      and not exists (select 1 from curriculum_locations)
      and not exists (select 1 from fallback_locations)
  )
  select * from exact_locations
  union all select * from curriculum_locations
  union all select * from fallback_locations
  union all select * from needs_review
  order by score desc, code
$$;

alter table public.inventory_locations enable row level security;
alter table public.inventory_by_location enable row level security;
alter table public.inventory_scan_sessions enable row level security;
alter table public.inventory_scan_events enable row level security;
alter table public.inventory_audit_observations enable row level security;
alter table public.inventory_events enable row level security;

create or replace function public.prevent_nonempty_location_deactivation()
returns trigger language plpgsql set search_path = public
as $$
begin
  if old.active and not new.active and exists (
    select 1 from public.inventory_by_location where location_id = old.id and quantity > 0
  ) then
    raise exception 'Move or remove all stock before deactivating this location.';
  end if;
  return new;
end;
$$;

drop trigger if exists inventory_location_nonempty_guard on public.inventory_locations;
create trigger inventory_location_nonempty_guard
before update of active on public.inventory_locations
for each row execute function public.prevent_nonempty_location_deactivation();

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'inventory_locations', 'inventory_by_location', 'inventory_scan_sessions',
    'inventory_scan_events', 'inventory_audit_observations', 'inventory_events'
  ] loop
    execute format('drop policy if exists %I on public.%I', table_name || '_staff_access', table_name);
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.current_profile_is_active()) with check (public.current_profile_is_active())',
      table_name || '_staff_access', table_name
    );
  end loop;
end $$;

grant select on public.inventory_locations, public.inventory_by_location,
  public.inventory_scan_sessions, public.inventory_scan_events,
  public.inventory_audit_observations, public.inventory_events,
  public.inventory_item_totals, public.inventory_location_details to authenticated;
grant insert, update, delete on public.inventory_locations to authenticated;

revoke all on function public.lookup_inventory_scan(text) from public;
revoke all on function public.start_inventory_scan_session(text, uuid) from public;
revoke all on function public.record_inventory_scan(uuid, text, text, text, uuid, boolean) from public;
revoke all on function public.review_shelf_audit(uuid) from public;
revoke all on function public.reconcile_shelf_audit(uuid, text) from public;
revoke all on function public.cancel_inventory_scan_session(uuid) from public;
revoke all on function public.complete_inventory_scan_session(uuid) from public;
revoke all on function public.undo_last_inventory_scan(uuid) from public;
revoke all on function public.adjust_inventory_at_location(text, uuid, integer, text, text, uuid) from public;
revoke all on function public.move_inventory_stock(text, uuid, uuid, integer, text, uuid, text) from public;
revoke all on function public.archive_inventory_item(text, text) from public;
revoke all on function public.get_shelving_recommendations(text) from public;

grant execute on function public.lookup_inventory_scan(text) to authenticated;
grant execute on function public.start_inventory_scan_session(text, uuid) to authenticated;
grant execute on function public.record_inventory_scan(uuid, text, text, text, uuid, boolean) to authenticated;
grant execute on function public.review_shelf_audit(uuid) to authenticated;
grant execute on function public.reconcile_shelf_audit(uuid, text) to authenticated;
grant execute on function public.cancel_inventory_scan_session(uuid) to authenticated;
grant execute on function public.complete_inventory_scan_session(uuid) to authenticated;
grant execute on function public.undo_last_inventory_scan(uuid) to authenticated;
grant execute on function public.adjust_inventory_at_location(text, uuid, integer, text, text, uuid) to authenticated;
grant execute on function public.move_inventory_stock(text, uuid, uuid, integer, text, uuid, text) to authenticated;
grant execute on function public.archive_inventory_item(text, text) to authenticated;
grant execute on function public.get_shelving_recommendations(text) to authenticated;

revoke all on function public.sync_item_inventory_cache(text) from public;
revoke all on function public.inventory_item_exists(text) from public;

notify pgrst, 'reload schema';
