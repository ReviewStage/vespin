import assert from "node:assert/strict";
import { APP_SETTING_ID, APP_TOGGLE_VALUE } from "@repo/wire/app-settings";
import { test } from "vitest";
import { describedSettings, settingRowsDrawnForPage } from "./schema-access.js";
import { SETTING_SECTION, SETTINGS_PAGE } from "./schema-types.js";
import { SOUND_WHEN, type SoundWhen } from "./sound-when.js";
import { settingsView } from "./testing.js";

test("nothing a setting says about itself names a credential or its shape", () => {
  // No settings description may carry a key, a key's shape, or an
  // environment variable's name.
  const forbidden = [/sk-/i, /_API_KEY/, /secret/i, /token/i, /password/i];

  for (const entry of describedSettings(settingsView())) {
    const lines = [entry.label, entry.detail ?? "", entry.value];

    for (const line of lines) {
      for (const pattern of forbidden) {
        assert.ok(!pattern.test(line), `${entry.id} says "${line}"`);
      }
    }
  }
});

test("a row that stands only while sounds play is listed hidden once the account is drawn, and not at all before", () => {
  // Note that the page reveals a row it is handed hidden, so one listed before the account is drawn would unroll as the page's first draw lands.
  const rows = (soundWhen: SoundWhen, accountDrawn: boolean) =>
    settingRowsDrawnForPage(SETTINGS_PAGE.PREFERENCES, SETTING_SECTION.NOTIFICATIONS, {
      settings: settingsView({ soundWhen }),
      accountDrawn,
      capabilities: [],
    })
      .filter((row) => row.entry.label === "When an agent finishes")
      .map(({ shown, revealed }) => ({ shown, revealed }));

  assert.deepEqual(rows(SOUND_WHEN.OFF, true), [{ shown: false, revealed: true }]);
  assert.deepEqual(rows(SOUND_WHEN.ALWAYS, true), [{ shown: true, revealed: true }]);
  assert.deepEqual(rows(SOUND_WHEN.OFF, false), []);
});

test("an account's toggle on by default reads on while the account has chosen nothing", () => {
  const unchosen = describedSettings(settingsView({ inbox: undefined })).find(
    (entry) => entry.id === APP_SETTING_ID.INBOX,
  );

  assert.equal(unchosen?.value, APP_TOGGLE_VALUE.ON);
});
