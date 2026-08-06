import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const migrationUrl = new URL(
  "../supabase/migrations/20260806160000_connections_foundation.sql",
  import.meta.url,
);

const TEAM_ID = "11111111-1111-4111-8111-111111111111";
const ADMIN_ID = "22222222-2222-4222-8222-222222222222";
const INACTIVE_ID = "33333333-3333-4333-8333-333333333333";

const bootstrapSql = `
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key);
  create table public.profiles (
    id uuid primary key references auth.users(id),
    role text not null check (role in ('admin', 'team')),
    is_active boolean not null default true
  );
  create or replace function auth.uid()
  returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  create or replace function public.current_profile_is_active()
  returns boolean language sql stable security definer set search_path = public as $$
    select coalesce((select is_active from public.profiles where id = auth.uid()), false)
  $$;
  create or replace function public.current_profile_is_admin()
  returns boolean language sql stable security definer set search_path = public as $$
    select coalesce((select role = 'admin' and is_active from public.profiles where id = auth.uid()), false)
  $$;
`;

async function resetIdentity(db) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', '', false)");
}

async function asRole(db, role, userId, sql, params = []) {
  await resetIdentity(db);
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId || ""]);
  await db.exec(`set role ${role}`);
  try {
    return await db.query(sql, params);
  } finally {
    await resetIdentity(db);
  }
}

test("Connections Milestone 1 migration and anon/team/admin security matrix", async (t) => {
  const migration = await readFile(migrationUrl, "utf8");
  const db = new PGlite();

  await t.test("migration is additive and executes in PostgreSQL", async () => {
    const executableMigration = migration.replace(/^--.*$/gm, "");
    assert.doesNotMatch(executableMigration, /alter\s+table\s+public\.(items|profiles|audit_logs)/i);
    assert.doesNotMatch(executableMigration, /public_catalog_items|square|openai/i);
    await db.exec(bootstrapSql);
    await db.exec(migration);

    const protectedTables = await db.query(`
      select class.relname, class.relrowsecurity,
             has_table_privilege('anon', format('public.%I', class.relname), 'select') as anon_can_select
      from pg_class class
      join pg_namespace namespace on namespace.oid = class.relnamespace
      where namespace.nspname = 'public'
        and class.relkind = 'r'
        and class.relname like 'connection_%'
      order by class.relname
    `);
    assert.equal(protectedTables.rows.length, 12);
    assert.ok(protectedTables.rows.every((row) => row.relrowsecurity === true));
    assert.ok(protectedTables.rows.every((row) => row.anon_can_select === false));

    const functionPrivileges = await db.query(`
      select
        has_function_privilege('anon', 'public.admin_publish_connection(uuid)', 'execute') as anon_publish,
        has_function_privilege('authenticated', 'public.admin_publish_connection(uuid)', 'execute') as staff_publish_entry,
        has_table_privilege('authenticated', 'public.connection_resource_governance', 'update') as staff_direct_governance
    `);
    assert.deepEqual(functionPrivileges.rows[0], {
      anon_publish: false,
      staff_publish_entry: true,
      staff_direct_governance: false,
    });

    const categories = await db.query(
      "select name from public.connection_categories order by sort_order",
    );
    assert.equal(categories.rows.length, 10);
    assert.deepEqual(
      categories.rows.map((row) => row.name),
      [
        "Co-ops, Groups & Community",
        "Classes, Tutors & Academic Support",
        "Arts, Music & Enrichment",
        "Sports, Clubs & Activities",
        "Field Trips, Museums & Attractions",
        "Camps & Seasonal Programs",
        "Special Needs, Therapy & Family Support",
        "College, Career & Dual Enrollment",
        "Curriculum, Books & Homeschool Services",
        "Homeschool-Friendly Businesses",
      ],
    );

    await db.query(
      `insert into auth.users (id) values ($1), ($2), ($3)`,
      [TEAM_ID, ADMIN_ID, INACTIVE_ID],
    );
    await db.query(
      `insert into public.profiles (id, role, is_active)
       values ($1, 'team', true), ($2, 'admin', true), ($3, 'team', false)`,
      [TEAM_ID, ADMIN_ID, INACTIVE_ID],
    );
  });

  let resourceId;
  let consentId;

  await t.test("anonymous callers can read only public-safe views", async () => {
    await assert.rejects(
      asRole(db, "anon", null, "select * from public.connection_resources"),
      /permission denied/i,
    );
    await assert.rejects(
      asRole(db, "anon", null, "select * from public.connection_internal_notes"),
      /permission denied/i,
    );
    await assert.rejects(
      asRole(db, "anon", null, "select public.admin_publish_connection($1)", [
        "00000000-0000-0000-0000-000000000000",
      ]),
      /permission denied/i,
    );

    const publicCategories = await asRole(
      db,
      "anon",
      null,
      "select * from public.public_connection_categories order by sort_order",
    );
    assert.equal(publicCategories.rows.length, 10);
    const emptyDirectory = await asRole(
      db,
      "anon",
      null,
      "select * from public.public_connections_directory",
    );
    assert.equal(emptyDirectory.rows.length, 0);
  });

  await t.test("team can curate content but cannot govern publication", async () => {
    const inserted = await asRole(
      db,
      "authenticated",
      TEAM_ID,
      `insert into public.connection_resources (
         slug, name, short_description, description, worldview, delivery_mode,
         accepting_status, cost_type, homeschool_specific, daytime_available,
         service_area_summary, created_by, updated_by
       ) values (
         'peoria-learning-co-op', 'Peoria Learning Co-op', 'A verified local co-op.',
         'Weekly classes and community for homeschool families.', 'christian', 'in_person',
         'accepting', 'paid', true, true, 'Peoria and surrounding communities', $1, $1
       ) returning id`,
      [TEAM_ID],
    );
    resourceId = inserted.rows[0].id;
    assert.ok(resourceId);

    const governance = await asRole(
      db,
      "authenticated",
      TEAM_ID,
      "select * from public.connection_resource_governance where resource_id = $1",
      [resourceId],
    );
    assert.equal(governance.rows[0].review_status, "draft");

    await assert.rejects(
      asRole(
        db,
        "authenticated",
        TEAM_ID,
        "update public.connection_resource_governance set publication_state = 'published' where resource_id = $1",
        [resourceId],
      ),
      /permission denied/i,
    );
    await assert.rejects(
      asRole(
        db,
        "authenticated",
        TEAM_ID,
        "insert into public.connection_categories (slug, name) values ('not-approved', 'Not Approved')",
      ),
      /row-level security/i,
    );

    await asRole(
      db,
      "authenticated",
      TEAM_ID,
      `insert into public.connection_resource_categories (resource_id, category_id, is_primary)
       select $1, id, true from public.connection_categories
       where slug = 'co-ops-groups-community'`,
      [resourceId],
    );
    await asRole(
      db,
      "authenticated",
      TEAM_ID,
      `insert into public.connection_locations (
         resource_id, name, city, county, state, address_display,
         address_consent_status, is_primary
       ) values ($1, 'Peoria site', 'Peoria', 'Peoria', 'IL', 'town_only', 'denied', true)`,
      [resourceId],
    );
    await asRole(
      db,
      "authenticated",
      TEAM_ID,
      `insert into public.connection_contact_methods (
         resource_id, kind, label, value, is_personal, intended_use,
         consent_status, consented_by_name, consented_at, consent_method
       ) values
         ($1, 'website', 'Website', 'https://example.org', false, 'public_direct',
          'granted', 'Resource Director', now(), 'phone'),
         ($1, 'phone', 'Private phone', '309-555-0100', true, 'public_direct',
          'denied', '', null, null)`,
      [resourceId],
    );
    const consent = await asRole(
      db,
      "authenticated",
      TEAM_ID,
      `insert into public.connection_visibility_consents (
         resource_id, visibility, consented_by_name, contact_role,
         consent_method, consented_at, recorded_by
       ) values ($1, 'public', 'Resource Director', 'Director', 'phone', now(), $2)
       returning id`,
      [resourceId, TEAM_ID],
    );
    consentId = consent.rows[0].id;

    await asRole(
      db,
      "authenticated",
      TEAM_ID,
      "select public.update_connection_review_controls($1, 'public', 'core_county', '', true)",
      [resourceId],
    );
    await asRole(
      db,
      "authenticated",
      TEAM_ID,
      "select public.record_connection_verification($1, current_date, 'phone', 'Resource Director', 'verified', 'public', 'Confirmed for annual review.')",
      [resourceId],
    );
    await asRole(
      db,
      "authenticated",
      TEAM_ID,
      "select public.set_connection_review_status($1, 'ready_for_decision')",
      [resourceId],
    );

    await assert.rejects(
      asRole(
        db,
        "authenticated",
        TEAM_ID,
        "select public.admin_approve_connection($1, 'public')",
        [resourceId],
      ),
      /Admin access is required/i,
    );
    await assert.rejects(
      asRole(
        db,
        "authenticated",
        TEAM_ID,
        `insert into public.connection_verifications (
           resource_id, verified_on, next_due_on, method, responsible_contact_name,
           performed_by, outcome
         ) values ($1, current_date, current_date + 365, 'phone', 'Bypass', $2, 'verified')`,
        [resourceId, TEAM_ID],
      ),
      /permission denied/i,
    );
    await assert.rejects(
      asRole(
        db,
        "authenticated",
        TEAM_ID,
        "insert into public.connection_activity (event_type, entity_type) values ('forged', 'resource')",
      ),
      /permission denied/i,
    );
  });

  await t.test("inactive staff are denied by RLS and workflow functions", async () => {
    const rows = await asRole(
      db,
      "authenticated",
      INACTIVE_ID,
      "select * from public.connection_resources",
    );
    assert.equal(rows.rows.length, 0);
    await assert.rejects(
      asRole(
        db,
        "authenticated",
        INACTIVE_ID,
        "select public.set_connection_review_status($1, 'under_review')",
        [resourceId],
      ),
      /Active staff access is required/i,
    );
  });

  await t.test("admin publication is audited and public views mask private fields", async () => {
    await asRole(
      db,
      "authenticated",
      ADMIN_ID,
      "select public.admin_approve_connection($1, 'public')",
      [resourceId],
    );
    await asRole(
      db,
      "authenticated",
      ADMIN_ID,
      "select public.admin_publish_connection($1)",
      [resourceId],
    );

    const directory = await asRole(
      db,
      "anon",
      null,
      "select * from public.public_connections_directory where slug = 'peoria-learning-co-op'",
    );
    assert.equal(directory.rows.length, 1);
    assert.equal(directory.rows[0].visibility, "public");
    assert.equal(Object.hasOwn(directory.rows[0], "geographic_exception_reason"), false);
    assert.equal(Object.hasOwn(directory.rows[0], "director_decision_by"), false);

    const locations = await asRole(
      db,
      "anon",
      null,
      "select * from public.public_connection_locations where resource_slug = 'peoria-learning-co-op'",
    );
    assert.equal(locations.rows.length, 1);
    assert.equal(locations.rows[0].city, "Peoria");
    assert.equal(locations.rows[0].address_line_1, "");
    assert.equal(locations.rows[0].postal_code, "");

    const contacts = await asRole(
      db,
      "anon",
      null,
      "select kind, value from public.public_connection_contacts where resource_slug = 'peoria-learning-co-op'",
    );
    assert.deepEqual(contacts.rows, [{ kind: "website", value: "https://example.org" }]);

    const activity = await asRole(
      db,
      "authenticated",
      TEAM_ID,
      "select event_type from public.connection_activity where resource_id = $1",
      [resourceId],
    );
    assert.ok(activity.rows.some((row) => row.event_type === "resource_approved"));
    assert.ok(activity.rows.some((row) => row.event_type === "resource_published"));
  });

  await t.test("annual verification expiration removes public exposure", async () => {
    await asRole(
      db,
      "authenticated",
      TEAM_ID,
      `update public.connection_resources
       set description = 'Updated weekly classes and community for homeschool families.',
           updated_by = $2
       where id = $1`,
      [resourceId, TEAM_ID],
    );
    const hiddenPendingReapproval = await asRole(
      db,
      "anon",
      null,
      "select slug from public.public_connections_directory where slug = 'peoria-learning-co-op'",
    );
    assert.equal(hiddenPendingReapproval.rows.length, 0);
    const reopened = await asRole(
      db,
      "authenticated",
      TEAM_ID,
      "select review_status, decision_status, publication_state from public.connection_resource_governance where resource_id = $1",
      [resourceId],
    );
    assert.deepEqual(reopened.rows[0], {
      review_status: "under_review",
      decision_status: "pending",
      publication_state: "paused",
    });
    await asRole(
      db,
      "authenticated",
      TEAM_ID,
      "select public.set_connection_review_status($1, 'ready_for_decision')",
      [resourceId],
    );
    await asRole(
      db,
      "authenticated",
      ADMIN_ID,
      "select public.admin_approve_connection($1, 'public')",
      [resourceId],
    );
    await asRole(
      db,
      "authenticated",
      ADMIN_ID,
      "select public.admin_publish_connection($1)",
      [resourceId],
    );

    await resetIdentity(db);
    await db.query(
      `update public.connection_resource_governance
       set last_verified_on = current_date - interval '1 year 1 day',
           verification_due_on = current_date - interval '1 day'
       where resource_id = $1`,
      [resourceId],
    );

    const expired = await asRole(
      db,
      "anon",
      null,
      "select slug from public.public_connections_directory where slug = 'peoria-learning-co-op'",
    );
    assert.equal(expired.rows.length, 0);
    await assert.rejects(
      asRole(
        db,
        "authenticated",
        ADMIN_ID,
        "select public.admin_publish_connection($1)",
        [resourceId],
      ),
      /successful verification within the past year/i,
    );

    await asRole(
      db,
      "authenticated",
      TEAM_ID,
      "select public.record_connection_verification($1, current_date, 'in_person', 'Resource Director', 'verified', 'public', '')",
      [resourceId],
    );
    const renewed = await asRole(
      db,
      "anon",
      null,
      "select slug from public.public_connections_directory where slug = 'peoria-learning-co-op'",
    );
    assert.equal(renewed.rows.length, 1);
  });

  await t.test("visibility consent withdrawal immediately removes public exposure", async () => {
    await asRole(
      db,
      "authenticated",
      TEAM_ID,
      "select public.withdraw_connection_visibility_consent($1)",
      [consentId],
    );
    const directory = await asRole(
      db,
      "anon",
      null,
      "select slug from public.public_connections_directory where slug = 'peoria-learning-co-op'",
    );
    const contacts = await asRole(
      db,
      "anon",
      null,
      "select value from public.public_connection_contacts where resource_slug = 'peoria-learning-co-op'",
    );
    assert.equal(directory.rows.length, 0);
    assert.equal(contacts.rows.length, 0);
  });

  await db.close();
});
