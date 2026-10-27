import test from "node:test";
import assert from "node:assert/strict";
import { nativeBarcodeFormats, SCAN_CAMERA_CONSTRAINTS } from "./scanCameraPolicy.js";

test("native reader missing our printed SKU format falls back instead of silently failing", () => {
  assert.deepEqual(nativeBarcodeFormats(["ean_13", "qr_code"]), []);
});
test("native reader requests only supported formats and includes printed SKUs", () => {
  assert.deepEqual(nativeBarcodeFormats(["code_128", "ean_13", "qr_code", "pdf417"]), ["ean_13", "code_128", "qr_code"]);
});
test("camera requests a high-resolution rear stream without audio", () => {
  assert.equal(SCAN_CAMERA_CONSTRAINTS.video.facingMode.ideal, "environment");
  assert.equal(SCAN_CAMERA_CONSTRAINTS.video.width.ideal, 1920);
  assert.equal(SCAN_CAMERA_CONSTRAINTS.audio, false);
});
