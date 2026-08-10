import { useState } from "react";
import { ConnectionsHeader } from "./ConnectionsPublic.jsx";
import { CONNECTION_CATEGORY_OPTIONS } from "./connectionsWorkflowModel.js";
import {
  CONNECTIONS_BASE_PATH,
  CONNECTIONS_REFERRAL_PATH,
  CONNECTIONS_SUBMIT_PATH,
} from "../routing/appRoutes.js";
import { useConnectionsMetadata } from "./connectionsMetadata.js";
import "./ConnectionsWorkflows.css";

function FormStatus({ status }) {
  if (!status.message) return null;
  return <div className={`connections-form-status is-${status.kind}`} role={status.kind === "error" ? "alert" : "status"}>{status.message}</div>;
}

function submitForm(event, action, setStatus) {
  event.preventDefault();
  const form = event.currentTarget;
  setStatus({ kind: "loading", message: "Sending your request…" });
  const values = Object.fromEntries(new FormData(form));
  return action(values).then((reference) => {
    form.reset();
    setStatus({
      kind: "success",
      message: `Thank you. IL HRC received your request. Reference ${String(reference).slice(0, 8).toUpperCase()}. Nothing has been published automatically.`,
    });
  }).catch((error) => {
    setStatus({ kind: "error", message: error.message || "Your request could not be sent." });
  });
}

function WorkflowPage({ children, onNavigate, eyebrow, title, intro, metadataPage, pathname }) {
  useConnectionsMetadata({ page: metadataPage, pathname, enabled: true });
  return (
    <div className="connections-app">
      <a className="connections-skip-link" href="#main-content">Skip to main content</a>
      <ConnectionsHeader onNavigate={onNavigate} />
      <main id="main-content" className="connections-main connections-workflow-page">
        <a className="connections-back-link" href={CONNECTIONS_BASE_PATH} onClick={(event) => onNavigate(event, CONNECTIONS_BASE_PATH)}>← Back to the directory</a>
        <header className="connections-workflow-intro">
          <p className="connections-eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          <p>{intro}</p>
        </header>
        {children}
      </main>
    </div>
  );
}

export function ConnectionsSubmissionPage({ workflowService, onNavigate }) {
  const [submissionType, setSubmissionType] = useState("representative");
  const [status, setStatus] = useState({ kind: "idle", message: "" });
  const isRepresentative = submissionType === "representative";

  return (
    <WorkflowPage
      onNavigate={onNavigate}
      eyebrow="Native Connections intake"
      title="Suggest a resource"
      intro="Send a homeschool-friendly resource for IL HRC to research. Every submission is reviewed and personally verified before an administrator can publish it."
      metadataPage="submit"
      pathname={CONNECTIONS_SUBMIT_PATH}
    >
      <aside className="connections-privacy-note"><strong>Please do not include information about children or minors.</strong> Submit only adult or organizational contact information needed for IL HRC to follow up.</aside>
      <form className="connections-workflow-form" onSubmit={(event) => submitForm(event, (values) => workflowService.submitResource(values), setStatus)}>
        <fieldset>
          <legend>How are you connected to this resource?</legend>
          <label><input type="radio" name="submission_type" value="representative" checked={isRepresentative} onChange={(event) => setSubmissionType(event.target.value)} /> I represent this resource</label>
          <label><input type="radio" name="submission_type" value="suggestion" checked={!isRepresentative} onChange={(event) => setSubmissionType(event.target.value)} /> I’m suggesting a resource for IL HRC to investigate</label>
        </fieldset>

        <section aria-labelledby="resource-information-heading">
          <h2 id="resource-information-heading">Resource information</h2>
          <div className="connections-form-grid">
            <label>Resource or organization name<input name="organization_name" required minLength="2" maxLength="200" /></label>
            <label>Primary category<select name="category_slug" required defaultValue=""><option value="" disabled>Choose a category</option>{CONNECTION_CATEGORY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
            <label className="is-wide">What does this resource offer?<textarea name="description" required minLength="20" maxLength="5000" rows="5" /></label>
            <label className="is-wide">Why is it useful to homeschool families?<textarea name="homeschool_relevance" required minLength="10" maxLength="3000" rows="4" /></label>
            <label>Website or public page<input name="website" type="url" maxLength="500" placeholder="https://" /></label>
            <label>Town<input name="city" maxLength="120" /></label>
            <label>County<input name="county" maxLength="120" /></label>
            <label>Service area<input name="service_area" maxLength="1000" /></label>
            <label>Religious affiliation<select name="worldview" defaultValue="information_not_provided"><option value="christian">Christian</option><option value="faith_based_other">Faith-based—other</option><option value="secular">Secular</option><option value="no_stated_religious_affiliation">No stated religious affiliation</option><option value="information_not_provided">Information not provided</option></select></label>
            <label>Format<select name="delivery_mode" defaultValue="in_person"><option value="in_person">In person</option><option value="online">Online</option><option value="hybrid">Hybrid</option></select></label>
            <label>Availability<select name="accepting_status" defaultValue="unknown"><option value="accepting">Accepting</option><option value="waitlist">Waitlist</option><option value="closed">Closed</option><option value="unknown">Unknown</option></select></label>
            <label>Cost<select name="cost_type" defaultValue="contact"><option value="free">Free</option><option value="paid">Paid</option><option value="variable">Variable</option><option value="contact">Contact resource</option></select></label>
            <label className="is-wide">Ages or grades served<input name="age_grade_notes" maxLength="1000" /></label>
          </div>
          <div className="connections-check-grid">
            <label><input type="checkbox" name="homeschool_specific" /> Homeschool-specific programming</label>
            <label><input type="checkbox" name="daytime_available" /> Daytime availability</label>
            <label><input type="checkbox" name="homeschool_discount" /> Homeschool discount</label>
          </div>
        </section>

        <section aria-labelledby="submitter-information-heading">
          <h2 id="submitter-information-heading">Contact information</h2>
          <p className="connections-form-help">Tell us how to reach you. If the organization has a different contact person and you have permission to share their information, add that separately below.</p>
          <div className="connections-form-grid">
            <label>Your name<input name="submitter_name" required maxLength="200" /></label>
            <label>Your email<input name="submitter_email" type="email" required maxLength="320" /></label>
            <label>Your phone<input name="submitter_phone" type="tel" maxLength="80" /></label>
            <label>Your relationship to the resource<input name="submitter_relationship" maxLength="200" /></label>
            <label>Organization contact name<input name="organization_contact_name" maxLength="200" /></label>
            <label>Organization contact email<input name="organization_contact_email" type="email" maxLength="320" /></label>
            <label>Organization contact phone<input name="organization_contact_phone" type="tel" maxLength="80" /></label>
            <label>Requested visibility<select name="requested_visibility" defaultValue="public"><option value="public">Public</option><option value="limited">Limited</option><option value="private_referral">Private referral</option><option value="temporarily_hidden">Temporarily hidden</option></select></label>
          </div>
        </section>

        {isRepresentative ? (
          <fieldset>
            <legend>Publication consent</legend>
            <p>Choose each field IL HRC may consider for public display. Staff will confirm this consent during verification.</p>
            <label><input type="checkbox" name="consent_website" /> Website or public page</label>
            <label><input type="checkbox" name="consent_email" /> Organization contact email</label>
            <label><input type="checkbox" name="consent_phone" /> Organization contact phone</label>
            <label><input type="checkbox" name="publication_attested" required /> I am authorized to provide these publication choices and understand IL HRC makes the final inclusion decision.</label>
          </fieldset>
        ) : (
          <aside className="connections-privacy-note">A family suggestion cannot grant publication permission for an organization. IL HRC will contact the responsible adult before displaying any contact information.</aside>
        )}

        <div className="connections-honeypot" aria-hidden="true"><label>Leave blank<input name="website_confirm" tabIndex="-1" autoComplete="off" /></label></div>
        <FormStatus status={status} />
        <button className="connections-submit-button" type="submit" disabled={status.kind === "loading"}>Send for IL HRC review</button>
      </form>
    </WorkflowPage>
  );
}

export function ConnectionsCorrectionPage({ resourceSlug, workflowService, onNavigate }) {
  const [status, setStatus] = useState({ kind: "idle", message: "" });
  return (
    <WorkflowPage onNavigate={onNavigate} eyebrow="Listing accuracy and privacy" title="Request a correction or removal" intro="Tell IL HRC what needs to change. Privacy-related removal requests are prioritized for prompt review." metadataPage="correction" pathname={`${CONNECTIONS_BASE_PATH}/${resourceSlug}/correction`}>
      <form className="connections-workflow-form" onSubmit={(event) => submitForm(event, (values) => workflowService.submitCorrection(resourceSlug, values), setStatus)}>
        <div className="connections-form-grid">
          <label>Your name<input name="requester_name" required maxLength="200" /></label>
          <label>Your email<input name="requester_email" type="email" required maxLength="320" /></label>
          <label>Your phone<input name="requester_phone" type="tel" maxLength="80" /></label>
          <label>Your relationship to this resource<input name="requester_relationship" maxLength="200" /></label>
          <label className="is-wide">What should be corrected or removed?<textarea name="requested_changes" required minLength="10" maxLength="5000" rows="6" /></label>
        </div>
        <label className="connections-priority-check"><input type="checkbox" name="privacy_removal_requested" /> This is a privacy-related removal request</label>
        <p className="connections-form-help">Do not include information about children or minors.</p>
        <div className="connections-honeypot" aria-hidden="true"><label>Leave blank<input name="website_confirm" tabIndex="-1" autoComplete="off" /></label></div>
        <FormStatus status={status} />
        <button className="connections-submit-button" type="submit" disabled={status.kind === "loading"}>Send correction request</button>
      </form>
    </WorkflowPage>
  );
}

export function ConnectionsReferralPage({ workflowService, onNavigate }) {
  const [status, setStatus] = useState({ kind: "idle", message: "" });
  return (
    <WorkflowPage onNavigate={onNavigate} eyebrow="Resource matching" title="Request help finding a resource" intro="Tell IL HRC what kind of resource you are looking for. When a resource uses a private-introduction process, IL HRC contacts its leader. The leader must approve each introduction before any private contact information is shared." metadataPage="referral" pathname={CONNECTIONS_REFERRAL_PATH}>
      <form className="connections-workflow-form" onSubmit={(event) => submitForm(event, (values) => workflowService.submitReferral(values), setStatus)}>
        <div className="connections-form-grid">
          <label>Your name<input name="requester_name" required maxLength="200" /></label>
          <label>Your email<input name="requester_email" type="email" required maxLength="320" /></label>
          <label>Your phone<input name="requester_phone" type="tel" maxLength="80" /></label>
          <label>Preferred contact<select name="preferred_contact" defaultValue="email"><option value="email">Email</option><option value="phone">Phone</option></select></label>
          <label className="is-wide">Resource name, if known<input name="requested_resource_name" maxLength="200" /></label>
          <label className="is-wide">What general type of resource are you seeking?<textarea name="family_need" required minLength="10" maxLength="5000" rows="6" /></label>
        </div>
        <label className="connections-priority-check"><input type="checkbox" name="consent_to_contact" required /> IL HRC may contact me about this request.</label>
        <div className="connections-honeypot" aria-hidden="true"><label>Leave blank<input name="website_confirm" tabIndex="-1" autoComplete="off" /></label></div>
        <FormStatus status={status} />
        <button className="connections-submit-button" type="submit" disabled={status.kind === "loading"}>Send referral request</button>
      </form>
      <aside className="connections-privacy-note connections-workflow-footer-note"><strong>A listing does not guarantee availability or approval.</strong> Do not submit children’s names, medical records, diagnoses, school records or other information about minors. Describe only the general type of resource your family is seeking.</aside>
    </WorkflowPage>
  );
}
