import { test } from "node:test";
import assert from "node:assert/strict";
import { plainText, normalize, swapLayout } from "../scripts/logic/text.mjs";
import { inferFormula } from "../scripts/logic/formula.mjs";
import { buildSearchEntry, search, levenshtein } from "../scripts/logic/search.mjs";
import { resultSourceHTML, usableImage, previewRows } from "../scripts/logic/results.mjs";
import { normalizeResult, deriveFolderName, sortCopiesLast } from "../scripts/logic/import.mjs";

test("plainText: разметка Foundry", () => {
  assert.equal(plainText("<p>Урон [[/r 1d4*10]] и @UUID[Compendium.x.y.Item.abc]{Меч}</p>"), "Урон 1d4*10 и Меч");
  assert.equal(plainText("[[1d6]] монет"), "1d6 монет");
  assert.equal(plainText("a&nbsp;b"), "a b");
});

test("normalize: ё/е и регистр", () => {
  assert.equal(normalize("Ёжик в ТУМАНЕ!"), "ежик в тумане");
});

test("swapLayout: неверная раскладка", () => {
  assert.equal(swapLayout("nfdthyf"), "таверна");
});

test("inferFormula", () => {
  const r = (a, b) => ({ range: [a, b] });
  assert.equal(inferFormula([r(1, 1), r(2, 2), r(3, 6)]), "1d6");
  assert.equal(inferFormula(Array.from({ length: 12 }, (_, i) => r(i + 1, i + 1))), "1d12");
  assert.equal(inferFormula([r(3, 4), r(5, 8)]), "1d6+2");
  assert.equal(inferFormula([{ weight: 2 }, { weight: 3 }]), "1d5");
  assert.equal(inferFormula([]), "");
});

test("levenshtein", () => {
  assert.equal(levenshtein("таверна", "таверна"), 0);
  assert.equal(levenshtein("тавнрна", "таверна"), 1);
  assert.ok(levenshtein("абвгд", "ежзик", 1) > 1);
});

test("search: название, содержимое, опечатка, ё, раскладка", () => {
  const entries = [
    buildSearchEntry({ name: "Таверна: посетители", results: [{ description: "<p>Пьяный гном</p>" }] }),
    buildSearchEntry({ name: "Драгоценный камень 50 зм", results: [{ name: "Жёлтый сапфир" }] }),
    buildSearchEntry({ name: "Имена эльфов", results: [{ description: "Ариэль" }] })
  ];
  const first = (q) => search(entries, q)[0]?.entry.name;
  assert.equal(first("таверн"), "Таверна: посетители");
  assert.equal(first("гном"), "Таверна: посетители");
  assert.equal(first("желтый"), "Драгоценный камень 50 зм");
  assert.equal(first("тавнрна"), "Таверна: посетители");
  assert.equal(first("nfdthyf"), "Таверна: посетители");
  assert.equal(first("драгоценный 50"), "Драгоценный камень 50 зм");
  assert.equal(search(entries, "zzzzqqq").length, 0);
  assert.equal(search(entries, "").length, 3);
});

test("resultSourceHTML: ссылка есть / ссылки нет", () => {
  const doc = { type: "document", name: "Сапфир [Sapphire]", documentUuid: "Compendium.ag-fifthpendium.equipment.Item.gem" };
  assert.match(resultSourceHTML(doc, () => true), /@UUID\[Compendium\.ag-fifthpendium\.equipment\.Item\.gem\]\{Сапфир \[Sapphire\]\}/);
  const missing = resultSourceHTML(doc, () => false);
  assert.match(missing, /tf-missing-link/);
  assert.doesNotMatch(missing, /@UUID/);
  assert.match(missing, /Сапфир \[Sapphire\]/);
  assert.equal(resultSourceHTML({ type: "text", description: "<p>Текст</p>", name: "" }), "<p>Текст</p>");
});

test("usableImage", () => {
  assert.equal(usableImage("icons/svg/d20-black.svg"), null);
  assert.equal(usableImage("modules/ag-fifthpendium/a.webp", () => false), null);
  assert.equal(usableImage("modules/ag-fifthpendium/a.webp", () => true), "modules/ag-fifthpendium/a.webp");
  assert.equal(usableImage("worlds/w/x.webp"), "worlds/w/x.webp");
});

test("previewRows", () => {
  const p = previewRows(Array.from({ length: 15 }, (_, i) => ({ range: [i + 1, i + 1], description: `R${i + 1}` })), 12);
  assert.equal(p.rows.length, 12);
  assert.equal(p.more, 3);
  assert.equal(p.rows[0].range, "1");
});

test("normalizeResult: формат v12", () => {
  const r = normalizeResult({ type: 2, text: "Меч", documentCollection: "dnd5e.items", documentId: "abc", range: [1, 2] });
  assert.equal(r.type, "document");
  assert.equal(r.name, "Меч");
  assert.equal(r.documentUuid, "Compendium.dnd5e.items.abc");
  const t = normalizeResult({ type: 0, text: "Просто текст", range: [3, 3] });
  assert.equal(t.description, "Просто текст");
});

test("deriveFolderName", () => {
  assert.equal(deriveFolderName(["Инструменты: обычный", "Инструменты: редкий"]), "Инструменты");
  assert.equal(deriveFolderName(["Один"]), "Один");
  assert.equal(deriveFolderName(["Альфа", "Бета"]), "Альфа и др.");
});

test("sortCopiesLast", () => {
  const out = sortCopiesLast([{ name: "a-X (1).json" }, { name: "a-X.json" }]).map((f) => f.name);
  assert.deepEqual(out, ["a-X.json", "a-X (1).json"]);
});

test("rollPosition: шкала диапазона", async () => {
  const { rollPosition } = await import("../scripts/logic/results.mjs");
  const res = Array.from({ length: 20 }, (_, i) => ({ range: [i + 1, i + 1] }));
  assert.deepEqual(rollPosition(res, 1), { min: 1, max: 20, pos: 0 });
  assert.deepEqual(rollPosition(res, 20), { min: 1, max: 20, pos: 1 });
  assert.equal(rollPosition(res, 99).pos, 1);
  assert.equal(rollPosition([{ range: [1, 1] }], 1), null);
  assert.equal(rollPosition([], 3), null);
});
