-- Square does not allow third-party apps to write RESERVED_FOR_SALE. Keep its
-- sellable IN_STOCK count equal to physical stock minus synchronized holds.
alter table public.items
add column if not exists square_expected_quantity integer;

alter table public.book_reservations
add column if not exists square_hold_synced_at timestamptz,
add column if not exists square_hold_released_at timestamptz,
add column if not exists square_checkout_quantity integer,
add column if not exists square_hold_error text;

alter table public.square_inventory_events
drop constraint if exists square_inventory_events_quantity_check;

create index if not exists book_reservations_square_holds_idx
on public.book_reservations (item_id, expires_at)
where status in ('pending', 'ready')
  and square_hold_synced_at is not null
  and square_hold_released_at is null;

-- Existing active reservations are included in the first availability sync.
update public.book_reservations reservation
set square_hold_synced_at = coalesce(square_hold_synced_at, now())
where status in ('pending', 'ready')
  and expires_at > now()
  and exists (
    select 1
    from public.items item
    where item.id::text = reservation.item_id
      and nullif(trim(coalesce(item.square_variation_id, '')), '') is not null
  );

create or replace function public.apply_square_inventory_count(
  p_event_id text,
  p_square_variation_id text,
  p_location_id text,
  p_quantity integer,
  p_calculated_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  item_record public.items%rowtype;
  new_physical_quantity integer;
  updated_count integer := 0;
begin
  if trim(coalesce(p_event_id, '')) = ''
    or trim(coalesce(p_square_variation_id, '')) = ''
    or trim(coalesce(p_location_id, '')) = ''
    or p_quantity is null
    or p_calculated_at is null
  then
    raise exception 'Invalid Square inventory count.';
  end if;

  insert into public.square_inventory_events (
    event_id, square_variation_id, location_id, quantity, calculated_at
  ) values (
    p_event_id, p_square_variation_id, p_location_id, p_quantity, p_calculated_at
  )
  on conflict do nothing;

  if not found then
    return jsonb_build_object('duplicate', true, 'updated_items', 0);
  end if;

  select * into item_record
  from public.items
  where square_variation_id = p_square_variation_id
  for update;

  if not found
    or (
      item_record.square_inventory_synced_at is not null
      and item_record.square_inventory_synced_at > p_calculated_at
    )
  then
    return jsonb_build_object('duplicate', false, 'updated_items', 0);
  end if;

  if item_record.square_expected_quantity is null then
    new_physical_quantity := greatest(p_quantity, 0);
  else
    new_physical_quantity := greatest(
      coalesce(item_record.quantity, 0) + p_quantity - item_record.square_expected_quantity,
      0
    );
  end if;

  update public.items
  set
    quantity = new_physical_quantity,
    status = case
      when new_physical_quantity = 0 and coalesce(status, 'Available') = 'Available' then 'Sold'
      when new_physical_quantity > 0 and status = 'Sold' then 'Available'
      else status
    end,
    square_expected_quantity = p_quantity,
    square_inventory_synced_at = p_calculated_at,
    updated_at = now()
  where id::text = item_record.id::text;

  get diagnostics updated_count = row_count;

  if updated_count > 0 then
    insert into public.audit_logs (action, entity_type, entity_id, details)
    values (
      'square_inventory_received',
      'square_variation',
      p_square_variation_id,
      jsonb_build_object(
        'event_id', p_event_id,
        'location_id', p_location_id,
        'square_available_quantity', p_quantity,
        'physical_quantity', new_physical_quantity,
        'calculated_at', p_calculated_at
      )
    );
  end if;

  return jsonb_build_object(
    'duplicate', false,
    'updated_items', updated_count,
    'physical_quantity', new_physical_quantity,
    'square_available_quantity', p_quantity
  );
end
$$;

revoke all on function public.apply_square_inventory_count(text,text,text,integer,timestamptz)
from public, anon, authenticated;
grant execute on function public.apply_square_inventory_count(text,text,text,integer,timestamptz)
to service_role;

notify pgrst, 'reload schema';
