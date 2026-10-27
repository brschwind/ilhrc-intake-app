import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestBookCategory } from './bookPricing.js';
const options = ['Workbook','Answer Key','Teacher Resource','Textbook','Reader / Chapter Book','Game'].map(name => ({name,default_price:1}));
test('answer keys take precedence over workbook and textbook words', () => {
  assert.equal(suggestBookCategory({title:'Science Workbook Answer Key'},options).name,'Answer Key');
});
test('teacher editions take precedence over student format', () => {
  assert.equal(suggestBookCategory({title:"Math Workbook Teacher’s Edition"},options).name,'Teacher Resource');
});
test('unknowns and subject-only matches do not receive a reader or textbook price', () => {
  for (const title of ['Exploring Science','Brain Games Puzzles for Kids','Treasures of the Snow']) assert.equal(suggestBookCategory({title},options),null);
});
test('AI selection must match configured categories', () => {
  assert.equal(suggestBookCategory({title:'Epsilon',category:'DVD / Media'},options),null);
  assert.equal(suggestBookCategory({title:'Epsilon',category:' workbook '},options).name,'Workbook');
});
