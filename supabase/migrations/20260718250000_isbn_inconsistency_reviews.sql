create table if not exists public.isbn_inconsistency_reviews (
  isbn text primary key,
  record_signature text not null,
  status text not null default 'dismissed' check (status = 'dismissed'),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz not null default now()
);

alter table public.isbn_inconsistency_reviews enable row level security;

drop policy if exists "isbn inconsistency reviews admin manage" on public.isbn_inconsistency_reviews;
create policy "isbn inconsistency reviews admin manage"
on public.isbn_inconsistency_reviews for all to authenticated
using (public.current_profile_is_admin())
with check (public.current_profile_is_admin());

grant select, insert, update, delete on public.isbn_inconsistency_reviews to authenticated;
