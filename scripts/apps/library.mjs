import { MODULE_ID, SETTINGS, TEMPLATES, t } from "../constants.mjs";
import { getSetting, setSetting } from "../settings.mjs";
import { buildSearchEntry, search } from "../logic/search.mjs";
import { previewRows, usableImage } from "../logic/results.mjs";
import { escapeHTML } from "../logic/text.mjs";
import { rollTable } from "../roll.mjs";
import { ImportDialog } from "./import-dialog.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const LIST_LIMIT = 300;

/** «Кузница таблиц»: дерево папок и компендиумов слева, список с поиском справа. */
export class TableLibrary extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "table-forge-library",
    classes: ["table-forge", "tf-library"],
    window: { title: "TABLEFORGE.Library.Title", icon: "fa-solid fa-table-list", resizable: true },
    position: { width: 980, height: 660 },
    actions: {
      selectFolder: TableLibrary.#onSelectFolder,
      toggleExpand: TableLibrary.#onToggleExpand,
      goUp: TableLibrary.#onGoUp,
      searchAll: TableLibrary.#onSearchAll,
      roll: TableLibrary.#onRoll,
      toggleFavorite: TableLibrary.#onToggleFavorite,
      openSheet: TableLibrary.#onOpenSheet,
      openImport: () => new ImportDialog().render({ force: true }),
      clearSearch: TableLibrary.#onClearSearch
    }
  };

  static PARTS = {
    toolbar: { template: `${TEMPLATES}/library-toolbar.hbs` },
    tree: { template: `${TEMPLATES}/library-tree.hbs`, scrollable: [""] },
    list: { template: `${TEMPLATES}/library-list.hbs`, scrollable: [""] }
  };

  static #instance = null;

  static get instance() {
    return (TableLibrary.#instance ??= new TableLibrary());
  }

  static toggle() {
    const app = TableLibrary.instance;
    if (app.rendered) app.close();
    else app.render({ force: true });
  }

  /** Перерисовать, если окно открыто (после изменения таблиц или папок). */
  static refresh() {
    const app = TableLibrary.#instance;
    if (!app?.rendered) return;
    app.#worldEntries = null;
    app.#refreshDebounced();
  }

  #folder = "root";
  #query = "";
  #worldEntries = null;
  #packEntries = null;
  #previewTimer = null;
  #refreshDebounced = foundry.utils.debounce(() => this.render(), 150);
  #searchDebounced = foundry.utils.debounce(() => this.render({ parts: ["list"] }), 120);

  /* -------------------------------------------- */
  /*  Данные                                       */
  /* -------------------------------------------- */

  #getWorldEntries() {
    if (this.#worldEntries) return this.#worldEntries;
    const user = game.user;
    this.#worldEntries = game.tables
      .filter((tbl) => user.isGM || tbl.testUserPermission(user, "OBSERVER"))
      .map((tbl) => {
        const results = tbl.results.contents.map((r) => ({ name: r.name, description: r.description, range: r.range, type: r.type }));
        return buildSearchEntry({ name: tbl.name, results }, {
          uuid: tbl.uuid,
          img: tbl.img,
          formula: tbl.formula,
          count: results.length,
          folderId: tbl.folder?.id ?? null,
          pack: null,
          rollCount: tbl.getFlag(MODULE_ID, "rollCount") ?? 0,
          results
        });
      });
    return this.#worldEntries;
  }

  async #getPackEntries() {
    if (this.#packEntries) return this.#packEntries;
    const packs = game.packs.filter((p) => p.documentName === "RollTable" && p.visible);
    const entries = [];
    for (const pack of packs) {
      let index;
      try {
        index = await pack.getIndex({ fields: ["formula", "img", "results"] });
      } catch (err) {
        console.warn(`${MODULE_ID} | не удалось прочитать индекс ${pack.collection}`, err);
        continue;
      }
      for (const e of index) {
        const results = Array.isArray(e.results) ? e.results : [];
        entries.push(buildSearchEntry({ name: e.name, results }, {
          uuid: e.uuid ?? `Compendium.${pack.collection}.RollTable.${e._id}`,
          img: e.img,
          formula: e.formula ?? "",
          count: results.length,
          folderId: null,
          pack: pack.collection,
          packLabel: pack.title,
          rollCount: 0,
          results
        }));
      }
    }
    return (this.#packEntries = entries);
  }

  /** Модель папок мира: прямые счётчики, дети, итоги с подпапками, путь к корню. */
  #folderModel(world) {
    const direct = new Map();
    for (const e of world) direct.set(e.folderId, (direct.get(e.folderId) ?? 0) + 1);
    const folders = game.folders.filter((f) => f.type === "RollTable");
    const byId = new Map(folders.map((f) => [f.id, f]));
    const children = new Map();
    for (const f of folders) {
      const parent = f.folder?.id ?? null;
      if (!children.has(parent)) children.set(parent, []);
      children.get(parent).push(f);
    }
    const memo = new Map();
    const total = (id) => {
      if (!memo.has(id)) memo.set(id, (direct.get(id) ?? 0) + (children.get(id) ?? []).reduce((sum, f) => sum + total(f.id), 0));
      return memo.get(id);
    };
    // Игрок не видит папки, в которых (вместе с подпапками) нет доступных ему таблиц.
    const kids = (id) => (children.get(id) ?? [])
      .filter((f) => game.user.isGM || total(f.id) > 0)
      .sort((a, b) => (a.sort - b.sort) || a.name.localeCompare(b.name));
    const path = (id) => {
      const out = [];
      for (let f = byId.get(id); f; f = f.folder) out.unshift(f);
      return out;
    };
    return { byId, total, kids, path };
  }

  #descendantFolderIds(model, id) {
    const ids = new Set([id]);
    const walk = (fid) => {
      for (const f of model.kids(fid)) {
        ids.add(f.id);
        walk(f.id);
      }
    };
    walk(id);
    return ids;
  }

  /** Таблицы текущего места. Без поиска — как в проводнике: только то, что лежит прямо здесь. */
  #scopeEntries(world, packs, model) {
    const f = this.#folder;
    const searching = !!this.#query;
    if (f === "all") return [...world, ...packs];
    if (f === "fav") {
      const fav = new Set(getSetting(SETTINGS.FAVORITES));
      return [...world, ...packs].filter((e) => fav.has(e.uuid));
    }
    if (f === "recent") {
      const pos = new Map(getSetting(SETTINGS.RECENT).map((uuid, i) => [uuid, i]));
      return [...world, ...packs].filter((e) => pos.has(e.uuid)).sort((a, b) => pos.get(a.uuid) - pos.get(b.uuid));
    }
    if (f === "root") return searching ? [...world, ...packs] : world.filter((e) => !e.folderId);
    if (f.startsWith("pack:")) return packs.filter((e) => e.pack === f.slice(5));
    if (!searching) return world.filter((e) => e.folderId === f);
    const ids = this.#descendantFolderIds(model, f);
    return world.filter((e) => ids.has(e.folderId));
  }

  #isFolder(id) {
    return !!id && !["all", "fav", "recent", "root"].includes(id) && !id.startsWith("pack:");
  }

  /* -------------------------------------------- */
  /*  Рендер                                       */
  /* -------------------------------------------- */

  async _prepareContext() {
    const world = this.#getWorldEntries();
    const packs = await this.#getPackEntries();
    const all = [...world, ...packs];
    const favorites = new Set(getSetting(SETTINGS.FAVORITES));
    const recent = getSetting(SETTINGS.RECENT);
    const expanded = new Set(getSetting(SETTINGS.EXPANDED));
    const model = this.#folderModel(world);

    // Выбранная папка могла исчезнуть (удалили) — возвращаемся в корень.
    if (this.#isFolder(this.#folder) && !model.byId.has(this.#folder)) this.#folder = "root";
    const current = this.#isFolder(this.#folder) ? this.#folder : null;
    const ancestors = new Set(current ? model.path(current).slice(0, -1).map((f) => f.id) : []);

    // Дерево: раскрыты папки из настроек и все предки выбранной.
    const tree = [];
    const walk = (parent, depth) => {
      for (const f of model.kids(parent)) {
        const hasChildren = model.kids(f.id).length > 0;
        const isOpen = hasChildren && (expanded.has(f.id) || ancestors.has(f.id));
        tree.push({
          id: f.id,
          name: f.name,
          indent: 8 + depth * 14,
          color: f.color?.css ?? f.color ?? null,
          count: model.total(f.id),
          hasChildren,
          expanded: isOpen,
          active: f.id === current,
          onPath: ancestors.has(f.id)
        });
        if (isOpen) walk(f.id, depth + 1);
      }
    };
    walk(null, 1);

    const searching = !!this.#query;
    const scoped = this.#scopeEntries(world, packs, model);
    const hits = searching ? search(scoped, this.#query).map((h) => h.entry) : scoped;
    const shown = hits.slice(0, LIST_LIMIT);

    // Подпапки в списке справа — только при просмотре (не при поиске).
    let subfolders = [];
    if (!searching && (this.#folder === "root" || current)) {
      subfolders = model.kids(current).map((f) => ({
        id: f.id,
        name: f.name,
        color: f.color?.css ?? f.color ?? null,
        count: model.total(f.id),
        sub: model.kids(f.id).length
      }));
    }

    const packCounts = new Map();
    for (const e of packs) packCounts.set(e.pack, (packCounts.get(e.pack) ?? 0) + 1);
    const packTitle = (id) => game.packs.get(id)?.title ?? id;

    // Хлебные крошки и «Наверх»
    const specialLabel = { all: t("Library.All"), fav: t("Library.Favorites"), recent: t("Library.Recent") };
    let crumbs;
    let up = null;
    if (current) {
      const path = model.path(current);
      crumbs = [{ id: "root", label: t("Library.World") }, ...path.map((f) => ({ id: f.id, label: f.name }))];
      up = path.length > 1 ? path.at(-2).id : "root";
    } else if (this.#folder.startsWith("pack:")) {
      crumbs = [{ id: null, label: t("Library.Compendiums") }, { id: this.#folder, label: packTitle(this.#folder.slice(5)) }];
    } else if (this.#folder === "root") {
      crumbs = [{ id: "root", label: t("Library.World") }];
    } else {
      crumbs = [{ id: this.#folder, label: specialLabel[this.#folder] }];
    }
    crumbs.at(-1).current = true;

    const showWhere = searching || ["all", "fav", "recent"].includes(this.#folder);
    const folderLabel = (id) => model.path(id).map((f) => f.name).join(" / ");

    return {
      isGM: game.user.isGM,
      query: this.#query,
      mode: getSetting(SETTINGS.DEFAULT_MODE),
      specials: [
        { id: "all", label: t("Library.All"), icon: "fa-solid fa-layer-group", count: all.length },
        { id: "fav", label: t("Library.Favorites"), icon: "fa-solid fa-star", count: all.filter((e) => favorites.has(e.uuid)).length },
        { id: "recent", label: t("Library.Recent"), icon: "fa-solid fa-clock-rotate-left", count: all.filter((e) => recent.includes(e.uuid)).length }
      ].map((s) => ({ ...s, active: this.#folder === s.id })),
      worldRoot: { active: this.#folder === "root", count: world.length },
      folders: tree,
      packs: [...packCounts].map(([id, count]) => ({ id: `pack:${id}`, label: packTitle(id), count, active: this.#folder === `pack:${id}` })),
      crumbs,
      up,
      searching,
      scopeLabel: crumbs.at(-1).label,
      canSearchAll: searching && this.#folder !== "all" && this.#folder !== "root",
      subfolders,
      rows: shown.map((e) => ({
        uuid: e.uuid,
        name: e.name,
        img: usableImage(e.img, (id) => !!game.modules.get(id)?.active) ?? "icons/svg/d20-grey.svg",
        formula: e.formula || "—",
        count: e.count,
        rollCount: e.rollCount,
        fav: favorites.has(e.uuid),
        where: showWhere ? (e.pack ? e.packLabel : (e.folderId ? folderLabel(e.folderId) : t("Library.World"))) : ""
      })),
      total: hits.length,
      truncated: hits.length > shown.length,
      empty: !hits.length && !subfolders.length,
      hasAny: all.length > 0
    };
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    const root = this.element;
    const input = root.querySelector("input[name=tf-search]");
    if (input && !input.dataset.bound) {
      input.dataset.bound = "1";
      input.addEventListener("input", () => {
        this.#query = input.value;
        this.#searchDebounced();
      });
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          const first = root.querySelector(".tf-row[data-uuid]");
          if (first) rollTable(first.dataset.uuid);
        } else if (event.key === "Backspace" && !input.value) {
          // Как в проводнике: Backspace в пустом поиске — на уровень вверх.
          const up = root.querySelector(".tf-crumbs [data-action=goUp]");
          if (up) {
            event.preventDefault();
            this.#navigate(up.dataset.folder);
          }
        } else if (event.key === "Escape" && input.value) {
          event.stopPropagation();
          input.value = "";
          this.#query = "";
          this.render({ parts: ["list"] });
        }
      });
      if (options.isFirstRender) input.focus();
    }
    const modeSelect = root.querySelector("select[name=tf-mode]");
    if (modeSelect && !modeSelect.dataset.bound) {
      modeSelect.dataset.bound = "1";
      modeSelect.addEventListener("change", () => setSetting(SETTINGS.DEFAULT_MODE, modeSelect.value));
    }
    for (const row of root.querySelectorAll(".tf-row--folder")) {
      row.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          this.#navigate(row.dataset.folder);
        }
      });
    }
    for (const row of root.querySelectorAll(".tf-row[data-uuid]")) {
      row.addEventListener("mouseenter", () => this.#schedulePreview(row));
      row.addEventListener("mouseleave", () => this.#hidePreview());
      row.addEventListener("dblclick", (event) => {
        if (!event.target.closest("button")) rollTable(row.dataset.uuid);
      });
    }
  }

  async close(options) {
    this.#hidePreview();
    return super.close(options);
  }

  /* -------------------------------------------- */
  /*  Предпросмотр при наведении                   */
  /* -------------------------------------------- */

  #schedulePreview(row) {
    clearTimeout(this.#previewTimer);
    this.#previewTimer = setTimeout(() => this.#showPreview(row), 350);
  }

  #hidePreview() {
    clearTimeout(this.#previewTimer);
    this.element?.querySelector(".tf-preview")?.remove();
  }

  #showPreview(row) {
    this.#hidePreview();
    const entry = [...(this.#worldEntries ?? []), ...(this.#packEntries ?? [])].find((e) => e.uuid === row.dataset.uuid);
    if (!entry || !row.isConnected) return;
    const { rows, more } = previewRows(entry.results);
    const pop = document.createElement("div");
    pop.className = "tf-preview";
    pop.innerHTML = `<header><strong>${escapeHTML(entry.name)}</strong><span>${escapeHTML(entry.formula || "")}</span></header>
      <ol>${rows.map((r) => `<li><span class="tf-range">${escapeHTML(r.range)}</span><span>${escapeHTML(r.text)}</span></li>`).join("")}</ol>
      ${more ? `<footer>${escapeHTML(t("Library.PreviewMore", { count: more }))}</footer>` : ""}`;
    const host = this.element.querySelector(".window-content");
    host.append(pop);
    const hostBox = host.getBoundingClientRect();
    const rowBox = row.getBoundingClientRect();
    const top = Math.min(rowBox.bottom - hostBox.top + 4, host.clientHeight - pop.offsetHeight - 8);
    pop.style.top = `${Math.max(8, top)}px`;
  }

  /* -------------------------------------------- */
  /*  Действия                                     */
  /* -------------------------------------------- */

  /** Перейти в папку (дерево, папка в списке, хлебные крошки). Поиск сбрасывается, как в проводнике. */
  #navigate(folder) {
    if (!folder) return;
    this.#folder = folder;
    this.#query = "";
    const input = this.element.querySelector("input[name=tf-search]");
    if (input) input.value = "";
    this.#hidePreview();
    this.render({ parts: ["tree", "list"] });
  }

  #pathIds(id) {
    const out = [];
    for (let f = game.folders.get(id); f; f = f.folder) out.push(f.id);
    return out;
  }

  static #onSelectFolder(event, target) {
    this.#navigate(target.dataset.folder);
  }

  static async #onToggleExpand(event, target) {
    event.stopPropagation();
    const id = target.dataset.folder;
    const expanded = new Set(getSetting(SETTINGS.EXPANDED));
    const wasOpen = target.closest("[aria-expanded]")?.getAttribute("aria-expanded") === "true";
    if (wasOpen) expanded.delete(id);
    else expanded.add(id);
    await setSetting(SETTINGS.EXPANDED, [...expanded]);
    // Свернули ветку с выбранной папкой внутри — выбор поднимается на свёрнутую папку.
    if (wasOpen && this.#isFolder(this.#folder) && this.#folder !== id && this.#pathIds(this.#folder).includes(id)) {
      return this.#navigate(id);
    }
    this.render({ parts: ["tree"] });
  }

  static #onGoUp(event, target) {
    this.#navigate(target.dataset.folder);
  }

  /** Ничего не нашлось в папке — искать то же самое во всех таблицах. */
  static #onSearchAll() {
    this.#folder = "all";
    this.render({ parts: ["tree", "list"] });
  }

  static async #onRoll(event, target) {
    const uuid = target.closest("[data-uuid]")?.dataset.uuid;
    if (!uuid) return;
    target.classList.add("tf-rolling");
    target.addEventListener("animationend", () => target.classList.remove("tf-rolling"), { once: true });
    await rollTable(uuid);
  }

  static async #onToggleFavorite(event, target) {
    const uuid = target.closest("[data-uuid]")?.dataset.uuid;
    const fav = new Set(getSetting(SETTINGS.FAVORITES));
    if (fav.has(uuid)) fav.delete(uuid);
    else fav.add(uuid);
    await setSetting(SETTINGS.FAVORITES, [...fav]);
    this.render({ parts: ["tree", "list"] });
  }

  static async #onOpenSheet(event, target) {
    const doc = await fromUuid(target.closest("[data-uuid]")?.dataset.uuid);
    doc?.sheet?.render(true);
  }

  static #onClearSearch() {
    this.#query = "";
    const input = this.element.querySelector("input[name=tf-search]");
    if (input) input.value = "";
    this.render({ parts: ["list"] });
  }
}
