import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const appSource = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
const appStyles = readFileSync(new URL("./App.css", import.meta.url), "utf8");

test("inventory selection offers retroactive bundle creation", () => {
  assert.match(appSource, /async function startInventoryBundle\(\)/);
  assert.match(
    appSource,
    /Create Bundle from \{selectedItemIds\.length\} Selected/
  );
  assert.match(appSource, /Pieces in set/);
  assert.match(appSource, /materializeInventoryBundleComponents/);
  assert.match(appSource, /update-square-inventory/);
});

test("the intake screen does not contain a Location control", () => {
  const intakeStart = appSource.indexOf(
    'isAuthenticated && view === "add" && ('
  );
  const inventoryStart = appSource.indexOf(
    'isAuthenticated && view === "inventory" && (',
    intakeStart
  );

  assert.notEqual(intakeStart, -1, "intake screen block should be present");
  assert.notEqual(inventoryStart, -1, "inventory screen block should be present");

  const intakeScreen = appSource.slice(intakeStart, inventoryStart);
  assert.doesNotMatch(intakeScreen, /currentLocation/);
  assert.doesNotMatch(intakeScreen, /<label[^>]*>\s*Location\s*<\/label>/);
});

test("inventory selection controls remain reachable and aligned", () => {
  assert.match(
    appStyles,
    /\.inventory-sidebar\s*\{[^}]*max-height:[^}]*overflow-y:\s*auto/s
  );
  assert.match(appStyles, /\.card \.item-select\s*\{[^}]*display:\s*inline-flex/s);
  assert.match(appStyles, /\.selection-bundle-action\s*\{[^}]*width:\s*100%/s);
});
