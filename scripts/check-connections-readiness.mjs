import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const failures = [];
const requireCondition = (condition, message) => {
  if (!condition) failures.push(message);
};
const read = (relativePath) => readFile(path.join(root, relativePath), "utf8");

const [configSource, routerSource, metadataSource, robotsSource, vercelSource, runbookSource] = await Promise.all([
  read("src/connections/connectionsConfig.js"),
  read("src/AppRouter.jsx"),
  read("src/connections/connectionsMetadata.js"),
  read("public/robots.txt"),
  read("vercel.json"),
  read("docs/connections-pilot-runbook.md"),
]);

requireCondition(/VITE_CONNECTIONS_ENABLED === "true"/.test(configSource), "Connections must remain opt-in through an exact true feature flag.");
requireCondition(/VITE_CONNECTIONS_STAFF_ENABLED === "true"/.test(configSource), "Connections staff access must remain opt-in through an exact true feature flag.");
requireCondition(/CONNECTIONS_ENABLED && !CONNECTIONS_FIXTURES_ENABLED/.test(routerSource), "Public production adapters must remain feature-gated.");
requireCondition(/CONNECTIONS_ENABLED \|\| CONNECTIONS_STAFF_ENABLED/.test(routerSource), "Staff workflow adapters must remain separately feature-gated.");
requireCondition(/noindex, nofollow, noarchive/.test(metadataSource), "Private and unavailable Connections routes need no-index metadata.");
requireCondition(/link\[rel="canonical"\]/.test(metadataSource), "Connections canonical metadata is missing.");
requireCondition(robotsSource.includes("Disallow: /connections/admin"), "robots.txt must block staff access routes.");
requireCondition(robotsSource.includes("Disallow: /connections/*/correction"), "robots.txt must block correction routes.");

const vercel = JSON.parse(vercelSource);
requireCondition(vercel.rewrites?.some(({ source, destination }) => source === "/connections/:path*" && destination === "/index.html"), "Vercel must preserve shareable Connections history routes.");
requireCondition(runbookSource.includes("VITE_CONNECTIONS_ENABLED=false"), "The pilot runbook must document a feature-flag rollback.");
requireCondition(runbookSource.includes("24 hours"), "The pilot runbook must document the privacy-response target.");

const trackedFiles = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" }).split(/\r?\n/).filter(Boolean);
const forbiddenTrackedEnvironmentFiles = trackedFiles.filter((file) => /(^|\/)(\.env|\.env\.local|server\/\.env)$/.test(file));
requireCondition(forbiddenTrackedEnvironmentFiles.length === 0, "Environment credential files must remain untracked.");

const sourceFiles = trackedFiles.filter((file) => file.startsWith("src/") && /\.(js|jsx)$/.test(file) && !file.endsWith(".test.js"));
for (const file of sourceFiles) {
  const source = await read(file);
  requireCondition(!/SUPABASE_SERVICE_ROLE|service[_-]?role/i.test(source), `Frontend source must not reference a service-role credential: ${file}`);
  requireCondition(!/https:\/\/[a-z0-9]+\.supabase\.co/i.test(source), `Frontend source must not contain a fixed Supabase project URL: ${file}`);
}

const migrationFiles = (await readdir(path.join(root, "supabase", "migrations"))).filter((file) => file.endsWith(".sql")).sort();
const foundationIndex = migrationFiles.indexOf("20260806160000_connections_foundation.sql");
const workflowsIndex = migrationFiles.indexOf("20260806190000_connections_workflows.sql");
const editorIndex = migrationFiles.indexOf("20260810211500_connections_staff_resource_editor.sql");
requireCondition(foundationIndex >= 0, "Connections foundation migration is missing.");
requireCondition(workflowsIndex > foundationIndex, "Connections workflow migration must follow the foundation migration.");
requireCondition(editorIndex > workflowsIndex, "Connections staff editor migration must follow the workflow migration.");

if (failures.length) {
  console.error("Connections readiness check failed:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("Connections readiness check passed: feature gating, metadata, routing, credentials, migrations and runbook safeguards are present.");
