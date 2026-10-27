-- Clearing the put-away queue reclassifies location stock; it never removes copies.
create or replace function public.clear_shelving_queue(p_expected_copies bigint)
returns table(moved_copies bigint, moved_titles bigint)
language plpgsql security definer set search_path = public
as $$
declare processing_id uuid; unverified_id uuid; stock_row record;
begin
  if not public.current_profile_is_active() then raise exception 'Active staff access required.'; end if;
  if p_expected_copies is null or p_expected_copies < 0 then raise exception 'Invalid expected queue count.'; end if;
  select id into processing_id from public.inventory_locations where code = 'PROCESSING' and active;
  select id into unverified_id from public.inventory_locations where code = 'UNVERIFIED_LEGACY' and active;
  if processing_id is null or unverified_id is null then raise exception 'Processing and Unverified Inventory must both be active.'; end if;
  moved_copies := 0;
  moved_titles := 0;
  for stock_row in
    select item_id, quantity from public.inventory_by_location
    where location_id = processing_id and quantity > 0
    order by item_id for update
  loop
    perform public.move_inventory_stock(stock_row.item_id, processing_id, unverified_id,
      stock_row.quantity, 'Shelving queue cleared to Unverified Inventory pending shelf audits. Copy count preserved.',
      null, 'move');
    moved_copies := moved_copies + stock_row.quantity;
    moved_titles := moved_titles + 1;
  end loop;
  -- A stale screen must not silently clear a different set of copies. An exception
  -- rolls back every move and its history entries in this same transaction.
  if moved_copies <> p_expected_copies then
    raise exception 'The shelving queue changed. Refresh the queue and try again.';
  end if;
  return next;
end;
$$;
revoke all on function public.clear_shelving_queue(bigint) from public, anon;
grant execute on function public.clear_shelving_queue(bigint) to authenticated;
