import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const TEAM_ID = "51111111-1111-4111-8111-111111111111";
const INACTIVE_ID = "53333333-3333-4333-8333-333333333333";
const migrationNames = [
  "20260806160000_connections_foundation.sql",
  "20260806190000_connections_workflows.sql",
  "20260810211500_connections_staff_resource_editor.sql",
];

const bootstrapSql = `
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key);
  create table public.profiles (
    id uuid primary key references auth.users(id), email text not null,
    full_name text, role text not null check (role in ('admin', 'team')),
    is_active boolean not null default true
  );
  create or replace function auth.uid() returns uuid language sql stable as $$
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
  try { return await db.query(sql, params); }
  finally { await resetIdentity(db); }
}

test("Connections staff resource editor is private, additive and role-protected", async () => {
  const db = new PGlite();
  await db.exec(bootstrapSql);
  for (const name of migrationNames) {
    await db.exec(await readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8"));
  }
  await db.query("insert into auth.users (id) values ($1), ($2)", [TEAM_ID, INACTIVE_ID]);
  await db.query(`insert into public.profiles (id,email,role,is_active) values
    ($1,'team@example.test','team',true), ($2,'inactive@example.test','team',false)`, [TEAM_ID, INACTIVE_ID]);

  await assert.rejects(
    asRole(db, "anon", null, "select public.save_connection_resource('{}'::jsonb)"),
    /permission denied/i,
  );

  const payload = {
    slug: "fictional-staff-editor-resource",
    name: "Fictional Staff Editor Resource",
    short_description: "A fictional private draft for editor validation.",
    description: "A fictional private resource used only to validate the staff editor workflow.",
    worldview: "information_not_provided",
    delivery_mode: "hybrid",
    accepting_status: "accepting",
    cost_type: "free",
    homeschool_specific: true,
    daytime_available: true,
    homeschool_discount: false,
    service_area_summary: "Central Illinois",
    category_slug: "co-ops-groups-community",
    location: {
      name: "Fictional site", location_kind: "physical", city: "Peoria", county: "Peoria",
      state: "IL", address_display: "town_only", address_consent_status: "denied",
    },
    contacts: {
      website: { value: "https://example.invalid", consent_status: "granted", consented_by_name: "Fictional Director", consented_at: "2026-08-10T12:00:00Z", consent_method: "phone" },
      email: { value: "private@example.invalid", consent_status: "denied" },
      phone: { value: "", consent_status: "not_requested" },
    },
  };
  const saved = await asRole(db, "authenticated", TEAM_ID, "select public.save_connection_resource($1::jsonb) as id", [JSON.stringify(payload)]);
  const resourceId = saved.rows[0].id;
  assert.ok(resourceId);

  const editor = await asRole(db, "authenticated", TEAM_ID, "select public.get_connection_resource_editor($1) as resource", [resourceId]);
  assert.equal(editor.rows[0].resource.name, payload.name);
  assert.equal(editor.rows[0].resource.category_slug, payload.category_slug);
  assert.equal(editor.rows[0].resource.website_consent_status, "granted");
  assert.equal(editor.rows[0].resource.email_consent_status, "denied");

  const governance = await asRole(db, "authenticated", TEAM_ID, "select review_status,publication_state from public.connection_resource_governance where resource_id=$1", [resourceId]);
  assert.deepEqual(governance.rows[0], { review_status: "draft", publication_state: "unpublished" });
  const publicRows = await asRole(db, "anon", null, "select * from public.public_connections_directory");
  assert.equal(publicRows.rows.length, 0);

  payload.id = resourceId;
  payload.name = "Updated Fictional Staff Editor Resource";
  await asRole(db, "authenticated", TEAM_ID, "select public.save_connection_resource($1::jsonb)", [JSON.stringify(payload)]);
  const updated = await asRole(db, "authenticated", TEAM_ID, "select name from public.connection_resources where id=$1", [resourceId]);
  assert.equal(updated.rows[0].name, payload.name);

  await assert.rejects(
    asRole(db, "authenticated", INACTIVE_ID, "select public.get_connection_resource_editor($1)", [resourceId]),
    /Active staff access is required/i,
  );
  await db.close();
});
