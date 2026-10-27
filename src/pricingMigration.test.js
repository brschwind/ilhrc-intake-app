import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
test('category migration preserves all prices and quantities, retains legacy formats, and is repeatable',async()=>{
  const db=new PGlite();
  try {
    await db.exec(`create table items(id text primary key,category text,final_price numeric,quantity int);
    create table category_options(id bigserial primary key,name text,default_price numeric);
    create table intake_rules(id int primary key,actions jsonb,conditions jsonb);
    insert into items values ('a','Picture Book',4,2),('b','Textbook',0,3),('c','Workbook',null,1),('d','',7,0);
    insert into category_options(name,default_price) values ('Textbook',10);
    insert into intake_rules values(1,'{"category":"Textbook","final_price":"5"}','[{"field":"title","operator":"equals","value":"Math"}]');`);
    const sql=await readFile(new URL('../supabase/migrations/20261027210000_simplify_pricing_categories.sql',import.meta.url),'utf8');
    await db.exec(sql);await db.exec(sql);
    const rows=(await db.query('select * from items order by id')).rows;
    assert.deepEqual(rows.map(r=>r.category),['Reading Book','Student Text','Workbook & Tests','']);
    assert.deepEqual(rows.map(r=>r.final_price),['4','0',null,'7']);
    assert.deepEqual(rows.map(r=>r.quantity),[2,3,1,0]);
    assert.equal(rows[0].legacy_pricing_category,'Picture Book');
    assert.equal((await db.query('select count(*)::int as n from category_options where active')).rows[0].n,8);
    assert.deepEqual((await db.query('select actions from intake_rules')).rows[0].actions,{category:'Student Text',final_price:'5'});
  } finally {await db.close();}
});
