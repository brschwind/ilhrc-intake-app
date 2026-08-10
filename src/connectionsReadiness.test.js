import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildConnectionsSitemap,
  getConnectionsMetadata,
} from "./connections/connectionsMetadata.js";

const robotsSource = await readFile(new URL("../public/robots.txt", import.meta.url), "utf8");
const indexSource = await readFile(new URL("../index.html", import.meta.url), "utf8");
const runbookSource = await readFile(new URL("../docs/connections-pilot-runbook.md", import.meta.url), "utf8");
const readinessSource = await readFile(new URL("../scripts/check-connections-readiness.mjs", import.meta.url), "utf8");

test("disabled and private Connections routes cannot be indexed", () => {
  const disabled = getConnectionsMetadata({
    page: "directory",
    pathname: "/connections",
    origin: "https://example.org",
    enabled: false,
  });
  assert.equal(disabled.robots, "noindex, nofollow, noarchive");
  assert.equal(disabled.structuredData, null);

  for (const page of ["submit", "correction", "referral", "admin", "invalid", "error"]) {
    const metadata = getConnectionsMetadata({ page, pathname: `/connections/${page}`, origin: "https://example.org" });
    assert.equal(metadata.robots, "noindex, nofollow, noarchive");
    assert.equal(metadata.structuredData, null);
  }
});

test("public directory and detail metadata are canonical and public-safe", () => {
  const directory = getConnectionsMetadata({
    page: "directory",
    pathname: "/connections",
    origin: "https://www.example.org/",
  });
  assert.equal(directory.canonical, "https://www.example.org/connections");
  assert.equal(directory.robots, "index, follow, max-image-preview:large");
  assert.equal(directory.structuredData["@type"], "CollectionPage");

  const detail = getConnectionsMetadata({
    page: "detail",
    pathname: "/connections/prairie-learning-collective",
    origin: "https://www.example.org",
    resource: {
      name: "Prairie Learning Collective",
      short_description: "A fictional verified resource.",
      service_area_summary: "Central Illinois",
      internal_notes: "must not enter metadata",
      contacts: [{ value: "private@example.test" }],
    },
  });
  const serialized = JSON.stringify(detail);
  assert.equal(detail.title, "Prairie Learning Collective | IL HRC Connections");
  assert.equal(detail.canonical, "https://www.example.org/connections/prairie-learning-collective");
  assert.equal(detail.structuredData["@type"], "Organization");
  assert.doesNotMatch(serialized, /internal_notes|private@example\.test/);
});

test("sitemap preparation accepts only an explicit HTTPS public origin", () => {
  const sitemap = buildConnectionsSitemap([
    { slug: "prairie-learning-collective" },
    { slug: "heartland-arts-workshop" },
  ], "https://www.example.org");
  assert.match(sitemap, /https:\/\/www\.example\.org\/connections<\/loc>/);
  assert.match(sitemap, /https:\/\/www\.example\.org\/connections\/prairie-learning-collective/);
  assert.doesNotMatch(sitemap, /admin|submit|referral|correction/);
  assert.throws(() => buildConnectionsSitemap([], "http://example.org"), /public HTTPS site origin/);
});

test("crawler and operational safeguards are documented and automated", () => {
  assert.match(robotsSource, /Disallow: \/connections\/admin/);
  assert.match(robotsSource, /Disallow: \/connections\/\*\/correction/);
  assert.match(indexSource, /<title>Illinois Homeschool Resource Center<\/title>/);
  assert.match(indexSource, /<meta name="description"/);
  assert.match(runbookSource, /explicit approval/i);
  assert.match(runbookSource, /VITE_CONNECTIONS_ENABLED=false/);
  assert.match(runbookSource, /24 hours/);
  assert.match(runbookSource, /at least 25 stable resources/i);
  assert.match(readinessSource, /Environment credential files must remain untracked/);
  assert.match(readinessSource, /service-role credential/);
});
