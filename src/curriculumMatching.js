export function normalizeIsbn(value) {
  return String(value || "").replace(/[^0-9X]/gi, "").toUpperCase();
}
export function normalizeBookText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function normalizePublisherIdentifier(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function normalizePublisherItemNumber(value) {
  return String(value || "").trim().replace(/\s+/g, "").toUpperCase();
}

const TITLE_STOP_WORDS = new Set(["a", "an", "and", "for", "of", "the", "to", "with"]);
const TITLE_TOKEN_ALIASES = {
  bk: "book",
  pt: "part",
  vol: "volume",
};

function bookTextTokens(value, { omitStopWords = false } = {}) {
  return normalizeBookText(value)
    .split(" ")
    .filter(Boolean)
    .filter((token) => !omitStopWords || !TITLE_STOP_WORDS.has(token))
    .map((token) => TITLE_TOKEN_ALIASES[token] || token);
}

function sameWords(first, second) {
  const firstWords = [...new Set(bookTextTokens(first))].sort();
  const secondWords = [...new Set(bookTextTokens(second))].sort();
  return firstWords.length === secondWords.length &&
    firstWords.every((word, index) => word === secondWords[index]);
}

export function getTitleSimilarity(first, second) {
  const firstTitle = normalizeBookText(first);
  const secondTitle = normalizeBookText(second);
  if (!firstTitle || !secondTitle) return 0;
  if (firstTitle === secondTitle) return 1;

  const firstTokens = [...new Set(bookTextTokens(first, { omitStopWords: true }))];
  const secondTokens = [...new Set(bookTextTokens(second, { omitStopWords: true }))];
  if (Math.min(firstTokens.length, secondTokens.length) < 2) return 0;

  const firstNumbers = firstTokens.filter((token) => /^\d+$/.test(token));
  const secondNumbers = secondTokens.filter((token) => /^\d+$/.test(token));
  if (
    (firstNumbers.length > 0 || secondNumbers.length > 0) &&
    !sameWords(firstNumbers.join(" "), secondNumbers.join(" "))
  ) return 0;

  const secondSet = new Set(secondTokens);
  const sharedCount = firstTokens.filter((token) => secondSet.has(token)).length;
  if (sharedCount < 2) return 0;

  const smallerCoverage = sharedCount / Math.min(firstTokens.length, secondTokens.length);
  const largerCoverage = sharedCount / Math.max(firstTokens.length, secondTokens.length);
  return (smallerCoverage * 0.7) + (largerCoverage * 0.3);
}

export function findCurriculumInventoryMatches(material, inventory = []) {
  const available = inventory.filter((item) => Number(item.quantity || 0) > 0);
  const primaryIsbn = normalizeIsbn(material.isbn);
  const acceptedIsbns = (material.acceptable_isbns || [])
    .map(normalizeIsbn)
    .filter(Boolean);

  if (primaryIsbn) {
    const exact = available.filter((item) => normalizeIsbn(item.isbn) === primaryIsbn);
    if (exact.length) return exact.map((item) => ({ status: "exact", item }));
  }

  if (acceptedIsbns.length > 0) {
    const approved = available.filter((item) => acceptedIsbns.includes(normalizeIsbn(item.isbn)));
    if (approved.length) return approved.map((item) => ({ status: "approved", item }));
  }

  const publisher = normalizePublisherIdentifier(material.publisher);
  const publisherItemNumber = normalizePublisherItemNumber(material.publisher_item_number);
  if (publisher && publisherItemNumber) {
    const publisherMatches = available.filter((item) =>
      normalizePublisherIdentifier(item.publisher) === publisher &&
      normalizePublisherItemNumber(item.publisher_item_number) === publisherItemNumber
    );
    if (publisherMatches.length) return publisherMatches.map((item) => ({ status: "publisher", item }));
  }

  const title = normalizeBookText(material.title);
  const author = normalizeBookText(material.author);
  if (title) {
    const titleMatches = available.map((item) => {
      const score = getTitleSimilarity(material.title, item.title);
      const itemAuthor = normalizeBookText(item.author);
      const authorMatches = !author || !itemAuthor || sameWords(material.author, item.author);
      return {
        item,
        score,
        authorMatches,
        exactTitle: normalizeBookText(item.title) === title,
      };
    }).filter(({ score, authorMatches }) => score >= 0.78 && authorMatches)
      .sort((first, second) => second.score - first.score);
    if (titleMatches.length) {
      return titleMatches.map(({ item, exactTitle }) => ({
        status: exactTitle ? "possible" : "title",
        item,
      }));
    }
  }

  return [];
}

export function findCurriculumInventoryMatch(material, inventory = []) {
  const matches = findCurriculumInventoryMatches(material, inventory);
  if (matches.length) return matches[0];
  return { status: "missing", item: null };
}

export function getCurriculumMatchLabel(status) {
  return {
    confirmed: "In store — staff confirmed",
    exact: "In store — exact edition",
    approved: "In store — approved alternative",
    publisher: "In store — publisher item match",
    possible: "Possible in-store match — exact title",
    title: "Suggested from a similar title — confirm match",
    missing: "Not currently in store",
  }[status] || "Not currently in store";
}
