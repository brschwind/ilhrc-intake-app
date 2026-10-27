import test from "node:test";
import assert from "node:assert/strict";
import { createCameraScanLatch } from "./cameraScanLatch.js";
test("camera does not shelve another copy while the same barcode stays in view", () => {
  const latch = createCameraScanLatch();
  assert.equal(latch.accept("SKU-1"), true);
  for (let i = 0; i < 20; i++) assert.equal(latch.accept("SKU-1"), false);
  latch.clear();
  assert.equal(latch.accept("SKU-1"), true);
  assert.equal(latch.accept("SKU-2"), true);
});
