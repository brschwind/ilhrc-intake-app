import test from "node:test";
import assert from "node:assert/strict";
import { curriculumMaterialsToCsv, parseCsv, prepareCurriculumImport } from "./curriculumImport.js";

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

test("curriculum import matches inventory by publisher item number", () => {
  const preview = prepareCurriculumImport(
    "title,publisher,publisher_item_number\nStepping Stones,Abeka,195278\n",
    [{ title: "Stepping Stones", publisher: "A Beka", publisher_item_number: "195278", quantity: 2 }]
  );
  assert.equal(preview.rows[0].match.status, "publisher");
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
