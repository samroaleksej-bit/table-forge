import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHex, mix, contrast, readableOn, customVars, CUSTOM_VARS } from "../scripts/logic/colors.mjs";

test("parseHex: #abc, #aabbcc, мусор", () => {
  assert.deepEqual(parseHex("#abc"), { r: 170, g: 187, b: 204 });
  assert.deepEqual(parseHex("2f5bea"), { r: 47, g: 91, b: 234 });
  assert.equal(parseHex("red"), null);
  assert.equal(parseHex(undefined), null);
});

test("mix и contrast", () => {
  assert.equal(mix("#000000", "#ffffff", 0.5), "#808080");
  assert.equal(Math.round(contrast("#000000", "#ffffff")), 21);
  assert.equal(contrast("#777777", "#777777"), 1);
});

test("readableOn: на тёмном светлый текст, на светлом тёмный", () => {
  assert.equal(readableOn("#1e1a2e"), "#ece8e1");
  assert.equal(readableOn("#f3eee3"), "#1f1c17");
});

test("customVars: пусто — ничего не меняем", () => {
  assert.deepEqual(customVars({}), {});
});

test("customVars: сменили только фон — текст подобран и читается", () => {
  for (const bg of ["#101010", "#f4ead3", "#2a6f97", "#ffcc00"]) {
    const v = customVars({ bg });
    assert.ok(contrast(v["--tf-text"], bg) >= 4.5, `${bg}: ${contrast(v["--tf-text"], bg).toFixed(1)}`);
  }
});

test("customVars: акцент даёт читаемые чернила на монете", () => {
  for (const accent of ["#ffd500", "#2f5bea", "#7a1f1f", "#3cc0b0"]) {
    const v = customVars({ accent });
    assert.ok(contrast(v["--tf-coin-ink"], accent) >= 4.5, accent);
  }
});

test("customVars: шрифты, скругление, масштаб в пределах", () => {
  const v = customVars({ font: "jetbrains", fontDisplay: "playfair", radius: 99, scale: 3 });
  assert.match(v["--tf-font"], /JetBrains/);
  assert.match(v["--tf-font-display"], /Playfair/);
  assert.equal(v["--tf-radius"], "24px");
  assert.equal(v["--tf-scale"], "1.4");
  assert.deepEqual(customVars({ font: "comic-sans" }), {});
});

test("customVars: все выставленные переменные известны (их можно снять)", () => {
  const v = customVars({ accent: "#123456", bg: "#fafafa", text: "#111111", font: "manrope", fontDisplay: "cormorant", radius: 4, scale: 1.1 });
  for (const k of Object.keys(v)) assert.ok(CUSTOM_VARS.includes(k), k);
});
