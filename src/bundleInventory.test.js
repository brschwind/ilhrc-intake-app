import test from "node:test";
import assert from "node:assert/strict";
import {
  buildBundleContentsNote,
  getBundleComponentQuantity,
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

test("retroactive bundles can reserve fewer copies than an inventory listing holds", () => {
  const retroComponents = [
    { ...components[0], quantity: 4, bundle_quantity: 1 },
    { ...components[1], quantity: 3, bundle_quantity: 2 },
  ];

  assert.equal(getBundleComponentQuantity(retroComponents[0]), 1);
  assert.equal(getBundlePieceCount(retroComponents), 3);
  assert.equal(getBundleIndividualValue(retroComponents), 29);
  assert.deepEqual(getBundleComponentRows("bundle-2", retroComponents), [
    { bundle_item_id: "bundle-2", component_item_id: "11", piece_quantity: 1 },
    { bundle_item_id: "bundle-2", component_item_id: "12", piece_quantity: 2 },
  ]);
});
