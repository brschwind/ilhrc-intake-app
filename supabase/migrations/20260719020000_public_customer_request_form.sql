create or replace function public.submit_customer_request(
  p_customer_name text,
  p_email text default '',
  p_phone text default '',
  p_preferred_contact text default 'email',
  p_isbn text default '',
  p_title text default '',
  p_author text default '',
  p_curriculum text default '',
  p_subject text default '',
  p_grade_level text default '',
  p_notes text default '',
  p_website text default ''
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
  recent_count integer;
  clean_email text := lower(trim(coalesce(p_email, '')));
  clean_phone text := trim(coalesce(p_phone, ''));
begin
  -- Honeypot field: real visitors never see or fill this.
  if trim(coalesce(p_website, '')) <> '' then return null; end if;

  if length(trim(coalesce(p_customer_name, ''))) < 2 then raise exception 'Please enter your name.'; end if;
  if clean_email = '' and clean_phone = '' then raise exception 'Please enter an email address or phone number.'; end if;
  if clean_email <> '' and clean_email !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then raise exception 'Please enter a valid email address.'; end if;
  if p_preferred_contact not in ('email', 'phone', 'either') then raise exception 'Invalid contact preference.'; end if;
  if clean_email = '' and p_preferred_contact = 'email' then raise exception 'An email address is required for email contact.'; end if;
  if clean_phone = '' and p_preferred_contact = 'phone' then raise exception 'A phone number is required for phone contact.'; end if;
  if public.normalize_request_text(p_isbn) = '' and public.normalize_request_text(p_title) = ''
    and public.normalize_request_text(p_author) = '' and public.normalize_request_text(p_curriculum) = ''
    and public.normalize_request_text(p_subject) = '' and public.normalize_request_text(p_grade_level) = ''
  then raise exception 'Please describe the book or curriculum you want.'; end if;

  select count(*) into recent_count from public.customer_requests
  where created_at > now() - interval '1 hour'
    and ((clean_email <> '' and lower(email) = clean_email) or (clean_phone <> '' and phone = clean_phone));
  if recent_count >= 5 then raise exception 'Too many recent requests. Please try again later.'; end if;

  insert into public.customer_requests (
    customer_name, email, phone, preferred_contact, isbn, title, author,
    curriculum, subject, grade_level, notes
  ) values (
    left(trim(p_customer_name), 120), left(clean_email, 254), left(clean_phone, 40), p_preferred_contact,
    left(trim(p_isbn), 40), left(trim(p_title), 300), left(trim(p_author), 200),
    left(trim(p_curriculum), 200), left(trim(p_subject), 120), left(trim(p_grade_level), 120), left(trim(p_notes), 1000)
  ) returning id into new_id;

  return new_id;
end
$$;

revoke all on function public.submit_customer_request(text,text,text,text,text,text,text,text,text,text,text,text) from public;
grant execute on function public.submit_customer_request(text,text,text,text,text,text,text,text,text,text,text,text) to anon, authenticated;

-- Ask Supabase's API layer to discover the new RPC immediately.
notify pgrst, 'reload schema';
