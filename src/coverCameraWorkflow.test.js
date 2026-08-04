import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const appSource = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");

test("cover analysis uses an in-app rear camera instead of an Android capture intent", () => {
  assert.match(appSource, /navigator\.mediaDevices\.getUserMedia/);
  assert.match(appSource, /facingMode:\s*\{\s*exact:\s*"environment"\s*\}/);
  assert.match(appSource, /facingMode:\s*\{\s*ideal:\s*"environment"\s*\}/);
  assert.match(appSource, /Take Cover Photo/);
  assert.match(appSource, /Choose Existing Photo/);

  const coverInput = appSource.match(
    /<input\s+id="cover-upload"[\s\S]*?\/>/
  )?.[0];

  assert.ok(coverInput, "cover upload input should remain available as a fallback");
  assert.doesNotMatch(coverInput, /capture="environment"/);
});

test("cover camera can switch between available cameras", () => {
  assert.match(appSource, /navigator\.mediaDevices\.enumerateDevices/);
  assert.match(appSource, /function switchCoverCamera\(\)/);
  assert.match(appSource, /deviceId:\s*\{\s*exact:\s*nextDevice\.deviceId\s*\}/);
  assert.match(appSource, />\s*Switch Camera\s*<\/button>/);
});

test("cover camera streams are stopped after capture, cancellation, or navigation", () => {
  assert.match(appSource, /function stopCoverCamera\(\)/);
  assert.match(appSource, /getTracks\(\)\.forEach\(\(track\) => track\.stop\(\)\)/);
  assert.match(appSource, /if \(view === "add"\) return/);
});
