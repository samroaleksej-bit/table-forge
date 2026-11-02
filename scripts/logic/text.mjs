/**
 * Чистые текстовые утилиты. Без зависимостей от Foundry: используются и в модуле, и в тестах.
 */

const HTML_ENTITIES = { "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": "\"", "&#39;": "'" };

/** HTML и разметка Foundry → плоский текст. @UUID[...]{Метка} → «Метка», [[...]] → «…». */
export function plainText(value) {
  if (!value) return "";
  return String(value)
    .replace(/@\w+\[[^\]]*\]\{([^}]*)\}/g, "$1")
    .replace(/@\w+\[([^\]]*)\]/g, (_, id) => id.split(".").pop())
    .replace(/\[\[(?:\/\w+\s+)?([^\]]*)\]\](?:\{([^}]*)\})?/g, (_, f, label) => label ?? f)
    .replace(/<br\s*\/?>|<\/p>|<\/li>|<\/div>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&[#\w]+;/g, (e) => HTML_ENTITIES[e] ?? " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Нормализация для поиска: регистр, ё→е, только буквы и цифры. */
export function normalize(value) {
  return plainText(value)
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function words(value) {
  const n = normalize(value);
  return n ? n.split(" ") : [];
}

const EN = "qwertyuiop[]asdfghjkl;'zxcvbnm,.`";
const RU = "йцукенгшщзхъфывапролджэячсмитьбюё";

/** «nfdthyf» → «таверна»: текст, набранный в неверной раскладке. */
export function swapLayout(value) {
  let out = "";
  for (const ch of String(value).toLowerCase()) {
    const i = EN.indexOf(ch);
    out += i >= 0 ? RU[i] : ch;
  }
  return out;
}

export function escapeHTML(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function truncate(value, max) {
  const s = String(value ?? "");
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}
