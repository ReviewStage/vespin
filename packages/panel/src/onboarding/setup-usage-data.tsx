/**
 * setup-usage-data.tsx -- setup's word on usage data: what this copy of the app sends, which of it is anonymous and which is filed under the account, and Settings › Account's own "Share usage data" switch right under it, with a link to the privacy policy.
 *
 * A notice rather than a question, as VS Code's and Zed's first run are:
 * the switch stands on as it is set, and turning it off here is turning it
 * off in Settings, the same schema row writing the same setting
 * (`APP_SETTING_SCHEMA.usageData`). Its words keep to `PRIVACY.md`'s:
 * this app's counts and its error and crash reports never name the account,
 * while its recordings of the window, words masked, are filed under the
 * account's name and email, so nothing calls the whole of it anonymous.
 */

import { LINK_PAGE } from "@repo/features/link-home";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { SETTING_SECTION, SETTINGS_PAGE } from "@repo/settings";
import { SettingsSection, TEXT_LINK_LOOK, TextLink } from "@repo/ui";
import { useQuery } from "@tanstack/react-query";
import { appPlatform } from "../app-platform.js";
import { SchemaSettingRows } from "../settings/schema-rows.js";
import { settingsRowsInput } from "../settings/settings-rows.js";
import { linkPressOf } from "../tasks/use-open-link.js";
import {
  appStateQuery,
  selectAccount,
  selectAppSettingsView,
  selectRun,
  useAppStateSlice,
} from "../use-app-state.js";

/** What setup says of usage data, in `PRIVACY.md`'s terms. */
const USAGE_DATA_WORDS = {
  TITLE: "Usage data",
  NOTE: `${PRODUCT_NAME} collects counts of the features you use, error and crash reports, and recordings of this window with your words masked. This app's counts and crash reports are anonymous: they never name your account. Recordings are kept under your name and email, so we can help when you ask.`,
  POLICY: "Privacy policy",
} as const;

/** The usage data section on setup's first card; nothing until the settings are read. */
export function SetupUsageData(): React.JSX.Element | null {
  const settings = useQuery({ ...appStateQuery, select: selectAppSettingsView }).data;
  const account = useAppStateSlice(selectAccount);
  const capabilities = useQuery({ ...appStateQuery, select: selectRun }).data?.capabilities;

  if (account === undefined || capabilities === undefined) return null;
  const view = settingsRowsInput({ settings, account, capabilities });

  if (view === undefined) return null;

  return (
    <SettingsSection
      title={USAGE_DATA_WORDS.TITLE}
      caption={
        <>
          {USAGE_DATA_WORDS.NOTE}{" "}
          <TextLink
            href={LINK_PAGE.PRIVACY}
            look={TEXT_LINK_LOOK.UNDERLINED}
            external
            newTab
            onClick={linkPressOf((href) => appPlatform().openWeb(href), LINK_PAGE.PRIVACY)}
          >
            {USAGE_DATA_WORDS.POLICY}
          </TextLink>
        </>
      }
    >
      <SchemaSettingRows
        page={SETTINGS_PAGE.ACCOUNT}
        section={SETTING_SECTION.PRIVACY}
        view={view}
      />
    </SettingsSection>
  );
}
