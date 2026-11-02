import { plainText, escapeHTML, truncate } from "./text.mjs";

const DEFAULT_ICONS = new Set([
  "icons/svg/d20.svg", "icons/svg/d20-black.svg", "icons/svg/d20-grey.svg",
  "icons/svg/d20-highlight.svg", "icons/svg/item-bag.svg"
]);

/**
 * Картинку показываем, только если она не стандартная иконка кубика
 * и не лежит в папке выключенного модуля (иначе в чате будет битая картинка).
 */
export function usableImage(img, isModuleActive = () => true) {
  if (!img || DEFAULT_ICONS.has(img)) return null;
  const m = /^modules\/([^/]+)\//.exec(img);
  if (m && !isModuleActive(m[1])) return null;
  return img;
}

/** Короткая подпись результата для списков и предпросмотра. */
export function resultLabel(result) {
  return plainText(result.name) || plainText(result.description ?? result.text) || "—";
}

export function rangeLabel(range) {
  if (!Array.isArray(range)) return "";
  return range[0] === range[1] ? `${range[0]}` : `${range[0]}–${range[1]}`;
}

/**
 * HTML результата для карточки (до обогащения TextEditor).
 * Ссылка на документ: если документ доступен — @UUID, иначе аккуратная подпись без ошибки.
 * @param {(uuid:string)=>boolean} exists
 */
export function resultSourceHTML(result, exists = () => true) {
  const name = String(result.name ?? "").trim();
  const desc = String(result.description ?? result.text ?? "").trim();
  if (result.type === "document" && result.documentUuid) {
    const label = name || result.documentUuid.split(".").pop();
    const link = exists(result.documentUuid)
      ? `@UUID[${result.documentUuid}]{${label.replace(/}/g, ")")}}`
      : `<span class="tf-missing-link" data-tooltip="${escapeHTML(result.documentUuid)}"><i class="fa-solid fa-link-slash"></i> ${escapeHTML(label)}</span>`;
    return desc ? `<p class="tf-doc">${link}</p>${desc}` : `<p class="tf-doc">${link}</p>`;
  }
  if (desc) return name ? `<p><strong>${escapeHTML(name)}</strong></p>${desc}` : desc;
  return name ? `<p>${escapeHTML(name)}</p>` : "<p>—</p>";
}

/** Строки предпросмотра: диапазон + обрезанный текст. */
export function previewRows(results = [], limit = 12) {
  const sorted = [...results].sort((a, b) => (a.range?.[0] ?? 0) - (b.range?.[0] ?? 0));
  return {
    rows: sorted.slice(0, limit).map((r) => ({ range: rangeLabel(r.range), text: truncate(resultLabel(r), 110) })),
    more: Math.max(0, sorted.length - limit)
  };
}
