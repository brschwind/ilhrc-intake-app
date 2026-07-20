create or replace function public.get_exact_isbn_memory(lookup_isbn text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  normalized_isbn text;
  remembered_values jsonb;
begin
  if not public.current_profile_is_active() then
    raise exception 'Active staff access is required.';
  end if;

  normalized_isbn := lower(regexp_replace(coalesce(lookup_isbn, ''), '[^0-9x]', '', 'g'));
  if length(normalized_isbn) < 10 then return null; end if;

  select jsonb_build_object(
    'curriculum', coalesce(final_values->>'curriculum', ''),
    'subject', coalesce(final_values->>'subject', ''),
    'grade_level', coalesce(final_values->>'grade_level', ''),
    'category', coalesce(final_values->>'category', ''),
    'final_price', coalesce(final_values->>'final_price', ''),
    'memory_source', 'intake_history',
    'remembered_at', created_at
  )
  into remembered_values
  from public.intake_history
  where lower(regexp_replace(isbn, '[^0-9x]', '', 'g')) = normalized_isbn
  order by created_at desc limit 1;

  if remembered_values is not null then return remembered_values; end if;

  select jsonb_build_object(
    'curriculum', coalesce(curriculum, ''),
    'subject', coalesce(subject, ''),
    'grade_level', coalesce(grade_level, ''),
    'category', coalesce(category, ''),
    'final_price', coalesce(final_price::text, ''),
    'memory_source', 'existing_inventory',
    'remembered_at', created_at
  )
  into remembered_values
  from public.items
  where lower(regexp_replace(coalesce(isbn, ''), '[^0-9x]', '', 'g')) = normalized_isbn
  order by
    case when coalesce(status, 'Available') = 'Available' then 0 else 1 end,
    created_at desc
  limit 1;

  return remembered_values;
end
$$;

revoke all on function public.get_exact_isbn_memory(text) from public;
grant execute on function public.get_exact_isbn_memory(text) to authenticated;
