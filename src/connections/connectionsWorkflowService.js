import {
  normalizeConnectionCorrection,
  normalizeConnectionReferral,
  normalizeConnectionSubmission,
} from "./connectionsWorkflowModel.js";

export function createConnectionsWorkflowService({ enabled = false, adapter } = {}) {
  function requireAdapter() {
    if (!enabled || !adapter) throw new Error("Connections workflows are not available.");
    return adapter;
  }

  return {
    submitResource(source) {
      return requireAdapter().submitResource(normalizeConnectionSubmission(source));
    },
    submitCorrection(resourceSlug, source) {
      return requireAdapter().submitCorrection(normalizeConnectionCorrection(source, resourceSlug));
    },
    submitReferral(source) {
      return requireAdapter().submitReferral(normalizeConnectionReferral(source));
    },
    getSession: () => requireAdapter().getSession(),
    onAuthStateChange: (callback) => requireAdapter().onAuthStateChange(callback),
    signIn: (email, password) => requireAdapter().signIn(email, password),
    signOut: () => requireAdapter().signOut(),
    getStaffProfile: (userId) => requireAdapter().getStaffProfile(userId),
    listQueues: () => requireAdapter().listQueues(),
    setSubmissionStatus: (id, status, notes) => requireAdapter().setSubmissionStatus(id, status, notes),
    convertSubmission: (id, slug) => requireAdapter().convertSubmission(id, slug),
    setCorrectionStatus: (id, status, notes) => requireAdapter().setCorrectionStatus(id, status, notes),
    setReferralStatus: (id, status, contactName, notes) => requireAdapter().setReferralStatus(id, status, contactName, notes),
    setResourceReviewStatus: (id, status) => requireAdapter().setResourceReviewStatus(id, status),
    updateResourceReviewControls: (id, controls) => requireAdapter().updateResourceReviewControls(id, controls),
    recordVerification: (id, verification) => requireAdapter().recordVerification(id, verification),
    recordVisibilityConsent: (id, consent) => requireAdapter().recordVisibilityConsent(id, consent),
    addInternalNote: (id, body) => requireAdapter().addInternalNote(id, body),
    administerResource: (action, id, value) => requireAdapter().administerResource(action, id, value),
  };
}
