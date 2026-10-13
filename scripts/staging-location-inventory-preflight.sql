-- Staging-only, read-only preflight for the location-aware inventory migration.
-- Run this in the staging project's SQL editor before applying either migration.
-- Save/download the result with the database backup record.

select
  now() as checked_at,
  current_database() as database_name,
  current_user as database_user,
  count(*)::bigint as item_count,
  count(*) filter (where greatest(coalesce(quantity, 0), 0) > 0)::bigint as stocked_item_count,
  coalesce(sum(greatest(coalesce(quantity, 0), 0)), 0)::bigint as legacy_physical_quantity
from public.items;

select
  to_regclass('public.inventory_locations') is not null as phase_1_already_present,
  to_regclass('public.inventory_by_location') is not null as location_ledger_already_present,
  to_regclass('public.inventory_item_availability') is not null as phase_2_already_present,
  to_regprocedure('public.split_inventory_item_for_bundle(text,text,integer)') is not null
    as quantity_writer_conversion_already_present;

select
  count(*) filter (where quantity is null)::bigint as null_quantity_rows,
  count(*) filter (where quantity < 0)::bigint as negative_quantity_rows,
  count(*) filter (
    where greatest(coalesce(quantity, 0), 0) > 0
      and nullif(trim(location), '') is null
  )::bigint as stocked_items_without_legacy_location,
  count(*) filter (
    where nullif(trim(location), '') is not null
      and upper(trim(location)) ~ '^[A-Z]+[0-9]+$'
  )::bigint as items_with_shelf_code,
  count(*) filter (
    where nullif(trim(location), '') is not null
      and upper(trim(location)) !~ '^[A-Z]+[0-9]+$'
  )::bigint as items_with_non_shelf_location
from public.items;

-- The migration starts in legacy-compatible mode, so both recognizable shelf
-- codes and legacy/unlocated stock remain publicly reservable during rollout.
-- The strict cutover readiness numbers show what would remain after switching.
with stocked as (
  select
    greatest(coalesce(quantity, 0), 0)::bigint as copies,
    case
      when nullif(trim(location), '') is null then 'missing_location'
      when upper(trim(location)) ~ '^[A-Z]+[0-9]+$' then 'recognized_shelf'
      else 'named_legacy_location'
    end as readiness
  from public.items
  where greatest(coalesce(quantity, 0), 0) > 0
)
select
  readiness,
  count(*)::bigint as title_count,
  sum(copies)::bigint as copy_count,
  case when readiness = 'recognized_shelf' then 'included_after_strict_cutover'
    else 'retained_during_transition' end as rollout_effect
from stocked
group by readiness
order by case readiness when 'recognized_shelf' then 1 when 'missing_location' then 2 else 3 end;

select
  coalesce(nullif(trim(location), ''), '(missing)') as legacy_location,
  count(*)::bigint as item_count,
  coalesce(sum(greatest(coalesce(quantity, 0), 0)), 0)::bigint as physical_quantity
from public.items
where greatest(coalesce(quantity, 0), 0) > 0
group by coalesce(nullif(trim(location), ''), '(missing)')
order by physical_quantity desc, legacy_location;
