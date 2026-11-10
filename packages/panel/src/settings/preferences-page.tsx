import type { ACCOUNT_STATUS, AccountSnapshot } from "@repo/credentials/snapshot";
import type { Workspace } from "@repo/features/workspace-wire";
import {
  APP_SETTING_SCHEMA,
  type AppSettingField,
  appAuthors,
  coAuthorCredited,
  isCommitAuthor,
  SETTINGS_PAGE as SCHEMA_SETTINGS_PAGE,
  SETTING_SECTION,
  type SettingsRowsInput,
} from "@repo/settings";
import type { NotificationsControl } from "@repo/settings/settings-controls";
import { SettingsSection } from "@repo/ui";
import { ACTOR_KIND, type Actor, accountActor } from "@repo/ui/actor-model";
import { ActorStack } from "../actor-ref.js";
import { SchemaSettingRows } from "./schema-rows.js";
import { SoundsSection } from "./sounds-section.js";

/**
 * preferences-page.tsx -- Settings › Preferences: how the app works for the account wherever it signs in, beside the Account page that holds the account itself.
 *
 * Three groups, each the schema's rows for its section, drawn by
 * `SchemaSettingRows` like every stored setting, so the settings search finds
 * them too: General, where links and new tasks open; Agents, how an agent's
 * message box sends while its turn runs and who authors its commits; and
 * Notifications, the sounds, the system's notification, and the reader's own
 * Slack notifications (`sounds-section.tsx`). Note that a group of one row
 * would only repeat that row under a heading, so none stands alone.
 */

/** The product as GitHub shows its App's bot. */
const APP_ON_GITHUB: Actor = { kind: ACTOR_KIND.APP, onGitHub: true };

/** The faces a commit author choice's commits show on GitHub, the author's first; none for a token no choice stores. */
function facesOf(member: Actor, token: string): readonly Actor[] {
  if (!isCommitAuthor(token)) return [];
  const [author, other] = appAuthors(token) ? [APP_ON_GITHUB, member] : [member, APP_ON_GITHUB];
  return coAuthorCredited(token) ? [author, other] : [author];
}

/**
 * The Agents group. Each commit author choice wears the faces GitHub shows
 * on such a commit, the author's first and the co-author's over it: the
 * member by the face the window draws them with everywhere else
 * (`accountActor`), so the Account page and these choices show one person
 * alike, and the product as GitHub shows its App's bot.
 */
function AgentsSection({
  view,
  account,
}: {
  view: SettingsRowsInput;
  account: Extract<AccountSnapshot, { status: typeof ACCOUNT_STATUS.SIGNED_IN }>;
}): React.JSX.Element {
  const member = accountActor(account);
  const faces = (field: AppSettingField, token: string) =>
    field === APP_SETTING_SCHEMA.commitAuthor.field ? (
      <ActorStack actors={facesOf(member, token)} counted={false} />
    ) : undefined;
  return (
    <SettingsSection title="Agents">
      <SchemaSettingRows
        page={SCHEMA_SETTINGS_PAGE.PREFERENCES}
        section={SETTING_SECTION.AGENTS}
        view={view}
        faces={faces}
      />
    </SettingsSection>
  );
}

export function PreferencesPage({
  view,
  account,
  notifications,
  workspaces,
}: {
  view: SettingsRowsInput;
  account: Extract<AccountSnapshot, { status: typeof ACCOUNT_STATUS.SIGNED_IN }>;
  notifications: NotificationsControl;
  /** The account's workspaces, whose Slack bots decide whether Slack notifications stand. */
  workspaces: readonly Workspace[];
}): React.JSX.Element {
  return (
    <>
      <SettingsSection title="General">
        <SchemaSettingRows
          page={SCHEMA_SETTINGS_PAGE.PREFERENCES}
          section={SETTING_SECTION.GENERAL}
          view={view}
        />
      </SettingsSection>
      <AgentsSection view={view} account={account} />
      <SoundsSection view={view} notifications={notifications} workspaces={workspaces} />
    </>
  );
}
