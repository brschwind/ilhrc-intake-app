import test from "node:test";
import assert from "node:assert/strict";
import { findIsbnInconsistencies, generateRuleSuggestions } from "./ruleSuggestions.js";

function history(publisher, values) {
  return {
    imported_values: { publisher },
    final_values: { publisher, ...values },
  };
}

test("suggests consistent classifications and exact prices after three records", () => {
  const histories = [
    history("Example Press", { subject: "Math", grade_level: "5", category: "Workbook", final_price: "8" }),
    history("Example Press", { subject: "Math", grade_level: "5", category: "Workbook", final_price: "8.00" }),
    history("Example Press", { subject: "Math", grade_level: "5", category: "Workbook", final_price: 8 }),
  ];

  const suggestions = generateRuleSuggestions(histories, [], []);
  const publisherSuggestion = suggestions.find((item) => item.input_field === "publisher");

  assert.equal(publisherSuggestion.actions.subject, "Math");
  assert.equal(publisherSuggestion.actions.grade_level, "5");
  assert.equal(publisherSuggestion.actions.category, "Workbook");
  assert.equal(publisherSuggestion.actions.final_price, "8.00");
  assert.equal(publisherSuggestion.confidence, 1);
});

test("does not suggest an inconsistent output below 90 percent", () => {
  const histories = [
    history("Mixed Press", { subject: "Math" }),
    history("Mixed Press", { subject: "Math" }),
    history("Mixed Press", { subject: "Science" }),
  ];

  assert.equal(generateRuleSuggestions(histories, [], []).length, 0);
});

test("hides deferred suggestions until more evidence arrives", () => {
  const histories = Array.from({ length: 3 }, () => history("Example Press", { subject: "Math" }));
  const first = generateRuleSuggestions(histories, [], [])[0];
  const reviews = [{ suggestion_key: first.key, status: "deferred", sample_count_at_review: 3 }];

  assert.equal(generateRuleSuggestions(histories, [], reviews).length, 0);
  assert.equal(
    generateRuleSuggestions([...histories, history("Example Press", { subject: "Math" })], [], reviews).length > 0,
    true
  );
});

test("does not duplicate an existing active rule", () => {
  const histories = Array.from({ length: 3 }, () => history("Example Press", { subject: "Math" }));
  const rules = [{
    active: true,
    conditions: [{ field: "publisher", operator: "contains", value: "Example Press" }],
    actions: { subject: "Math" },
  }];

  assert.equal(generateRuleSuggestions(histories, rules, []).length, 0);
});

test("flags different prices for inventory records sharing an ISBN", () => {
  const issues = findIsbnInconsistencies([
    { isbn: "978-1-2345-6789-0", title: "Same Book", final_price: 8, subject: "Math" },
    { isbn: "9781234567890", title: "Same Book", final_price: 10, subject: "Math" },
  ]);

  assert.equal(issues.length, 1);
  assert.deepEqual(issues[0].differences.final_price, ["8.00", "10.00"]);
  assert.equal(issues[0].differences.subject, undefined);
  assert.equal(typeof issues[0].record_signature, "string");
});

test("ISBN review signature changes when a matching record changes", () => {
  const original = findIsbnInconsistencies([
    { id: 1, isbn: "9781234567890", title: "Same Book", final_price: 8 },
    { id: 2, isbn: "9781234567890", title: "Same Book", final_price: 10 },
  ])[0];
  const changed = findIsbnInconsistencies([
    { id: 1, isbn: "9781234567890", title: "Same Book", final_price: 8 },
    { id: 2, isbn: "9781234567890", title: "Different Book", final_price: 10 },
  ])[0];

  assert.notEqual(original.record_signature, changed.record_signature);
});
