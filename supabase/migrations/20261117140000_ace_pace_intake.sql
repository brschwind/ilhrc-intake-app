begin;
-- Pricing categories remain unchanged; curriculum taxonomy is independent.
alter table public.items add column if not exists primary_category text,
  add column if not exists condition text,
  add column if not exists subcategory text,
  add column if not exists ace_details jsonb;
create index if not exists items_ace_details_idx on public.items using gin(ace_details);
create table public.ace_pricing (
  id integer primary key check(id=1),
  prices jsonb not null,
  check (jsonb_typeof(prices)='object'
    and prices ?& array['complete','older','individual','partial','scoreKey','test']
    and (prices->>'complete')::numeric >= 0 and (prices->>'older')::numeric >= 0
    and (prices->>'individual')::numeric >= 0 and (prices->>'partial')::numeric >= 0
    and (prices->>'scoreKey')::numeric >= 0 and (prices->>'test')::numeric >= 0)
);
insert into public.ace_pricing values(1,'{"complete":8,"older":5,"individual":0.75,"partial":0.5,"scoreKey":1,"test":0.25}');
alter table public.ace_pricing enable row level security;
create policy ace_prices_staff_read on public.ace_pricing for select to authenticated using(public.current_profile_is_active());
create policy ace_prices_admin_update on public.ace_pricing for update to authenticated using(public.current_profile_is_admin()) with check(public.current_profile_is_admin());
grant select,update on public.ace_pricing to authenticated;
create table public.ace_intake_receipts(request_id uuid primary key, item_id text not null, quantity integer not null, created_at timestamptz default now());
alter table public.ace_intake_receipts enable row level security;

create or replace function public.receive_ace_intake(p_item jsonb,p_quantity integer,p_existing_id text default null,p_request_id uuid default gen_random_uuid())
returns jsonb language plpgsql security definer set search_path=public as $$
declare saved public.items; receipt public.ace_intake_receipts;
begin
  if not public.current_profile_is_active() then raise exception 'Active staff access required.'; end if;
  if p_request_id is null then raise exception 'Request ID required.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
  select * into receipt from public.ace_intake_receipts where request_id=p_request_id;
  if found then
    select * into saved from public.items where id::text=receipt.item_id;
    return to_jsonb(saved)||jsonb_build_object('received_quantity',receipt.quantity);
  end if;
  if p_quantity is null or p_quantity<1 or p_quantity>10000 then raise exception 'Invalid quantity.'; end if;
  if jsonb_typeof(p_item->'ace_details') is distinct from 'object'
    or jsonb_typeof(p_item->'ace_details'->'numbers') is distinct from 'array'
    or nullif(p_item->>'title','') is null
    or (p_item->>'final_price') is null or (p_item->>'final_price')::numeric<0 then raise exception 'Invalid ACE listing.'; end if;
  if p_existing_id is not null then
    select * into saved from public.items where id::text=p_existing_id for update;
    if not found then raise exception 'Existing listing no longer exists.'; end if;
    if saved.ace_details is distinct from p_item->'ace_details' or saved.final_price is distinct from (p_item->>'final_price')::numeric
      or saved.subject is distinct from p_item->>'subject' or saved.grade_level is distinct from p_item->>'grade_level'
      or saved.edition is distinct from p_item->>'edition' or saved.condition is distinct from p_item->>'condition'
      or saved.status not in ('Available','Hold') then
      raise exception 'Listing details or selling price changed. Review the duplicate again.';
    end if;
  else
    insert into public.items(title,notes,category,primary_category,subcategory,curriculum,publisher,subject,grade_level,edition,condition,suggested_price,final_price,quantity,sku,item_type,ace_details,status,public_visible,label_printed,pending_label_quantity,label_queued_at)
    values(p_item->>'title',p_item->>'notes',p_item->>'category','Curriculum','ACE / School of Tomorrow','ACE','ACE / School of Tomorrow',p_item->>'subject',p_item->>'grade_level',p_item->>'edition',p_item->>'condition',(p_item->>'suggested_price')::numeric,(p_item->>'final_price')::numeric,0,public.next_inventory_sku('individual'),'individual',p_item->'ace_details','Available',true,false,0,now()) returning * into saved;
  end if;
  -- Twelve enclosed PACEs still receive only ONE stock unit per set.
  perform public.receive_inventory_to_processing(saved.id::text,p_quantity,'ACE PACE intake');
  update public.items set label_printed=false,pending_label_quantity=coalesce(pending_label_quantity,0)+p_quantity,label_queued_at=now() where id=saved.id returning * into saved;
  insert into public.ace_intake_receipts values(p_request_id,saved.id::text,p_quantity,now());
  insert into public.audit_logs(user_id,action,entity_type,entity_id,details) values(auth.uid(),'ace_intake','item',saved.id::text,jsonb_build_object('quantity',p_quantity,'ace_details',saved.ace_details));
  return to_jsonb(saved)||jsonb_build_object('received_quantity',p_quantity);
end $$;
revoke all on function public.receive_ace_intake(jsonb,integer,text,uuid) from public,anon;
grant execute on function public.receive_ace_intake(jsonb,integer,text,uuid) to authenticated;
commit;
