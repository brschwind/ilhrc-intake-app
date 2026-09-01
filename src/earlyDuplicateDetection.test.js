import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const appSource = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");

test("ISBN scans check inventory before external book lookups", () => {
  const lookup = appSource.match(
    /async function lookupBookByIsbn\(isbn\) \{[\s\S]*?\n\}/
  )?.[0] || "";

  const duplicateCheckIndex = lookup.indexOf("detectEarlyIsbnDuplicate");
  const googleLookupIndex = lookup.indexOf("googleapis.com/books");

  assert.ok(duplicateCheckIndex >= 0, "ISBN lookup should check inventory");
  assert.ok(googleLookupIndex >= 0, "ISBN lookup should retain its external metadata fallback");
  assert.ok(duplicateCheckIndex < googleLookupIndex, "inventory should be checked first");
  assert.match(lookup, /confidence: "Existing inventory ISBN match"/);
});

test("cover analysis checks a detected ISBN immediately", () => {
  assert.match(
    appSource,
    /const analyzedBook = await applyRulesToImportedBook\([\s\S]*?setBookData\(analyzedBook\);[\s\S]*?detectEarlyIsbnDuplicate\(analyzedBook\)/
  );
});

test("early duplicate notice requires an intake choice and reuses it during save", () => {
  assert.match(appSource, />\s*Existing ISBN found\s*</);
  assert.match(appSource, />\s*Add to Existing Listing\s*</);
  assert.match(appSource, />\s*Create Separate Listing\s*</);
  assert.match(appSource, /earlyDuplicateAction === "merge"[\s\S]*?findAvailableIsbnDuplicate\(normalizedDraftIsbn, itemDraft\.title\)/);
  assert.match(appSource, /earlyDuplicateAction === "separate"[\s\S]*?exactIsbnMatchDeclined = true/);
  assert.match(
    appSource,
    /if \(!existingItem && !exactIsbnMatchDeclined && normalizedDraftIsbn\.length >= 10\)/
  );
});
