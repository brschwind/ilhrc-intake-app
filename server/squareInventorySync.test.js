const test = require("node:test");
const assert = require("node:assert/strict");
const {
  catalogVariationWithInventoryTracking,
  inventoryCountsFromEvent,
  parseSquareQuantity,
  soldQuantitiesByVariation,
  startOfDayInTimeZone,
  variationsWithoutInventoryTracking,
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

test("finds linked Square variations that do not track inventory", () => {
  const objects = [
    { type: "ITEM_VARIATION", id: "off", item_variation_data: { track_inventory: false } },
    { type: "ITEM_VARIATION", id: "on", item_variation_data: { track_inventory: true } },
    { type: "ITEM_VARIATION", id: "missing", item_variation_data: {} },
    { type: "ITEM_VARIATION", id: "unlinked", item_variation_data: {} },
  ];
  assert.deepEqual(
    variationsWithoutInventoryTracking(objects, ["off", "on", "missing"]).map((object) => object.id),
    ["off", "missing"]
  );
});

test("totals completed Square order quantities for linked variations", () => {
  const orders = [
    { state: "COMPLETED", line_items: [
      { catalog_object_id: "book-1", quantity: "1" },
      { catalog_object_id: "book-1", quantity: "2" },
      { catalog_object_id: "other", quantity: "5" },
    ] },
    { state: "OPEN", line_items: [{ catalog_object_id: "book-1", quantity: "9" }] },
  ];
  assert.deepEqual([...soldQuantitiesByVariation(orders, ["book-1"])], [["book-1", 3]]);
});

test("enables tracking without mutating or dropping variation fields", () => {
  const original = {
    type: "ITEM_VARIATION",
    id: "variation-1",
    version: 123,
    created_at: "old",
    updated_at: "old",
    is_deleted: false,
    present_at_all_locations: true,
    item_variation_data: { item_id: "item-1", name: "Regular", sku: "ABC" },
  };
  const updated = catalogVariationWithInventoryTracking(original);
  assert.equal(updated.item_variation_data.track_inventory, true);
  assert.equal(updated.item_variation_data.sku, "ABC");
  assert.equal(updated.version, 123);
  assert.equal(updated.updated_at, undefined);
  assert.equal(original.item_variation_data.track_inventory, undefined);
});

test("calculates the Chicago start of day for sale backfill", () => {
  assert.equal(
    startOfDayInTimeZone(new Date("2026-08-14T23:00:00Z"), "America/Chicago"),
    "2026-08-14T05:00:00.000Z"
  );
});
