import {
  findCurriculumInventoryMatch,
  normalizeIsbn,
  normalizePublisherItemNumber,
} from "./curriculumMatching.js";

export const CURRICULUM_IMPORT_COLUMNS = [
  "title",
  "author",
  "publisher",
  "publisher_item_number",
  "publisher_barcode",
  "isbn",
  "acceptable_isbns",
  "edition_label",
  "material_type",
  "affiliate_url",
  "affiliate_label",
  "group_label",
  "requirement_type",
  "compatibility_mode",
  "audience",
  "quantity",
  "notes",
];

export const CURRICULUM_IMPORT_TEMPLATE = `${CURRICULUM_IMPORT_COLUMNS.join(",")}\n`;

function escapeCsvValue(value) {
  const text = Array.isArray(value) ? value.join("|") : String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function curriculumMaterialsToCsv(materials) {
  const rows = (Array.isArray(materials) ? materials : []).map((material) =>
    CURRICULUM_IMPORT_COLUMNS.map((column) => escapeCsvValue(material?.[column])).join(",")
  );
  return [CURRICULUM_IMPORT_COLUMNS.join(","), ...rows].join("\n");
}

export function deduplicateCurriculumMaterials(materials) {
  const seen = new Set();
  return (Array.isArray(materials) ? materials : []).filter((material) => {
    const isbn = normalizeIsbn(material?.isbn);
    const publisher = String(material?.publisher || "").trim().toLowerCase();
    const publisherItemNumber = normalizePublisherItemNumber(material?.publisher_item_number);
    const title = String(material?.title || "").trim().toLowerCase();
    const edition = String(material?.edition_label || "").trim().toLowerCase();
    const key = isbn
      ? `isbn:${isbn}`
      : publisher && publisherItemNumber
        ? `publisher:${publisher}|${publisherItemNumber}`
        : `title:${title}|${edition}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function isCurriculumPackageOffer(material) {
  const normalized = String(material?.title || material || "")
    .toLowerCase()
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  return /\bkit\b/.test(normalized) ||
    /\bvideo (?:enrollment|instruction)\b/.test(normalized) ||
    /\bfull-grade video(?: enrollment| & books)\b/.test(normalized);
}

export function partitionCurriculumMaterials(materials) {
  return (Array.isArray(materials) ? materials : []).reduce((result, material) => {
    result[isCurriculumPackageOffer(material) ? "excluded" : "materials"].push(material);
    return result;
  }, { materials: [], excluded: [] });
}

const MATERIAL_TYPES = new Set(["book", "teacher", "student", "answer_key", "test", "workbook", "digital", "supply", "other"]);
const REQUIREMENT_TYPES = new Set(["required", "optional", "choice"]);
const COMPATIBILITY_MODES = new Set(["strict", "flexible"]);
const AUDIENCES = new Set(["family", "student", "teacher", "age_band"]);

const HEADER_ALIASES = {
  approved_alternate_isbns: "acceptable_isbns",
  alternate_isbns: "acceptable_isbns",
  item_number: "publisher_item_number",
  publisher_item_no: "publisher_item_number",
  product_number: "publisher_item_number",
  product_code: "publisher_item_number",
  barcode: "publisher_barcode",
  affiliate_retailer: "affiliate_label",
  edition: "edition_label",
  material: "material_type",
  section: "group_label",
  subject_section: "group_label",
  requirement: "requirement_type",
  used_edition_matching: "compatibility_mode",
  who_needs_it: "audience",
};

function normalizeHeader(value) {
  const key = String(value || "")
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return HEADER_ALIASES[key] || key;
}

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;
  const input = String(text || "").replace(/^\uFEFF/, "");

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        value += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(value);
      value = "";
    } else if (character === "\n") {
      row.push(value.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      value = "";
    } else {
      value += character;
    }
  }

  if (quoted) throw new Error("The CSV contains an unclosed quotation mark.");
  if (value || row.length) {
    row.push(value.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((cell) => String(cell).trim()));
}

function isValidUrl(value) {
  if (!value) return true;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeChoice(value, fallback) {
  return String(value || fallback).trim().toLowerCase().replace(/[\s-]+/g, "_");
}

export function prepareCurriculumImport(text, inventory = []) {
  const parsed = parseCsv(text);
  if (parsed.length === 0) return { rows: [], errors: ["The file is empty."] };

  const headers = parsed[0].map(normalizeHeader);
  if (!headers.includes("title")) {
    return { rows: [], errors: ["The CSV needs a title column."] };
  }

  const duplicateHeaders = headers.filter((header, index) => header && headers.indexOf(header) !== index);
  if (duplicateHeaders.length) {
    return { rows: [], errors: [`Duplicate column: ${duplicateHeaders[0]}.`] };
  }

  const seen = new Map();
  const rows = parsed.slice(1).map((cells, index) => {
    const source = Object.fromEntries(headers.map((header, cellIndex) => [header, String(cells[cellIndex] || "").trim()]));
    const quantity = Number(source.quantity || 1);
    const isbn = normalizeIsbn(source.isbn);
    const acceptableIsbns = String(source.acceptable_isbns || "")
      .split(/[|;]/)
      .map(normalizeIsbn)
      .filter(Boolean);
    const data = {
      title: source.title || "",
      author: source.author || "",
      publisher: source.publisher || "",
      publisher_item_number: normalizePublisherItemNumber(source.publisher_item_number),
      publisher_barcode: String(source.publisher_barcode || "").replace(/\s+/g, ""),
      isbn,
      acceptable_isbns: acceptableIsbns,
      edition_label: source.edition_label || "",
      material_type: normalizeChoice(source.material_type, "book"),
      affiliate_url: source.affiliate_url || "",
      affiliate_label: source.affiliate_label || "",
      group_label: source.group_label || "",
      requirement_type: normalizeChoice(source.requirement_type, "required"),
      compatibility_mode: normalizeChoice(source.compatibility_mode, "strict"),
      audience: normalizeChoice(source.audience, "family"),
      quantity,
      notes: source.notes || "",
    };
    const errors = [];
    const warnings = [];
    const rowNumber = index + 2;

    if (!data.title) errors.push("Title is required.");
    if (source.isbn && ![10, 13].includes(isbn.length)) errors.push("ISBN must contain 10 or 13 characters.");
    if (!MATERIAL_TYPES.has(data.material_type)) errors.push(`Unknown material type: ${data.material_type}.`);
    if (!REQUIREMENT_TYPES.has(data.requirement_type)) errors.push(`Unknown requirement: ${data.requirement_type}.`);
    if (!COMPATIBILITY_MODES.has(data.compatibility_mode)) errors.push(`Unknown matching mode: ${data.compatibility_mode}.`);
    if (!AUDIENCES.has(data.audience)) errors.push(`Unknown audience: ${data.audience}.`);
    if (!Number.isInteger(quantity) || quantity < 1) errors.push("Quantity must be a whole number of at least 1.");
    if (!isValidUrl(data.affiliate_url)) errors.push("Affiliate URL must begin with http:// or https://.");
    if (data.publisher_item_number && !data.publisher) {
      warnings.push("Add a publisher so the publisher item number can be matched safely.");
    }
    if (!isbn) warnings.push("No ISBN; matching will use the publisher item number or title.");
    if (data.material_type === "workbook" || data.material_type === "test") {
      warnings.push("Consumable material; staff should verify that used copies are usable.");
    }

    const duplicateKey = isbn
      ? `isbn:${isbn}`
      : data.publisher && data.publisher_item_number
        ? `publisher:${data.publisher.toLowerCase()}|${data.publisher_item_number.toUpperCase()}`
        : `title:${data.title.toLowerCase()}|${data.edition_label.toLowerCase()}`;
    if (seen.has(duplicateKey)) errors.push(`Duplicates row ${seen.get(duplicateKey)}.`);
    else seen.set(duplicateKey, rowNumber);

    return {
      rowNumber,
      data,
      errors,
      warnings,
      match: findCurriculumInventoryMatch(data, inventory),
    };
  });

  return {
    rows,
    errors: rows.length ? [] : ["The file contains headers but no materials."],
  };
}
