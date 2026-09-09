import test from "node:test";
import assert from "node:assert/strict";
import {
  accumulateObservedCount,
  buildAuditDiscrepancies,
  chooseShelvingRecommendation,
  classifyScan,
  totalLocationQuantity,
} from "./locationInventory.js";

test("location labels are distinct from book scans", () => {
  assert.deepEqual(classifyScan(" location:a3 "), { kind: "location", raw: "location:a3", code: "A3" });
  assert.deepEqual(classifyScan("9781608260102"), { kind: "item", raw: "9781608260102" });
});

test("multiple locations calculate one total", () => {
  assert.equal(totalLocationQuantity([{ item_id: 1, quantity: 3 }, { item_id: 1, quantity: 2 }], 1), 5);
});

test("duplicate audit scans accumulate physical copies", () => {
  let counts = {};
  for (let index = 0; index < 4; index += 1) counts = accumulateObservedCount(counts, "sku-1");
  assert.equal(counts["sku-1"], 4);
});

test("audit discrepancies include missing expected stock without touching other shelves", () => {
  const rows = buildAuditDiscrepancies([{ item_id: "x", quantity: 2 }], {});
  assert.deepEqual(rows, [{ itemId: "x", expectedQuantity: 2, observedQuantity: 0, difference: -2 }]);
});

test("exact SKU recommendation outranks curriculum and fallback", () => {
  const result = chooseShelvingRecommendation({
    exact: [{ code: "C1" }],
    curriculum: [{ code: "F2" }],
    fallback: [{ code: "A1" }],
  });
  assert.equal(result.code, "C1");
});

test("curriculum recommendation is used when the SKU has no shelf", () => {
  const result = chooseShelvingRecommendation({ exact: [], curriculum: [{ code: "F2" }] });
  assert.equal(result.code, "F2");
});
