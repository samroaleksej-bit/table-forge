import { normalize, words, swapLayout, plainText } from "./text.mjs";

/**
 * Поисковый индекс таблиц: название + содержимое результатов.
 * Поиск нечёткий: ё/е, регистр, опечатки (Левенштейн), неверная раскладка.
 */

/** @param {{name:string, results?:Array<{name?:string, description?:string, text?:string}>}} table */
export function buildSearchEntry(table, meta = {}) {
  const content = (table.results ?? [])
    .map((r) => `${r.name ?? ""} ${plainText(r.description ?? r.text ?? "")}`)
    .join(" ");
  const nameN = normalize(table.name);
  const contentN = normalize(content);
  return {
    ...meta,
    name: table.name,
    nameN,
    nameWords: [...new Set(nameN.split(" ").filter(Boolean))],
    contentN,
    contentWords: [...new Set(contentN.split(" ").filter((w) => w.length >= 3))]
  };
}

/** Расстояние Левенштейна с ранним выходом, если оно больше max. */
export function levenshtein(a, b, max = Infinity) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

function allowedTypos(token) {
  if (token.length >= 8) return 2;
  if (token.length >= 4) return 1;
  return 0;
}

/** Слово похоже на токен: опечатка в целом слове или в его начале (ввод ещё не закончен). */
function fuzzyHit(token, list) {
  const max = allowedTypos(token);
  if (!max) return false;
  for (const w of list) {
    if (levenshtein(token, w, max) <= max) return true;
    if (w.length > token.length && levenshtein(token, w.slice(0, token.length), max) <= max) return true;
  }
  return false;
}

function scoreTokens(entry, tokens) {
  let score = 0;
  for (const t of tokens) {
    if (entry.nameN.includes(t)) score += entry.nameWords.some((w) => w.startsWith(t)) ? 12 : 9;
    else if (entry.contentN.includes(t)) score += 4;
    else if (fuzzyHit(t, entry.nameWords)) score += 6;
    else if (fuzzyHit(t, entry.contentWords)) score += 2;
    else return 0;
  }
  if (entry.nameN === tokens.join(" ")) score += 20;
  else if (entry.nameN.startsWith(tokens[0])) score += 5;
  return score;
}

/** @returns {Array<{entry:object, score:number}>} отсортировано по убыванию релевантности */
export function search(entries, query) {
  const tokens = words(query);
  if (!tokens.length) return entries.map((entry) => ({ entry, score: 0 }));
  const swapped = words(swapLayout(query));
  const useSwap = swapped.join(" ") !== tokens.join(" ");
  const hits = [];
  for (const entry of entries) {
    const score = Math.max(scoreTokens(entry, tokens), useSwap ? scoreTokens(entry, swapped) : 0);
    if (score > 0) hits.push({ entry, score });
  }
  return hits.sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name));
}
