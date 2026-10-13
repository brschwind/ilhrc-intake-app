import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const workspaceUrl = new URL("./LocationInventoryWorkspace.jsx", import.meta.url);

test("empty shelf audits can be reviewed and reconciled", async () => {
  const source = await readFile(workspaceUrl, "utf8");
  assert.match(source, /auditReviewed\s*&&/);
  assert.match(source, /verify the shelf as empty/i);
  assert.match(source, /onClick=\{reconcileAudit\}/);
});

test("session count is independent from the bounded recent-scan list", async () => {
  const source = await readFile(workspaceUrl, "utf8");
  assert.match(source, /setRecent\(\(current\).*\.slice\(0, 12\)/s);
  assert.match(source, /\{scanCount\} scans this session/);
  assert.doesNotMatch(source, /\{recent\.length\} scans this session/);
  assert.match(source, /Recently scanned/);
});
