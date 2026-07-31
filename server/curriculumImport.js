const dns = require("node:dns").promises;
const net = require("node:net");

const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
const MAX_SOURCE_TEXT = 120_000;

const PACKAGE_TYPES = ["grade", "subject", "family", "unit", "age_band", "student", "custom"];
const MATERIAL_TYPES = ["book", "teacher", "student", "answer_key", "test", "workbook", "digital", "supply", "other"];
const REQUIREMENT_TYPES = ["required", "optional", "choice"];
const COMPATIBILITY_MODES = ["strict", "flexible"];
const AUDIENCES = ["family", "student", "teacher", "age_band"];

const curriculumAnalysisSchema = {
  type: "object",
  additionalProperties: false,
  required: ["package", "materials", "excluded_offers", "warnings"],
  properties: {
    package: {
      type: "object",
      additionalProperties: false,
      required: ["publisher_name", "name", "package_type", "grade_level", "subject", "edition_label", "description", "source_url"],
      properties: {
        publisher_name: { type: "string" },
        name: { type: "string" },
        package_type: { type: "string", enum: PACKAGE_TYPES },
        grade_level: { type: "string" },
        subject: { type: "string" },
        edition_label: { type: "string" },
        description: { type: "string" },
        source_url: { type: "string" },
      },
    },
    materials: {
      type: "array",
      maxItems: 150,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "title", "author", "publisher", "publisher_item_number", "publisher_barcode",
          "isbn", "acceptable_isbns", "edition_label",
          "material_type", "affiliate_url", "affiliate_label", "group_label",
          "requirement_type", "compatibility_mode", "audience", "quantity", "notes",
          "confidence", "review_reason",
        ],
        properties: {
          title: { type: "string" },
          author: { type: "string" },
          publisher: { type: "string" },
          publisher_item_number: { type: "string" },
          publisher_barcode: { type: "string" },
          isbn: { type: "string" },
          acceptable_isbns: { type: "array", items: { type: "string" }, maxItems: 10 },
          edition_label: { type: "string" },
          material_type: { type: "string", enum: MATERIAL_TYPES },
          affiliate_url: { type: "string" },
          affiliate_label: { type: "string" },
          group_label: { type: "string" },
          requirement_type: { type: "string", enum: REQUIREMENT_TYPES },
          compatibility_mode: { type: "string", enum: COMPATIBILITY_MODES },
          audience: { type: "string", enum: AUDIENCES },
          quantity: { type: "integer", minimum: 1, maximum: 20 },
          notes: { type: "string" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          review_reason: { type: "string" },
        },
      },
    },
    excluded_offers: {
      type: "array",
      maxItems: 75,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "publisher_item_number", "reason"],
        properties: {
          title: { type: "string" },
          publisher_item_number: { type: "string" },
          reason: { type: "string" },
        },
      },
    },
    warnings: { type: "array", items: { type: "string" }, maxItems: 30 },
  },
};

function decodeHtmlEntities(text) {
  const named = { amp: "&", apos: "'", gt: ">", lt: "<", nbsp: " ", quot: '"' };
  return String(text || "").replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity) => {
    if (entity[0] === "#") {
      const hexadecimal = entity[1]?.toLowerCase() === "x";
      const value = Number.parseInt(entity.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
      return Number.isFinite(value) ? String.fromCodePoint(value) : match;
    }
    return named[entity.toLowerCase()] ?? match;
  });
}

function htmlToCurriculumText(html, baseUrl) {
  let source = String(html || "")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template)[^>]*>[\s\S]*?<\/\1>/gi, " ");

  source = source.replace(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_match, href, label) => {
    let resolved;
    try {
      resolved = new URL(href, baseUrl).href;
    } catch {
      resolved = "";
    }
    const cleanLabel = decodeHtmlEntities(label.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    return resolved ? ` ${cleanLabel} [${resolved}] ` : ` ${cleanLabel} `;
  });

  return decodeHtmlEntities(
    source
      .replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6]|\/section|\/article)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim()
    .slice(0, MAX_SOURCE_TEXT);
}

function isPrivateIpAddress(address) {
  if (!net.isIP(address)) return true;
  const normalized = address.toLowerCase();
  if (net.isIPv6(normalized)) {
    if (normalized === "::" || normalized === "::1") return true;
    if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
    if (/^fe[89ab]/.test(normalized)) return true;
    const mapped = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return mapped ? isPrivateIpAddress(mapped[1]) : false;
  }

  const [first, second] = normalized.split(".").map(Number);
  return first === 0 || first === 10 || first === 127 || first >= 224 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19));
}

async function validatePublicUrl(value, lookup = dns.lookup) {
  const url = new URL(String(value || "").trim());
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Use an http:// or https:// publisher link.");
  if (url.username || url.password) throw new Error("Publisher links cannot contain a username or password.");
  if (["localhost", "localhost.localdomain"].includes(url.hostname.toLowerCase())) throw new Error("Use a public publisher website.");

  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((entry) => isPrivateIpAddress(entry.address))) {
    throw new Error("Use a public publisher website.");
  }
  return url;
}

async function readLimitedBody(response, maxBytes = MAX_SOURCE_BYTES) {
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > maxBytes) throw new Error("That source is too large. Please upload a smaller PDF or paste the relevant text.");
  const reader = response.body?.getReader();
  if (!reader) return Buffer.from(await response.arrayBuffer());
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error("That source is too large. Please upload a smaller PDF or paste the relevant text.");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

async function fetchPublicCurriculumSource(value, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const lookup = options.lookup || dns.lookup;
  let currentUrl = await validatePublicUrl(value, lookup);

  for (let redirect = 0; redirect <= 3; redirect += 1) {
    const response = await fetchImpl(currentUrl, {
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
      headers: {
        Accept: "text/html,application/xhtml+xml,text/plain,application/pdf;q=0.9",
        "User-Agent": "ILHRC-Curriculum-Importer/1.0",
      },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location || redirect === 3) throw new Error("The publisher link redirected too many times.");
      currentUrl = await validatePublicUrl(new URL(location, currentUrl).href, lookup);
      continue;
    }
    if (!response.ok) throw new Error(`The publisher page returned ${response.status}. Try pasted text or a PDF instead.`);
    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    const body = await readLimitedBody(response);
    if (contentType.includes("application/pdf") || body.subarray(0, 4).toString() === "%PDF") {
      return { kind: "pdf", buffer: body, filename: "publisher-curriculum.pdf", url: currentUrl.href };
    }
    if (!contentType.includes("text/html") && !contentType.includes("text/plain") && !contentType.includes("application/xhtml+xml")) {
      throw new Error("That link is not a readable webpage or PDF.");
    }
    const text = contentType.includes("text/html") || contentType.includes("application/xhtml+xml")
      ? htmlToCurriculumText(body.toString("utf8"), currentUrl.href)
      : body.toString("utf8").slice(0, MAX_SOURCE_TEXT);
    if (text.length < 80) throw new Error("The publisher page did not expose enough readable text. Try pasted text or a PDF instead.");
    return { kind: "text", text, url: currentUrl.href };
  }
  throw new Error("Could not read that publisher link.");
}

function curriculumAnalysisPrompt({ sourceType, sourceUrl, checkedOn }) {
  return `Role: You organize homeschool curriculum publisher information for a used bookstore.

Goal: Extract one curriculum package and its complete, exhaustive material list from the supplied ${sourceType} source.

Success criteria:
- Identify the publisher, package name, grade or level, subject, edition, and package type.
- List every clearly included or required book, teacher item, student item, digital item, test, workbook, or supply.
- Read the entire source, including every continued materials page. Do not stop after the first kit, package summary, subject, page, or 30 items.
- When a grade catalog contains several enrollment or kit summaries followed by a detailed "Grade N Materials" section, create one grade-level master list from the detailed materials section. Include every distinct, individually listed material there; do not add enrollment plans or kit SKUs as books.
- Put every Student Kit, Parent Kit, Essential Parent Kit, Full-Grade Book Kit, Single-Subject Book Kit, Video Enrollment, Video Instruction, or other bundled purchase offer in excluded_offers, never in materials.
- Use the bullet contents beneath a kit only to identify its individual books and materials. Add those components to materials when the source names them clearly, but do not copy the kit SKU onto a component. If a component has no individual item number, leave publisher_item_number empty and explain that in review_reason.
- A title containing "Kit" is a package offer for this bookstore workflow, even when it is sold as a physical product. Exclude it rather than treating it as a book or supply.
- Prefer the most detailed item listing when the same material also appears in a kit summary. Deduplicate those repeated summary mentions, but keep genuinely different bound, unbound, student, teacher, test, answer-key, print, and digital versions as separate materials.
- Make generic labels unambiguous from their surrounding heading. For example, use "Letters and Sounds 1 Teacher Key" rather than the bare title "Teacher Key."
- Preserve exact titles, ISBNs, publisher item numbers, barcodes, editions, and product URLs when the source provides them.
- Distinguish required, optional, and choose-one materials.
- Put uncertainty in review_reason and package-wide concerns in warnings.

Constraints:
- Use only the supplied source. Do not fill gaps from memory.
- For a publisher link, the extracted page text may be incomplete. Use web search only to inspect the exact source URL and directly related pages on the same publisher domain. Do not use reseller, blog, or marketplace lists.
- Never invent an ISBN, edition, author, URL, or package component.
- Publisher catalog or item numbers are not ISBNs or full barcodes. Put them in publisher_item_number so a future back-cover scan can match the material. For Abeka, this is normally the six-digit number printed before the title.
- Use an empty string when a field is unknown.
- Use strict compatibility when an edition-specific ISBN or teacher/student pairing matters; otherwise use flexible.
- A consumable workbook or test should say that staff must verify a used copy is usable.
- source_url should be ${sourceUrl ? JSON.stringify(sourceUrl) : "an empty string"}.
- The source was checked on ${checkedOn}.

Output only the requested structured package data.`;
}

function normalizeAnalysisResult(result, sourceUrl, checkedOn) {
  const clean = (value, max = 1000) => String(value || "").trim().slice(0, max);
  const normalizeIsbn = (value) => clean(value, 30).toUpperCase().replace(/[^0-9X]/g, "");
  const normalized = {
    package: {
      publisher_name: clean(result.package?.publisher_name, 200),
      name: clean(result.package?.name, 300),
      package_type: PACKAGE_TYPES.includes(result.package?.package_type) ? result.package.package_type : "custom",
      grade_level: clean(result.package?.grade_level, 100),
      subject: clean(result.package?.subject, 150),
      edition_label: clean(result.package?.edition_label, 150),
      description: clean(result.package?.description, 2000),
      source_url: sourceUrl || clean(result.package?.source_url, 2000),
      source_checked_on: checkedOn,
      status: "draft",
    },
    materials: (Array.isArray(result.materials) ? result.materials : []).slice(0, 150).map((item) => ({
      title: clean(item.title, 500),
      author: clean(item.author, 300),
      publisher: clean(item.publisher, 300) || clean(result.package?.publisher_name, 300),
      publisher_item_number: clean(item.publisher_item_number, 100).replace(/\s+/g, ""),
      publisher_barcode: clean(item.publisher_barcode, 200).replace(/\s+/g, ""),
      isbn: normalizeIsbn(item.isbn),
      acceptable_isbns: (Array.isArray(item.acceptable_isbns) ? item.acceptable_isbns : []).map(normalizeIsbn).filter(Boolean).slice(0, 10),
      edition_label: clean(item.edition_label, 200),
      material_type: MATERIAL_TYPES.includes(item.material_type) ? item.material_type : "book",
      affiliate_url: clean(item.affiliate_url, 2000),
      affiliate_label: clean(item.affiliate_label, 200),
      group_label: clean(item.group_label, 200),
      requirement_type: REQUIREMENT_TYPES.includes(item.requirement_type) ? item.requirement_type : "required",
      compatibility_mode: COMPATIBILITY_MODES.includes(item.compatibility_mode) ? item.compatibility_mode : "strict",
      audience: AUDIENCES.includes(item.audience) ? item.audience : "family",
      quantity: Number.isInteger(item.quantity) && item.quantity > 0 ? Math.min(item.quantity, 20) : 1,
      notes: clean(item.notes, 1000),
      confidence: Math.max(0, Math.min(1, Number(item.confidence) || 0)),
      review_reason: clean(item.review_reason, 1000),
    })).filter((item) => item.title),
    excluded_offers: (Array.isArray(result.excluded_offers) ? result.excluded_offers : []).slice(0, 75).map((offer) => ({
      title: clean(offer.title, 500),
      publisher_item_number: clean(offer.publisher_item_number, 100).replace(/\s+/g, ""),
      reason: clean(offer.reason, 500) || "Package offer",
    })).filter((offer) => offer.title),
    warnings: (Array.isArray(result.warnings) ? result.warnings : []).map((warning) => clean(warning, 1000)).filter(Boolean).slice(0, 30),
  };

  const packageOffers = normalized.materials.filter((item) => isCurriculumPackageOffer(item.title));
  normalized.materials = normalized.materials.filter((item) => !isCurriculumPackageOffer(item.title));
  normalized.excluded_offers.push(...packageOffers.map((item) => ({
    title: item.title,
    publisher_item_number: item.publisher_item_number,
    reason: "Kit, enrollment, or bundled purchase offer",
  })));
  const seenOffers = new Set();
  normalized.excluded_offers = normalized.excluded_offers.filter((offer) => {
    const key = offer.publisher_item_number
      ? `number:${offer.publisher_item_number}`
      : `title:${offer.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}`;
    if (seenOffers.has(key)) return false;
    seenOffers.add(key);
    return true;
  });
  return normalized;
}

function isCurriculumPackageOffer(title) {
  const normalized = String(title || "").toLowerCase().replace(/[–—]/g, "-").replace(/\s+/g, " ").trim();
  return /\bkit\b/.test(normalized) ||
    /\bvideo (?:enrollment|instruction)\b/.test(normalized) ||
    /\bfull-grade video(?: enrollment| & books)\b/.test(normalized);
}

module.exports = {
  MAX_SOURCE_TEXT,
  curriculumAnalysisPrompt,
  curriculumAnalysisSchema,
  fetchPublicCurriculumSource,
  htmlToCurriculumText,
  isPrivateIpAddress,
  isCurriculumPackageOffer,
  normalizeAnalysisResult,
  validatePublicUrl,
};
