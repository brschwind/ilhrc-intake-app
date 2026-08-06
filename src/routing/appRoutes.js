export const APP_NAVIGATION_EVENT = "ilhrc:navigate";
export const CONNECTIONS_BASE_PATH = "/connections";

const CONNECTION_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const AUTH_URL_TYPES = new Set(["invite", "recovery"]);

function cleanPathname(pathname = "/") {
  const normalized = `/${String(pathname).replace(/^\/+|\/+$/g, "")}`;
  return normalized === "//" ? "/" : normalized;
}

export function getAuthUrlTypeFromLocation(locationLike = {}) {
  const searchParams = new URLSearchParams(locationLike.search || "");
  const hashParams = new URLSearchParams(String(locationLike.hash || "").replace(/^#/, ""));
  return searchParams.get("type") || hashParams.get("type") || "";
}

export function getLegacyPublicView(hash = "") {
  const value = String(hash).replace(/^#/, "");
  return value === "catalog" || value === "curricula" ? value : "";
}

export function matchConnectionsPath(pathname = "/") {
  const path = cleanPathname(pathname);
  if (path === CONNECTIONS_BASE_PATH) return { kind: "directory", pathname: path };
  if (!path.startsWith(`${CONNECTIONS_BASE_PATH}/`)) return { kind: "none", pathname: path };

  const encodedSlug = path.slice(CONNECTIONS_BASE_PATH.length + 1);
  let slug;
  try {
    slug = decodeURIComponent(encodedSlug);
  } catch {
    return { kind: "invalid", pathname: path };
  }

  if (!CONNECTION_SLUG_PATTERN.test(slug)) return { kind: "invalid", pathname: path };
  return { kind: "detail", pathname: path, slug };
}

export function resolveAppRoute(locationLike = {}, connectionsEnabled = false) {
  const authType = getAuthUrlTypeFromLocation(locationLike);
  if (AUTH_URL_TYPES.has(authType)) {
    return { kind: "bookstore", legacyView: getLegacyPublicView(locationLike.hash), authType };
  }

  const connectionsRoute = matchConnectionsPath(locationLike.pathname);
  if (connectionsRoute.kind === "none") {
    return {
      kind: "bookstore",
      legacyView: getLegacyPublicView(locationLike.hash),
      authType: "",
    };
  }

  if (!connectionsEnabled) return { kind: "connections-unavailable", pathname: connectionsRoute.pathname };
  return { kind: "connections", page: connectionsRoute.kind, pathname: connectionsRoute.pathname, slug: connectionsRoute.slug };
}

export function navigateToPath(path, { replace = false } = {}) {
  if (typeof window === "undefined") return;
  window.history[replace ? "replaceState" : "pushState"]({}, "", path);
  window.dispatchEvent(new Event(APP_NAVIGATION_EVENT));
}

export function navigateToLegacyView(view = "catalog") {
  const hash = view === "curricula" ? "#curricula" : "#catalog";
  navigateToPath(`/${hash}`);
}
