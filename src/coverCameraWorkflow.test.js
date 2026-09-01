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

test("actual listing cover opens the camera without submitting or replacing form state", () => {
  const actualCoverButton = appSource.match(
    /<button\s+className="secondary"[\s\S]*?>\s*Add Actual Cover Photo to Listing\s*<\/button>/
  )?.[0];

  assert.ok(actualCoverButton, "actual cover button should be present");
  assert.match(actualCoverButton, /type="button"/);
  assert.match(actualCoverButton, /onClick=\{openListingCoverCamera\}/);
  assert.match(appSource, /function openListingCoverCamera\(event\)[\s\S]*?event\.preventDefault\(\)/);
  assert.match(appSource, /startCoverCamera\("listing"\)/);
  assert.match(appSource, /purpose === "listing"[\s\S]*?processListingPhoto\(cameraFile\)/);
});

test("actual cover falls back to a rear-camera file capture when in-app camera is unavailable", () => {
  assert.match(
    appSource,
    /if \(navigator\.mediaDevices\?\.getUserMedia\)[\s\S]*?listingPhotoInputRef\.current\?\.click\(\)/
  );

  const listingInput = appSource.match(
    /<input\s+id="listing-cover-upload"[\s\S]*?\/>/
  )?.[0];

  assert.ok(listingInput, "actual cover fallback input should be present");
  assert.match(listingInput, /type="file"/);
  assert.match(listingInput, /accept="image\/\*"/);
  assert.match(listingInput, /capture="environment"/);
});

test("cover analysis offers a native phone-camera fallback for Samsung browsers", () => {
  assert.match(appSource, />\s*Use Phone Camera Instead\s*<\/label>/);

  const cameraCaptureInput = appSource.match(
    /<input\s+id="cover-camera-capture"[\s\S]*?\/>/
  )?.[0];

  assert.ok(cameraCaptureInput, "native phone-camera input should be present");
  assert.match(cameraCaptureInput, /type="file"/);
  assert.match(cameraCaptureInput, /accept="image\/\*"/);
  assert.match(cameraCaptureInput, /capture="environment"/);
  assert.match(cameraCaptureInput, /onChange=\{handleCoverPhoto\}/);
  assert.match(appSource, /error\?\.name === "NotReadableError"/);
  assert.match(appSource, /error\?\.name === "AbortError"/);
});
