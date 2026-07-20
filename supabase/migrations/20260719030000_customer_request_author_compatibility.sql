-- The first matching function used items.author as a fallback. Older IL HRC
-- databases do not have that column, so add it for compatibility. Author
-- matching continues to prefer the structured value saved in intake history.
alter table public.items
add column if not exists author text not null default '';

-- Older inventory may predate structured intake history. Add one baseline
-- history record so a newly submitted customer request can match it.
insert into public.intake_history (
  item_id, isbn, source_type, final_values, duplicate_item, created_at
)
select
  item.id::text,
  coalesce(item.isbn, ''),
  'manual',
  jsonb_build_object(
    'title', coalesce(item.title, ''),
    'author', coalesce(item.author, ''),
    'curriculum', coalesce(item.curriculum, ''),
    'subject', coalesce(item.subject, ''),
    'grade_level', coalesce(item.grade_level, ''),
    'category', coalesce(item.category, ''),
    'isbn', coalesce(item.isbn, '')
  ),
  false,
  coalesce(item.created_at, now())
from public.items item
where not exists (
  select 1 from public.intake_history history
  where history.item_id = item.id::text
);

notify pgrst, 'reload schema';
