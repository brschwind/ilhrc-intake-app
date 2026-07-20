create table if not exists public.curriculum_publishers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  website_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (name)
);

create table if not exists public.curriculum_packages (
  id uuid primary key default gen_random_uuid(),
  publisher_id uuid references public.curriculum_publishers(id) on delete set null,
  name text not null,
  package_type text not null default 'grade' check (package_type in ('grade', 'subject', 'family', 'unit', 'age_band', 'student', 'custom')),
  grade_level text,
  subject text,
  edition_label text,
  description text,
  source_url text,
  source_checked_on date,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  sort_order integer not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.curriculum_materials (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  author text,
  publisher text,
  isbn text,
  acceptable_isbns text[] not null default '{}',
  edition_label text,
  material_type text not null default 'book' check (material_type in ('book', 'teacher', 'student', 'answer_key', 'test', 'workbook', 'digital', 'supply', 'other')),
  affiliate_url text,
  affiliate_label text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists curriculum_materials_normalized_isbn_unique
on public.curriculum_materials ((upper(regexp_replace(isbn, '[^0-9X]', '', 'g'))))
where nullif(regexp_replace(isbn, '[^0-9X]', '', 'g'), '') is not null;

create table if not exists public.curriculum_package_items (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references public.curriculum_packages(id) on delete cascade,
  material_id uuid not null references public.curriculum_materials(id) on delete restrict,
  group_label text,
  requirement_type text not null default 'required' check (requirement_type in ('required', 'optional', 'choice')),
  compatibility_mode text not null default 'strict' check (compatibility_mode in ('strict', 'flexible')),
  quantity integer not null default 1 check (quantity > 0),
  audience text not null default 'family' check (audience in ('family', 'student', 'teacher', 'age_band')),
  notes text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (package_id, material_id)
);

create table if not exists public.curriculum_package_inclusions (
  parent_package_id uuid not null references public.curriculum_packages(id) on delete cascade,
  child_package_id uuid not null references public.curriculum_packages(id) on delete cascade,
  sort_order integer not null default 0,
  primary key (parent_package_id, child_package_id),
  check (parent_package_id <> child_package_id)
);

create or replace view public.public_curriculum_packages
with (security_invoker = true)
as
select
  p.id,
  p.name,
  p.package_type,
  p.grade_level,
  p.subject,
  p.edition_label,
  p.description,
  p.source_url,
  p.source_checked_on,
  p.sort_order,
  pub.id as publisher_id,
  pub.name as publisher_name,
  pub.website_url as publisher_website_url
from public.curriculum_packages p
left join public.curriculum_publishers pub on pub.id = p.publisher_id
where p.status = 'published';

alter table public.curriculum_publishers enable row level security;
alter table public.curriculum_packages enable row level security;
alter table public.curriculum_materials enable row level security;
alter table public.curriculum_package_items enable row level security;
alter table public.curriculum_package_inclusions enable row level security;

drop policy if exists "curriculum publishers public read" on public.curriculum_publishers;
create policy "curriculum publishers public read" on public.curriculum_publishers
for select to anon, authenticated using (true);

drop policy if exists "curriculum publishers staff write" on public.curriculum_publishers;
create policy "curriculum publishers staff write" on public.curriculum_publishers
for all to authenticated using (public.current_profile_is_active()) with check (public.current_profile_is_active());

drop policy if exists "curriculum packages public read" on public.curriculum_packages;
create policy "curriculum packages public read" on public.curriculum_packages
for select to anon, authenticated using (status = 'published' or public.current_profile_is_active());

drop policy if exists "curriculum packages staff write" on public.curriculum_packages;
create policy "curriculum packages staff write" on public.curriculum_packages
for all to authenticated using (public.current_profile_is_active()) with check (public.current_profile_is_active());

drop policy if exists "curriculum materials public read" on public.curriculum_materials;
create policy "curriculum materials public read" on public.curriculum_materials
for select to anon, authenticated using (
  public.current_profile_is_active() or exists (
    select 1 from public.curriculum_package_items pi
    join public.curriculum_packages p on p.id = pi.package_id
    where pi.material_id = curriculum_materials.id and p.status = 'published'
  )
);

drop policy if exists "curriculum materials staff write" on public.curriculum_materials;
create policy "curriculum materials staff write" on public.curriculum_materials
for all to authenticated using (public.current_profile_is_active()) with check (public.current_profile_is_active());

drop policy if exists "curriculum package items public read" on public.curriculum_package_items;
create policy "curriculum package items public read" on public.curriculum_package_items
for select to anon, authenticated using (
  exists (select 1 from public.curriculum_packages p where p.id = package_id and (p.status = 'published' or public.current_profile_is_active()))
);

drop policy if exists "curriculum package items staff write" on public.curriculum_package_items;
create policy "curriculum package items staff write" on public.curriculum_package_items
for all to authenticated using (public.current_profile_is_active()) with check (public.current_profile_is_active());

drop policy if exists "curriculum inclusions public read" on public.curriculum_package_inclusions;
create policy "curriculum inclusions public read" on public.curriculum_package_inclusions
for select to anon, authenticated using (
  exists (select 1 from public.curriculum_packages p where p.id = parent_package_id and (p.status = 'published' or public.current_profile_is_active()))
);

drop policy if exists "curriculum inclusions staff write" on public.curriculum_package_inclusions;
create policy "curriculum inclusions staff write" on public.curriculum_package_inclusions
for all to authenticated using (public.current_profile_is_active()) with check (public.current_profile_is_active());

grant select on public.public_curriculum_packages to anon, authenticated;
grant select on public.curriculum_publishers, public.curriculum_packages, public.curriculum_materials, public.curriculum_package_items, public.curriculum_package_inclusions to anon, authenticated;
grant insert, update, delete on public.curriculum_publishers, public.curriculum_packages, public.curriculum_materials, public.curriculum_package_items, public.curriculum_package_inclusions to authenticated;
