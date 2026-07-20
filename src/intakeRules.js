export const RULE_INPUT_FIELDS = [
  ["isbn", "ISBN"],
  ["title", "Title"],
  ["author", "Author"],
  ["publisher", "Publisher"],
  ["curriculum", "Curriculum"],
];

export const RULE_OUTPUT_FIELDS = [
  ["curriculum", "Curriculum"],
  ["subject", "Subject"],
  ["grade_level", "Grade Level"],
  ["category", "Category"],
  ["final_price", "Final Price"],
];

export function normalizeRuleText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9x]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedIsbn(value) {
  return String(value || "").toLowerCase().replace(/[^0-9x]/g, "");
}

function conditionMatches(condition, book) {
  const rawActual = book?.[condition.field];
  const actual = condition.field === "isbn"
    ? normalizedIsbn(rawActual)
    : normalizeRuleText(rawActual);
  const expected = condition.field === "isbn"
    ? normalizedIsbn(condition.value)
    : normalizeRuleText(condition.value);

  if (!actual || !expected) return false;
  return condition.operator === "contains"
    ? actual.includes(expected)
    : actual === expected;
}

function conditionSpecificity(condition) {
  const fieldWeight = {
    isbn: 1000,
    publisher: 600,
    curriculum: 600,
    author: 500,
    title: 400,
  }[condition.field] || 0;
  return fieldWeight + (condition.operator === "equals" ? 100 : 0);
}

function ruleSpecificity(rule) {
  const scores = (rule.conditions || []).map(conditionSpecificity);
  const base = scores.length ? Math.max(...scores) : 0;
  const allBonus = rule.match_mode === "all" ? scores.length * 10 : 0;
  return base + allBonus + Number(rule.priority || 0);
}

export function ruleMatches(rule, book) {
  const conditions = (rule.conditions || []).filter(
    (condition) => condition.field && condition.operator && condition.value
  );
  if (!rule.active || conditions.length === 0) return false;
  return rule.match_mode === "any"
    ? conditions.some((condition) => conditionMatches(condition, book))
    : conditions.every((condition) => conditionMatches(condition, book));
}

export function applyIntakeRules(book, rules) {
  const matchingRules = (rules || [])
    .filter((rule) => ruleMatches(rule, book))
    .map((rule) => ({ ...rule, specificity: ruleSpecificity(rule) }))
    .sort((a, b) => b.specificity - a.specificity || a.name.localeCompare(b.name));

  const nextBook = { ...book };
  const sources = {};
  const conflicts = {};
  const candidatesByField = {};

  for (const rule of matchingRules) {
    for (const [field, rawValue] of Object.entries(rule.actions || {})) {
      const value = String(rawValue || "").trim();
      if (!value) continue;
      (candidatesByField[field] ||= []).push({ rule, value });
    }
  }

  for (const [field, candidates] of Object.entries(candidatesByField)) {
    const strongest = candidates[0];
    const tied = candidates.filter(
      (candidate) => candidate.rule.specificity === strongest.rule.specificity
    );
    const distinctValues = [...new Set(tied.map((candidate) => candidate.value))];

    if (distinctValues.length > 1) {
      conflicts[field] = tied.map((candidate) => ({
        ruleId: candidate.rule.id,
        ruleName: candidate.rule.name,
        value: candidate.value,
      }));
      continue;
    }

    nextBook[field] = strongest.value;
    sources[field] = {
      ruleId: strongest.rule.id,
      ruleName: strongest.rule.name,
      previousValue: book?.[field] || "",
    };
  }

  return { book: nextBook, sources, conflicts, matchingRules };
}

export function mergeExactIsbnMemory(ruleResult, memory) {
  if (!memory) return ruleResult;

  const book = { ...ruleResult.book };
  const sources = { ...ruleResult.sources };
  const conflicts = { ...ruleResult.conflicts };

  for (const field of ["curriculum", "subject", "grade_level", "category", "final_price"]) {
    const value = String(memory[field] || "").trim();
    if (!value) continue;

    book[field] = value;
    sources[field] = {
      ruleId: null,
      ruleName: memory.memory_source === "existing_inventory"
        ? "Existing inventory ISBN match"
        : "Previous approved ISBN intake",
      sourceType: memory.memory_source === "existing_inventory"
        ? "isbn_inventory"
        : "isbn_memory",
      previousValue: ruleResult.book?.[field] || "",
    };
    delete conflicts[field];
  }

  return { ...ruleResult, book, sources, conflicts, isbnMemory: memory };
}
