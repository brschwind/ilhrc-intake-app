create or replace function public.complete_book_reservation_pickup(p_reservation_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  requested_count integer;
  eligible_count integer;
  reservation_id uuid;
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
  from public.book_reservations reservation
  join public.items item on item.id::text = reservation.item_id
  where reservation.id = any(p_reservation_ids)
    and reservation.status = 'ready'
    and (
      nullif(trim(coalesce(item.square_variation_id, '')), '') is null
      or reservation.square_hold_released_at is not null
    );

  if eligible_count <> requested_count then
    raise exception 'Every selected ready book must be released for Square checkout first.';
  end if;

  foreach reservation_id in array p_reservation_ids loop
    perform public.update_book_reservation_status(reservation_id, 'picked_up');
  end loop;

  insert into public.audit_logs (user_id, action, entity_type, entity_id, details)
  values (
    auth.uid(),
    'reservation_pickup_completed',
    'book_reservation_pickup',
    null,
    jsonb_build_object('reservation_ids', p_reservation_ids, 'count', requested_count)
  );

  return jsonb_build_object('picked_up_count', requested_count);
end
$$;

revoke all on function public.complete_book_reservation_pickup(uuid[]) from public, anon;
grant execute on function public.complete_book_reservation_pickup(uuid[]) to authenticated;

notify pgrst, 'reload schema';
