import { createConnectionsSupabaseClientFromEnvironment } from "./connectionsSupabaseClient.js";

export const CONNECTIONS_WORKFLOW_TABLES = Object.freeze({
  submissions: "connection_submissions",
  corrections: "connection_correction_requests",
  referrals: "connection_referral_requests",
  resources: "staff_connections_resource_queue",
  verifications: "connection_verifications",
  notes: "connection_internal_notes",
  activity: "connection_activity",
  profiles: "profiles",
});

export const CONNECTIONS_SUBMISSION_SELECT = [
  "id", "submission_type", "status", "organization_name", "description",
  "homeschool_relevance", "website", "city", "county", "service_area",
  "requested_visibility", "submitter_name", "submitter_email", "submitter_phone",
  "submitter_relationship", "organization_contact_name", "organization_contact_email",
  "organization_contact_phone", "resource_id", "assigned_to", "staff_notes",
  "created_at", "updated_at",
].join(",");

export const CONNECTIONS_CORRECTION_SELECT = [
  "id", "resource_id", "status", "requester_name", "requester_email", "requester_phone",
  "requester_relationship", "requested_changes", "privacy_removal_requested",
  "assigned_to", "staff_notes", "created_at", "updated_at",
].join(",");

export const CONNECTIONS_REFERRAL_SELECT = [
  "id", "resource_id", "requested_resource_name", "status", "requester_name",
  "requester_email", "requester_phone", "preferred_contact", "family_need",
  "responsible_contact_name", "leader_decision_at", "introduction_shared_at",
  "assigned_to", "handled_by", "staff_notes", "created_at", "updated_at",
].join(",");

export const CONNECTIONS_RESOURCE_QUEUE_SELECT = [
  "id", "slug", "name", "review_status", "decision_status", "publication_state",
  "requested_visibility", "approved_visibility", "stable_resource_confirmed",
  "geographic_scope", "geographic_exception_reason",
  "last_verified_on", "verification_due_on", "pause_reason", "updated_at",
  "verification_overdue",
].join(",");

export const CONNECTIONS_VERIFICATION_SELECT = [
  "id", "resource_id", "verified_on", "next_due_on", "method",
  "responsible_contact_name", "performed_by", "outcome", "visibility_confirmed",
  "notes", "created_at",
].join(",");

export const CONNECTIONS_INTERNAL_NOTE_SELECT = [
  "id", "resource_id", "body", "created_by", "created_at",
].join(",");

export const CONNECTIONS_ACTIVITY_SELECT = [
  "id", "resource_id", "entity_type", "event_type", "actor_id", "created_at",
].join(",");

function requireResult(result, message) {
  if (result.error) throw new Error(result.error.message || message);
  return result.data;
}

function rpcReference(data) {
  const value = Array.isArray(data) ? data[0] : data;
  return typeof value === "string" ? value : value?.id || value;
}

export function createConnectionsWorkflowSupabaseAdapter(client) {
  if (!client?.rpc || !client?.from || !client?.auth) throw new Error("Connections workflow client is unavailable.");

  return {
    async submitResource(submission) {
      const result = await client.rpc("submit_connection_resource", { p_submission: submission });
      return rpcReference(requireResult(result, "The resource submission could not be sent."));
    },

    async submitCorrection(correction) {
      const result = await client.rpc("submit_connection_correction", {
        p_resource_slug: correction.resource_slug,
        p_requester_name: correction.requester_name,
        p_requester_email: correction.requester_email,
        p_requester_phone: correction.requester_phone,
        p_requester_relationship: correction.requester_relationship,
        p_requested_changes: correction.requested_changes,
        p_privacy_removal_requested: correction.privacy_removal_requested,
        p_website_confirm: correction.website_confirm,
      });
      return rpcReference(requireResult(result, "The correction request could not be sent."));
    },

    async submitReferral(referral) {
      const result = await client.rpc("submit_connection_referral", {
        p_requester_name: referral.requester_name,
        p_requester_email: referral.requester_email,
        p_requester_phone: referral.requester_phone,
        p_preferred_contact: referral.preferred_contact,
        p_requested_resource_name: referral.requested_resource_name,
        p_family_need: referral.family_need,
        p_consent_to_contact: referral.consent_to_contact,
        p_website_confirm: referral.website_confirm,
      });
      return rpcReference(requireResult(result, "The referral request could not be sent."));
    },

    async getSession() {
      const result = await client.auth.getSession();
      return requireResult(result, "The staff session could not be checked.")?.session || null;
    },

    onAuthStateChange(callback) {
      return client.auth.onAuthStateChange((_event, session) => callback(session));
    },

    async signIn(email, password) {
      const result = await client.auth.signInWithPassword({ email, password });
      return requireResult(result, "Sign-in failed.")?.session || null;
    },

    async signOut() {
      requireResult(await client.auth.signOut(), "Sign-out failed.");
    },

    async getStaffProfile(userId) {
      const result = await client
        .from(CONNECTIONS_WORKFLOW_TABLES.profiles)
        .select("id,email,full_name,role,is_active")
        .eq("id", userId)
        .maybeSingle();
      const profile = requireResult(result, "The staff profile could not be loaded.");
      if (!profile?.is_active || !new Set(["team", "admin"]).has(profile.role)) return null;
      return profile;
    },

    async listQueues() {
      const [submissions, corrections, referrals, resources, verifications, notes, activity] = await Promise.all([
        client.from(CONNECTIONS_WORKFLOW_TABLES.submissions).select(CONNECTIONS_SUBMISSION_SELECT).order("created_at", { ascending: false }),
        client.from(CONNECTIONS_WORKFLOW_TABLES.corrections).select(CONNECTIONS_CORRECTION_SELECT).order("created_at", { ascending: false }),
        client.from(CONNECTIONS_WORKFLOW_TABLES.referrals).select(CONNECTIONS_REFERRAL_SELECT).order("created_at", { ascending: false }),
        client.from(CONNECTIONS_WORKFLOW_TABLES.resources).select(CONNECTIONS_RESOURCE_QUEUE_SELECT).order("updated_at", { ascending: false }),
        client.from(CONNECTIONS_WORKFLOW_TABLES.verifications).select(CONNECTIONS_VERIFICATION_SELECT).order("created_at", { ascending: false }),
        client.from(CONNECTIONS_WORKFLOW_TABLES.notes).select(CONNECTIONS_INTERNAL_NOTE_SELECT).is("redacted_at", null).order("created_at", { ascending: false }),
        client.from(CONNECTIONS_WORKFLOW_TABLES.activity).select(CONNECTIONS_ACTIVITY_SELECT).order("created_at", { ascending: false }).limit(500),
      ]);
      return {
        submissions: requireResult(submissions, "Submissions could not be loaded.") || [],
        corrections: requireResult(corrections, "Correction requests could not be loaded.") || [],
        referrals: requireResult(referrals, "Referral requests could not be loaded.") || [],
        resources: requireResult(resources, "Resource review queue could not be loaded.") || [],
        verifications: requireResult(verifications, "Verification history could not be loaded.") || [],
        notes: requireResult(notes, "Internal notes could not be loaded.") || [],
        activity: requireResult(activity, "Resource activity could not be loaded.") || [],
      };
    },

    async getResourceEditor(id) {
      const result = await client.rpc("get_connection_resource_editor", { p_resource_id: id });
      return requireResult(result, "Resource details could not be loaded.");
    },

    async saveResource(resource) {
      return rpcReference(requireResult(await client.rpc("save_connection_resource", {
        p_resource: resource,
      }), "Resource could not be saved."));
    },

    async setSubmissionStatus(id, status, notes = "") {
      return requireResult(await client.rpc("set_connection_submission_status", {
        p_submission_id: id, p_status: status, p_staff_notes: notes,
      }), "Submission status could not be changed.");
    },

    async convertSubmission(id, slug) {
      return rpcReference(requireResult(await client.rpc("convert_connection_submission_to_draft", {
        p_submission_id: id, p_slug: slug,
      }), "Submission could not be converted."));
    },

    async setCorrectionStatus(id, status, notes = "") {
      return requireResult(await client.rpc("set_connection_correction_status", {
        p_request_id: id, p_status: status, p_staff_notes: notes,
      }), "Correction status could not be changed.");
    },

    async setReferralStatus(id, status, responsibleContactName = "", notes = "") {
      return requireResult(await client.rpc("set_connection_referral_status", {
        p_request_id: id,
        p_status: status,
        p_responsible_contact_name: responsibleContactName,
        p_staff_notes: notes,
      }), "Referral status could not be changed.");
    },

    async setResourceReviewStatus(id, status) {
      return requireResult(await client.rpc("set_connection_review_status", {
        p_resource_id: id, p_review_status: status,
      }), "Resource review status could not be changed.");
    },

    async updateResourceReviewControls(id, controls) {
      return requireResult(await client.rpc("update_connection_review_controls", {
        p_resource_id: id,
        p_requested_visibility: controls.requested_visibility,
        p_geographic_scope: controls.geographic_scope,
        p_geographic_exception_reason: controls.geographic_exception_reason || "",
        p_stable_resource_confirmed: controls.stable_resource_confirmed,
      }), "Resource inclusion controls could not be changed.");
    },

    async recordVerification(id, verification) {
      return requireResult(await client.rpc("record_connection_verification", {
        p_resource_id: id,
        p_verified_on: verification.verified_on,
        p_method: verification.method,
        p_responsible_contact_name: verification.responsible_contact_name,
        p_outcome: verification.outcome,
        p_visibility_confirmed: verification.visibility_confirmed || null,
        p_notes: verification.notes || "",
      }), "Verification could not be recorded.");
    },

    async recordVisibilityConsent(id, consent) {
      return requireResult(await client.rpc("record_connection_visibility_consent", {
        p_resource_id: id,
        p_visibility: consent.visibility,
        p_consented_by_name: consent.consented_by_name,
        p_contact_role: consent.contact_role || "",
        p_consent_method: consent.consent_method,
        p_consented_at: consent.consented_at,
      }), "Visibility consent could not be recorded.");
    },

    async addInternalNote(id, body) {
      return requireResult(await client.rpc("add_connection_internal_note", {
        p_resource_id: id, p_body: body,
      }), "Internal note could not be added.");
    },

    async administerResource(action, id, value = "") {
      const calls = {
        approve: ["admin_approve_connection", { p_resource_id: id, p_approved_visibility: value }],
        publish: ["admin_publish_connection", { p_resource_id: id }],
        pause: ["admin_pause_connection", { p_resource_id: id, p_reason: value }],
        decline: ["admin_decline_connection", { p_resource_id: id, p_reason: value }],
        archive: ["admin_archive_connection", { p_resource_id: id, p_reason: value }],
      };
      if (!calls[action]) throw new Error("Unknown administrative action.");
      const [functionName, parameters] = calls[action];
      return requireResult(await client.rpc(functionName, parameters), "Administrative action failed.");
    },
  };
}

export function createConnectionsWorkflowSupabaseAdapterFromEnvironment(environment = {}) {
  return createConnectionsWorkflowSupabaseAdapter(
    createConnectionsSupabaseClientFromEnvironment(environment),
  );
}
