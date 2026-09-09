export const LOCATION_SCAN_PREFIX = "LOCATION:";

export function classifyScan(rawValue) {
  const raw = String(rawValue || "").trim();
  if (raw.toUpperCase().startsWith(LOCATION_SCAN_PREFIX)) {
    const code = raw.slice(LOCATION_SCAN_PREFIX.length).trim().toUpperCase();
    return { kind: "location", raw, code };
  }
  return { kind: "item", raw };
}

export function totalLocationQuantity(rows, itemId) {
  return (rows || [])
    .filter((row) => itemId === undefined || String(row.item_id) === String(itemId))
    .reduce((sum, row) => sum + Math.max(0, Number(row.quantity) || 0), 0);
}

export function accumulateObservedCount(counts, itemId, delta = 1) {
  const next = { ...(counts || {}) };
  const key = String(itemId);
  const quantity = Math.max(0, Number(next[key] || 0) + Number(delta || 0));
  if (quantity === 0) delete next[key];
  else next[key] = quantity;
  return next;
}

export function buildAuditDiscrepancies(expectedRows, observedCounts) {
  const expected = Object.fromEntries(
    (expectedRows || []).map((row) => [String(row.item_id), Number(row.quantity) || 0])
  );
  const keys = new Set([...Object.keys(expected), ...Object.keys(observedCounts || {})]);
  return [...keys].map((itemId) => {
    const expectedQuantity = expected[itemId] || 0;
    const observedQuantity = Number(observedCounts?.[itemId] || 0);
    return {
      itemId,
      expectedQuantity,
      observedQuantity,
      difference: observedQuantity - expectedQuantity,
    };
  });
}

export function chooseShelvingRecommendation({ exact = [], curriculum = [], fallback = [], needsReview }) {
  const ranked = [exact, curriculum, fallback].find((group) => group?.length);
  return ranked?.[0] || needsReview || null;
}

