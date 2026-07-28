alter table public.items
add column if not exists pending_label_quantity integer not null default 0,
add column if not exists label_queued_at timestamptz;

alter table public.items
drop constraint if exists items_pending_label_quantity_nonnegative;

alter table public.items
add constraint items_pending_label_quantity_nonnegative
check (pending_label_quantity >= 0);

update public.items
set
  pending_label_quantity = greatest(coalesce(quantity, 0), 0),
  label_queued_at = coalesce(updated_at, created_at, now())
where label_printed is not true
  and pending_label_quantity = 0;
