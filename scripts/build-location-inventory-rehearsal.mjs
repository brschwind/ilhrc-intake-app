import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(scriptsDirectory);
const phaseOnePath = path.join(root, "supabase", "migrations", "20260908120000_location_aware_inventory.sql");
const phaseTwoPath = path.join(root, "supabase", "migrations", "20260915120000_inventory_availability_and_allocation.sql");
const outputPath = path.join(root, "tmp", "location-inventory-production-rehearsal.sql");

const [phaseOne, phaseTwo] = await Promise.all([
  readFile(phaseOnePath, "utf8"),
  readFile(phaseTwoPath, "utf8"),
]);

const assertions = String.raw`
do $rehearsal$
declare
  issue_count integer;
begin
  select count(*) into issue_count
  from public.items item
  full join inventory_rehearsal_baseline baseline on baseline.item_id = item.id::text
  where item.id is null or baseline.item_id is null;
  if issue_count <> 0 then
    raise exception 'REHEARSAL FAILED: the inventory item set changed (% rows).', issue_count;
  end if;

  select count(*) into issue_count
  from inventory_rehearsal_baseline baseline
  join public.items item on item.id::text = baseline.item_id
  left join public.inventory_item_totals total on total.item_id = baseline.item_id
  where greatest(coalesce(item.quantity, 0), 0) <> baseline.quantity
     or coalesce(total.total_quantity, 0) <> baseline.quantity;
  if issue_count <> 0 then
    raise exception 'REHEARSAL FAILED: baseline quantity did not survive migration (% items).', issue_count;
  end if;

  select count(*) into issue_count
  from inventory_rehearsal_baseline baseline
  where baseline.quantity > 0
    and not exists (
      select 1 from public.inventory_by_location stock
      where stock.item_id = baseline.item_id and stock.quantity > 0
    );
  if issue_count <> 0 then
    raise exception 'REHEARSAL FAILED: stocked items are missing location rows (% items).', issue_count;
  end if;

  select count(*) into issue_count
  from public.inventory_by_location stock
  where stock.quantity < 0
     or not exists (select 1 from public.items item where item.id::text = stock.item_id);
  if issue_count <> 0 then
    raise exception 'REHEARSAL FAILED: invalid or orphaned location rows exist (% rows).', issue_count;
  end if;

  select count(*) into issue_count
  from public.inventory_item_availability availability
  left join public.inventory_item_totals total on total.item_id = availability.item_id
  where availability.total_physical_quantity <> coalesce(total.total_quantity, 0)
     or availability.sellable_quantity + availability.held_quantity
        + availability.processing_quantity + availability.needs_review_quantity
        + availability.legacy_unverified_quantity <> availability.total_physical_quantity
     or availability.available_to_reserve > availability.catalog_sellable_quantity
     or availability.strict_available_to_reserve > availability.sellable_quantity;
  if issue_count <> 0 then
    raise exception 'REHEARSAL FAILED: availability totals are inconsistent (% items).', issue_count;
  end if;

  select count(*) into issue_count
  from public.public_catalog_items catalog
  join public.inventory_item_availability availability on availability.item_id = catalog.id::text
  where catalog.quantity::integer > availability.available_to_reserve;
  if issue_count <> 0 then
    raise exception 'REHEARSAL FAILED: public availability exceeds reservable stock (% items).', issue_count;
  end if;

  if not exists (
    select 1 from public.inventory_rollout_settings
    where singleton and catalog_availability_mode = 'legacy_compatible'
  ) then
    raise exception 'REHEARSAL FAILED: the safe legacy-compatible catalog mode is not active.';
  end if;

  select count(*) into issue_count
  from inventory_rehearsal_baseline baseline
  join public.items item on item.id::text = baseline.item_id
  where baseline.quantity > 0
    and coalesce(item.status, 'Available') = 'Available'
    and coalesce(item.public_visible, true) = true
    and not exists (
      select 1 from public.public_catalog_items catalog
      where catalog.id::text = baseline.item_id
    );
  if issue_count <> 0 then
    raise exception 'REHEARSAL FAILED: migration would remove % stocked titles from the public catalog.', issue_count;
  end if;

  if exists (
    select required.code
    from (values ('PROCESSING'), ('HOLD'), ('OVERFLOW'), ('DISPLAY'), ('NEEDS_REVIEW'), ('UNVERIFIED_LEGACY')) required(code)
    where not exists (
      select 1 from public.inventory_locations location
      where location.code = required.code and location.active
    )
  ) then
    raise exception 'REHEARSAL FAILED: one or more operational inventory locations are missing.';
  end if;

  if to_regprocedure('public.adjust_inventory_at_location(text,uuid,integer,text,text,uuid)') is null
    or to_regprocedure('public.receive_inventory_to_processing(text,integer,text)') is null
    or to_regprocedure('public.allocate_sellable_inventory(text,integer,text,text,text)') is null
    or to_regprocedure('public.set_inventory_catalog_availability_mode(text,boolean)') is null
    or to_regprocedure('public.split_inventory_item_for_bundle(text,text,integer)') is null
    or to_regprocedure('public.assemble_inventory_bundle(text)') is null
    or to_regprocedure('public.split_inventory_bundle(text)') is null
    or to_regprocedure('public.archive_inventory_items(text[],text)') is null then
    raise exception 'REHEARSAL FAILED: one or more required inventory operations are missing.';
  end if;

  select count(*) into issue_count
  from inventory_rehearsal_baseline baseline
  where baseline.quantity > 0
    and not exists (
      select 1 from public.inventory_events event
      where event.item_id = baseline.item_id and event.action_type = 'legacy_backfill'
    );
  if issue_count <> 0 then
    raise exception 'REHEARSAL FAILED: legacy backfill history is missing (% items).', issue_count;
  end if;
end
$rehearsal$;
`;

const rehearsal = `-- GENERATED FILE. Transaction-only rehearsal; never commits migration changes.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';
set local idle_in_transaction_session_timeout = '120s';

create temporary table inventory_rehearsal_baseline on commit drop as
select id::text as item_id, greatest(coalesce(quantity, 0), 0)::integer as quantity
from public.items;

${phaseOne}

${phaseTwo}

${assertions}

rollback;

select
  'PASS'::text as rehearsal_result,
  'Both migrations and all inventory assertions succeeded; transaction rolled back.'::text as details;
`;

await writeFile(outputPath, rehearsal, "utf8");
console.log(`${outputPath}\n${Buffer.byteLength(rehearsal)} bytes`);
