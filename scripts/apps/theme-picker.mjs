import { MODULE_ID, SETTINGS, TEMPLATES, t } from "../constants.mjs";
import { THEMES, currentTheme, decorate } from "../themes.mjs";
import { ThemeStudio } from "./theme-studio.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Выбор темы оформления. Открывается сам при первом запуске библиотеки
 * и по кнопке-палитре в её панели.
 */
export class ThemePicker extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "table-forge-theme",
    classes: ["table-forge", "tf-theme-picker"],
    window: { title: "TABLEFORGE.Theme.Title", icon: "fa-solid fa-palette", resizable: false },
    position: { width: 760, height: "auto" },
    actions: {
      pick: ThemePicker.#onPick,
      confirm: ThemePicker.#onConfirm,
      customize: ThemePicker.#onCustomize
    }
  };

  static PARTS = {
    main: { template: `${TEMPLATES}/theme-picker.hbs` }
  };

  /** @param {{onDone?: Function}} options onDone — что открыть после выбора (библиотеку) */
  constructor({ onDone, ...options } = {}) {
    super(options);
    this.#onDone = onDone ?? null;
    this.#selected = currentTheme().id;
  }

  #onDone;
  #selected;

  /** Показать окно выбора и дождаться выбора (или закрытия). */
  static choose() {
    return new Promise((resolve) => new ThemePicker({ onDone: resolve }).render({ force: true }));
  }

  async _prepareContext() {
    return {
      themes: THEMES.map((th) => ({
        id: th.id,
        name: t(`Theme.${th.id}.Name`),
        hint: t(`Theme.${th.id}.Hint`),
        selected: th.id === this.#selected,
        grid: th.view === "grid"
      })),
      selectedName: t(`Theme.${this.#selected}.Name`)
    };
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    decorate(this.element, { theme: this.#selected, custom: {} });
  }

  static #onPick(event, target) {
    this.#selected = target.dataset.theme;
    this.render();
  }

  static async #onConfirm() {
    await game.settings.set(MODULE_ID, SETTINGS.THEME, this.#selected);
    await game.settings.set(MODULE_ID, SETTINGS.THEME_CHOSEN, true);
    const done = this.#onDone;
    this.#onDone = null;
    await this.close();
    done?.(this.#selected);
  }

  /** Настроить выбранную тему в мастерской. */
  static async #onCustomize() {
    const theme = this.#selected;
    await this.close();
    new ThemeStudio({ theme }).render({ force: true });
  }

  async close(options) {
    // Закрыли крестиком при первом запуске — считаем, что выбрана текущая тема, и больше не спрашиваем.
    if (this.#onDone) {
      await game.settings.set(MODULE_ID, SETTINGS.THEME_CHOSEN, true);
      const done = this.#onDone;
      this.#onDone = null;
      done(currentTheme().id);
    }
    return super.close(options);
  }
}
