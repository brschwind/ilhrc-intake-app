import test from "node:test";
import assert from "node:assert/strict";
import { groupReservationsByCustomer } from "./reservationPrint.js";

test("groups reservations with normalized matching email addresses", () => {
  const groups = groupReservationsByCustomer([
    { id: "1", customer_name: "Jamie Lee", email: " JAMIE@example.com ", created_at: "2026-08-02" },
    { id: "2", customer_name: "Jamie L.", email: "jamie@example.com", created_at: "2026-08-01" },
  ]);

  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].reservations.map(({ id }) => id), ["2", "1"]);
});

test("groups normalized phone numbers and bridges email-only and phone-only reservations", () => {
  const groups = groupReservationsByCustomer([
    { id: "email", customer_name: "Alex Smith", email: "alex@example.com" },
    { id: "bridge", customer_name: "Alex Smith", email: "alex@example.com", phone: "(217) 555-0100" },
    { id: "phone", customer_name: "Alex Smith", phone: "+1 217-555-0100" },
  ]);

  assert.equal(groups.length, 1);
  assert.equal(groups[0].reservations.length, 3);
});

test("does not combine people who only share a name when contact details differ", () => {
  const groups = groupReservationsByCustomer([
    { id: "1", customer_name: "Chris Johnson", email: "one@example.com" },
    { id: "2", customer_name: "Chris Johnson", email: "two@example.com" },
  ]);

  assert.equal(groups.length, 2);
});

test("uses a normalized name when a legacy reservation has no contact details", () => {
  const groups = groupReservationsByCustomer([
    { id: "1", customer_name: "  Pat   Morgan " },
    { id: "2", customer_name: "pat morgan" },
  ]);

  assert.equal(groups.length, 1);
});
