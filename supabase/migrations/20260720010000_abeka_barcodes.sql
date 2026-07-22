alter table public.items
add column if not exists publisher_barcode text,
add column if not exists abeka_item_number text;

create index if not exists items_abeka_item_number_idx
on public.items (abeka_item_number)
where abeka_item_number is not null and abeka_item_number <> '';

comment on column public.items.publisher_barcode is
  'The complete publisher barcode exactly as scanned.';

comment on column public.items.abeka_item_number is
  'The six-digit Abeka catalog item number extracted from an Abeka barcode.';
