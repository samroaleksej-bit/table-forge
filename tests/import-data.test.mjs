/**
 * Импорт на реальных экспортах Алексея. Файлы в репозиторий не входят:
 * по умолчанию ищутся в родительской папке репозитория (H:\Модуль на таблицы),
 * или в TF_DATA_DIR. Если файлов нет (CI) — тесты пропускаются.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { planImport, STATUS, toCreateData } from "../scripts/logic/import.mjs";
import { buildSearchEntry, search } from "../scripts/logic/search.mjs";
import { resultSourceHTML } from "../scripts/logic/results.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = process.env.TF_DATA_DIR ?? path.resolve(here, "..", "..");
const names = fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => /^fvtt-RollTable-.*\.json$/i.test(n)) : [];
const skip = names.length ? false : `нет тестовых файлов в ${dir}`;
const files = names.map((name) => ({ name, text: fs.readFileSync(path.join(dir, name), "utf8") }));

test("найден 101 файл", { skip }, () => {
  assert.equal(files.length, 101);
});

test("все файлы разбираются без ошибок, 14 дублей пойманы", { skip }, () => {
  const plan = planImport(files);
  const errors = plan.items.filter((i) => i.status === STATUS.ERROR);
  assert.deepEqual(errors, []);
  assert.equal(plan.summary.new, 87);
  assert.equal(plan.summary.dupBatch, 14);
  for (const dup of plan.items.filter((i) => i.status === STATUS.DUP_BATCH)) {
    assert.match(dup.file, / \(1\)\.json$/, "дублем считается копия, а не оригинал");
  }
});

test("пустая формула выведена из диапазонов (Dungeon Decay → 1d6)", { skip }, () => {
  const plan = planImport(files);
  const decay = plan.items.find((i) => i.status === STATUS.NEW && /dungeon-decay/.test(i.file));
  assert.equal(decay.formula, "1d6");
  assert.ok(decay.warnings.includes("formula-inferred"));
  for (const i of plan.items.filter((x) => x.status === STATUS.NEW)) {
    assert.match(i.formula, /^1d\d+$/, `${i.file}: формула ${i.formula}`);
    assert.ok(i.results >= 3 && i.results <= 62, `${i.file}: ${i.results} результатов`);
  }
});

test("папки сохранены: 20 папок с понятными названиями", { skip }, () => {
  const plan = planImport(files);
  assert.equal(plan.folders.size, 20);
  for (const f of plan.folders.values()) assert.ok(f.name.length >= 2, f.id);
});

test("повторный импорт: всё уже в мире", { skip }, () => {
  const first = planImport(files);
  const existing = first.items.filter((i) => i.status === STATUS.NEW)
    .map((i) => ({ id: `new${i.hash}`, name: i.name, ...toCreateData(i, "table-forge").flags["table-forge"] }));
  const second = planImport(files, existing);
  assert.equal(second.summary.new, 0);
  assert.equal(second.summary.dupWorld, 87);
  assert.equal(second.summary.dupBatch, 14);
});

test("таблица из того же мира ловится по _id источника", { skip }, () => {
  const plan = planImport(files, [{ id: "AZMaLiWO5yvJgyDQ", name: "Adventure Connection" }]);
  const item = plan.items.find((i) => /adventure-connection/.test(i.file));
  assert.equal(item.status, STATUS.DUP_WORLD);
});

test("toCreateData: без _stats, с флагами модуля, документные ссылки целы", { skip }, () => {
  const plan = planImport(files);
  let docs = 0;
  for (const item of plan.items.filter((i) => i.status === STATUS.NEW)) {
    const data = toCreateData(item, "table-forge", item.folder);
    assert.equal(data._stats, undefined);
    assert.ok(data.flags["table-forge"].importKey);
    for (const r of data.results) {
      assert.ok(["text", "document"].includes(r.type));
      if (r.type === "document") {
        docs++;
        assert.match(r.documentUuid, /^Compendium\./);
      }
    }
  }
  assert.ok(docs >= 280, `документных результатов: ${docs}`);
});

test("ссылки на отсутствующий компендиум рисуются без @UUID", { skip }, () => {
  const plan = planImport(files);
  for (const item of plan.items.filter((i) => i.status === STATUS.NEW)) {
    for (const r of item.data.results.filter((x) => x.type === "document")) {
      const html = resultSourceHTML(r, () => false);
      assert.doesNotMatch(html, /@UUID\[Compendium\.ag-fifthpendium/);
    }
  }
});

test("поиск по 87 таблицам: по названию и содержимому, быстро", { skip }, () => {
  const plan = planImport(files);
  const entries = plan.items.filter((i) => i.status === STATUS.NEW).map((i) => buildSearchEntry(i.data, { file: i.file }));
  const t0 = performance.now();
  const byName = search(entries, "драгоценный");
  const byContent = search(entries, "сапфир");
  const typo = search(entries, "драгоцееный");
  const ms = performance.now() - t0;
  assert.ok(byName.length >= 6);
  assert.ok(byContent.some((h) => /dragocennyj/.test(h.entry.file)));
  assert.ok(typo.length >= 6, "опечатка находит драгоценные камни");
  assert.ok(ms < 300, `поиск занял ${ms.toFixed(0)} мс`);
});
