create or replace function public.merge_inventory_items(
  p_keeper_id text,
  p_duplicate_ids text[],
  p_values jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  keeper_record public.items%rowtype;
  duplicate_count integer;
  mismatched_count integer;
  normalized_isbn text;
  merged_record public.items%rowtype;
begin
  if not public.current_profile_is_admin() then
    raise exception 'Administrator access is required.';
  end if;

  select * into keeper_record
  from public.items
  where id::text = p_keeper_id
  for update;

  if not found then raise exception 'The surviving inventory record was not found.'; end if;
  if coalesce(array_length(p_duplicate_ids, 1), 0) = 0 then
    raise exception 'At least one duplicate record is required.';
  end if;

  normalized_isbn := lower(regexp_replace(coalesce(keeper_record.isbn, ''), '[^0-9x]', '', 'g'));
  if length(normalized_isbn) < 10 then raise exception 'A valid shared ISBN is required.'; end if;

  select count(*) into duplicate_count
  from public.items
  where id::text = any(p_duplicate_ids)
    and id::text <> p_keeper_id;

  if duplicate_count <> array_length(p_duplicate_ids, 1) then
    raise exception 'One or more duplicate records were not found.';
  end if;

  select count(*) into mismatched_count
  from public.items
  where id::text = any(p_duplicate_ids)
    and lower(regexp_replace(coalesce(isbn, ''), '[^0-9x]', '', 'g')) <> normalized_isbn;

  if mismatched_count > 0 then raise exception 'All merged records must share the same ISBN.'; end if;

  update public.items
  set
    title = p_values->>'title',
    publisher = coalesce(p_values->>'publisher', ''),
    curriculum = coalesce(p_values->>'curriculum', ''),
    subject = coalesce(p_values->>'subject', ''),
    grade_level = coalesce(p_values->>'grade_level', ''),
    category = coalesce(p_values->>'category', ''),
    edition = coalesce(p_values->>'edition', ''),
    location = coalesce(p_values->>'location', ''),
    final_price = nullif(p_values->>'final_price', '')::numeric,
    quantity = (p_values->>'quantity')::integer,
    square_item_id = coalesce(nullif(p_values->>'square_item_id', ''), square_item_id),
    square_variation_id = coalesce(nullif(p_values->>'square_variation_id', ''), square_variation_id),
    label_printed = false,
    updated_at = now()
  where id::text = p_keeper_id
  returning * into merged_record;

  delete from public.items
  where id::text = any(p_duplicate_ids)
    and id::text <> p_keeper_id;

  return to_jsonb(merged_record);
end
$$;

revoke all on function public.merge_inventory_items(text, text[], jsonb) from public;
grant execute on function public.merge_inventory_items(text, text[], jsonb) to authenticated;
