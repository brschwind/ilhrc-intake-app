const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { PGlite } = require("@electric-sql/pglite");

const migration = readFileSync(
  resolve(__dirname, "../supabase/migrations/20260814140000_square_sales_ledger.sql"),
  "utf8"
);

test("Square sales ledger backfills cumulative sold copies idempotently", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role;
      create table public.items (
        id text primary key,
        square_variation_id text,
        status text,
        updated_at timestamptz
      );
      insert into public.items values
        ('item-1', 'variation-1', 'Available', now()),
        ('item-2', 'variation-2', 'Sold', now());
    `);
    await db.exec(migration);

    const orders = JSON.stringify([{
      order_id: "order-1",
      closed_at: "2026-08-14T18:00:00Z",
      lines: [
        { line_uid: "line-1", catalog_object_id: "variation-1", quantity: 2 },
        { line_uid: "line-2", catalog_object_id: "unlinked", quantity: 5 },
      ],
    }]).replaceAll("'", "''");

    await db.exec(`select public.record_square_order_sales('${orders}'::jsonb);`);
    await db.exec(`select public.record_square_order_sales('${orders}'::jsonb);`);

    let result = await db.query(`
      select id, sold_quantity from public.items order by id
    `);
    assert.deepEqual(result.rows, [
      { id: "item-1", sold_quantity: 2 },
      { id: "item-2", sold_quantity: 0 },
    ]);

    const correctedOrders = JSON.stringify([{
      order_id: "order-1",
      closed_at: "2026-08-14T18:00:00Z",
      lines: [{ line_uid: "line-1", catalog_object_id: "variation-1", quantity: 3 }],
    }]).replaceAll("'", "''");
    await db.exec(`select public.record_square_order_sales('${correctedOrders}'::jsonb);`);

    result = await db.query(`select sold_quantity from public.items where id = 'item-1'`);
    assert.equal(result.rows[0].sold_quantity, 3);
    const sales = await db.query(`select count(*)::integer as count from public.square_order_sales`);
    assert.equal(sales.rows[0].count, 1);
  } finally {
    await db.close();
  }
});
