import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  normalizeConnectionCorrection,
  normalizeConnectionReferral,
  normalizeConnectionResourceEditor,
  normalizeConnectionSubmission,
  getAnnualCheckInResources,
  suggestedConnectionSlug,
} from "./connections/connectionsWorkflowModel.js";
import { createConnectionsWorkflowService } from "./connections/connectionsWorkflowService.js";
import {
  CONNECTIONS_CORRECTION_SELECT,
  CONNECTIONS_ACTIVITY_SELECT,
  CONNECTIONS_INTERNAL_NOTE_SELECT,
  CONNECTIONS_REFERRAL_SELECT,
  CONNECTIONS_RESOURCE_QUEUE_SELECT,
  CONNECTIONS_SUBMISSION_SELECT,
  CONNECTIONS_VERIFICATION_SELECT,
  CONNECTIONS_WORKFLOW_TABLES,
  createConnectionsWorkflowSupabaseAdapter,
} from "./connections/connectionsWorkflowSupabaseAdapter.js";
import { matchConnectionsPath, resolveAppRoute } from "./routing/appRoutes.js";

const formsSource = await readFile(new URL("./connections/ConnectionsForms.jsx", import.meta.url), "utf8");
const adminSource = await readFile(new URL("./connections/ConnectionsAdmin.jsx", import.meta.url), "utf8");
const editorSource = await readFile(new URL("./connections/ConnectionsResourceEditor.jsx", import.meta.url), "utf8");
const routerSource = await readFile(new URL("./AppRouter.jsx", import.meta.url), "utf8");
const appSource = await readFile(new URL("./App.jsx", import.meta.url), "utf8");
const workflowStyleSource = await readFile(new URL("./connections/ConnectionsWorkflows.css", import.meta.url), "utf8");
const publicStyleSource = await readFile(new URL("./connections/ConnectionsPublic.css", import.meta.url), "utf8");

const representativeSubmission = {
  submission_type: "representative",
  organization_name: "Fictional Learning Studio",
  category_slug: "classes-tutors-academic-support",
  description: "A fictional resource description long enough for review.",
  homeschool_relevance: "Offers weekday support for homeschool families.",
  submitter_name: "Fictional Adult",
  submitter_email: "ADULT@EXAMPLE.TEST",
  publication_attested: "on",
  consent_email: "on",
};

test("Milestone 3 routes are modular and remain feature-flag protected", () => {
  assert.deepEqual(matchConnectionsPath("/connections/submit"), { kind: "submit", pathname: "/connections/submit" });
  assert.deepEqual(matchConnectionsPath("/connections/referral"), { kind: "referral", pathname: "/connections/referral" });
  assert.deepEqual(matchConnectionsPath("/connections/admin"), { kind: "admin", pathname: "/connections/admin" });
  assert.deepEqual(matchConnectionsPath("/connections/fictional-resource/correction"), {
    kind: "correction", pathname: "/connections/fictional-resource/correction", slug: "fictional-resource",
  });
  assert.equal(resolveAppRoute({ pathname: "/connections/submit" }, false).kind, "connections-unavailable");
  assert.equal(resolveAppRoute({ pathname: "/connections/admin" }, false).kind, "connections-unavailable");
  assert.equal(resolveAppRoute({ pathname: "/connections/admin" }, false, true).page, "admin");
  assert.equal(resolveAppRoute({ pathname: "/connections/submit" }, false, true).kind, "connections-unavailable");
  assert.match(routerSource, /route\.page === "submit"/);
  assert.match(routerSource, /route\.page === "correction"/);
  assert.match(routerSource, /route\.page === "referral"/);
  assert.match(routerSource, /route\.page === "admin"/);
});

test("Connections staff tools use the existing authenticated staff workspace", () => {
  assert.match(appSource, /staff-nav-label">Connections/);
  assert.match(appSource, /<ConnectionsAdmin\s+embedded\s+session=\{session\}\s+profile=\{profile\}/);
  assert.match(routerSource, /createConnectionsWorkflowSupabaseAdapter\(supabase\)/);
  assert.match(routerSource, /initialStaffView="connections"/);
  assert.doesNotMatch(routerSource, /import ConnectionsAdmin/);
});

test("staff resource editor validates consent-safe drafts and annual check-in dates", () => {
  const resource = normalizeConnectionResourceEditor({
    name: "Fictional Learning Center", slug: "fictional-learning-center",
    category_slug: "classes-tutors-academic-support",
    short_description: "A fictional resource for staff testing.",
    description: "A fictional resource description that is long enough for staff validation.",
    website_value: "https://example.invalid", website_consent_status: "granted",
    website_consented_by_name: "Fictional Director", website_consented_at: "2026-08-10T10:00",
    website_consent_method: "phone", address_display: "town_only",
  });
  assert.equal(resource.contacts.website.consent_status, "granted");
  assert.throws(() => normalizeConnectionResourceEditor({
    ...resource, category_slug: resource.category_slug,
    website_value: "https://example.invalid", website_consent_status: "granted",
    website_consented_by_name: "", website_consented_at: "", website_consent_method: "",
  }), /Document who granted website/i);

  const due = getAnnualCheckInResources([
    { id: "later", verification_due_on: "2026-10-01" },
    { id: "soon", verification_due_on: "2026-08-20" },
    { id: "overdue", verification_due_on: "2026-08-01" },
    { id: "unscheduled", verification_due_on: null },
  ], new Date("2026-08-10T12:00:00Z"));
  assert.deepEqual(due.map(({ id }) => id), ["overdue", "soon"]);
  assert.match(editorSource, /Saving creates or updates a private staff draft/);
  assert.match(editorSource, /Only organization-approved fields with granted consent/);
});

test("representative submissions require explicit field consent while suggestions cannot grant it", () => {
  const representative = normalizeConnectionSubmission(representativeSubmission);
  assert.equal(representative.submitter_email, "adult@example.test");
  assert.equal(representative.publication_attested, true);
  assert.equal(representative.consent_email, true);

  assert.throws(() => normalizeConnectionSubmission({ ...representativeSubmission, publication_attested: false }), /consent acknowledgement/i);
  const suggestion = normalizeConnectionSubmission({
    ...representativeSubmission,
    submission_type: "suggestion",
    publication_attested: true,
    consent_email: true,
  });
  assert.equal(suggestion.publication_attested, false);
  assert.equal(suggestion.consent_email, false);
});

test("correction and private-referral payloads reject invalid or excessive personal input", () => {
  assert.equal(normalizeConnectionCorrection({
    requester_name: "Adult Requester",
    requester_email: "adult@example.test",
    requested_changes: "Please remove the outdated phone number.",
    privacy_removal_requested: "on",
  }, "fictional-resource").privacy_removal_requested, true);
  assert.throws(() => normalizeConnectionCorrection({
    requester_name: "Adult", requester_email: "bad", requested_changes: "Too short",
  }, "fictional-resource"), /valid email/i);

  const referral = normalizeConnectionReferral({
    requester_name: "Adult Requester",
    requester_email: "adult@example.test",
    preferred_contact: "email",
    family_need: "We are seeking general homeschool support options.",
    consent_to_contact: "on",
  });
  assert.equal(referral.consent_to_contact, true);
  assert.throws(() => normalizeConnectionReferral({ ...referral, consent_to_contact: false }), /Permission to contact/i);
  assert.equal(suggestedConnectionSlug("  Prairie & River Learning!  "), "prairie-river-learning");
});

test("public workflow service validates before invoking narrowly scoped RPC adapters", async () => {
  const calls = [];
  const adapter = {
    async submitResource(payload) { calls.push(["resource", payload]); return "11111111-1111-4111-8111-111111111111"; },
    async submitCorrection(payload) { calls.push(["correction", payload]); return "22222222-2222-4222-8222-222222222222"; },
    async submitReferral(payload) { calls.push(["referral", payload]); return "33333333-3333-4333-8333-333333333333"; },
  };
  const service = createConnectionsWorkflowService({ enabled: true, adapter });
  assert.match(await service.submitResource(representativeSubmission), /^1111/);
  assert.match(await service.submitCorrection("fictional-resource", {
    requester_name: "Adult Requester", requester_email: "adult@example.test",
    requested_changes: "Please correct the program description.",
  }), /^2222/);
  assert.match(await service.submitReferral({
    requester_name: "Adult Requester", requester_email: "adult@example.test",
    preferred_contact: "email", family_need: "We need general local resource guidance.", consent_to_contact: true,
  }), /^3333/);
  assert.deepEqual(calls.map(([kind]) => kind), ["resource", "correction", "referral"]);
  assert.throws(() => createConnectionsWorkflowService({ enabled: false, adapter }).submitResource(representativeSubmission), /not available/i);
});

test("Supabase workflow adapter uses public RPCs for intake and staff-only queue tables for administration", async () => {
  const rpcCalls = [];
  const selectCalls = [];
  const client = {
    rpc(name, parameters) { rpcCalls.push({ name, parameters }); return Promise.resolve({ data: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", error: null }); },
    from(table) {
      return {
        select(fields) {
          selectCalls.push({ table, fields });
          const builder = {
            order() { return builder; },
            is() { return builder; },
            limit() { return builder; },
            then(resolve, reject) { return Promise.resolve({ data: [], error: null }).then(resolve, reject); },
          };
          return builder;
        },
      };
    },
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signInWithPassword: async () => ({ data: { session: null }, error: null }),
      signOut: async () => ({ error: null }),
    },
  };
  const adapter = createConnectionsWorkflowSupabaseAdapter(client);
  await adapter.submitResource(normalizeConnectionSubmission(representativeSubmission));
  await adapter.submitCorrection(normalizeConnectionCorrection({
    requester_name: "Adult", requester_email: "adult@example.test", requested_changes: "Please correct this listing.",
  }, "fictional-resource"));
  await adapter.submitReferral(normalizeConnectionReferral({
    requester_name: "Adult", requester_email: "adult@example.test", preferred_contact: "email",
    family_need: "Seeking a general homeschool resource.", consent_to_contact: true,
  }));
  assert.deepEqual(rpcCalls.map(({ name }) => name), [
    "submit_connection_resource", "submit_connection_correction", "submit_connection_referral",
  ]);

  await adapter.getResourceEditor("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  await adapter.saveResource({ name: "Fictional" });
  assert.deepEqual(rpcCalls.slice(-2).map(({ name }) => name), [
    "get_connection_resource_editor", "save_connection_resource",
  ]);

  await adapter.listQueues();
  assert.deepEqual(selectCalls, [
    { table: CONNECTIONS_WORKFLOW_TABLES.submissions, fields: CONNECTIONS_SUBMISSION_SELECT },
    { table: CONNECTIONS_WORKFLOW_TABLES.corrections, fields: CONNECTIONS_CORRECTION_SELECT },
    { table: CONNECTIONS_WORKFLOW_TABLES.referrals, fields: CONNECTIONS_REFERRAL_SELECT },
    { table: CONNECTIONS_WORKFLOW_TABLES.resources, fields: CONNECTIONS_RESOURCE_QUEUE_SELECT },
    { table: CONNECTIONS_WORKFLOW_TABLES.verifications, fields: CONNECTIONS_VERIFICATION_SELECT },
    { table: CONNECTIONS_WORKFLOW_TABLES.notes, fields: CONNECTIONS_INTERNAL_NOTE_SELECT },
    { table: CONNECTIONS_WORKFLOW_TABLES.activity, fields: CONNECTIONS_ACTIVITY_SELECT },
  ]);
});

test("workflow screens disclose privacy limits and keep administrator controls role-gated", () => {
  assert.match(formsSource, /Please do not include information about children or minors/);
  assert.match(formsSource, /leader must approve each introduction/);
  assert.match(formsSource, /Nothing has been published automatically/);
  assert.doesNotMatch(formsSource, /name="(?:child|minor|diagnosis|date_of_birth)/i);
  assert.match(adminSource, /effectiveProfile\?\.role === "admin"/);
  assert.match(adminSource, /Record phone or in-person verification/);
  assert.match(adminSource, /Annual check-ins/);
  assert.match(adminSource, /Complete annual check-in/);
  assert.match(adminSource, /Add resource/);
  assert.match(adminSource, /Administrator publication controls/);
  assert.match(publicStyleSource, /connections-app button:focus-visible/);
  assert.match(workflowStyleSource, /@media \(max-width: 760px\)/);
  assert.match(workflowStyleSource, /@media \(prefers-reduced-motion: reduce\)/);
});
