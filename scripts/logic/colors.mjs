/**
 * Цвета для мастерской оформления: из трёх цветов пользователя (акцент, фон, текст)
 * выводятся все токены темы. Чистая логика, тестируется без Foundry.
 */

export function parseHex(hex) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex ?? "").trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}

export function toHex({ r, g, b }) {
  return "#" + [r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("");
}

/** Смешать цвет a с b: amount = доля b (0…1). */
export function mix(a, b, amount) {
  const x = parseHex(a);
  const y = parseHex(b);
  return toHex({ r: x.r + (y.r - x.r) * amount, g: x.g + (y.g - x.g) * amount, b: x.b + (y.b - x.b) * amount });
}

export function rgba(hex, alpha) {
  const { r, g, b } = parseHex(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function luminance(hex) {
  const c = parseHex(hex);
  const f = (v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}

/** Контраст по WCAG: 1…21. Текст читается от 4.5. */
export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export const isDark = (hex) => luminance(hex) < 0.18;

/** Цвет текста, который читается на фоне. */
export function readableOn(bg, light = "#ece8e1", dark = "#1f1c17") {
  return contrast(light, bg) >= contrast(dark, bg) ? light : dark;
}

export const FONTS = {
  manrope: "\"TF Manrope\", system-ui, sans-serif",
  playfair: "\"TF Playfair\", Georgia, serif",
  cormorant: "\"TF Cormorant\", Georgia, serif",
  jetbrains: "\"TF JetBrains Mono\", ui-monospace, monospace",
  foundry: "var(--font-primary, \"Signika\"), system-ui, sans-serif"
};

/** Все CSS-переменные, которые может выставить мастерская (чтобы их можно было и снять). */
export const CUSTOM_VARS = [
  "--tf-accent", "--tf-accent-soft", "--tf-brass", "--tf-brass-hi", "--tf-brass-lo", "--tf-on-accent", "--tf-coin-ink", "--tf-coin-shadow",
  "--tf-bg", "--tf-pop", "--tf-control", "--tf-panel", "--tf-hover",
  "--tf-text", "--tf-muted", "--tf-line",
  "--tf-font", "--tf-font-display", "--tf-radius", "--tf-scale"
];

/**
 * Пользовательские настройки → CSS-переменные.
 * @param {{accent?:string, bg?:string, text?:string, font?:string, fontDisplay?:string, radius?:number, scale?:number}} custom
 * @returns {Record<string,string>} только то, что задано
 */
export function customVars(custom = {}) {
  const v = {};
  const accent = parseHex(custom.accent) ? toHex(parseHex(custom.accent)) : null;
  const bg = parseHex(custom.bg) ? toHex(parseHex(custom.bg)) : null;
  // Фон сменили, а текст нет — подбираем читаемый текст сами.
  const text = parseHex(custom.text) ? toHex(parseHex(custom.text)) : bg ? readableOn(bg) : null;

  if (accent) {
    const ink = readableOn(accent, "#ffffff", "#1a1408");
    Object.assign(v, {
      "--tf-accent": bg && contrast(accent, bg) < 3 ? mix(accent, readableOn(bg), 0.35) : accent,
      "--tf-accent-soft": rgba(accent, 0.16),
      "--tf-brass": accent,
      "--tf-brass-hi": mix(accent, "#ffffff", 0.35),
      "--tf-brass-lo": mix(accent, "#000000", 0.4),
      "--tf-on-accent": ink,
      "--tf-coin-ink": ink,
      "--tf-coin-shadow": "none"
    });
  }
  if (bg) {
    const toward = isDark(bg) ? "#ffffff" : "#000000";
    Object.assign(v, {
      "--tf-bg": bg,
      "--tf-pop": mix(bg, toward, 0.05),
      "--tf-control": mix(bg, toward, 0.08),
      "--tf-panel": mix(bg, toward, 0.04),
      "--tf-hover": mix(bg, toward, 0.07)
    });
  }
  if (text) {
    Object.assign(v, {
      "--tf-text": text,
      "--tf-muted": bg ? mix(text, bg, 0.32) : rgba(text, 0.72),
      "--tf-line": rgba(text, 0.14)
    });
  }
  if (FONTS[custom.font]) v["--tf-font"] = FONTS[custom.font];
  if (FONTS[custom.fontDisplay]) v["--tf-font-display"] = FONTS[custom.fontDisplay];
  if (Number.isFinite(custom.radius)) v["--tf-radius"] = `${Math.min(24, Math.max(0, custom.radius))}px`;
  if (Number.isFinite(custom.scale)) v["--tf-scale"] = String(Math.min(1.4, Math.max(0.8, custom.scale)));
  return v;
}
