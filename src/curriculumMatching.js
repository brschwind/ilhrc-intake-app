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

export function findCurriculumInventoryMatch(material, inventory = []) {
  const available = inventory.filter((item) => Number(item.quantity || 0) > 0);
  const primaryIsbn = normalizeIsbn(material.isbn);
  const acceptedIsbns = (material.acceptable_isbns || [])
    .map(normalizeIsbn)
    .filter(Boolean);

  if (primaryIsbn) {
    const exact = available.find((item) => normalizeIsbn(item.isbn) === primaryIsbn);
    if (exact) return { status: "exact", item: exact };
  }

  if (acceptedIsbns.length > 0) {
    const approved = available.find((item) => acceptedIsbns.includes(normalizeIsbn(item.isbn)));
    if (approved) return { status: "approved", item: approved };
  }

  const publisher = normalizePublisherIdentifier(material.publisher);
  const publisherItemNumber = normalizePublisherItemNumber(material.publisher_item_number);
  if (publisher && publisherItemNumber) {
    const publisherMatch = available.find((item) =>
      normalizePublisherIdentifier(item.publisher) === publisher &&
      normalizePublisherItemNumber(item.publisher_item_number) === publisherItemNumber
    );
    if (publisherMatch) return { status: "publisher", item: publisherMatch };
  }

  const title = normalizeBookText(material.title);
  const author = normalizeBookText(material.author);
  if (title) {
    const possible = available.find((item) => {
      if (normalizeBookText(item.title) !== title) return false;
      const itemAuthor = normalizeBookText(item.author);
      return !author || !itemAuthor || itemAuthor === author;
    });
    if (possible) return { status: "possible", item: possible };
  }

  return { status: "missing", item: null };
}

export function getCurriculumMatchLabel(status) {
  return {
    exact: "In store — exact edition",
    approved: "In store — approved alternative",
    publisher: "In store — publisher item match",
    possible: "Possible in-store match — ask staff to confirm",
    missing: "Not currently in store",
  }[status] || "Not currently in store";
}
