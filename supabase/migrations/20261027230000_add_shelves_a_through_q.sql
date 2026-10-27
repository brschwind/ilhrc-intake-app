-- Add A1-Q6 without changing any existing location or inventory stock.
begin;
lock table public.inventory_locations in share row exclusive mode;
create temporary table shelves_before on commit drop as select id,to_jsonb(l) as original from public.inventory_locations l;
create temporary table shelves_inserted on commit drop as
with inserted as (
 insert into public.inventory_locations(code,display_name,location_type)
 select chr(letter)||shelf::text,chr(letter)||shelf::text,'shelf'
 from generate_series(ascii('A'),ascii('Q')) letter cross join generate_series(1,6) shelf
 on conflict(code) do nothing returning code
) select * from inserted;
do $$ begin
 if exists(select 1 from shelves_before b left join public.inventory_locations l using(id) where l.id is null or b.original is distinct from to_jsonb(l)) then
 raise exception 'Existing shelf records changed'; end if;
 if (select count(*) from public.inventory_locations where code ~ '^[A-Q][1-6]$') <> 102 then
 raise exception 'Expected all 102 shelves A1-Q6'; end if;
end $$;
select (select count(*) from shelves_inserted) as shelves_added,
 102-(select count(*) from shelves_inserted) as existing_shelves_skipped,
 (select count(*) from public.inventory_locations where code ~ '^[A-Q][1-6]$') as total_shelves_a_to_q;
commit;
