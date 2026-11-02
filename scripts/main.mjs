import { MODULE_ID, TEMPLATES, api, t } from "./constants.mjs";
import { registerSettings } from "./settings.mjs";
import { TableLibrary } from "./apps/library.mjs";
import { ImportDialog } from "./apps/import-dialog.mjs";
import { rollTable, bindChatCard } from "./roll.mjs";
import { ThemePicker } from "./apps/theme-picker.mjs";
import { applyThemeToChat } from "./themes.mjs";

Hooks.once("init", () => {
  registerSettings();
  game.keybindings.register(MODULE_ID, "openLibrary", {
    name: "TABLEFORGE.Keybindings.OpenLibrary",
    editable: [{ key: "KeyT", modifiers: ["Alt"] }],
    onDown: () => {
      TableLibrary.toggle();
      return true;
    }
  });
  api.loadTemplates([
    `${TEMPLATES}/library-toolbar.hbs`,
    `${TEMPLATES}/library-tree.hbs`,
    `${TEMPLATES}/library-list.hbs`,
    `${TEMPLATES}/import.hbs`,
    `${TEMPLATES}/chat-card.hbs`,
    `${TEMPLATES}/theme-picker.hbs`
  ]);
  game.modules.get(MODULE_ID).api = {
    openLibrary: () => TableLibrary.open(),
    chooseTheme: () => new ThemePicker().render({ force: true }),
    openImport: () => new ImportDialog().render({ force: true }),
    rollTable
  };
});

/* Кнопки в сайдбаре таблиц */
Hooks.on("renderRollTableDirectory", (app, html) => {
  const root = html instanceof HTMLElement ? html : html?.[0];
  const actions = root?.querySelector(".header-actions");
  if (!actions || actions.querySelector(".tf-sidebar-buttons")) return;
  const wrap = document.createElement("div");
  wrap.className = "tf-sidebar-buttons";
  wrap.innerHTML = `<button type="button" data-tf="library"><i class="fa-solid fa-table-list"></i> ${t("Library.Title")}</button>`
    + (game.user.isGM ? `<button type="button" data-tf="import"><i class="fa-solid fa-file-import"></i> ${t("Import.Button")}</button>` : "");
  wrap.querySelector("[data-tf=library]").addEventListener("click", () => TableLibrary.open());
  wrap.querySelector("[data-tf=import]")?.addEventListener("click", () => new ImportDialog().render({ force: true }));
  actions.after(wrap);
});

/* Карточка в чате */
Hooks.on("renderChatMessageHTML", bindChatCard);

/* Библиотека следит за изменениями таблиц, папок и своих бросков */
for (const hook of ["createRollTable", "updateRollTable", "deleteRollTable", "createFolder", "updateFolder", "deleteFolder", "tableForge.rolled"]) {
  Hooks.on(hook, () => TableLibrary.refresh());
}

/* Смена темы: библиотека и карточки в чате перекрашиваются сразу */
Hooks.on("tableForge.theme", (id) => {
  TableLibrary.refresh();
  applyThemeToChat(id);
});
