-- Reviewed curriculum cleanup. Only Curriculum and Publisher may change.
begin;
lock table public.items in share row exclusive mode;
create table if not exists public.inventory_curriculum_cleanup_backup (
 cleanup_key text not null, item_id text not null, before_values jsonb not null,
 after_curriculum text, after_publisher text, cleaned_at timestamptz not null default now(),
 primary key(cleanup_key,item_id)
);
alter table public.inventory_curriculum_cleanup_backup enable row level security;
revoke all on public.inventory_curriculum_cleanup_backup from public, anon, authenticated;
create temporary table curriculum_before on commit drop as select id::text as item_id,to_jsonb(i) as before_values from public.items i;
create temporary table known_curriculum_map(key text primary key,name text) on commit drop;
insert into known_curriculum_map values ('historyodyssey','History Odyssey'),
('visuallatin','Visual Latin'),
('thegentleclassical','The Gentle + Classical'),
('latinalive','Latin Alive'),
('mottmedia','Mott Media'),
('lyricallearning','Lyrical Learning'),
('truthquesthistory','TruthQuest History'),
('pathwaypublishers','Pathway Publishers'),
('thinkwell','Thinkwell'),
('diannecraftrightbrainlearningsystem','Dianne Craft Right Brain Learning System'),
('ramseyeducation','Ramsey Education'),
('abeka','Abeka'),
('allaboutlearningpress','All About Learning Press'),
('allaboutreading','All About Reading'),
('allaboutspelling','All About Spelling'),
('amblesideonline','Ambleside Online'),
('answersingenesis','Answers in Genesis'),
('apologia','Apologia'),
('beautifulfeet','Beautiful Feet'),
('bereanbuilders','Berean Builders'),
('bjupress','BJU Press'),
('bravewriter','Brave Writer'),
('christianlibertypress','Christian Liberty Press'),
('christianlighteducation','Christian Light Education'),
('classicalacademicpress','Classical Academic Press'),
('classicalconversations','Classical Conversations'),
('easygrammar','Easy Grammar'),
('elementalscience','Elemental Science'),
('essentialsinwriting','Essentials in Writing'),
('explodethecode','Explode the Code'),
('fiveinarow','Five in a Row'),
('gatherround','Gather Round'),
('generations','Generations'),
('handwritingwithouttears','Handwriting Without Tears'),
('horizons','Horizons'),
('iewinstituteforexcellenceinwriting','IEW (Institute for Excellence in Writing)'),
('learningwithouttears','Learning Without Tears'),
('lifepac','LifePac'),
('masterbooks','Master Books'),
('mathwithconfidence','Math With Confidence'),
('mathusee','Math-U-See'),
('mcruffypress','McRuffy Press'),
('memoriapress','Memoria Press'),
('myfathersworld','My Father''s World'),
('mysteryofhistory','Mystery of History'),
('notgrass','Notgrass'),
('rodandstaffpublishers','Rod and Staff Publishers'),
('saxonmath','Saxon Math'),
('shurleyenglish','Shurley English'),
('simplycharlottemason','Simply Charlotte Mason'),
('singaporemath','Singapore Math'),
('sonlight','Sonlight'),
('spellingyousee','Spelling You See'),
('storyoftheworld','Story of the World'),
('teachingtextbooks','Teaching Textbooks'),
('thecriticalthinkingco','The Critical Thinking Co.'),
('thegoodandthebeautiful','The Good and the Beautiful'),
('thelatinroad','The Latin Road'),
('thewritingrevolution','The Writing Revolution'),
('veritaspress','Veritas Press'),
('writeshop','WriteShop'),
('writingstrands','Writing Strands'),
('alphaomega','Alpha Omega'),
('ace','ACE'),
('lifeoffred','Life of Fred'),
('rightstart','Right Start'),
('thinkwellcorporation','Thinkwell'),
('gentleclassicalpress','The Gentle + Classical'),
('bobjones','BJU Press'),
('bobjonesuniversitypress','BJU Press'),
('apologiaeducationalministries','Apologia'),
('saxon','Saxon Math'),
('rodstaff','Rod and Staff Publishers'),
('rodandstaff','Rod and Staff Publishers'),
('iew','IEW (Institute for Excellence in Writing)'),
('instituteforexcellenceinwriting','IEW (Institute for Excellence in Writing)'),
('thestoryoftheworld','Story of the World'),
('teachingtextbook','Teaching Textbooks');
create temporary table general_publisher_names(key text primary key) on commit drop;
insert into general_publisher_names values ('randmcnally'),('randmcnallyschoolhouse'),('dk'),('usborne'),('mcgrawhill'),('scholastic'),('evanmoor'),('highlightsforchildreninc'),('teachercreatedmaterials'),('rigby'),('creativeteachingpress'),('bresser'),('milliken'),('lauri'),('schoolzone'),('juniorlearning'),('funtolearn'),('aladdin'),('moderncurriculumpress'),('wwnortoncompany'),('ramsey'),('chelseahousepublications'),('shelleducation'),('marshallcavendisheducation'),('trendenterprises'),('stepahead'),('flashkids'),('homeworkhelpers'),('klutz'),('tigertastic'),('cannonpress'),('canonpress'),('weesing'),('milestonebooks'),('educatorspublishingservice'),('scottforesman'),('learningresources'),('smartkids'),('worthpublishers'),('parragonpublishing');
create temporary table curriculum_plan on commit drop as
select i.id::text as item_id,
case when i.title ilike '%foundations in personal finance%' and concat(i.curriculum,' ',i.publisher) ilike '%ramsey%' then 'Ramsey Education'
else coalesce(k.name,p.name,'') end as new_curriculum,
case when g.key is not null and k.name is null and p.name is null then
 case when nullif(trim(i.publisher),'') is null then trim(i.curriculum)
 when position(regexp_replace(lower(i.curriculum),'[^a-z0-9]','','g') in regexp_replace(lower(i.publisher),'[^a-z0-9]','','g'))>0 then i.publisher
 else i.publisher || '; ' || trim(i.curriculum) end
else i.publisher end as new_publisher
from public.items i
left join known_curriculum_map k on k.key=regexp_replace(lower(i.curriculum),'[^a-z0-9]','','g')
left join known_curriculum_map p on p.key=regexp_replace(lower(i.publisher),'[^a-z0-9]','','g')
left join general_publisher_names g on g.key=regexp_replace(lower(i.curriculum),'[^a-z0-9]','','g')
where nullif(trim(i.curriculum),'') is not null;
insert into public.inventory_curriculum_cleanup_backup(cleanup_key,item_id,before_values,after_curriculum,after_publisher)
select '20261027',b.item_id,b.before_values,p.new_curriculum,p.new_publisher
from curriculum_before b join curriculum_plan p using(item_id)
where b.before_values->>'curriculum' is distinct from p.new_curriculum or b.before_values->>'publisher' is distinct from p.new_publisher
on conflict(cleanup_key,item_id) do nothing;
update public.items i set curriculum=p.new_curriculum,publisher=p.new_publisher
from curriculum_plan p where i.id::text=p.item_id and (i.curriculum is distinct from p.new_curriculum or i.publisher is distinct from p.new_publisher);
do $$ begin
if exists(select 1 from curriculum_before b full join public.items i on i.id::text=b.item_id
where b.item_id is null or i.id is null or (b.before_values - array['curriculum','publisher','updated_at']) is distinct from (to_jsonb(i) - array['curriculum','publisher','updated_at'])) then
raise exception 'Cleanup changed inventory fields outside Curriculum/Publisher'; end if;
end $$;
select count(*) as inventory_records_verified,
count(*) filter(where b.before_values->>'curriculum' is distinct from i.curriculum) as curriculum_fields_cleaned,
count(*) filter(where b.before_values->>'publisher' is distinct from i.publisher) as publisher_fields_updated,
count(*) filter(where nullif(b.before_values->>'curriculum','') is not null and i.curriculum='') as curriculum_fields_cleared,
0 as prices_or_quantities_changed
from curriculum_before b join public.items i on i.id::text=b.item_id;
commit;
