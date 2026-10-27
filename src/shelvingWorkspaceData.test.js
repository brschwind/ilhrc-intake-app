import test from "node:test";
import assert from "node:assert/strict";
import { loadAllLocationStock, loadShelvingWorkspace, loadShelfBooks } from "./shelvingWorkspaceData.js";
function fixture(stock, failOffset = -1) {
  const ranges = [];
  const client = { from(table) {
    let ids = [], offset = 0;
    const query = {
      select() { return query; }, eq() { return query; }, gt() { return query; }, order() { return query; }, limit() { return query; },
      in(_key, values) { ids = values; return query; },
      range(first, last) { offset = first; ranges.push([first, last]); return Promise.resolve(first === failOffset ? { error: new Error("offline") } : { data: stock.slice(first, last + 1), error: null }); },
      then(resolve, reject) {
        const data = table === "inventory_locations" ? [{ id: "processing", code: "PROCESSING" }] : table === "inventory_events" ? [] : ids.map(id => ({ id, title: "Book " + id, sku: "SKU-" + id }));
        return Promise.resolve({ data, error: offset === failOffset ? new Error("offline") : null }).then(resolve, reject);
      },
    }; return query;
  } }; return { client, ranges };
}
test("stock beyond the first 1000 rows contributes to Processing queue", async () => {
  const stock = Array.from({ length: 1210 }, (_, i) => ({ item_id: String(i), location_id: "legacy", code: "UNVERIFIED_LEGACY", quantity: 1 }));
  stock.push({ item_id: "recent-book", location_id: "processing", code: "PROCESSING", quantity: 3 });
  const { client, ranges } = fixture(stock);
  const result = await loadShelvingWorkspace(client);
  assert.equal(result.stock.length, 1211);
  assert.equal(result.stock.filter(row => row.code === "PROCESSING").reduce((sum, row) => sum + row.quantity, 0), 3);
  assert.equal(result.queueItems[0].id, "recent-book");
  assert.deepEqual(ranges, [[0,499],[500,999],[1000,1499]]);
});
test("exact page boundaries fetch the final empty page", async () => {
  const { client, ranges } = fixture(Array.from({ length: 1000 }, (_, i) => ({ item_id: i })));
  assert.equal((await loadAllLocationStock(client)).length, 1000);
  assert.equal(ranges.length, 3);
});
test("a later-page failure rejects rather than reporting a misleading partial queue", async () => {
  const { client } = fixture(Array.from({ length: 1000 }, (_, i) => ({ item_id: i })), 500);
  await assert.rejects(loadAllLocationStock(client), /offline/);
});
test("empty stock remains a valid loaded queue", async () => {
  const { client } = fixture([]);
  const result = await loadShelvingWorkspace(client);
  assert.deepEqual(result.stock, []); assert.deepEqual(result.queueItems, []);
});

test("shelf browser loads every book in batches and preserves copy counts", async () => {
  const stock = Array.from({length: 450}, (_, i) => ({item_id: String(i),location_id:"A1",quantity: i + 1}));
  stock.push({item_id:"other", location_id:"A2", quantity:99});
  const {client}=fixture(stock);
  const books=await loadShelfBooks(client, stock, "A1");
  assert.equal(books.length,450);
  assert.equal(books.find(book=>book.id==="449").quantity,450);
  assert.ok(books.every(book=>book.sku));
  assert.ok(!books.some(book=>book.id==="other"));
});
