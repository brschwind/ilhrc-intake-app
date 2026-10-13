-- Staging-only, read-only postflight for the location-aware inventory migration.
-- Run after both location migrations. Every issue_count value must be zero.

select
  now() as checked_at,
  current_database() as database_name,
  current_user as database_user,
  count(*)::bigint as item_count,
  coalesce(sum(greatest(coalesce(item.quantity, 0), 0)), 0)::bigint as compatibility_quantity,
  coalesce(sum(coalesce(total.total_quantity, 0)), 0)::bigint as location_ledger_quantity
from public.items item
left join public.inventory_item_totals total on total.item_id = item.id::text;

with checks as (
  select 'item total differs from location ledger' as check_name, count(*)::bigint as issue_count
  from public.items item
  left join public.inventory_item_totals total on total.item_id = item.id::text
  where greatest(coalesce(item.quantity, 0), 0) <> coalesce(total.total_quantity, 0)

  union all
  select 'stocked item has no location row', count(*)::bigint
  from public.items item
  where greatest(coalesce(item.quantity, 0), 0) > 0
    and not exists (
      select 1 from public.inventory_by_location stock
      where stock.item_id = item.id::text and stock.quantity > 0
    )

  union all
  select 'location row references a missing item', count(*)::bigint
  from public.inventory_by_location stock
  where not exists (select 1 from public.items item where item.id::text = stock.item_id)

  union all
  select 'inactive location contributes stock', count(*)::bigint
  from public.inventory_by_location stock
  join public.inventory_locations location on location.id = stock.location_id
  where stock.quantity > 0 and not location.active

  union all
  select 'negative location quantity', count(*)::bigint
  from public.inventory_by_location
  where quantity < 0

  union all
  select 'availability physical total differs from item total', count(*)::bigint
  from public.inventory_item_availability availability
  join public.inventory_item_totals total on total.item_id = availability.item_id
  where availability.total_physical_quantity <> total.total_quantity

  union all
  select 'availability components exceed physical total', count(*)::bigint
  from public.inventory_item_availability
  where sellable_quantity + held_quantity + processing_quantity
      + needs_review_quantity + legacy_unverified_quantity > total_physical_quantity

  union all
  select 'reservable quantity exceeds active catalog pool', count(*)::bigint
  from public.inventory_item_availability
  where available_to_reserve > catalog_sellable_quantity

  union all
  select 'strict reservable quantity exceeds verified stock', count(*)::bigint
  from public.inventory_item_availability
  where strict_available_to_reserve > sellable_quantity

  union all
  select 'public catalog exposes more than reservable quantity', count(*)::bigint
  from public.public_catalog_items catalog
  join public.inventory_item_availability availability on availability.item_id = catalog.id::text
  where catalog.quantity::integer > availability.available_to_reserve

  union all
  select 'safe transition catalog mode is not active',
    case when exists (
      select 1 from public.inventory_rollout_settings
      where singleton and catalog_availability_mode = 'legacy_compatible'
    ) then 0 else 1 end::bigint

  union all
  select 'stocked public item disappeared during transition', count(*)::bigint
  from public.items item
  where greatest(coalesce(item.quantity, 0), 0) > 0
    and coalesce(item.status, 'Available') = 'Available'
    and coalesce(item.public_visible, true) = true
    and not exists (
      select 1 from public.public_catalog_items catalog
      where catalog.id::text = item.id::text
    )

  union all
  select 'legacy backfill event missing for stocked row', count(*)::bigint
  from public.inventory_by_location stock
  where stock.quantity > 0
    and not exists (
      select 1 from public.inventory_events event
      where event.item_id = stock.item_id and event.action_type = 'legacy_backfill'
    )
)
select check_name, issue_count,
  case when issue_count = 0 then 'PASS' else 'FAIL' end as result
from checks
order by check_name;

select
  location.code,
  location.display_name,
  location.location_type,
  location.active,
  location.last_verified_at,
  count(stock.id) filter (where stock.quantity > 0)::bigint as stocked_item_count,
  coalesce(sum(stock.quantity), 0)::bigint as physical_quantity
from public.inventory_locations location
left join public.inventory_by_location stock on stock.location_id = location.id
group by location.id, location.code, location.display_name, location.location_type,
  location.active, location.last_verified_at
order by location.location_type, location.code;

with required_objects(object_name, present) as (
  values
    ('inventory_locations', to_regclass('public.inventory_locations') is not null),
    ('inventory_by_location', to_regclass('public.inventory_by_location') is not null),
    ('inventory_events', to_regclass('public.inventory_events') is not null),
    ('inventory_item_totals', to_regclass('public.inventory_item_totals') is not null),
    ('inventory_item_availability', to_regclass('public.inventory_item_availability') is not null),
    ('inventory_rollout_settings', to_regclass('public.inventory_rollout_settings') is not null),
    ('adjust_inventory_at_location', to_regprocedure('public.adjust_inventory_at_location(text,uuid,integer,text,text,uuid)') is not null),
    ('receive_inventory_to_processing', to_regprocedure('public.receive_inventory_to_processing(text,integer,text)') is not null),
    ('allocate_sellable_inventory', to_regprocedure('public.allocate_sellable_inventory(text,integer,text,text,text)') is not null),
    ('set_inventory_catalog_availability_mode', to_regprocedure('public.set_inventory_catalog_availability_mode(text,boolean)') is not null),
    ('split_inventory_item_for_bundle', to_regprocedure('public.split_inventory_item_for_bundle(text,text,integer)') is not null),
    ('assemble_inventory_bundle', to_regprocedure('public.assemble_inventory_bundle(text)') is not null),
    ('split_inventory_bundle', to_regprocedure('public.split_inventory_bundle(text)') is not null),
    ('archive_inventory_items', to_regprocedure('public.archive_inventory_items(text[],text)') is not null)
)
select object_name, case when present then 'PASS' else 'FAIL' end as result
from required_objects
order by object_name;
