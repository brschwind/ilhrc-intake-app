import { useEffect, useMemo, useState } from "react";
import {
  CONNECTIONS_DISCLOSURES,
  connectionCategoryOptions,
  connectionLocationOptions,
  filterConnections,
  findConnectionBySlug,
  formatConnectionValue,
} from "./connectionsModel.js";
import {
  CONNECTIONS_ADMIN_PATH,
  CONNECTIONS_BASE_PATH,
  CONNECTIONS_REFERRAL_PATH,
  CONNECTIONS_SUBMIT_PATH,
} from "../routing/appRoutes.js";
import { useConnectionsMetadata } from "./connectionsMetadata.js";
import "./ConnectionsPublic.css";

export function ConnectionsHeader({ onNavigate, showDirectory = true, showConnectionsLinks = true }) {
  return (
    <header className="connections-site-header">
      <a className="connections-brand" href="/#catalog" onClick={(event) => onNavigate(event, "/#catalog")}>
        <img src="/ilhrc-logo.png" alt="" aria-hidden="true" />
        <span>Illinois Homeschool Resource Center</span>
      </a>
      <div className="connections-header-actions">
        <nav aria-label="Public pages">
          {showConnectionsLinks && showDirectory && <a href={CONNECTIONS_BASE_PATH} onClick={(event) => onNavigate(event, CONNECTIONS_BASE_PATH)}>Directory</a>}
          {showConnectionsLinks && <a href={CONNECTIONS_SUBMIT_PATH} onClick={(event) => onNavigate(event, CONNECTIONS_SUBMIT_PATH)}>Suggest a resource</a>}
          {showConnectionsLinks && <a href={CONNECTIONS_REFERRAL_PATH} onClick={(event) => onNavigate(event, CONNECTIONS_REFERRAL_PATH)}>Resource matching</a>}
          <a href="/#catalog" onClick={(event) => onNavigate(event, "/#catalog")}>Bookstore</a>
        </nav>
        {showConnectionsLinks && <a className="connections-staff-access" href={CONNECTIONS_ADMIN_PATH} onClick={(event) => onNavigate(event, CONNECTIONS_ADMIN_PATH)}>Staff access</a>}
      </div>
    </header>
  );
}

function DisclosurePanel() {
  return (
    <aside className="connections-disclosures" aria-label="About Connections listings">
      <p><strong>Personally verified:</strong> {CONNECTIONS_DISCLOSURES.verification}</p>
      <p>{CONNECTIONS_DISCLOSURES.disclaimer}</p>
    </aside>
  );
}

function ConnectionsNotFound({ onNavigate }) {
  return (
    <main id="main-content" className="connections-status-page">
      <p className="connections-eyebrow">IL HRC Connections</p>
      <h1>Resource not found</h1>
      <p>This resource page is unavailable or its address may have changed.</p>
      <a className="connections-primary-link" href={CONNECTIONS_BASE_PATH} onClick={(event) => onNavigate(event, CONNECTIONS_BASE_PATH)}>
        Browse the Connections directory
      </a>
    </main>
  );
}

export function ConnectionsUnavailable({ onNavigate }) {
  useConnectionsMetadata({ page: "invalid", pathname: CONNECTIONS_BASE_PATH, enabled: false });
  return (
    <div className="connections-app">
      <ConnectionsHeader onNavigate={onNavigate} showDirectory={false} showConnectionsLinks={false} />
      <main id="main-content" className="connections-status-page">
        <p className="connections-eyebrow">IL HRC Connections</p>
        <h1>This resource guide is not available yet</h1>
        <p>Connections is being prepared for a future public pilot. Please visit the IL HRC bookstore in the meantime.</p>
        <a className="connections-primary-link" href="/#catalog" onClick={(event) => onNavigate(event, "/#catalog")}>Visit the bookstore</a>
      </main>
    </div>
  );
}

function ConnectionsDirectory({ resources, onNavigate }) {
  const [filters, setFilters] = useState({ keyword: "", category: "", location: "", delivery: "" });
  const results = useMemo(() => filterConnections(resources, filters), [resources, filters]);
  const categories = useMemo(() => connectionCategoryOptions(resources), [resources]);
  const locations = useMemo(() => connectionLocationOptions(resources), [resources]);

  function updateFilter(name, value) {
    setFilters((current) => ({ ...current, [name]: value }));
  }

  return (
    <main id="main-content" className="connections-main">
      <section className="connections-hero" aria-labelledby="connections-title">
        <p className="connections-eyebrow">A curated guide from IL HRC</p>
        <h1 id="connections-title">IL HRC Connections</h1>
        <p className="connections-subtitle">The Central Illinois Homeschool Resource Guide</p>
        <p>Find personally contacted classes, groups, services and activities selected for homeschool families.</p>
      </section>

      <DisclosurePanel />

      <aside className="connections-contribute" aria-labelledby="connections-contribute-heading">
        <div><h2 id="connections-contribute-heading">Know a helpful local resource?</h2><p>Representatives and families can send a resource for IL HRC to research. Submissions never publish automatically.</p></div>
        <a className="connections-primary-link" href={CONNECTIONS_SUBMIT_PATH} onClick={(event) => onNavigate(event, CONNECTIONS_SUBMIT_PATH)}>Suggest a resource</a>
      </aside>

      <form className="connections-filters" role="search" onSubmit={(event) => event.preventDefault()}>
        <div className="connections-search-field">
          <label htmlFor="connections-keyword">Search resources</label>
          <input
            id="connections-keyword"
            type="search"
            value={filters.keyword}
            placeholder="Name, program or keyword"
            onChange={(event) => updateFilter("keyword", event.target.value)}
          />
        </div>
        <label>
          Category
          <select value={filters.category} onChange={(event) => updateFilter("category", event.target.value)}>
            <option value="">All categories</option>
            {categories.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label>
          Town or county
          <select value={filters.location} onChange={(event) => updateFilter("location", event.target.value)}>
            <option value="">All locations</option>
            {locations.map((location) => <option key={location} value={location}>{location}</option>)}
          </select>
        </label>
        <label>
          Format
          <select value={filters.delivery} onChange={(event) => updateFilter("delivery", event.target.value)}>
            <option value="">All formats</option>
            <option value="in_person">In person</option>
            <option value="online">Online</option>
            <option value="hybrid">Hybrid</option>
            <option value="traveling">Traveling</option>
          </select>
        </label>
        <button className="connections-clear" type="button" onClick={() => setFilters({ keyword: "", category: "", location: "", delivery: "" })}>
          Clear filters
        </button>
      </form>

      <section className="connections-results" aria-labelledby="connections-results-heading" aria-live="polite">
        <div className="connections-results-heading">
          <h2 id="connections-results-heading">Resources</h2>
          <span>{results.length} {results.length === 1 ? "listing" : "listings"}</span>
        </div>
        {results.length === 0 ? (
          <div className="connections-empty"><h3>No matching resources</h3><p>Try clearing a filter or using a broader search.</p></div>
        ) : (
          <div className="connections-grid">
            {results.map((resource) => {
              const path = `${CONNECTIONS_BASE_PATH}/${resource.slug}`;
              return (
                <article className="connections-card" key={resource.slug}>
                  <p className="connections-card-category">{resource.primary_category_name}</p>
                  <h3><a href={path} onClick={(event) => onNavigate(event, path)}>{resource.name}</a></h3>
                  <p>{resource.short_description}</p>
                  <dl className="connections-card-facts">
                    <div><dt>Location</dt><dd>{resource.primary_city || resource.service_area_summary}{resource.primary_county ? ` · ${resource.primary_county} County` : ""}</dd></div>
                    <div><dt>Format</dt><dd>{formatConnectionValue(resource.delivery_mode)}</dd></div>
                    <div><dt>Availability</dt><dd>{formatConnectionValue(resource.accepting_status)}</dd></div>
                  </dl>
                  <a className="connections-card-link" href={path} onClick={(event) => onNavigate(event, path)}>View resource <span aria-hidden="true">→</span></a>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}

function contactHref(contact) {
  if (contact.kind === "website" && /^https:\/\//i.test(contact.value)) return contact.value;
  if (contact.kind === "email") return `mailto:${contact.value}`;
  if (contact.kind === "phone") return `tel:${contact.value.replace(/[^+\d]/g, "")}`;
  return "";
}

function ConnectionsDetail({ resource, onNavigate }) {
  return (
    <main id="main-content" className="connections-main connections-detail">
      <a className="connections-back-link" href={CONNECTIONS_BASE_PATH} onClick={(event) => onNavigate(event, CONNECTIONS_BASE_PATH)}>← Back to all resources</a>
      <article>
        <header className="connections-detail-header">
          <p className="connections-eyebrow">{resource.primary_category_name}</p>
          <h1>{resource.name}</h1>
          <p className="connections-detail-summary">{resource.short_description}</p>
          <p className="connections-verified-date">Last personally verified <time dateTime={resource.last_verified_on}>{resource.last_verified_on}</time></p>
        </header>

        <div className="connections-detail-layout">
          <div>
            <section aria-labelledby="connections-about-heading"><h2 id="connections-about-heading">About this resource</h2><p>{resource.description}</p></section>
            {resource.locations.length > 0 && (
              <section aria-labelledby="connections-location-heading">
                <h2 id="connections-location-heading">Locations and service area</h2>
                {resource.locations.map((location) => (
                  <div className="connections-location" key={`${location.name}-${location.sort_order}`}>
                    <h3>{location.name || location.city || "Service area"}</h3>
                    <p>{[location.address_line_1, location.address_line_2, location.city, location.state, location.postal_code].filter(Boolean).join(", ")}</p>
                    {location.county && <p>{location.county} County</p>}
                    {location.service_area && <p>{location.service_area}</p>}
                  </div>
                ))}
              </section>
            )}
            {resource.contacts.length > 0 && (
              <section aria-labelledby="connections-contact-heading"><h2 id="connections-contact-heading">Approved contact information</h2><ul className="connections-contact-list">
                {resource.contacts.map((contact) => {
                  const href = contactHref(contact);
                  return <li key={`${contact.kind}-${contact.value}`}>{href ? <a href={href}>{contact.label || formatConnectionValue(contact.kind)}</a> : <span>{contact.label}: {contact.value}</span>}</li>;
                })}
              </ul></section>
            )}
          </div>

          <aside className="connections-fact-panel" aria-label="Resource details">
            <h2>At a glance</h2>
            <dl>
              <div><dt>Format</dt><dd>{formatConnectionValue(resource.delivery_mode)}</dd></div>
              <div><dt>Availability</dt><dd>{formatConnectionValue(resource.accepting_status)}</dd></div>
              <div><dt>Cost</dt><dd>{formatConnectionValue(resource.cost_type)}</dd></div>
              <div><dt>Homeschool-specific</dt><dd>{resource.homeschool_specific ? "Yes" : "No"}</dd></div>
              <div><dt>Daytime options</dt><dd>{resource.daytime_available ? "Yes" : "Not listed"}</dd></div>
              <div><dt>Religious affiliation</dt><dd>{resource.worldview_details || formatConnectionValue(resource.worldview)}</dd></div>
            </dl>
            <p className="connections-worldview-note">{CONNECTIONS_DISCLOSURES.worldview}</p>
            <a className="connections-secondary-link" href={`${CONNECTIONS_BASE_PATH}/${resource.slug}/correction`} onClick={(event) => onNavigate(event, `${CONNECTIONS_BASE_PATH}/${resource.slug}/correction`)}>Request a correction or removal</a>
          </aside>
        </div>
      </article>
      <DisclosurePanel />
    </main>
  );
}

export default function ConnectionsPublic({ route, service, onNavigate }) {
  const [resources, setResources] = useState([]);
  const [status, setStatus] = useState("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (route.page === "invalid") {
      return undefined;
    }
    let active = true;
    service.listResources().then((nextResources) => {
      if (!active) return;
      setResources(nextResources);
      setStatus("ready");
    }).catch(() => {
      if (!active) return;
      setMessage("The Connections directory could not be loaded. Please try again later.");
      setStatus("error");
    });
    return () => { active = false; };
  }, [route.page, service]);

  const resource = status === "ready" && route.page === "detail"
    ? findConnectionBySlug(resources, route.slug)
    : null;
  const metadataPage = status === "error"
    ? "error"
    : route.page === "detail" && !resource
      ? "invalid"
      : route.page;
  useConnectionsMetadata({
    page: metadataPage,
    pathname: route.pathname,
    resource,
    enabled: true,
  });

  let content;
  if (route.page === "invalid") content = <ConnectionsNotFound onNavigate={onNavigate} />;
  else if (status === "loading") content = <main id="main-content" className="connections-status-page" aria-live="polite"><p>Loading Connections…</p></main>;
  else if (status === "error") content = <main id="main-content" className="connections-status-page" role="alert"><h1>Connections is temporarily unavailable</h1><p>{message}</p></main>;
  else if (route.page === "detail") {
    content = resource ? <ConnectionsDetail resource={resource} onNavigate={onNavigate} /> : <ConnectionsNotFound onNavigate={onNavigate} />;
  } else content = <ConnectionsDirectory resources={resources} onNavigate={onNavigate} />;

  return <div className="connections-app"><a className="connections-skip-link" href="#main-content">Skip to main content</a><ConnectionsHeader onNavigate={onNavigate} />{content}</div>;
}
