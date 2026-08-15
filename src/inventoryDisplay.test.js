import test from "node:test";
import assert from "node:assert/strict";
import {
  compareInventoryItems,
  isSoldOutInventoryItem,
  totalSoldCopies,
} from "./inventoryDisplay.js";

test("sold inventory always sorts after available inventory", () => {
  const items = [
    { id: "sold", title: "A", status: "Sold", quantity: 0, created_at: "2026-08-14" },
    { id: "available", title: "Z", status: "Available", quantity: 2, created_at: "2026-08-01" },
  ];
  for (const sortBy of ["newest", "oldest", "title", "quantityLow", "quantityHigh"]) {
    assert.deepEqual(items.toSorted((a, b) => compareInventoryItems(a, b, sortBy)).map((item) => item.id), [
      "available",
      "sold",
    ]);
  }
});

test("sold-out styling follows the inventory status", () => {
  assert.equal(isSoldOutInventoryItem({ status: "Sold", quantity: 0 }), true);
  assert.equal(isSoldOutInventoryItem({ status: "Available", quantity: 0 }), false);
  assert.equal(isSoldOutInventoryItem({ status: "Hold", quantity: 0 }), false);
});

test("sold copy total uses cumulative sales instead of remaining quantity", () => {
  assert.equal(totalSoldCopies([
    { status: "Sold", quantity: 0, sold_quantity: 3 },
    { status: "Available", quantity: 2, sold_quantity: 4 },
  ]), 7);
});
