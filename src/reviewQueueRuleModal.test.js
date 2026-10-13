import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const appSource = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
const appStyles = readFileSync(new URL("./App.css", import.meta.url), "utf8");

test("reviewing a suggested rule opens the rule editor over the review queue", () => {
  const approvalStart = appSource.indexOf("function approveRuleSuggestion(suggestion)");
  const approvalEnd = appSource.indexOf("async function reviewRuleSuggestion", approvalStart);
  const approvalSource = appSource.slice(approvalStart, approvalEnd);

  assert.notEqual(approvalStart, -1, "suggestion approval handler should be present");
  assert.doesNotMatch(approvalSource, /setOptionsSection\("rules"\)/);
  assert.match(appSource, /className=\{optionsSection === "review" \? "intake-rule-backdrop"/);
  assert.match(appSource, /aria-modal=\{optionsSection === "review" \? "true"/);
  assert.match(appSource, /aria-labelledby=\{optionsSection === "review" \? "intake-rule-dialog-title"/);
  assert.match(appStyles, /\.intake-rule-backdrop\s*\{[^}]*position:\s*fixed/s);
  assert.match(appStyles, /\.intake-rule-dialog\s*\{[^}]*max-height:/s);
});

test("the suggested-rule modal can be dismissed without leaving the queue", () => {
  assert.match(appSource, /if \(event\.key === "Escape"\) resetIntakeRuleDraft\(\)/);
  assert.match(appSource, /aria-label="Close create rule" onClick=\{resetIntakeRuleDraft\}/);
  assert.match(appSource, /onMouseDown=\{optionsSection === "review" \? resetIntakeRuleDraft : undefined\}/);
});
