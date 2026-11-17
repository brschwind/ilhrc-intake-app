import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {buildAceItem,newAceDraft} from './acePace.js';

async function database() {
  const db=new PGlite();
  await db.exec(`
    create role authenticated; create role anon; create schema auth;
    create table auth.users(id uuid primary key default gen_random_uuid());
    create function auth.uid() returns uuid language sql stable as $$select null::uuid$$;
    create function public.current_profile_is_active() returns boolean language sql stable as $$select true$$;
    create function public.current_profile_is_admin() returns boolean language sql stable as $$select true$$;
    create table public.profiles(id uuid primary key, is_active boolean, role text);
    create table public.items(id text primary key default gen_random_uuid()::text,sku text unique,title text not null,
      location text,quantity integer not null default 0,isbn text,publisher_barcode text,publisher text,category text,subject text,
      curriculum text,status text,public_visible boolean,notes text,grade_level text,edition text,suggested_price numeric,final_price numeric,
      image_url text,item_type text default 'individual',label_printed boolean,pending_label_quantity integer default 0,label_queued_at timestamptz,
      created_at timestamptz default now());
    create table public.audit_logs(user_id uuid,action text,entity_type text,entity_id text,details jsonb);
    create table public.curriculum_materials(id uuid primary key default gen_random_uuid());
    create table public.curriculum_packages(id uuid primary key default gen_random_uuid());
    create table public.curriculum_package_items(id uuid primary key default gen_random_uuid(),package_id uuid,material_id uuid);
    create table public.curriculum_inventory_matches(id uuid primary key default gen_random_uuid(),material_id uuid,inventory_item_id text);
    create sequence public.inventory_sku_seq;
    create function public.next_inventory_sku(p_item_type text default 'individual') returns text language sql as $$select 'ILHRC-'||nextval('public.inventory_sku_seq')::text$$;
    insert into public.items(id,title,quantity,final_price) values('ordinary','Ordinary book',2,3);
  `);
  await db.exec(await readFile(new URL('../supabase/migrations/20260908120000_location_aware_inventory.sql',import.meta.url),'utf8'));
  const allocation=await readFile(new URL('../supabase/migrations/20260915120000_inventory_availability_and_allocation.sql',import.meta.url),'utf8');
  const receive=allocation.match(/create or replace function public.receive_inventory_to_processing\([\s\S]*?\$\$;/)[0];
  await db.exec(allocation.slice(allocation.indexOf('alter table public.inventory_events'),allocation.indexOf('-- Keep legacy inventory')));
  await db.exec("create table public.inventory_rollout_settings(singleton boolean, catalog_availability_mode text); insert into public.inventory_rollout_settings values(true,'legacy_compatible');");
  await db.exec(allocation.match(/create or replace function public.allocate_sellable_inventory\([\s\S]*?\$\$;/)[0]);
  await db.exec(receive);
  await db.exec(await readFile(new URL('../supabase/migrations/20261117140000_ace_pace_intake.sql',import.meta.url),'utf8'));
  await db.exec(await readFile(new URL('../supabase/migrations/20261117150000_ace_listing_photos_skus.sql',import.meta.url),'utf8'));
  return db;
}
const candidate=()=>buildAceItem({...newAceDraft(),confirmed:true});
async function receive(db,item,quantity=1,id=null,request=crypto.randomUUID()) {
  const result=await db.query('select receive_ace_intake($1::jsonb,$2,$3,$4::uuid) as item',[JSON.stringify(item),quantity,id,request]);
  return result.rows[0].item;
}
test('ACE migration preserves ordinary inventory, receives bundles atomically, merges duplicates, retries once, and sells one set',async()=>{
  const db=await database();
  try {
    assert.deepEqual((await db.query("select quantity,final_price from items where id='ordinary'")).rows,[{quantity:2,final_price:'3'}]);
    const request=crypto.randomUUID(), item=candidate();
    const saved=await receive(db,item,3,null,request);
    assert.equal(saved.quantity,3);assert.equal(saved.pending_label_quantity,3);assert.equal(saved.final_price,8);
    const retried=await receive(db,item,3,null,request);assert.equal(retried.quantity,3);
    const merged=await receive(db,item,1,saved.id);assert.equal(merged.quantity,4);assert.equal(merged.pending_label_quantity,4);
    assert.equal((await db.query("select count(*)::int n from items where ace_details is not null")).rows[0].n,1);
    await assert.rejects(receive(db,{...item,ace_details:{...item.ace_details,edition:'Different'}},1,saved.id),/details or selling price changed/);
    const separate=await receive(db,item,1);assert.notEqual(separate.id,saved.id);
    // Shelve before selling; Processing inventory is not sellable stock.
    await db.exec("insert into inventory_locations(code,display_name,location_type) values('A1','A1','shelf');");
    await db.query("select move_inventory_stock($1,(select id from inventory_locations where code='PROCESSING'),(select id from inventory_locations where code='A1'),4,'Shelve ACE sets')",[saved.id]);
    await db.query("select * from allocate_sellable_inventory($1,1,'sale','Sold one ACE set')",[saved.id]);
    assert.equal((await db.query('select quantity from items where id=$1',[saved.id])).rows[0].quantity,3);
    await assert.rejects(receive(db,item,0),/Invalid quantity/);
    assert.equal((await db.query("select quantity from items where id='ordinary'")).rows[0].quantity,2);
  }finally{await db.close();}
});

test('custom SKU and listing photo persist together; SKU conflicts never receive stock', async () => {
  const db = await database();
  try {
    const item = { ...candidate(), sku: 'ACE-ENGLISH-4', image_url: 'https://example.test/set.jpg' };
    const saved = await receive(db, item, 1);
    assert.equal(saved.sku, 'ACE-ENGLISH-4');
    assert.equal(saved.image_url, item.image_url);
    assert.equal(saved.quantity, 1);
    await assert.rejects(receive(db, { ...item, sku: 'ace-english-4' }, 2), /already in use/);
    assert.equal((await db.query('select quantity from items where id=$1', [saved.id])).rows[0].quantity, 1);
    await assert.rejects(receive(db, { ...item, sku: 'DIFFERENT-SKU' }, 1, saved.id), /existing listing SKU/);
    const updated = await receive(db, { ...item, image_url: 'https://example.test/new.jpg' }, 1, saved.id);
    assert.equal(updated.image_url, 'https://example.test/new.jpg');
    assert.equal(updated.quantity, 2);
    await assert.rejects(receive(db, { ...item, sku: 'invalid sku' }), /SKU must/);
  } finally { await db.close(); }
});

test('ACE receipts share the bulk Print Queue, one label per sellable unit, without requeuing retries', async () => {
  const db = await database();
  try {
    const request = crypto.randomUUID();
    const one = await receive(db, candidate(), 1, null, request);
    await receive(db, candidate(), 1, null, request);
    const three = await receive(db, candidate(), 3);
    const partial = buildAceItem({ ...newAceDraft(), materialType: 'Partial subject set', numbers: newAceDraft().numbers.slice(1) });
    const elevenBooklets = await receive(db, partial, 1);
    const rows = (await db.query('select id, pending_label_quantity from items where label_printed=false and pending_label_quantity>0 order by id')).rows;
    const queued = new Map(rows.map(row => [row.id, row.pending_label_quantity]));
    assert.equal(queued.size, 3);
    assert.equal(queued.get(one.id), 1);
    assert.equal(queued.get(three.id), 3);
    assert.equal(queued.get(elevenBooklets.id), 1);
    assert.equal(rows.reduce((total, row) => total + row.pending_label_quantity, 0), 5);
  } finally { await db.close(); }
});
