// Reviewed curriculum providers/programs. General publishers are deliberately absent.
export const HOMESCHOOL_CURRICULA = [
  'History Odyssey','Visual Latin','The Gentle + Classical','Latin Alive',
  'Mott Media','Lyrical Learning','TruthQuest History','Pathway Publishers','Thinkwell',
  'Dianne Craft Right Brain Learning System','Ramsey Education',
  'Abeka','All About Learning Press','All About Reading','All About Spelling','Ambleside Online',
  'Answers in Genesis','Apologia','Beautiful Feet','Berean Builders','BJU Press','Brave Writer',
  'Christian Liberty Press','Christian Light Education','Classical Academic Press','Classical Conversations',
  'Easy Grammar','Elemental Science','Essentials in Writing','Explode the Code','Five in a Row',
  'Gather Round','Generations','Handwriting Without Tears','Horizons',
  'IEW (Institute for Excellence in Writing)','Learning Without Tears','LifePac',
  'Master Books','Math With Confidence','Math-U-See','McRuffy Press','Memoria Press',
  "My Father's World",'Mystery of History','Notgrass','Rod and Staff Publishers',
  'Saxon Math','Shurley English','Simply Charlotte Mason','Singapore Math','Sonlight',
  'Spelling You See','Story of the World','Teaching Textbooks','The Critical Thinking Co.',
  'The Good and the Beautiful','The Latin Road','The Writing Revolution','Veritas Press',
  'WriteShop','Writing Strands','Alpha Omega','ACE','Life of Fred','Right Start',
];
const key = value => String(value || '').toLowerCase().replace(/[^a-z0-9]/g,'');
const names = new Map(HOMESCHOOL_CURRICULA.map(name=>[key(name),name]));
for (const [alias,name] of Object.entries({
  'Thinkwell Corporation':'Thinkwell','Pathway publishers':'Pathway Publishers',
  'Latin alive':'Latin Alive','Gentle + Classical Press':'The Gentle + Classical',
  'A Beka':'Abeka','Bob Jones':'BJU Press','Bob Jones University Press':'BJU Press',
  'Apologia Educational Ministries':'Apologia','Berean builders':'Berean Builders',
  'Saxon':'Saxon Math','Rod & Staff':'Rod and Staff Publishers','Rod and Staff':'Rod and Staff Publishers',
  'IEW':'IEW (Institute for Excellence in Writing)','Institute for Excellence in Writing':'IEW (Institute for Excellence in Writing)',
  'The Story of the World':'Story of the World','Teaching Textbook':'Teaching Textbooks',
})) names.set(key(alias),name);
export const curriculumRecognitionEntries = () => [...names.entries()];
export function knownCurriculum(value) { return names.get(key(value)) || ''; }
export function curriculumFromBook(book) {
  // A recognized provider in Publisher is useful evidence; an arbitrary publisher is not.
  if (/foundations in personal finance/i.test(book.title || '') &&
    /ramsey/i.test([book.curriculum, book.publisher].join(' '))) return 'Ramsey Education';
  return knownCurriculum(book.curriculum) || knownCurriculum(book.publisher);
}
