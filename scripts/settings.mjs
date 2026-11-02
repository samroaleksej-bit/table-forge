import { MODULE_ID, SETTINGS } from "./constants.mjs";

export function registerSettings() {
  game.settings.register(MODULE_ID, SETTINGS.DEFAULT_MODE, {
    name: "TABLEFORGE.Settings.DefaultMode.Name",
    hint: "TABLEFORGE.Settings.DefaultMode.Hint",
    scope: "client",
    config: true,
    type: String,
    choices: {
      gm: "TABLEFORGE.Mode.gm",
      public: "TABLEFORGE.Mode.public"
    },
    default: "gm"
  });
  // Избранное и недавние — у каждого пользователя свои (scope "user" есть с v13).
  game.settings.register(MODULE_ID, SETTINGS.FAVORITES, { scope: "user", config: false, type: Array, default: [] });
  game.settings.register(MODULE_ID, SETTINGS.RECENT, { scope: "user", config: false, type: Array, default: [] });
}

export const getSetting = (key) => game.settings.get(MODULE_ID, key);
export const setSetting = (key, value) => game.settings.set(MODULE_ID, key, value);
