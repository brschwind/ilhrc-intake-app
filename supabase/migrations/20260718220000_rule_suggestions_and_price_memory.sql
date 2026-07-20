create table if not exists public.intake_rule_suggestion_reviews (
  suggestion_key text primary key,
  status text not null check (status in ('dismissed', 'deferred', 'approved')),
  sample_count_at_review integer not null default 0,
  details jsonb not null default '{}'::jsonb,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz not null default now()
);

alter table public.intake_rule_suggestion_reviews enable row level security;

drop policy if exists "suggestion reviews admin manage" on public.intake_rule_suggestion_reviews;
create policy "suggestion reviews admin manage"
on public.intake_rule_suggestion_reviews for all to authenticated
using (public.current_profile_is_admin())
with check (public.current_profile_is_admin());

grant select, insert, update, delete on public.intake_rule_suggestion_reviews to authenticated;

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
    'remembered_at', created_at
  )
  into remembered_values
  from public.intake_history
  where lower(regexp_replace(isbn, '[^0-9x]', '', 'g')) = normalized_isbn
  order by created_at desc limit 1;

  return remembered_values;
end
$$;

revoke all on function public.get_exact_isbn_memory(text) from public;
grant execute on function public.get_exact_isbn_memory(text) to authenticated;
