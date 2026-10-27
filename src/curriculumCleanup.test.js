import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {PGlite} from '@electric-sql/pglite';
test('cleanup preserves book information, merges publisher conflicts, keeps real programs and backs up changes',async()=>{
const db=new PGlite();try{
await db.exec(`create role anon;create role authenticated;
create table items(id text primary key,title text,curriculum text,publisher text,final_price numeric,quantity int,notes text,image_url text);
insert into items values
('a','Atlas','DK','',3,2,'keep','cover-a'),
('b','Reader','Usborne','Scholastic',1,4,'keep','cover-b'),
('c','Book','Unknown Curriculum','Penguin',5,1,'keep','cover-c'),
('d','History','History Odyssey','',10,1,'keep','cover-d'),
('e','Method','Charlotte Mason','Crossway',2,1,'keep','cover-e'),
('f','Science','Apologia Educational Ministries','Apologia Educational Ministries',0,3,'keep','cover-f'),
('g','Foundations in Personal Finance','Ramsey','Ramsey Education',8,1,'keep','cover-g');`);
const sql=await readFile(new URL('../supabase/migrations/20261027220000_cleanup_inventory_curriculum.sql',import.meta.url),'utf8');
await db.exec(sql);await db.exec(sql);
const rows=(await db.query('select * from items order by id')).rows;
assert.deepEqual(rows.map(x=>x.curriculum),['','','','History Odyssey','','Apologia','Ramsey Education']);
assert.equal(rows[0].publisher,'DK');assert.equal(rows[1].publisher,'Scholastic; Usborne');assert.equal(rows[2].publisher,'Penguin');assert.equal(rows[4].publisher,'Crossway');
assert.deepEqual(rows.map(x=>x.final_price),['3','1','5','10','2','0','8']);assert.deepEqual(rows.map(x=>x.quantity),[2,4,1,1,1,3,1]);
assert.ok(rows.every(x=>x.notes==='keep'&&x.image_url==='cover-'+x.id));
assert.equal((await db.query('select count(*)::int n from inventory_curriculum_cleanup_backup')).rows[0].n,6);
assert.equal((await db.query("select before_values->>'curriculum' as c from inventory_curriculum_cleanup_backup where item_id='e'")).rows[0].c,'Charlotte Mason');
}finally{await db.close();}});
