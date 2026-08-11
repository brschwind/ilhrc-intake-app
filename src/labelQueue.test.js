import test from "node:test";
import assert from "node:assert/strict";

import {
  buildEditedItemLabelQueueUpdate,
  buildDuplicateLabelQueueUpdate,
  buildSelectedLabelQueueUpdate,
  getLabelAffectingEditFields,
  getQueuedLabelQuantity,
} from "./labelQueue.js";

test("a printed listing queues only the newly received copies", () => {
  const queuedAt = "2026-07-28T15:00:00.000Z";

  assert.deepEqual(
    buildDuplicateLabelQueueUpdate(
      { quantity: 8, label_printed: true, pending_label_quantity: 0 },
      2,
      queuedAt
    ),
    {
      label_printed: false,
      pending_label_quantity: 2,
      label_queued_at: queuedAt,
    }
  );
});

test("another duplicate receipt adds to the existing queue quantity", () => {
  assert.equal(
    buildDuplicateLabelQueueUpdate(
      { quantity: 8, label_printed: false, pending_label_quantity: 2 },
      3,
      "2026-07-28T16:00:00.000Z"
    ).pending_label_quantity,
    5
  );
});

test("legacy unprinted listings fall back to their inventory quantity", () => {
  assert.equal(
    getQueuedLabelQuantity({ quantity: 4, label_printed: false }),
    4
  );
});

test("inventory selection queues existing labels without duplicating an existing queue", () => {
  const queuedAt = "2026-08-04T20:00:00.000Z";
  assert.deepEqual(
    buildSelectedLabelQueueUpdate({ quantity: 3, label_printed: true }, queuedAt),
    { label_printed: false, pending_label_quantity: 3, label_queued_at: queuedAt }
  );
  assert.deepEqual(
    buildSelectedLabelQueueUpdate({ quantity: 5, label_printed: false, pending_label_quantity: 2, label_queued_at: "earlier" }, queuedAt),
    { label_printed: false, pending_label_quantity: 2, label_queued_at: "earlier" }
  );
});

test("SKU, price, and quantity edits are identified using their saved value types", () => {
  assert.deepEqual(
    getLabelAffectingEditFields(
      { sku: "ILHRC-001", final_price: 12.5, quantity: 2 },
      { sku: "ILHRC-002", final_price: "13.00", quantity: "3" }
    ),
    ["sku", "final_price", "quantity"]
  );

  assert.deepEqual(
    getLabelAffectingEditFields(
      { sku: "ILHRC-001", final_price: 12.5, quantity: 2 },
      { sku: "ILHRC-001", final_price: "12.50", quantity: "2" }
    ),
    []
  );
});

test("an edited listing adds one replacement sticker to its current queue", () => {
  const queuedAt = "2026-08-11T20:00:00.000Z";

  assert.deepEqual(
    buildEditedItemLabelQueueUpdate(
      { quantity: 4, label_printed: true, pending_label_quantity: 0 },
      queuedAt
    ),
    { label_printed: false, pending_label_quantity: 1, label_queued_at: queuedAt }
  );
  assert.equal(
    buildEditedItemLabelQueueUpdate(
      { quantity: 4, label_printed: false, pending_label_quantity: 2 },
      queuedAt
    ).pending_label_quantity,
    3
  );
});
