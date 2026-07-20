begin;

insert into public.curriculum_publishers (name, website_url)
values ('My Father''s World', 'https://www.mfwbooks.com/')
on conflict (name) do update
set website_url = excluded.website_url,
    updated_at = now();

insert into public.curriculum_packages (
  publisher_id,
  name,
  package_type,
  grade_level,
  subject,
  edition_label,
  description,
  source_url,
  source_checked_on,
  status
)
select
  publisher.id,
  'Adventures in U.S. History Package',
  'grade',
  '2nd Grade',
  'Multi-Subject',
  'Current package',
  'Year-long second-grade package covering U.S. history, Bible, science, geography, art, music, and family reading. Grade-appropriate math and language arts are required and purchased separately.',
  'https://www.mfwbooks.com/item/92201/',
  date '2026-07-19',
  'draft'
from public.curriculum_publishers publisher
where publisher.name = 'My Father''s World'
  and not exists (
    select 1
    from public.curriculum_packages package
    where package.publisher_id = publisher.id
      and package.name = 'Adventures in U.S. History Package'
      and package.grade_level = '2nd Grade'
      and package.edition_label = 'Current package'
  );

create temporary table mfw_adventures_items (
  sort_order integer not null,
  group_label text not null,
  title text not null,
  isbn text,
  material_type text not null,
  compatibility_mode text not null,
  audience text not null,
  item_number text not null,
  affiliate_url text not null
) on commit drop;

insert into mfw_adventures_items values
  (0, 'Teacher''s Manual', 'Adventures in U.S. History Teacher''s Manual', null, 'teacher', 'strict', 'teacher', '92202', 'https://www.mfwbooks.com/item/92202/'),
  (1, 'Student Sheets', 'Student Sheets for Adventures in U.S. History', null, 'workbook', 'strict', 'student', '92203', 'https://www.mfwbooks.com/item/92203/'),
  (2, 'Bible', 'NIrV Discoverer''s Bible for Young Readers', '9780310743736', 'book', 'flexible', 'family', '02800', 'https://www.mfwbooks.com/item/02800/'),
  (3, 'History', 'American Pioneers and Patriots', '9781932971514', 'book', 'flexible', 'family', '02701', 'https://www.mfwbooks.com/item/02701/'),
  (4, 'History', 'North American Indians', '9780394837024', 'book', 'flexible', 'family', '02702', 'https://www.mfwbooks.com/item/02702/'),
  (5, 'History', 'Red, White, and Blue', '9780448412702', 'book', 'flexible', 'family', '02703', 'https://www.mfwbooks.com/item/02703/'),
  (6, 'History', 'The Fourth of July Story', '9780689718762', 'book', 'flexible', 'family', '02705', 'https://www.mfwbooks.com/item/02705/'),
  (7, 'History', 'The Story of the U.S.', '9781619990326', 'book', 'strict', 'family', '02706', 'https://www.mfwbooks.com/item/02706/'),
  (8, 'Science', 'Birds, Nests, and Eggs', '9781559716246', 'book', 'flexible', 'family', '02503', 'https://www.mfwbooks.com/item/02503/'),
  (9, 'Science', 'First Encyclopedia of Science', '9780794530433', 'book', 'flexible', 'family', '02500', 'https://www.mfwbooks.com/item/02500/'),
  (10, 'Science', 'Science in the Kitchen', '9780794514051', 'book', 'flexible', 'family', '02501', 'https://www.mfwbooks.com/item/02501/'),
  (11, 'Science', 'Science With Air', '9780794523312', 'book', 'flexible', 'family', '02502', 'https://www.mfwbooks.com/item/02502/'),
  (12, 'Science', 'Soda Bottle Bird Feeder', null, 'supply', 'strict', 'family', '02505', 'https://www.mfwbooks.com/item/02505/'),
  (13, 'Geography', 'Map of the U.S./World - placemat size', null, 'supply', 'strict', 'family', '02750', 'https://www.mfwbooks.com/item/02750/'),
  (14, 'Geography', 'Map of the United States Sticker Picture', '9780486296708', 'workbook', 'strict', 'student', '02751', 'https://www.mfwbooks.com/item/02751/'),
  (15, 'Family Reading', 'Farmer Boy', '9780064400039', 'book', 'flexible', 'family', '02304', 'https://www.mfwbooks.com/item/02304/'),
  (16, 'Family Reading', 'In Grandma''s Attic', '9780781403795', 'book', 'flexible', 'family', '02306', 'https://www.mfwbooks.com/item/02306/'),
  (17, 'Family Reading', 'Mountain Born', '9780890847060', 'book', 'flexible', 'family', '02305', 'https://www.mfwbooks.com/item/02305/'),
  (18, 'Family Reading', 'On the Banks of Plum Creek', '9780064400046', 'book', 'flexible', 'family', '02303', 'https://www.mfwbooks.com/item/02303/'),
  (19, 'Family Reading', 'Pilgrim Adventures', '9781619991378', 'book', 'flexible', 'family', '02307', 'https://www.mfwbooks.com/item/02307/'),
  (20, 'Family Reading', 'Sarah Whitcher''s Story', '9780890847541', 'book', 'flexible', 'family', '02302', 'https://www.mfwbooks.com/item/02302/'),
  (21, 'Family Reading', 'The Courage of Sarah Noble', '9780689715402', 'book', 'flexible', 'family', '02300', 'https://www.mfwbooks.com/item/02300/'),
  (22, 'Art', 'Acrylic Paint Set', null, 'supply', 'strict', 'family', '02654', 'https://www.mfwbooks.com/item/02654/'),
  (23, 'Art', 'I Can Do All Things Book Set', null, 'book', 'strict', 'family', '02650', 'https://www.mfwbooks.com/item/02650/'),
  (24, 'Art', 'I Can Do All Things DVDs', null, 'other', 'strict', 'family', '74119', 'https://www.mfwbooks.com/item/74119/'),
  (25, 'Online Music', 'Patriotic Songs of the U.S.A. (ONLINE)', null, 'digital', 'strict', 'family', '02600', 'https://www.mfwbooks.com/item/02600/');

insert into public.curriculum_materials (
  title,
  isbn,
  material_type,
  affiliate_url,
  affiliate_label
)
select
  source.title,
  source.isbn,
  source.material_type,
  source.affiliate_url,
  'My Father''s World'
from mfw_adventures_items source
where not exists (
  select 1
  from public.curriculum_materials material
  where (
    source.isbn is not null
    and upper(regexp_replace(material.isbn, '[^0-9X]', '', 'g')) = source.isbn
  ) or (
    source.isbn is null
    and lower(material.title) = lower(source.title)
  )
);

update public.curriculum_materials material
set affiliate_url = coalesce(material.affiliate_url, source.affiliate_url),
    affiliate_label = coalesce(material.affiliate_label, 'My Father''s World'),
    updated_at = now()
from mfw_adventures_items source
where (
  source.isbn is not null
  and upper(regexp_replace(material.isbn, '[^0-9X]', '', 'g')) = source.isbn
) or (
  source.isbn is null
  and lower(material.title) = lower(source.title)
);

insert into public.curriculum_package_items (
  package_id,
  material_id,
  group_label,
  requirement_type,
  compatibility_mode,
  quantity,
  audience,
  notes,
  sort_order
)
select
  package.id,
  material.id,
  source.group_label,
  'required',
  source.compatibility_mode,
  1,
  source.audience,
  'MFW item ' || source.item_number || '. Included in publisher package verified 2026-07-19.',
  source.sort_order
from mfw_adventures_items source
cross join lateral (
  select candidate.id
  from public.curriculum_materials candidate
  where (
    source.isbn is not null
    and upper(regexp_replace(candidate.isbn, '[^0-9X]', '', 'g')) = source.isbn
  ) or (
    source.isbn is null
    and lower(candidate.title) = lower(source.title)
  )
  order by candidate.created_at
  limit 1
) material
join public.curriculum_publishers publisher
  on publisher.name = 'My Father''s World'
join public.curriculum_packages package
  on package.publisher_id = publisher.id
 and package.name = 'Adventures in U.S. History Package'
 and package.grade_level = '2nd Grade'
 and package.edition_label = 'Current package'
on conflict (package_id, material_id) do update
set group_label = excluded.group_label,
    requirement_type = excluded.requirement_type,
    compatibility_mode = excluded.compatibility_mode,
    quantity = excluded.quantity,
    audience = excluded.audience,
    notes = excluded.notes,
    sort_order = excluded.sort_order;

commit;
