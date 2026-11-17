/**
 * github-wakes-row.tsx -- Preferences › Agents' Wake agents on GitHub activity row: which kinds of activity on an agent's pull request wake it.
 *
 * Every kind is on until the account turns one off, and most never do, so
 * the kinds fold under one row that says nothing while all are on and how
 * many are off otherwise (`SettingsRowsFold`), each kind a switch inset
 * under it and named alone. The account's choice is one stored value, the
 * kinds it turned off (`APP_SETTING_SCHEMA.githubWakesOff`), so the six
 * switches share one write, each press asking for the list as the newest
 * press left it, so two quick presses never undo each other.
 */

import {
  APP_SETTING_SCHEMA,
  type AppSettingField,
  GITHUB_WAKE,
  GITHUB_WAKE_LIST,
  type GitHubWake,
  githubWakesOffFrom,
  githubWakesOffWith,
  isGitHubWakesOffJson,
  type SettingsRowsInput,
} from "@repo/settings";
import { SETTINGS_ROW_INDENT, SettingsRow, SettingsRowsFold } from "@repo/ui";
import { ReplayWords } from "@repo/ui/session-replay-marks";
import type { UnparsedWireValue } from "@repo/wire";
import { useSettingRowWrite, useSettledWrite } from "./row-write.js";
import { SwitchRow } from "./switch-row.js";

/** The row's name, and its chevron's. */
const ROW_LABEL = "Wake agents on GitHub activity";

/** Each kind's switch, by the kind alone. */
const WAKE_LABEL = {
  [GITHUB_WAKE.REVIEW]: "Reviews",
  [GITHUB_WAKE.COMMENT]: "Comments",
  [GITHUB_WAKE.CHECK_FAILED]: "Failed checks",
  [GITHUB_WAKE.CHECKS_FINISHED]: "Finished checks",
  [GITHUB_WAKE.DEQUEUED]: "Merge queue removals",
  [GITHUB_WAKE.CLOSED]: "Merges and closes",
} as const satisfies Record<GitHubWake, string>;

/** The stored list as a switch reads it: none where nothing is stored. */
function storedList(value: UnparsedWireValue): string | undefined {
  return isGitHubWakesOffJson(value) ? value : undefined;
}

/** What the folded row says under its name: nothing while every kind is on, how many are off otherwise. */
function offWords(off: number): string | undefined {
  return off === 0 ? undefined : `${off} off`;
}

/** The Wake agents on GitHub activity row and the switches it folds, over the settings as the window holds them. */
export function GitHubWakesRow({ view }: { view: SettingsRowsInput }): React.JSX.Element {
  const stored = storedList(view.settings.githubWakesOff);

  const write = useSettingRowWrite<AppSettingField, string>(
    APP_SETTING_SCHEMA.githubWakesOff.field,
    (list) => list,
    (value) => storedList(value) ?? "",
    true,
  );

  // Note that each press builds on the list the newest press asked for, while it is out, rather than on what is stored.
  const latest = write.ahead?.value ?? stored;
  const off = githubWakesOffFrom(latest);
  useSettledWrite(write, stored);

  return (
    <SettingsRowsFold
      label={ROW_LABEL}
      head={(chevron) => (
        <SettingsRow
          label={<ReplayWords unmasked>{ROW_LABEL}</ReplayWords>}
          description={offWords(off.length)}
          end={() => chevron}
        />
      )}
      rows={GITHUB_WAKE_LIST.map((wake) => (
        <SwitchRow
          key={wake}
          label={WAKE_LABEL[wake]}
          labelReplayUnmasked
          indent={SETTINGS_ROW_INDENT.MARK}
          checked={!off.includes(wake)}
          onChange={(on) => write.run(githubWakesOffWith(latest, wake, on))}
        />
      ))}
    />
  );
}
