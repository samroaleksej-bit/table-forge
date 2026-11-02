import { MODULE_ID, SETTINGS, TEMPLATES, api, t } from "../constants.mjs";
import { THEMES, currentTheme, currentCustom, decorate } from "../themes.mjs";
import { contrast, toHex, parseHex } from "../logic/colors.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const COLOR_KEYS = { accent: "--tf-accent", bg: "--tf-bg", text: "--tf-text" };
const FONT_IDS = ["manrope", "playfair", "cormorant", "jetbrains", "foundry"];

/**
 * «Мастерская оформления»: личная настройка выбранной темы с живым превью
 * библиотеки и карточки броска. Сохраняется только у этого пользователя.
 */
export class ThemeStudio extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "table-forge-studio",
    classes: ["table-forge", "tf-studio-app"],
    window: { title: "TABLEFORGE.Studio.Title", icon: "fa-solid fa-sliders", resizable: true },
    position: { width: 900, height: 640 },
    actions: {
      reset: ThemeStudio.#onReset,
      cancel: ThemeStudio.#onCancel,
      save: ThemeStudio.#onSave
    }
  };

  static PARTS = {
    main: { template: `${TEMPLATES}/theme-studio.hbs` }
  };

  /** @param {{theme?:string}} options theme — с какой темы начать (из окна выбора) */
  constructor({ theme, ...options } = {}) {
    super(options);
    this.#draft = { ...currentCustom(), theme: theme ?? currentTheme().id };
  }

  #draft;

  #custom() {
    const { theme, ...custom } = this.#draft;
    return custom;
  }

  async _prepareContext() {
    const d = this.#draft;
    const fonts = (selected) => [{ id: "", label: t("Studio.FromTheme") }, ...FONT_IDS.map((id) => ({ id, label: t(`Studio.Font.${id}`) }))]
      .map((f) => ({ ...f, selected: (selected ?? "") === f.id }));
    const card = await api.renderTemplate(`${TEMPLATES}/chat-card.hbs`, {
      name: t("Studio.Sample.Table"),
      formula: "1d6",
      total: 4,
      ruler: { min: 1, max: 6, pos: 0.6 },
      results: [{ html: `<p>${t("Studio.Sample.Result")}</p>` }],
      multiple: false
    });
    return {
      themes: THEMES.map((th) => ({ id: th.id, label: t(`Theme.${th.id}.Name`), selected: th.id === d.theme })),
      fonts: fonts(d.font),
      fontsDisplay: fonts(d.fontDisplay),
      scale: Math.round((d.scale ?? 1) * 100),
      radius: d.radius ?? "",
      radiusValue: d.radius ?? 6,
      density: ["", "compact", "spacious"].map((id) => ({ id, label: t(`Studio.Density.${id || "normal"}`), selected: (d.density ?? "") === id })),
      view: ["", "list", "grid"].map((id) => ({ id, label: t(`Studio.View.${id || "theme"}`), selected: (d.view ?? "") === id })),
      motion: d.motion !== false,
      rows: [1, 2, 3, 4].map((n) => ({ name: t(`Studio.Sample.Row${n}`), formula: ["1d6", "1d12", "1d20", "1d8"][n - 1], count: [6, 12, 20, 8][n - 1], top: n === 1 })),
      card
    };
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    decorate(this.element, { theme: this.#draft.theme, custom: {} });
    const form = this.element.querySelector(".tf-studio__controls");
    form.addEventListener("input", (event) => this.#onInput(event));
    form.addEventListener("change", (event) => this.#onInput(event));
    const ruler = this.element.querySelector(".tf-preview-chat .tf-ruler");
    ruler?.style.setProperty("--tf-pos", ruler.dataset.pos);
    this.element.querySelector(".tf-preview-chat .tf-card")?.classList.add("tf-card--preview", "tf-fresh");
    this.#applyPreview({ fillColors: true });
  }

  #onInput(event) {
    const el = event.target;
    const key = el.name;
    if (!key) return;
    if (key === "theme") {
      if (event.type !== "change") return;
      this.#draft.theme = el.value;
      return this.render();
    }
    let value = el.type === "checkbox" ? el.checked : el.value;
    if (key === "scale") value = Number(value) / 100;
    if (key === "radius") value = Number(value);
    if (key === "motion") value = value ? undefined : false;
    if (value === "" || value === undefined) delete this.#draft[key];
    else this.#draft[key] = value;
    const out = this.element.querySelector(`output[for="tf-${key}"]`);
    if (out) out.value = key === "scale" ? `${Math.round(this.#draft.scale * 100)}%` : `${this.#draft.radius}px`;
    this.#applyPreview();
  }

  /** Перекрасить превью по черновику; подставить в поля цвета текущие значения темы. */
  #applyPreview({ fillColors = false } = {}) {
    const lib = this.element.querySelector(".tf-preview-lib");
    const card = this.element.querySelector(".tf-preview-chat .tf-card");
    const look = { theme: this.#draft.theme, custom: this.#custom() };
    decorate(lib, look);
    decorate(card, look);
    const grid = this.#draft.view ? this.#draft.view === "grid" : THEMES.find((th) => th.id === this.#draft.theme)?.view === "grid";
    lib.querySelector(".tf-rows").hidden = grid;
    lib.querySelector(".tf-grid").hidden = !grid;

    const effective = this.#effectiveColors(lib);
    if (fillColors) {
      for (const key of Object.keys(COLOR_KEYS)) {
        const input = this.element.querySelector(`input[name="${key}"]`);
        if (input) input.value = this.#draft[key] ?? effective[key];
      }
    }
    const ratio = contrast(effective.text, effective.bg);
    const note = this.element.querySelector(".tf-contrast");
    if (note) {
      note.textContent = t(ratio >= 4.5 ? "Studio.ContrastOk" : "Studio.ContrastBad", { ratio: ratio.toFixed(1) });
      note.classList.toggle("tf-bad", ratio < 4.5);
    }
  }

  /** Фактические цвета превью (тема + черновик) в виде #rrggbb. */
  #effectiveColors(lib) {
    const styles = getComputedStyle(lib);
    const content = lib.querySelector(".window-content");
    const read = (name) => cssColorToHex(styles.getPropertyValue(name));
    return {
      accent: read("--tf-accent") ?? "#b58a2a",
      bg: read("--tf-bg") ?? cssColorToHex(getComputedStyle(content).backgroundColor) ?? "#23211c",
      text: read("--tf-text") ?? cssColorToHex(getComputedStyle(content).color) ?? "#e9e4da"
    };
  }

  static #onReset() {
    this.#draft = { theme: this.#draft.theme };
    this.render();
  }

  static #onCancel() {
    this.close();
  }

  static async #onSave() {
    await game.settings.set(MODULE_ID, SETTINGS.THEME, this.#draft.theme);
    await game.settings.set(MODULE_ID, SETTINGS.THEME_CHOSEN, true);
    await game.settings.set(MODULE_ID, SETTINGS.CUSTOM, this.#custom());
    ui.notifications.info(t("Studio.Saved"));
    this.close();
  }
}

/** Любой CSS-цвет («rgb(…)», «#abc», «rgba(… , 0.5)») → #rrggbb, иначе null. */
function cssColorToHex(value) {
  const v = String(value ?? "").trim();
  if (!v || v === "transparent") return null;
  if (parseHex(v)) return toHex(parseHex(v));
  const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?/.exec(v);
  if (!m || (m[4] !== undefined && Number(m[4]) < 0.5)) return null;
  return toHex({ r: Number(m[1]), g: Number(m[2]), b: Number(m[3]) });
}
