-- IL HRC Connections: staff-only resource editor foundation.
-- Additive only. Public views and publication authority are unchanged.

create or replace function public.get_connection_resource_editor(p_resource_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if not public.current_profile_is_active() then
    raise exception 'Active staff access is required.';
  end if;

  select jsonb_build_object(
    'id', resource.id,
    'slug', resource.slug,
    'name', resource.name,
    'short_description', resource.short_description,
    'description', resource.description,
    'worldview', resource.worldview,
    'worldview_details', resource.worldview_details,
    'age_min', resource.age_min,
    'age_max', resource.age_max,
    'grade_min', resource.grade_min,
    'grade_max', resource.grade_max,
    'age_grade_notes', resource.age_grade_notes,
    'delivery_mode', resource.delivery_mode,
    'accepting_status', resource.accepting_status,
    'cost_type', resource.cost_type,
    'homeschool_specific', resource.homeschool_specific,
    'daytime_available', resource.daytime_available,
    'homeschool_discount', resource.homeschool_discount,
    'service_area_summary', resource.service_area_summary,
    'category_slug', coalesce((
      select category.slug
      from public.connection_resource_categories link
      join public.connection_categories category on category.id = link.category_id
      where link.resource_id = resource.id
      order by link.is_primary desc, link.sort_order, category.sort_order
      limit 1
    ), ''),
    'location_name', coalesce(location.name, ''),
    'location_kind', coalesce(location.location_kind, 'physical'),
    'address_line_1', coalesce(location.address_line_1, ''),
    'city', coalesce(location.city, ''),
    'county', coalesce(location.county, ''),
    'state', coalesce(location.state, 'IL'),
    'postal_code', coalesce(location.postal_code, ''),
    'service_area', coalesce(location.service_area, ''),
    'address_display', coalesce(location.address_display, 'town_only'),
    'address_consent_status', coalesce(location.address_consent_status, 'not_requested'),
    'address_consented_by_name', coalesce(location.address_consented_by_name, ''),
    'address_consented_at', location.address_consented_at,
    'address_consent_method', location.address_consent_method,
    'website_value', coalesce(website.value, ''),
    'website_consent_status', coalesce(website.consent_status, 'not_requested'),
    'website_consented_by_name', coalesce(website.consented_by_name, ''),
    'website_consented_at', website.consented_at,
    'website_consent_method', website.consent_method,
    'email_value', coalesce(email.value, ''),
    'email_consent_status', coalesce(email.consent_status, 'not_requested'),
    'email_consented_by_name', coalesce(email.consented_by_name, ''),
    'email_consented_at', email.consented_at,
    'email_consent_method', email.consent_method,
    'phone_value', coalesce(phone.value, ''),
    'phone_consent_status', coalesce(phone.consent_status, 'not_requested'),
    'phone_consented_by_name', coalesce(phone.consented_by_name, ''),
    'phone_consented_at', phone.consented_at,
    'phone_consent_method', phone.consent_method
  )
  into result
  from public.connection_resources resource
  left join lateral (
    select * from public.connection_locations candidate
    where candidate.resource_id = resource.id and candidate.archived_at is null
    order by candidate.is_primary desc, candidate.sort_order, candidate.created_at
    limit 1
  ) location on true
  left join lateral (
    select * from public.connection_contact_methods candidate
    where candidate.resource_id = resource.id and candidate.kind = 'website' and candidate.archived_at is null
    order by candidate.sort_order, candidate.created_at limit 1
  ) website on true
  left join lateral (
    select * from public.connection_contact_methods candidate
    where candidate.resource_id = resource.id and candidate.kind = 'email' and candidate.archived_at is null
    order by candidate.sort_order, candidate.created_at limit 1
  ) email on true
  left join lateral (
    select * from public.connection_contact_methods candidate
    where candidate.resource_id = resource.id and candidate.kind = 'phone' and candidate.archived_at is null
    order by candidate.sort_order, candidate.created_at limit 1
  ) phone on true
  where resource.id = p_resource_id;

  if result is null then raise exception 'Resource not found.'; end if;
  return result;
end;
$$;

create or replace function public.save_connection_resource(p_resource jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  saved_resource_id uuid := nullif(trim(coalesce(p_resource->>'id', '')), '')::uuid;
  category_id uuid;
  location_id uuid;
  contact_id uuid;
  contact_kind text;
  contact jsonb;
  contact_value text;
  contact_consent_status text;
  contact_consented_by_name text;
  contact_consented_at timestamptz;
  contact_consent_method text;
  location_consent_status text := coalesce(nullif(trim(p_resource#>>'{location,address_consent_status}'), ''), 'not_requested');
  location_consent_method text := nullif(trim(coalesce(p_resource#>>'{location,address_consent_method}', '')), '');
  location_consented_at timestamptz := nullif(trim(coalesce(p_resource#>>'{location,address_consented_at}', '')), '')::timestamptz;
begin
  if not public.current_profile_is_active() then raise exception 'Active staff access is required.'; end if;
  if octet_length(coalesce(p_resource::text, '')) > 30000 then raise exception 'Resource is too large.'; end if;
  if trim(coalesce(p_resource->>'slug', '')) !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then raise exception 'Use a valid URL slug.'; end if;
  if length(trim(coalesce(p_resource->>'name', ''))) < 2 then raise exception 'Enter the resource name.'; end if;
  if length(trim(coalesce(p_resource->>'short_description', ''))) < 10 then raise exception 'Enter a short description.'; end if;
  if length(trim(coalesce(p_resource->>'description', ''))) < 20 then raise exception 'Enter a full description.'; end if;

  select id into category_id
  from public.connection_categories
  where slug = trim(coalesce(p_resource->>'category_slug', '')) and active = true;
  if category_id is null then raise exception 'Choose a valid category.'; end if;

  if saved_resource_id is null then
    insert into public.connection_resources (
      slug, name, short_description, description, worldview, worldview_details,
      age_min, age_max, grade_min, grade_max, age_grade_notes, delivery_mode,
      accepting_status, cost_type, homeschool_specific, daytime_available,
      homeschool_discount, service_area_summary, created_by, updated_by
    ) values (
      trim(p_resource->>'slug'), trim(p_resource->>'name'), trim(p_resource->>'short_description'),
      trim(p_resource->>'description'), coalesce(nullif(trim(p_resource->>'worldview'), ''), 'information_not_provided'),
      trim(coalesce(p_resource->>'worldview_details', '')),
      nullif(trim(coalesce(p_resource->>'age_min', '')), '')::smallint,
      nullif(trim(coalesce(p_resource->>'age_max', '')), '')::smallint,
      nullif(trim(coalesce(p_resource->>'grade_min', '')), '')::smallint,
      nullif(trim(coalesce(p_resource->>'grade_max', '')), '')::smallint,
      trim(coalesce(p_resource->>'age_grade_notes', '')),
      coalesce(nullif(trim(p_resource->>'delivery_mode'), ''), 'in_person'),
      coalesce(nullif(trim(p_resource->>'accepting_status'), ''), 'unknown'),
      coalesce(nullif(trim(p_resource->>'cost_type'), ''), 'contact'),
      coalesce((p_resource->>'homeschool_specific')::boolean, false),
      coalesce((p_resource->>'daytime_available')::boolean, false),
      coalesce((p_resource->>'homeschool_discount')::boolean, false),
      trim(coalesce(p_resource->>'service_area_summary', '')), auth.uid(), auth.uid()
    ) returning id into saved_resource_id;
  else
    if not exists (select 1 from public.connection_resources where id = saved_resource_id) then raise exception 'Resource not found.'; end if;
    update public.connection_resources set
      slug = trim(p_resource->>'slug'), name = trim(p_resource->>'name'),
      short_description = trim(p_resource->>'short_description'), description = trim(p_resource->>'description'),
      worldview = coalesce(nullif(trim(p_resource->>'worldview'), ''), 'information_not_provided'),
      worldview_details = trim(coalesce(p_resource->>'worldview_details', '')),
      age_min = nullif(trim(coalesce(p_resource->>'age_min', '')), '')::smallint,
      age_max = nullif(trim(coalesce(p_resource->>'age_max', '')), '')::smallint,
      grade_min = nullif(trim(coalesce(p_resource->>'grade_min', '')), '')::smallint,
      grade_max = nullif(trim(coalesce(p_resource->>'grade_max', '')), '')::smallint,
      age_grade_notes = trim(coalesce(p_resource->>'age_grade_notes', '')),
      delivery_mode = coalesce(nullif(trim(p_resource->>'delivery_mode'), ''), 'in_person'),
      accepting_status = coalesce(nullif(trim(p_resource->>'accepting_status'), ''), 'unknown'),
      cost_type = coalesce(nullif(trim(p_resource->>'cost_type'), ''), 'contact'),
      homeschool_specific = coalesce((p_resource->>'homeschool_specific')::boolean, false),
      daytime_available = coalesce((p_resource->>'daytime_available')::boolean, false),
      homeschool_discount = coalesce((p_resource->>'homeschool_discount')::boolean, false),
      service_area_summary = trim(coalesce(p_resource->>'service_area_summary', '')),
      updated_by = auth.uid()
    where id = saved_resource_id;
  end if;

  delete from public.connection_resource_categories link where link.resource_id = saved_resource_id;
  insert into public.connection_resource_categories (resource_id, category_id, is_primary)
  values (saved_resource_id, category_id, true);

  select candidate.id into location_id from public.connection_locations candidate
  where candidate.resource_id = saved_resource_id and candidate.archived_at is null
  order by candidate.is_primary desc, candidate.sort_order, candidate.created_at limit 1;

  if location_id is null then
    insert into public.connection_locations (
      resource_id, name, location_kind, address_line_1, city, county, state,
      postal_code, service_area, address_display, address_consent_status,
      address_consented_by_name, address_consented_at, address_consent_method, is_primary
    ) values (
      saved_resource_id, trim(coalesce(p_resource#>>'{location,name}', '')),
      coalesce(nullif(trim(p_resource#>>'{location,location_kind}'), ''), 'physical'),
      trim(coalesce(p_resource#>>'{location,address_line_1}', '')),
      trim(coalesce(p_resource#>>'{location,city}', '')), trim(coalesce(p_resource#>>'{location,county}', '')),
      coalesce(nullif(trim(p_resource#>>'{location,state}'), ''), 'IL'),
      trim(coalesce(p_resource#>>'{location,postal_code}', '')), trim(coalesce(p_resource#>>'{location,service_area}', '')),
      coalesce(nullif(trim(p_resource#>>'{location,address_display}'), ''), 'town_only'), location_consent_status,
      trim(coalesce(p_resource#>>'{location,address_consented_by_name}', '')), location_consented_at,
      location_consent_method, true
    ) returning id into location_id;
  else
    update public.connection_locations set
      name = trim(coalesce(p_resource#>>'{location,name}', '')),
      location_kind = coalesce(nullif(trim(p_resource#>>'{location,location_kind}'), ''), 'physical'),
      address_line_1 = trim(coalesce(p_resource#>>'{location,address_line_1}', '')),
      city = trim(coalesce(p_resource#>>'{location,city}', '')),
      county = trim(coalesce(p_resource#>>'{location,county}', '')),
      state = coalesce(nullif(trim(p_resource#>>'{location,state}'), ''), 'IL'),
      postal_code = trim(coalesce(p_resource#>>'{location,postal_code}', '')),
      service_area = trim(coalesce(p_resource#>>'{location,service_area}', '')),
      address_display = coalesce(nullif(trim(p_resource#>>'{location,address_display}'), ''), 'town_only'),
      address_consent_status = location_consent_status,
      address_consented_by_name = trim(coalesce(p_resource#>>'{location,address_consented_by_name}', '')),
      address_consented_at = location_consented_at, address_consent_method = location_consent_method,
      is_primary = true, updated_at = now()
    where id = location_id;
  end if;

  for contact_kind, contact in
    select key, value from jsonb_each(coalesce(p_resource->'contacts', '{}'::jsonb))
    where key in ('website', 'email', 'phone')
  loop
    contact_value := trim(coalesce(contact->>'value', ''));
    contact_consent_status := coalesce(nullif(trim(contact->>'consent_status'), ''), 'not_requested');
    contact_consented_by_name := trim(coalesce(contact->>'consented_by_name', ''));
    contact_consented_at := nullif(trim(coalesce(contact->>'consented_at', '')), '')::timestamptz;
    contact_consent_method := nullif(trim(coalesce(contact->>'consent_method', '')), '');
    select candidate.id into contact_id from public.connection_contact_methods candidate
    where candidate.resource_id = saved_resource_id and candidate.kind = contact_kind and candidate.archived_at is null
    order by candidate.sort_order, candidate.created_at limit 1;

    if contact_value = '' then
      if contact_id is not null then
        update public.connection_contact_methods set archived_at = now(), archived_by = auth.uid(), updated_at = now()
        where id = contact_id;
      end if;
    elsif contact_id is null then
      insert into public.connection_contact_methods (
        resource_id, kind, label, value, is_personal, intended_use, consent_status,
        consented_by_name, consented_at, consent_method
      ) values (
        saved_resource_id, contact_kind, initcap(contact_kind), contact_value, false, 'public_direct', contact_consent_status,
        contact_consented_by_name, contact_consented_at, contact_consent_method
      );
    else
      update public.connection_contact_methods set
        value = contact_value, consent_status = contact_consent_status, consented_by_name = contact_consented_by_name,
        consented_at = contact_consented_at, consent_method = contact_consent_method, revoked_at = null, updated_at = now()
      where id = contact_id;
    end if;
    contact_id := null;
  end loop;

  return saved_resource_id;
end;
$$;

revoke all on function public.get_connection_resource_editor(uuid) from public, anon, authenticated;
revoke all on function public.save_connection_resource(jsonb) from public, anon, authenticated;
grant execute on function public.get_connection_resource_editor(uuid) to authenticated;
grant execute on function public.save_connection_resource(jsonb) to authenticated;

notify pgrst, 'reload schema';
