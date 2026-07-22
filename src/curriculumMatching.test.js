import test from "node:test";
import assert from "node:assert/strict";
import { findCurriculumInventoryMatch, normalizeIsbn } from "./curriculumMatching.js";

test("normalizes formatted ISBNs", () => {
  assert.equal(normalizeIsbn("978-1-2345-6789-7"), "9781234567897");
});
test("prefers a primary ISBN match over an approved alternative", () => {
  const material = { title: "A Reader", isbn: "111", acceptable_isbns: ["222"] };
  const inventory = [
    { id: "alternative", isbn: "222", title: "A Reader", quantity: 1 },
    { id: "exact", isbn: "111", title: "A Reader", quantity: 1 },
  ];
  assert.deepEqual(findCurriculumInventoryMatch(material, inventory), {
    status: "exact",
    item: inventory[1],
  });
});

test("uses an explicitly approved alternate ISBN", () => {
  const material = { title: "A Reader", isbn: "111", acceptable_isbns: ["222"] };
  const inventory = [{ id: "alternative", isbn: "222", title: "A Reader", quantity: 1 }];
  assert.equal(findCurriculumInventoryMatch(material, inventory).status, "approved");
});

test("matches a publisher item number only for the same publisher", () => {
  const material = {
    title: "Stepping Stones",
    publisher: "Abeka",
    publisher_item_number: "195278",
  };
  const inventory = [
    { title: "Other", publisher: "Another Publisher", publisher_item_number: "195278", quantity: 1 },
    { title: "Stepping Stones", publisher: "A Beka", publisher_item_number: "195278", quantity: 1 },
  ];
  assert.equal(findCurriculumInventoryMatch(material, inventory).status, "publisher");
  assert.equal(findCurriculumInventoryMatch(material, inventory).item, inventory[1]);
});

test("returns a possible match for the same title when ISBN is unavailable", () => {
  const material = { title: "  The Story Book! ", author: "A. Writer", isbn: "111" };
  const inventory = [{ title: "The Story Book", author: "A Writer", quantity: 1 }];
  assert.equal(findCurriculumInventoryMatch(material, inventory).status, "possible");
});

test("ignores inventory with no available copies", () => {
  const material = { title: "A Reader", isbn: "111" };
  const inventory = [{ title: "A Reader", isbn: "111", quantity: 0 }];
  assert.equal(findCurriculumInventoryMatch(material, inventory).status, "missing");
});
