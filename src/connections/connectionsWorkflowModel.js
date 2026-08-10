export const CONNECTION_CATEGORY_OPTIONS = Object.freeze([
  ["co-ops-groups-community", "Co-ops, Groups & Community"],
  ["classes-tutors-academic-support", "Classes, Tutors & Academic Support"],
  ["arts-music-enrichment", "Arts, Music & Enrichment"],
  ["sports-clubs-activities", "Sports, Clubs & Activities"],
  ["field-trips-museums-attractions", "Field Trips, Museums & Attractions"],
  ["camps-seasonal-programs", "Camps & Seasonal Programs"],
  ["special-needs-therapy-family-support", "Special Needs, Therapy & Family Support"],
  ["college-career-dual-enrollment", "College, Career & Dual Enrollment"],
  ["curriculum-books-homeschool-services", "Curriculum, Books & Homeschool Services"],
  ["homeschool-friendly-businesses", "Homeschool-Friendly Businesses"],
].map(([value, label]) => Object.freeze({ value, label })));

export const SUBMISSION_STATUSES = Object.freeze([
  "submitted", "under_review", "needs_information", "declined", "archived",
]);
export const CORRECTION_STATUSES = Object.freeze([
  "submitted", "under_review", "needs_information", "applied", "declined", "archived",
]);
export const REFERRAL_STATUSES = Object.freeze([
  "submitted", "contacting_resource", "leader_approved", "leader_declined",
  "introduction_shared", "closed", "archived",
]);
export const RESOURCE_REVIEW_STATUSES = Object.freeze([
  "draft", "submitted", "under_review", "needs_information", "ready_for_decision",
]);

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CATEGORY_SLUGS = new Set(CONNECTION_CATEGORY_OPTIONS.map(({ value }) => value));
const WORLDVIEWS = new Set(["christian", "faith_based_other", "secular", "no_stated_religious_affiliation", "information_not_provided"]);
const DELIVERY_MODES = new Set(["in_person", "online", "hybrid"]);
const ACCEPTING_STATUSES = new Set(["accepting", "waitlist", "closed", "unknown"]);
const COST_TYPES = new Set(["free", "paid", "variable", "contact"]);
const CONSENT_STATUSES = new Set(["not_requested", "granted", "denied", "withdrawn"]);
const CONSENT_METHODS = new Set(["written", "phone", "in_person"]);

function text(value, maxLength = 5000) {
  return String(value || "").trim().slice(0, maxLength);
}

function checked(value) {
  return value === true || value === "true" || value === "on";
}

function requireText(value, label, minimum = 2) {
  if (value.length < minimum) throw new Error(`${label} is required.`);
}

function requireEmail(value) {
  if (!EMAIL_PATTERN.test(value)) throw new Error("Enter a valid email address.");
}

function optionalNumber(value, minimum, maximum, label) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw new Error(`${label} is invalid.`);
  }
  return number;
}

function normalizeContact(source, kind) {
  const value = text(source[`${kind}_value`], 500);
  const consentStatus = text(source[`${kind}_consent_status`], 30) || "not_requested";
  const consentedByName = text(source[`${kind}_consented_by_name`], 200);
  const consentedAt = text(source[`${kind}_consented_at`], 40);
  const consentMethod = text(source[`${kind}_consent_method`], 30);
  if (!CONSENT_STATUSES.has(consentStatus)) throw new Error(`${kind} consent status is invalid.`);
  if (consentStatus === "granted" && (!consentedByName || !consentedAt || !CONSENT_METHODS.has(consentMethod))) {
    throw new Error(`Document who granted ${kind} publication consent, when, and how.`);
  }
  return {
    value,
    consent_status: consentStatus,
    consented_by_name: consentedByName,
    consented_at: consentedAt || null,
    consent_method: consentMethod || null,
  };
}

export function normalizeConnectionResourceEditor(source = {}) {
  const resource = {
    id: text(source.id, 80) || null,
    slug: text(source.slug, 100),
    name: text(source.name, 200),
    short_description: text(source.short_description, 500),
    description: text(source.description),
    worldview: text(source.worldview, 80) || "information_not_provided",
    worldview_details: text(source.worldview_details, 1000),
    age_min: optionalNumber(source.age_min, 0, 120, "Minimum age"),
    age_max: optionalNumber(source.age_max, 0, 120, "Maximum age"),
    grade_min: optionalNumber(source.grade_min, -1, 12, "Minimum grade"),
    grade_max: optionalNumber(source.grade_max, -1, 12, "Maximum grade"),
    age_grade_notes: text(source.age_grade_notes, 1000),
    delivery_mode: text(source.delivery_mode, 30) || "in_person",
    accepting_status: text(source.accepting_status, 30) || "unknown",
    cost_type: text(source.cost_type, 30) || "contact",
    homeschool_specific: checked(source.homeschool_specific),
    daytime_available: checked(source.daytime_available),
    homeschool_discount: checked(source.homeschool_discount),
    service_area_summary: text(source.service_area_summary, 1000),
    category_slug: text(source.category_slug, 100),
    location: {
      name: text(source.location_name, 200),
      location_kind: text(source.location_kind, 30) || "physical",
      address_line_1: text(source.address_line_1, 300),
      city: text(source.city, 120),
      county: text(source.county, 120),
      state: text(source.state, 20) || "IL",
      postal_code: text(source.postal_code, 30),
      service_area: text(source.service_area, 1000),
      address_display: text(source.address_display, 30) || "town_only",
      address_consent_status: text(source.address_consent_status, 30) || "not_requested",
      address_consented_by_name: text(source.address_consented_by_name, 200),
      address_consented_at: text(source.address_consented_at, 40) || null,
      address_consent_method: text(source.address_consent_method, 30) || null,
    },
    contacts: {
      website: normalizeContact(source, "website"),
      email: normalizeContact(source, "email"),
      phone: normalizeContact(source, "phone"),
    },
  };

  requireText(resource.slug, "URL slug");
  if (!SLUG_PATTERN.test(resource.slug)) throw new Error("Use lowercase letters, numbers, and hyphens for the URL slug.");
  requireText(resource.name, "Resource name");
  requireText(resource.short_description, "Short description", 10);
  requireText(resource.description, "Full description", 20);
  if (!CATEGORY_SLUGS.has(resource.category_slug)) throw new Error("Choose a resource category.");
  if (!WORLDVIEWS.has(resource.worldview)) throw new Error("Choose a valid worldview description.");
  if (!DELIVERY_MODES.has(resource.delivery_mode)) throw new Error("Choose a valid delivery mode.");
  if (!ACCEPTING_STATUSES.has(resource.accepting_status)) throw new Error("Choose a valid availability status.");
  if (!COST_TYPES.has(resource.cost_type)) throw new Error("Choose a valid cost type.");
  if (resource.age_min !== null && resource.age_max !== null && resource.age_min > resource.age_max) throw new Error("Minimum age cannot exceed maximum age.");
  if (resource.grade_min !== null && resource.grade_max !== null && resource.grade_min > resource.grade_max) throw new Error("Minimum grade cannot exceed maximum grade.");
  if (!new Set(["physical", "service_area", "online"]).has(resource.location.location_kind)) throw new Error("Choose a valid location type.");
  if (!new Set(["full", "town_only", "none"]).has(resource.location.address_display)) throw new Error("Choose a valid address display setting.");
  if (!CONSENT_STATUSES.has(resource.location.address_consent_status)) throw new Error("Address consent status is invalid.");
  if (resource.location.address_display === "full" && resource.location.address_consent_status !== "granted") throw new Error("Full addresses require documented publication consent.");
  if (resource.location.address_consent_status === "granted" && (!resource.location.address_consented_by_name || !resource.location.address_consented_at || !CONSENT_METHODS.has(resource.location.address_consent_method))) {
    throw new Error("Document who granted address publication consent, when, and how.");
  }
  return resource;
}

export function getAnnualCheckInResources(resources = [], today = new Date(), noticeDays = 30) {
  const start = new Date(`${today.toISOString().slice(0, 10)}T00:00:00Z`);
  const cutoff = new Date(start);
  cutoff.setUTCDate(cutoff.getUTCDate() + noticeDays);
  return resources
    .filter((resource) => resource.verification_due_on)
    .filter((resource) => new Date(`${resource.verification_due_on}T00:00:00Z`) <= cutoff)
    .sort((left, right) => String(left.verification_due_on).localeCompare(String(right.verification_due_on)));
}

export function normalizeConnectionSubmission(source = {}) {
  const submission = {
    submission_type: text(source.submission_type, 30),
    organization_name: text(source.organization_name, 200),
    category_slug: text(source.category_slug, 100),
    description: text(source.description),
    homeschool_relevance: text(source.homeschool_relevance, 3000),
    worldview: text(source.worldview, 80) || "information_not_provided",
    delivery_mode: text(source.delivery_mode, 30) || "in_person",
    accepting_status: text(source.accepting_status, 30) || "unknown",
    cost_type: text(source.cost_type, 30) || "contact",
    age_grade_notes: text(source.age_grade_notes, 1000),
    homeschool_specific: checked(source.homeschool_specific),
    daytime_available: checked(source.daytime_available),
    homeschool_discount: checked(source.homeschool_discount),
    website: text(source.website, 500),
    city: text(source.city, 120),
    county: text(source.county, 120),
    service_area: text(source.service_area, 1000),
    requested_visibility: text(source.requested_visibility, 40) || "public",
    submitter_name: text(source.submitter_name, 200),
    submitter_email: text(source.submitter_email, 320).toLowerCase(),
    submitter_phone: text(source.submitter_phone, 80),
    submitter_relationship: text(source.submitter_relationship, 200),
    organization_contact_name: text(source.organization_contact_name, 200),
    organization_contact_email: text(source.organization_contact_email, 320).toLowerCase(),
    organization_contact_phone: text(source.organization_contact_phone, 80),
    publication_attested: checked(source.publication_attested),
    consent_website: checked(source.consent_website),
    consent_email: checked(source.consent_email),
    consent_phone: checked(source.consent_phone),
    website_confirm: text(source.website_confirm, 200),
  };

  if (!new Set(["representative", "suggestion", "staff"]).has(submission.submission_type)) {
    throw new Error("Choose how this resource is being submitted.");
  }
  requireText(submission.organization_name, "Resource name");
  if (!CATEGORY_SLUGS.has(submission.category_slug)) throw new Error("Choose a resource category.");
  requireText(submission.description, "Resource description", 20);
  requireText(submission.homeschool_relevance, "Homeschool relevance", 10);
  requireText(submission.submitter_name, "Your name");
  requireEmail(submission.submitter_email);
  if (submission.website_confirm) throw new Error("Submission could not be accepted.");
  if (submission.submission_type === "representative" && !submission.publication_attested) {
    throw new Error("Publication consent acknowledgement is required.");
  }
  if (submission.submission_type === "suggestion") {
    submission.publication_attested = false;
    submission.consent_website = false;
    submission.consent_email = false;
    submission.consent_phone = false;
  }
  return submission;
}

export function normalizeConnectionCorrection(source = {}, resourceSlug = "") {
  const correction = {
    resource_slug: text(resourceSlug, 200),
    requester_name: text(source.requester_name, 200),
    requester_email: text(source.requester_email, 320).toLowerCase(),
    requester_phone: text(source.requester_phone, 80),
    requester_relationship: text(source.requester_relationship, 200),
    requested_changes: text(source.requested_changes),
    privacy_removal_requested: checked(source.privacy_removal_requested),
    website_confirm: text(source.website_confirm, 200),
  };
  if (!SLUG_PATTERN.test(correction.resource_slug)) throw new Error("Resource not found.");
  requireText(correction.requester_name, "Your name");
  requireEmail(correction.requester_email);
  requireText(correction.requested_changes, "Requested correction", 10);
  if (correction.website_confirm) throw new Error("Request could not be accepted.");
  return correction;
}

export function normalizeConnectionReferral(source = {}) {
  const referral = {
    requester_name: text(source.requester_name, 200),
    requester_email: text(source.requester_email, 320).toLowerCase(),
    requester_phone: text(source.requester_phone, 80),
    preferred_contact: text(source.preferred_contact, 20) || "email",
    requested_resource_name: text(source.requested_resource_name, 200),
    family_need: text(source.family_need),
    consent_to_contact: checked(source.consent_to_contact),
    website_confirm: text(source.website_confirm, 200),
  };
  requireText(referral.requester_name, "Your name");
  requireEmail(referral.requester_email);
  if (!new Set(["email", "phone"]).has(referral.preferred_contact)) throw new Error("Choose a preferred contact method.");
  if (referral.preferred_contact === "phone" && referral.requester_phone.length < 7) throw new Error("Enter a phone number.");
  requireText(referral.family_need, "Referral request", 10);
  if (!referral.consent_to_contact) throw new Error("Permission to contact you is required.");
  if (referral.website_confirm) throw new Error("Request could not be accepted.");
  return referral;
}

export function suggestedConnectionSlug(name) {
  return text(name, 200)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function formatWorkflowStatus(value) {
  return text(value, 100)
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
