-- Ordinary shelving only moves existing Processing copies. Discovery remains explicit.
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
    if coalesce(processing_quantity, 0) <= 0 and not p_discover then
      raise exception 'No copies of this book remain in Processing. No inventory was added.';
    end if;
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
