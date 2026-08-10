import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const foundationUrl = new URL("../supabase/migrations/20260806160000_connections_foundation.sql", import.meta.url);
const workflowUrl = new URL("../supabase/migrations/20260806190000_connections_workflows.sql", import.meta.url);

const TEAM_ID = "41111111-1111-4111-8111-111111111111";
const ADMIN_ID = "42222222-2222-4222-8222-222222222222";
const INACTIVE_ID = "43333333-3333-4333-8333-333333333333";

const bootstrapSql = `
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key);
  create table public.profiles (
    id uuid primary key references auth.users(id),
    email text not null,
    full_name text,
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
  try { return await db.query(sql, params); }
  finally { await resetIdentity(db); }
}

test("Connections Milestone 3 native workflow and security matrix", async (t) => {
  const foundation = await readFile(foundationUrl, "utf8");
  const workflow = await readFile(workflowUrl, "utf8");
  const db = new PGlite();
  let publicResourceId;
  let representativeSubmissionId;
  let suggestionSubmissionId;
  let correctionId;
  let referralId;

  await t.test("workflow migration is additive, private by default, and executable", async () => {
    assert.doesNotMatch(workflow.replace(/^--.*$/gm, ""), /alter\s+table\s+public\.(items|profiles|audit_logs)/i);
    assert.doesNotMatch(workflow, /child_name|minor_name|date_of_birth|diagnosis|school_record/i);
    await db.exec(bootstrapSql);
    await db.exec(foundation);
    await db.exec(workflow);

    const protectedTables = await db.query(`
      select class.relname, class.relrowsecurity,
             has_table_privilege('anon', format('public.%I', class.relname), 'select') as anon_can_select
      from pg_class class
      join pg_namespace namespace on namespace.oid = class.relnamespace
      where namespace.nspname = 'public'
        and class.relkind = 'r'
        and class.relname in (
          'connection_submissions', 'connection_submission_consents',
          'connection_correction_requests', 'connection_referral_requests',
          'connection_workflow_activity'
        )
      order by class.relname
    `);
    assert.equal(protectedTables.rows.length, 5);
    assert.ok(protectedTables.rows.every((row) => row.relrowsecurity === true && row.anon_can_select === false));

    const privileges = await db.query(`
      select
        has_function_privilege('anon', 'public.submit_connection_resource(jsonb)', 'execute') as anon_submit,
        has_function_privilege('anon', 'public.set_connection_submission_status(uuid,text,text)', 'execute') as anon_review,
        has_table_privilege('authenticated', 'public.connection_submissions', 'update') as staff_direct_update
    `);
    assert.deepEqual(privileges.rows[0], { anon_submit: true, anon_review: false, staff_direct_update: false });

    await db.query("insert into auth.users (id) values ($1), ($2), ($3)", [TEAM_ID, ADMIN_ID, INACTIVE_ID]);
    await db.query(`insert into public.profiles (id,email,full_name,role,is_active) values
      ($1,'team@example.test','Team Member','team',true),
      ($2,'admin@example.test','Director','admin',true),
      ($3,'inactive@example.test','Inactive','team',false)`, [TEAM_ID, ADMIN_ID, INACTIVE_ID]);
  });

  await t.test("published fixture exists only to anchor public correction requests", async () => {
    const resource = await asRole(db, "authenticated", TEAM_ID, `
      insert into public.connection_resources (
        slug,name,short_description,description,worldview,delivery_mode,accepting_status,
        cost_type,homeschool_specific,daytime_available,service_area_summary,created_by,updated_by
      ) values (
        'milestone-three-public-resource','Milestone Three Public Resource','Fictional public resource.',
        'A fictional resource used only for workflow testing.','information_not_provided','in_person',
        'accepting','free',true,true,'Peoria County',$1,$1
      ) returning id`, [TEAM_ID]);
    publicResourceId = resource.rows[0].id;
    await asRole(db, "authenticated", TEAM_ID, `insert into public.connection_resource_categories (resource_id,category_id,is_primary)
      select $1,id,true from public.connection_categories where slug='co-ops-groups-community'`, [publicResourceId]);
    await asRole(db, "authenticated", TEAM_ID, `insert into public.connection_contact_methods (
      resource_id,kind,label,value,intended_use,consent_status,consented_by_name,consented_at,consent_method
    ) values ($1,'website','Website','https://workflow.example.test','public_direct','granted','Fictional Director',now(),'phone')`, [publicResourceId]);
    await asRole(db, "authenticated", TEAM_ID, `insert into public.connection_visibility_consents (
      resource_id,visibility,consented_by_name,contact_role,consent_method,consented_at,recorded_by
    ) values ($1,'public','Fictional Director','Director','phone',now(),$2)`, [publicResourceId, TEAM_ID]);
    await asRole(db, "authenticated", TEAM_ID, "select public.update_connection_review_controls($1,'public','core_county','',true)", [publicResourceId]);
    await asRole(db, "authenticated", TEAM_ID, "select public.record_connection_verification($1,current_date,'phone','Fictional Director','verified','public','')", [publicResourceId]);
    await asRole(db, "authenticated", TEAM_ID, "select public.set_connection_review_status($1,'ready_for_decision')", [publicResourceId]);
    await asRole(db, "authenticated", ADMIN_ID, "select public.admin_approve_connection($1,'public')", [publicResourceId]);
    await asRole(db, "authenticated", ADMIN_ID, "select public.admin_publish_connection($1)", [publicResourceId]);
  });

  await t.test("anonymous representative and suggestion submissions remain staff-only", async () => {
    const representative = await asRole(db, "anon", null, `select public.submit_connection_resource($1::jsonb) as id`, [JSON.stringify({
      submission_type: "representative",
      organization_name: "Fictional River Learning Studio",
      category_slug: "classes-tutors-academic-support",
      description: "A fictional academic studio for local homeschool families.",
      homeschool_relevance: "Offers weekday classes designed for home educators.",
      submitter_name: "Fictional Adult",
      submitter_email: "adult@example.test",
      organization_contact_email: "studio@example.test",
      requested_visibility: "public",
      publication_attested: true,
      consent_email: true,
      website_confirm: "",
    })]);
    representativeSubmissionId = representative.rows[0].id;

    const suggestion = await asRole(db, "anon", null, `select public.submit_connection_resource($1::jsonb) as id`, [JSON.stringify({
      submission_type: "suggestion",
      organization_name: "Fictional Family Discovery Club",
      category_slug: "co-ops-groups-community",
      description: "A fictional club suggested for IL HRC research.",
      homeschool_relevance: "May offer useful local community activities.",
      submitter_name: "Suggesting Adult",
      submitter_email: "suggestion@example.test",
      publication_attested: true,
      consent_email: true,
      website_confirm: "",
    })]);
    suggestionSubmissionId = suggestion.rows[0].id;

    await assert.rejects(asRole(db, "anon", null, "select * from public.connection_submissions"), /permission denied/i);
    await assert.rejects(asRole(db, "anon", null, `select public.submit_connection_resource($1::jsonb)`, [JSON.stringify({
      submission_type: "staff", organization_name: "Bypass", category_slug: "co-ops-groups-community",
      description: "This malicious staff submission should not be accepted.", homeschool_relevance: "Not authorized.",
      submitter_name: "Bypass User", submitter_email: "bypass@example.test",
    })]), /Active staff access is required/i);

    const consents = await asRole(db, "authenticated", TEAM_ID, `select field_name,consent_status from public.connection_submission_consents
      where submission_id=$1 order by field_name`, [suggestionSubmissionId]);
    assert.ok(consents.rows.every((row) => row.consent_status === "not_requested"));
    const directory = await asRole(db, "anon", null, "select slug from public.public_connections_directory where slug like 'fictional-%'");
    assert.equal(directory.rows.length, 0);
  });

  await t.test("anonymous correction and referral requests expose no base-table data", async () => {
    const correction = await asRole(db, "anon", null, `select public.submit_connection_correction(
      'milestone-three-public-resource','Requesting Adult','correction@example.test','','Representative',
      'Please correct the fictional weekday schedule.',false,'') as id`);
    correctionId = correction.rows[0].id;
    const referral = await asRole(db, "anon", null, `select public.submit_connection_referral(
      'Requesting Adult','referral@example.test','','email','Fictional private provider',
      'We are seeking a general homeschool support resource.',true,'') as id`);
    referralId = referral.rows[0].id;
    await assert.rejects(asRole(db, "anon", null, "select * from public.connection_correction_requests"), /permission denied/i);
    await assert.rejects(asRole(db, "anon", null, "select * from public.connection_referral_requests"), /permission denied/i);
  });

  await t.test("active team can review, convert, verify, and mediate referrals without publication authority", async () => {
    const submissions = await asRole(db, "authenticated", TEAM_ID, "select id,submitter_email from public.connection_submissions order by created_at");
    assert.equal(submissions.rows.length, 2);
    assert.equal(submissions.rows[0].submitter_email, "adult@example.test");
    await assert.rejects(asRole(db, "authenticated", TEAM_ID, "update public.connection_submissions set status='converted' where id=$1", [representativeSubmissionId]), /permission denied/i);
    await asRole(db, "authenticated", TEAM_ID, "select public.set_connection_submission_status($1,'under_review','Research started.')", [representativeSubmissionId]);
    const converted = await asRole(db, "authenticated", TEAM_ID, "select public.convert_connection_submission_to_draft($1,'fictional-river-learning-studio') as id", [representativeSubmissionId]);
    const draftResourceId = converted.rows[0].id;
    const governance = await asRole(db, "authenticated", TEAM_ID, "select review_status,decision_status,publication_state from public.connection_resource_governance where resource_id=$1", [draftResourceId]);
    assert.deepEqual(governance.rows[0], { review_status: "under_review", decision_status: "pending", publication_state: "unpublished" });
    await asRole(db, "authenticated", TEAM_ID, "select public.record_connection_visibility_consent($1,'public','Fictional Adult','Director','phone',now())", [draftResourceId]);
    await asRole(db, "authenticated", TEAM_ID, "select public.add_connection_internal_note($1,'Follow up about the fictional fall schedule.')", [draftResourceId]);
    const internalNotes = await asRole(db, "authenticated", TEAM_ID, "select body from public.connection_internal_notes where resource_id=$1", [draftResourceId]);
    assert.deepEqual(internalNotes.rows, [{ body: "Follow up about the fictional fall schedule." }]);
    const hidden = await asRole(db, "anon", null, "select slug from public.public_connections_directory where slug='fictional-river-learning-studio'");
    assert.equal(hidden.rows.length, 0);

    await asRole(db, "authenticated", TEAM_ID, "select public.set_connection_correction_status($1,'under_review','Checking the schedule.')", [correctionId]);
    await assert.rejects(asRole(db, "authenticated", TEAM_ID, "select public.set_connection_referral_status($1,'introduction_shared','','')", [referralId]), /approve the introduction first/i);
    await asRole(db, "authenticated", TEAM_ID, "select public.set_connection_referral_status($1,'leader_approved','Fictional Resource Leader','Approved by phone.')", [referralId]);
    await asRole(db, "authenticated", TEAM_ID, "select public.set_connection_referral_status($1,'introduction_shared','Fictional Resource Leader','Shared by email.')", [referralId]);
    await assert.rejects(asRole(db, "authenticated", TEAM_ID, "select public.admin_publish_connection($1)", [draftResourceId]), /Admin access is required/i);
  });

  await t.test("inactive staff are denied and material workflow changes are audited", async () => {
    const inactiveRows = await asRole(db, "authenticated", INACTIVE_ID, "select * from public.connection_submissions");
    assert.equal(inactiveRows.rows.length, 0);
    await assert.rejects(asRole(db, "authenticated", INACTIVE_ID, "select public.set_connection_submission_status($1,'under_review','')", [suggestionSubmissionId]), /Active staff access is required/i);
    await assert.rejects(asRole(db, "authenticated", INACTIVE_ID, "select public.add_connection_internal_note($1,'Bypass note')", [publicResourceId]), /Active staff access is required/i);
    const activity = await asRole(db, "authenticated", TEAM_ID, "select subject_type,event_type from public.connection_workflow_activity order by created_at");
    assert.ok(activity.rows.some((row) => row.event_type === "submission_received"));
    assert.ok(activity.rows.some((row) => row.event_type === "submission_converted"));
    assert.ok(activity.rows.some((row) => row.event_type === "correction_status_changed"));
    assert.ok(activity.rows.some((row) => row.event_type === "referral_status_changed"));
  });

  await db.close();
});
