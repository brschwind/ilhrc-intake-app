import { useCallback, useEffect, useMemo, useState } from "react";
import { ConnectionsHeader } from "./ConnectionsPublic.jsx";
import ConnectionsResourceEditor from "./ConnectionsResourceEditor.jsx";
import {
  CORRECTION_STATUSES,
  REFERRAL_STATUSES,
  RESOURCE_REVIEW_STATUSES,
  SUBMISSION_STATUSES,
  formatWorkflowStatus,
  getAnnualCheckInResources,
  suggestedConnectionSlug,
} from "./connectionsWorkflowModel.js";
import { CONNECTIONS_ADMIN_PATH } from "../routing/appRoutes.js";
import { useConnectionsMetadata } from "./connectionsMetadata.js";
import "./ConnectionsWorkflows.css";

const EMPTY_QUEUES = { submissions: [], corrections: [], referrals: [], resources: [], verifications: [], notes: [], activity: [] };

function QueueEmpty() {
  return <p className="connections-admin-empty">Nothing is waiting in this queue.</p>;
}

function QueueSection({ title, count, children }) {
  return <section className="connections-admin-section"><header><h2>{title}</h2><span>{count}</span></header>{children}</section>;
}

function SubmissionCard({ item, service, refresh, runAction }) {
  const [status, setStatus] = useState(item.status);
  const [notes, setNotes] = useState(item.staff_notes || "");
  const [slug, setSlug] = useState(suggestedConnectionSlug(item.organization_name));
  return (
    <article className="connections-admin-card">
      <header><div><p className="connections-card-category">{formatWorkflowStatus(item.submission_type)} submission</p><h3>{item.organization_name}</h3></div><strong>{formatWorkflowStatus(item.status)}</strong></header>
      <p>{item.description}</p>
      <dl><div><dt>Submitted by</dt><dd>{item.submitter_name} · {item.submitter_email}</dd></div><div><dt>Organization contact</dt><dd>{item.organization_contact_name || "Not supplied"} {item.organization_contact_email}</dd></div><div><dt>Location</dt><dd>{[item.city, item.county].filter(Boolean).join(", ") || item.service_area || "Not supplied"}</dd></div><div><dt>Requested visibility</dt><dd>{formatWorkflowStatus(item.requested_visibility)}</dd></div></dl>
      <label>Staff notes<textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows="3" /></label>
      <div className="connections-admin-actions">
        <label>Status<select value={status} onChange={(event) => setStatus(event.target.value)}>{SUBMISSION_STATUSES.map((value) => <option key={value} value={value}>{formatWorkflowStatus(value)}</option>)}</select></label>
        <button type="button" onClick={() => runAction(() => service.setSubmissionStatus(item.id, status, notes), refresh)}>Save status</button>
      </div>
      {!item.resource_id && !new Set(["declined", "archived"]).has(item.status) && <div className="connections-convert-action"><label>Draft URL slug<input value={slug} onChange={(event) => setSlug(event.target.value)} /></label><button type="button" onClick={() => runAction(() => service.convertSubmission(item.id, slug), refresh)}>Create staff draft</button></div>}
    </article>
  );
}

function CorrectionCard({ item, isAdmin, service, refresh, runAction }) {
  const [status, setStatus] = useState(item.status);
  const [notes, setNotes] = useState(item.staff_notes || "");
  return (
    <article className={`connections-admin-card ${item.privacy_removal_requested ? "is-priority" : ""}`}>
      <header><div><p className="connections-card-category">{item.privacy_removal_requested ? "Privacy removal priority" : "Correction request"}</p><h3>{item.requester_name}</h3></div><strong>{formatWorkflowStatus(item.status)}</strong></header>
      <p>{item.requested_changes}</p><p className="connections-admin-contact">{item.requester_email} {item.requester_phone}</p>
      <label>Staff notes<textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows="3" /></label>
      <div className="connections-admin-actions"><label>Status<select value={status} onChange={(event) => setStatus(event.target.value)}>{CORRECTION_STATUSES.map((value) => <option key={value} value={value}>{formatWorkflowStatus(value)}</option>)}</select></label><button type="button" onClick={() => runAction(() => service.setCorrectionStatus(item.id, status, notes), refresh)}>Save status</button></div>
      {item.privacy_removal_requested && isAdmin && <button type="button" onClick={() => runAction(() => service.administerResource("pause", item.resource_id, "Privacy removal request under review."), refresh)}>Pause public listing now</button>}
    </article>
  );
}

function ReferralCard({ item, service, refresh, runAction }) {
  const [status, setStatus] = useState(item.status);
  const [contactName, setContactName] = useState(item.responsible_contact_name || "");
  const [notes, setNotes] = useState(item.staff_notes || "");
  return (
    <article className="connections-admin-card">
      <header><div><p className="connections-card-category">Private referral</p><h3>{item.requested_resource_name || "General resource request"}</h3></div><strong>{formatWorkflowStatus(item.status)}</strong></header>
      <p>{item.family_need}</p><p className="connections-admin-contact">{item.requester_name} · {item.requester_email} {item.requester_phone}</p>
      <div className="connections-form-grid"><label>Responsible resource contact<input value={contactName} onChange={(event) => setContactName(event.target.value)} /></label><label>Status<select value={status} onChange={(event) => setStatus(event.target.value)}>{REFERRAL_STATUSES.map((value) => <option key={value} value={value}>{formatWorkflowStatus(value)}</option>)}</select></label><label className="is-wide">Staff notes<textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows="3" /></label></div>
      <button type="button" onClick={() => runAction(() => service.setReferralStatus(item.id, status, contactName, notes), refresh)}>Save referral action</button>
    </article>
  );
}

function ResourceCard({ item, isAdmin, verifications, notes, activity, service, refresh, runAction, onEdit, annualCheckIn = false }) {
  const [reviewStatus, setReviewStatus] = useState(item.review_status);
  const [visibility, setVisibility] = useState(item.requested_visibility || "public");
  const [geographicScope, setGeographicScope] = useState(item.geographic_scope || "corridor");
  const [geographicExceptionReason, setGeographicExceptionReason] = useState(item.geographic_exception_reason || "");
  const [stableResourceConfirmed, setStableResourceConfirmed] = useState(Boolean(item.stable_resource_confirmed));
  const [reason, setReason] = useState("");
  const [internalNote, setInternalNote] = useState("");
  const [verification, setVerification] = useState({ verified_on: new Date().toISOString().slice(0, 10), method: "phone", responsible_contact_name: "", outcome: "verified", visibility_confirmed: item.requested_visibility || "public", notes: "" });
  const [consent, setConsent] = useState({ visibility: item.requested_visibility || "public", consented_by_name: "", contact_role: "", consent_method: "phone", consented_at: new Date().toISOString().slice(0, 16) });
  function updateVerification(name, value) { setVerification((current) => ({ ...current, [name]: value })); }
  function updateConsent(name, value) { setConsent((current) => ({ ...current, [name]: value })); }
  return (
    <article className={`connections-admin-card ${item.verification_overdue ? "is-priority" : ""}`}>
      <header><div><p className="connections-card-category">{item.verification_overdue ? "Verification overdue" : annualCheckIn ? "Annual check-in due" : "Resource review"}</p><h3>{item.name}</h3><code>{item.slug}</code></div><div className="connections-admin-card-heading-actions"><strong>{formatWorkflowStatus(item.publication_state)}</strong><button type="button" onClick={() => onEdit(item.id)}>Edit resource</button></div></header>
      <dl><div><dt>Review</dt><dd>{formatWorkflowStatus(item.review_status)}</dd></div><div><dt>Decision</dt><dd>{formatWorkflowStatus(item.decision_status)}</dd></div><div><dt>Last verified</dt><dd>{item.last_verified_on || "Never"}</dd></div><div><dt>Due</dt><dd>{item.verification_due_on || "Not scheduled"}</dd></div></dl>
      <div className="connections-admin-actions"><label>Review status<select value={reviewStatus} onChange={(event) => setReviewStatus(event.target.value)}>{RESOURCE_REVIEW_STATUSES.map((value) => <option key={value} value={value}>{formatWorkflowStatus(value)}</option>)}</select></label><button type="button" onClick={() => runAction(() => service.setResourceReviewStatus(item.id, reviewStatus), refresh)}>Update review</button></div>
      <details><summary>Inclusion and geographic review</summary><div className="connections-form-grid"><label>Requested visibility<select value={visibility} onChange={(event) => setVisibility(event.target.value)}><option value="public">Public</option><option value="limited">Limited</option><option value="private_referral">Private referral</option><option value="temporarily_hidden">Temporarily hidden</option></select></label><label>Geographic scope<select value={geographicScope} onChange={(event) => setGeographicScope(event.target.value)}><option value="core_county">Core county</option><option value="corridor">Corridor</option><option value="regional_exception">Regional exception</option><option value="statewide">Statewide</option><option value="national_online">National online</option></select></label>{geographicScope === "regional_exception" && <label className="is-wide">Exception reason<textarea value={geographicExceptionReason} onChange={(event) => setGeographicExceptionReason(event.target.value)} rows="3" /></label>}<label className="is-wide connections-priority-check"><input type="checkbox" checked={stableResourceConfirmed} onChange={(event) => setStableResourceConfirmed(event.target.checked)} /> Staff confirmed this is a stable resource rather than an individual dated event.</label></div><button type="button" onClick={() => runAction(() => service.updateResourceReviewControls(item.id, { requested_visibility: visibility, geographic_scope: geographicScope, geographic_exception_reason: geographicExceptionReason, stable_resource_confirmed: stableResourceConfirmed }), refresh)}>Save inclusion controls</button></details>
      <details><summary>Record organization visibility consent</summary><div className="connections-form-grid"><label>Visibility approved by contact<select value={consent.visibility} onChange={(event) => updateConsent("visibility", event.target.value)}><option value="public">Public</option><option value="limited">Limited</option><option value="private_referral">Private referral</option><option value="temporarily_hidden">Temporarily hidden</option></select></label><label>Consenting adult<input value={consent.consented_by_name} onChange={(event) => updateConsent("consented_by_name", event.target.value)} /></label><label>Contact role<input value={consent.contact_role} onChange={(event) => updateConsent("contact_role", event.target.value)} /></label><label>Method<select value={consent.consent_method} onChange={(event) => updateConsent("consent_method", event.target.value)}><option value="phone">Phone</option><option value="in_person">In person</option><option value="written">Written</option></select></label><label>Consent date and time<input type="datetime-local" value={consent.consented_at} onChange={(event) => updateConsent("consented_at", event.target.value)} /></label></div><button type="button" onClick={() => runAction(() => service.recordVisibilityConsent(item.id, consent), refresh)}>Record visibility consent</button></details>
      <details open={annualCheckIn || undefined}><summary>{annualCheckIn ? "Complete annual phone or in-person check-in" : "Record phone or in-person verification"}</summary><div className="connections-form-grid"><label>Date<input type="date" value={verification.verified_on} onChange={(event) => updateVerification("verified_on", event.target.value)} /></label><label>Method<select value={verification.method} onChange={(event) => updateVerification("method", event.target.value)}><option value="phone">Phone</option><option value="in_person">In person</option></select></label><label>Responsible contact<input value={verification.responsible_contact_name} onChange={(event) => updateVerification("responsible_contact_name", event.target.value)} /></label><label>Outcome<select value={verification.outcome} onChange={(event) => updateVerification("outcome", event.target.value)}><option value="verified">Verified</option><option value="changes_required">Changes required</option><option value="unconfirmed">Unconfirmed</option><option value="closed">Closed</option></select></label><label>Confirmed visibility<select value={verification.visibility_confirmed} onChange={(event) => updateVerification("visibility_confirmed", event.target.value)}><option value="public">Public</option><option value="limited">Limited</option><option value="private_referral">Private referral</option><option value="temporarily_hidden">Temporarily hidden</option></select></label><label className="is-wide">Notes<textarea value={verification.notes} onChange={(event) => updateVerification("notes", event.target.value)} rows="3" /></label></div><button type="button" onClick={() => runAction(() => service.recordVerification(item.id, verification), refresh)}>{annualCheckIn ? "Complete annual check-in" : "Record verification"}</button></details>
      <details><summary>History and internal follow-up</summary><label>Add internal note<textarea value={internalNote} onChange={(event) => setInternalNote(event.target.value)} rows="3" /></label><button type="button" onClick={() => runAction(async () => { await service.addInternalNote(item.id, internalNote); setInternalNote(""); }, refresh)}>Add internal note</button><div className="connections-history-columns"><section><h4>Verification history</h4>{verifications.length ? <ul>{verifications.map((entry) => <li key={entry.id}><strong>{entry.verified_on} · {formatWorkflowStatus(entry.outcome)}</strong><span>{formatWorkflowStatus(entry.method)} with {entry.responsible_contact_name}</span></li>)}</ul> : <p>No verification recorded.</p>}</section><section><h4>Internal notes</h4>{notes.length ? <ul>{notes.map((entry) => <li key={entry.id}><strong>{new Date(entry.created_at).toLocaleString()}</strong><span>{entry.body}</span></li>)}</ul> : <p>No internal notes.</p>}</section><section><h4>Material activity</h4>{activity.length ? <ul>{activity.slice(0, 12).map((entry) => <li key={entry.id}><strong>{formatWorkflowStatus(entry.event_type)}</strong><span>{new Date(entry.created_at).toLocaleString()}</span></li>)}</ul> : <p>No activity recorded.</p>}</section></div></details>
      {isAdmin && <details><summary>Administrator publication controls</summary><div className="connections-form-grid"><label>Approved visibility<select value={visibility} onChange={(event) => setVisibility(event.target.value)}><option value="public">Public</option><option value="limited">Limited</option><option value="private_referral">Private referral</option><option value="temporarily_hidden">Temporarily hidden</option></select></label><label>Reason for pause, decline or archive<input value={reason} onChange={(event) => setReason(event.target.value)} /></label></div><div className="connections-admin-button-row"><button type="button" onClick={() => runAction(() => service.administerResource("approve", item.id, visibility), refresh)}>Approve</button><button type="button" onClick={() => runAction(() => service.administerResource("publish", item.id), refresh)}>Publish</button><button type="button" onClick={() => runAction(() => service.administerResource("pause", item.id, reason), refresh)}>Pause</button><button type="button" onClick={() => runAction(() => service.administerResource("decline", item.id, reason), refresh)}>Decline</button><button type="button" onClick={() => runAction(() => service.administerResource("archive", item.id, reason), refresh)}>Archive</button></div></details>}
    </article>
  );
}

export default function ConnectionsAdmin({
  workflowService,
  onNavigate,
  publicEnabled = false,
  embedded = false,
  session: sharedSession = null,
  profile: sharedProfile = null,
}) {
  useConnectionsMetadata({ page: "admin", pathname: CONNECTIONS_ADMIN_PATH, enabled: !embedded });
  const [session, setSession] = useState(sharedSession);
  const [profile, setProfile] = useState(sharedProfile);
  const effectiveSession = embedded ? sharedSession : session;
  const effectiveProfile = embedded ? sharedProfile : profile;
  const [queues, setQueues] = useState(EMPTY_QUEUES);
  const [status, setStatus] = useState({ kind: "loading", message: "Checking staff access…" });
  const [tab, setTab] = useState("submissions");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorResource, setEditorResource] = useState(null);
  const annualCheckIns = useMemo(() => getAnnualCheckInResources(queues.resources), [queues.resources]);

  const refresh = useCallback(async () => {
    const nextQueues = await workflowService.listQueues();
    setQueues(nextQueues);
  }, [workflowService]);

  useEffect(() => {
    if (embedded) {
      return undefined;
    }
    let active = true;
    workflowService.getSession().then((nextSession) => {
      if (!active) return;
      setSession(nextSession);
      if (!nextSession) setStatus({ kind: "ready", message: "" });
    }).catch((error) => setStatus({ kind: "error", message: error.message }));
    const listener = workflowService.onAuthStateChange((nextSession) => {
      if (!active) return;
      setSession(nextSession);
      if (!nextSession) { setProfile(null); setStatus({ kind: "ready", message: "" }); }
    });
    return () => { active = false; listener?.data?.subscription?.unsubscribe?.(); };
  }, [workflowService, embedded, sharedSession, sharedProfile]);

  useEffect(() => {
    let active = true;
    if (!effectiveSession?.user?.id) return undefined;
    const profileRequest = embedded
      ? Promise.resolve(sharedProfile)
      : workflowService.getStaffProfile(effectiveSession.user.id);
    Promise.all([profileRequest, workflowService.listQueues()]).then(([nextProfile, nextQueues]) => {
      if (!active) return;
      if (!nextProfile) throw new Error("An active IL HRC team profile is required.");
      setProfile(nextProfile); setQueues(nextQueues); setStatus({ kind: "ready", message: "" });
    }).catch((error) => { if (active) setStatus({ kind: "error", message: error.message }); });
    return () => { active = false; };
  }, [effectiveSession, workflowService, refresh, embedded, sharedProfile]);

  async function signIn(event) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    setStatus({ kind: "loading", message: "Signing in…" });
    try { setSession(await workflowService.signIn(values.email, values.password)); }
    catch (error) { setStatus({ kind: "error", message: error.message }); }
  }

  async function runAction(action, after = () => {}) {
    setStatus({ kind: "loading", message: "Saving…" });
    try { await action(); await after(); setStatus({ kind: "success", message: "Connections workflow updated." }); }
    catch (error) { setStatus({ kind: "error", message: error.message }); }
  }

  function addResource() {
    setEditorResource(null);
    setEditorOpen(true);
  }

  async function editResource(id) {
    setStatus({ kind: "loading", message: "Loading resource…" });
    try {
      setEditorResource(await workflowService.getResourceEditor(id));
      setEditorOpen(true);
      setStatus({ kind: "ready", message: "" });
    } catch (error) {
      setStatus({ kind: "error", message: error.message });
    }
  }

  function saveResource(resource) {
    runAction(
      () => workflowService.saveResource(resource),
      async () => { await refresh(); setEditorOpen(false); setEditorResource(null); setTab("resources"); },
    );
  }

  if (!effectiveSession) return embedded ? null : <div className="connections-app"><ConnectionsHeader onNavigate={onNavigate} showDirectory={publicEnabled} showConnectionsLinks={publicEnabled} /><main id="main-content" className="connections-main connections-admin-login"><p className="connections-eyebrow">Authorized IL HRC staff</p><h1>Connections administration</h1><form onSubmit={signIn}><label>Email<input type="email" name="email" required /></label><label>Password<input type="password" name="password" required /></label>{status.message && <p role={status.kind === "error" ? "alert" : "status"}>{status.message}</p>}<button className="connections-submit-button" type="submit" disabled={status.kind === "loading"}>Sign in</button></form></main></div>;

  const ContentElement = embedded ? "section" : "main";

  return (
    <div className={embedded ? "connections-app connections-admin-embedded" : "connections-app connections-admin-app"}>{!embedded && <a className="connections-skip-link" href="#main-content">Skip to main content</a>}{!embedded && <ConnectionsHeader onNavigate={onNavigate} showDirectory={publicEnabled} showConnectionsLinks={publicEnabled} />}<ContentElement id={embedded ? undefined : "main-content"} className="connections-main connections-admin-page">
      <header className="connections-admin-header"><div><p className="connections-eyebrow">IL HRC staff workspace</p><h1>Connections</h1><p>Manage resource submissions, listings, referrals and annual check-ins.</p></div><div className="connections-admin-header-actions"><button type="button" onClick={addResource}>Add resource</button>{!embedded && <button type="button" onClick={() => workflowService.signOut()}>Sign out</button>}</div></header>
      {status.message && <div className={`connections-form-status is-${status.kind}`} role={status.kind === "error" ? "alert" : "status"}>{status.message}</div>}
      {editorOpen ? <ConnectionsResourceEditor resource={editorResource} onSave={saveResource} onCancel={() => { setEditorOpen(false); setEditorResource(null); }} /> : <>
      <nav className="connections-admin-tabs" aria-label="Connections queues">{[
        ["submissions", "Submissions", queues.submissions.length],
        ["corrections", "Corrections", queues.corrections.length],
        ["referrals", "Referrals", queues.referrals.length],
        ["resources", "Resources", queues.resources.length],
        ["checkins", "Annual check-ins", annualCheckIns.length],
      ].map(([value, label, count]) => <button type="button" key={value} aria-current={tab === value ? "page" : undefined} onClick={() => setTab(value)}>{label}<span>{count}</span></button>)}</nav>
      {tab === "submissions" && <QueueSection title="Resource submissions" count={queues.submissions.length}>{queues.submissions.length ? queues.submissions.map((item) => <SubmissionCard key={item.id} item={item} service={workflowService} refresh={refresh} runAction={runAction} />) : <QueueEmpty />}</QueueSection>}
      {tab === "corrections" && <QueueSection title="Correction and removal requests" count={queues.corrections.length}>{queues.corrections.length ? queues.corrections.map((item) => <CorrectionCard key={item.id} item={item} isAdmin={effectiveProfile?.role === "admin"} service={workflowService} refresh={refresh} runAction={runAction} />) : <QueueEmpty />}</QueueSection>}
      {tab === "referrals" && <QueueSection title="Private-referral requests" count={queues.referrals.length}>{queues.referrals.length ? queues.referrals.map((item) => <ReferralCard key={item.id} item={item} service={workflowService} refresh={refresh} runAction={runAction} />) : <QueueEmpty />}</QueueSection>}
      {tab === "resources" && <QueueSection title="Resource review and verification" count={queues.resources.length}>{queues.resources.length ? queues.resources.map((item) => <ResourceCard key={item.id} item={item} isAdmin={effectiveProfile?.role === "admin"} verifications={queues.verifications.filter((entry) => entry.resource_id === item.id)} notes={queues.notes.filter((entry) => entry.resource_id === item.id)} activity={queues.activity.filter((entry) => entry.resource_id === item.id)} service={workflowService} refresh={refresh} runAction={runAction} onEdit={editResource} />) : <QueueEmpty />}</QueueSection>}
      {tab === "checkins" && <QueueSection title="Annual check-ins due within 30 days" count={annualCheckIns.length}>{annualCheckIns.length ? annualCheckIns.map((item) => <ResourceCard key={item.id} item={item} isAdmin={effectiveProfile?.role === "admin"} verifications={queues.verifications.filter((entry) => entry.resource_id === item.id)} notes={queues.notes.filter((entry) => entry.resource_id === item.id)} activity={queues.activity.filter((entry) => entry.resource_id === item.id)} service={workflowService} refresh={refresh} runAction={runAction} onEdit={editResource} annualCheckIn />) : <QueueEmpty />}</QueueSection>}
      </>}
    </ContentElement></div>
  );
}
