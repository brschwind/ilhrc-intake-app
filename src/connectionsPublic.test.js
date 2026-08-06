import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { isConnectionsFeatureEnabled } from "./connections/connectionsConfig.js";
import {
  CONNECTIONS_DISCLOSURES,
  PUBLIC_CONTACT_FIELDS,
  PUBLIC_LOCATION_FIELDS,
  PUBLIC_RESOURCE_FIELDS,
  filterConnections,
  findConnectionBySlug,
  toPublicConnectionResource,
  validatePublicConnectionResource,
} from "./connections/connectionsModel.js";
import { createConnectionsService } from "./connections/connectionsService.js";
import { connectionFixtures } from "./connections/connectionsFixtures.js";
import {
  getAuthUrlTypeFromLocation,
  getLegacyPublicView,
  matchConnectionsPath,
  resolveAppRoute,
} from "./routing/appRoutes.js";

const componentSource = await readFile(new URL("./connections/ConnectionsPublic.jsx", import.meta.url), "utf8");
const styleSource = await readFile(new URL("./connections/ConnectionsPublic.css", import.meta.url), "utf8");
const routerSource = await readFile(new URL("./AppRouter.jsx", import.meta.url), "utf8");
const appSource = await readFile(new URL("./App.jsx", import.meta.url), "utf8");
const serviceSource = await readFile(new URL("./connections/connectionsService.js", import.meta.url), "utf8");
const vercelConfig = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));

test("Connections feature flag is disabled unless explicitly enabled", () => {
  assert.equal(isConnectionsFeatureEnabled({}), false);
  assert.equal(isConnectionsFeatureEnabled({ PROD: true }), false);
  assert.equal(isConnectionsFeatureEnabled({ VITE_CONNECTIONS_ENABLED: "false" }), false);
  assert.equal(isConnectionsFeatureEnabled({ VITE_CONNECTIONS_ENABLED: "TRUE" }), false);
  assert.equal(isConnectionsFeatureEnabled({ VITE_CONNECTIONS_ENABLED: "true" }), true);
  assert.match(appSource, /CONNECTIONS_ENABLED\s*&&/);
  assert.match(componentSource, /<ConnectionsHeader onNavigate=\{onNavigate\} showDirectory=\{false\}/);
});

test("disabled Connections routes do not load a data service", async () => {
  let loaderCalls = 0;
  const service = createConnectionsService({
    enabled: false,
    fixturesEnabled: true,
    fixtureLoader: async () => {
      loaderCalls += 1;
      return { connectionFixtures };
    },
  });
  assert.deepEqual(await service.listResources(), []);
  assert.equal(loaderCalls, 0);
  assert.equal(resolveAppRoute({ pathname: "/connections", search: "", hash: "" }, false).kind, "connections-unavailable");
  assert.match(routerSource, /route\.kind === "connections-unavailable"[\s\S]*<ConnectionsUnavailable/);
  assert.doesNotMatch(serviceSource, /supabase|\.from\s*\(/i);
});

test("browser-history Connections routes preserve legacy hash and auth behavior", () => {
  assert.deepEqual(matchConnectionsPath("/connections"), { kind: "directory", pathname: "/connections" });
  assert.deepEqual(matchConnectionsPath("/connections/prairie-learning-collective"), {
    kind: "detail",
    pathname: "/connections/prairie-learning-collective",
    slug: "prairie-learning-collective",
  });
  assert.equal(matchConnectionsPath("/connections/not/one-slug").kind, "invalid");
  assert.equal(matchConnectionsPath("/catalog").kind, "none");

  assert.equal(getLegacyPublicView("#catalog"), "catalog");
  assert.equal(getLegacyPublicView("#curricula"), "curricula");
  assert.equal(getLegacyPublicView("#type=recovery&access_token=secret"), "");
  assert.equal(getAuthUrlTypeFromLocation({ search: "?type=invite", hash: "" }), "invite");
  assert.equal(getAuthUrlTypeFromLocation({ search: "", hash: "#type=recovery&access_token=secret" }), "recovery");

  assert.deepEqual(resolveAppRoute({ pathname: "/", search: "", hash: "#catalog" }, true), {
    kind: "bookstore",
    legacyView: "catalog",
    authType: "",
  });
  assert.deepEqual(resolveAppRoute({ pathname: "/connections", search: "", hash: "" }, true), {
    kind: "connections",
    page: "directory",
    pathname: "/connections",
    slug: undefined,
  });
  assert.equal(resolveAppRoute({ pathname: "/connections", search: "?type=invite", hash: "" }, true).kind, "bookstore");
  assert.equal(resolveAppRoute({ pathname: "/connections", search: "", hash: "#type=recovery" }, true).kind, "bookstore");
  assert.ok(vercelConfig.rewrites.some((rewrite) => rewrite.source === "/connections" && rewrite.destination === "/index.html"));
  assert.ok(vercelConfig.rewrites.some((rewrite) => rewrite.source === "/connections/:path*" && rewrite.destination === "/index.html"));
});

test("directory search and restrained filters combine predictably", () => {
  assert.equal(filterConnections(connectionFixtures, { keyword: "ceramics" }).length, 1);
  assert.equal(filterConnections(connectionFixtures, { category: "arts-music-enrichment" })[0].slug, "heartland-arts-workshop");
  assert.equal(filterConnections(connectionFixtures, { location: "McLean" })[0].slug, "heartland-arts-workshop");
  assert.equal(filterConnections(connectionFixtures, { delivery: "traveling" })[0].slug, "central-illinois-family-support");
  assert.equal(filterConnections(connectionFixtures, { keyword: "daytime", location: "Peoria" })[0].slug, "prairie-learning-collective");
  assert.equal(filterConnections(connectionFixtures, { keyword: "not present" }).length, 0);
});

test("resource detail lookup supports shareable slugs and invalid slugs", () => {
  assert.equal(findConnectionBySlug(connectionFixtures, "prairie-learning-collective")?.name, "Prairie Learning Collective");
  assert.equal(findConnectionBySlug(connectionFixtures, "missing-resource"), null);
  assert.equal(matchConnectionsPath("/connections/UPPERCASE").kind, "invalid");
  assert.equal(matchConnectionsPath("/connections/%2Fprivate").kind, "invalid");
  assert.match(componentSource, /Resource not found/);
  assert.match(componentSource, /document\.title = `\$\{resource\.name\} \| IL HRC Connections`/);
});

test("approved public disclosures are presented verbatim", () => {
  assert.equal(
    CONNECTIONS_DISCLOSURES.verification,
    "Every resource listed in IL HRC Connections has been personally contacted by an IL HRC team member, reviewed for consistency with our inclusion standards and confirmed within the past year.",
  );
  assert.equal(
    CONNECTIONS_DISCLOSURES.disclaimer,
    "Inclusion indicates that IL HRC believes the resource may be valuable to homeschool families. It does not guarantee every experience, verify every claim or indicate agreement with every belief, policy or practice of the listed organization. Families remain responsible for determining whether a resource is appropriate for them.",
  );
  assert.equal(
    CONNECTIONS_DISCLOSURES.worldview,
    "Religious-affiliation information is provided by the organization and is not independently verified by IL HRC.",
  );
  assert.match(componentSource, /CONNECTIONS_DISCLOSURES\.verification/);
  assert.match(componentSource, /CONNECTIONS_DISCLOSURES\.disclaimer/);
  assert.match(componentSource, /CONNECTIONS_DISCLOSURES\.worldview/);
});

test("fixtures are validated and only public-safe service fields are consumed", async () => {
  assert.ok(connectionFixtures.length > 0);
  connectionFixtures.forEach((fixture) => assert.deepEqual(validatePublicConnectionResource(fixture), fixture));

  const unsafeSource = {
    ...connectionFixtures[0],
    internal_notes: "must never leave staff systems",
    submitted_by_email: "private@example.test",
    locations: [{ ...connectionFixtures[0].locations[0], address_consent_status: "denied", private_instructions: "private" }],
    contacts: [{ ...connectionFixtures[0].contacts[0], is_personal: true, consent_status: "denied" }],
  };
  const safe = toPublicConnectionResource(unsafeSource);

  assert.deepEqual(Object.keys(safe).sort(), PUBLIC_RESOURCE_FIELDS.filter((field) => safe[field] !== undefined).sort());
  assert.ok(Object.keys(safe.locations[0]).every((field) => PUBLIC_LOCATION_FIELDS.includes(field)));
  assert.ok(Object.keys(safe.contacts[0]).every((field) => PUBLIC_CONTACT_FIELDS.includes(field)));
  assert.equal("internal_notes" in safe, false);
  assert.equal("submitted_by_email" in safe, false);
  assert.equal("private_instructions" in safe.locations[0], false);
  assert.equal("is_personal" in safe.contacts[0], false);
  assert.equal("consent_status" in safe.contacts[0], false);

  const service = createConnectionsService({
    enabled: true,
    fixturesEnabled: true,
    fixtureLoader: async () => ({ connectionFixtures: [unsafeSource] }),
  });
  const loaded = await service.listResources();
  assert.equal("internal_notes" in loaded[0], false);
});

test("public Connections markup supports mobile and keyboard access", () => {
  assert.match(componentSource, /href="#main-content">Skip to main content/);
  assert.match(componentSource, /<main id="main-content"/);
  assert.match(componentSource, /role="search"/);
  assert.match(componentSource, /htmlFor="connections-keyword"/);
  assert.match(componentSource, /aria-live="polite"/);
  assert.match(componentSource, /<a[^>]+href=/);
  assert.doesNotMatch(componentSource, /onKeyDown=/);
  assert.match(styleSource, /:focus-visible/);
  assert.match(styleSource, /@media \(max-width: 620px\)/);
  assert.match(styleSource, /grid-template-columns:\s*1fr/);
  assert.match(styleSource, /@media \(prefers-reduced-motion: reduce\)/);
});
