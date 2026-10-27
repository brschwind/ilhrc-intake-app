import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
const start = source.indexOf("  async function saveAndNext()");
const handler = source.slice(start, source.indexOf("  function startEditing(item)", start));

async function run(saved) {
  const calls = [];
  const execute = new Function("saveItem", "requestAnimationFrame", "window", "intakeScanButtonRef", "setIntakeDetailsOpen", "scanBarcode",
    handler + "return saveAndNext();");
  await execute(async () => saved, (callback) => callback(), { scrollTo: (value) => calls.push(["scroll", value]) },
    { current: { focus: (value) => calls.push(["focus", value]) } }, (value) => calls.push(["edit", value]), (target) => calls.push(["scan", target]));
  return calls;
}
test("Save & Next advances and reopens barcode scanner only after confirmed success", async () => {
  assert.deepEqual(await run(true), [["edit", false], ["scroll", { top: 0, behavior: "auto" }], ["focus", { preventScroll: true }], ["scan", "book"]]);
});
test("cancelled or failed saves keep the current editing position", async () => {
  assert.deepEqual(await run(undefined), []);
  assert.deepEqual(await run(false), []);
});
