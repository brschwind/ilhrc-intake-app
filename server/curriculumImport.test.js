const test = require("node:test");
const assert = require("node:assert/strict");
const {
  curriculumAnalysisPrompt,
  htmlToCurriculumText,
  isPrivateIpAddress,
  normalizeAnalysisResult,
  validatePublicUrl,
} = require("./curriculumImport");

test("analysis prompt requires exhaustive grade-catalog extraction", () => {
  const prompt = curriculumAnalysisPrompt({
    sourceType: "pdf",
    sourceUrl: "",
    checkedOn: "2026-07-31",
  });
  assert.match(prompt, /entire source/i);
  assert.match(prompt, /Do not stop.*30 items/i);
  assert.match(prompt, /Grade N Materials/i);
  assert.match(prompt, /Deduplicate/i);
});

test("HTML extraction preserves readable labels and absolute product links", () => {
  const text = htmlToCurriculumText(
    '<html><script>ignore me</script><h1>Grade 2</h1><a href="/books/one">Book &amp; One</a></html>',
    "https://publisher.example/package",
  );
  assert.equal(text.includes("ignore me"), false);
  assert.match(text, /Grade 2/);
  assert.match(text, /Book & One \[https:\/\/publisher\.example\/books\/one\]/);
});

test("private and loopback addresses are rejected", () => {
  for (const address of ["127.0.0.1", "10.2.3.4", "172.20.1.1", "192.168.1.1", "::1", "fd00::1"]) {
    assert.equal(isPrivateIpAddress(address), true, address);
  }
  assert.equal(isPrivateIpAddress("93.184.216.34"), false);
});

test("publisher URL validation allows public HTTPS and rejects private DNS", async () => {
  const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];
  const privateLookup = async () => [{ address: "127.0.0.1", family: 4 }];
  assert.equal((await validatePublicUrl("https://publisher.example/package", publicLookup)).hostname, "publisher.example");
  await assert.rejects(validatePublicUrl("http://internal.example", privateLookup), /public publisher/);
});

test("analysis normalization keeps drafts and removes formatted ISBN punctuation", () => {
  const normalized = normalizeAnalysisResult({
    package: { publisher_name: "Publisher", name: "Grade Two", package_type: "grade" },
    materials: [{
      title: "Book",
      publisher: "Abeka",
      publisher_item_number: " 195278 ",
      publisher_barcode: "1952 7806",
      isbn: "978-1-60826-010-2",
      quantity: 1,
      confidence: 0.9,
    }],
    warnings: [],
  }, "https://publisher.example", "2026-07-19");
  assert.equal(normalized.package.status, "draft");
  assert.equal(normalized.package.source_url, "https://publisher.example");
  assert.equal(normalized.materials[0].isbn, "9781608260102");
  assert.equal(normalized.materials[0].publisher_item_number, "195278");
  assert.equal(normalized.materials[0].publisher_barcode, "19527806");
});

test("analysis normalization carries the package publisher onto catalog materials", () => {
  const normalized = normalizeAnalysisResult({
    package: { publisher_name: "Abeka", name: "Grade 1", package_type: "grade" },
    materials: [{ title: "Stepping Stones", publisher_item_number: "195278" }],
    warnings: [],
  }, "", "2026-07-31");
  assert.equal(normalized.materials[0].publisher, "Abeka");
  assert.equal(normalized.materials[0].publisher_item_number, "195278");
});
