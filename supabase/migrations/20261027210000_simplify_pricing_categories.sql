-- Consolidate categories without repricing or changing stock.
begin;
lock table public.items, public.category_options, public.intake_rules in share row exclusive mode;
create temporary table pricing_before on commit drop as select id, final_price, quantity from public.items;
create temporary table pricing_category_map (old_name text primary key, new_name text not null) on commit drop;
insert into pricing_category_map values ('Textbook','Student Text'),
('Workbook','Workbook & Tests'),
('Workbook (small/paperback)','Workbook & Tests'),
('Teacher Resource','Teacher Guide'),
('Picture Book','Reading Book'),
('Early Reader','Reading Book'),
('Reader / Chapter Book','Reading Book'),
('Novel','Reading Book'),
('Biography','Reading Book'),
('Bible','Reading Book'),
('Devotional','Reading Book'),
('Reference Book','Reference & Resource'),
('Family Living','Reference & Resource'),
('Enrichment','Reference & Resource'),
('DVD / Media','Learning Materials & Media'),
('Game','Learning Materials & Media'),
('Flashcards','Learning Materials & Media'),
('Manipulative','Learning Materials & Media'),
('Science Kit','Bundle / Kit'),
('Curriculum Package','Bundle / Kit'),
('Bundle / Set','Bundle / Kit');
alter table public.items add column if not exists legacy_pricing_category text;
update public.items i set legacy_pricing_category=coalesce(i.legacy_pricing_category,i.category), category=m.new_name
from pricing_category_map m where i.category=m.old_name;
update public.intake_rules r set actions=jsonb_set(r.actions,'{category}',to_jsonb(m.new_name))
from pricing_category_map m where r.actions->>'category'=m.old_name;
-- Keep original condition semantics; no current rules condition on category.
do $$ begin
if exists(select 1 from public.intake_rules r, jsonb_array_elements(r.conditions) c
join pricing_category_map m on c->>'value'=m.old_name where c->>'field'='category') then
raise exception 'Legacy category conditions need review before migration'; end if;
end $$;
alter table public.category_options add column if not exists active boolean not null default true;
update public.category_options set active=false;
create temporary table pricing_defaults(name text,default_price numeric) on commit drop;
insert into pricing_defaults values ('Student Text',10),
('Workbook & Tests',2),
('Teacher Guide',3),
('Answer Key',1),
('Reading Book',1),
('Reference & Resource',3),
('Learning Materials & Media',5),
('Bundle / Kit',10);
update public.category_options c set active=true,default_price=d.default_price from pricing_defaults d where c.name=d.name;
insert into public.category_options(name,default_price,active) select d.name,d.default_price,true from pricing_defaults d where not exists(select 1 from public.category_options c where c.name=d.name);
do $$ begin
if exists(select 1 from pricing_before b full join public.items i using(id)
where b.id is null or i.id is null or b.final_price is distinct from i.final_price or b.quantity is distinct from i.quantity) then
raise exception 'Category migration changed inventory prices or counts'; end if;
end $$;
select count(*) as records_verified, 0 as prices_changed, (select count(*) from public.category_options where active) as category_count from pricing_before;
commit;
