begin;

-- This ISBN belongs to the Beta instructional DVD. The shorter title made the
-- inventory record look like a student book in curriculum matching results.
update public.items
set title = 'Beta DVD',
    updated_at = now()
where curriculum = 'Math-U-See'
  and lower(trim(title)) = 'beta'
  and upper(regexp_replace(coalesce(isbn, ''), '[^0-9X]', '', 'g')) = '9781608260102';

insert into public.curriculum_publishers (name, website_url)
values ('Math-U-See', 'https://store.demmelearning.com/pages/math-u-see')
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
  'Beta Complete Level',
  'subject',
  'Placement-based',
  'Math',
  'US Edition',
  'Complete Math-U-See Beta level using the physical instructional DVD option. Includes instructor materials, student consumables, and the Integer Block Kit.',
  'https://store.demmelearning.com/products/beta-set',
  date '2026-07-19',
  'draft'
from public.curriculum_publishers publisher
where publisher.name = 'Math-U-See'
  and not exists (
    select 1
    from public.curriculum_packages package
    where package.publisher_id = publisher.id
      and package.name = 'Beta Complete Level'
      and package.edition_label = 'US Edition'
  );

create temporary table math_u_see_beta_items (
  sort_order integer not null,
  group_label text not null,
  title text not null,
  isbn text,
  material_type text not null,
  audience text not null,
  affiliate_url text not null,
  notes text not null
) on commit drop;

insert into math_u_see_beta_items values
  (0, 'Instructor Materials', 'Beta Instruction Manual', '9781608260805', 'teacher', 'teacher', 'https://store.demmelearning.com/products/beta-instruction-manual', 'Required instruction manual with solutions.'),
  (1, 'Instructor Materials', 'Beta DVD', '9781608260102', 'digital', 'family', 'https://store.demmelearning.com/products/beta-dvd', 'Physical instructional video option; publisher also offers streaming access.'),
  (2, 'Student Materials', 'Beta Student Workbook', '9781608260676', 'workbook', 'student', 'https://store.demmelearning.com/products/beta-student-workbook-and-tests', 'Required consumable student workbook; verify that a used copy is clean and usable.'),
  (3, 'Student Materials', 'Beta Tests', '9781608260737', 'test', 'student', 'https://store.demmelearning.com/products/beta-student-workbook-and-tests', 'Required consumable tests booklet; verify that a used copy is clean and usable.'),
  (4, 'Manipulatives', 'Math-U-See Integer Block Kit', null, 'supply', 'family', 'https://store.demmelearning.com/collections/all-pre-algebra/products/integer-block-kit', 'Required 133-piece manipulative kit used across several Math-U-See levels.');

insert into public.curriculum_materials (
  title,
  isbn,
  edition_label,
  material_type,
  affiliate_url,
  affiliate_label
)
select
  source.title,
  source.isbn,
  'US Edition',
  source.material_type,
  source.affiliate_url,
  'Demme Learning'
from math_u_see_beta_items source
where not exists (
  select 1
  from public.curriculum_materials material
  where (
    source.isbn is not null
    and upper(regexp_replace(coalesce(material.isbn, ''), '[^0-9X]', '', 'g')) = source.isbn
  ) or (
    source.isbn is null
    and lower(material.title) = lower(source.title)
  )
);

update public.curriculum_materials material
set affiliate_url = source.affiliate_url,
    affiliate_label = 'Demme Learning',
    edition_label = coalesce(material.edition_label, 'US Edition'),
    updated_at = now()
from math_u_see_beta_items source
where (
  source.isbn is not null
  and upper(regexp_replace(coalesce(material.isbn, ''), '[^0-9X]', '', 'g')) = source.isbn
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
  'strict',
  1,
  source.audience,
  source.notes || ' Publisher list verified 2026-07-19.',
  source.sort_order
from math_u_see_beta_items source
cross join lateral (
  select candidate.id
  from public.curriculum_materials candidate
  where (
    source.isbn is not null
    and upper(regexp_replace(coalesce(candidate.isbn, ''), '[^0-9X]', '', 'g')) = source.isbn
  ) or (
    source.isbn is null
    and lower(candidate.title) = lower(source.title)
  )
  order by candidate.created_at
  limit 1
) material
join public.curriculum_publishers publisher
  on publisher.name = 'Math-U-See'
join public.curriculum_packages package
  on package.publisher_id = publisher.id
 and package.name = 'Beta Complete Level'
 and package.edition_label = 'US Edition'
on conflict (package_id, material_id) do update
set group_label = excluded.group_label,
    requirement_type = excluded.requirement_type,
    compatibility_mode = excluded.compatibility_mode,
    quantity = excluded.quantity,
    audience = excluded.audience,
    notes = excluded.notes,
    sort_order = excluded.sort_order;

commit;
