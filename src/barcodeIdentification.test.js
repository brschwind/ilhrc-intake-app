import test from "node:test";
import assert from "node:assert/strict";
import {
  identifyBookBarcode,
  inferPublisherItemNumber,
  normalizeBarcode,
} from "./barcodeIdentification.js";

test("recognizes ISBN-10 and ISBN-13 values", () => {
  assert.equal(identifyBookBarcode("0-306-40615-2").type, "isbn");
  assert.equal(identifyBookBarcode("978-1-60826-010-2").type, "isbn");
});

test("recognizes an eight-digit publisher barcode and its Abeka item-number candidate", () => {
  assert.deepEqual(identifyBookBarcode("19527806"), {
    type: "publisher",
    raw: "19527806",
    publisherBarcode: "19527806",
    publisherItemNumber: "195278",
    barcodeSuffix: "06",
  });
});

test("requires a valid ISBN checksum instead of classifying by length alone", () => {
  assert.equal(identifyBookBarcode("9781608260102").type, "isbn");
  assert.equal(identifyBookBarcode("9781608260103").type, "unknown");
});

test("infers an Abeka item number only after the publisher is known", () => {
  assert.equal(inferPublisherItemNumber("A Beka", "87654321"), "876543");
  assert.equal(inferPublisherItemNumber("Another Publisher", "87654321"), "");
});

test("normalizes scanner whitespace", () => {
  assert.equal(normalizeBarcode("  9781608260102 \n"), "9781608260102");
});
