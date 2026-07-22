const ABEKA_PRODUCTS = {
  195227: { title: "Fun with Pets", edition: "Second" },
  195251: { title: "Tiptoes", edition: "Sixth" },
  195278: { title: "Stepping Stones", edition: "Sixth" },
  195308: { title: "Secrets and Surprises" },
  195367: { title: "Kind and Brave" },
  195383: { title: "Aesop's Fables for Young Readers" },
  195634: { title: "Strong and True" },
  197084: { title: "Down by the Sea" },
  182788: { title: "Primary Bible Reader" },
  201103: { title: "Handbook for Reading" },
  196924: { title: "Letters and Sounds 1" },
  196967: { title: "Letters and Sounds 1 Test Book" },
  138533: { title: "Mini Alphabet Flashcards" },
  196878: { title: "Language 1" },
  197076: { title: "Spelling and Poetry 1" },
  197041: { title: "Writing with Phonics 1 Manuscript" },
  271942: { title: "1st Grade Writing Tablet" },
};

export function normalizeBarcode(value) {
  return String(value || "").trim().replace(/\s+/g, "");
}

export function normalizePublisher(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function normalizePublisherItemNumber(value) {
  return String(value || "").trim().replace(/\s+/g, "").toUpperCase();
}

export function identifyBookBarcode(value) {
  const raw = normalizeBarcode(value);
  const isbn = raw.replace(/[^0-9Xx]/g, "").toUpperCase();

  if (isbn.length === 10 || isbn.length === 13) {
    return { type: "isbn", raw, isbn };
  }

  const digits = raw.replace(/\D/g, "");
  if (/^\d{8}$/.test(digits) && getKnownAbekaProduct(digits.slice(0, 6))) {
    return {
      type: "publisher",
      raw,
      publisher: "Abeka",
      publisherItemNumber: digits.slice(0, 6),
      publisherBarcode: digits,
      // Backward-compatible names for data imported during the Abeka prototype.
      abekaItemNumber: digits.slice(0, 6),
      barcodeSuffix: digits.slice(6),
    };
  }

  return { type: "unknown", raw };
}

export function getKnownAbekaProduct(itemNumber) {
  return ABEKA_PRODUCTS[String(itemNumber)] || null;
}

export function getKnownPublisherProduct(publisher, itemNumber) {
  return normalizePublisher(publisher) === "abeka"
    ? getKnownAbekaProduct(normalizePublisherItemNumber(itemNumber))
    : null;
}

export function inferPublisherItemNumber(publisher, publisherBarcode) {
  const barcode = normalizeBarcode(publisherBarcode).replace(/\D/g, "");
  if (normalizePublisher(publisher) === "abeka" && /^\d{8}$/.test(barcode)) {
    return barcode.slice(0, 6);
  }
  return "";
}

export function publisherIdentifiersMatch(left, right) {
  const leftPublisher = normalizePublisher(left?.publisher);
  const rightPublisher = normalizePublisher(right?.publisher);
  const leftNumber = normalizePublisherItemNumber(left?.publisher_item_number);
  const rightNumber = normalizePublisherItemNumber(right?.publisher_item_number);
  return Boolean(
    leftPublisher && rightPublisher && leftPublisher === rightPublisher &&
    leftNumber && rightNumber && leftNumber === rightNumber
  );
}
