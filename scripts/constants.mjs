export const MODULE_ID = "table-forge";
export const TEMPLATES = `modules/${MODULE_ID}/templates`;

export const SETTINGS = {
  DEFAULT_MODE: "defaultMode",
  FAVORITES: "favorites",
  RECENT: "recent",
  EXPANDED: "expandedFolders",
  THEME: "theme",
  THEME_CHOSEN: "themeChosen"
};

export const RECENT_LIMIT = 15;

/** Совместимость v13/v14: новые пространства имён с откатом на глобальные. */
export const api = {
  get TextEditor() { return foundry.applications?.ux?.TextEditor?.implementation ?? globalThis.TextEditor; },
  renderTemplate(path, data) { return (foundry.applications?.handlebars?.renderTemplate ?? globalThis.renderTemplate)(path, data); },
  loadTemplates(paths) { return (foundry.applications?.handlebars?.loadTemplates ?? globalThis.loadTemplates)(paths); }
};

export const t = (key, data) => (data ? game.i18n.format(`TABLEFORGE.${key}`, data) : game.i18n.localize(`TABLEFORGE.${key}`));
