import { ACT_KIND } from "@repo/host/acts";
import {
  SETTINGS_PAGE as SCHEMA_SETTINGS_PAGE,
  SETTING_SECTION,
  type SettingsRowsInput,
} from "@repo/settings";
import { BUTTON_VARIANT, Button, SettingsRow, SettingsSection } from "@repo/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { pressMutation } from "../act-mutations.js";
import { appStateQuery, supportAccessStanding } from "../use-app-state.js";
import { SchemaSettingRows } from "./schema-rows.js";
import type { SettingsWrites } from "./writes.js";

/**
 * privacy-section.tsx -- whether this copy of the app shares its usage data, and whether a maintainer may sign in as the member to help, the Account page's Privacy group, under who is signed in.
 *
 * The switch is kept on this device, but the counts it stops are sent under
 * the account, so it stands on Profile beside what is the account's. The
 * grant of support access is the account's on the service, read on its
 * access and written through the host under the account's own session.
 */

/**
 * The member's grant of support access: whether it stands and until when,
 * and the one press that turns it, granting it for seven days or revoking
 * it. Either acts on the press, since the row's other press turns it back.
 * A grant is not offered while a maintainer is already signed in as the
 * member, since the service refuses one then, nor before the access is read,
 * since a grant standing unread would be extended; a revoke still is, and
 * ends that sign-in.
 */
function SupportAccessRow(): React.JSX.Element {
  const standing = useQuery({
    ...appStateQuery,
    select: (state) => supportAccessStanding(state, Date.now()),
  }).data;
  const supportAccess = useMutation(pressMutation(ACT_KIND.ACCOUNT_SUPPORT_ACCESS));
  const granted = standing?.granted === true;
  const press = {
    busy: supportAccess.isPending,
    onPress: () => supportAccess.mutate({ grant: !granted }),
  };
  return (
    <SettingsRow label="Support access" description={standing?.words}>
      {() =>
        granted ? (
          <Button
            variant={BUTTON_VARIANT.OUTLINE}
            busy={press.busy}
            busyLabel="Revoking"
            onClick={press.onPress}
          >
            Revoke
          </Button>
        ) : standing?.grantable === true ? (
          <Button
            variant={BUTTON_VARIANT.OUTLINE}
            busy={press.busy}
            busyLabel="Granting"
            onClick={press.onPress}
          >
            Grant for 7 days
          </Button>
        ) : null
      }
    </SettingsRow>
  );
}

export function PrivacySection({
  view,
  writes,
}: {
  view: SettingsRowsInput;
  writes: SettingsWrites;
}): React.JSX.Element {
  return (
    <SettingsSection title="Privacy">
      <SchemaSettingRows
        page={SCHEMA_SETTINGS_PAGE.ACCOUNT}
        section={SETTING_SECTION.PRIVACY}
        view={view}
      />
      <SupportAccessRow />
    </SettingsSection>
  );
}
