import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const migrationUrl = new URL("../supabase/migrations/20260908120000_location_aware_inventory.sql", import.meta.url);

async function database() {
  const db = new PGlite();
  await db.exec(`
    create role authenticated;
    create role anon;
    create schema auth;
    create table auth.users (id uuid primary key default gen_random_uuid());
    create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
    create table public.items (
      id text primary key default gen_random_uuid()::text,
      sku text unique, title text not null, location text, quantity integer not null default 0,
      isbn text, publisher_barcode text, publisher text, category text, subject text,
      curriculum text, status text, public_visible boolean, notes text,
      created_at timestamptz not null default now()
    );
    create table public.profiles (id uuid primary key, is_active boolean, role text);
    create function public.current_profile_is_active() returns boolean
    language sql stable as $$ select true $$;
    create table public.curriculum_materials (id uuid primary key default gen_random_uuid());
    create table public.curriculum_packages (id uuid primary key default gen_random_uuid());
    create table public.curriculum_package_items (
      id uuid primary key default gen_random_uuid(), package_id uuid, material_id uuid
    );
    create table public.curriculum_inventory_matches (
      id uuid primary key default gen_random_uuid(), material_id uuid, inventory_item_id text
    );
    create sequence public.inventory_sku_seq;
    create function public.next_inventory_sku(p_item_type text default 'individual') returns text
    language sql as $$ select 'ILHRC-' || lpad(nextval('public.inventory_sku_seq')::text, 6, '0') $$;
  `);
  await db.exec(await readFile(migrationUrl, "utf8"));
  return db;
}

async function scalar(db, sql, params = []) {
  const result = await db.query(sql, params);
  return Object.values(result.rows[0])[0];
}

test("intake duplicates, multi-location totals, shelving, discovery, and moves remain consistent", async () => {
  const db = await database();
  await db.exec(`
    insert into public.inventory_locations (code, display_name, location_type)
    values ('A1','A1','shelf'), ('A2','A2','shelf'), ('B2','B2','shelf'), ('C3','C3','shelf');
    insert into public.items (id, sku, title, quantity) values ('book','SKU-1','Test Book',0);
  `);
  const processing = await scalar(db, "select id from public.inventory_locations where code='PROCESSING'");
  const a1 = await scalar(db, "select id from public.inventory_locations where code='A1'");
  const a2 = await scalar(db, "select id from public.inventory_locations where code='A2'");
  const b2 = await scalar(db, "select id from public.inventory_locations where code='B2'");
  const c3 = await scalar(db, "select id from public.inventory_locations where code='C3'");

  await db.exec("insert into public.items (id, sku, title, quantity) values ('legacy','LEGACY-1','Legacy Writer',2)");
  assert.equal(Number(await scalar(db, "select total_quantity from public.inventory_item_totals where item_id='legacy'")), 2);
  assert.equal(Number(await scalar(db, "select quantity from public.items where id='legacy'")), 2);
  await db.exec("update public.items set quantity=1 where id='legacy'");
  assert.equal(Number(await scalar(db, "select total_quantity from public.inventory_item_totals where item_id='legacy'")), 1);

  const intake = await scalar(db, "select id from public.start_inventory_scan_session('intake', null)");
  for (let index = 0; index < 4; index += 1) {
    await db.query("select public.record_inventory_scan($1,'book','SKU-1',$2,null,false)", [intake, `scan-${index}`]);
  }
  assert.equal(Number(await scalar(db, "select quantity from public.inventory_by_location where item_id='book' and location_id=$1", [processing])), 4);

  await db.query("select public.adjust_inventory_at_location('book',$1,3,'manual_adjustment')", [a1]);
  await db.query("select public.adjust_inventory_at_location('book',$1,2,'manual_adjustment')", [b2]);
  assert.equal(Number(await scalar(db, "select total_quantity from public.inventory_item_totals where item_id='book'")), 9);

  const shelving = await scalar(db, "select id from public.start_inventory_scan_session('shelving',$1)", [a2]);
  await db.query("select public.record_inventory_scan($1,'book','SKU-1','shelf-1',$2,false)", [shelving, a2]);
  await db.query("select public.record_inventory_scan($1,'book','SKU-1','shelf-2',$2,false)", [shelving, a2]);
  assert.equal(Number(await scalar(db, "select quantity from public.inventory_by_location where item_id='book' and location_id=$1", [processing])), 2);
  assert.equal(Number(await scalar(db, "select quantity from public.inventory_by_location where item_id='book' and location_id=$1", [a2])), 2);

  await db.query("select public.record_inventory_scan($1,'book','SKU-1','discover',$2,true)", [shelving, c3]);
  assert.equal(Number(await scalar(db, "select quantity from public.inventory_by_location where item_id='book' and location_id=$1", [a2])), 2);
  assert.equal(Number(await scalar(db, "select quantity from public.inventory_by_location where item_id='book' and location_id=$1", [c3])), 1);

  await db.query("select public.move_inventory_stock('book',$1,$2,3)", [a1, c3]);
  assert.equal(Number(await scalar(db, "select quantity from public.inventory_by_location where item_id='book' and location_id=$1", [a1])), 0);
  assert.equal(Number(await scalar(db, "select quantity from public.inventory_by_location where item_id='book' and location_id=$1", [c3])), 4);
  await assert.rejects(
    db.query("select public.move_inventory_stock('book',$1,$2,1)", [a1, c3]),
    /Insufficient stock/
  );
  await db.close();
});

test("shelf audit replaces only the audited shelf and records verification/history", async () => {
  const db = await database();
  await db.exec(`
    insert into public.inventory_locations (code, display_name, location_type)
    values ('A3','A3','shelf'), ('B4','B4','shelf');
    insert into public.items (id, sku, title, quantity) values ('book','SKU-2','Audit Book',0);
  `);
  const a3 = await scalar(db, "select id from public.inventory_locations where code='A3'");
  const b4 = await scalar(db, "select id from public.inventory_locations where code='B4'");
  await db.query("select public.adjust_inventory_at_location('book',$1,5,'manual_adjustment')", [a3]);
  await db.query("select public.adjust_inventory_at_location('book',$1,4,'manual_adjustment')", [b4]);
  const audit = await scalar(db, "select id from public.start_inventory_scan_session('shelf_audit',$1)", [a3]);
  for (let index = 0; index < 3; index += 1) {
    await db.query("select public.record_inventory_scan($1,'book','SKU-2',$2,null,false)", [audit, `audit-${index}`]);
  }
  assert.equal(Number(await scalar(db, "select observed_quantity from public.inventory_audit_observations where session_id=$1 and item_id='book'", [audit])), 3);
  await db.query("select public.reconcile_shelf_audit($1,'Approved test audit')", [audit]);
  assert.equal(Number(await scalar(db, "select quantity from public.inventory_by_location where item_id='book' and location_id=$1", [a3])), 3);
  assert.equal(Number(await scalar(db, "select quantity from public.inventory_by_location where item_id='book' and location_id=$1", [b4])), 4);
  assert.equal(await scalar(db, "select last_verified_at is not null from public.inventory_locations where id=$1", [a3]), true);
  assert.equal(Number(await scalar(db, "select count(*) from public.inventory_events where item_id='book' and action_type='reconciliation'")), 1);
  await db.query("select public.archive_inventory_item('book','Test removal')");
  assert.equal(await scalar(db, "select status from public.items where id='book'"), "Removed");
  assert.equal(Number(await scalar(db, "select coalesce(sum(quantity),0) from public.inventory_by_location where item_id='book'")), 0);
  assert.equal(Number(await scalar(db, "select count(*) from public.inventory_events where item_id='book' and action_type='removal'")), 2);
  await db.close();
});

test("an empty audit zeros the audited shelf and exact SKU recommendations take priority", async () => {
  const db = await database();
  await db.exec(`
    insert into public.inventory_locations (code, display_name, location_type)
    values ('C1','C1','shelf'), ('F2','F2','shelf');
    insert into public.items (id, sku, title, quantity) values ('book','SKU-3','Missing Book',0);
  `);
  const c1 = await scalar(db, "select id from public.inventory_locations where code='C1'");
  await db.query("select public.adjust_inventory_at_location('book',$1,2,'manual_adjustment')", [c1]);
  const recommendation = await db.query("select code, source from public.get_shelving_recommendations('book') limit 1");
  assert.deepEqual(recommendation.rows[0], { code: "C1", source: "exact_sku" });
  const audit = await scalar(db, "select id from public.start_inventory_scan_session('shelf_audit',$1)", [c1]);
  await db.query("select public.reconcile_shelf_audit($1)", [audit]);
  assert.equal(Number(await scalar(db, "select quantity from public.inventory_by_location where item_id='book' and location_id=$1", [c1])), 0);
  assert.equal(Number(await scalar(db, "select quantity from public.items where id='book'")), 0);
  await db.close();
});
