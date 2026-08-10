import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL("../supabase/migrations/20260719040000_event_driven_customer_request_matching.sql", import.meta.url),
  "utf8"
).toLowerCase();
const precisionMigration = readFileSync(
  new URL("../supabase/migrations/20260719050000_tighten_customer_request_matching.sql", import.meta.url),
  "utf8"
).toLowerCase();
const appSource = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");

test("new public or staff requests trigger one full-inventory scan", () => {
  assert.match(migration, /after insert on public\.customer_requests/);
  assert.match(migration, /match_customer_request_inventory\(new\.id, null\)/);
  assert.match(migration, /initial_inventory_scanned_at = now\(\)/);
});

test("new items and quantity increments queue their intake-history arrival", () => {
  assert.match(migration, /after insert on public\.intake_history/);
  assert.match(migration, /unique \(intake_history_id\)/);
  assert.match(migration, /on conflict \(intake_history_id\) do nothing/);
});

test("queued matching is retryable and claims work without blocking another worker", () => {
  assert.match(migration, /for update skip locked/);
  assert.match(migration, /attempts = attempts \+ 1/);
  assert.match(migration, /recovered stale processing lock/);
  assert.match(migration, /set status = 'queued', locked_at = null, last_error/);
});

test("duplicate receipts cannot create duplicate request-item matches", () => {
  assert.match(migration, /unique index[\s\s]*if not exists customer_request_matches_request_item_uidx/i);
  assert.match(migration, /on conflict \(request_id, item_id\) do nothing/);
  assert.match(migration, /select distinct on \(request\.id, history\.item_id\)/);
});

test("only active requests and available inventory match without auto-reservation", () => {
  assert.match(migration, /where request\.status = 'active'/);
  assert.match(migration, /coalesce\(item\.status, 'available'\) in \('available', 'hold'\)/);
  assert.match(migration, /coalesce\(item\.quantity, 0\) > 0/);
  assert.doesNotMatch(migration, /update public\.items/);
  assert.doesNotMatch(migration, /set status = 'hold'/);
});

test("public callers cannot invoke internal matching or read its result", () => {
  assert.match(migration, /revoke all on function public\.match_customer_request_inventory\(uuid, uuid\[\]\) from public, anon, authenticated/);
  assert.doesNotMatch(migration, /grant execute on function public\.run_customer_request_matching\([^)]*\) to anon/);
});

test("manual matching selects the batch-size RPC signature explicitly", () => {
  assert.match(
    appSource,
    /\.rpc\("run_customer_request_matching",\s*\{\s*p_batch_size:\s*500\s*\}\)/
  );
});

test("specific request fields take precedence over broad classification fields", () => {
  assert.match(precisionMigration, /when public\.normalize_request_text\(p_request\.isbn\) <> '' then/);
  assert.match(precisionMigration, /when length\(public\.normalize_request_text\(p_request\.title\)\) >= 4 then/);
  assert.match(precisionMigration, /when public\.normalize_request_text\(p_request\.author\) <> '' then/);
  assert.match(precisionMigration, /when public\.normalize_request_text\(p_request\.curriculum\) <> '' then/);
  assert.match(precisionMigration, /else false/);
});

test("subject or grade alone cannot create a match", () => {
  const candidateFunction = precisionMigration.slice(
    precisionMigration.indexOf("create or replace function public.customer_request_candidate_matches"),
    precisionMigration.indexOf("revoke all on function public.customer_request_candidate_matches")
  );
  assert.doesNotMatch(candidateFunction, /when public\.normalize_request_text\(p_request\.(subject|grade_level)\)/);
  assert.match(candidateFunction, /when public\.normalize_request_text\(p_request\.curriculum\)[\s\S]*and \([\s\S]*p_request\.subject[\s\S]*or[\s\S]*p_request\.grade_level/);
});

test("cleanup removes only unreviewed false positives", () => {
  assert.match(precisionMigration, /match\.status = 'pending'/);
  assert.match(precisionMigration, /not public\.customer_request_candidate_matches\(request, history, item\)/);
  assert.doesNotMatch(precisionMigration, /match\.status in/);
});
