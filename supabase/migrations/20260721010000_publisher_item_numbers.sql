alter table public.items
add column if not exists publisher_item_number text;

alter table public.curriculum_materials
add column if not exists publisher_item_number text,
add column if not exists publisher_barcode text;

-- Preserve identifiers collected by the earlier Abeka-specific prototype when
-- that migration was applied before this generalized version.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'items' and column_name = 'abeka_item_number'
  ) then
    execute $sql$
      update public.items
      set publisher_item_number = abeka_item_number
      where coalesce(publisher_item_number, '') = ''
        and coalesce(abeka_item_number, '') <> ''
    $sql$;
  end if;
end
$$;

create index if not exists items_publisher_item_number_idx
on public.items (publisher_item_number)
where coalesce(publisher, '') <> '' and coalesce(publisher_item_number, '') <> '';

create index if not exists items_publisher_barcode_idx
on public.items (publisher_barcode)
where coalesce(publisher_barcode, '') <> '';

create index if not exists curriculum_materials_publisher_item_number_idx
on public.curriculum_materials (publisher_item_number)
where coalesce(publisher, '') <> '' and coalesce(publisher_item_number, '') <> '';

create index if not exists curriculum_materials_publisher_barcode_idx
on public.curriculum_materials (publisher_barcode)
where coalesce(publisher_barcode, '') <> '';

comment on column public.items.publisher_item_number is
  'A product identifier assigned by the publisher; matched together with publisher.';

comment on column public.curriculum_materials.publisher_item_number is
  'A product identifier assigned by the publisher; matched together with publisher.';

comment on column public.curriculum_materials.publisher_barcode is
  'The complete publisher barcode when known.';
