import test from 'node:test';import assert from 'node:assert/strict';import {PGlite}from'@electric-sql/pglite';import{readFile}from'node:fs/promises';import{shelfGroup,shelfGroups}from'./shelfPicker.js';
test('shelf letters and special locations form compact groups',()=>{
const locations=[{code:'Q6',location_type:'shelf'},{code:'A1',location_type:'shelf'},{code:'A6',location_type:'shelf'},{code:'DISPLAY',location_type:'display'}];
assert.deepEqual(shelfGroups(locations),['A','Q','other']);assert.equal(shelfGroup(locations[0]),'Q');assert.equal(shelfGroup(locations[3]),'other');
});
test('A1-Q6 setup adds only missing shelves and is repeatable',async()=>{
const db=new PGlite();try{
await db.exec(`create table inventory_locations(id uuid primary key default gen_random_uuid(),code text unique,display_name text,location_type text,active boolean default true);
insert into inventory_locations(code,display_name,location_type) values('A1','Existing shelf name','shelf'),('DISPLAY','Display','display');`);
const sql=await readFile(new URL('../supabase/migrations/20261027230000_add_shelves_a_through_q.sql',import.meta.url),'utf8');await db.exec(sql);await db.exec(sql);
assert.equal((await db.query("select count(*)::int n from inventory_locations where location_type='shelf'")).rows[0].n,102);
assert.equal((await db.query("select display_name from inventory_locations where code='A1'")).rows[0].display_name,'Existing shelf name');
assert.equal((await db.query("select count(*)::int n from inventory_locations where code='Q6'")).rows[0].n,1);
}finally{await db.close();}});
