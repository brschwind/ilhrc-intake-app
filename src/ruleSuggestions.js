import { normalizeRuleText } from "./intakeRules.js";

const INPUT_FIELDS = ["curriculum", "publisher", "author", "title"];
const OUTPUT_FIELDS = ["subject", "grade_level", "category", "final_price"];

function outputKey(field, value) {
  if (field === "final_price") {
    const number = Number(value);
    return Number.isFinite(number) ? number.toFixed(2) : "";
  }
  return normalizeRuleText(value);
}

function suggestionKey(inputField, inputValue, actions) {
  const actionPart = Object.entries(actions)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([field, value]) => `${field}:${outputKey(field, value)}`)
    .join("|");
  return `${inputField}:${normalizeRuleText(inputValue)}=>${actionPart}`;
}

function existingRuleCoversSuggestion(rule, suggestion) {
  if (!rule.active) return false;
  const conditionMatches = (rule.conditions || []).some(
    (condition) =>
      condition.field === suggestion.input_field &&
      normalizeRuleText(condition.value) === normalizeRuleText(suggestion.input_value)
  );
  if (!conditionMatches) return false;
  return Object.entries(suggestion.actions).every(
    ([field, value]) => outputKey(field, rule.actions?.[field]) === outputKey(field, value)
  );
}

export function generateRuleSuggestions(histories, rules, reviews, minimumSamples = 3, minimumConfidence = 0.9) {
  const reviewMap = new Map((reviews || []).map((review) => [review.suggestion_key, review]));
  const suggestions = [];

  for (const inputField of INPUT_FIELDS) {
    const groups = new Map();
    for (const history of histories || []) {
      const finalValues = history.final_values || {};
      const rawInput = finalValues[inputField] || history.imported_values?.[inputField] || "";
      const normalizedInput = normalizeRuleText(rawInput);
      if (normalizedInput.length < 3) continue;
      if (!groups.has(normalizedInput)) groups.set(normalizedInput, { inputValue: rawInput, records: [] });
      groups.get(normalizedInput).records.push(history);
    }

    for (const group of groups.values()) {
      if (group.records.length < minimumSamples) continue;
      const actions = {};
      const evidence = {};

      for (const outputField of OUTPUT_FIELDS) {
        const values = group.records
          .map((history) => history.final_values?.[outputField])
          .filter((value) => value !== "" && value !== null && value !== undefined);
        if (values.length < minimumSamples) continue;

        const counts = new Map();
        for (const value of values) {
          const key = outputKey(outputField, value);
          if (!key) continue;
          const current = counts.get(key) || { count: 0, value };
          current.count += 1;
          counts.set(key, current);
        }
        const winner = [...counts.values()].sort((a, b) => b.count - a.count)[0];
        if (!winner) continue;
        const confidence = winner.count / values.length;
        if (confidence < minimumConfidence) continue;

        actions[outputField] = outputField === "final_price"
          ? Number(winner.value).toFixed(2)
          : winner.value;
        evidence[outputField] = { matching: winner.count, total: values.length, confidence };
      }

      if (Object.keys(actions).length === 0) continue;
      const key = suggestionKey(inputField, group.inputValue, actions);
      const suggestion = {
        key,
        input_field: inputField,
        input_value: group.inputValue,
        actions,
        evidence,
        sample_count: group.records.length,
        confidence: Math.min(...Object.values(evidence).map((item) => item.confidence)),
      };
      if ((rules || []).some((rule) => existingRuleCoversSuggestion(rule, suggestion))) continue;

      const review = reviewMap.get(key);
      if (review?.status === "dismissed" || review?.status === "approved") continue;
      if (review?.status === "deferred" && group.records.length <= review.sample_count_at_review) continue;
      suggestions.push(suggestion);
    }
  }

  return suggestions.sort((a, b) => b.confidence - a.confidence || b.sample_count - a.sample_count);
}

export function findIsbnInconsistencies(items) {
  const groups = new Map();
  for (const item of items || []) {
    const isbn = String(item.isbn || "").toLowerCase().replace(/[^0-9x]/g, "");
    if (isbn.length < 10) continue;
    if (!groups.has(isbn)) groups.set(isbn, []);
    groups.get(isbn).push(item);
  }

  const fields = ["curriculum", "subject", "grade_level", "category", "final_price"];
  const results = [];
  for (const [isbn, records] of groups) {
    if (records.length < 2) continue;
    const differences = {};
    for (const field of fields) {
      const values = [...new Set(records.map((item) => {
        if (field === "final_price") {
          const number = Number(item[field]);
          return Number.isFinite(number) ? number.toFixed(2) : "";
        }
        return String(item[field] || "").trim();
      }).filter(Boolean))];
      if (values.length > 1) differences[field] = values;
    }
    if (Object.keys(differences).length > 0) {
      const recordSignature = JSON.stringify(
        records
          .map((item) => ({
            id: String(item.id || ""),
            title: normalizeRuleText(item.title),
            curriculum: normalizeRuleText(item.curriculum),
            subject: normalizeRuleText(item.subject),
            grade_level: normalizeRuleText(item.grade_level),
            category: normalizeRuleText(item.category),
            final_price: Number.isFinite(Number(item.final_price))
              ? Number(item.final_price).toFixed(2)
              : "",
          }))
          .sort((a, b) => (a.id || a.title).localeCompare(b.id || b.title))
      );
      results.push({
        isbn,
        title: records.find((item) => item.title)?.title || "Untitled",
        record_count: records.length,
        differences,
        record_signature: recordSignature,
      });
    }
  }
  return results.sort((a, b) => a.title.localeCompare(b.title));
}
