import test from "node:test";
import assert from "node:assert/strict";
import {
  getKnownAbekaProduct,
  getKnownPublisherProduct,
  identifyBookBarcode,
  inferPublisherItemNumber,
  normalizeBarcode,
  publisherIdentifiersMatch,
} from "./barcodeIdentification.js";

test("recognizes an Abeka barcode and separates its product number", () => {
  assert.deepEqual(identifyBookBarcode("19527806"), {
    type: "publisher",
    raw: "19527806",
    publisher: "Abeka",
    publisherItemNumber: "195278",
    publisherBarcode: "19527806",
    abekaItemNumber: "195278",
    barcodeSuffix: "06",
  });
});

test("extracts the item number from each photographed Abeka barcode", () => {
  assert.deepEqual(
    ["19522707", "19525107", "19527806"].map(
      (barcode) => identifyBookBarcode(barcode).abekaItemNumber
    ),
    ["195227", "195251", "195278"]
  );
});

test("continues to recognize ISBN-10 and ISBN-13 values", () => {
  assert.equal(identifyBookBarcode("978-1-60826-010-2").type, "isbn");
  assert.equal(identifyBookBarcode("0-306-40615-2").isbn, "0306406152");
});

test("does not silently treat other lengths as an ISBN or Abeka code", () => {
  assert.equal(identifyBookBarcode("1234567").type, "unknown");
  assert.equal(identifyBookBarcode("87654321").type, "unknown");
});

test("normalizes scanner whitespace", () => {
  assert.equal(normalizeBarcode(" 1952 7806\n"), "19527806");
});

test("includes the confirmed Abeka title and edition mappings", () => {
  assert.deepEqual(getKnownAbekaProduct("195227"), {
    title: "Fun with Pets",
    edition: "Second",
  });
  assert.equal(getKnownPublisherProduct("A Beka", "195227").title, "Fun with Pets");
  assert.equal(getKnownPublisherProduct("Abeka", "195227").title, "Fun with Pets");
});

test("publisher item numbers match only within the same publisher", () => {
  const abeka = { publisher: "Abeka", publisher_item_number: " 195278 " };
  assert.equal(publisherIdentifiersMatch(abeka, {
    publisher: "ABEKA",
    publisher_item_number: "195278",
  }), true);
  assert.equal(publisherIdentifiersMatch(abeka, {
    publisher: "The Good and the Beautiful",
    publisher_item_number: "195278",
  }), false);
});

test("an unknown Abeka barcode can be interpreted after cover analysis identifies the publisher", () => {
  assert.equal(inferPublisherItemNumber("A Beka", "87654321"), "876543");
  assert.equal(inferPublisherItemNumber("Another Publisher", "87654321"), "");
});
