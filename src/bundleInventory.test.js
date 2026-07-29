import test from "node:test";
import assert from "node:assert/strict";
import {
  buildBundleContentsNote,
  getBundleComponentRows,
  getBundleIndividualValue,
  getBundlePieceCount,
} from "./bundleInventory.js";

const components = [
  { id: 11, title: "Teacher Guide", sku: "ILHRC-000011", final_price: 12, quantity: 1 },
  { id: 12, title: "Student Book", sku: "ILHRC-000012", final_price: 8.5, quantity: 2 },
];

test("bundle totals count physical pieces and individual value", () => {
  assert.equal(getBundlePieceCount(components), 3);
  assert.equal(getBundleIndividualValue(components), 29);
});

test("bundle contents note preserves titles, quantities, and SKUs", () => {
  assert.equal(
    buildBundleContentsNote(components),
    "1× Teacher Guide (ILHRC-000011)\n2× Student Book (ILHRC-000012)"
  );
});

test("bundle component rows use text ids and physical quantities", () => {
  assert.deepEqual(getBundleComponentRows("bundle-1", components), [
    { bundle_item_id: "bundle-1", component_item_id: "11", piece_quantity: 1 },
    { bundle_item_id: "bundle-1", component_item_id: "12", piece_quantity: 2 },
  ]);
});
