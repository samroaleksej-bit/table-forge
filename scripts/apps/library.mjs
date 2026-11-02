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
    position: { width: 880, height: 640 },
    actions: {
      selectFolder: TableLibrary.#onSelectFolder,
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

  #folder = "all";
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

  #folderTree(entries) {
    const counts = new Map();
    for (const e of entries) if (!e.pack) counts.set(e.folderId, (counts.get(e.folderId) ?? 0) + 1);
    const folders = game.folders.filter((f) => f.type === "RollTable" && f.visible !== false);
    const byParent = new Map();
    for (const f of folders) {
      const parent = f.folder?.id ?? null;
      if (!byParent.has(parent)) byParent.set(parent, []);
      byParent.get(parent).push(f);
    }
    // Игрок не видит папки, в которых (вместе с подпапками) нет доступных ему таблиц.
    const total = (id) => (counts.get(id) ?? 0) + (byParent.get(id) ?? []).reduce((sum, f) => sum + total(f.id), 0);
    const out = [];
    const walk = (parent, depth) => {
      const children = (byParent.get(parent) ?? []).sort((a, b) => (a.sort - b.sort) || a.name.localeCompare(b.name));
      for (const f of children) {
        if (!game.user.isGM && !total(f.id)) continue;
        out.push({ id: f.id, name: f.name, depth, indent: depth * 12, color: f.color?.css ?? f.color ?? null, count: counts.get(f.id) ?? 0, active: this.#folder === f.id });
        walk(f.id, depth + 1);
      }
    };
    walk(null, 0);
    return { folders: out, unfiled: counts.get(null) ?? 0 };
  }

  #descendantFolderIds(id) {
    const ids = new Set([id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const f of game.folders) {
        if (f.type === "RollTable" && f.folder && ids.has(f.folder.id) && !ids.has(f.id)) {
          ids.add(f.id);
          grew = true;
        }
      }
    }
    return ids;
  }

  #filterByFolder(entries) {
    const f = this.#folder;
    if (f === "all") return entries;
    if (f === "fav") {
      const fav = new Set(getSetting(SETTINGS.FAVORITES));
      return entries.filter((e) => fav.has(e.uuid));
    }
    if (f === "recent") {
      const order = getSetting(SETTINGS.RECENT);
      const pos = new Map(order.map((uuid, i) => [uuid, i]));
      return entries.filter((e) => pos.has(e.uuid)).sort((a, b) => pos.get(a.uuid) - pos.get(b.uuid));
    }
    if (f === "unfiled") return entries.filter((e) => !e.pack && !e.folderId);
    if (f.startsWith("pack:")) return entries.filter((e) => e.pack === f.slice(5));
    const ids = this.#descendantFolderIds(f);
    return entries.filter((e) => !e.pack && ids.has(e.folderId));
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
    const folderNames = new Map(game.folders.filter((f) => f.type === "RollTable").map((f) => [f.id, f.name]));

    const scoped = this.#filterByFolder(all);
    const hits = this.#query ? search(scoped, this.#query).map((h) => h.entry) : scoped;
    const shown = hits.slice(0, LIST_LIMIT);

    const tree = this.#folderTree(world);
    const packCounts = new Map();
    for (const e of packs) packCounts.set(e.pack, (packCounts.get(e.pack) ?? 0) + 1);

    return {
      isGM: game.user.isGM,
      query: this.#query,
      mode: getSetting(SETTINGS.DEFAULT_MODE),
      specials: [
        { id: "all", label: t("Library.All"), icon: "fa-solid fa-layer-group", count: all.length },
        { id: "fav", label: t("Library.Favorites"), icon: "fa-solid fa-star", count: all.filter((e) => favorites.has(e.uuid)).length },
        { id: "recent", label: t("Library.Recent"), icon: "fa-solid fa-clock-rotate-left", count: all.filter((e) => recent.includes(e.uuid)).length }
      ].map((s) => ({ ...s, active: this.#folder === s.id })),
      folders: tree.folders,
      unfiled: { count: tree.unfiled, active: this.#folder === "unfiled" },
      packs: [...packCounts].map(([id, count]) => ({
        id: `pack:${id}`,
        label: game.packs.get(id)?.title ?? id,
        count,
        active: this.#folder === `pack:${id}`
      })),
      rows: shown.map((e) => ({
        uuid: e.uuid,
        name: e.name,
        img: usableImage(e.img, (id) => !!game.modules.get(id)?.active) ?? "icons/svg/d20-grey.svg",
        formula: e.formula || "—",
        count: e.count,
        rollCount: e.rollCount,
        fav: favorites.has(e.uuid),
        where: e.pack ? e.packLabel : (folderNames.get(e.folderId) ?? "")
      })),
      total: hits.length,
      truncated: hits.length > shown.length,
      empty: !hits.length,
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

  static #onSelectFolder(event, target) {
    this.#folder = target.dataset.folder;
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
