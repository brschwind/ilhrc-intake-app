import test from 'node:test';
import assert from 'node:assert/strict';
import {knownCurriculum,curriculumFromBook} from './homeschoolCurriculum.js';
test('unknown labels and general publishers leave curriculum blank',()=>{
 for(const name of ['Unknown Curriculum','Unknown','Other','DK','Aladdin','Moody Publishers','Tyndale House Publishers, Inc.','National Geographic Society','']) assert.equal(knownCurriculum(name),'');
 assert.equal(curriculumFromBook({curriculum:'Unknown Curriculum',publisher:'DK'}),'');
});
test('recognized providers and aliases use canonical names',()=>{
 assert.equal(knownCurriculum('A Beka'),'Abeka');
 assert.equal(knownCurriculum('Apologia Educational Ministries'),'Apologia');
 assert.equal(curriculumFromBook({publisher:'BJU Press'}),'BJU Press');
 assert.equal(curriculumFromBook({curriculum:'Sonlight',publisher:'Random House'}),'Sonlight');
});
test('subjects and incidental text cannot establish curriculum',()=>{
 assert.equal(curriculumFromBook({title:'Science',notes:'possibly Apologia',publisher:'DK'}),'');
});

test('reviewed homeschool programs survive cleanup and recognition',()=>{
 for(const name of ['History Odyssey','Visual Latin','Dianne Craft Right Brain Learning System','TruthQuest History','Mott Media']) assert.equal(knownCurriculum(name),name);
 assert.equal(knownCurriculum('Thinkwell Corporation'),'Thinkwell');
 assert.equal(curriculumFromBook({title:'Foundations in Personal Finance',curriculum:'Ramsey'}),'Ramsey Education');
 assert.equal(curriculumFromBook({title:'Battle of the Chores',curriculum:'Ramsey',publisher:'Ramsey Press'}),'');
});
