import test from "node:test";
import assert from "node:assert/strict";
import { getIntakeAttention, hasUncertainIdentification } from "./intakeAttention.js";
const complete = { title: "Math 2", curriculum: "Abeka", subject: "Math", grade_level: "2", category: "Textbook", final_price: 5, quantity: 1 };
test("complete core details do not flag blank optional metadata", () => {
  assert.deepEqual(getIntakeAttention(complete), []);
});
test("missing core details identify only the fields needing review", () => {
  assert.deepEqual(getIntakeAttention({ ...complete, title: " ", subject: "" }).map((issue) => issue.field), ["title", "subject"]);
});
test("zero price is valid; empty, negative and invalid prices are flagged", () => {
  assert.deepEqual(getIntakeAttention({ ...complete, final_price: 0 }), []);
  for (const final_price of ["", null, -1, "invalid"]) assert.equal(getIntakeAttention({ ...complete, final_price })[0].field, "final_price");
});
test("grade fallback and default quantity remain supported", () => {
  assert.deepEqual(getIntakeAttention({ ...complete, grade_level: "", grade: "2", quantity: undefined }), []);
  for (const quantity of [0, -1, 1.5, "invalid"]) assert.equal(getIntakeAttention({ ...complete, quantity })[0].field, "quantity");
});
test("rule conflicts replace missing notices without duplicate prompts", () => {
  const issues = getIntakeAttention({ ...complete, subject: "" }, { subject: [{ value: "Math" }], category: [{ value: "Workbook" }] });
  assert.equal(issues.length, 2); assert.ok(issues.every((issue) => issue.reason === "Conflicting suggestions"));
});
test("publisher is requested only when its item number needs it", () => {
  assert.deepEqual(getIntakeAttention({ ...complete, publisher: "" }), []);
  assert.equal(getIntakeAttention({ ...complete, publisher_item_number: "1234" })[0].field, "publisher");
});
test("uncertainty uses numeric overall recognition confidence, including zero", () => {
  assert.equal(hasUncertainIdentification({ confidence: 0 }), true);
  assert.equal(hasUncertainIdentification({ confidence: 0.79 }), true);
  for (const confidence of [0.8, 1, "Google Books ISBN lookup", undefined, NaN]) assert.equal(hasUncertainIdentification({ confidence }), false);
});
