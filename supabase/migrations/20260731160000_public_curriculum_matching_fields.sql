-- Expose non-sensitive book identifiers so public curriculum lists can match
-- publisher-numbered materials to reservable store inventory.
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
  item.created_at,
  item.item_type,
  item.bundle_piece_count,
  case
    when item.item_type = 'bundle' then array(
      select
        component.piece_quantity::text || '× ' || coalesce(component_item.title, 'Untitled item')
      from public.bundle_components component
      join public.items component_item
        on component_item.id::text = component.component_item_id
      where component.bundle_item_id = item.id::text
      order by component.id
    )
    else array[]::text[]
  end as bundle_contents,
  item.author,
  item.publisher,
  item.publisher_item_number
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
