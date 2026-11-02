import { MODULE_ID, SETTINGS } from "./constants.mjs";

/**
 * Темы оформления. Тема — это набор CSS-токенов (styles/themes.css, [data-tf-theme="…"])
 * плюс вид списка: строки или плитки. У каждого пользователя своя (client).
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

/** Выбирал ли пользователь тему (окно выбора показывается один раз). */
export const themeChosen = () => game.settings.get(MODULE_ID, SETTINGS.THEME_CHOSEN);

/** Перекрасить уже нарисованные карточки в чате под новую тему. */
export function applyThemeToChat(id = currentTheme().id) {
  for (const card of document.querySelectorAll(".tf-card")) card.dataset.tfTheme = id;
}
