-- Prevent broad fields such as Subject or Grade Level from creating matches on
-- their own. Matching follows the most specific identifier supplied by the
-- customer: ISBN, then title, then author, then curriculum plus context.

create or replace function public.customer_request_candidate_matches(
  p_request public.customer_requests,
  p_history public.intake_history,
  p_item public.items
)
returns boolean
language sql
stable
set search_path = public
as $$
  select case
    when public.normalize_request_text(p_request.isbn) <> '' then
      public.normalize_request_text(p_request.isbn) =
        public.normalize_request_text(coalesce(nullif(p_history.isbn, ''), p_item.isbn))

    when length(public.normalize_request_text(p_request.title)) >= 4 then
      public.normalize_request_text(coalesce(p_history.final_values->>'title', p_item.title))
        like '%' || public.normalize_request_text(p_request.title) || '%'

    when public.normalize_request_text(p_request.author) <> '' then
      public.normalize_request_text(coalesce(p_history.final_values->>'author', p_item.author)) =
        public.normalize_request_text(p_request.author)

    when public.normalize_request_text(p_request.curriculum) <> '' then
      public.normalize_request_text(coalesce(p_history.final_values->>'curriculum', p_item.curriculum)) =
        public.normalize_request_text(p_request.curriculum)
      and (
        (public.normalize_request_text(p_request.subject) <> '' and
          public.normalize_request_text(coalesce(p_history.final_values->>'subject', p_item.subject)) =
            public.normalize_request_text(p_request.subject))
        or
        (public.normalize_request_text(p_request.grade_level) <> '' and
          public.normalize_request_text(coalesce(p_history.final_values->>'grade_level', p_item.grade_level)) =
            public.normalize_request_text(p_request.grade_level))
      )

    else false
  end
$$;

revoke all on function public.customer_request_candidate_matches(
  public.customer_requests, public.intake_history, public.items
) from public, anon, authenticated;

create or replace function public.match_customer_request_inventory(
  p_request_id uuid default null,
  p_intake_history_ids uuid[] default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  created_count integer := 0;
begin
  insert into public.customer_request_matches
    (request_id, item_id, intake_history_id, match_strength, match_reasons)
  select distinct on (request.id, history.item_id)
    request.id,
    history.item_id,
    history.id,
    case
      when public.normalize_request_text(request.isbn) <> '' then 'exact'
      when public.normalize_request_text(coalesce(history.final_values->>'title', item.title)) =
        public.normalize_request_text(request.title) then 'strong'
      else 'possible'
    end,
    to_jsonb(array_remove(array[
      case when public.normalize_request_text(request.isbn) <> '' and public.normalize_request_text(request.isbn) = public.normalize_request_text(coalesce(nullif(history.isbn, ''), item.isbn)) then 'ISBN' end,
      case when public.normalize_request_text(request.title) <> '' and public.normalize_request_text(coalesce(history.final_values->>'title', item.title)) like '%' || public.normalize_request_text(request.title) || '%' then 'Title' end,
      case when public.normalize_request_text(request.author) <> '' and public.normalize_request_text(coalesce(history.final_values->>'author', item.author)) = public.normalize_request_text(request.author) then 'Author' end,
      case when public.normalize_request_text(request.curriculum) <> '' and public.normalize_request_text(coalesce(history.final_values->>'curriculum', item.curriculum)) = public.normalize_request_text(request.curriculum) then 'Curriculum' end,
      case when public.normalize_request_text(request.subject) <> '' and public.normalize_request_text(coalesce(history.final_values->>'subject', item.subject)) = public.normalize_request_text(request.subject) then 'Subject' end,
      case when public.normalize_request_text(request.grade_level) <> '' and public.normalize_request_text(coalesce(history.final_values->>'grade_level', item.grade_level)) = public.normalize_request_text(request.grade_level) then 'Grade level' end
    ], null))
  from public.customer_requests request
  join public.intake_history history
    on (p_intake_history_ids is null or history.id = any(p_intake_history_ids))
  join public.items item on item.id::text = history.item_id
  where request.status = 'active'
    and (p_request_id is null or request.id = p_request_id)
    and coalesce(item.status, 'Available') in ('Available', 'Hold')
    and coalesce(item.quantity, 0) > 0
    and public.customer_request_candidate_matches(request, history, item)
  order by request.id, history.item_id, history.created_at, history.id
  on conflict (request_id, item_id) do nothing;

  get diagnostics created_count = row_count;
  return created_count;
end
$$;

revoke all on function public.match_customer_request_inventory(uuid, uuid[]) from public, anon, authenticated;

-- Remove only unreviewed false positives produced by the earlier broad rule.
-- Contacted, fulfilled, rejected, and still-waiting decisions are preserved.
delete from public.customer_request_matches match
using public.customer_requests request, public.intake_history history, public.items item
where match.request_id = request.id
  and match.intake_history_id = history.id
  and match.item_id = item.id::text
  and match.status = 'pending'
  and not public.customer_request_candidate_matches(request, history, item);

notify pgrst, 'reload schema';
