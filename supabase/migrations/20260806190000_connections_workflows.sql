-- IL HRC Connections: Milestone 3 native submissions, corrections,
-- private-referral requests, and staff workflow queues.
-- Additive only. Nothing in this migration publishes a resource automatically.

create table public.connection_submissions (
  id uuid primary key default gen_random_uuid(),
  submission_type text not null
    check (submission_type in ('representative', 'suggestion', 'staff')),
  status text not null default 'submitted'
    check (status in ('submitted', 'under_review', 'needs_information', 'converted', 'declined', 'archived')),
  organization_name text not null,
  category_id uuid references public.connection_categories(id) on delete restrict,
  description text not null default '',
  homeschool_relevance text not null default '',
  worldview text not null default 'information_not_provided'
    check (worldview in ('christian', 'faith_based_other', 'secular', 'no_stated_religious_affiliation', 'information_not_provided')),
  delivery_mode text not null default 'in_person'
    check (delivery_mode in ('in_person', 'online', 'hybrid')),
  accepting_status text not null default 'unknown'
    check (accepting_status in ('accepting', 'waitlist', 'closed', 'unknown')),
  cost_type text not null default 'contact'
    check (cost_type in ('free', 'paid', 'variable', 'contact')),
  age_grade_notes text not null default '',
  homeschool_specific boolean not null default false,
  daytime_available boolean not null default false,
  homeschool_discount boolean not null default false,
  website text not null default '',
  city text not null default '',
  county text not null default '',
  service_area text not null default '',
  requested_visibility text not null default 'public'
    check (requested_visibility in ('public', 'limited', 'private_referral', 'temporarily_hidden')),
  submitter_name text not null,
  submitter_email text not null,
  submitter_phone text not null default '',
  submitter_relationship text not null default '',
  organization_contact_name text not null default '',
  organization_contact_email text not null default '',
  organization_contact_phone text not null default '',
  publication_attested boolean not null default false,
  publication_attested_at timestamptz,
  resource_id uuid references public.connection_resources(id) on delete restrict,
  assigned_to uuid references auth.users(id) on delete set null,
  submitted_by_user uuid references auth.users(id) on delete set null,
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  staff_notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint connection_submission_name_present check (length(trim(organization_name)) >= 2),
  constraint connection_submission_submitter_present check (length(trim(submitter_name)) >= 2),
  constraint connection_submission_email_present check (position('@' in submitter_email) > 1),
  constraint connection_submission_representative_attestation check (
    submission_type <> 'representative'
    or (publication_attested = true and publication_attested_at is not null)
  ),
  constraint connection_submission_suggestion_cannot_attest check (
    submission_type <> 'suggestion' or publication_attested = false
  )
);

create index connection_submissions_queue_idx
on public.connection_submissions (status, created_at desc);

create index connection_submissions_resource_idx
on public.connection_submissions (resource_id)
where resource_id is not null;

create table public.connection_submission_consents (
  submission_id uuid not null references public.connection_submissions(id) on delete restrict,
  field_name text not null check (field_name in ('website', 'email', 'phone')),
  consent_status text not null check (consent_status in ('not_requested', 'granted', 'denied')),
  consented_by_name text not null default '',
  consented_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (submission_id, field_name),
  constraint connection_submission_consent_evidence check (
    consent_status <> 'granted'
    or (length(trim(consented_by_name)) >= 2 and consented_at is not null)
  )
);

create table public.connection_correction_requests (
  id uuid primary key default gen_random_uuid(),
  resource_id uuid not null references public.connection_resources(id) on delete restrict,
  status text not null default 'submitted'
    check (status in ('submitted', 'under_review', 'needs_information', 'applied', 'declined', 'archived')),
  requester_name text not null,
  requester_email text not null,
  requester_phone text not null default '',
  requester_relationship text not null default '',
  requested_changes text not null,
  privacy_removal_requested boolean not null default false,
  assigned_to uuid references auth.users(id) on delete set null,
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  staff_notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint connection_correction_requester_present check (length(trim(requester_name)) >= 2),
  constraint connection_correction_email_present check (position('@' in requester_email) > 1),
  constraint connection_correction_changes_present check (length(trim(requested_changes)) >= 10)
);

create index connection_corrections_queue_idx
on public.connection_correction_requests (status, privacy_removal_requested desc, created_at desc);

create index connection_corrections_resource_idx
on public.connection_correction_requests (resource_id, created_at desc);

create table public.connection_referral_requests (
  id uuid primary key default gen_random_uuid(),
  resource_id uuid references public.connection_resources(id) on delete restrict,
  requested_resource_name text not null default '',
  status text not null default 'submitted'
    check (status in ('submitted', 'contacting_resource', 'leader_approved', 'leader_declined', 'introduction_shared', 'closed', 'archived')),
  requester_name text not null,
  requester_email text not null,
  requester_phone text not null default '',
  preferred_contact text not null default 'email'
    check (preferred_contact in ('email', 'phone')),
  family_need text not null,
  consent_to_contact boolean not null,
  responsible_contact_name text not null default '',
  leader_decision_at timestamptz,
  introduction_shared_at timestamptz,
  assigned_to uuid references auth.users(id) on delete set null,
  handled_by uuid references auth.users(id) on delete set null,
  staff_notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint connection_referral_requester_present check (length(trim(requester_name)) >= 2),
  constraint connection_referral_email_present check (position('@' in requester_email) > 1),
  constraint connection_referral_need_present check (length(trim(family_need)) >= 10),
  constraint connection_referral_contact_consent check (consent_to_contact = true),
  constraint connection_referral_leader_evidence check (
    status not in ('leader_approved', 'leader_declined', 'introduction_shared')
    or (length(trim(responsible_contact_name)) >= 2 and leader_decision_at is not null)
  ),
  constraint connection_referral_introduction_evidence check (
    status <> 'introduction_shared' or introduction_shared_at is not null
  )
);

create index connection_referrals_queue_idx
on public.connection_referral_requests (status, created_at desc);

create index connection_referrals_resource_idx
on public.connection_referral_requests (resource_id, created_at desc)
where resource_id is not null;

create table public.connection_workflow_activity (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null check (subject_type in ('submission', 'correction', 'referral')),
  subject_id uuid not null,
  event_type text not null,
  actor_id uuid references auth.users(id) on delete set null,
  from_status text,
  to_status text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index connection_workflow_activity_subject_idx
on public.connection_workflow_activity (subject_type, subject_id, created_at desc);

create trigger connection_submissions_touch_updated_at
before update on public.connection_submissions
for each row execute function public.touch_connection_updated_at();

create trigger connection_corrections_touch_updated_at
before update on public.connection_correction_requests
for each row execute function public.touch_connection_updated_at();

create trigger connection_referrals_touch_updated_at
before update on public.connection_referral_requests
for each row execute function public.touch_connection_updated_at();

alter table public.connection_submissions enable row level security;
alter table public.connection_submission_consents enable row level security;
alter table public.connection_correction_requests enable row level security;
alter table public.connection_referral_requests enable row level security;
alter table public.connection_workflow_activity enable row level security;

revoke all on public.connection_submissions from anon, authenticated;
revoke all on public.connection_submission_consents from anon, authenticated;
revoke all on public.connection_correction_requests from anon, authenticated;
revoke all on public.connection_referral_requests from anon, authenticated;
revoke all on public.connection_workflow_activity from anon, authenticated;

create policy "connection submissions staff read"
on public.connection_submissions for select to authenticated
using (public.current_profile_is_active());

create policy "connection submission consents staff read"
on public.connection_submission_consents for select to authenticated
using (public.current_profile_is_active());

create policy "connection corrections staff read"
on public.connection_correction_requests for select to authenticated
using (public.current_profile_is_active());

create policy "connection referrals staff read"
on public.connection_referral_requests for select to authenticated
using (public.current_profile_is_active());

create policy "connection workflow activity staff read"
on public.connection_workflow_activity for select to authenticated
using (public.current_profile_is_active());

grant select on public.connection_submissions to authenticated;
grant select on public.connection_submission_consents to authenticated;
grant select on public.connection_correction_requests to authenticated;
grant select on public.connection_referral_requests to authenticated;
grant select on public.connection_workflow_activity to authenticated;

create or replace view public.staff_connections_resource_queue
with (security_invoker = true, security_barrier = true)
as
select
  resource.id,
  resource.slug,
  resource.name,
  governance.review_status,
  governance.decision_status,
  governance.publication_state,
  governance.requested_visibility,
  governance.approved_visibility,
  governance.geographic_scope,
  governance.geographic_exception_reason,
  governance.stable_resource_confirmed,
  governance.last_verified_on,
  governance.verification_due_on,
  governance.pause_reason,
  governance.updated_at,
  (governance.verification_due_on is not null and governance.verification_due_on < current_date) as verification_overdue
from public.connection_resources resource
join public.connection_resource_governance governance on governance.resource_id = resource.id;

revoke all on public.staff_connections_resource_queue from public, anon, authenticated;
grant select on public.staff_connections_resource_queue to authenticated;

create or replace function public.submit_connection_resource(p_submission jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
  submission_kind text := lower(trim(coalesce(p_submission->>'submission_type', '')));
  organization_name text := left(trim(coalesce(p_submission->>'organization_name', '')), 200);
  submitter_name text := left(trim(coalesce(p_submission->>'submitter_name', '')), 200);
  submitter_email text := lower(left(trim(coalesce(p_submission->>'submitter_email', '')), 320));
  category uuid;
  attested boolean := coalesce((p_submission->>'publication_attested')::boolean, false);
begin
  if octet_length(coalesce(p_submission::text, '')) > 20000 then raise exception 'Submission is too large.'; end if;
  if length(trim(coalesce(p_submission->>'website_confirm', ''))) > 0 then raise exception 'Submission could not be accepted.'; end if;
  if submission_kind not in ('representative', 'suggestion', 'staff') then raise exception 'Choose a valid submission type.'; end if;
  if submission_kind = 'staff' and not public.current_profile_is_active() then raise exception 'Active staff access is required.'; end if;
  if length(organization_name) < 2 then raise exception 'Enter the resource name.'; end if;
  if length(submitter_name) < 2 then raise exception 'Enter your name.'; end if;
  if position('@' in submitter_email) <= 1 then raise exception 'Enter a valid email address.'; end if;
  if submission_kind = 'representative' and not attested then raise exception 'Publication consent acknowledgement is required.'; end if;
  if submission_kind = 'suggestion' then attested := false; end if;

  select id into category
  from public.connection_categories
  where slug = left(trim(coalesce(p_submission->>'category_slug', '')), 100) and active = true;
  if category is null then raise exception 'Choose a valid category.'; end if;

  insert into public.connection_submissions (
    submission_type, organization_name, category_id, description, homeschool_relevance,
    worldview, delivery_mode, accepting_status, cost_type, age_grade_notes,
    homeschool_specific, daytime_available, homeschool_discount, website, city, county,
    service_area, requested_visibility, submitter_name, submitter_email, submitter_phone,
    submitter_relationship, organization_contact_name, organization_contact_email,
    organization_contact_phone, publication_attested, publication_attested_at, submitted_by_user
  ) values (
    submission_kind, organization_name, category,
    left(trim(coalesce(p_submission->>'description', '')), 5000),
    left(trim(coalesce(p_submission->>'homeschool_relevance', '')), 3000),
    coalesce(nullif(p_submission->>'worldview', ''), 'information_not_provided'),
    coalesce(nullif(p_submission->>'delivery_mode', ''), 'in_person'),
    coalesce(nullif(p_submission->>'accepting_status', ''), 'unknown'),
    coalesce(nullif(p_submission->>'cost_type', ''), 'contact'),
    left(trim(coalesce(p_submission->>'age_grade_notes', '')), 1000),
    coalesce((p_submission->>'homeschool_specific')::boolean, false),
    coalesce((p_submission->>'daytime_available')::boolean, false),
    coalesce((p_submission->>'homeschool_discount')::boolean, false),
    left(trim(coalesce(p_submission->>'website', '')), 500),
    left(trim(coalesce(p_submission->>'city', '')), 120),
    left(trim(coalesce(p_submission->>'county', '')), 120),
    left(trim(coalesce(p_submission->>'service_area', '')), 1000),
    coalesce(nullif(p_submission->>'requested_visibility', ''), 'public'),
    submitter_name, submitter_email,
    left(trim(coalesce(p_submission->>'submitter_phone', '')), 80),
    left(trim(coalesce(p_submission->>'submitter_relationship', '')), 200),
    left(trim(coalesce(p_submission->>'organization_contact_name', '')), 200),
    lower(left(trim(coalesce(p_submission->>'organization_contact_email', '')), 320)),
    left(trim(coalesce(p_submission->>'organization_contact_phone', '')), 80),
    attested, case when attested then now() else null end,
    case when submission_kind = 'staff' then auth.uid() else null end
  ) returning id into new_id;

  insert into public.connection_submission_consents (
    submission_id, field_name, consent_status, consented_by_name, consented_at
  )
  select
    new_id,
    consent.field_name,
    case
      when submission_kind <> 'representative' then 'not_requested'
      when consent.granted then 'granted'
      else 'denied'
    end,
    case when submission_kind = 'representative' and consent.granted then submitter_name else '' end,
    case when submission_kind = 'representative' and consent.granted then now() else null end
  from (values
    ('website', coalesce((p_submission->>'consent_website')::boolean, false)),
    ('email', coalesce((p_submission->>'consent_email')::boolean, false)),
    ('phone', coalesce((p_submission->>'consent_phone')::boolean, false))
  ) as consent(field_name, granted);

  insert into public.connection_workflow_activity (subject_type, subject_id, event_type, actor_id, to_status)
  values ('submission', new_id, 'submission_received', auth.uid(), 'submitted');
  return new_id;
end
$$;

create or replace function public.submit_connection_correction(
  p_resource_slug text,
  p_requester_name text,
  p_requester_email text,
  p_requester_phone text,
  p_requester_relationship text,
  p_requested_changes text,
  p_privacy_removal_requested boolean default false,
  p_website_confirm text default ''
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_resource_id uuid;
  new_id uuid;
begin
  if length(trim(coalesce(p_website_confirm, ''))) > 0 then raise exception 'Request could not be accepted.'; end if;
  if length(trim(coalesce(p_requester_name, ''))) < 2 then raise exception 'Enter your name.'; end if;
  if position('@' in lower(trim(coalesce(p_requester_email, '')))) <= 1 then raise exception 'Enter a valid email address.'; end if;
  if length(trim(coalesce(p_requested_changes, ''))) < 10 then raise exception 'Describe the requested correction.'; end if;

  select resource.id into target_resource_id
  from public.connection_resources resource
  join public.public_connections_directory directory on directory.slug = resource.slug
  where directory.slug = lower(trim(p_resource_slug));
  if target_resource_id is null then raise exception 'Connections resource not found.'; end if;

  insert into public.connection_correction_requests (
    resource_id, requester_name, requester_email, requester_phone,
    requester_relationship, requested_changes, privacy_removal_requested
  ) values (
    target_resource_id,
    left(trim(p_requester_name), 200),
    lower(left(trim(p_requester_email), 320)),
    left(trim(coalesce(p_requester_phone, '')), 80),
    left(trim(coalesce(p_requester_relationship, '')), 200),
    left(trim(p_requested_changes), 5000),
    coalesce(p_privacy_removal_requested, false)
  ) returning id into new_id;

  insert into public.connection_workflow_activity (subject_type, subject_id, event_type, to_status, details)
  values ('correction', new_id, 'correction_received', 'submitted',
    jsonb_build_object('privacy_removal_requested', coalesce(p_privacy_removal_requested, false)));
  return new_id;
end
$$;

create or replace function public.submit_connection_referral(
  p_requester_name text,
  p_requester_email text,
  p_requester_phone text,
  p_preferred_contact text,
  p_requested_resource_name text,
  p_family_need text,
  p_consent_to_contact boolean,
  p_website_confirm text default ''
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare new_id uuid;
begin
  if length(trim(coalesce(p_website_confirm, ''))) > 0 then raise exception 'Request could not be accepted.'; end if;
  if length(trim(coalesce(p_requester_name, ''))) < 2 then raise exception 'Enter your name.'; end if;
  if position('@' in lower(trim(coalesce(p_requester_email, '')))) <= 1 then raise exception 'Enter a valid email address.'; end if;
  if p_preferred_contact not in ('email', 'phone') then raise exception 'Choose a preferred contact method.'; end if;
  if p_preferred_contact = 'phone' and length(trim(coalesce(p_requester_phone, ''))) < 7 then raise exception 'Enter a phone number.'; end if;
  if length(trim(coalesce(p_family_need, ''))) < 10 then raise exception 'Describe the resource you are seeking.'; end if;
  if p_consent_to_contact is not true then raise exception 'Permission to contact you is required.'; end if;

  insert into public.connection_referral_requests (
    requester_name, requester_email, requester_phone, preferred_contact,
    requested_resource_name, family_need, consent_to_contact
  ) values (
    left(trim(p_requester_name), 200), lower(left(trim(p_requester_email), 320)),
    left(trim(coalesce(p_requester_phone, '')), 80), p_preferred_contact,
    left(trim(coalesce(p_requested_resource_name, '')), 200),
    left(trim(p_family_need), 5000), true
  ) returning id into new_id;

  insert into public.connection_workflow_activity (subject_type, subject_id, event_type, to_status)
  values ('referral', new_id, 'referral_received', 'submitted');
  return new_id;
end
$$;

create or replace function public.set_connection_submission_status(
  p_submission_id uuid,
  p_status text,
  p_staff_notes text default ''
)
returns public.connection_submissions
language plpgsql
security definer
set search_path = public
as $$
declare previous public.connection_submissions%rowtype; updated public.connection_submissions%rowtype;
begin
  if not public.current_profile_is_active() then raise exception 'Active staff access is required.'; end if;
  if p_status not in ('submitted', 'under_review', 'needs_information', 'declined', 'archived') then raise exception 'Invalid submission status.'; end if;
  select * into previous from public.connection_submissions where id = p_submission_id for update;
  if not found then raise exception 'Submission not found.'; end if;
  update public.connection_submissions
  set status = p_status, staff_notes = left(trim(coalesce(p_staff_notes, '')), 4000),
      resolved_by = case when p_status in ('declined', 'archived') then auth.uid() else null end,
      resolved_at = case when p_status in ('declined', 'archived') then now() else null end
  where id = p_submission_id returning * into updated;
  insert into public.connection_workflow_activity (subject_type, subject_id, event_type, actor_id, from_status, to_status)
  values ('submission', p_submission_id, 'submission_status_changed', auth.uid(), previous.status, updated.status);
  return updated;
end
$$;

create or replace function public.set_connection_correction_status(
  p_request_id uuid,
  p_status text,
  p_staff_notes text default ''
)
returns public.connection_correction_requests
language plpgsql
security definer
set search_path = public
as $$
declare previous public.connection_correction_requests%rowtype; updated public.connection_correction_requests%rowtype;
begin
  if not public.current_profile_is_active() then raise exception 'Active staff access is required.'; end if;
  if p_status not in ('submitted', 'under_review', 'needs_information', 'applied', 'declined', 'archived') then raise exception 'Invalid correction status.'; end if;
  select * into previous from public.connection_correction_requests where id = p_request_id for update;
  if not found then raise exception 'Correction request not found.'; end if;
  update public.connection_correction_requests
  set status = p_status, staff_notes = left(trim(coalesce(p_staff_notes, '')), 4000),
      resolved_by = case when p_status in ('applied', 'declined', 'archived') then auth.uid() else null end,
      resolved_at = case when p_status in ('applied', 'declined', 'archived') then now() else null end
  where id = p_request_id returning * into updated;
  insert into public.connection_workflow_activity (subject_type, subject_id, event_type, actor_id, from_status, to_status)
  values ('correction', p_request_id, 'correction_status_changed', auth.uid(), previous.status, updated.status);
  return updated;
end
$$;

create or replace function public.set_connection_referral_status(
  p_request_id uuid,
  p_status text,
  p_responsible_contact_name text default '',
  p_staff_notes text default ''
)
returns public.connection_referral_requests
language plpgsql
security definer
set search_path = public
as $$
declare previous public.connection_referral_requests%rowtype; updated public.connection_referral_requests%rowtype;
begin
  if not public.current_profile_is_active() then raise exception 'Active staff access is required.'; end if;
  if p_status not in ('submitted', 'contacting_resource', 'leader_approved', 'leader_declined', 'introduction_shared', 'closed', 'archived') then raise exception 'Invalid referral status.'; end if;
  select * into previous from public.connection_referral_requests where id = p_request_id for update;
  if not found then raise exception 'Referral request not found.'; end if;
  if p_status = 'introduction_shared' and previous.status <> 'leader_approved' then
    raise exception 'The resource leader must approve the introduction first.';
  end if;
  if p_status in ('leader_approved', 'leader_declined', 'introduction_shared')
    and length(trim(coalesce(p_responsible_contact_name, previous.responsible_contact_name))) < 2
  then raise exception 'Record the responsible resource contact.'; end if;

  update public.connection_referral_requests
  set status = p_status,
      responsible_contact_name = case
        when p_status in ('leader_approved', 'leader_declined', 'introduction_shared')
        then left(trim(coalesce(nullif(p_responsible_contact_name, ''), previous.responsible_contact_name)), 200)
        else responsible_contact_name end,
      leader_decision_at = case
        when p_status in ('leader_approved', 'leader_declined') then now()
        else leader_decision_at end,
      introduction_shared_at = case when p_status = 'introduction_shared' then now() else introduction_shared_at end,
      handled_by = auth.uid(),
      staff_notes = left(trim(coalesce(p_staff_notes, '')), 4000)
  where id = p_request_id returning * into updated;

  insert into public.connection_workflow_activity (subject_type, subject_id, event_type, actor_id, from_status, to_status)
  values ('referral', p_request_id, 'referral_status_changed', auth.uid(), previous.status, updated.status);
  return updated;
end
$$;

create or replace function public.convert_connection_submission_to_draft(
  p_submission_id uuid,
  p_slug text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare submission public.connection_submissions%rowtype; new_resource_id uuid; consent record;
begin
  if not public.current_profile_is_active() then raise exception 'Active staff access is required.'; end if;
  if p_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then raise exception 'Enter a URL-safe resource slug.'; end if;
  select * into submission from public.connection_submissions where id = p_submission_id for update;
  if not found then raise exception 'Submission not found.'; end if;
  if submission.status in ('converted', 'declined', 'archived') or submission.resource_id is not null then
    raise exception 'Submission cannot be converted.';
  end if;

  insert into public.connection_resources (
    slug, name, short_description, description, worldview, age_grade_notes,
    delivery_mode, accepting_status, cost_type, homeschool_specific,
    daytime_available, homeschool_discount, service_area_summary, created_by, updated_by
  ) values (
    p_slug, submission.organization_name,
    left(coalesce(nullif(submission.homeschool_relevance, ''), submission.description), 300),
    submission.description, submission.worldview, submission.age_grade_notes,
    submission.delivery_mode, submission.accepting_status, submission.cost_type,
    submission.homeschool_specific, submission.daytime_available,
    submission.homeschool_discount, submission.service_area, auth.uid(), auth.uid()
  ) returning id into new_resource_id;

  insert into public.connection_resource_categories (resource_id, category_id, is_primary)
  values (new_resource_id, submission.category_id, true);

  if length(submission.city) > 0 or length(submission.county) > 0 then
    insert into public.connection_locations (
      resource_id, name, city, county, state, address_display, address_consent_status, is_primary
    ) values (new_resource_id, '', submission.city, submission.county, 'IL', 'town_only', 'not_requested', true);
  end if;

  for consent in
    select * from public.connection_submission_consents where submission_id = submission.id
  loop
    if consent.field_name = 'website' and length(submission.website) > 0 then
      insert into public.connection_contact_methods (
        resource_id, kind, label, value, is_personal, intended_use, consent_status,
        consented_by_name, consented_at, consent_method
      ) values (
        new_resource_id, 'website', 'Website', submission.website, false, 'public_direct', consent.consent_status,
        consent.consented_by_name, consent.consented_at, case when consent.consent_status = 'granted' then 'written' else null end
      );
    elsif consent.field_name = 'email' and length(submission.organization_contact_email) > 0 then
      insert into public.connection_contact_methods (
        resource_id, kind, label, value, is_personal, intended_use, consent_status,
        consented_by_name, consented_at, consent_method
      ) values (
        new_resource_id, 'email', 'Email', submission.organization_contact_email, true, 'public_direct', consent.consent_status,
        consent.consented_by_name, consent.consented_at, case when consent.consent_status = 'granted' then 'written' else null end
      );
    elsif consent.field_name = 'phone' and length(submission.organization_contact_phone) > 0 then
      insert into public.connection_contact_methods (
        resource_id, kind, label, value, is_personal, intended_use, consent_status,
        consented_by_name, consented_at, consent_method
      ) values (
        new_resource_id, 'phone', 'Phone', submission.organization_contact_phone, true, 'public_direct', consent.consent_status,
        consent.consented_by_name, consent.consented_at, case when consent.consent_status = 'granted' then 'written' else null end
      );
    end if;
  end loop;

  update public.connection_resource_governance
  set review_status = 'under_review', requested_visibility = submission.requested_visibility,
      updated_by = auth.uid(), updated_at = now()
  where resource_id = new_resource_id;

  update public.connection_submissions
  set status = 'converted', resource_id = new_resource_id, resolved_by = auth.uid(), resolved_at = now()
  where id = submission.id;

  insert into public.connection_workflow_activity (
    subject_type, subject_id, event_type, actor_id, from_status, to_status, details
  ) values (
    'submission', submission.id, 'submission_converted', auth.uid(), submission.status, 'converted',
    jsonb_build_object('resource_id', new_resource_id)
  );
  insert into public.connection_activity (resource_id, entity_type, entity_id, event_type, actor_id)
  values (new_resource_id, 'submission', submission.id, 'resource_created_from_submission', auth.uid());
  return new_resource_id;
end
$$;

create or replace function public.record_connection_visibility_consent(
  p_resource_id uuid,
  p_visibility text,
  p_consented_by_name text,
  p_contact_role text,
  p_consent_method text,
  p_consented_at timestamptz
)
returns public.connection_visibility_consents
language plpgsql
security definer
set search_path = public
as $$
declare existing_consent public.connection_visibility_consents%rowtype; new_consent public.connection_visibility_consents%rowtype;
begin
  if not public.current_profile_is_active() then raise exception 'Active staff access is required.'; end if;
  if p_visibility not in ('public', 'limited', 'private_referral', 'temporarily_hidden') then raise exception 'Choose a valid visibility.'; end if;
  if p_consent_method not in ('written', 'phone', 'in_person') then raise exception 'Choose a valid consent method.'; end if;
  if length(trim(coalesce(p_consented_by_name, ''))) < 2 then raise exception 'Enter the consenting adult name.'; end if;
  if p_consented_at is null or p_consented_at > now() then raise exception 'Enter a valid consent date.'; end if;
  if not exists (select 1 from public.connection_resources where id = p_resource_id) then raise exception 'Connections resource not found.'; end if;

  select * into existing_consent from public.connection_visibility_consents
  where resource_id = p_resource_id and withdrawn_at is null for update;
  if found then
    update public.connection_visibility_consents set withdrawn_at = now() where id = existing_consent.id;
    update public.connection_resource_governance
    set review_status = 'under_review', decision_status = 'pending', approved_visibility = null,
        publication_state = case when publication_state = 'published' then 'paused' else publication_state end,
        pause_reason = case when publication_state = 'published' then 'Organization visibility consent changed; director reapproval is required.' else pause_reason end,
        paused_by = case when publication_state = 'published' then auth.uid() else paused_by end,
        paused_at = case when publication_state = 'published' then now() else paused_at end,
        updated_by = auth.uid(), updated_at = now()
    where resource_id = p_resource_id and publication_state <> 'archived';
  end if;

  insert into public.connection_visibility_consents (
    resource_id, visibility, consented_by_name, contact_role, consent_method,
    consented_at, recorded_by
  ) values (
    p_resource_id, p_visibility, left(trim(p_consented_by_name), 200),
    left(trim(coalesce(p_contact_role, '')), 200), p_consent_method,
    p_consented_at, auth.uid()
  ) returning * into new_consent;

  update public.connection_resource_governance
  set requested_visibility = p_visibility, updated_by = auth.uid(), updated_at = now()
  where resource_id = p_resource_id;
  insert into public.connection_activity (resource_id, entity_type, entity_id, event_type, actor_id, to_state)
  values (p_resource_id, 'visibility_consent', new_consent.id, 'visibility_consent_recorded', auth.uid(),
    jsonb_build_object('visibility', p_visibility, 'consented_at', p_consented_at));
  return new_consent;
end
$$;

create or replace function public.add_connection_internal_note(
  p_resource_id uuid,
  p_body text
)
returns public.connection_internal_notes
language plpgsql
security definer
set search_path = public
as $$
declare note public.connection_internal_notes%rowtype;
begin
  if not public.current_profile_is_active() then raise exception 'Active staff access is required.'; end if;
  if length(trim(coalesce(p_body, ''))) < 2 then raise exception 'Enter an internal note.'; end if;
  insert into public.connection_internal_notes (resource_id, body, created_by)
  values (p_resource_id, left(trim(p_body), 4000), auth.uid()) returning * into note;
  insert into public.connection_activity (resource_id, entity_type, entity_id, event_type, actor_id)
  values (p_resource_id, 'internal_note', note.id, 'internal_note_added', auth.uid());
  return note;
end
$$;

revoke all on function public.submit_connection_resource(jsonb) from public;
revoke all on function public.submit_connection_correction(text,text,text,text,text,text,boolean,text) from public;
revoke all on function public.submit_connection_referral(text,text,text,text,text,text,boolean,text) from public;
revoke all on function public.set_connection_submission_status(uuid,text,text) from public, anon;
revoke all on function public.set_connection_correction_status(uuid,text,text) from public, anon;
revoke all on function public.set_connection_referral_status(uuid,text,text,text) from public, anon;
revoke all on function public.convert_connection_submission_to_draft(uuid,text) from public, anon;
revoke all on function public.record_connection_visibility_consent(uuid,text,text,text,text,timestamptz) from public, anon;
revoke all on function public.add_connection_internal_note(uuid,text) from public, anon;

grant execute on function public.submit_connection_resource(jsonb) to anon, authenticated;
grant execute on function public.submit_connection_correction(text,text,text,text,text,text,boolean,text) to anon, authenticated;
grant execute on function public.submit_connection_referral(text,text,text,text,text,text,boolean,text) to anon, authenticated;
grant execute on function public.set_connection_submission_status(uuid,text,text) to authenticated;
grant execute on function public.set_connection_correction_status(uuid,text,text) to authenticated;
grant execute on function public.set_connection_referral_status(uuid,text,text,text) to authenticated;
grant execute on function public.convert_connection_submission_to_draft(uuid,text) to authenticated;
grant execute on function public.record_connection_visibility_consent(uuid,text,text,text,text,timestamptz) to authenticated;
grant execute on function public.add_connection_internal_note(uuid,text) to authenticated;

notify pgrst, 'reload schema';
