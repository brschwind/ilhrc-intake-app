const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { PGlite } = require("@electric-sql/pglite");

const migration = readFileSync(
  resolve(__dirname, "../supabase/migrations/20260814120000_square_inventory_inbound_sync.sql"),
  "utf8"
);
const reservationHoldMigration = readFileSync(
  resolve(__dirname, "../supabase/migrations/20260814130000_square_reservation_holds.sql"),
  "utf8"
);

test("Square inventory migration applies counts idempotently and rejects stale counts", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role;
      create schema auth;
      create function auth.uid() returns uuid language sql as 'select null::uuid';
      create function public.current_profile_is_active() returns boolean language sql as 'select true';
      create table public.items (
        id text primary key,
        square_variation_id text,
        quantity integer,
        status text,
        updated_at timestamptz
      );
      create table public.book_reservations (
        id uuid primary key,
        item_id text,
        status text,
        expires_at timestamptz,
        handled_by uuid,
        updated_at timestamptz
      );
      create table public.audit_logs (
        user_id uuid,
        action text,
        entity_type text,
        entity_id text,
        details jsonb
      );
    `);
    await db.exec(migration);
    await db.exec(reservationHoldMigration);
    await db.exec(`
      insert into public.items
        (id, square_variation_id, quantity, status, updated_at)
      values ('item-1', 'variation-1', 3, 'Available', now());

      select public.apply_square_inventory_count(
        'new-event', 'variation-1', 'location-1', 0, '2026-08-14T12:00:02Z'
      );
      select public.apply_square_inventory_count(
        'old-event', 'variation-1', 'location-1', 2, '2026-08-14T12:00:01Z'
      );
      select public.apply_square_inventory_count(
        'new-event', 'variation-1', 'location-1', 0, '2026-08-14T12:00:02Z'
      );
    `);

    const { rows } = await db.query(`
      select quantity, status, square_inventory_synced_at
      from public.items
      where id = 'item-1'
    `);
    assert.equal(rows[0].quantity, 0);
    assert.equal(rows[0].status, "Sold");
    assert.equal(new Date(rows[0].square_inventory_synced_at).toISOString(), "2026-08-14T12:00:02.000Z");

    const events = await db.query("select count(*)::integer as count from public.square_inventory_events");
    assert.equal(events.rows[0].count, 2);
  } finally {
    await db.close();
  }
});

test("reservation availability counts do not reduce physical inventory", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role;
      create schema auth;
      create function auth.uid() returns uuid language sql as 'select null::uuid';
      create function public.current_profile_is_active() returns boolean language sql as 'select true';
      create table public.items (id text primary key, square_variation_id text, quantity integer, status text, updated_at timestamptz);
      create table public.book_reservations (id uuid primary key, item_id text, status text, expires_at timestamptz, handled_by uuid, updated_at timestamptz);
      create table public.audit_logs (user_id uuid, action text, entity_type text, entity_id text, details jsonb);
    `);
    await db.exec(migration);
    await db.exec(reservationHoldMigration);
    await db.exec(`
      insert into public.items
        (id, square_variation_id, quantity, status, updated_at, square_expected_quantity)
      values ('item-1', 'variation-1', 1, 'Available', now(), 0);
      select public.apply_square_inventory_count(
        'hold-event', 'variation-1', 'location-1', 0, '2026-08-14T12:00:00Z'
      );
    `);
    let result = await db.query("select quantity from public.items where id = 'item-1'");
    assert.equal(result.rows[0].quantity, 1);

    await db.exec(`
      select public.apply_square_inventory_count(
        'oversold-event', 'variation-1', 'location-1', -1, '2026-08-14T12:00:01Z'
      );
    `);
    result = await db.query("select quantity, status from public.items where id = 'item-1'");
    assert.equal(result.rows[0].quantity, 0);
    assert.equal(result.rows[0].status, "Sold");
  } finally {
    await db.close();
  }
});
