function takeWordsFromStart(words, maxLength) {
  const selected = [];

  for (const word of words) {
    const candidate = [...selected, word].join(" ");
    if (candidate.length > maxLength && selected.length > 0) break;
    selected.push(word);
  }

  return selected;
}

function takeWordsFromEnd(words, maxLength) {
  const selected = [];

  for (let index = words.length - 1; index >= 0; index -= 1) {
    const candidate = [words[index], ...selected].join(" ");
    if (candidate.length > maxLength && selected.length > 0) break;
    selected.unshift(words[index]);
  }

  return selected;
}

export function formatLabelTitle(title, maxLineLength = 32) {
  const cleanTitle = String(title || "Untitled").replace(/\s+/g, " ").trim() || "Untitled";
  if (cleanTitle.length <= maxLineLength) return [cleanTitle];

  if (!cleanTitle.includes(" ")) {
    return [
      `${cleanTitle.slice(0, maxLineLength - 1)}…`,
      `…${cleanTitle.slice(-(maxLineLength - 1))}`,
    ];
  }

  const words = cleanTitle.split(" ");
  const firstWords = takeWordsFromStart(words, maxLineLength);
  const remainingWords = words.slice(firstWords.length);
  const remainingTitle = remainingWords.join(" ");

  if (remainingTitle.length <= maxLineLength) {
    return [firstWords.join(" "), remainingTitle];
  }

  const suffixWords = takeWordsFromEnd(remainingWords, maxLineLength - 2);
  const suffix = suffixWords.join(" ");

  return [
    firstWords.join(" "),
    `… ${suffix.length > maxLineLength - 2 ? suffix.slice(-(maxLineLength - 2)) : suffix}`,
  ];
}
