-- Square is the source of truth for physical stock. Webhook deliveries can be
-- duplicated or arrive out of order, so record each count and only apply a
-- count that is at least as new as the last one applied to an item.
alter table public.items
add column if not exists square_inventory_synced_at timestamptz;

create table if not exists public.square_inventory_events (
  event_id text not null,
  square_variation_id text not null,
  location_id text not null,
  state text not null default 'IN_STOCK',
  quantity integer not null check (quantity >= 0),
  calculated_at timestamptz not null,
  received_at timestamptz not null default now(),
  primary key (event_id, square_variation_id, location_id, state)
);

alter table public.square_inventory_events enable row level security;

create index if not exists items_square_variation_id_idx
on public.items (square_variation_id)
where square_variation_id is not null;

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
  updated_count integer := 0;
begin
  if trim(coalesce(p_event_id, '')) = ''
    or trim(coalesce(p_square_variation_id, '')) = ''
    or trim(coalesce(p_location_id, '')) = ''
    or p_quantity is null
    or p_quantity < 0
    or p_calculated_at is null
  then
    raise exception 'Invalid Square inventory count.';
  end if;

  insert into public.square_inventory_events (
    event_id,
    square_variation_id,
    location_id,
    quantity,
    calculated_at
  ) values (
    p_event_id,
    p_square_variation_id,
    p_location_id,
    p_quantity,
    p_calculated_at
  )
  on conflict do nothing;

  if not found then
    return jsonb_build_object('duplicate', true, 'updated_items', 0);
  end if;

  update public.items
  set
    quantity = p_quantity,
    status = case
      when p_quantity = 0 and coalesce(status, 'Available') = 'Available' then 'Sold'
      when p_quantity > 0 and status = 'Sold' then 'Available'
      else status
    end,
    square_inventory_synced_at = p_calculated_at,
    updated_at = now()
  where square_variation_id = p_square_variation_id
    and (
      square_inventory_synced_at is null
      or square_inventory_synced_at <= p_calculated_at
    );

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
        'quantity', p_quantity,
        'calculated_at', p_calculated_at
      )
    );
  end if;

  return jsonb_build_object('duplicate', false, 'updated_items', updated_count);
end
$$;

revoke all on function public.apply_square_inventory_count(text,text,text,integer,timestamptz)
from public, anon, authenticated;
grant execute on function public.apply_square_inventory_count(text,text,text,integer,timestamptz)
to service_role;

-- Completing a pickup changes reservation state only. The corresponding sale
-- in Square changes physical inventory and is synchronized independently.
create or replace function public.update_book_reservation_status(
  p_reservation_id uuid,
  p_status text
)
returns public.book_reservations
language plpgsql
security definer
set search_path = public
as $$
declare
  reservation_record public.book_reservations%rowtype;
  item_record public.items%rowtype;
begin
  if not public.current_profile_is_active() then
    raise exception 'Active staff access is required.';
  end if;
  if p_status not in ('pending', 'ready', 'picked_up', 'cancelled', 'expired') then
    raise exception 'Invalid reservation status.';
  end if;

  select * into reservation_record
  from public.book_reservations
  where id = p_reservation_id
  for update;
  if not found then raise exception 'Reservation not found.'; end if;

  if reservation_record.status in ('picked_up', 'cancelled') then
    raise exception 'Completed reservations cannot be changed.';
  end if;
  if (reservation_record.status = 'pending' and p_status not in ('ready', 'cancelled', 'expired'))
    or (reservation_record.status = 'ready' and p_status not in ('picked_up', 'cancelled', 'expired'))
    or reservation_record.status = 'expired'
  then
    raise exception 'Invalid reservation status transition.';
  end if;
  if p_status in ('ready', 'picked_up')
    and (
      reservation_record.status = 'expired'
      or reservation_record.expires_at <= now()
    )
  then
    raise exception 'This reservation has expired. Extend it before continuing.';
  end if;

  -- Legacy inventory without a Square variation still uses the original local
  -- decrement. Square-linked inventory is updated only by Square counts.
  if p_status = 'picked_up' then
    select * into item_record
    from public.items
    where id::text = reservation_record.item_id
    for update;

    if not found then
      raise exception 'The reserved inventory item no longer exists.';
    end if;

    if nullif(trim(coalesce(item_record.square_variation_id, '')), '') is null then
      if coalesce(item_record.quantity, 0) < 1 then
        raise exception 'No inventory copy remains to complete this pickup.';
      end if;

      update public.items
      set
        quantity = item_record.quantity - 1,
        status = case when item_record.quantity - 1 <= 0 then 'Sold' else item_record.status end,
        updated_at = now()
      where id::text = reservation_record.item_id;
    end if;
  end if;

  update public.book_reservations
  set
    status = p_status,
    handled_by = auth.uid(),
    updated_at = now()
  where id = p_reservation_id
  returning * into reservation_record;

  insert into public.audit_logs (user_id, action, entity_type, entity_id, details)
  values (
    auth.uid(),
    'reservation_status_changed',
    'book_reservation',
    reservation_record.id::text,
    jsonb_build_object(
      'status', p_status,
      'item_id', reservation_record.item_id,
      'inventory_source', 'square'
    )
  );

  return reservation_record;
end
$$;

revoke all on function public.update_book_reservation_status(uuid,text)
from public, anon;
grant execute on function public.update_book_reservation_status(uuid,text)
to authenticated;

notify pgrst, 'reload schema';
