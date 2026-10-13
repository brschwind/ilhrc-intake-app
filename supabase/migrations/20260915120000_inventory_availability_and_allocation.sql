-- Inventory modernization phase 2: named availability concepts and safe,
-- deterministic allocation for workflows that do not know a source shelf.

alter table public.inventory_events
drop constraint if exists inventory_events_action_type_check;
alter table public.inventory_events
add constraint inventory_events_action_type_check check (action_type in (
  'intake', 'shelving', 'discover', 'move', 'reconciliation', 'shelf_audit',
  'quick_add', 'manual_adjustment', 'removal', 'override', 'legacy_backfill', 'undo',
  'sale', 'reservation_pickup', 'square_decrement', 'square_inventory_increase',
  'item_split', 'bundle_assembly', 'bundle_split', 'inventory_merge'
));

create or replace view public.inventory_item_availability
with (security_invoker = true)
as
select
  item.id::text as item_id,
  coalesce(sum(stock.quantity) filter (where location.active), 0)::integer as total_physical_quantity,
  coalesce(sum(stock.quantity) filter (
    where location.active and location.location_type in ('shelf', 'display', 'overflow')
  ), 0)::integer as sellable_quantity,
  coalesce(sum(stock.quantity) filter (where location.active and location.location_type = 'hold'), 0)::integer as held_quantity,
  coalesce(sum(stock.quantity) filter (where location.active and location.location_type = 'processing'), 0)::integer as processing_quantity,
  coalesce(sum(stock.quantity) filter (where location.active and location.location_type = 'needs_review'), 0)::integer as needs_review_quantity,
  coalesce(sum(stock.quantity) filter (where location.active and location.location_type = 'legacy'), 0)::integer as legacy_unverified_quantity,
  coalesce(reservation.active_count, 0)::integer as active_reservation_count,
  greatest(
    coalesce(sum(stock.quantity) filter (
      where location.active and location.location_type in ('shelf', 'display', 'overflow')
    ), 0)::integer - coalesce(reservation.active_count, 0),
    0
  )::integer as available_to_reserve
from public.items item
left join public.inventory_by_location stock on stock.item_id = item.id::text
left join public.inventory_locations location on location.id = stock.location_id
left join lateral (
  select count(*)::integer as active_count
  from public.book_reservations
  where item_id = item.id::text
    and status in ('pending', 'ready')
    and expires_at > now()
) reservation on true
group by item.id, reservation.active_count;

grant select on public.inventory_item_availability to authenticated, service_role;

create or replace function public.allocate_sellable_inventory(
  p_item_id text,
  p_quantity integer,
  p_action_type text default 'sale',
  p_notes text default null,
  p_external_reference text default null
)
returns table(source_location_id uuid, location_code text, quantity_decremented integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  available_quantity integer;
  remaining integer := p_quantity;
  candidate record;
  decrement_quantity integer;
begin
  if auth.uid() is not null and not public.current_profile_is_active() then
    raise exception 'Active staff access required.';
  end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'Quantity must be positive.'; end if;
  if p_action_type not in ('sale', 'reservation_pickup', 'square_decrement', 'removal') then
    raise exception 'Unsupported inventory allocation action.';
  end if;
  if not public.inventory_item_exists(p_item_id) then raise exception 'Inventory item not found.'; end if;

  -- Lock every eligible row before checking the aggregate, so insufficient stock
  -- cannot produce a partial decrement under concurrent sales.
  perform stock.id
  from public.inventory_by_location stock
  join public.inventory_locations location on location.id = stock.location_id
  where stock.item_id = p_item_id and stock.quantity > 0 and location.active
    and location.location_type in ('shelf', 'display', 'overflow')
  order by stock.id
  for update of stock;

  select coalesce(sum(stock.quantity), 0)::integer into available_quantity
  from public.inventory_by_location stock
  join public.inventory_locations location on location.id = stock.location_id
  where stock.item_id = p_item_id and stock.quantity > 0 and location.active
    and location.location_type in ('shelf', 'display', 'overflow');
  if available_quantity < p_quantity then raise exception 'Insufficient sellable inventory.'; end if;

  for candidate in
    select stock.id, stock.location_id, stock.quantity, location.code
    from public.inventory_by_location stock
    join public.inventory_locations location on location.id = stock.location_id
    where stock.item_id = p_item_id and stock.quantity > 0 and location.active
      and location.location_type in ('shelf', 'display', 'overflow')
    order by case
      when location.location_type = 'display' then 1
      when location.location_type = 'shelf' and location.last_verified_at is not null then 2
      when location.location_type = 'shelf' then 3
      when location.location_type = 'overflow' then 4
      else 5 end,
      location.last_verified_at desc nulls last, location.code, stock.id
  loop
    exit when remaining = 0;
    decrement_quantity := least(candidate.quantity, remaining);
    update public.inventory_by_location
    set quantity = quantity - decrement_quantity, updated_at = now()
    where id = candidate.id;
    insert into public.inventory_events (
      item_id, from_location_id, quantity, quantity_delta, action_type,
      user_id, notes, metadata
    ) values (
      p_item_id, candidate.location_id, decrement_quantity, -decrement_quantity,
      p_action_type, auth.uid(), p_notes,
      jsonb_strip_nulls(jsonb_build_object('external_reference', p_external_reference))
    );
    source_location_id := candidate.location_id;
    location_code := candidate.code;
    quantity_decremented := decrement_quantity;
    remaining := remaining - decrement_quantity;
    return next;
  end loop;
end
$$;

revoke all on function public.allocate_sellable_inventory(text,integer,text,text,text) from public, anon;
grant execute on function public.allocate_sellable_inventory(text,integer,text,text,text) to authenticated, service_role;

create or replace function public.receive_inventory_to_processing(
  p_item_id text, p_quantity integer, p_notes text default 'Received through legacy intake screen.'
)
returns integer language plpgsql security definer set search_path = public
as $$
declare processing_id uuid; resulting_quantity integer;
begin
  if not public.current_profile_is_active() then raise exception 'Active staff access required.'; end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'Quantity must be positive.'; end if;
  select id into processing_id from public.inventory_locations where code = 'PROCESSING' and active;
  if processing_id is null then raise exception 'Processing location is not active.'; end if;
  select public.adjust_inventory_at_location(p_item_id, processing_id, p_quantity, 'intake', p_notes, null)
  into resulting_quantity;
  return resulting_quantity;
end
$$;

revoke all on function public.receive_inventory_to_processing(text,integer,text) from public, anon;
grant execute on function public.receive_inventory_to_processing(text,integer,text) to authenticated;

-- Public availability uses sellable stock only and subtracts active reservations.
create or replace view public.public_catalog_items as
select
  item.id, item.title, item.curriculum, item.subject, item.grade_level,
  item.category, item.edition, item.isbn, item.final_price,
  availability.available_to_reserve::smallint as quantity,
  item.image_url, item.created_at, item.item_type, item.bundle_piece_count,
  case when item.item_type = 'bundle' then array(
    select component.piece_quantity::text || '× ' || coalesce(component_item.title, 'Untitled item')
    from public.bundle_components component
    join public.items component_item on component_item.id::text = component.component_item_id
    where component.bundle_item_id = item.id::text order by component.id
  ) else array[]::text[] end as bundle_contents,
  item.author, item.publisher, item.publisher_item_number
from public.items item
join public.inventory_item_availability availability on availability.item_id = item.id::text
where coalesce(item.status, 'Available') = 'Available'
  and coalesce(item.public_visible, true) = true
  and availability.sellable_quantity > 0;

grant select on public.public_catalog_items to anon, authenticated;

create or replace function public.submit_book_reservation(
  p_item_id text, p_customer_name text, p_email text default '', p_phone text default '',
  p_preferred_contact text default 'email', p_website text default ''
)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  item_record public.items%rowtype;
  active_reservation_count integer;
  sellable_quantity integer;
  recent_count integer;
  clean_email text := left(lower(trim(coalesce(p_email, ''))), 254);
  clean_phone text := left(trim(coalesce(p_phone, '')), 40);
  reservation_record public.book_reservations%rowtype;
begin
  if trim(coalesce(p_website, '')) <> '' then return null; end if;
  if length(trim(coalesce(p_customer_name, ''))) < 2 then raise exception 'Please enter your name.'; end if;
  if clean_email = '' and clean_phone = '' then raise exception 'Please enter an email address or phone number.'; end if;
  if clean_email <> '' and clean_email !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then raise exception 'Please enter a valid email address.'; end if;
  if p_preferred_contact not in ('email', 'phone', 'either') then raise exception 'Invalid contact preference.'; end if;
  if clean_email = '' and p_preferred_contact = 'email' then raise exception 'An email address is required for email contact.'; end if;
  if clean_phone = '' and p_preferred_contact = 'phone' then raise exception 'A phone number is required for phone contact.'; end if;
  select count(*) into recent_count from public.book_reservations
  where created_at > now() - interval '24 hours' and (
    (clean_email <> '' and lower(email) = clean_email) or (clean_phone <> '' and phone = clean_phone)
  );
  if recent_count >= 5 then raise exception 'Too many recent reservations. Please contact IL HRC for help.'; end if;

  select * into item_record from public.items where id::text = trim(coalesce(p_item_id, '')) for update;
  if not found or coalesce(item_record.status, 'Available') <> 'Available'
    or coalesce(item_record.public_visible, true) = false then
    raise exception 'This book is no longer available to reserve.';
  end if;
  perform stock.id from public.inventory_by_location stock
  where stock.item_id = item_record.id::text order by stock.id for update;
  select coalesce(sum(stock.quantity), 0)::integer into sellable_quantity
  from public.inventory_by_location stock join public.inventory_locations location on location.id = stock.location_id
  where stock.item_id = item_record.id::text and location.active
    and location.location_type in ('shelf', 'display', 'overflow');
  if sellable_quantity < 1 then raise exception 'This book is no longer available to reserve.'; end if;
  if exists (select 1 from public.book_reservations where item_id = item_record.id::text
    and status in ('pending', 'ready') and expires_at > now() and (
      (clean_email <> '' and lower(email) = clean_email) or (clean_phone <> '' and phone = clean_phone)
    )) then raise exception 'You already have an active reservation for this book.'; end if;
  select count(*) into active_reservation_count from public.book_reservations
  where item_id = item_record.id::text and status in ('pending', 'ready') and expires_at > now();
  if active_reservation_count >= sellable_quantity then raise exception 'The last available copy was just reserved.'; end if;
  insert into public.book_reservations (item_id, customer_name, email, phone, preferred_contact)
  values (item_record.id::text, left(trim(p_customer_name), 120), clean_email, clean_phone, p_preferred_contact)
  returning * into reservation_record;
  return jsonb_build_object('id', reservation_record.id, 'item_id', reservation_record.item_id,
    'title', item_record.title, 'expires_at', reservation_record.expires_at);
end
$$;

create or replace function public.extend_book_reservation(p_reservation_id uuid, p_days integer default 7)
returns public.book_reservations language plpgsql security definer set search_path = public
as $$
declare
  reservation_record public.book_reservations%rowtype;
  item_record public.items%rowtype;
  active_reservation_count integer;
  sellable_quantity integer;
begin
  if not public.current_profile_is_active() then raise exception 'Active staff access is required.'; end if;
  if p_days < 1 or p_days > 30 then raise exception 'Extension must be between 1 and 30 days.'; end if;
  select * into reservation_record from public.book_reservations where id = p_reservation_id for update;
  if not found or reservation_record.status not in ('pending', 'ready', 'expired') then
    raise exception 'Only active or expired reservations can be extended.';
  end if;
  if reservation_record.status = 'expired' or reservation_record.expires_at <= now() then
    select * into item_record from public.items where id::text = reservation_record.item_id for update;
    if not found or coalesce(item_record.status, 'Available') <> 'Available' then
      raise exception 'This book is no longer available to reserve.';
    end if;
    perform stock.id from public.inventory_by_location stock
    where stock.item_id = reservation_record.item_id order by stock.id for update;
    select coalesce(sum(stock.quantity), 0)::integer into sellable_quantity
    from public.inventory_by_location stock join public.inventory_locations location on location.id = stock.location_id
    where stock.item_id = reservation_record.item_id and location.active
      and location.location_type in ('shelf', 'display', 'overflow');
    select count(*) into active_reservation_count from public.book_reservations
    where item_id = reservation_record.item_id and id <> reservation_record.id
      and status in ('pending', 'ready') and expires_at > now();
    if active_reservation_count >= sellable_quantity then raise exception 'No copy is available to reactivate this reservation.'; end if;
  end if;
  update public.book_reservations set status = case when status = 'expired' then 'pending' else status end,
    expires_at = greatest(expires_at, now()) + make_interval(days => p_days),
    handled_by = auth.uid(), updated_at = now()
  where id = p_reservation_id returning * into reservation_record;
  insert into public.audit_logs (user_id, action, entity_type, entity_id, details)
  values (auth.uid(), 'reservation_extended', 'book_reservation', reservation_record.id::text,
    jsonb_build_object('days', p_days, 'item_id', reservation_record.item_id));
  return reservation_record;
end
$$;

-- Preserve Square-linked pickup behavior: Square's count webhook performs the
-- decrement. Non-Square pickups allocate sellable stock locally and atomically.
create or replace function public.update_book_reservation_status(p_reservation_id uuid, p_status text)
returns public.book_reservations language plpgsql security definer set search_path = public
as $$
declare reservation_record public.book_reservations%rowtype; item_record public.items%rowtype;
begin
  if not public.current_profile_is_active() then raise exception 'Active staff access is required.'; end if;
  if p_status not in ('pending', 'ready', 'unavailable', 'picked_up', 'cancelled', 'expired') then raise exception 'Invalid reservation status.'; end if;
  select * into reservation_record from public.book_reservations where id = p_reservation_id for update;
  if not found then raise exception 'Reservation not found.'; end if;
  if reservation_record.status in ('picked_up', 'cancelled', 'unavailable') then raise exception 'Completed reservations cannot be changed.'; end if;
  if (reservation_record.status = 'pending' and p_status not in ('ready', 'unavailable', 'cancelled', 'expired'))
    or (reservation_record.status = 'ready' and p_status not in ('unavailable', 'picked_up', 'cancelled', 'expired'))
    or reservation_record.status = 'expired' then raise exception 'Invalid reservation status transition.'; end if;
  if p_status in ('ready', 'picked_up') and reservation_record.expires_at <= now() then raise exception 'This reservation has expired. Extend it before continuing.'; end if;
  if p_status = 'picked_up' then
    select * into item_record from public.items where id::text = reservation_record.item_id for update;
    if not found then raise exception 'The reserved inventory item no longer exists.'; end if;
    if nullif(trim(coalesce(item_record.square_variation_id, '')), '') is null then
      perform * from public.allocate_sellable_inventory(reservation_record.item_id, 1,
        'reservation_pickup', 'Reservation picked up.', reservation_record.id::text);
    end if;
  end if;
  update public.book_reservations set status = p_status, handled_by = auth.uid(), updated_at = now()
  where id = p_reservation_id returning * into reservation_record;
  insert into public.audit_logs (user_id, action, entity_type, entity_id, details)
  values (auth.uid(), 'reservation_status_changed', 'book_reservation', reservation_record.id::text,
    jsonb_build_object('status', p_status, 'item_id', reservation_record.item_id,
      'inventory_source', case when nullif(trim(coalesce(item_record.square_variation_id, '')), '') is null then 'location_allocation' else 'square' end));
  return reservation_record;
end
$$;

-- Square sends an absolute available count. The expected outbound count makes
-- the difference idempotent: negative differences allocate sellable locations;
-- positive unexpected differences enter Processing for staff review.
create or replace function public.apply_square_inventory_count(
  p_event_id text, p_square_variation_id text, p_location_id text,
  p_quantity integer, p_calculated_at timestamptz
)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  item_record public.items%rowtype;
  quantity_delta integer := 0;
  processing_id uuid;
begin
  if trim(coalesce(p_event_id, '')) = '' or trim(coalesce(p_square_variation_id, '')) = ''
    or trim(coalesce(p_location_id, '')) = '' or p_quantity is null or p_quantity < 0
    or p_calculated_at is null then raise exception 'Invalid Square inventory count.'; end if;
  insert into public.square_inventory_events (event_id, square_variation_id, location_id, quantity, calculated_at)
  values (p_event_id, p_square_variation_id, p_location_id, p_quantity, p_calculated_at)
  on conflict do nothing;
  if not found then return jsonb_build_object('duplicate', true, 'updated_items', 0); end if;
  select * into item_record from public.items where square_variation_id = p_square_variation_id for update;
  if not found or (item_record.square_inventory_synced_at is not null and item_record.square_inventory_synced_at > p_calculated_at)
    then return jsonb_build_object('duplicate', false, 'updated_items', 0); end if;
  if item_record.square_expected_quantity is not null then
    quantity_delta := p_quantity - item_record.square_expected_quantity;
    if quantity_delta < 0 then
      perform * from public.allocate_sellable_inventory(item_record.id::text, abs(quantity_delta),
        'square_decrement', 'Square inventory count decreased.', p_event_id);
    elsif quantity_delta > 0 then
      select id into processing_id from public.inventory_locations where code = 'PROCESSING' and active;
      insert into public.inventory_by_location (item_id, location_id, quantity)
      values (item_record.id::text, processing_id, quantity_delta)
      on conflict (item_id, location_id) do update
      set quantity = inventory_by_location.quantity + excluded.quantity, updated_at = now();
      insert into public.inventory_events (item_id, to_location_id, quantity, quantity_delta, action_type, notes, metadata)
      values (item_record.id::text, processing_id, quantity_delta, quantity_delta, 'square_inventory_increase',
        'Unexpected Square increase routed to Processing.', jsonb_build_object('external_reference', p_event_id));
    end if;
  end if;
  update public.items set square_expected_quantity = p_quantity,
    square_inventory_synced_at = p_calculated_at, updated_at = now()
  where id::text = item_record.id::text;
  insert into public.audit_logs (action, entity_type, entity_id, details)
  values ('square_inventory_received', 'square_variation', p_square_variation_id,
    jsonb_build_object('event_id', p_event_id, 'location_id', p_location_id,
      'square_available_quantity', p_quantity, 'quantity_delta', quantity_delta, 'inventory_source', 'location_allocation'));
  return jsonb_build_object('duplicate', false, 'updated_items', 1,
    'quantity_delta', quantity_delta, 'square_available_quantity', p_quantity);
end
$$;

revoke all on function public.apply_square_inventory_count(text,text,text,integer,timestamptz) from public, anon, authenticated;
grant execute on function public.apply_square_inventory_count(text,text,text,integer,timestamptz) to service_role;

-- Move part of an existing listing into a dedicated bundle-component record
-- without losing the shelves that currently account for those copies.
create or replace function public.split_inventory_item_for_bundle(
  p_source_item_id text, p_component_item_id text, p_quantity integer
)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare inventory_row record; remaining integer := p_quantity; moved integer; component_record public.items%rowtype;
begin
  if not public.current_profile_is_active() then raise exception 'Active staff access required.'; end if;
  if p_quantity is null or p_quantity <= 0 or p_source_item_id = p_component_item_id then
    raise exception 'Invalid bundle component split.';
  end if;
  perform 1 from public.items where id::text in (p_source_item_id, p_component_item_id)
    order by id::text for update;
  if (select count(*) from public.items where id::text in (p_source_item_id, p_component_item_id)) <> 2 then
    raise exception 'Source or component inventory item not found.';
  end if;
  if exists (select 1 from public.inventory_by_location where item_id = p_component_item_id and quantity > 0) then
    raise exception 'The component item already has location inventory.';
  end if;

  perform stock.id from public.inventory_by_location stock
  join public.inventory_locations location on location.id = stock.location_id
  where stock.item_id = p_source_item_id and stock.quantity > 0 and location.active
    and location.location_type <> 'hold'
  order by stock.id for update of stock;
  if (select coalesce(sum(stock.quantity), 0) from public.inventory_by_location stock
      join public.inventory_locations location on location.id = stock.location_id
      where stock.item_id = p_source_item_id and stock.quantity > 0 and location.active
        and location.location_type <> 'hold') < p_quantity then
    raise exception 'The source item no longer has enough unreserved location inventory.';
  end if;

  for inventory_row in
    select stock.location_id, stock.quantity from public.inventory_by_location stock
    join public.inventory_locations location on location.id = stock.location_id
    where stock.item_id = p_source_item_id and stock.quantity > 0 and location.active
      and location.location_type <> 'hold'
    order by case when location.location_type in ('shelf','display','overflow') then 1 else 2 end,
      location.code, stock.id
  loop
    exit when remaining = 0;
    moved := least(inventory_row.quantity, remaining);
    update public.inventory_by_location set quantity = quantity - moved, updated_at = now()
    where item_id = p_source_item_id and location_id = inventory_row.location_id;
    insert into public.inventory_by_location (item_id, location_id, quantity)
    values (p_component_item_id, inventory_row.location_id, moved)
    on conflict (item_id, location_id) do update
    set quantity = inventory_by_location.quantity + excluded.quantity, updated_at = now();
    insert into public.inventory_events (
      item_id, from_location_id, to_location_id, quantity, quantity_delta, action_type, user_id, notes, metadata
    ) values
      (p_source_item_id, inventory_row.location_id, null, moved, -moved, 'item_split', auth.uid(),
        'Copies separated for a bundle component.', jsonb_build_object('component_item_id', p_component_item_id)),
      (p_component_item_id, null, inventory_row.location_id, moved, moved, 'item_split', auth.uid(),
        'Copies received from the source inventory item.',
        jsonb_build_object('source_item_id', p_source_item_id));
    remaining := remaining - moved;
  end loop;

  select * into component_record from public.items where id::text = p_component_item_id;
  return to_jsonb(component_record);
end
$$;

revoke all on function public.split_inventory_item_for_bundle(text,text,integer) from public, anon;
grant execute on function public.split_inventory_item_for_bundle(text,text,integer) to authenticated;

-- Consume the component copies and create one assembled set in Processing. The
-- complete operation is atomic, so a short component rolls every quantity back.
create or replace function public.assemble_inventory_bundle(p_bundle_item_id text)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare component record; inventory_row record; remaining integer; moved integer;
  processing_id uuid; bundle_record public.items%rowtype;
begin
  if not public.current_profile_is_active() then raise exception 'Active staff access required.'; end if;
  select * into bundle_record from public.items
  where id::text = p_bundle_item_id and item_type = 'bundle' for update;
  if not found then raise exception 'Bundle inventory item not found.'; end if;
  if exists (select 1 from public.inventory_by_location where item_id = p_bundle_item_id and quantity > 0) then
    raise exception 'This bundle has already been assembled.';
  end if;
  if not exists (select 1 from public.bundle_components where bundle_item_id = p_bundle_item_id) then
    raise exception 'The bundle has no components.';
  end if;
  select id into processing_id from public.inventory_locations where code = 'PROCESSING' and active for update;
  if processing_id is null then raise exception 'Processing location is not active.'; end if;

  for component in
    select component_item_id, piece_quantity from public.bundle_components
    where bundle_item_id = p_bundle_item_id order by id
  loop
    remaining := component.piece_quantity;
    perform stock.id from public.inventory_by_location stock
    join public.inventory_locations location on location.id = stock.location_id
    where stock.item_id = component.component_item_id and stock.quantity > 0 and location.active
      and location.location_type <> 'hold'
    order by stock.id for update of stock;
    if (select coalesce(sum(stock.quantity), 0) from public.inventory_by_location stock
        join public.inventory_locations location on location.id = stock.location_id
        where stock.item_id = component.component_item_id and stock.quantity > 0 and location.active
          and location.location_type <> 'hold') < component.piece_quantity then
      raise exception 'A bundle component no longer has enough unreserved location inventory.';
    end if;
    for inventory_row in
      select stock.location_id, stock.quantity from public.inventory_by_location stock
      join public.inventory_locations location on location.id = stock.location_id
      where stock.item_id = component.component_item_id and stock.quantity > 0 and location.active
        and location.location_type <> 'hold'
      order by case when location.location_type = 'processing' then 1
        when location.location_type in ('shelf','display','overflow') then 2 else 3 end,
        location.code, stock.id
    loop
      exit when remaining = 0;
      moved := least(inventory_row.quantity, remaining);
      update public.inventory_by_location set quantity = quantity - moved, updated_at = now()
      where item_id = component.component_item_id and location_id = inventory_row.location_id;
      insert into public.inventory_events (
        item_id, from_location_id, quantity, quantity_delta, action_type, user_id, notes, metadata
      ) values (
        component.component_item_id, inventory_row.location_id, moved, -moved, 'bundle_assembly', auth.uid(),
        'Component committed to an assembled bundle.', jsonb_build_object('bundle_item_id', p_bundle_item_id)
      );
      remaining := remaining - moved;
    end loop;
  end loop;

  insert into public.inventory_by_location (item_id, location_id, quantity)
  values (p_bundle_item_id, processing_id, 1)
  on conflict (item_id, location_id) do update
  set quantity = inventory_by_location.quantity + 1, updated_at = now();
  insert into public.inventory_events (
    item_id, to_location_id, quantity, quantity_delta, action_type, user_id, notes
  ) values (
    p_bundle_item_id, processing_id, 1, 1, 'bundle_assembly', auth.uid(),
    'Assembled bundle entered Processing for shelving.'
  );
  select * into bundle_record from public.items where id::text = p_bundle_item_id;
  return to_jsonb(bundle_record);
end
$$;

revoke all on function public.assemble_inventory_bundle(text) from public, anon;
grant execute on function public.assemble_inventory_bundle(text) to authenticated;

-- Reverse a location-aware bundle assembly. Components return to Processing so
-- staff can deliberately reshelve them instead of reviving stale shelf data.
create or replace function public.split_inventory_bundle(p_bundle_item_id text)
returns boolean language plpgsql security definer set search_path = public
as $$
declare component record; inventory_row record; remaining integer := 1; moved integer;
  processing_id uuid; location_assembled boolean;
begin
  if not public.current_profile_is_active() then raise exception 'Active staff access required.'; end if;
  perform 1 from public.items where id::text = p_bundle_item_id and item_type = 'bundle' for update;
  if not found then raise exception 'Bundle inventory item not found.'; end if;
  if exists (select 1 from public.book_reservations where item_id = p_bundle_item_id
    and status in ('pending','ready') and expires_at > now()) then
    raise exception 'Cancel or complete the active reservation before splitting this bundle.';
  end if;
  select id into processing_id from public.inventory_locations where code = 'PROCESSING' and active for update;
  if processing_id is null then raise exception 'Processing location is not active.'; end if;
  select exists (select 1 from public.inventory_events where item_id = p_bundle_item_id
    and action_type = 'bundle_assembly' and quantity_delta > 0) into location_assembled;

  perform stock.id from public.inventory_by_location stock
  where stock.item_id = p_bundle_item_id and stock.quantity > 0 order by stock.id for update of stock;
  if (select coalesce(sum(quantity), 0) from public.inventory_by_location where item_id = p_bundle_item_id) < 1 then
    raise exception 'The assembled bundle is not in location inventory.';
  end if;
  for inventory_row in select location_id, quantity from public.inventory_by_location
    where item_id = p_bundle_item_id and quantity > 0 order by id
  loop
    exit when remaining = 0;
    moved := least(inventory_row.quantity, remaining);
    update public.inventory_by_location set quantity = quantity - moved, updated_at = now()
    where item_id = p_bundle_item_id and location_id = inventory_row.location_id;
    insert into public.inventory_events (
      item_id, from_location_id, quantity, quantity_delta, action_type, user_id, notes
    ) values (p_bundle_item_id, inventory_row.location_id, moved, -moved, 'bundle_split', auth.uid(), 'Bundle split into individual components.');
    remaining := remaining - moved;
  end loop;

  if location_assembled then
    for component in select component_item_id, piece_quantity from public.bundle_components
      where bundle_item_id = p_bundle_item_id order by id
    loop
      insert into public.inventory_by_location (item_id, location_id, quantity)
      values (component.component_item_id, processing_id, component.piece_quantity)
      on conflict (item_id, location_id) do update
      set quantity = inventory_by_location.quantity + excluded.quantity, updated_at = now();
      insert into public.inventory_events (
        item_id, to_location_id, quantity, quantity_delta, action_type, user_id, notes, metadata
      ) values (
        component.component_item_id, processing_id, component.piece_quantity, component.piece_quantity,
        'bundle_split', auth.uid(), 'Bundle component returned to Processing.',
        jsonb_build_object('bundle_item_id', p_bundle_item_id)
      );
    end loop;
  end if;
  update public.items set status = 'Removed', public_visible = false, updated_at = now()
  where id::text = p_bundle_item_id;
  return location_assembled;
end
$$;

revoke all on function public.split_inventory_bundle(text) from public, anon;
grant execute on function public.split_inventory_bundle(text) to authenticated;

create or replace function public.archive_inventory_items(
  p_item_ids text[], p_notes text default 'Bulk inventory removal.'
)
returns integer language plpgsql security definer set search_path = public
as $$
declare item_id text; archived_count integer := 0;
begin
  if not public.current_profile_is_active() then raise exception 'Active staff access required.'; end if;
  if coalesce(array_length(p_item_ids, 1), 0) = 0 then raise exception 'Choose at least one inventory item.'; end if;
  foreach item_id in array p_item_ids loop
    perform public.archive_inventory_item(item_id, p_notes);
    archived_count := archived_count + 1;
  end loop;
  return archived_count;
end
$$;

revoke all on function public.archive_inventory_items(text[],text) from public, anon;
grant execute on function public.archive_inventory_items(text[],text) to authenticated;

-- Location-aware replacement for the legacy ISBN merge. Every shelf quantity is
-- moved to the survivor before duplicate catalog records are removed.
create or replace function public.merge_inventory_items(
  p_keeper_id text, p_duplicate_ids text[], p_values jsonb
)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare keeper_record public.items%rowtype; duplicate_record record; inventory_row record;
  duplicate_count integer; mismatched_count integer; normalized_isbn text; merged_record public.items%rowtype;
begin
  if not public.current_profile_is_admin() then raise exception 'Administrator access is required.'; end if;
  select * into keeper_record from public.items where id::text = p_keeper_id for update;
  if not found then raise exception 'The surviving inventory record was not found.'; end if;
  if coalesce(array_length(p_duplicate_ids, 1), 0) = 0 then raise exception 'At least one duplicate record is required.'; end if;
  normalized_isbn := lower(regexp_replace(coalesce(keeper_record.isbn, ''), '[^0-9x]', '', 'g'));
  if length(normalized_isbn) < 10 then raise exception 'A valid shared ISBN is required.'; end if;
  select count(*) into duplicate_count from public.items
  where id::text = any(p_duplicate_ids) and id::text <> p_keeper_id;
  if duplicate_count <> array_length(p_duplicate_ids, 1) then raise exception 'One or more duplicate records were not found.'; end if;
  select count(*) into mismatched_count from public.items where id::text = any(p_duplicate_ids)
    and lower(regexp_replace(coalesce(isbn, ''), '[^0-9x]', '', 'g')) <> normalized_isbn;
  if mismatched_count > 0 then raise exception 'All merged records must share the same ISBN.'; end if;
  perform 1 from public.items where id::text = any(p_duplicate_ids) order by id::text for update;

  for duplicate_record in select id::text as item_id from public.items
    where id::text = any(p_duplicate_ids) and id::text <> p_keeper_id order by id::text
  loop
    for inventory_row in select location_id, quantity from public.inventory_by_location
      where item_id = duplicate_record.item_id and quantity > 0 order by id for update
    loop
      insert into public.inventory_by_location (item_id, location_id, quantity)
      values (p_keeper_id, inventory_row.location_id, inventory_row.quantity)
      on conflict (item_id, location_id) do update
      set quantity = inventory_by_location.quantity + excluded.quantity, updated_at = now();
      insert into public.inventory_events (
        item_id, from_location_id, to_location_id, quantity, quantity_delta, action_type, user_id, notes, metadata
      ) values
        (duplicate_record.item_id, inventory_row.location_id, null, inventory_row.quantity, -inventory_row.quantity,
          'inventory_merge', auth.uid(), 'Inventory moved to the surviving ISBN record.', jsonb_build_object('keeper_item_id', p_keeper_id)),
        (p_keeper_id, null, inventory_row.location_id, inventory_row.quantity, inventory_row.quantity,
          'inventory_merge', auth.uid(), 'Inventory received from a duplicate ISBN record.', jsonb_build_object('duplicate_item_id', duplicate_record.item_id));
    end loop;
    delete from public.inventory_by_location where item_id = duplicate_record.item_id;
  end loop;

  update public.items set
    title = p_values->>'title', publisher = coalesce(p_values->>'publisher', ''),
    curriculum = coalesce(p_values->>'curriculum', ''), subject = coalesce(p_values->>'subject', ''),
    grade_level = coalesce(p_values->>'grade_level', ''), category = coalesce(p_values->>'category', ''),
    edition = coalesce(p_values->>'edition', ''), final_price = nullif(p_values->>'final_price', '')::numeric,
    square_item_id = coalesce(nullif(p_values->>'square_item_id', ''), square_item_id),
    square_variation_id = coalesce(nullif(p_values->>'square_variation_id', ''), square_variation_id),
    label_printed = false, updated_at = now()
  where id::text = p_keeper_id returning * into merged_record;
  delete from public.items where id::text = any(p_duplicate_ids) and id::text <> p_keeper_id;
  select * into merged_record from public.items where id::text = p_keeper_id;
  return to_jsonb(merged_record);
end
$$;

revoke all on function public.merge_inventory_items(text,text[],jsonb) from public, anon;
grant execute on function public.merge_inventory_items(text,text[],jsonb) to authenticated;

notify pgrst, 'reload schema';
