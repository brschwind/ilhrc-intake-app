export function normalizeBarcode(value) {
  return String(value || "").trim().replace(/\s+/g, "");
}

export function normalizePublisher(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function normalizePublisherItemNumber(value) {
  return String(value || "").trim().replace(/\s+/g, "").toUpperCase();
}

function isValidIsbn10(value) {
  if (!/^\d{9}[\dX]$/.test(value)) return false;
  const total = [...value].reduce((sum, character, index) =>
    sum + (character === "X" ? 10 : Number(character)) * (10 - index), 0);
  return total % 11 === 0;
}

function isValidIsbn13(value) {
  if (!/^(978|979)\d{10}$/.test(value)) return false;
  const total = [...value.slice(0, 12)].reduce((sum, character, index) =>
    sum + Number(character) * (index % 2 === 0 ? 1 : 3), 0);
  return (10 - (total % 10)) % 10 === Number(value[12]);
}

export function identifyBookBarcode(value) {
  const raw = normalizeBarcode(value);
  const isbn = raw.replace(/[^0-9Xx]/g, "").toUpperCase();

  if (isValidIsbn10(isbn) || isValidIsbn13(isbn)) {
    return { type: "isbn", raw, isbn };
  }

  const digits = raw.replace(/\D/g, "");
  if (/^\d{8}$/.test(digits)) {
    return {
      type: "publisher",
      raw,
      publisherBarcode: digits,
      // Abeka's back-cover barcode begins with its six-digit catalog number.
      // The database lookup confirms the publisher before using the candidate.
      publisherItemNumber: digits.slice(0, 6),
      barcodeSuffix: digits.slice(6),
    };
  }

  return { type: "unknown", raw };
}

export function inferPublisherItemNumber(publisher, publisherBarcode) {
  const barcode = normalizeBarcode(publisherBarcode).replace(/\D/g, "");
  if (normalizePublisher(publisher) === "abeka" && /^\d{8}$/.test(barcode)) {
    return barcode.slice(0, 6);
  }
  return "";
}
