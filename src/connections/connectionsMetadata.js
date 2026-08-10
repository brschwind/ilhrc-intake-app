import { useEffect } from "react";

export const CONNECTIONS_SITE_NAME = "IL HRC Connections";
export const CONNECTIONS_DIRECTORY_DESCRIPTION =
  "A personally verified guide to homeschool-friendly classes, groups, services and activities in Central Illinois.";

const NO_INDEX_ROBOTS = "noindex, nofollow, noarchive";
const PUBLIC_ROBOTS = "index, follow, max-image-preview:large";

function normalizeOrigin(origin = "") {
  return String(origin).replace(/\/+$/, "");
}

function canonicalUrl(pathname, origin = "") {
  const path = `/${String(pathname || "/").replace(/^\/+/, "")}`;
  const base = normalizeOrigin(origin);
  return base ? `${base}${path === "//" ? "/" : path}` : path;
}

function resourceStructuredData(resource, canonical) {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: resource.name,
    description: resource.short_description,
    url: canonical,
    areaServed: resource.service_area_summary || resource.primary_city || "Central Illinois",
  };
}

export function getConnectionsMetadata({ page, pathname, origin = "", resource = null, enabled = true } = {}) {
  const canonical = canonicalUrl(pathname, origin);
  if (!enabled) {
    return {
      title: "Connections unavailable | Illinois Homeschool Resource Center",
      description: "IL HRC Connections is not currently available.",
      canonical,
      robots: NO_INDEX_ROBOTS,
      structuredData: null,
    };
  }

  if (page === "directory") {
    return {
      title: "IL HRC Connections | Central Illinois Homeschool Resource Guide",
      description: CONNECTIONS_DIRECTORY_DESCRIPTION,
      canonical,
      robots: PUBLIC_ROBOTS,
      structuredData: {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        name: CONNECTIONS_SITE_NAME,
        description: CONNECTIONS_DIRECTORY_DESCRIPTION,
        url: canonical,
      },
    };
  }

  if (page === "detail" && resource) {
    const description = resource.short_description || `Learn about ${resource.name} in the IL HRC Connections directory.`;
    return {
      title: `${resource.name} | IL HRC Connections`,
      description,
      canonical,
      robots: PUBLIC_ROBOTS,
      structuredData: resourceStructuredData(resource, canonical),
    };
  }

  const privatePages = {
    submit: ["Suggest a resource", "Send a homeschool-friendly resource for IL HRC to research."],
    correction: ["Request a correction", "Request a correction or privacy-related removal from IL HRC Connections."],
    referral: ["Resource matching", "Request IL HRC help finding an appropriate homeschool resource."],
    admin: ["Connections administration", "Authorized IL HRC staff access."],
    error: ["Connections temporarily unavailable", "The IL HRC Connections directory is temporarily unavailable."],
    invalid: ["Resource not found", "This IL HRC Connections resource page is unavailable."],
  };
  const [label, description] = privatePages[page] || privatePages.invalid;
  return {
    title: `${label} | IL HRC Connections`,
    description,
    canonical,
    robots: NO_INDEX_ROBOTS,
    structuredData: null,
  };
}

function upsertMeta(documentLike, name, content) {
  let element = documentLike.head.querySelector(`meta[name="${name}"]`);
  if (!element) {
    element = documentLike.createElement("meta");
    element.setAttribute("name", name);
    documentLike.head.append(element);
  }
  element.setAttribute("content", content);
}

function upsertCanonical(documentLike, href) {
  let element = documentLike.head.querySelector('link[rel="canonical"]');
  if (!element) {
    element = documentLike.createElement("link");
    element.setAttribute("rel", "canonical");
    documentLike.head.append(element);
  }
  element.setAttribute("href", href);
}

export function applyConnectionsMetadata(documentLike, metadata) {
  if (!documentLike?.head || !metadata) return;
  documentLike.title = metadata.title;
  upsertMeta(documentLike, "description", metadata.description);
  upsertMeta(documentLike, "robots", metadata.robots);
  upsertCanonical(documentLike, metadata.canonical);

  documentLike.head.querySelectorAll('script[data-connections-structured-data="true"]').forEach((element) => element.remove());
  if (metadata.structuredData) {
    const script = documentLike.createElement("script");
    script.type = "application/ld+json";
    script.dataset.connectionsStructuredData = "true";
    script.textContent = JSON.stringify(metadata.structuredData).replace(/</g, "\\u003c");
    documentLike.head.append(script);
  }
}

export function useConnectionsMetadata(options) {
  const page = options?.page;
  const pathname = options?.pathname;
  const resource = options?.resource;
  const enabled = options?.enabled;

  useEffect(() => {
    if (typeof document === "undefined" || typeof window === "undefined") return;
    const previous = {
      title: document.title,
      description: document.head.querySelector('meta[name="description"]')?.getAttribute("content") ?? null,
      robots: document.head.querySelector('meta[name="robots"]')?.getAttribute("content") ?? null,
      canonical: document.head.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? null,
    };
    applyConnectionsMetadata(document, getConnectionsMetadata({
      page,
      pathname,
      resource,
      enabled,
      origin: window.location.origin,
    }));
    return () => {
      document.title = previous.title;
      const descriptionElement = document.head.querySelector('meta[name="description"]');
      if (previous.description === null) descriptionElement?.remove();
      else descriptionElement?.setAttribute("content", previous.description);
      const robotsElement = document.head.querySelector('meta[name="robots"]');
      if (previous.robots === null) robotsElement?.remove();
      else robotsElement?.setAttribute("content", previous.robots);
      const canonicalElement = document.head.querySelector('link[rel="canonical"]');
      if (previous.canonical === null) canonicalElement?.remove();
      else canonicalElement?.setAttribute("href", previous.canonical);
      document.head.querySelectorAll('script[data-connections-structured-data="true"]').forEach((element) => element.remove());
    };
  }, [enabled, page, pathname, resource]);
}

export function buildConnectionsSitemap(resources = [], siteOrigin = "") {
  const origin = normalizeOrigin(siteOrigin);
  if (!/^https:\/\//.test(origin)) throw new Error("A public HTTPS site origin is required.");
  const urls = ["/connections", ...resources.map((resource) => `/connections/${resource.slug}`)];
  const escaped = (value) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.map((path) => `  <url><loc>${escaped(`${origin}${path}`)}</loc></url>`),
    "</urlset>",
    "",
  ].join("\n");
}
