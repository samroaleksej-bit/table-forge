/**
 * Мок-окружение Foundry v13/v14 для проверки интерфейса в браузере без сервера Foundry.
 * Реализует только то, чем пользуется модуль: ApplicationV2 + Handlebars, документы таблиц,
 * папки, настройки, чат, хуки. Запуск: python -m http.server из папки над репозиторием,
 * затем /table-forge/mock/index.html (?player=1 — взгляд игрока, ?theme=light — светлая тема).
 */

const params = new URLSearchParams(location.search);
const IS_PLAYER = params.has("player");
const MODULE_ROOT = new URL("../", import.meta.url).pathname; // /table-forge/

/* ---------------- Hooks ---------------- */
const hooks = new Map();
globalThis.Hooks = {
  on(name, fn) { if (!hooks.has(name)) hooks.set(name, []); hooks.get(name).push(fn); },
  once(name, fn) { const w = (...a) => { this.off(name, w); return fn(...a); }; this.on(name, w); },
  off(name, fn) { hooks.set(name, (hooks.get(name) ?? []).filter((f) => f !== fn)); },
  callAll(name, ...args) { for (const fn of [...(hooks.get(name) ?? [])]) fn(...args); return true; },
  call(name, ...args) { return this.callAll(name, ...args); }
};

/* ---------------- utils ---------------- */
const utils = {
  debounce(fn, ms) { let t; return function (...a) { clearTimeout(t); t = setTimeout(() => fn.apply(this, a), ms); }; },
  deepClone: (o) => structuredClone(o),
  randomID: (n = 16) => Array.from({ length: n }, () => "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"[Math.floor(Math.random() * 62)]).join("")
};

/* ---------------- i18n ---------------- */
const lang = await (await fetch(`${MODULE_ROOT}lang/ru.json`)).json();
const getPath = (obj, key) => key.split(".").reduce((o, k) => o?.[k], obj);
const i18n = {
  lang: "ru",
  localize: (key) => getPath(lang, key) ?? key,
  format: (key, data = {}) => String(getPath(lang, key) ?? key).replace(/\{(\w+)\}/g, (_, k) => data[k] ?? `{${k}}`)
};

/* ---------------- Handlebars ---------------- */
const Handlebars = globalThis.Handlebars;
Handlebars.registerHelper("localize", (key, opts) => (opts?.hash && Object.keys(opts.hash).length ? i18n.format(key, opts.hash) : i18n.localize(key)));
Handlebars.registerHelper("eq", (a, b) => a === b);
const templateCache = new Map();
async function getTemplate(path) {
  if (!templateCache.has(path)) {
    const url = path.replace(/^modules\/table-forge\//, MODULE_ROOT);
    const src = await (await fetch(url)).text();
    templateCache.set(path, Handlebars.compile(src));
  }
  return templateCache.get(path);
}
const renderTemplate = async (path, data) => (await getTemplate(path))(data);
const loadTemplates = async (paths) => Promise.all(paths.map(getTemplate));

/* ---------------- Notifications ---------------- */
function toast(type, msg) {
  const el = document.createElement("div");
  el.className = `mock-toast ${type}`;
  el.textContent = msg;
  document.getElementById("toasts").append(el);
  setTimeout(() => el.remove(), 5000);
  console[type === "error" ? "error" : "log"](`[${type}] ${msg}`);
}
globalThis.ui = { notifications: { info: (m) => toast("info", m), warn: (m) => toast("warn", m), error: (m) => toast("error", m) } };

/* ---------------- ApplicationV2 ---------------- */
let zIndex = 100;
function collectOptions(cls) {
  const chain = [];
  for (let c = cls; c && c !== Object; c = Object.getPrototypeOf(c)) if (Object.hasOwn(c, "DEFAULT_OPTIONS")) chain.unshift(c.DEFAULT_OPTIONS);
  const out = { classes: [], actions: {}, window: {}, position: {} };
  for (const o of chain) {
    out.id = o.id ?? out.id;
    out.classes = [...out.classes, ...(o.classes ?? [])];
    Object.assign(out.actions, o.actions ?? {});
    Object.assign(out.window, o.window ?? {});
    Object.assign(out.position, o.position ?? {});
  }
  return out;
}

class ApplicationV2 {
  static DEFAULT_OPTIONS = {};
  constructor() { this.options = collectOptions(this.constructor); this.element = null; }
  get rendered() { return !!this.element?.isConnected; }
  get id() { return this.options.id; }
  async _prepareContext() { return {}; }
  _onRender() {}
  bringToFront() { if (this.element) this.element.style.zIndex = ++zIndex; }
  async render(opts = {}) {
    const first = !this.element;
    if (first) this.#createFrame();
    const ctx = await this._prepareContext(opts);
    await this._renderParts(ctx, opts.parts);
    this._onRender(ctx, { ...opts, isFirstRender: first });
    if (first) this.bringToFront();
    return this;
  }
  async _renderParts() {}
  async close() { this.element?.remove(); this.element = null; return this; }
  #createFrame() {
    const o = this.options;
    const el = document.createElement("div");
    el.id = o.id;
    el.className = ["application", "themed", ...o.classes].join(" ");
    const w = o.position.width ?? 600;
    const h = o.position.height ?? 500;
    const n = document.querySelectorAll("#windows .application").length;
    Object.assign(el.style, { width: `${w}px`, height: typeof h === "number" ? `${h}px` : "auto", left: `${20 + n * 40}px`, top: `${20 + n * 30}px` });
    el.innerHTML = `<header class="window-header"><i class="${o.window.icon ?? ""}"></i><h1 class="window-title">${i18n.localize(o.window.title ?? "")}</h1><button type="button" class="header-control" data-mock-close><i class="fa-solid fa-xmark"></i></button></header><section class="window-content"></section>`;
    el.querySelector("[data-mock-close]").addEventListener("click", () => this.close());
    el.addEventListener("pointerdown", () => this.bringToFront());
    el.addEventListener("click", (event) => {
      const target = event.target.closest("[data-action]");
      if (!target || !el.contains(target)) return;
      const handler = this.options.actions[target.dataset.action];
      if (handler) handler.call(this, event, target);
    });
    document.getElementById("windows").append(el);
    this.element = el;
  }
}

function HandlebarsApplicationMixin(Base) {
  return class extends Base {
    async _renderParts(ctx, parts) {
      const content = this.element.querySelector(".window-content");
      for (const [id, part] of Object.entries(this.constructor.PARTS)) {
        if (parts && !parts.includes(id)) continue;
        const html = await renderTemplate(part.template, ctx);
        const tpl = document.createElement("template");
        tpl.innerHTML = html.trim();
        const node = tpl.content.firstElementChild;
        node.dataset.applicationPart = id;
        const old = content.querySelector(`[data-application-part="${id}"]`);
        const scroll = old?.scrollTop ?? 0;
        if (old) old.replaceWith(node); else content.append(node);
        node.scrollTop = scroll;
      }
    }
  };
}

/* ---------------- Dice ---------------- */
class Roll {
  constructor(formula) { this.formula = formula; this.total = null; }
  async evaluate() {
    const m = /^(\d*)d(\d+)\s*([+-]\s*\d+)?$/.exec(this.formula.replace(/\s/g, ""));
    if (!m) throw new Error(`Mock Roll: формула не поддерживается: ${this.formula}`);
    let total = 0;
    for (let i = 0; i < Number(m[1] || 1); i++) total += 1 + Math.floor(Math.random() * Number(m[2]));
    this.total = total + Number((m[3] ?? "0").replace(/\s/g, ""));
    return this;
  }
  toJSON() { return { formula: this.formula, total: this.total }; }
}
globalThis.Roll = Roll;

/* ---------------- Documents ---------------- */
class Collection extends Map {
  get contents() { return [...this.values()]; }
  filter(fn) { return this.contents.filter(fn); }
  map(fn) { return this.contents.map(fn); }
  find(fn) { return this.contents.find(fn); }
  some(fn) { return this.contents.some(fn); }
  [Symbol.iterator]() { return this.values(); }
}

function hasAccessor(obj, key) {
  for (let p = Object.getPrototypeOf(obj); p; p = Object.getPrototypeOf(p)) {
    const d = Object.getOwnPropertyDescriptor(p, key);
    if (d) return !!(d.get || d.set);
  }
  return false;
}

class MockDocument {
  constructor(data) {
    for (const [k, v] of Object.entries(structuredClone(data))) {
      if (!hasAccessor(this, k)) this[k] = v;
    }
    this.flags ??= {};
  }
  getFlag(scope, key) { return this.flags?.[scope]?.[key]; }
  async setFlag(scope, key, value) { return this.update({ [`flags.${scope}.${key}`]: value }); }
  async update(changes) {
    for (const [k, v] of Object.entries(changes)) {
      const keys = k.split(".");
      let o = this;
      for (const p of keys.slice(0, -1)) o = (o[p] ??= {});
      o[keys.at(-1)] = v;
    }
    Hooks.callAll(`update${this.constructor.documentName}`, this, changes);
    return this;
  }
}

class Folder extends MockDocument {
  static documentName = "Folder";
  static get implementation() { return this; }
  get folder() { return game.folders.get(this.parent) ?? null; }
  get visible() { return true; }
  static async createDocuments(datas, { keepId } = {}) {
    return datas.map((d) => {
      const f = new Folder({ ...d, _id: keepId && d._id ? d._id : utils.randomID(), sort: 0, color: null, parent: d.folder ?? null });
      f.id = f._id;
      game.folders.set(f.id, f);
      Hooks.callAll("createFolder", f);
      return f;
    });
  }
}

class TableResult extends MockDocument {
  toObject() { return structuredClone({ ...this }); }
  /** Как TableResult#getHTML в v13+: через него работают обогатители систем и модулей. */
  async getHTML() {
    let html = this.description ?? "";
    if (this.type === "document" && this.documentUuid) html = `@UUID[${this.documentUuid}]{${this.name}}` + html;
    // Имитация контент-модуля, который подключается к getHTML: @creature[wraith] → ссылка на актёра
    html = html.replace(/@creature\[([^\]|]+)[^\]]*\]/g, (_, n) => `<a class="content-link"><i class="fa-solid fa-user"></i> ${n === "wraith" ? "Умертвие" : n}</a>`);
    return TextEditor.enrichHTML(html);
  }
}

class RollTable extends MockDocument {
  static documentName = "RollTable";
  static get implementation() { return this; }
  constructor(data) {
    super(data);
    this.id ??= this._id ?? utils.randomID();
    this._id = this.id;
    this.results = new Collection((data.results ?? []).map((r) => [r._id ?? utils.randomID(), new TableResult(r)]));
    this._folderId = data.folder ?? null;
    delete this.folder;
  }
  get uuid() { return this.pack ? `Compendium.${this.pack}.RollTable.${this.id}` : `RollTable.${this.id}`; }
  get folder() { return game.folders.get(this._folderId) ?? null; }
  get isOwner() { return game.user.isGM; }
  testUserPermission(user) { return user.isGM || (this.ownership?.default ?? 0) >= 2; }
  get sheet() { return { render: () => toast("info", `Лист таблицы «${this.name}» (в моке не реализован)`) }; }
  toObject() {
    const { results, _folderId, ...rest } = this;
    return structuredClone({ ...rest, folder: _folderId, results: results.map((r) => r.toObject()) });
  }
  async roll({ roll } = {}) {
    roll ??= new Roll(this.formula);
    await roll.evaluate();
    const results = this.results.filter((r) => !r.drawn && r.range[0] <= roll.total && roll.total <= r.range[1]);
    return { roll, results };
  }
  async draw(options = {}) {
    const out = await this.roll(options);
    if (!this.replacement) for (const r of out.results) r.drawn = true;
    return out;
  }
  static async createDocuments(datas) {
    return datas.map((d) => {
      const t = new RollTable({ ...d, _id: utils.randomID() });
      game.tables.set(t.id, t);
      Hooks.callAll("createRollTable", t);
      return t;
    });
  }
}
globalThis.Folder = Folder;
globalThis.RollTable = RollTable;

/* Компендиум с таблицами (для дерева) */
class MockPack {
  constructor(collection, title, tables) {
    this.collection = collection;
    this.title = title;
    this.documentName = "RollTable";
    this.visible = true;
    this.tables = tables.map((d) => Object.assign(new RollTable(d), { pack: collection }));
  }
  async getIndex() {
    return this.tables.map((t) => ({ _id: t.id, uuid: t.uuid, name: t.name, img: t.img, formula: t.formula, results: t.results.map((r) => r.toObject()) }));
  }
}

/* ---------------- Chat ---------------- */
class ChatMessage extends MockDocument {
  static documentName = "ChatMessage";
  static get implementation() { return this; }
  static getSpeaker({ alias } = {}) { return { alias }; }
  static async create(data) {
    const m = new ChatMessage({ ...data, id: utils.randomID(), author: game.user.id, timestamp: Date.now() });
    m.rolls = (data.rolls ?? []).map((r) => (r.toJSON ? r.toJSON() : r));
    game.messages.set(m.id, m);
    m.render();
    return m;
  }
  get isAuthor() { return this.author === game.user.id; }
  async update(changes) { Object.assign(this, changes); this.render(); return this; }
  render() {
    const log = document.getElementById("chat-log");
    let li = log.querySelector(`[data-message-id="${this.id}"]`);
    const fresh = document.createElement("li");
    fresh.className = `chat-message message${this.whisper?.length ? " whisper" : ""}`;
    fresh.dataset.messageId = this.id;
    const to = this.whisper?.length ? `<span class="whisper-to">Шёпот: ${this.whisper.map((id) => game.users.get(id)?.name).join(", ")}</span>` : "";
    fresh.innerHTML = `<header class="message-header"><strong>${this.speaker?.alias ?? ""}</strong>${to}</header><div class="message-content">${this.content}</div>`;
    if (li) li.replaceWith(fresh); else log.append(fresh);
    log.scrollTop = log.scrollHeight;
    Hooks.callAll("renderChatMessageHTML", this, fresh, {});
  }
}
globalThis.ChatMessage = ChatMessage;

/* ---------------- TextEditor ---------------- */
const TextEditor = {
  async enrichHTML(html) {
    return String(html)
      .replace(/@UUID\[([^\]]+)\]\{([^}]*)\}/g, (_, uuid, label) => `<a class="content-link" data-uuid="${uuid}"><i class="fa-solid fa-file-lines"></i> ${label}</a>`)
      .replace(/\[\[\/(\w+)\s+([^\]]+)\]\]/g, (_, cmd, f) => `<a class="inline-roll roll"><i class="fa-solid fa-dice-d20"></i> ${cmd === "r" ? f : `${cmd} ${f}`}</a>`)
      .replace(/\[\[([^\]]+)\]\]/g, (_, f) => `<a class="inline-roll inline-result" title="${f}"><i class="fa-solid fa-dice-d20"></i> ${1 + Math.floor(Math.random() * 20)}</a>`);
  }
};

/* ---------------- game ---------------- */
const gm = { id: "gm000000000000", name: "Алексей", isGM: true };
const p1 = { id: "pl100000000000", name: "Игрок 1", isGM: false };
const p2 = { id: "pl200000000000", name: "Игрок 2", isGM: false };
const settingsDefs = new Map();
const settingsValues = new Map();
const keybindings = [];

globalThis.CONFIG = { sounds: { dice: "sounds/dice.wav" } };
globalThis.game = {
  i18n,
  system: { id: "dnd5e" },
  user: IS_PLAYER ? p1 : gm,
  users: new Collection([gm, p1, p2].map((u) => [u.id, u])),
  tables: new Collection(),
  folders: new Collection(),
  packs: new Collection(),
  messages: new Collection(),
  modules: new Collection([["table-forge", { id: "table-forge", active: true }]]),
  settings: {
    register(ns, key, def) { settingsDefs.set(`${ns}.${key}`, def); },
    get(ns, key) { const k = `${ns}.${key}`; return structuredClone(settingsValues.has(k) ? settingsValues.get(k) : settingsDefs.get(k)?.default); },
    async set(ns, key, value) { settingsValues.set(`${ns}.${key}`, structuredClone(value)); settingsDefs.get(`${ns}.${key}`)?.onChange?.(value); return value; }
  },
  keybindings: { register(ns, key, def) { keybindings.push(def); } }
};

globalThis.fromUuidSync = (uuid) => {
  const [type, id] = uuid.split(".");
  if (type === "RollTable") return game.tables.get(id) ?? null;
  if (type === "Compendium") {
    const coll = uuid.split(".").slice(1, 3).join(".");
    const pack = game.packs.get(coll);
    return pack?.tables.find((t) => t.uuid === uuid) ?? null;
  }
  return null;
};
globalThis.fromUuid = async (uuid) => fromUuidSync(uuid);

globalThis.foundry = {
  utils,
  applications: {
    api: { ApplicationV2, HandlebarsApplicationMixin },
    handlebars: { renderTemplate, loadTemplates },
    ux: { TextEditor: { implementation: TextEditor } }
  }
};

document.addEventListener("keydown", (event) => {
  for (const kb of keybindings) {
    for (const b of kb.editable ?? []) {
      const mods = b.modifiers ?? [];
      if (event.code === b.key && mods.includes("Alt") === event.altKey && mods.includes("Control") === event.ctrlKey && mods.includes("Shift") === event.shiftKey) {
        event.preventDefault();
        kb.onDown();
      }
    }
  }
});

// Битые картинки (icons/svg/*, модули, которых нет в моке) → нейтральная заглушка
const PLACEHOLDER = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#8a8580" d="M12 2 3 7v10l9 5 9-5V7zm0 2.3 6.6 3.7L12 11.7 5.4 8zM5 9.7l6 3.4v6.6l-6-3.4zm8 10V13l6-3.4v6.7z"/></svg>');
document.addEventListener("error", (e) => {
  if (e.target.tagName === "IMG" && !e.target.src.startsWith("data:")) e.target.src = PLACEHOLDER;
}, true);

/* ---------------- Тестовые данные ---------------- */
async function listDataFiles() {
  const html = await (await fetch("/")).text();
  return [...html.matchAll(/href="([^"]*fvtt-RollTable-[^"]+\.json)"/g)].map((m) => decodeURIComponent(m[1]));
}

async function loadFiles() {
  const names = await listDataFiles();
  return Promise.all(names.map(async (name) => new File([await (await fetch(`/${encodeURIComponent(name)}`)).text()], name, { type: "application/json" })));
}

window.tfMock = {
  RollTable, Folder, game,
  /** Подложить все тестовые файлы в открытое окно импорта (как будто выбрали в диалоге). */
  async feedImport() {
    const input = document.querySelector("#table-forge-import input[type=file]");
    if (!input) throw new Error("окно импорта не открыто");
    const dt = new DataTransfer();
    for (const f of await loadFiles()) dt.items.add(f);
    input.files = dt.files;
    input.dispatchEvent(new Event("change"));
    return dt.files.length;
  },
  /** Сразу заполнить мир таблицами (без окна импорта) — для вида игрока. */
  async seedWorld({ ownership = 0 } = {}) {
    const files = await loadFiles();
    const { planImport, toCreateData } = await import(`${MODULE_ROOT}scripts/logic/import.mjs`);
    const plan = planImport(await Promise.all(files.map(async (f) => ({ name: f.name, text: await f.text() }))));
    await Folder.createDocuments([...plan.folders.values()].map((f) => ({ _id: f.id, name: f.name, type: "RollTable" })), { keepId: true });
    const items = plan.items.filter((i) => i.status === "new");
    await RollTable.createDocuments(items.map((i, n) => ({ ...toCreateData(i, "table-forge", i.folder), ownership: { default: n % 4 === 0 ? 2 : ownership } })));
    return items.length;
  },
  /** Вложенные папки и таблица с @creature — для проверки дерева и обогащения. */
  async addExtras() {
    const [root] = await Folder.createDocuments([{ name: "Сокровища", type: "RollTable" }]);
    for (const f of game.folders) if (/^(Драгоценный камень|Предметы искусства)/.test(f.name)) f.parent = root.id;
    const [sub] = await Folder.createDocuments([{ name: "Мелочь", type: "RollTable", folder: root.id }]);
    await RollTable.createDocuments([{
      name: "К30. Королевский счетовод", formula: "1d4", folder: sub.id, replacement: true,
      results: [1, 2, 3, 4].map((n) => ({ _id: `r${n}`, type: "text", range: [n, n], weight: 1, name: "",
        description: n === 4 ? "1 @creature[wraith] and [[/r 1d4 + 1]] @creature[Specter||specters]" : `${n} @creature[wraith]` }))
    }]);
  },
  async addPack() {
    const files = (await loadFiles()).slice(0, 3);
    const tables = await Promise.all(files.map(async (f) => JSON.parse(await f.text())));
    const pack = new MockPack("world.demo-tables", "Демо-компендиум", tables);
    game.packs.set(pack.collection, pack);
  }
};

/* ---------------- Запуск ---------------- */
if (params.get("theme") === "light") document.body.classList.replace("theme-dark", "theme-light");
document.getElementById("whoami").textContent = IS_PLAYER ? "Вы: Игрок 1" : "Вы: Мастер";
await import(`${MODULE_ROOT}scripts/main.mjs`);
Hooks.callAll("init");
Hooks.callAll("ready");
const sidebar = document.getElementById("tables-directory");
Hooks.callAll("renderRollTableDirectory", {}, sidebar, {});
if (params.has("seed")) { await tfMock.addPack(); await tfMock.seedWorld(); await tfMock.addExtras(); }
window.tfMockReady = true;
