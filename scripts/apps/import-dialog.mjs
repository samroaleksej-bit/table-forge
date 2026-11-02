import { MODULE_ID, TEMPLATES, t } from "../constants.mjs";
import { planImport, toCreateData, contentHash, STATUS } from "../logic/import.mjs";
import { currentTheme } from "../themes.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const STATUS_ICON = {
  [STATUS.NEW]: "fa-solid fa-plus",
  [STATUS.DUP_BATCH]: "fa-solid fa-clone",
  [STATUS.DUP_WORLD]: "fa-solid fa-equals",
  [STATUS.ERROR]: "fa-solid fa-triangle-exclamation"
};

/** Пакетный импорт fvtt-RollTable-*.json: выбор файлов → отчёт с дублями → создание. */
export class ImportDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "table-forge-import",
    classes: ["table-forge", "tf-import"],
    window: { title: "TABLEFORGE.Import.Title", icon: "fa-solid fa-file-import", resizable: true },
    position: { width: 640, height: 600 },
    actions: {
      pickFiles: ImportDialog.#onPickFiles,
      runImport: ImportDialog.#onRunImport,
      reset: ImportDialog.#onReset
    }
  };

  static PARTS = {
    main: { template: `${TEMPLATES}/import.hbs`, scrollable: [".tf-import__report"] }
  };

  #plan = null;
  #keepFolders = true;
  #busy = false;
  #done = null;

  async _prepareContext() {
    const plan = this.#plan;
    return {
      isGM: game.user.isGM,
      plan: !!plan,
      busy: this.#busy,
      done: this.#done,
      keepFolders: this.#keepFolders,
      summary: plan?.summary,
      folderCount: plan?.folders.size ?? 0,
      rows: plan?.items.map((i) => ({
        file: i.file,
        name: i.name ?? i.file,
        status: i.status,
        icon: STATUS_ICON[i.status],
        label: t(`Import.Status.${i.status}`),
        note: i.status === STATUS.ERROR
          ? t(`Import.Error.${i.error}`)
          : [i.dupOf ? t("Import.DupOf", { name: i.dupOf }) : null, i.warnings?.includes("formula-inferred") ? t("Import.FormulaInferred", { formula: i.formula }) : null].filter(Boolean).join(" · "),
        formula: i.formula ?? "",
        results: i.results ?? ""
      })) ?? []
    };
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    const root = this.element;
    root.dataset.tfTheme = currentTheme().id;
    const input = root.querySelector("input[type=file]");
    input?.addEventListener("change", () => this.#readFiles([...input.files]));
    const keep = root.querySelector("input[name=keepFolders]");
    keep?.addEventListener("change", () => (this.#keepFolders = keep.checked));
    const drop = root.querySelector(".tf-dropzone");
    if (drop) {
      drop.addEventListener("dragover", (e) => {
        e.preventDefault();
        drop.classList.add("tf-over");
      });
      drop.addEventListener("dragleave", () => drop.classList.remove("tf-over"));
      drop.addEventListener("drop", (e) => {
        e.preventDefault();
        e.stopPropagation();
        drop.classList.remove("tf-over");
        this.#readFiles([...e.dataTransfer.files].filter((f) => /\.json$/i.test(f.name)));
      });
    }
  }

  async #readFiles(files) {
    if (!files.length) return;
    const loaded = await Promise.all(files.map(async (f) => ({ name: f.name, text: await f.text() })));
    this.#plan = planImport(loaded, existingTables());
    this.#done = null;
    this.render();
  }

  static #onPickFiles() {
    this.element.querySelector("input[type=file]")?.click();
  }

  static #onReset() {
    this.#plan = null;
    this.#done = null;
    this.render();
  }

  static async #onRunImport() {
    if (!this.#plan || this.#busy) return;
    if (!game.user.isGM) return ui.notifications.warn(t("Import.GMOnly"));
    this.#busy = true;
    this.render();
    try {
      this.#done = await createTables(this.#plan, { keepFolders: this.#keepFolders });
      ui.notifications.info(t("Import.Done", this.#done));
      this.#plan = null;
    } catch (err) {
      console.error(`${MODULE_ID} | импорт`, err);
      ui.notifications.error(t("Import.Failed", { error: err.message }));
    } finally {
      this.#busy = false;
      this.render();
    }
  }
}

/** Таблицы мира для поиска дублей: ключ импорта, хеш содержимого, id. */
function existingTables() {
  return game.tables.map((tbl) => {
    const importKey = tbl.getFlag(MODULE_ID, "importKey");
    return { id: tbl.id, name: tbl.name, importKey, contentHash: contentHash(tbl.toObject()) };
  });
}

async function createTables(plan, { keepFolders }) {
  const items = plan.items.filter((i) => i.status === STATUS.NEW);
  let foldersCreated = 0;
  const folderIds = new Map();
  if (keepFolders) {
    const toCreate = [];
    for (const [id, f] of plan.folders) {
      const existing = game.folders.get(id);
      if (existing?.type === "RollTable") folderIds.set(id, id);
      else if (!existing) {
        toCreate.push({ _id: id, name: f.name, type: "RollTable" });
        folderIds.set(id, id);
      }
    }
    if (toCreate.length) {
      await Folder.implementation.createDocuments(toCreate, { keepId: true });
      foldersCreated = toCreate.length;
    }
  }
  const datas = items.map((i) => toCreateData(i, MODULE_ID, folderIds.get(i.folder) ?? null));
  const CHUNK = 25;
  let created = 0;
  for (let i = 0; i < datas.length; i += CHUNK) {
    const docs = await RollTable.implementation.createDocuments(datas.slice(i, i + CHUNK));
    created += docs.length;
  }
  return {
    created,
    folders: foldersCreated,
    skipped: plan.summary.dupBatch + plan.summary.dupWorld,
    errors: plan.summary.errors
  };
}
