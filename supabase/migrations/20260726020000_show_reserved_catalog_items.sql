-- Keep fully reserved titles visible in the public catalog with zero
-- available copies so the app can label them Reserved.
create or replace view public.public_catalog_items as
select
  item.id,
  item.title,
  item.curriculum,
  item.subject,
  item.grade_level,
  item.category,
  item.edition,
  item.isbn,
  item.final_price,
  greatest(item.quantity::integer - coalesce(reservation.active_count, 0), 0)::smallint as quantity,
  item.image_url,
  item.created_at
from public.items item
left join lateral (
  select count(*)::integer as active_count
  from public.book_reservations
  where item_id = item.id::text
    and status in ('pending', 'ready')
    and expires_at > now()
) reservation on true
where coalesce(item.status, 'Available') = 'Available'
  and coalesce(item.public_visible, true) = true
  and coalesce(item.quantity, 0) > 0;

grant select on public.public_catalog_items to anon, authenticated;

notify pgrst, 'reload schema';
