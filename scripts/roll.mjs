import { MODULE_ID, SETTINGS, RECENT_LIMIT, TEMPLATES, api, t } from "./constants.mjs";
import { getSetting, setSetting } from "./settings.mjs";
import { inferFormula } from "./logic/formula.mjs";
import { decorate } from "./themes.mjs";
import { resultSourceHTML, usableImage, rollPosition, tidyLeftoverTags } from "./logic/results.mjs";

/**
 * Бросок таблицы в один клик → карточка модуля в чате.
 * Родной RollTable не меняется: используются table.draw()/table.roll() ядра,
 * поэтому replacement, веса и вложенные таблицы-документы работают как в Foundry.
 */
export async function rollTable(tableOrUuid, { mode } = {}) {
  const table = typeof tableOrUuid === "string" ? await fromUuid(tableOrUuid) : tableOrUuid;
  if (!table) {
    ui.notifications.warn(t("Roll.NotFound"));
    return null;
  }
  const drawn = await drawResults(table);
  if (!drawn) return null;
  const content = await renderCard(table, drawn);
  mode ??= getSetting(SETTINGS.DEFAULT_MODE);
  const message = await ChatMessage.implementation.create({
    content,
    speaker: ChatMessage.implementation.getSpeaker(),
    whisper: mode === "gm" ? gmRecipients() : [],
    rolls: [drawn.roll],
    sound: CONFIG.sounds.dice,
    flags: { [MODULE_ID]: { tableUuid: table.uuid, mode } }
  });
  await trackRoll(table);
  return message;
}

/** Перебросить: та же карточка, новый результат. */
export async function rerollMessage(message) {
  const { tableUuid } = message.flags[MODULE_ID] ?? {};
  const table = tableUuid ? await fromUuid(tableUuid) : null;
  if (!table) return ui.notifications.warn(t("Roll.NotFound"));
  const drawn = await drawResults(table);
  if (!drawn) return;
  const content = await renderCard(table, drawn);
  rerolled.add(message.id);
  await message.update({ content, rolls: [drawn.roll.toJSON()] });
  await trackRoll(table);
}

async function drawResults(table) {
  const options = { displayChat: false };
  if (!table.formula) {
    const formula = inferFormula(table.results.contents.map((r) => r.toObject()));
    if (!formula) {
      ui.notifications.warn(t("Roll.Empty", { name: table.name }));
      return null;
    }
    options.roll = new Roll(formula);
  }
  // draw() отмечает выпавшие результаты (replacement: false) — это право владельца;
  // таблицы компендиумов и чужие таблицы бросаем без отметки.
  const canDraw = !table.pack && table.isOwner;
  const { roll, results } = canDraw ? await table.draw(options) : await table.roll(options);
  if (!results?.length) {
    ui.notifications.warn(t("Roll.Exhausted", { name: table.name }));
    return null;
  }
  return { roll, results };
}

function documentExists(uuid) {
  try {
    return !!fromUuidSync(uuid, { strict: false });
  } catch {
    return false;
  }
}

const moduleActive = (id) => !!game.modules.get(id)?.active || game.system.id === id;

/**
 * HTML одного результата. Обогащаем один раз при создании: инлайн-броски [[...]] вычисляются
 * и сохраняются в сообщении.
 *
 * Основной путь — TableResult#getHTML() ядра (v13+): ровно так результат рисует сам Foundry,
 * и через него работают обогатители систем и модулей (например, @creature[...] у контент-модулей).
 * Ссылку на отсутствующий документ рисуем сами — аккуратной подписью вместо битой ссылки.
 */
async function resultHTML(result, table) {
  const enrich = (html) => api.TextEditor.enrichHTML(html, { rolls: true, documents: true, links: true, relativeTo: result ?? table });
  const missingDoc = result.type === "document" && result.documentUuid && !documentExists(result.documentUuid);
  let html = null;
  if (!missingDoc && typeof result.getHTML === "function") {
    try {
      html = await result.getHTML();
    } catch (err) {
      console.warn(`${MODULE_ID} | getHTML() результата не сработал, рисуем сами`, err);
    }
  }
  html ??= await enrich(resultSourceHTML(result, documentExists));
  return tidyLeftoverTags(html);
}

export async function renderCard(table, { roll, results }) {
  const rows = [];
  for (const result of results) {
    rows.push({
      img: usableImage(result.img, moduleActive),
      range: result.range?.[0] === result.range?.[1] ? `${result.range[0]}` : `${result.range?.[0]}–${result.range?.[1]}`,
      html: await resultHTML(result, table)
    });
  }
  return api.renderTemplate(`${TEMPLATES}/chat-card.hbs`, {
    name: table.name,
    formula: roll.formula,
    total: roll.total,
    ruler: rollPosition(table.results.contents, roll.total),
    results: rows,
    multiple: rows.length > 1
  });
}

function gmRecipients() {
  return game.users.filter((u) => u.isGM).map((u) => u.id);
}

async function trackRoll(table) {
  const recent = getSetting(SETTINGS.RECENT).filter((uuid) => uuid !== table.uuid);
  recent.unshift(table.uuid);
  await setSetting(SETTINGS.RECENT, recent.slice(0, RECENT_LIMIT));
  if (!table.pack && table.isOwner) {
    await table.setFlag(MODULE_ID, "rollCount", (table.getFlag(MODULE_ID, "rollCount") ?? 0) + 1);
  }
  Hooks.callAll("tableForge.rolled", table);
}

/** Кнопки карточки в чате. Хук renderChatMessageHTML (v13+). */
export function bindChatCard(message, html) {
  const card = html.querySelector?.(".tf-card");
  if (!card) return;
  // Тема карточки — тема того, кто смотрит, а не того, кто бросал.
  decorate(card);
  const canEdit = game.user.isGM || message.isAuthor;
  const whispered = message.whisper?.length > 0;
  for (const btn of card.querySelectorAll("[data-tf-action]")) {
    const action = btn.dataset.tfAction;
    const allowed = action === "again" || (action === "reroll" && canEdit) || (action === "reveal" && game.user.isGM && whispered);
    if (!allowed) {
      btn.remove();
      continue;
    }
    btn.addEventListener("click", async (event) => {
      event.preventDefault();
      btn.disabled = true;
      try {
        if (action === "reroll") await rerollMessage(message);
        else if (action === "again") await rollTable(message.flags[MODULE_ID]?.tableUuid, { mode: message.flags[MODULE_ID]?.mode });
        else if (action === "reveal") await message.update({ whisper: [], blind: false });
      } finally {
        btn.disabled = false;
      }
    });
  }
  // Битые картинки (модуль выключен, файл удалён) просто прячем.
  for (const img of card.querySelectorAll("img")) img.addEventListener("error", () => img.remove(), { once: true });

  const ruler = card.querySelector(".tf-ruler");
  if (ruler) ruler.style.setProperty("--tf-pos", ruler.dataset.pos);
  // Анимация появления — только у нового броска, не у истории чата при перезагрузке.
  const fresh = rerolled.delete(message.id) || Date.now() - (message.timestamp ?? 0) < 4000;
  card.classList.toggle("tf-fresh", fresh);
}

/** id сообщений, которые этот клиент только что перебросил: их карточка анимируется заново. */
const rerolled = new Set();
