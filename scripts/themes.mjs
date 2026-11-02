import { MODULE_ID, SETTINGS } from "./constants.mjs";
import { customVars, CUSTOM_VARS } from "./logic/colors.mjs";

/**
 * Темы оформления. Тема — это набор CSS-токенов (styles/themes.css, [data-tf-theme="…"])
 * плюс вид списка: строки или плитки. Поверх темы — личные настройки из мастерской
 * (SETTINGS.CUSTOM): цвета, шрифты, масштаб, плотность. У каждого пользователя свои (client).
 */
export const THEMES = [
  { id: "forge", view: "list" },
  { id: "finder", view: "list" },
  { id: "grimoire", view: "list" },
  { id: "deck", view: "grid" },
  { id: "terminal", view: "list" },
  { id: "console", view: "grid", keys: true }
];

export const DEFAULT_THEME = "forge";

export function currentTheme() {
  const id = game.settings.get(MODULE_ID, SETTINGS.THEME);
  return THEMES.find((th) => th.id === id) ?? THEMES[0];
}

export const currentCustom = () => game.settings.get(MODULE_ID, SETTINGS.CUSTOM) ?? {};

/** Вид списка с учётом мастерской: строки или плитки. */
export function currentView(theme = currentTheme(), custom = currentCustom()) {
  return custom.view === "list" || custom.view === "grid" ? custom.view : theme.view;
}

/** Выбирал ли пользователь тему (окно выбора показывается один раз). */
export const themeChosen = () => game.settings.get(MODULE_ID, SETTINGS.THEME_CHOSEN);

/**
 * Оформить элемент (окно, карточку, превью): тема + личные настройки.
 * Можно передать черновик — так мастерская показывает превью до сохранения.
 */
export function decorate(el, { theme = currentTheme().id, custom = currentCustom() } = {}) {
  if (!el) return;
  el.dataset.tfTheme = theme;
  for (const name of CUSTOM_VARS) el.style.removeProperty(name);
  const vars = customVars(custom);
  for (const [name, value] of Object.entries(vars)) el.style.setProperty(name, value);
  toggleData(el, "tfCustomBg", "--tf-bg" in vars);
  toggleData(el, "tfCustomText", "--tf-text" in vars);
  toggleData(el, "tfDensity", ["compact", "spacious"].includes(custom.density) ? custom.density : null);
  toggleData(el, "tfMotion", custom.motion === false ? "off" : null);
}

function toggleData(el, key, value) {
  if (value === true) el.dataset[key] = "1";
  else if (value) el.dataset[key] = value;
  else delete el.dataset[key];
}

/** Перекрасить уже нарисованные карточки в чате. */
export function applyThemeToChat() {
  for (const card of document.querySelectorAll(".tf-card:not(.tf-card--preview)")) decorate(card);
}
