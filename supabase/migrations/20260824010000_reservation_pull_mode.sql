alter table public.book_reservations
drop constraint if exists book_reservations_status_check;

alter table public.book_reservations
add constraint book_reservations_status_check
check (status in ('pending', 'ready', 'unavailable', 'picked_up', 'cancelled', 'expired'));

alter table public.book_reservations
add column if not exists pull_completed_by uuid references auth.users(id) on delete set null,
add column if not exists pull_completed_by_name text,
add column if not exists pull_completed_at timestamptz;

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
  if p_status not in ('pending', 'ready', 'unavailable', 'picked_up', 'cancelled', 'expired') then
    raise exception 'Invalid reservation status.';
  end if;

  select * into reservation_record
  from public.book_reservations
  where id = p_reservation_id
  for update;
  if not found then raise exception 'Reservation not found.'; end if;

  if reservation_record.status in ('picked_up', 'cancelled', 'unavailable') then
    raise exception 'Completed reservations cannot be changed.';
  end if;
  if (reservation_record.status = 'pending' and p_status not in ('ready', 'unavailable', 'cancelled', 'expired'))
    or (reservation_record.status = 'ready' and p_status not in ('unavailable', 'picked_up', 'cancelled', 'expired'))
    or reservation_record.status = 'expired'
  then
    raise exception 'Invalid reservation status transition.';
  end if;
  if p_status in ('ready', 'picked_up') and reservation_record.expires_at <= now() then
    raise exception 'This reservation has expired. Extend it before continuing.';
  end if;

  if p_status = 'picked_up' then
    select * into item_record
    from public.items
    where id::text = reservation_record.item_id
    for update;
    if not found then raise exception 'The reserved inventory item no longer exists.'; end if;

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
  set status = p_status, handled_by = auth.uid(), updated_at = now()
  where id = p_reservation_id
  returning * into reservation_record;

  insert into public.audit_logs (user_id, action, entity_type, entity_id, details)
  values (
    auth.uid(), 'reservation_status_changed', 'book_reservation', reservation_record.id::text,
    jsonb_build_object('status', p_status, 'item_id', reservation_record.item_id, 'inventory_source', 'square')
  );
  return reservation_record;
end
$$;

revoke all on function public.update_book_reservation_status(uuid,text) from public, anon;
grant execute on function public.update_book_reservation_status(uuid,text) to authenticated;

create or replace function public.complete_book_reservation_pull(p_reservation_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  requested_count integer;
  eligible_count integer;
  completed_name text;
  completed_time timestamptz := now();
begin
  if not public.current_profile_is_active() then
    raise exception 'Active staff access is required.';
  end if;
  requested_count := coalesce(array_length(p_reservation_ids, 1), 0);
  if requested_count < 1 or requested_count > 50 then
    raise exception 'Choose between 1 and 50 reservations.';
  end if;
  if (select count(distinct id) from unnest(p_reservation_ids) id) <> requested_count then
    raise exception 'Duplicate reservations are not allowed.';
  end if;

  select count(*) into eligible_count
  from public.book_reservations
  where id = any(p_reservation_ids)
    and status in ('ready', 'unavailable');
  if eligible_count <> requested_count then
    raise exception 'Every book must be marked Ready or Not Available first.';
  end if;

  select coalesce(nullif(trim(full_name), ''), email, 'Staff member') into completed_name
  from public.profiles where id = auth.uid();

  update public.book_reservations
  set
    pull_completed_by = auth.uid(),
    pull_completed_by_name = completed_name,
    pull_completed_at = completed_time,
    updated_at = now()
  where id = any(p_reservation_ids);

  insert into public.audit_logs (user_id, action, entity_type, entity_id, details)
  values (
    auth.uid(), 'reservation_pull_completed', 'book_reservation_pull', null,
    jsonb_build_object('reservation_ids', p_reservation_ids, 'completed_by', completed_name)
  );

  return jsonb_build_object('completed_by', completed_name, 'completed_at', completed_time);
end
$$;

revoke all on function public.complete_book_reservation_pull(uuid[]) from public, anon;
grant execute on function public.complete_book_reservation_pull(uuid[]) to authenticated;

notify pgrst, 'reload schema';
