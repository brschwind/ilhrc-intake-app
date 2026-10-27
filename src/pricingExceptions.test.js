import test from 'node:test';
import assert from 'node:assert/strict';
import { PRICING_DEFAULTS, canonicalCategory, suggestBookCategory } from './bookPricing.js';
const options = Object.entries(PRICING_DEFAULTS).map(([name,default_price])=>({name,default_price}));
test('eight approved defaults and legacy mappings',()=>{
  assert.equal(options.length,8);
  assert.equal(canonicalCategory('Novel'),'Reading Book');
  assert.equal(suggestBookCategory({category:'Textbook'},options).default_price,10);
});
test('picture and early reader exceptions require recognizable evidence',()=>{
  assert.equal(suggestBookCategory({category:'Reading Book',book_format:'picture book'},options).default_price,2);
  assert.equal(suggestBookCategory({category:'Reading Book',book_format:'early reader'},options).default_price,.5);
  assert.equal(suggestBookCategory({category:'Reading Book',book_format:'early reader',pageCount:24},options).default_price,.25);
  assert.equal(suggestBookCategory({category:'Reading Book'},options).default_price,1);
});
test('substantial workbooks and longer chapter books use supported metadata',()=>{
  assert.equal(suggestBookCategory({title:'Math Workbook',pageCount:120},options).default_price,5);
  assert.equal(suggestBookCategory({title:'Math Workbook'},options).default_price,2);
  assert.equal(suggestBookCategory({title:'Chapter Book',pageCount:220},options).default_price,4);
  assert.equal(suggestBookCategory({title:'Picture Book',pageCount:220},options).default_price,2);
});
test('answer keys cannot receive workbook exceptions',()=>{
  const b=suggestBookCategory({title:'Math Workbook Answer Key',category:'Workbook & Tests',pageCount:200},options);
  assert.equal(b.name,'Answer Key');assert.equal(b.default_price,1);
});
