import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const appSource = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
const appStyles = readFileSync(new URL("./App.css", import.meta.url), "utf8");

test("inventory selection offers retroactive bundle creation", () => {
  assert.match(appSource, /async function startInventoryBundle\(\)/);
  assert.match(appSource, />\s*Create Bundle\s*</);
  assert.match(appSource, /Pieces in set/);
  assert.match(appSource, /materializeInventoryBundleComponents/);
  assert.match(appSource, /update-square-inventory/);
});

test("inventory and curriculum workflows can create and split bundles", () => {
  assert.match(appSource, /Add \{selectedItemIds\.length\} items to a curriculum list/);
  assert.match(appSource, /async function startCurriculumBundle/);
  assert.match(appSource, /bundle_quantity:\s*1/);
  assert.match(appSource, /Split Bundle into Individual Listings/);
});

test("intake supports camera and hardware publisher scans", () => {
  assert.match(appSource, /Scan Publisher Number/);
  assert.match(appSource, /Camera or Symbol scanner/);
  assert.match(appSource, /async function capturePublisherBarcode/);
  assert.match(appSource, /handleScannerButtonKeyDown/);
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

test("inventory selection is always available with actions outside the filter sidebar", () => {
  assert.match(appStyles, /\.card \.item-select\s*\{[^}]*display:\s*inline-flex/s);
  assert.match(appSource, /className="inventory-grid selection-mode"/);
  assert.match(appSource, /className="inventory-selection-bar"/);
  assert.match(appSource, /className="inventory-action-dialog"/);
  assert.doesNotMatch(appSource, /Exit Selection|Select Items/);
  const sidebarStart = appSource.indexOf('className={`inventory-sidebar');
  const sidebarEnd = appSource.indexOf("</aside>", sidebarStart);
  const sidebarSource = appSource.slice(sidebarStart, sidebarEnd);
  assert.doesNotMatch(sidebarSource, /Add to Print Queue|Bulk Edit|Apply to Selected/);
});

test("inventory selection queues labels instead of generating a PDF immediately", () => {
  assert.match(appSource, /Add to Print Queue/);
  assert.match(appSource, /addSelectedToPrintQueue/);
  assert.match(appSource, /Remove from Queue/);
  assert.match(appSource, /Remove Visible from Queue/);
});
