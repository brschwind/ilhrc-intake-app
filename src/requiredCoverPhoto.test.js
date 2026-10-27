import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const src=readFileSync(new URL('./App.jsx',import.meta.url),'utf8');
test('save opens cover camera and stops before mutations even when a catalog image exists',async()=>{
  const start=src.indexOf('async function saveItem()');
  const guard=src.slice(start,src.indexOf('  setIsSaving(true);',start))+' return "proceed"; } return saveItem();';
  const calls=[];
  const run=new Function('bookData','isSaving','coverFile','setAnalysisStatus','startCoverCamera',guard);
  assert.equal(await run({image_url:'existing-catalog-image'},false,null,m=>calls.push(m),async p=>calls.push(p)),undefined);
  assert.equal(calls[1],'listing');
  assert.equal(await run({},false,{type:'image/jpeg'},()=>{},()=>{}),'proceed');
});
test('barcode lookup clears previous photo and resets its camera request on failures',async()=>{
  const start=src.indexOf('async function lookupBookWithRequiredPhoto(value)');
  const handler=src.slice(start,src.indexOf('async function handleIntakeCameraBarcode',start));
  const pending={current:false},calls=[];
  const run=new Function('setCoverPhoto','setCoverFile','barcodePhotoPendingRef','lookupBookByBarcode',handler+'return lookupBookWithRequiredPhoto("9780000000000");');
  await assert.rejects(run(x=>calls.push(x),x=>calls.push(x),pending,async()=>{assert.equal(pending.current,true);throw Error('failed');}));
  assert.deepEqual(calls,[null,null]);assert.equal(pending.current,false);
});
test('duplicate receipts save the new photo and compact form exposes the required photo action',()=>{
  assert.match(src,/const duplicateImageUrl = await uploadCoverImage\(coverFile\)/);
  assert.match(src,/image_url: duplicateImageUrl/);
  assert.ok(src.indexOf('className="intake-required-cover"')<src.indexOf('className="intake-more-details"'));
});
