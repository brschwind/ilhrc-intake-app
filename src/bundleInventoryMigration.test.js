import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL("../supabase/migrations/20260729150000_inventory_bundles.sql", import.meta.url),
  "utf8"
).toLowerCase();

test("bundle migration preserves component records and physical quantities", () => {
  assert.match(migration, /create table if not exists public\.bundle_components/);
  assert.match(migration, /bundle_item_id text not null/);
  assert.match(migration, /component_item_id text not null/);
  assert.match(migration, /piece_quantity integer not null default 1/);
  assert.match(migration, /unique \(bundle_item_id, component_item_id\)/);
});

test("bundle and individual SKUs come from one concurrency-safe sequence", () => {
  assert.match(migration, /create sequence if not exists public\.inventory_sku_seq/);
  assert.match(migration, /nextval\('public\.inventory_sku_seq'\)/);
  assert.match(migration, /'ilhrc-b-'/);
  assert.match(migration, /'ilhrc-'/);
});

test("public catalog exposes bundle identity, piece count, and contents", () => {
  assert.match(migration, /item\.item_type/);
  assert.match(migration, /item\.bundle_piece_count/);
  assert.match(migration, /end as bundle_contents/);
  assert.match(migration, /coalesce\(item\.public_visible, true\) = true/);
});
