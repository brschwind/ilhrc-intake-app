import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const workspaceUrl = new URL("./LocationInventoryWorkspace.jsx", import.meta.url);
const appUrl = new URL("./App.jsx", import.meta.url);

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

test("the everyday location workflow defaults to shelving and demotes inventory-increasing shortcuts", async () => {
  const source = await readFile(workspaceUrl, "utf8");
  assert.match(source, /useState\("shelving"\)/);
  assert.match(source, /Quick Receive Existing Books/);
  assert.match(source, /Do not use both workflows for the same copy/i);
  assert.match(source, /Add a previously unrecorded copy here/);
  assert.match(source, /This adds a copy at the selected shelf instead of moving one from Processing/i);
});

test("standard intake explains Processing and the shelving handoff", async () => {
  const source = await readFile(appUrl, "utf8");
  assert.match(source, /Saving automatically records every copy in Processing/i);
  assert.match(source, /use Shelve Books to record the shelf/i);
  assert.match(source, /intakeCompletionMessage/);
});
