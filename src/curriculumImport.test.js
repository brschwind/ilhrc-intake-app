import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { curriculumMaterialsToCsv, deduplicateCurriculumMaterials, parseCsv, prepareCurriculumImport } from "./curriculumImport.js";

const curriculumCatalogSource = readFileSync(new URL("./CurriculumCatalog.jsx", import.meta.url), "utf8");
const curriculumCatalogStyles = readFileSync(new URL("./App.css", import.meta.url), "utf8");
const appSource = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
const publicMatchingMigration = readFileSync(new URL("../supabase/migrations/20260731160000_public_curriculum_matching_fields.sql", import.meta.url), "utf8");

test("CSV parser handles quoted commas and escaped quotation marks", () => {
  assert.deepEqual(parseCsv('title,notes\n"History, Part One","A ""classic"" text"\n'), [
    ["title", "notes"],
    ["History, Part One", 'A "classic" text'],
  ]);
});

test("curriculum import applies defaults and previews inventory matches", () => {
  const preview = prepareCurriculumImport(
    "title,isbn,group_label\nBeta DVD,9781608260102,Instructor Materials\n",
    [{ title: "Beta DVD", isbn: "978-1-60826-010-2", status: "Available", quantity: 1 }],
  );
  assert.equal(preview.errors.length, 0);
  assert.equal(preview.rows[0].data.material_type, "book");
  assert.equal(preview.rows[0].data.requirement_type, "required");
  assert.equal(preview.rows[0].match.status, "exact");
});

test("curriculum import flags invalid values and duplicate ISBNs", () => {
  const preview = prepareCurriculumImport([
    "title,isbn,material_type,quantity",
    "First,9781608260102,video,0",
    "Second,9781608260102,book,1",
  ].join("\n"));
  assert.match(preview.rows[0].errors.join(" "), /Unknown material type/);
  assert.match(preview.rows[0].errors.join(" "), /Quantity/);
  assert.match(preview.rows[1].errors.join(" "), /Duplicates row 2/);
});

test("curriculum import accepts friendly column aliases", () => {
  const preview = prepareCurriculumImport("Title,Section,Edition,Affiliate Retailer,Publisher,Item Number\nBook One,History,Third,Retailer,Abeka,195278\n");
  assert.equal(preview.rows[0].data.group_label, "History");
  assert.equal(preview.rows[0].data.edition_label, "Third");
  assert.equal(preview.rows[0].data.affiliate_label, "Retailer");
  assert.equal(preview.rows[0].data.publisher_item_number, "195278");
});

test("curriculum import matches inventory by hidden publisher item number", () => {
  const preview = prepareCurriculumImport(
    "title,publisher,publisher_item_number\nStepping Stones,Abeka,195278\n",
    [{ title: "Stepping Stones", publisher: "A Beka", publisher_item_number: "195278", quantity: 2 }]
  );
  assert.equal(preview.rows[0].match.status, "publisher");
});

test("curriculum review visibly exposes publisher item numbers", () => {
  assert.match(curriculumCatalogSource, /placeholder="Publisher item #"/);
  assert.match(curriculumCatalogSource, /publisher numbers/);
  assert.match(curriculumCatalogSource, /material\.publisher_item_number/);
});

test("repeated publisher materials are consolidated before review", () => {
  const materials = [
    { title: "1st Grade Writing Tablet — Cursive", publisher: "Abeka", publisher_item_number: "271942" },
    { title: "1st Grade Writing Tablet — Manuscript", publisher: "Abeka", publisher_item_number: "271942" },
    { title: "Writing with Phonics 1", publisher: "Abeka", publisher_item_number: "197041" },
  ];
  const unique = deduplicateCurriculumMaterials(materials);
  assert.deepEqual(unique.map((material) => material.publisher_item_number), ["271942", "197041"]);
});

test("curriculum review offers one-click duplicate cleanup", () => {
  assert.match(curriculumCatalogSource, /Remove duplicate rows/);
  assert.match(curriculumCatalogSource, /removeBulkDuplicateRows/);
});

test("curriculum details show inline store listings and aligned staff actions", () => {
  assert.match(curriculumCatalogSource, /curriculum-store-copy-grid/);
  assert.match(curriculumCatalogSource, /item\.image_url/);
  assert.match(curriculumCatalogSource, /SKU \$\{item\.sku\}/);
  assert.match(curriculumCatalogSource, /curriculum-row-actions/);
  assert.match(curriculumCatalogStyles, /\.curriculum-row-actions\s*\{[^}]*display:\s*flex/s);
});

test("staff can edit curriculum list information and individual materials", () => {
  assert.match(curriculumCatalogSource, /savePackageEdits/);
  assert.match(curriculumCatalogSource, /Edit list information/);
  assert.match(curriculumCatalogSource, /saveMaterialEdits/);
  assert.match(curriculumCatalogSource, /Save item changes/);
  assert.match(curriculumCatalogSource, /Publisher item number/);
});

test("customers can reserve matched books from a curriculum list", () => {
  assert.match(curriculumCatalogSource, /Reserve this copy/);
  assert.match(curriculumCatalogSource, /onReserveBook\(item\)/);
  assert.match(appSource, /onReserveBook=\{openBookReservation\}/);
  assert.match(appSource, /view === "curricula"[\s\S]*renderBookReservationForm\(\)/);
  assert.match(appSource, /LEGACY_PUBLIC_CATALOG_COLUMNS/);
  assert.match(publicMatchingMigration, /item\.publisher_item_number/);
});

test("curriculum printing uses a compact checklist layout", () => {
  assert.match(curriculumCatalogStyles, /@page\s*\{[^}]*margin:\s*0\.4in/s);
  assert.match(curriculumCatalogStyles, /\.curriculum-store-copies,[\s\S]*display:\s*none\s*!important/);
  assert.match(curriculumCatalogStyles, /@media print[\s\S]*\.curriculum-row\s*\{[^}]*padding:\s*4px 0/s);
});

test("AI material records can be converted into the same CSV preview pipeline", () => {
  const csv = curriculumMaterialsToCsv([{
    title: "History, Part One",
    acceptable_isbns: ["9781111111111", "9782222222222"],
    notes: 'Use the "revised" edition.',
  }]);
  const preview = prepareCurriculumImport(csv);
  assert.equal(preview.rows[0].data.title, "History, Part One");
  assert.deepEqual(preview.rows[0].data.acceptable_isbns, ["9781111111111", "9782222222222"]);
  assert.equal(preview.rows[0].data.notes, 'Use the "revised" edition.');
});
