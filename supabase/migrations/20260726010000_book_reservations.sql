create table if not exists public.book_reservations (
  id uuid primary key default gen_random_uuid(),
  item_id text not null,
  customer_name text not null,
  email text not null default '',
  phone text not null default '',
  preferred_contact text not null default 'email'
    check (preferred_contact in ('email', 'phone', 'either')),
  status text not null default 'pending'
    check (status in ('pending', 'ready', 'picked_up', 'cancelled', 'expired')),
  expires_at timestamptz not null default (now() + interval '14 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  handled_by uuid references auth.users(id) on delete set null,
  check (email <> '' or phone <> '')
);

create index if not exists book_reservations_item_active_idx
on public.book_reservations (item_id, expires_at)
where status in ('pending', 'ready');

create index if not exists book_reservations_staff_queue_idx
on public.book_reservations (status, expires_at, created_at);

alter table public.book_reservations enable row level security;

drop policy if exists "book reservations staff manage" on public.book_reservations;
create policy "book reservations staff manage"
on public.book_reservations for all to authenticated
using (public.current_profile_is_active())
with check (public.current_profile_is_active());

grant select, insert, update on public.book_reservations to authenticated;

create or replace function public.submit_book_reservation(
  p_item_id text,
  p_customer_name text,
  p_email text default '',
  p_phone text default '',
  p_preferred_contact text default 'email',
  p_website text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  item_record public.items%rowtype;
  active_reservation_count integer;
  recent_count integer;
  clean_email text := left(lower(trim(coalesce(p_email, ''))), 254);
  clean_phone text := left(trim(coalesce(p_phone, '')), 40);
  reservation_record public.book_reservations%rowtype;
begin
  -- Honeypot field: real visitors never see or fill this.
  if trim(coalesce(p_website, '')) <> '' then return null; end if;

  if length(trim(coalesce(p_customer_name, ''))) < 2 then
    raise exception 'Please enter your name.';
  end if;
  if clean_email = '' and clean_phone = '' then
    raise exception 'Please enter an email address or phone number.';
  end if;
  if clean_email <> '' and clean_email !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then
    raise exception 'Please enter a valid email address.';
  end if;
  if p_preferred_contact not in ('email', 'phone', 'either') then
    raise exception 'Invalid contact preference.';
  end if;
  if clean_email = '' and p_preferred_contact = 'email' then
    raise exception 'An email address is required for email contact.';
  end if;
  if clean_phone = '' and p_preferred_contact = 'phone' then
    raise exception 'A phone number is required for phone contact.';
  end if;

  select count(*) into recent_count
  from public.book_reservations
  where created_at > now() - interval '24 hours'
    and (
      (clean_email <> '' and lower(email) = clean_email)
      or (clean_phone <> '' and phone = clean_phone)
    );
  if recent_count >= 5 then
    raise exception 'Too many recent reservations. Please contact IL HRC for help.';
  end if;

  -- Lock the inventory row so two customers cannot reserve the final copy.
  select * into item_record
  from public.items
  where id::text = trim(coalesce(p_item_id, ''))
  for update;

  if not found
    or coalesce(item_record.status, 'Available') <> 'Available'
    or coalesce(item_record.public_visible, true) = false
    or coalesce(item_record.quantity, 0) < 1
  then
    raise exception 'This book is no longer available to reserve.';
  end if;

  if exists (
    select 1
    from public.book_reservations
    where item_id = item_record.id::text
      and status in ('pending', 'ready')
      and expires_at > now()
      and (
        (clean_email <> '' and lower(email) = clean_email)
        or (clean_phone <> '' and phone = clean_phone)
      )
  ) then
    raise exception 'You already have an active reservation for this book.';
  end if;

  select count(*) into active_reservation_count
  from public.book_reservations
  where item_id = item_record.id::text
    and status in ('pending', 'ready')
    and expires_at > now();

  if active_reservation_count >= item_record.quantity then
    raise exception 'The last available copy was just reserved.';
  end if;

  insert into public.book_reservations (
    item_id,
    customer_name,
    email,
    phone,
    preferred_contact
  ) values (
    item_record.id::text,
    left(trim(p_customer_name), 120),
    clean_email,
    clean_phone,
    p_preferred_contact
  )
  returning * into reservation_record;

  return jsonb_build_object(
    'id', reservation_record.id,
    'item_id', reservation_record.item_id,
    'title', item_record.title,
    'expires_at', reservation_record.expires_at
  );
end
$$;

revoke all on function public.submit_book_reservation(text,text,text,text,text,text)
from public;
grant execute on function public.submit_book_reservation(text,text,text,text,text,text)
to anon, authenticated;

create or replace function public.expire_book_reservations()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  expired_count integer;
begin
  if auth.uid() is not null and not public.current_profile_is_active() then
    raise exception 'Active staff access is required.';
  end if;

  update public.book_reservations
  set status = 'expired', updated_at = now()
  where status in ('pending', 'ready')
    and expires_at <= now();

  get diagnostics expired_count = row_count;
  return expired_count;
end
$$;

revoke all on function public.expire_book_reservations() from public, anon;
grant execute on function public.expire_book_reservations() to authenticated;

create or replace function public.update_book_reservation_status(
  p_reservation_id uuid,
  p_status text
)
returns public.book_reservations
language plpgsql
security definer
set search_path = public
as $$
declare
  reservation_record public.book_reservations%rowtype;
  item_record public.items%rowtype;
begin
  if not public.current_profile_is_active() then
    raise exception 'Active staff access is required.';
  end if;
  if p_status not in ('pending', 'ready', 'picked_up', 'cancelled', 'expired') then
    raise exception 'Invalid reservation status.';
  end if;

  select * into reservation_record
  from public.book_reservations
  where id = p_reservation_id
  for update;
  if not found then raise exception 'Reservation not found.'; end if;

  if reservation_record.status in ('picked_up', 'cancelled') then
    raise exception 'Completed reservations cannot be changed.';
  end if;
  if (reservation_record.status = 'pending' and p_status not in ('ready', 'cancelled', 'expired'))
    or (reservation_record.status = 'ready' and p_status not in ('picked_up', 'cancelled', 'expired'))
    or reservation_record.status = 'expired'
  then
    raise exception 'Invalid reservation status transition.';
  end if;
  if p_status in ('ready', 'picked_up')
    and (
      reservation_record.status = 'expired'
      or reservation_record.expires_at <= now()
    )
  then
    raise exception 'This reservation has expired. Extend it before continuing.';
  end if;

  if p_status = 'picked_up' then
    select * into item_record
    from public.items
    where id::text = reservation_record.item_id
    for update;
    if not found or coalesce(item_record.quantity, 0) < 1 then
      raise exception 'No inventory copy remains to complete this pickup.';
    end if;

    update public.items
    set
      quantity = item_record.quantity - 1,
      status = case when item_record.quantity - 1 <= 0 then 'Sold' else item_record.status end,
      updated_at = now()
    where id::text = reservation_record.item_id;
  end if;

  update public.book_reservations
  set
    status = p_status,
    handled_by = auth.uid(),
    updated_at = now()
  where id = p_reservation_id
  returning * into reservation_record;

  insert into public.audit_logs (user_id, action, entity_type, entity_id, details)
  values (
    auth.uid(),
    'reservation_status_changed',
    'book_reservation',
    reservation_record.id::text,
    jsonb_build_object('status', p_status, 'item_id', reservation_record.item_id)
  );

  return reservation_record;
end
$$;

revoke all on function public.update_book_reservation_status(uuid,text)
from public, anon;
grant execute on function public.update_book_reservation_status(uuid,text)
to authenticated;

create or replace function public.extend_book_reservation(
  p_reservation_id uuid,
  p_days integer default 7
)
returns public.book_reservations
language plpgsql
security definer
set search_path = public
as $$
declare
  reservation_record public.book_reservations%rowtype;
  item_record public.items%rowtype;
  active_reservation_count integer;
begin
  if not public.current_profile_is_active() then
    raise exception 'Active staff access is required.';
  end if;
  if p_days < 1 or p_days > 30 then
    raise exception 'Extension must be between 1 and 30 days.';
  end if;

  select * into reservation_record
  from public.book_reservations
  where id = p_reservation_id
  for update;

  if not found or reservation_record.status not in ('pending', 'ready', 'expired') then
    raise exception 'Only active or expired reservations can be extended.';
  end if;

  -- An expired hold may only be reactivated if a copy is still available.
  if reservation_record.status = 'expired' or reservation_record.expires_at <= now() then
    select * into item_record
    from public.items
    where id::text = reservation_record.item_id
    for update;

    if not found
      or coalesce(item_record.status, 'Available') <> 'Available'
      or coalesce(item_record.quantity, 0) < 1
    then
      raise exception 'This book is no longer available to reserve.';
    end if;

    select count(*) into active_reservation_count
    from public.book_reservations
    where item_id = reservation_record.item_id
      and id <> reservation_record.id
      and status in ('pending', 'ready')
      and expires_at > now();

    if active_reservation_count >= item_record.quantity then
      raise exception 'No copy is available to reactivate this reservation.';
    end if;
  end if;

  update public.book_reservations
  set
    status = case when status = 'expired' then 'pending' else status end,
    expires_at = greatest(expires_at, now()) + make_interval(days => p_days),
    handled_by = auth.uid(),
    updated_at = now()
  where id = p_reservation_id
    and status in ('pending', 'ready', 'expired')
  returning * into reservation_record;

  insert into public.audit_logs (user_id, action, entity_type, entity_id, details)
  values (
    auth.uid(),
    'reservation_extended',
    'book_reservation',
    reservation_record.id::text,
    jsonb_build_object('days', p_days, 'item_id', reservation_record.item_id)
  );

  return reservation_record;
end
$$;

revoke all on function public.extend_book_reservation(uuid,integer)
from public, anon;
grant execute on function public.extend_book_reservation(uuid,integer)
to authenticated;

-- Public availability is physical quantity minus unexpired pickup reservations.
create or replace view public.public_catalog_items as
select
  item.id,
  item.title,
  item.curriculum,
  item.subject,
  item.grade_level,
  item.category,
  item.edition,
  item.isbn,
  item.final_price,
  greatest(item.quantity::integer - coalesce(reservation.active_count, 0), 0)::smallint as quantity,
  item.image_url,
  item.created_at
from public.items item
left join lateral (
  select count(*)::integer as active_count
  from public.book_reservations
  where item_id = item.id::text
    and status in ('pending', 'ready')
    and expires_at > now()
) reservation on true
where coalesce(item.status, 'Available') = 'Available'
  and coalesce(item.public_visible, true) = true
  and greatest(item.quantity - coalesce(reservation.active_count, 0), 0) > 0;

grant select on public.public_catalog_items to anon, authenticated;

create extension if not exists pg_cron;
do $$
begin
  if not exists (
    select 1 from cron.job where jobname = 'book-reservation-expiry'
  ) then
    perform cron.schedule(
      'book-reservation-expiry',
      '15 * * * *',
      'select public.expire_book_reservations();'
    );
  end if;
end
$$;

notify pgrst, 'reload schema';
