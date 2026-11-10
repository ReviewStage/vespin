import { PRODUCT_NAME } from "@repo/features/product-name";
import { ACT_KIND } from "@repo/host/acts";
import type { ComputerUseStatus } from "@repo/host/contract";
import { APP_SETTING_SCHEMA, computerUseAppsWithout, type SettingsRowsInput } from "@repo/settings";
import {
  APP_ICON_SIZE,
  AppIcon,
  BUTTON_VARIANT,
  Button,
  IconButton,
  SETTINGS_ROW_STATE,
  SettingsLine,
  SettingsRow,
  SettingsRowStateLine,
  SettingsSection,
  Tooltip,
  TrashIcon,
} from "@repo/ui";
import { rejectionWords, useAsyncAction } from "@repo/ui/use-async-action";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { askAct } from "../act.js";
import { QUERY_ROOT } from "../query-keys.js";
import type { SettingsWrites } from "./writes.js";

/**
 * computer-use-section.tsx -- This Mac's computer use: whether macOS lets agents see and use apps here, and the apps they use without asking.
 *
 * The two grants macOS holds against the app, Screen Recording to see an
 * app's window and Accessibility to click and type in it, each say whether
 * they stand; one that does not offers Allow, which raises macOS's own
 * prompt, as only macOS may grant them. They are read again as the window
 * comes back to the front, since the developer grants them in System
 * Settings. Under them, the apps the developer answered Always allow for,
 * each by its icon and name, and each taken off by its Remove, after which
 * an agent asks about it again. The switch that lets agents use apps here
 * stands among the page's rows above, as every schema row does.
 */

/** Computer use on this Mac, read through the host's helper, read again as the window comes back. */
const statusQuery = queryOptions({
  queryKey: [QUERY_ROOT.COMPUTER_USE_STATUS],
  queryFn: () => askAct(ACT_KIND.COMPUTER_USE_STATUS, {}),
  refetchOnWindowFocus: true,
});

/** What each grant lets agents do, and what they cannot do without it. */
const GRANTS = [
  {
    key: "screenRecording",
    label: "Screen Recording",
    missing: "Not allowed yet, so agents cannot see apps' windows",
  },
  {
    key: "accessibility",
    label: "Accessibility",
    missing: "Not allowed yet, so agents cannot click or type in apps",
  },
] as const satisfies readonly {
  key: keyof ComputerUseStatus["permissions"];
  label: string;
  missing: string;
}[];

/** An app's icon as the Mac sent it, a PNG's base64, as an address; none where it sent none. */
function iconAddress(iconPng: string | undefined): string | undefined {
  return iconPng === undefined ? undefined : `data:image/png;base64,${iconPng}`;
}

/** One app allowed without asking, by its icon and name, and its Remove, busy until the setting is written. */
function AllowedApp({
  app,
  onRemove,
}: {
  app: ComputerUseStatus["apps"][number];
  onRemove: (bundleId: string) => Promise<void>;
}): React.JSX.Element {
  const remove = useAsyncAction(rejectionWords);
  const label = `Remove ${app.name}`;
  return (
    <SettingsRow
      leading={<AppIcon src={iconAddress(app.iconPng)} size={APP_ICON_SIZE.LEAD} />}
      label={app.name}
      description={app.bundleId}
      end={() => (
        <Tooltip label={label}>
          <IconButton
            icon={<TrashIcon />}
            label={label}
            busy={remove.running}
            busyLabel={`Removing ${app.name}`}
            onClick={() => void remove.run(() => onRemove(app.bundleId))}
          />
        </Tooltip>
      )}
    />
  );
}

export function ComputerUseSection({
  view,
  writes,
}: {
  view: SettingsRowsInput;
  writes: SettingsWrites;
}): React.JSX.Element {
  const queries = useQueryClient();
  const status = useQuery(statusQuery);
  const { mutate: askPermissions } = useMutation({
    mutationFn: () => askAct(ACT_KIND.COMPUTER_USE_ASK_PERMISSIONS, {}),
    onSettled: () => queries.invalidateQueries({ queryKey: statusQuery.queryKey }),
  });
  const remove = async (bundleId: string) => {
    await writes.setting(
      APP_SETTING_SCHEMA.computerUseApps.field,
      computerUseAppsWithout(view.settings.computerUseApps, bundleId),
    );
    await queries.invalidateQueries({ queryKey: statusQuery.queryKey });
  };
  const permissions = status.data?.permissions;
  const apps = status.data?.apps ?? [];
  return (
    <>
      <SettingsSection
        title="Computer use"
        caption={`Agents see and control the apps you allow, in the background, while you keep working. macOS lets ${PRODUCT_NAME} do it once you allow both.`}
      >
        {GRANTS.map((grant) => {
          const granted = permissions?.[grant.key];
          return (
            <SettingsRow
              key={grant.key}
              label={grant.label}
              description={
                granted === undefined ? undefined : granted ? (
                  <SettingsRowStateLine state={SETTINGS_ROW_STATE.CONNECTED}>
                    Allowed
                  </SettingsRowStateLine>
                ) : (
                  <SettingsRowStateLine state={SETTINGS_ROW_STATE.ATTENTION}>
                    {grant.missing}
                  </SettingsRowStateLine>
                )
              }
            >
              {() =>
                granted === false ? (
                  <Button variant={BUTTON_VARIANT.OUTLINE} onClick={() => askPermissions()}>
                    Allow…
                  </Button>
                ) : null
              }
            </SettingsRow>
          );
        })}
      </SettingsSection>
      <SettingsSection
        title="Always-allowed apps"
        caption={`Agents use these without asking. Terminals, password managers, System Settings, and ${PRODUCT_NAME} itself are never offered.`}
      >
        {apps.length === 0 ? (
          <SettingsLine>
            None yet. Choose Always allow when an agent asks to use an app, and it stands here.
          </SettingsLine>
        ) : (
          apps.map((app) => <AllowedApp key={app.bundleId} app={app} onRemove={remove} />)
        )}
      </SettingsSection>
    </>
  );
}
