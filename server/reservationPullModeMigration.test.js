const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { PGlite } = require("@electric-sql/pglite");

const migration = readFileSync(
  resolve(__dirname, "../supabase/migrations/20260824010000_reservation_pull_mode.sql"),
  "utf8"
);
const bulkPickupMigration = readFileSync(
  resolve(__dirname, "../supabase/migrations/20260824020000_bulk_reservation_pickup.sql"),
  "utf8"
);

test("pull mode supports unavailable books and records who completed the sheet", async () => {
  const db = new PGlite();
  const userId = "41111111-1111-4111-8111-111111111111";
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create schema auth;
      create table auth.users (id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$
        select '${userId}'::uuid
      $$;
      create function public.current_profile_is_active() returns boolean language sql stable as 'select true';
      create table public.profiles (id uuid primary key, full_name text, email text);
      create table public.items (
        id text primary key,
        square_variation_id text,
        quantity integer,
        status text,
        updated_at timestamptz
      );
      create table public.book_reservations (
        id uuid primary key,
        item_id text not null,
        status text not null check (status in ('pending', 'ready', 'picked_up', 'cancelled', 'expired')),
        expires_at timestamptz not null,
        handled_by uuid,
        updated_at timestamptz,
        square_hold_released_at timestamptz
      );
      create table public.audit_logs (
        user_id uuid,
        action text,
        entity_type text,
        entity_id text,
        details jsonb
      );
      insert into auth.users values ('${userId}');
      insert into public.profiles values ('${userId}', 'Alex Staff', 'alex@example.test');
      insert into public.items values ('item-1', 'square-1', 1, 'Available', now()), ('item-2', 'square-2', 1, 'Available', now());
      insert into public.book_reservations values
        ('51111111-1111-4111-8111-111111111111', 'item-1', 'pending', now() + interval '7 days', null, now(), null),
        ('52222222-2222-4222-8222-222222222222', 'item-2', 'pending', now() + interval '7 days', null, now(), null);
    `);
    await db.exec(migration);
    await db.exec(bulkPickupMigration);
    await db.exec(`
      select public.update_book_reservation_status('51111111-1111-4111-8111-111111111111', 'ready');
      select public.update_book_reservation_status('52222222-2222-4222-8222-222222222222', 'unavailable');
      select public.complete_book_reservation_pull(array[
        '51111111-1111-4111-8111-111111111111'::uuid,
        '52222222-2222-4222-8222-222222222222'::uuid
      ]);
      update public.book_reservations
      set square_hold_released_at = now()
      where id = '51111111-1111-4111-8111-111111111111';
      select public.complete_book_reservation_pickup(array[
        '51111111-1111-4111-8111-111111111111'::uuid
      ]);
    `);

    const result = await db.query(`
      select status, pull_completed_by_name, pull_completed_at is not null as completed
      from public.book_reservations order by id
    `);
    assert.deepEqual(result.rows, [
      { status: "picked_up", pull_completed_by_name: "Alex Staff", completed: true },
      { status: "unavailable", pull_completed_by_name: "Alex Staff", completed: true },
    ]);
    const audit = await db.query("select action from public.audit_logs order by action");
    assert.ok(audit.rows.some(({ action }) => action === "reservation_pull_completed"));
    assert.ok(audit.rows.some(({ action }) => action === "reservation_pickup_completed"));
  } finally {
    await db.close();
  }
});
