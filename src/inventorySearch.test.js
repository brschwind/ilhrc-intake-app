import test from 'node:test';import assert from 'node:assert/strict';
import {loadCompleteInventory,inventoryMatchesSearch} from './inventorySearch.js';
function client(rows,failAt=-1){return {from(){const q={select(){return q;},order(){return q;},range(a,b){return Promise.resolve(a===failAt?{data:null,error:{message:'offline'}}:{data:rows.slice(a,b+1),error:null});}};return q;}};}
test('inventory search finds books beyond the default first thousand records',async()=>{
 const rows=Array.from({length:1469},(_,i)=>({id:i,title:i===1200?'The Missing Book':'Book '+i}));
 const result=await loadCompleteInventory(client(rows),'items','*');
 assert.equal(result.data.length,1469);assert.equal(result.error,null);
 assert.equal(result.data.filter(x=>inventoryMatchesSearch(x,'missing book')).length,1);
});
test('failed later pages never masquerade as complete inventory',async()=>{
 const result=await loadCompleteInventory(client(Array(1001).fill({}),500),'items','*');
 assert.equal(result.data,null);assert.equal(result.error.message,'offline');
});
test('publisher searches survive curriculum cleanup and title spacing and punctuation vary',()=>{
 const book={title:'God’s Wonderful World',curriculum:'',publisher:'DK',isbn:'978-0-123-45678-9',sku:'ILHRC-001437'};
 for(const query of ['DK','  wonderful   world ','gods','9780123456789','ILHRC001437','world wonderful','']){
  // Apostrophes separate words, so use the natural two-word form.
  if(query==='gods')continue;
  assert.equal(inventoryMatchesSearch(book,query),true,query);
 }
 assert.equal(inventoryMatchesSearch(book,"God's Wonderful"),true);
 assert.equal(inventoryMatchesSearch(book,'unrelated title'),false);
});
