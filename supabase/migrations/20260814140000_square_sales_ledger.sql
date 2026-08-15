alter table public.items
add column if not exists sold_quantity integer not null default 0;

create table if not exists public.square_order_sales (
  order_id text not null,
  line_uid text not null,
  catalog_object_id text not null,
  item_id text not null,
  quantity integer not null check (quantity > 0),
  closed_at timestamptz not null,
  received_at timestamptz not null default now(),
  primary key (order_id, line_uid)
);

alter table public.square_order_sales enable row level security;

create index if not exists square_order_sales_catalog_object_idx
on public.square_order_sales (catalog_object_id);

create or replace function public.record_square_order_sales(p_orders jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  order_entry jsonb;
  line_entry jsonb;
  matched_item_id text;
  previous_quantity integer;
  line_quantity integer;
  quantity_delta integer;
  recorded_lines integer := 0;
  updated_lines integer := 0;
  sold_copies_delta integer := 0;
begin
  if jsonb_typeof(p_orders) <> 'array' then
    raise exception 'Square orders must be a JSON array.';
  end if;

  for order_entry in select value from jsonb_array_elements(p_orders)
  loop
    if trim(coalesce(order_entry->>'order_id', '')) = ''
      or nullif(order_entry->>'closed_at', '') is null
      or jsonb_typeof(order_entry->'lines') <> 'array'
    then
      continue;
    end if;

    for line_entry in select value from jsonb_array_elements(order_entry->'lines')
    loop
      line_quantity := nullif(line_entry->>'quantity', '')::integer;
      if trim(coalesce(line_entry->>'line_uid', '')) = ''
        or trim(coalesce(line_entry->>'catalog_object_id', '')) = ''
        or line_quantity is null
        or line_quantity <= 0
      then
        continue;
      end if;

      select item.id::text
      into matched_item_id
      from public.items item
      where item.square_variation_id = line_entry->>'catalog_object_id'
        and coalesce(item.status, 'Available') <> 'Bundled'
      order by item.updated_at desc nulls last, item.id
      limit 1;

      if matched_item_id is null then
        continue;
      end if;

      select sale.quantity
      into previous_quantity
      from public.square_order_sales sale
      where sale.order_id = order_entry->>'order_id'
        and sale.line_uid = line_entry->>'line_uid';

      if not found then
        insert into public.square_order_sales (
          order_id, line_uid, catalog_object_id, item_id, quantity, closed_at
        ) values (
          order_entry->>'order_id',
          line_entry->>'line_uid',
          line_entry->>'catalog_object_id',
          matched_item_id,
          line_quantity,
          (order_entry->>'closed_at')::timestamptz
        );
        quantity_delta := line_quantity;
        recorded_lines := recorded_lines + 1;
      elsif previous_quantity <> line_quantity then
        update public.square_order_sales
        set
          quantity = line_quantity,
          catalog_object_id = line_entry->>'catalog_object_id',
          item_id = matched_item_id,
          closed_at = (order_entry->>'closed_at')::timestamptz,
          received_at = now()
        where order_id = order_entry->>'order_id'
          and line_uid = line_entry->>'line_uid';
        quantity_delta := line_quantity - previous_quantity;
        updated_lines := updated_lines + 1;
      else
        continue;
      end if;

      update public.items
      set sold_quantity = greatest(0, sold_quantity + quantity_delta)
      where id::text = matched_item_id;
      sold_copies_delta := sold_copies_delta + quantity_delta;
    end loop;
  end loop;

  return jsonb_build_object(
    'recorded_lines', recorded_lines,
    'updated_lines', updated_lines,
    'sold_copies_delta', sold_copies_delta
  );
end
$$;

revoke all on table public.square_order_sales from public, anon, authenticated;
revoke all on function public.record_square_order_sales(jsonb) from public, anon, authenticated;
grant execute on function public.record_square_order_sales(jsonb) to service_role;
