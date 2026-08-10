import { useState } from "react";
import { CONNECTION_CATEGORY_OPTIONS, suggestedConnectionSlug } from "./connectionsWorkflowModel.js";

const EMPTY_RESOURCE = Object.freeze({
  id: "", slug: "", name: "", short_description: "", description: "",
  worldview: "information_not_provided", worldview_details: "",
  age_min: "", age_max: "", grade_min: "", grade_max: "", age_grade_notes: "",
  delivery_mode: "in_person", accepting_status: "unknown", cost_type: "contact",
  homeschool_specific: false, daytime_available: false, homeschool_discount: false,
  service_area_summary: "", category_slug: "",
  location_name: "", location_kind: "physical", address_line_1: "", city: "", county: "",
  state: "IL", postal_code: "", service_area: "", address_display: "town_only",
  address_consent_status: "not_requested", address_consented_by_name: "",
  address_consented_at: "", address_consent_method: "",
  website_value: "", website_consent_status: "not_requested", website_consented_by_name: "", website_consented_at: "", website_consent_method: "",
  email_value: "", email_consent_status: "not_requested", email_consented_by_name: "", email_consented_at: "", email_consent_method: "",
  phone_value: "", phone_consent_status: "not_requested", phone_consented_by_name: "", phone_consented_at: "", phone_consent_method: "",
});

function localDateTime(value) {
  return value ? String(value).slice(0, 16) : "";
}

function editorValue(resource) {
  const merged = { ...EMPTY_RESOURCE, ...(resource || {}) };
  for (const name of ["address_consented_at", "website_consented_at", "email_consented_at", "phone_consented_at"]) {
    merged[name] = localDateTime(merged[name]);
  }
  return merged;
}

function ConsentFields({ kind, form, update }) {
  const statusName = `${kind}_consent_status`;
  const granted = form[statusName] === "granted";
  return (
    <fieldset className="connections-editor-consent">
      <legend>{kind.charAt(0).toUpperCase() + kind.slice(1)} publication consent</legend>
      <label>Consent status<select value={form[statusName]} onChange={(event) => update(statusName, event.target.value)}><option value="not_requested">Not requested</option><option value="granted">Granted</option><option value="denied">Denied</option><option value="withdrawn">Withdrawn</option></select></label>
      {granted && <>
        <label>Consenting adult<input value={form[`${kind}_consented_by_name`]} onChange={(event) => update(`${kind}_consented_by_name`, event.target.value)} /></label>
        <label>Consent date and time<input type="datetime-local" value={form[`${kind}_consented_at`]} onChange={(event) => update(`${kind}_consented_at`, event.target.value)} /></label>
        <label>Method<select value={form[`${kind}_consent_method`]} onChange={(event) => update(`${kind}_consent_method`, event.target.value)}><option value="">Choose</option><option value="phone">Phone</option><option value="in_person">In person</option><option value="written">Written</option></select></label>
      </>}
    </fieldset>
  );
}

export default function ConnectionsResourceEditor({ resource, onSave, onCancel }) {
  const [form, setForm] = useState(() => editorValue(resource));
  const update = (name, value) => setForm((current) => ({ ...current, [name]: value }));
  const updateName = (value) => setForm((current) => ({
    ...current,
    name: value,
    slug: current.id || current.slug ? current.slug : suggestedConnectionSlug(value),
  }));

  function submit(event) {
    event.preventDefault();
    onSave(form);
  }

  return (
    <section className="connections-resource-editor" aria-labelledby="connections-resource-editor-title">
      <header><div><p className="connections-eyebrow">Staff-only resource record</p><h2 id="connections-resource-editor-title">{form.id ? "Edit resource" : "Add resource"}</h2><p>Saving creates or updates a private staff draft. It never publishes automatically.</p></div><button type="button" onClick={onCancel}>Back to resources</button></header>
      <form onSubmit={submit}>
        <fieldset><legend>Resource identity</legend><div className="connections-form-grid">
          <label>Resource name<input value={form.name} onChange={(event) => updateName(event.target.value)} required /></label>
          <label>URL slug<input value={form.slug} onChange={(event) => update("slug", event.target.value)} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" required /></label>
          <label>Primary category<select value={form.category_slug} onChange={(event) => update("category_slug", event.target.value)} required><option value="">Choose a category</option>{CONNECTION_CATEGORY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          <label className="is-wide">Short directory description<textarea value={form.short_description} onChange={(event) => update("short_description", event.target.value)} rows="2" required /></label>
          <label className="is-wide">Full description<textarea value={form.description} onChange={(event) => update("description", event.target.value)} rows="5" required /></label>
        </div></fieldset>

        <fieldset><legend>Audience and service details</legend><div className="connections-form-grid">
          <label>Delivery mode<select value={form.delivery_mode} onChange={(event) => update("delivery_mode", event.target.value)}><option value="in_person">In person</option><option value="online">Online</option><option value="hybrid">Hybrid</option></select></label>
          <label>Availability<select value={form.accepting_status} onChange={(event) => update("accepting_status", event.target.value)}><option value="unknown">Unknown</option><option value="accepting">Accepting</option><option value="waitlist">Waitlist</option><option value="closed">Closed</option></select></label>
          <label>Cost<select value={form.cost_type} onChange={(event) => update("cost_type", event.target.value)}><option value="contact">Contact for cost</option><option value="free">Free</option><option value="paid">Paid</option><option value="variable">Variable</option></select></label>
          <label>Worldview<select value={form.worldview} onChange={(event) => update("worldview", event.target.value)}><option value="information_not_provided">Information not provided</option><option value="christian">Christian</option><option value="faith_based_other">Other faith-based</option><option value="secular">Secular</option><option value="no_stated_religious_affiliation">No stated religious affiliation</option></select></label>
          <label className="is-wide">Worldview details<textarea value={form.worldview_details} onChange={(event) => update("worldview_details", event.target.value)} rows="2" /></label>
          <label>Minimum age<input type="number" min="0" max="120" value={form.age_min ?? ""} onChange={(event) => update("age_min", event.target.value)} /></label>
          <label>Maximum age<input type="number" min="0" max="120" value={form.age_max ?? ""} onChange={(event) => update("age_max", event.target.value)} /></label>
          <label>Minimum grade<input type="number" min="-1" max="12" value={form.grade_min ?? ""} onChange={(event) => update("grade_min", event.target.value)} /></label>
          <label>Maximum grade<input type="number" min="-1" max="12" value={form.grade_max ?? ""} onChange={(event) => update("grade_max", event.target.value)} /></label>
          <label className="is-wide">Age and grade notes<textarea value={form.age_grade_notes} onChange={(event) => update("age_grade_notes", event.target.value)} rows="2" /></label>
          <label className="is-wide">Service-area summary<textarea value={form.service_area_summary} onChange={(event) => update("service_area_summary", event.target.value)} rows="2" /></label>
        </div><div className="connections-check-grid">
          <label><input type="checkbox" checked={form.homeschool_specific} onChange={(event) => update("homeschool_specific", event.target.checked)} /> Homeschool-specific</label>
          <label><input type="checkbox" checked={form.daytime_available} onChange={(event) => update("daytime_available", event.target.checked)} /> Daytime availability</label>
          <label><input type="checkbox" checked={form.homeschool_discount} onChange={(event) => update("homeschool_discount", event.target.checked)} /> Homeschool discount</label>
        </div></fieldset>

        <fieldset><legend>Primary location</legend><div className="connections-form-grid">
          <label>Location name<input value={form.location_name} onChange={(event) => update("location_name", event.target.value)} /></label>
          <label>Location type<select value={form.location_kind} onChange={(event) => update("location_kind", event.target.value)}><option value="physical">Physical</option><option value="service_area">Service area</option><option value="online">Online</option></select></label>
          <label>City<input value={form.city} onChange={(event) => update("city", event.target.value)} /></label><label>County<input value={form.county} onChange={(event) => update("county", event.target.value)} /></label>
          <label>State<input value={form.state} onChange={(event) => update("state", event.target.value)} /></label><label>Postal code<input value={form.postal_code} onChange={(event) => update("postal_code", event.target.value)} /></label>
          <label className="is-wide">Street address<input value={form.address_line_1} onChange={(event) => update("address_line_1", event.target.value)} /></label>
          <label className="is-wide">Service area<input value={form.service_area} onChange={(event) => update("service_area", event.target.value)} /></label>
          <label>Public address display<select value={form.address_display} onChange={(event) => update("address_display", event.target.value)}><option value="town_only">Town only</option><option value="none">Do not display</option><option value="full">Full address</option></select></label>
          <label>Address consent<select value={form.address_consent_status} onChange={(event) => update("address_consent_status", event.target.value)}><option value="not_requested">Not requested</option><option value="granted">Granted</option><option value="denied">Denied</option><option value="withdrawn">Withdrawn</option></select></label>
          {form.address_consent_status === "granted" && <><label>Consenting adult<input value={form.address_consented_by_name} onChange={(event) => update("address_consented_by_name", event.target.value)} /></label><label>Consent date and time<input type="datetime-local" value={form.address_consented_at} onChange={(event) => update("address_consented_at", event.target.value)} /></label><label>Consent method<select value={form.address_consent_method} onChange={(event) => update("address_consent_method", event.target.value)}><option value="">Choose</option><option value="phone">Phone</option><option value="in_person">In person</option><option value="written">Written</option></select></label></>}
        </div></fieldset>

        <fieldset><legend>Organization contact information</legend><p>Only organization-approved fields with granted consent can enter public views.</p>{["website", "email", "phone"].map((kind) => <div className="connections-editor-contact" key={kind}><label>{kind.charAt(0).toUpperCase() + kind.slice(1)}<input type={kind === "email" ? "email" : kind === "website" ? "url" : "tel"} value={form[`${kind}_value`]} onChange={(event) => update(`${kind}_value`, event.target.value)} /></label><ConsentFields kind={kind} form={form} update={update} /></div>)}</fieldset>

        <div className="connections-admin-button-row"><button className="connections-submit-button" type="submit">Save private draft</button><button type="button" onClick={onCancel}>Cancel</button></div>
      </form>
    </section>
  );
}
