-- IL HRC Connections: Milestone 1 database and security foundation.
-- This migration is additive and intentionally does not modify inventory,
-- bookstore, Square, OpenAI, authentication, or existing public catalog data.

create table public.connection_categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  name text not null,
  description text not null default '',
  sort_order smallint not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint connection_categories_slug_format check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

create unique index connection_categories_slug_uidx
on public.connection_categories (lower(slug));

create unique index connection_categories_name_uidx
on public.connection_categories (lower(name));

create table public.connection_tags (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  label text not null,
  tag_group text not null check (tag_group in ('audience', 'program_feature', 'schedule')),
  sort_order smallint not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint connection_tags_slug_format check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

create unique index connection_tags_slug_uidx on public.connection_tags (lower(slug));
create unique index connection_tags_label_uidx on public.connection_tags (lower(label));

create table public.connection_resources (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  name text not null,
  short_description text not null default '',
  description text not null default '',
  worldview text not null default 'information_not_provided'
    check (worldview in ('christian', 'faith_based_other', 'secular', 'no_stated_religious_affiliation', 'information_not_provided')),
  worldview_details text not null default '',
  age_min smallint,
  age_max smallint,
  grade_min smallint,
  grade_max smallint,
  age_grade_notes text not null default '',
  delivery_mode text not null default 'in_person'
    check (delivery_mode in ('in_person', 'online', 'hybrid')),
  accepting_status text not null default 'unknown'
    check (accepting_status in ('accepting', 'waitlist', 'closed', 'unknown')),
  cost_type text not null default 'contact'
    check (cost_type in ('free', 'paid', 'variable', 'contact')),
  homeschool_specific boolean not null default false,
  daytime_available boolean not null default false,
  homeschool_discount boolean not null default false,
  service_area_summary text not null default '',
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint connection_resources_slug_format check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint connection_resources_name_present check (length(trim(name)) >= 2),
  constraint connection_resources_age_min_range check (age_min is null or age_min between 0 and 120),
  constraint connection_resources_age_max_range check (age_max is null or age_max between 0 and 120),
  constraint connection_resources_age_order check (age_min is null or age_max is null or age_min <= age_max),
  constraint connection_resources_grade_min_range check (grade_min is null or grade_min between -1 and 12),
  constraint connection_resources_grade_max_range check (grade_max is null or grade_max between -1 and 12),
  constraint connection_resources_grade_order check (grade_min is null or grade_max is null or grade_min <= grade_max)
);

create unique index connection_resources_slug_uidx on public.connection_resources (lower(slug));
create index connection_resources_name_idx on public.connection_resources (lower(name));

create table public.connection_resource_governance (
  resource_id uuid primary key references public.connection_resources(id) on delete restrict,
  review_status text not null default 'draft'
    check (review_status in ('draft', 'submitted', 'under_review', 'needs_information', 'ready_for_decision')),
  decision_status text not null default 'pending'
    check (decision_status in ('pending', 'approved', 'declined')),
  publication_state text not null default 'unpublished'
    check (publication_state in ('unpublished', 'published', 'paused', 'archived')),
  requested_visibility text not null default 'public'
    check (requested_visibility in ('public', 'limited', 'private_referral', 'temporarily_hidden')),
  approved_visibility text
    check (approved_visibility is null or approved_visibility in ('public', 'limited', 'private_referral', 'temporarily_hidden')),
  geographic_scope text not null default 'corridor'
    check (geographic_scope in ('core_county', 'corridor', 'regional_exception', 'statewide', 'national_online')),
  geographic_exception_reason text not null default '',
  stable_resource_confirmed boolean not null default false,
  last_verified_on date,
  verification_due_on date,
  director_decision_by uuid references auth.users(id) on delete set null,
  director_decision_at timestamptz,
  published_by uuid references auth.users(id) on delete set null,
  published_at timestamptz,
  pause_reason text not null default '',
  paused_by uuid references auth.users(id) on delete set null,
  paused_at timestamptz,
  archived_by uuid references auth.users(id) on delete set null,
  archived_at timestamptz,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint connection_governance_verification_dates check (
    verification_due_on is null or last_verified_on is not null
  ),
  constraint connection_governance_exception_reason check (
    geographic_scope <> 'regional_exception' or length(trim(geographic_exception_reason)) > 0
  )
);

create index connection_governance_review_queue_idx
on public.connection_resource_governance (review_status, updated_at desc);

create index connection_governance_decision_queue_idx
on public.connection_resource_governance (decision_status, review_status, updated_at desc);

create index connection_governance_publication_idx
on public.connection_resource_governance (publication_state, approved_visibility);

create index connection_governance_verification_due_idx
on public.connection_resource_governance (verification_due_on)
where decision_status = 'approved' and publication_state in ('published', 'paused');

create table public.connection_resource_categories (
  resource_id uuid not null references public.connection_resources(id) on delete cascade,
  category_id uuid not null references public.connection_categories(id) on delete restrict,
  is_primary boolean not null default false,
  sort_order smallint not null default 0,
  created_at timestamptz not null default now(),
  primary key (resource_id, category_id)
);

create unique index connection_resource_primary_category_uidx
on public.connection_resource_categories (resource_id)
where is_primary = true;

create index connection_resource_categories_category_idx
on public.connection_resource_categories (category_id, resource_id);

create table public.connection_resource_tags (
  resource_id uuid not null references public.connection_resources(id) on delete cascade,
  tag_id uuid not null references public.connection_tags(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (resource_id, tag_id)
);

create index connection_resource_tags_tag_idx
on public.connection_resource_tags (tag_id, resource_id);

create table public.connection_locations (
  id uuid primary key default gen_random_uuid(),
  resource_id uuid not null references public.connection_resources(id) on delete cascade,
  name text not null default '',
  location_kind text not null default 'physical'
    check (location_kind in ('physical', 'service_area', 'online')),
  address_line_1 text not null default '',
  address_line_2 text not null default '',
  city text not null default '',
  county text not null default '',
  state text not null default 'IL',
  postal_code text not null default '',
  service_area text not null default '',
  address_display text not null default 'town_only'
    check (address_display in ('full', 'town_only', 'none')),
  address_consent_status text not null default 'not_requested'
    check (address_consent_status in ('not_requested', 'granted', 'denied', 'withdrawn')),
  address_consented_by_name text not null default '',
  address_consented_at timestamptz,
  address_consent_method text
    check (address_consent_method is null or address_consent_method in ('written', 'phone', 'in_person')),
  is_primary boolean not null default false,
  sort_order smallint not null default 0,
  archived_at timestamptz,
  archived_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint connection_locations_full_address_consent check (
    address_display <> 'full' or address_consent_status = 'granted'
  ),
  constraint connection_locations_consent_evidence check (
    address_consent_status <> 'granted'
    or (length(trim(address_consented_by_name)) >= 2 and address_consented_at is not null and address_consent_method is not null)
  ),
  unique (id, resource_id)
);

create unique index connection_locations_primary_uidx
on public.connection_locations (resource_id)
where is_primary = true;

create index connection_locations_resource_idx
on public.connection_locations (resource_id, sort_order);

create index connection_locations_geography_idx
on public.connection_locations (lower(county), lower(city));

create table public.connection_contact_methods (
  id uuid primary key default gen_random_uuid(),
  resource_id uuid not null references public.connection_resources(id) on delete cascade,
  location_id uuid,
  kind text not null check (kind in ('email', 'phone', 'website', 'facebook', 'contact_form', 'other_url')),
  label text not null default '',
  value text not null,
  is_personal boolean not null default false,
  intended_use text not null default 'public_direct'
    check (intended_use in ('public_direct', 'ilhrc_mediated', 'private_referral')),
  consent_status text not null default 'not_requested'
    check (consent_status in ('not_requested', 'granted', 'denied', 'withdrawn')),
  consented_by_name text not null default '',
  consented_at timestamptz,
  consent_method text
    check (consent_method is null or consent_method in ('written', 'phone', 'in_person')),
  revoked_at timestamptz,
  sort_order smallint not null default 0,
  archived_at timestamptz,
  archived_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint connection_contact_value_present check (length(trim(value)) > 0),
  constraint connection_contact_location_owner foreign key (location_id, resource_id)
    references public.connection_locations(id, resource_id) on delete restrict,
  constraint connection_contact_consent_evidence check (
    consent_status <> 'granted'
    or (length(trim(consented_by_name)) >= 2 and consented_at is not null and consent_method is not null)
  )
);

create unique index connection_contact_methods_value_uidx
on public.connection_contact_methods (
  resource_id,
  coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid),
  kind,
  lower(value)
)
where revoked_at is null;

create index connection_contact_methods_resource_idx
on public.connection_contact_methods (resource_id, sort_order);

create table public.connection_visibility_consents (
  id uuid primary key default gen_random_uuid(),
  resource_id uuid not null references public.connection_resources(id) on delete restrict,
  visibility text not null
    check (visibility in ('public', 'limited', 'private_referral', 'temporarily_hidden')),
  consented_by_name text not null,
  contact_role text not null default '',
  consent_method text not null check (consent_method in ('written', 'phone', 'in_person')),
  consented_at timestamptz not null,
  withdrawn_at timestamptz,
  recorded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint connection_visibility_consent_name_present check (length(trim(consented_by_name)) >= 2)
);

create unique index connection_visibility_active_consent_uidx
on public.connection_visibility_consents (resource_id)
where withdrawn_at is null;

create table public.connection_verifications (
  id uuid primary key default gen_random_uuid(),
  resource_id uuid not null references public.connection_resources(id) on delete restrict,
  verified_on date not null,
  next_due_on date,
  method text not null check (method in ('phone', 'in_person')),
  responsible_contact_name text not null,
  performed_by uuid not null references auth.users(id) on delete restrict,
  outcome text not null check (outcome in ('verified', 'changes_required', 'unconfirmed', 'closed')),
  visibility_confirmed text
    check (visibility_confirmed is null or visibility_confirmed in ('public', 'limited', 'private_referral', 'temporarily_hidden')),
  notes text not null default '',
  created_at timestamptz not null default now(),
  constraint connection_verification_contact_present check (length(trim(responsible_contact_name)) >= 2),
  constraint connection_verification_due_required check (
    (outcome = 'verified' and next_due_on is not null)
    or (outcome <> 'verified' and next_due_on is null)
  )
);

create index connection_verifications_resource_idx
on public.connection_verifications (resource_id, verified_on desc, created_at desc);

create table public.connection_internal_notes (
  id uuid primary key default gen_random_uuid(),
  resource_id uuid not null references public.connection_resources(id) on delete restrict,
  body text not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  redacted_at timestamptz,
  redacted_by uuid references auth.users(id) on delete set null,
  constraint connection_internal_note_present check (length(trim(body)) > 0)
);

create index connection_internal_notes_resource_idx
on public.connection_internal_notes (resource_id, created_at desc);

create table public.connection_activity (
  id uuid primary key default gen_random_uuid(),
  resource_id uuid references public.connection_resources(id) on delete restrict,
  entity_type text not null,
  entity_id uuid,
  event_type text not null,
  actor_id uuid references auth.users(id) on delete set null,
  from_state jsonb not null default '{}'::jsonb,
  to_state jsonb not null default '{}'::jsonb,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index connection_activity_resource_idx
on public.connection_activity (resource_id, created_at desc);

create index connection_activity_entity_idx
on public.connection_activity (entity_type, entity_id, created_at desc);

create or replace function public.touch_connection_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end
$$;

create trigger connection_categories_touch_updated_at
before update on public.connection_categories
for each row execute function public.touch_connection_updated_at();

create trigger connection_tags_touch_updated_at
before update on public.connection_tags
for each row execute function public.touch_connection_updated_at();

create trigger connection_resources_touch_updated_at
before update on public.connection_resources
for each row execute function public.touch_connection_updated_at();

create trigger connection_locations_touch_updated_at
before update on public.connection_locations
for each row execute function public.touch_connection_updated_at();

create trigger connection_contact_methods_touch_updated_at
before update on public.connection_contact_methods
for each row execute function public.touch_connection_updated_at();

create or replace function public.create_connection_resource_governance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.connection_resource_governance (resource_id, updated_by)
  values (new.id, coalesce(new.created_by, auth.uid()));
  return new;
end
$$;

create trigger connection_resources_create_governance
after insert on public.connection_resources
for each row execute function public.create_connection_resource_governance();

create or replace function public.prevent_published_connection_slug_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.slug is distinct from old.slug
    and exists (
      select 1 from public.connection_resource_governance governance
      where governance.resource_id = old.id and governance.published_at is not null
    )
  then
    raise exception 'Published Connections slugs are stable and cannot be changed.';
  end if;
  return new;
end
$$;

create trigger connection_resources_preserve_published_slug
before update of slug on public.connection_resources
for each row execute function public.prevent_published_connection_slug_change();

create or replace function public.reopen_connection_review_after_content_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  row_data jsonb;
  changed_resource_id uuid;
  previous_governance public.connection_resource_governance%rowtype;
  updated_governance public.connection_resource_governance%rowtype;
begin
  row_data := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  changed_resource_id := coalesce(
    nullif(row_data->>'resource_id', '')::uuid,
    nullif(row_data->>'id', '')::uuid
  );

  select * into previous_governance
  from public.connection_resource_governance
  where resource_id = changed_resource_id
    and (decision_status = 'approved' or publication_state in ('published', 'paused'))
  for update;

  if found then
    update public.connection_resource_governance
    set review_status = 'under_review',
        decision_status = 'pending',
        publication_state = case
          when previous_governance.publication_state in ('published', 'paused') then 'paused'
          else 'unpublished'
        end,
        approved_visibility = null,
        pause_reason = 'Listing content changed after approval; director reapproval is required.',
        paused_by = auth.uid(),
        paused_at = now(),
        updated_by = auth.uid(),
        updated_at = now()
    where resource_id = changed_resource_id
    returning * into updated_governance;

    insert into public.connection_activity (
      resource_id, entity_type, entity_id, event_type, actor_id, from_state, to_state, details
    ) values (
      changed_resource_id, tg_table_name, changed_resource_id,
      'approved_content_changed', auth.uid(),
      jsonb_build_object(
        'decision_status', previous_governance.decision_status,
        'publication_state', previous_governance.publication_state
      ),
      jsonb_build_object(
        'decision_status', updated_governance.decision_status,
        'publication_state', updated_governance.publication_state,
        'review_status', updated_governance.review_status
      ),
      jsonb_build_object('operation', lower(tg_op))
    );
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end
$$;

create trigger connection_resources_reopen_review
after update on public.connection_resources
for each row execute function public.reopen_connection_review_after_content_change();

create trigger connection_resource_categories_reopen_review
after insert or update or delete on public.connection_resource_categories
for each row execute function public.reopen_connection_review_after_content_change();

create trigger connection_resource_tags_reopen_review
after insert or update or delete on public.connection_resource_tags
for each row execute function public.reopen_connection_review_after_content_change();

create trigger connection_locations_reopen_review
after insert or update or delete on public.connection_locations
for each row execute function public.reopen_connection_review_after_content_change();

create trigger connection_contact_methods_reopen_review
after insert or update or delete on public.connection_contact_methods
for each row execute function public.reopen_connection_review_after_content_change();

insert into public.connection_categories (slug, name, sort_order)
values
  ('co-ops-groups-community', 'Co-ops, Groups & Community', 10),
  ('classes-tutors-academic-support', 'Classes, Tutors & Academic Support', 20),
  ('arts-music-enrichment', 'Arts, Music & Enrichment', 30),
  ('sports-clubs-activities', 'Sports, Clubs & Activities', 40),
  ('field-trips-museums-attractions', 'Field Trips, Museums & Attractions', 50),
  ('camps-seasonal-programs', 'Camps & Seasonal Programs', 60),
  ('special-needs-therapy-family-support', 'Special Needs, Therapy & Family Support', 70),
  ('college-career-dual-enrollment', 'College, Career & Dual Enrollment', 80),
  ('curriculum-books-homeschool-services', 'Curriculum, Books & Homeschool Services', 90),
  ('homeschool-friendly-businesses', 'Homeschool-Friendly Businesses', 100)
on conflict (lower(slug)) do update
set name = excluded.name,
    sort_order = excluded.sort_order,
    active = true,
    updated_at = now();

alter table public.connection_categories enable row level security;
alter table public.connection_tags enable row level security;
alter table public.connection_resources enable row level security;
alter table public.connection_resource_governance enable row level security;
alter table public.connection_resource_categories enable row level security;
alter table public.connection_resource_tags enable row level security;
alter table public.connection_locations enable row level security;
alter table public.connection_contact_methods enable row level security;
alter table public.connection_visibility_consents enable row level security;
alter table public.connection_verifications enable row level security;
alter table public.connection_internal_notes enable row level security;
alter table public.connection_activity enable row level security;

revoke all on public.connection_categories from anon, authenticated;
revoke all on public.connection_tags from anon, authenticated;
revoke all on public.connection_resources from anon, authenticated;
revoke all on public.connection_resource_governance from anon, authenticated;
revoke all on public.connection_resource_categories from anon, authenticated;
revoke all on public.connection_resource_tags from anon, authenticated;
revoke all on public.connection_locations from anon, authenticated;
revoke all on public.connection_contact_methods from anon, authenticated;
revoke all on public.connection_visibility_consents from anon, authenticated;
revoke all on public.connection_verifications from anon, authenticated;
revoke all on public.connection_internal_notes from anon, authenticated;
revoke all on public.connection_activity from anon, authenticated;

create policy "connection categories staff read"
on public.connection_categories for select to authenticated
using (public.current_profile_is_active());

create policy "connection categories admin manage"
on public.connection_categories for all to authenticated
using (public.current_profile_is_admin())
with check (public.current_profile_is_admin());

create policy "connection tags staff read"
on public.connection_tags for select to authenticated
using (public.current_profile_is_active());

create policy "connection tags admin manage"
on public.connection_tags for all to authenticated
using (public.current_profile_is_admin())
with check (public.current_profile_is_admin());

create policy "connection resources staff read"
on public.connection_resources for select to authenticated
using (public.current_profile_is_active());

create policy "connection resources staff insert"
on public.connection_resources for insert to authenticated
with check (public.current_profile_is_active() and created_by = auth.uid());

create policy "connection resources staff update"
on public.connection_resources for update to authenticated
using (public.current_profile_is_active())
with check (public.current_profile_is_active() and updated_by = auth.uid());

create policy "connection governance staff read"
on public.connection_resource_governance for select to authenticated
using (public.current_profile_is_active());

create policy "connection resource categories staff manage"
on public.connection_resource_categories for all to authenticated
using (public.current_profile_is_active())
with check (public.current_profile_is_active());

create policy "connection resource tags staff manage"
on public.connection_resource_tags for all to authenticated
using (public.current_profile_is_active())
with check (public.current_profile_is_active());

create policy "connection locations staff manage"
on public.connection_locations for all to authenticated
using (public.current_profile_is_active())
with check (public.current_profile_is_active());

create policy "connection contacts staff manage"
on public.connection_contact_methods for all to authenticated
using (public.current_profile_is_active())
with check (public.current_profile_is_active());

create policy "connection visibility consents staff read"
on public.connection_visibility_consents for select to authenticated
using (public.current_profile_is_active());

create policy "connection visibility consents staff insert"
on public.connection_visibility_consents for insert to authenticated
with check (public.current_profile_is_active() and recorded_by = auth.uid());

create policy "connection verifications staff read"
on public.connection_verifications for select to authenticated
using (public.current_profile_is_active());

create policy "connection notes staff read"
on public.connection_internal_notes for select to authenticated
using (public.current_profile_is_active());

create policy "connection notes staff insert"
on public.connection_internal_notes for insert to authenticated
with check (public.current_profile_is_active() and created_by = auth.uid());

create policy "connection activity staff read"
on public.connection_activity for select to authenticated
using (public.current_profile_is_active());

grant select on public.connection_resources to authenticated;
grant insert (
  slug, name, short_description, description, worldview, worldview_details,
  age_min, age_max, grade_min, grade_max, age_grade_notes, delivery_mode,
  accepting_status, cost_type, homeschool_specific, daytime_available,
  homeschool_discount, service_area_summary, created_by, updated_by
) on public.connection_resources to authenticated;
grant update (
  slug, name, short_description, description, worldview, worldview_details,
  age_min, age_max, grade_min, grade_max, age_grade_notes, delivery_mode,
  accepting_status, cost_type, homeschool_specific, daytime_available,
  homeschool_discount, service_area_summary, updated_by
) on public.connection_resources to authenticated;
grant select on public.connection_resource_governance to authenticated;
grant select, insert, update, delete on public.connection_resource_categories to authenticated;
grant select, insert, update, delete on public.connection_resource_tags to authenticated;
grant select, insert, update on public.connection_locations to authenticated;
grant select, insert, update on public.connection_contact_methods to authenticated;
grant select, insert on public.connection_visibility_consents to authenticated;
grant select on public.connection_verifications to authenticated;
grant select, insert on public.connection_internal_notes to authenticated;
grant select on public.connection_activity to authenticated;
grant select, insert, update, delete on public.connection_categories to authenticated;
grant select, insert, update, delete on public.connection_tags to authenticated;

create or replace view public.public_connection_categories
with (security_barrier = true)
as
select slug, name, description, sort_order
from public.connection_categories
where active = true;

create or replace view public.public_connection_tags
with (security_barrier = true)
as
select slug, label, tag_group, sort_order
from public.connection_tags
where active = true;

create or replace view public.public_connections_directory
with (security_barrier = true)
as
select
  resource.slug,
  resource.name,
  resource.short_description,
  resource.description,
  resource.worldview,
  resource.worldview_details,
  resource.age_min,
  resource.age_max,
  resource.grade_min,
  resource.grade_max,
  resource.age_grade_notes,
  resource.delivery_mode,
  resource.accepting_status,
  resource.cost_type,
  resource.homeschool_specific,
  resource.daytime_available,
  resource.homeschool_discount,
  resource.service_area_summary,
  governance.approved_visibility as visibility,
  governance.last_verified_on,
  primary_category.slug as primary_category_slug,
  primary_category.name as primary_category_name,
  primary_location.city as primary_city,
  primary_location.county as primary_county,
  array(
    select category.slug
    from public.connection_resource_categories resource_category
    join public.connection_categories category on category.id = resource_category.category_id
    where resource_category.resource_id = resource.id and category.active = true
    order by resource_category.is_primary desc, resource_category.sort_order, category.sort_order, category.name
  ) as category_slugs,
  array(
    select tag.slug
    from public.connection_resource_tags resource_tag
    join public.connection_tags tag on tag.id = resource_tag.tag_id
    where resource_tag.resource_id = resource.id and tag.active = true
    order by tag.sort_order, tag.label
  ) as tag_slugs,
  resource.updated_at
from public.connection_resources resource
join public.connection_resource_governance governance on governance.resource_id = resource.id
left join lateral (
  select category.slug, category.name
  from public.connection_resource_categories resource_category
  join public.connection_categories category on category.id = resource_category.category_id
  where resource_category.resource_id = resource.id
    and resource_category.is_primary = true
    and category.active = true
  limit 1
) primary_category on true
left join lateral (
  select location.city, location.county
  from public.connection_locations location
  where location.resource_id = resource.id and location.is_primary = true and location.archived_at is null
  limit 1
) primary_location on true
where governance.decision_status = 'approved'
  and governance.publication_state = 'published'
  and governance.approved_visibility in ('public', 'limited')
  and governance.last_verified_on >= current_date - interval '1 year'
  and governance.archived_at is null
  and exists (
    select 1 from public.connection_visibility_consents visibility_consent
    where visibility_consent.resource_id = resource.id
      and visibility_consent.visibility = governance.approved_visibility
      and visibility_consent.withdrawn_at is null
  );

create or replace view public.public_connection_locations
with (security_barrier = true)
as
select
  resource.slug as resource_slug,
  location.name,
  location.location_kind,
  case
    when governance.approved_visibility = 'public'
      and location.address_display = 'full'
      and location.address_consent_status = 'granted'
    then location.address_line_1
    else ''
  end as address_line_1,
  case
    when governance.approved_visibility = 'public'
      and location.address_display = 'full'
      and location.address_consent_status = 'granted'
    then location.address_line_2
    else ''
  end as address_line_2,
  case when location.address_display <> 'none' then location.city else '' end as city,
  case when location.address_display <> 'none' then location.county else '' end as county,
  case when location.address_display <> 'none' then location.state else '' end as state,
  case
    when governance.approved_visibility = 'public'
      and location.address_display = 'full'
      and location.address_consent_status = 'granted'
    then location.postal_code
    else ''
  end as postal_code,
  location.service_area,
  location.is_primary,
  location.sort_order
from public.connection_locations location
join public.connection_resources resource on resource.id = location.resource_id
join public.connection_resource_governance governance on governance.resource_id = resource.id
where governance.decision_status = 'approved'
  and governance.publication_state = 'published'
  and governance.approved_visibility in ('public', 'limited')
  and governance.last_verified_on >= current_date - interval '1 year'
  and governance.archived_at is null
  and exists (
    select 1 from public.connection_visibility_consents visibility_consent
    where visibility_consent.resource_id = resource.id
      and visibility_consent.visibility = governance.approved_visibility
      and visibility_consent.withdrawn_at is null
  )
  and location.archived_at is null;

create or replace view public.public_connection_contacts
with (security_barrier = true)
as
select
  resource.slug as resource_slug,
  location.name as location_name,
  contact.kind,
  contact.label,
  contact.value,
  contact.sort_order
from public.connection_contact_methods contact
join public.connection_resources resource on resource.id = contact.resource_id
join public.connection_resource_governance governance on governance.resource_id = resource.id
left join public.connection_locations location on location.id = contact.location_id
where governance.decision_status = 'approved'
  and governance.publication_state = 'published'
  and governance.approved_visibility in ('public', 'limited')
  and governance.last_verified_on >= current_date - interval '1 year'
  and governance.archived_at is null
  and exists (
    select 1 from public.connection_visibility_consents visibility_consent
    where visibility_consent.resource_id = resource.id
      and visibility_consent.visibility = governance.approved_visibility
      and visibility_consent.withdrawn_at is null
  )
  and contact.intended_use = 'public_direct'
  and contact.consent_status = 'granted'
  and contact.revoked_at is null
  and contact.archived_at is null
  and (governance.approved_visibility = 'public' or contact.is_personal = false);

revoke all on public.public_connection_categories from public, anon, authenticated;
revoke all on public.public_connection_tags from public, anon, authenticated;
revoke all on public.public_connections_directory from public, anon, authenticated;
revoke all on public.public_connection_locations from public, anon, authenticated;
revoke all on public.public_connection_contacts from public, anon, authenticated;

grant select on public.public_connection_categories to anon, authenticated;
grant select on public.public_connection_tags to anon, authenticated;
grant select on public.public_connections_directory to anon, authenticated;
grant select on public.public_connection_locations to anon, authenticated;
grant select on public.public_connection_contacts to anon, authenticated;

create or replace function public.set_connection_review_status(
  p_resource_id uuid,
  p_review_status text
)
returns public.connection_resource_governance
language plpgsql
security definer
set search_path = public
as $$
declare
  previous_governance public.connection_resource_governance%rowtype;
  updated_governance public.connection_resource_governance%rowtype;
begin
  if not public.current_profile_is_active() then
    raise exception 'Active staff access is required.';
  end if;
  if p_review_status not in ('draft', 'submitted', 'under_review', 'needs_information', 'ready_for_decision') then
    raise exception 'Invalid Connections review status.';
  end if;

  select * into previous_governance
  from public.connection_resource_governance
  where resource_id = p_resource_id
  for update;

  if not found then raise exception 'Connections resource not found.'; end if;
  if previous_governance.decision_status <> 'pending'
    or previous_governance.publication_state not in ('unpublished', 'paused')
  then
    raise exception 'A decided or published resource cannot return to staff review.';
  end if;

  update public.connection_resource_governance
  set review_status = p_review_status,
      updated_by = auth.uid(),
      updated_at = now()
  where resource_id = p_resource_id
  returning * into updated_governance;

  insert into public.connection_activity (
    resource_id, entity_type, entity_id, event_type, actor_id, from_state, to_state
  ) values (
    p_resource_id, 'resource_governance', p_resource_id, 'review_status_changed', auth.uid(),
    jsonb_build_object('review_status', previous_governance.review_status),
    jsonb_build_object('review_status', updated_governance.review_status)
  );

  return updated_governance;
end
$$;

create or replace function public.update_connection_review_controls(
  p_resource_id uuid,
  p_requested_visibility text,
  p_geographic_scope text,
  p_geographic_exception_reason text,
  p_stable_resource_confirmed boolean
)
returns public.connection_resource_governance
language plpgsql
security definer
set search_path = public
as $$
declare
  previous_governance public.connection_resource_governance%rowtype;
  updated_governance public.connection_resource_governance%rowtype;
begin
  if not public.current_profile_is_active() then
    raise exception 'Active staff access is required.';
  end if;
  if p_requested_visibility not in ('public', 'limited', 'private_referral', 'temporarily_hidden') then
    raise exception 'Invalid requested visibility.';
  end if;
  if p_geographic_scope not in ('core_county', 'corridor', 'regional_exception', 'statewide', 'national_online') then
    raise exception 'Invalid geographic scope.';
  end if;
  if p_geographic_scope = 'regional_exception'
    and length(trim(coalesce(p_geographic_exception_reason, ''))) < 3
  then
    raise exception 'A geographic exception reason is required.';
  end if;

  select * into previous_governance
  from public.connection_resource_governance
  where resource_id = p_resource_id
  for update;

  if not found then raise exception 'Connections resource not found.'; end if;
  if previous_governance.decision_status <> 'pending'
    or previous_governance.publication_state not in ('unpublished', 'paused')
  then
    raise exception 'Review controls cannot change after a publication decision.';
  end if;

  update public.connection_resource_governance
  set requested_visibility = p_requested_visibility,
      geographic_scope = p_geographic_scope,
      geographic_exception_reason = case
        when p_geographic_scope = 'regional_exception' then left(trim(p_geographic_exception_reason), 2000)
        else ''
      end,
      stable_resource_confirmed = coalesce(p_stable_resource_confirmed, false),
      updated_by = auth.uid(),
      updated_at = now()
  where resource_id = p_resource_id
  returning * into updated_governance;

  insert into public.connection_activity (
    resource_id, entity_type, entity_id, event_type, actor_id, from_state, to_state
  ) values (
    p_resource_id, 'resource_governance', p_resource_id, 'review_controls_updated', auth.uid(),
    jsonb_build_object(
      'requested_visibility', previous_governance.requested_visibility,
      'geographic_scope', previous_governance.geographic_scope,
      'stable_resource_confirmed', previous_governance.stable_resource_confirmed
    ),
    jsonb_build_object(
      'requested_visibility', updated_governance.requested_visibility,
      'geographic_scope', updated_governance.geographic_scope,
      'stable_resource_confirmed', updated_governance.stable_resource_confirmed
    )
  );

  return updated_governance;
end
$$;

create or replace function public.withdraw_connection_visibility_consent(
  p_consent_id uuid
)
returns public.connection_visibility_consents
language plpgsql
security definer
set search_path = public
as $$
declare
  consent public.connection_visibility_consents%rowtype;
begin
  if not public.current_profile_is_active() then
    raise exception 'Active staff access is required.';
  end if;

  update public.connection_visibility_consents
  set withdrawn_at = coalesce(withdrawn_at, now())
  where id = p_consent_id
  returning * into consent;

  if not found then raise exception 'Connections visibility consent not found.'; end if;

  update public.connection_resource_governance
  set review_status = 'under_review',
      decision_status = 'pending',
      publication_state = case
        when publication_state in ('published', 'paused') then 'paused'
        else 'unpublished'
      end,
      approved_visibility = null,
      pause_reason = 'Organization visibility consent was withdrawn.',
      paused_by = auth.uid(),
      paused_at = now(),
      updated_by = auth.uid(),
      updated_at = now()
  where resource_id = consent.resource_id
    and publication_state <> 'archived';

  insert into public.connection_activity (
    resource_id, entity_type, entity_id, event_type, actor_id, to_state
  ) values (
    consent.resource_id, 'visibility_consent', consent.id, 'visibility_consent_withdrawn', auth.uid(),
    jsonb_build_object('visibility', consent.visibility, 'withdrawn_at', consent.withdrawn_at)
  );

  return consent;
end
$$;

create or replace function public.record_connection_verification(
  p_resource_id uuid,
  p_verified_on date,
  p_method text,
  p_responsible_contact_name text,
  p_outcome text,
  p_visibility_confirmed text default null,
  p_notes text default ''
)
returns public.connection_verifications
language plpgsql
security definer
set search_path = public
as $$
declare
  verification public.connection_verifications%rowtype;
begin
  if not public.current_profile_is_active() then
    raise exception 'Active staff access is required.';
  end if;
  if p_verified_on is null or p_verified_on > current_date then
    raise exception 'Verification date must be today or earlier.';
  end if;
  if p_method not in ('phone', 'in_person') then raise exception 'Invalid verification method.'; end if;
  if p_outcome not in ('verified', 'changes_required', 'unconfirmed', 'closed') then raise exception 'Invalid verification outcome.'; end if;
  if p_visibility_confirmed is not null
    and p_visibility_confirmed not in ('public', 'limited', 'private_referral', 'temporarily_hidden')
  then raise exception 'Invalid verified visibility.'; end if;
  if length(trim(coalesce(p_responsible_contact_name, ''))) < 2 then
    raise exception 'Enter the responsible contact name.';
  end if;
  if not exists (select 1 from public.connection_resources where id = p_resource_id) then
    raise exception 'Connections resource not found.';
  end if;

  insert into public.connection_verifications (
    resource_id, verified_on, next_due_on, method, responsible_contact_name,
    performed_by, outcome, visibility_confirmed, notes
  ) values (
    p_resource_id,
    p_verified_on,
    case when p_outcome = 'verified' then (p_verified_on + interval '1 year')::date else null end,
    p_method,
    left(trim(p_responsible_contact_name), 200),
    auth.uid(),
    p_outcome,
    p_visibility_confirmed,
    left(trim(coalesce(p_notes, '')), 4000)
  ) returning * into verification;

  if p_outcome = 'verified' then
    update public.connection_resource_governance
    set last_verified_on = case
          when last_verified_on is null or p_verified_on >= last_verified_on then p_verified_on
          else last_verified_on
        end,
        verification_due_on = case
          when last_verified_on is null or p_verified_on >= last_verified_on then verification.next_due_on
          else verification_due_on
        end,
        requested_visibility = coalesce(p_visibility_confirmed, requested_visibility),
        updated_by = auth.uid(),
        updated_at = now()
    where resource_id = p_resource_id;
  end if;

  insert into public.connection_activity (
    resource_id, entity_type, entity_id, event_type, actor_id, to_state
  ) values (
    p_resource_id, 'verification', verification.id, 'verification_recorded', auth.uid(),
    jsonb_build_object(
      'outcome', verification.outcome,
      'verified_on', verification.verified_on,
      'next_due_on', verification.next_due_on
    )
  );

  return verification;
end
$$;

create or replace function public.admin_approve_connection(
  p_resource_id uuid,
  p_approved_visibility text
)
returns public.connection_resource_governance
language plpgsql
security definer
set search_path = public
as $$
declare
  previous_governance public.connection_resource_governance%rowtype;
  updated_governance public.connection_resource_governance%rowtype;
begin
  if not public.current_profile_is_admin() then raise exception 'Admin access is required.'; end if;
  if p_approved_visibility not in ('public', 'limited', 'private_referral', 'temporarily_hidden') then
    raise exception 'Invalid approved visibility.';
  end if;

  select * into previous_governance
  from public.connection_resource_governance
  where resource_id = p_resource_id
  for update;

  if not found then raise exception 'Connections resource not found.'; end if;
  if previous_governance.review_status <> 'ready_for_decision' then
    raise exception 'The resource must be ready for director decision.';
  end if;
  if previous_governance.publication_state = 'archived' then
    raise exception 'Archived resources cannot be approved.';
  end if;

  update public.connection_resource_governance
  set decision_status = 'approved',
      approved_visibility = p_approved_visibility,
      director_decision_by = auth.uid(),
      director_decision_at = now(),
      updated_by = auth.uid(),
      updated_at = now()
  where resource_id = p_resource_id
  returning * into updated_governance;

  insert into public.connection_activity (
    resource_id, entity_type, entity_id, event_type, actor_id, from_state, to_state
  ) values (
    p_resource_id, 'resource_governance', p_resource_id, 'resource_approved', auth.uid(),
    jsonb_build_object('decision_status', previous_governance.decision_status),
    jsonb_build_object('decision_status', 'approved', 'approved_visibility', p_approved_visibility)
  );

  return updated_governance;
end
$$;

create or replace function public.admin_publish_connection(p_resource_id uuid)
returns public.connection_resource_governance
language plpgsql
security definer
set search_path = public
as $$
declare
  previous_governance public.connection_resource_governance%rowtype;
  updated_governance public.connection_resource_governance%rowtype;
begin
  if not public.current_profile_is_admin() then raise exception 'Admin access is required.'; end if;

  select * into previous_governance
  from public.connection_resource_governance
  where resource_id = p_resource_id
  for update;

  if not found then raise exception 'Connections resource not found.'; end if;
  if previous_governance.decision_status <> 'approved' then raise exception 'The resource must be approved first.'; end if;
  if previous_governance.approved_visibility = 'temporarily_hidden' then raise exception 'Temporarily hidden resources cannot be published.'; end if;
  if previous_governance.stable_resource_confirmed is not true then raise exception 'Stable-resource review must be confirmed.'; end if;
  if previous_governance.last_verified_on is null
    or previous_governance.last_verified_on < current_date - interval '1 year'
  then raise exception 'A successful verification within the past year is required.'; end if;
  if not exists (
    select 1 from public.connection_resource_categories
    where resource_id = p_resource_id and is_primary = true
  ) then raise exception 'A primary category is required.'; end if;
  if not exists (
    select 1 from public.connection_visibility_consents
    where resource_id = p_resource_id
      and visibility = previous_governance.approved_visibility
      and withdrawn_at is null
  ) then raise exception 'Current organization visibility consent is required.'; end if;
  if not exists (
    select 1 from public.connection_contact_methods contact
    where contact.resource_id = p_resource_id
      and contact.consent_status = 'granted'
      and contact.revoked_at is null
      and contact.archived_at is null
      and (
        (previous_governance.approved_visibility = 'public' and contact.intended_use = 'public_direct')
        or (previous_governance.approved_visibility = 'limited' and contact.intended_use in ('public_direct', 'ilhrc_mediated'))
        or (previous_governance.approved_visibility = 'private_referral' and contact.intended_use = 'private_referral')
      )
  ) then raise exception 'An approved contact method for this visibility is required.'; end if;

  update public.connection_resource_governance
  set publication_state = 'published',
      published_by = coalesce(published_by, auth.uid()),
      published_at = coalesce(published_at, now()),
      pause_reason = '',
      paused_by = null,
      paused_at = null,
      updated_by = auth.uid(),
      updated_at = now()
  where resource_id = p_resource_id
  returning * into updated_governance;

  insert into public.connection_activity (
    resource_id, entity_type, entity_id, event_type, actor_id, from_state, to_state
  ) values (
    p_resource_id, 'resource_governance', p_resource_id, 'resource_published', auth.uid(),
    jsonb_build_object('publication_state', previous_governance.publication_state),
    jsonb_build_object('publication_state', 'published')
  );

  return updated_governance;
end
$$;

create or replace function public.admin_pause_connection(
  p_resource_id uuid,
  p_reason text
)
returns public.connection_resource_governance
language plpgsql
security definer
set search_path = public
as $$
declare
  previous_governance public.connection_resource_governance%rowtype;
  updated_governance public.connection_resource_governance%rowtype;
begin
  if not public.current_profile_is_admin() then raise exception 'Admin access is required.'; end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'A pause reason is required.'; end if;

  select * into previous_governance from public.connection_resource_governance
  where resource_id = p_resource_id for update;
  if not found then raise exception 'Connections resource not found.'; end if;
  if previous_governance.publication_state <> 'published' then raise exception 'Only published resources can be paused.'; end if;

  update public.connection_resource_governance
  set publication_state = 'paused', pause_reason = left(trim(p_reason), 1000),
      paused_by = auth.uid(), paused_at = now(), updated_by = auth.uid(), updated_at = now()
  where resource_id = p_resource_id returning * into updated_governance;

  insert into public.connection_activity (resource_id, entity_type, entity_id, event_type, actor_id, details)
  values (p_resource_id, 'resource_governance', p_resource_id, 'resource_paused', auth.uid(),
    jsonb_build_object('reason', left(trim(p_reason), 1000)));
  return updated_governance;
end
$$;

create or replace function public.admin_decline_connection(
  p_resource_id uuid,
  p_reason text default ''
)
returns public.connection_resource_governance
language plpgsql
security definer
set search_path = public
as $$
declare updated_governance public.connection_resource_governance%rowtype;
begin
  if not public.current_profile_is_admin() then raise exception 'Admin access is required.'; end if;
  update public.connection_resource_governance
  set decision_status = 'declined', publication_state = 'unpublished',
      approved_visibility = null, director_decision_by = auth.uid(), director_decision_at = now(),
      updated_by = auth.uid(), updated_at = now()
  where resource_id = p_resource_id and publication_state <> 'archived'
  returning * into updated_governance;
  if not found then raise exception 'Connections resource not found or already archived.'; end if;
  insert into public.connection_activity (resource_id, entity_type, entity_id, event_type, actor_id, details)
  values (p_resource_id, 'resource_governance', p_resource_id, 'resource_declined', auth.uid(),
    jsonb_build_object('reason', left(trim(coalesce(p_reason, '')), 1000)));
  return updated_governance;
end
$$;

create or replace function public.admin_archive_connection(
  p_resource_id uuid,
  p_reason text default ''
)
returns public.connection_resource_governance
language plpgsql
security definer
set search_path = public
as $$
declare updated_governance public.connection_resource_governance%rowtype;
begin
  if not public.current_profile_is_admin() then raise exception 'Admin access is required.'; end if;
  update public.connection_resource_governance
  set publication_state = 'archived', archived_by = auth.uid(), archived_at = now(),
      updated_by = auth.uid(), updated_at = now()
  where resource_id = p_resource_id and publication_state <> 'archived'
  returning * into updated_governance;
  if not found then raise exception 'Connections resource not found or already archived.'; end if;
  insert into public.connection_activity (resource_id, entity_type, entity_id, event_type, actor_id, details)
  values (p_resource_id, 'resource_governance', p_resource_id, 'resource_archived', auth.uid(),
    jsonb_build_object('reason', left(trim(coalesce(p_reason, '')), 1000)));
  return updated_governance;
end
$$;

revoke all on function public.set_connection_review_status(uuid,text) from public, anon;
revoke all on function public.update_connection_review_controls(uuid,text,text,text,boolean) from public, anon;
revoke all on function public.withdraw_connection_visibility_consent(uuid) from public, anon;
revoke all on function public.record_connection_verification(uuid,date,text,text,text,text,text) from public, anon;
revoke all on function public.admin_approve_connection(uuid,text) from public, anon;
revoke all on function public.admin_publish_connection(uuid) from public, anon;
revoke all on function public.admin_pause_connection(uuid,text) from public, anon;
revoke all on function public.admin_decline_connection(uuid,text) from public, anon;
revoke all on function public.admin_archive_connection(uuid,text) from public, anon;

grant execute on function public.set_connection_review_status(uuid,text) to authenticated;
grant execute on function public.update_connection_review_controls(uuid,text,text,text,boolean) to authenticated;
grant execute on function public.withdraw_connection_visibility_consent(uuid) to authenticated;
grant execute on function public.record_connection_verification(uuid,date,text,text,text,text,text) to authenticated;
grant execute on function public.admin_approve_connection(uuid,text) to authenticated;
grant execute on function public.admin_publish_connection(uuid) to authenticated;
grant execute on function public.admin_pause_connection(uuid,text) to authenticated;
grant execute on function public.admin_decline_connection(uuid,text) to authenticated;
grant execute on function public.admin_archive_connection(uuid,text) to authenticated;

revoke all on function public.create_connection_resource_governance() from public, anon, authenticated;
revoke all on function public.prevent_published_connection_slug_change() from public, anon, authenticated;
revoke all on function public.reopen_connection_review_after_content_change() from public, anon, authenticated;

notify pgrst, 'reload schema';
