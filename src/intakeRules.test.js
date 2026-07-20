import test from "node:test";
import assert from "node:assert/strict";
import { applyIntakeRules, mergeExactIsbnMemory, ruleMatches } from "./intakeRules.js";

function rule(overrides = {}) {
  return {
    id: crypto.randomUUID(),
    name: "Test rule",
    active: true,
    match_mode: "all",
    priority: 0,
    conditions: [],
    actions: {},
    ...overrides,
  };
}

test("normalizes punctuation and capitalization for contains matches", () => {
  const mathRule = rule({
    conditions: [{ field: "curriculum", operator: "contains", value: "Math-U-See" }],
    actions: { subject: "Math" },
  });

  assert.equal(ruleMatches(mathRule, { curriculum: "MATH U SEE: Algebra 1" }), true);
});

test("an exact ISBN rule beats a general curriculum rule", () => {
  const general = rule({
    id: "general",
    name: "General math",
    conditions: [{ field: "curriculum", operator: "contains", value: "Math-U-See" }],
    actions: { category: "Workbook" },
  });
  const isbn = rule({
    id: "isbn",
    name: "Exact teacher book",
    conditions: [{ field: "isbn", operator: "equals", value: "978-1-2345-6789-0" }],
    actions: { category: "Teacher Edition" },
  });

  const result = applyIntakeRules(
    { isbn: "9781234567890", curriculum: "Math U See" },
    [general, isbn]
  );

  assert.equal(result.book.category, "Teacher Edition");
  assert.equal(result.sources.category.ruleId, "isbn");
});

test("equally specific contradictory rules require a choice", () => {
  const first = rule({
    id: "first",
    name: "First",
    conditions: [{ field: "publisher", operator: "equals", value: "Example Press" }],
    actions: { subject: "Math" },
  });
  const second = rule({
    id: "second",
    name: "Second",
    conditions: [{ field: "publisher", operator: "equals", value: "Example Press" }],
    actions: { subject: "Science" },
  });

  const result = applyIntakeRules({ publisher: "Example Press", subject: "Imported" }, [first, second]);

  assert.equal(result.book.subject, "Imported");
  assert.equal(result.conflicts.subject.length, 2);
  assert.equal(result.sources.subject, undefined);
});

test("non-conflicting rules can fill several fields", () => {
  const curriculumRule = rule({
    id: "curriculum",
    name: "Curriculum",
    conditions: [{ field: "publisher", operator: "contains", value: "Demme" }],
    actions: { curriculum: "Math-U-See", subject: "Math" },
  });

  const result = applyIntakeRules({ publisher: "Demme Learning" }, [curriculumRule]);

  assert.equal(result.book.curriculum, "Math-U-See");
  assert.equal(result.book.subject, "Math");
});

test("exact ISBN memory overrides rule results and resolves that field's conflict", () => {
  const result = mergeExactIsbnMemory(
    {
      book: { subject: "Science", category: "Workbook" },
      sources: { subject: { ruleId: "rule", ruleName: "General rule" } },
      conflicts: { category: [{ ruleId: "one", value: "Workbook" }, { ruleId: "two", value: "Textbook" }] },
      matchingRules: [],
    },
    { subject: "Math", category: "Student Workbook", final_price: "8.00" }
  );

  assert.equal(result.book.subject, "Math");
  assert.equal(result.book.category, "Student Workbook");
  assert.equal(result.sources.subject.sourceType, "isbn_memory");
  assert.equal(result.book.final_price, "8.00");
  assert.equal(result.conflicts.category, undefined);
});

test("labels inventory ISBN fallback separately from intake history", () => {
  const result = mergeExactIsbnMemory(
    { book: {}, sources: {}, conflicts: {}, matchingRules: [] },
    { subject: "Math", memory_source: "existing_inventory" }
  );

  assert.equal(result.sources.subject.sourceType, "isbn_inventory");
  assert.equal(result.sources.subject.ruleName, "Existing inventory ISBN match");
});
