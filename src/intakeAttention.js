const fields = [
  ["title", "Title"], ["curriculum", "Curriculum"], ["subject", "Subject"],
  ["grade_level", "Grade level"], ["category", "Category"],
];
export function getIntakeAttention(book, conflicts = {}) {
  if (!book) return [];
  const issues = fields.filter(([key]) => !String(key === "grade_level" ? (book.grade_level || book.grade || "") : (book[key] ?? "")).trim())
    .map(([field, label]) => ({ field, label, reason: "Missing" }));
  const price = book.final_price;
  if (price === null || price === undefined || String(price).trim() === "" || !Number.isFinite(Number(price)) || Number(price) < 0)
    issues.push({ field: "final_price", label: "Price", reason: "Enter a price" });
  const quantity = Number(book.quantity ?? 1);
  if (!Number.isInteger(quantity) || quantity < 1)
    issues.push({ field: "quantity", label: "Quantity", reason: "Use a whole number of 1 or more" });
  if (book.publisher_item_number && !String(book.publisher || "").trim())
    issues.push({ field: "publisher", label: "Publisher", reason: "Needed for publisher item number" });
  for (const [field, choices] of Object.entries(conflicts)) {
    if (!choices?.length) continue;
    const existing = issues.find((issue) => issue.field === field);
    if (existing) existing.reason = "Conflicting suggestions";
    else issues.push({ field, label: fields.find(([key]) => key === field)?.[1] || field.replaceAll("_", " "), reason: "Conflicting suggestions" });
  }
  return issues;
}
export function hasUncertainIdentification(book) {
  return typeof book?.confidence === "number" && Number.isFinite(book.confidence) && book.confidence < 0.8;
}
