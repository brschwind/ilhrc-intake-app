// Prefer a supported AI selection, then explicit product-format evidence.
// Unknown books stay unclassified rather than inheriting a reader price.
export function suggestBookCategory(book, options) {
  const find = name => options.find(x => x.name.toLowerCase() === name.toLowerCase());
  const explicit = typeof book.category === 'string' && find(book.category.trim());
  if (explicit) return explicit;
  const text = `${book.title || ''} ${book.categories?.join(' ') || ''}`.toLowerCase();
  const choices = [
    [/\b(answer key|test key|quiz.{0,8}key|solutions? manual|solutions? key|tests? and answers)\b/, ['Answer Key']],
    [/\b(teacher['’]?s? (edition|manual|guide)|instructor['’]?s? (edition|manual|guide)|teacher resource)\b/, ['Teacher Resource']],
    [/\b(workbook|student activity|student worktext|worktext|student tests?|tests?\/quizzes)\b/, ['Workbook']],
    [/\b(flash\s?cards?)\b/, ['Flashcards']],
    [/\b(dvd|cd-rom|video course)\b/, ['DVD / Media']],
    [/\b(science kit|experiment kit)\b/, ['Science Kit']],
    [/\b(board game|card game)\b/, ['Game']],
    [/\b(textbook|student text)\b/, ['Textbook']],
    [/\b(early reader|beginning reader)\b/, ['Early Reader']],
    [/\b(picture book)\b/, ['Picture Book']],
    [/\b(devotional|devotions)\b/, ['Devotional']],
    [/\b(bible)\b/, ['Bible']],
    [/\b(biography|memoir)\b/, ['Biography']],
    [/\b(dictionary|encyclopedia|atlas|reference book)\b/, ['Reference Book']],
    [/\b(novel)\b/, ['Novel', 'Reader / Chapter Book']],
  ];
  for (const [pattern, names] of choices) {
    if (pattern.test(text)) {
      for (const name of names) { const option = find(name); if (option) return option; }
      return null;
    }
  }
  return null;
}
