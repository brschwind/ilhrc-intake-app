-- Keep stock receipt, custom SKU and listing photo in the same transaction.
begin;
create or replace function public.receive_ace_intake(p_item jsonb,p_quantity integer,p_existing_id text default null,p_request_id uuid default gen_random_uuid())
returns jsonb language plpgsql security definer set search_path=public as $$
declare saved public.items; receipt public.ace_intake_receipts;
  requested_sku text := nullif(upper(btrim(p_item->>'sku')), '');
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
  if requested_sku is not null then
    if requested_sku !~ '^[A-Z0-9][A-Z0-9._/-]{0,63}$' then
      raise exception 'SKU must be 1-64 letters, numbers, dots, slashes, underscores or hyphens.';
    end if;
    perform pg_advisory_xact_lock(hashtextextended(requested_sku,1));
    if exists(select 1 from public.items where upper(sku)=requested_sku and (p_existing_id is null or id::text<>p_existing_id)) then
      raise exception 'This SKU is already in use. Choose another SKU or increase the matching listing quantity.';
    end if;
  end if;
  if p_existing_id is not null then
    select * into saved from public.items where id::text=p_existing_id for update;
    if not found then raise exception 'Existing listing no longer exists.'; end if;
    if requested_sku is not null and requested_sku<>upper(saved.sku) then raise exception 'Use the existing listing SKU or create a separate listing.'; end if;
    if saved.ace_details is distinct from p_item->'ace_details' or saved.final_price is distinct from (p_item->>'final_price')::numeric
      or saved.subject is distinct from p_item->>'subject' or saved.grade_level is distinct from p_item->>'grade_level'
      or saved.edition is distinct from p_item->>'edition' or saved.condition is distinct from p_item->>'condition'
      or saved.status not in ('Available','Hold') then
      raise exception 'Listing details or selling price changed. Review the duplicate again.';
    end if;
  else
    insert into public.items(title,notes,category,primary_category,subcategory,curriculum,publisher,subject,grade_level,edition,condition,suggested_price,final_price,image_url,quantity,sku,item_type,ace_details,status,public_visible,label_printed,pending_label_quantity,label_queued_at)
    values(p_item->>'title',p_item->>'notes',p_item->>'category','Curriculum','ACE / School of Tomorrow','ACE','ACE / School of Tomorrow',p_item->>'subject',p_item->>'grade_level',p_item->>'edition',p_item->>'condition',(p_item->>'suggested_price')::numeric,(p_item->>'final_price')::numeric,coalesce(p_item->>'image_url',''),0,coalesce(requested_sku,public.next_inventory_sku('individual')),'individual',p_item->'ace_details','Available',true,false,0,now()) returning * into saved;
  end if;
  if p_existing_id is not null and nullif(p_item->>'image_url','') is not null then
    update public.items set image_url=p_item->>'image_url' where id=saved.id;
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
