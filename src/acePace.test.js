import test from 'node:test';
import assert from 'node:assert/strict';
import {ACE_PRICES,aceNumbersForLevel,aceLevelForNumber,parseAceNumbers,newAceDraft,buildAceItem,aceMatchesFilters} from './acePace.js';
import {inventoryMatchesSearch} from './inventorySearch.js';
const draft=changes=>({...newAceDraft(),confirmed:true,...changes});
test('all 144 standard PACEs map in both directions, without assuming specialized numbering',()=>{
  for(let level=1;level<=12;level++)for(const n of aceNumbersForLevel(level)) assert.equal(aceLevelForNumber(n),level);
  for(const n of [1000,1145,1,1001.5,'abc'])assert.equal(aceLevelForNumber(n),'');
  assert.deepEqual(aceNumbersForLevel(''),[]);
  assert.deepEqual(parseAceNumbers('1037–1039, 1041,1037'),[1037,1038,1039,1041]);
  assert.throws(()=>parseAceNumbers('12-1'));
});
test('complete unused bundle is one stock unit at $8, three identical sets are quantity three',()=>{
  const one=buildAceItem(draft()),three=buildAceItem(draft({quantity:3}));
  assert.equal(one.final_price,8);assert.equal(one.quantity,1);assert.equal(three.quantity,3);
  assert.equal(three.final_price*three.quantity,24);assert.equal(one.ace_details.numbers.length,12);
  assert.equal(one.title,'ACE English — Level 4 — PACEs 1037–1048 — Complete Set');
  assert.equal(one.primary_category,'Curriculum');assert.equal(one.subcategory,'ACE / School of Tomorrow');
});
test('11-PACE partial lists missing number and uses $0.50 per included PACE',()=>{
  const item=buildAceItem(draft({subject:'Math',level:'5',materialType:'Partial subject set',numbers:aceNumbersForLevel(5).filter(n=>n!==1052)}));
  assert.equal(item.final_price,5.5);assert.match(item.title,/11 PACEs \(Missing 1052\)/);
  assert.equal(item.ace_details.numbers.includes(1052),false);
});
test('individual replacement PACE, test, Score Key, and manually priced resources',()=>{
  for(const [materialType,price] of [['Student PACE',0.75],['PACE Test',0.25],['Score Key',1]]) {
    assert.equal(buildAceItem(draft({materialType,numbers:[1037]})).final_price,price);
  }
  for(const materialType of ['Test Key','Teacher Manual','Other ACE resource'])assert.equal(buildAceItem(draft({materialType,numbers:[1037]})).final_price,null);
  assert.equal(buildAceItem(draft({materialType:'Teacher Manual',price:'2'})).final_price,2);
});
test('included tests and keys clearly describe verified or unknown compatibility',()=>{
  const unknown=buildAceItem(draft({tests:true,keys:true}));
  assert.match(unknown.notes,/tests and Score Keys; edition compatibility: Unknown/);
  const matching=buildAceItem(draft({tests:true,compatibility:'Confirmed matching'}));
  assert.match(matching.notes,/Confirmed matching/);assert.equal(matching.final_price,8);
  const key=buildAceItem(draft({materialType:'Score Key',numbers:[1037]}));
  assert.equal(key.final_price,1);assert.equal(matching.ace_details.keys,false);
});
test('older, unknown, mixed, used, manual overrides and editable pricing',()=>{
  assert.equal(buildAceItem(draft({older:true})).final_price,5);
  assert.equal(buildAceItem(draft({edition:'Unknown'})).final_price,8);
  assert.match(buildAceItem(draft({edition:'Mixed editions'})).title,/Mixed Editions/);
  assert.equal(buildAceItem(draft({writing:'Some writing'})).final_price,8);
  assert.equal(buildAceItem(draft({price:'0'})).final_price,0);
  assert.equal(buildAceItem(draft(),{...ACE_PRICES,complete:7}).final_price,7);
  assert.throws(()=>buildAceItem(draft({price:'-1'})));
  assert.throws(()=>buildAceItem(draft({quantity:1.5})));
  assert.throws(()=>buildAceItem(draft({confirmed:false})));
});
test('search finds interior numbers and ACE Math 5; ACE filters exclude unrelated records',()=>{
  const item=buildAceItem(draft({subject:'Math',level:'5',numbers:aceNumbersForLevel(5)}));
  for(const query of ['1052','ACE Math 5'])assert.equal(inventoryMatchesSearch(item,query),true);
  assert.equal(inventoryMatchesSearch(item,'1037'),false);
  assert.equal(aceMatchesFilters(item,{ace:'yes',level:'5',complete:'true',number:'1052'}),true);
  assert.equal(aceMatchesFilters(item,{complete:'false'}),false);
  assert.equal(aceMatchesFilters({title:'ordinary'},{ace:'yes'}),false);
  assert.equal(aceMatchesFilters({title:'ordinary'},{}),true);
  assert.equal(inventoryMatchesSearch({title:'Ordinary Book'},'ordinary'),true);
});
test('custom numbering and placement override do not assert standard grade alignment',()=>{
  const item=buildAceItem(draft({custom:true,customNumbers:'1-6',expectedCount:6,level:'Algebra'}));
  assert.equal(item.ace_details.numbers.length,6);assert.equal(item.grade_level,'Algebra');
  assert.equal(item.final_price,null);
});

test('listing SKU accepts custom numbers and generated IDs while rejecting unreadable barcodes', async () => {
  assert.equal(buildAceItem(draft({ sku: ' 123456 ' })).sku, '123456');
  assert.equal(buildAceItem(draft({ sku: 'ace-english-4' })).sku, 'ACE-ENGLISH-4');
  assert.equal(buildAceItem(draft()).sku, undefined);
  assert.throws(() => buildAceItem(draft({ sku: 'spaces are invalid' })), /SKU/);
  const { aceStickerItem } = await import('./acePace.js');
  const item = buildAceItem(draft());
  assert.equal(aceStickerItem({ ...item, quantity: 20, received_quantity: 1 }).label_quantity, 1);
  assert.equal(aceStickerItem({ ...item, received_quantity: 3 }).label_quantity, 3);
  assert.equal(aceStickerItem(item).ace_details.numbers.length, 12);
});

test('Word Building complete-set suggestion stays visible for condition changes and unfinished fields', async () => {
  const { getAceSuggestedPrice, ACE_SUBJECTS } = await import('./acePace.js');
  for (const subject of ACE_SUBJECTS) {
    for (let level = 1; level <= 12; level++) {
      const selection = draft({ subject, level: String(level), numbers: aceNumbersForLevel(level) });
      assert.equal(buildAceItem(selection).suggested_price, 8);
    }
  }
  for (const condition of ['Like New / Unused', 'Good', 'Fair', 'Poor']) {
    const selection = draft({ subject: 'Word Building', condition });
    assert.equal(getAceSuggestedPrice(selection), 8);
    assert.equal(buildAceItem(selection).final_price, 8);
  }
  const unfinished = draft({ subject: 'Word Building', condition: 'Good', quantity: 0, sku: 'Invalid SKU' });
  assert.equal(getAceSuggestedPrice(unfinished), 8);
  assert.throws(() => buildAceItem(unfinished));
  assert.equal(buildAceItem(draft({ subject: 'Word Building', condition: 'Good', price: '5' })).final_price, 5);
  assert.equal(getAceSuggestedPrice(draft({ subject: 'Word Building' }), { ...ACE_PRICES, complete: 6 }), 6);
});

test('writing-only intake never claims a physical condition and retains replacement PACE pricing', () => {
  const selection = draft({ subject: 'Word Building' });
  assert.equal(selection.condition, undefined);
  const item = buildAceItem(selection);
  assert.equal(item.condition, 'Not assessed');
  assert.equal(item.ace_details.condition, 'Not assessed');
  assert.equal(item.notes.includes('Condition:'), false);
  assert.equal(item.suggested_price, 8);
  assert.equal(buildAceItem(draft({ materialType: 'Student PACE', numbers: [1037] })).suggested_price, .75);
  assert.equal(buildAceItem(draft({ materialType: 'Student PACE', numbers: [1037], writing: 'Some writing' })).suggested_price, null);
});
