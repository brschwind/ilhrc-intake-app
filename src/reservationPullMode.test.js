import test from "node:test";
import assert from "node:assert/strict";
import {
  buildReservationPullMessage,
  preferredReservationContact,
  reservationPullProgress,
} from "./reservationPullMode.js";

const reservations = [
  { item_id: "1", customer_name: "Jordan", status: "ready", expires_at: "2026-08-31T12:00:00Z", preferred_contact: "phone", phone: "312-555-0101" },
  { item_id: "2", customer_name: "Jordan", status: "unavailable", expires_at: "2026-09-01T12:00:00Z", preferred_contact: "phone", phone: "312-555-0101" },
];
const itemById = { "1": { title: "Algebra 1" }, "2": { title: "Biology" } };

test("pull progress completes only after every reservation is resolved", () => {
  assert.deepEqual(reservationPullProgress(reservations), {
    total: 2,
    ready: 1,
    unavailable: 1,
    remaining: 0,
    complete: true,
  });
  assert.equal(reservationPullProgress([...reservations, { status: "pending" }]).complete, false);
});

test("one combined message lists ready and unavailable books", () => {
  const message = buildReservationPullMessage({ reservations, itemById });
  assert.match(message, /Hi Jordan/);
  assert.match(message, /• Algebra 1/);
  assert.match(message, /not able to set aside:\n• Biology/);
  assert.match(message, /Our address is 111 Fisk St\. Goodfield, IL and we are typically open on Tuesdays from 12-4\./);
  assert.match(message, /August 31, 2026/);
  assert.match(message, /Thanks!\nRebekah Schwind {2}\| {2}Director$/);
  assert.equal((message.match(/Hi Jordan/g) || []).length, 1);
});

test("ready-only message follows the bookstore template exactly", () => {
  const message = buildReservationPullMessage({
    reservations: [{
      item_id: "3",
      customer_name: "Crystal J Ben-Ezra",
      status: "ready",
      expires_at: "2026-09-07T17:00:00Z",
    }],
    itemById: { "3": { title: "Our America" } },
  });

  assert.equal(message, [
    "Hi Crystal J Ben-Ezra,",
    "Your IL HRC reservation is ready for pickup. We have set aside:\n• Our America",
    "Our address is 111 Fisk St. Goodfield, IL and we are typically open on Tuesdays from 12-4.",
    "Your available books will be held through September 7, 2026.",
    "Please let us know if you have any questions.",
    "Thanks!\nRebekah Schwind  |  Director",
  ].join("\n\n"));
});

test("preferred contact exposes the requested method and value", () => {
  assert.deepEqual(preferredReservationContact(reservations), {
    method: "Phone",
    value: "312-555-0101",
  });
});
