import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDuplicateLabelQueueUpdate,
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
