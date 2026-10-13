import test from "node:test";
import assert from "node:assert/strict";
import { formatLabelTitle } from "./labelTitle.js";

test("label titles use a second line instead of cutting off the distinguishing words", () => {
  assert.deepEqual(
    formatLabelTitle("Exploring Geography Quizzes and Answers", 28),
    ["Exploring Geography Quizzes", "and Answers"]
  );
  assert.deepEqual(
    formatLabelTitle("Exploring Geography Part 1", 28),
    ["Exploring Geography Part 1"]
  );
});

test("exceptionally long label titles preserve the beginning and ending", () => {
  assert.deepEqual(
    formatLabelTitle("Exploring Geography Complete Homeschool Course Quizzes Tests and Answer Key", 28),
    ["Exploring Geography Complete", "… Tests and Answer Key"]
  );
});

test("label titles normalize whitespace and provide an untitled fallback", () => {
  assert.deepEqual(formatLabelTitle("  Exploring   Geography  "), ["Exploring Geography"]);
  assert.deepEqual(formatLabelTitle(""), ["Untitled"]);
});
