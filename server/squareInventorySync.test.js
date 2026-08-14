const test = require("node:test");
const assert = require("node:assert/strict");
const {
  inventoryCountsFromEvent,
  parseSquareQuantity,
} = require("./squareInventorySync");

test("accepts whole Square inventory quantities, including oversold counts", () => {
  assert.equal(parseSquareQuantity("0"), 0);
  assert.equal(parseSquareQuantity("12"), 12);
  assert.equal(parseSquareQuantity("1.5"), null);
  assert.equal(parseSquareQuantity("-1"), -1);
  assert.equal(parseSquareQuantity("not-a-number"), null);
});

test("extracts the newest in-stock count for the configured location", () => {
  const event = {
    type: "inventory.count.updated",
    event_id: "event-1",
    created_at: "2026-08-14T12:00:00Z",
    data: {
      object: {
        inventory_counts: [
          { catalog_object_id: "variation-1", location_id: "other", state: "IN_STOCK", quantity: "9", calculated_at: "2026-08-14T12:00:00Z" },
          { catalog_object_id: "variation-1", location_id: "location-1", state: "SOLD", quantity: "1", calculated_at: "2026-08-14T12:00:01Z" },
          { catalog_object_id: "variation-1", location_id: "location-1", state: "IN_STOCK", quantity: "2", calculated_at: "2026-08-14T12:00:00Z" },
          { catalog_object_id: "variation-1", location_id: "location-1", state: "IN_STOCK", quantity: "1", calculated_at: "2026-08-14T12:00:02Z" },
        ],
      },
    },
  };

  assert.deepEqual(inventoryCountsFromEvent(event, "location-1"), [{
    squareVariationId: "variation-1",
    locationId: "location-1",
    quantity: 1,
    calculatedAt: "2026-08-14T12:00:02.000Z",
  }]);
});

test("ignores unrelated and malformed webhook events", () => {
  assert.deepEqual(inventoryCountsFromEvent({ type: "order.updated" }, "location-1"), []);
  assert.deepEqual(inventoryCountsFromEvent({ type: "inventory.count.updated", data: {} }, "location-1"), []);
});
