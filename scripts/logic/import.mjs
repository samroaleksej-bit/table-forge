import { inferFormula } from "./formula.mjs";

/**
 * Пакетный импорт экспортов fvtt-RollTable-*.json: разбор, нормализация, поиск дублей.
 * Чистая логика: создание документов делает apps/import-dialog.mjs.
 */

export const STATUS = { NEW: "new", DUP_BATCH: "dup-batch", DUP_WORLD: "dup-world", ERROR: "error" };

/** FNV-1a 32 bit: стабильный короткий хеш строки. */
export function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Хеш содержимого: название, формула и результаты (без служебных полей и _id). */
export function contentHash(data) {
  const results = (data.results ?? [])
    .map((r) => [r.type ?? "", r.name ?? "", r.description ?? "", r.documentUuid ?? "", r.range ?? [], r.weight ?? 1])
    .sort((a, b) => (a[4][0] ?? 0) - (b[4][0] ?? 0) || JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return fnv1a(JSON.stringify([data.name ?? "", data.formula ?? "", results]));
}

/** uuid источника экспорта: «RollTable.AZMaLiWO5yvJgyDQ» */
export function sourceUuid(data) {
  return data?._stats?.exportSource?.uuid ?? null;
}

export function importKey(data) {
  const src = sourceUuid(data);
  if (src) return `src:${data._stats.exportSource.worldId ?? ""}:${src}`;
  return `hash:${contentHash(data)}`;
}

const LEGACY_TYPES = { 0: "text", 1: "document", 2: "document", text: "text", document: "document", compendium: "document", pack: "document" };

/** Результат старого формата (v10–v12: text/documentCollection/documentId) → формат v13+. */
export function normalizeResult(r) {
  const out = { ...r };
  out.type = LEGACY_TYPES[r.type] ?? "text";
  if (!Array.isArray(out.range) || out.range.length !== 2) out.range = [1, 1];
  out.range = out.range.map((n) => Number(n));
  out.weight = Number(out.weight) > 0 ? Number(out.weight) : 1;
  if ("text" in r && !("description" in r) && !("name" in r)) {
    if (out.type === "document") out.name = r.text;
    else out.description = r.text;
  }
  if (out.type === "document" && !out.documentUuid && r.documentCollection && r.documentId) {
    out.documentUuid = r.documentCollection.includes(".")
      ? `Compendium.${r.documentCollection}.${r.documentId}`
      : `${r.documentCollection}.${r.documentId}`;
  }
  delete out.text;
  delete out.documentCollection;
  delete out.documentId;
  delete out._stats;
  out.drawn = false;
  return out;
}

/**
 * Разбор одного файла.
 * @returns {{ok:true, data:object, warnings:string[]} | {ok:false, error:string}}
 */
export function parseTableFile(text, filename = "") {
  let raw;
  try {
    raw = JSON.parse(String(text).replace(/^﻿/, ""));
  } catch (err) {
    return { ok: false, error: "invalid-json", detail: err.message };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "not-a-table" };
  if (typeof raw.name !== "string" || !Array.isArray(raw.results)) return { ok: false, error: "not-a-table" };
  if (raw.results.some((r) => !r || typeof r !== "object")) return { ok: false, error: "bad-results" };

  const warnings = [];
  const data = {
    name: raw.name.trim() || filename.replace(/\.json$/i, ""),
    img: raw.img ?? undefined,
    description: raw.description ?? "",
    results: raw.results.map(normalizeResult),
    formula: String(raw.formula ?? "").trim(),
    replacement: raw.replacement ?? true,
    displayRoll: raw.displayRoll ?? true,
    flags: raw.flags ?? {},
    ownership: raw.ownership ?? { default: 0 },
    _stats: raw._stats
  };
  if (!data.formula) {
    data.formula = inferFormula(data.results);
    warnings.push("formula-inferred");
  }
  if (!data.results.length) warnings.push("no-results");
  return { ok: true, data, folder: typeof raw.folder === "string" ? raw.folder : null, id: raw._id ?? null, warnings };
}

/** Название папки по названиям её таблиц: общее начало или первая таблица. */
export function deriveFolderName(names, fallback = "Импорт") {
  const list = names.filter(Boolean);
  if (!list.length) return fallback;
  const split = list.map((n) => n.split(/\s+/));
  const common = [];
  for (let i = 0; i < split[0].length; i++) {
    const w = split[0][i];
    if (split.every((s) => s[i]?.toLowerCase() === w.toLowerCase())) common.push(w);
    else break;
  }
  const prefix = common.join(" ").replace(/[\s:,.(\-–—]+$/, "");
  if (list.length > 1 && prefix.length >= 4) return prefix;
  return list.length > 1 ? `${list[0]} и др.` : list[0];
}

const COPY_SUFFIX = /\s\(\d+\)(?=\.json$)/i;

/** Копии браузера «name (1).json» идут после оригинала, чтобы дублем считалась именно копия. */
export function sortCopiesLast(files) {
  return [...files].sort((a, b) => {
    const ka = a.name.replace(COPY_SUFFIX, "");
    const kb = b.name.replace(COPY_SUFFIX, "");
    return ka.localeCompare(kb) || Number(COPY_SUFFIX.test(a.name)) - Number(COPY_SUFFIX.test(b.name));
  });
}

/**
 * План импорта.
 * @param {Array<{name:string, text:string}>} files
 * @param {Array<{id:string, importKey?:string, contentHash?:string}>} existing таблицы, уже лежащие в мире
 */
export function planImport(files, existing = []) {
  const byKey = new Map();
  const byHash = new Map();
  const byId = new Map();
  for (const e of existing) {
    if (e.importKey) byKey.set(e.importKey, e);
    if (e.contentHash) byHash.set(e.contentHash, e);
    if (e.id) byId.set(e.id, e);
  }

  const seenKey = new Map();
  const seenHash = new Map();
  const items = [];
  for (const file of sortCopiesLast(files)) {
    const parsed = parseTableFile(file.text, file.name);
    if (!parsed.ok) {
      items.push({ file: file.name, status: STATUS.ERROR, error: parsed.error, detail: parsed.detail });
      continue;
    }
    const { data } = parsed;
    const key = importKey(data);
    const hash = contentHash(data);
    const srcId = sourceUuid(data)?.split(".").pop();
    const item = { file: file.name, name: data.name, data, key, hash, folder: parsed.folder, warnings: parsed.warnings, results: data.results.length, formula: data.formula };

    const batchDup = seenKey.get(key) ?? seenHash.get(hash);
    const worldDup = byKey.get(key) ?? byHash.get(hash) ?? (srcId ? byId.get(srcId) : undefined);
    if (batchDup) Object.assign(item, { status: STATUS.DUP_BATCH, dupOf: batchDup.file });
    else {
      if (worldDup) Object.assign(item, { status: STATUS.DUP_WORLD, dupOf: worldDup.name ?? worldDup.id });
      else item.status = STATUS.NEW;
      seenKey.set(key, item);
      seenHash.set(hash, item);
    }
    items.push(item);
  }

  const folders = new Map();
  for (const item of items) {
    if (item.status !== STATUS.NEW || !item.folder) continue;
    if (!folders.has(item.folder)) folders.set(item.folder, { id: item.folder, names: [] });
    folders.get(item.folder).names.push(item.name);
  }
  for (const f of folders.values()) f.name = deriveFolderName(f.names);

  const count = (s) => items.filter((i) => i.status === s).length;
  return {
    items,
    folders,
    summary: {
      total: items.length,
      new: count(STATUS.NEW),
      dupBatch: count(STATUS.DUP_BATCH),
      dupWorld: count(STATUS.DUP_WORLD),
      errors: count(STATUS.ERROR),
      inferred: items.filter((i) => i.warnings?.includes("formula-inferred")).length
    }
  };
}

/** Данные для RollTable.create: без служебных полей источника, с флагами модуля. */
export function toCreateData(item, moduleId, folderId = null) {
  const { _stats, ...data } = item.data;
  return {
    ...data,
    folder: folderId,
    flags: { ...data.flags, [moduleId]: { ...(data.flags?.[moduleId] ?? {}), importKey: item.key, contentHash: item.hash } }
  };
}
