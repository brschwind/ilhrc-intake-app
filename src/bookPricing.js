export const PRICING_DEFAULTS = {
  'Student Text': 10, 'Workbook & Tests': 2, 'Teacher Guide': 3,
  'Answer Key': 1, 'Reading Book': 1, 'Reference & Resource': 3,
  'Learning Materials & Media': 5, 'Bundle / Kit': 10,
};
export const LEGACY_CATEGORIES = {
  Textbook: 'Student Text', Workbook: 'Workbook & Tests',
  'Workbook (small/paperback)': 'Workbook & Tests', 'Teacher Resource': 'Teacher Guide',
  'Picture Book': 'Reading Book', 'Early Reader': 'Reading Book',
  'Reader / Chapter Book': 'Reading Book', Novel: 'Reading Book', Biography: 'Reading Book',
  Bible: 'Reading Book', Devotional: 'Reading Book', 'Reference Book': 'Reference & Resource',
  'Family Living': 'Reference & Resource', Enrichment: 'Reference & Resource',
  'DVD / Media': 'Learning Materials & Media', Game: 'Learning Materials & Media',
  Flashcards: 'Learning Materials & Media', Manipulative: 'Learning Materials & Media',
  'Science Kit': 'Bundle / Kit', 'Curriculum Package': 'Bundle / Kit', 'Bundle / Set': 'Bundle / Kit',
};
export function canonicalCategory(name) { return LEGACY_CATEGORIES[name] || name || ''; }

export function suggestBookCategory(book, options) {
  const find = name => options.find(x => x.name.toLowerCase() === name.toLowerCase()) ||
    options.find(x => x.name.toLowerCase() === canonicalCategory(name).toLowerCase());
  const text = `${book.title || ''} ${book.categories?.join(' ') || ''} ${book.book_format || ''}`.toLowerCase();
  const choices = [
    [/\b(answer key|test key|quiz.{0,8}key|solutions? manual|solutions? key|tests? and answers)\b/, 'Answer Key'],
    [/\b(teacher['’]?s? (edition|manual|guide)|instructor['’]?s? (edition|manual|guide)|teacher resource)\b/, 'Teacher Resource'],
    [/\b(workbook|student activity|student worktext|worktext|student tests?|tests?\/quizzes)\b/, 'Workbook'],
    [/\b(science kit|experiment kit|curriculum package|boxed set|bundle)\b/, 'Science Kit'],
    [/\b(flash\s?cards?|dvd|cd-rom|video course|board game|card game|manipulatives?)\b/, 'DVD / Media'],
    [/\b(textbook|student text)\b/, 'Textbook'],
    [/\b(early reader|beginning reader)\b/, 'Early Reader'],
    [/\b(picture book)\b/, 'Picture Book'],
    [/\b(devotional|devotions)\b/, 'Devotional'],
    [/\b(bible)\b/, 'Bible'],
    [/\b(biography|memoir)\b/, 'Biography'],
    [/\b(dictionary|encyclopedia|atlas|reference book)\b/, 'Reference Book'],
    [/\b(novel|chapter book)\b/, 'Reader / Chapter Book'],
  ];
  // Specific product evidence wins over a conflicting broad AI selection.
  for (const [pattern, name] of choices) if (pattern.test(text)) {
    const found = find(name); if (found) return priceCategory(found, book);
  }
  const explicit = typeof book.category === 'string' && find(book.category.trim());
  return explicit ? priceCategory(explicit, book) : null;
}

export function priceCategory(option, book) {
  const category = canonicalCategory(option.name);
  const text = `${book.title || ''} ${book.book_format || ''} ${book.category || ''} ${book.categories?.join(' ') || ''}`.toLowerCase();
  const pages = Number(book.pageCount || book.number_of_pages || book.page_count || 0);
  let price = option.default_price;
  let reason = '';
  if (category === 'Reading Book') {
    if (/\b(picture book)\b/.test(text)) { price = 2; reason = 'Picture book'; }
    else if (/\b(early reader|beginning reader)\b/.test(text)) {
      price = (pages > 0 && pages <= 32) || /\b(tiny|booklet)\b/.test(text) ? 0.25 : 0.5;
      reason = 'Early reader';
    } else if (pages >= 200 && /\b(novel|chapter book)\b/.test(text)) { price = 4; reason = 'Longer chapter book'; }
  } else if (category === 'Workbook & Tests' &&
    /\b(workbook|worktext)\b/.test(text) &&
    (pages >= 96 || /\b(full[- ]size|substantial)\b/.test(text)) &&
    !/\b(booklet|small workbook)\b/.test(text)) {
    price = 5; reason = 'Substantial workbook';
  }
  return { ...option, default_price: price, price_reason: reason };
}
