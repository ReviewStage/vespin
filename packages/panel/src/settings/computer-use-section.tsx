import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { ACT_KIND } from "@repo/host/acts";
import type { ComputerUseStatus } from "@repo/host/contract";
import { AccessibilityIcon, ScreenRecordingIcon } from "@repo/ui";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { actFailureWords, askAct } from "../act.js";
import { pressMutation } from "../act-mutations.js";
import { refusalShown } from "../failure-report.js";
import { QUERY_ROOT } from "../query-keys.js";
import { useForwardOnGrant, useGrantFlow } from "./forward-on-grant.js";
import { PERMISSION_STANDING, PermissionRow } from "./permission-row.js";
import type { SettingRefusal } from "./row-write.js";

/**
 * computer-use-section.tsx -- This Mac's computer use: whether macOS lets agents see and use apps here.
 *
 * The two grants macOS holds against the app, Screen Recording to see an
 * app's window and Accessibility to click and type in it, each say whether
 * they stand; one that does not offers Allow, which opens its System
 * Settings pane beside a panel holding the app to drag into the list, as only
 * macOS may grant them, and one that does holds Open System Settings under
 * its ⋯, opening that pane alone, where it is taken back. They are read
 * every second while shown, since the developer grants and takes them back
 * in System Settings, and one granted there from Allow… brings the app back
 * to the front as soon as it is read (`useForwardOnGrant`). The switch that
 * lets agents use apps, and the apps they use without asking, stand under
 * this Mac on Settings › Machines.
 */

/**
 * Computer use on this Mac, read through the host's helper every second
 * while it is shown. Note that it is polled rather than read again on focus,
 * because the developer grants and takes back these in System Settings, and
 * a desktop window that another app covers stays visible, so the focus
 * refetch, which follows the document's visibility, never fires.
 */
const computerUseStatusQuery = queryOptions({
  queryKey: [QUERY_ROOT.COMPUTER_USE_STATUS],
  queryFn: () => askAct(ACT_KIND.COMPUTER_USE_STATUS, {}),
  refetchInterval: 1000,
});

/** What each grant lets agents do, and what they cannot do without it. */
const COMPUTER_USE_GRANTS = [
  {
    key: "screenRecording",
    icon: ScreenRecordingIcon,
    label: "Screen Recording",
    purpose: "To let agents see the windows of the apps you allow.",
  },
  {
    key: "accessibility",
    icon: AccessibilityIcon,
    label: "Accessibility",
    purpose: "To let agents click and type in the apps you allow.",
  },
] as const satisfies readonly {
  key: keyof ComputerUseStatus["permissions"];
  icon: () => React.JSX.Element;
  label: string;
  purpose: string;
}[];

/**
 * The two grants as This Mac's Permissions lists them, each as every
 * permission reads (`PermissionRow`): Allow… opens the pane, and the panel
 * to drag the app from, for the first one still missing, an allowed one's ⋯
 * opens its own pane, each read again as it answers and every second while
 * shown, and an ask that never reached macOS says why under that row.
 */
export function ComputerUsePermissionRows(): React.JSX.Element | null {
  const queries = useQueryClient();
  const flow = useGrantFlow();

  // Note that an open grant flow reads on while System Settings covers the window, which macOS reads as hidden, so the grant is seen as it lands.
  const status = useQuery({ ...computerUseStatusQuery, refetchIntervalInBackground: flow.open });

  const asking = useMutation({
    mutationFn: () => askAct(ACT_KIND.COMPUTER_USE_ASK_PERMISSIONS, {}),
    onSettled: () => queries.invalidateQueries({ queryKey: computerUseStatusQuery.queryKey }),
  });

  const { mutate: openScreenRecordingSettings } = useMutation(
    pressMutation(ACT_KIND.SCREEN_RECORDING_OPEN_SETTINGS),
  );

  const { mutate: openAccessibilitySettings } = useMutation(
    pressMutation(ACT_KIND.ACCESSIBILITY_OPEN_SETTINGS),
  );

  const openSettings = {
    screenRecording: () => openScreenRecordingSettings(),
    accessibility: () => openAccessibilitySettings(),
  } as const satisfies Record<(typeof COMPUTER_USE_GRANTS)[number]["key"], () => void>;

  // Note that only a request that did not reach macOS is said here: a grant macOS was asked for stands as the developer leaves it in System Settings, which the status read says.
  const askRefused: SettingRefusal | undefined =
    asking.error === null
      ? undefined
      : { words: actFailureWords(asking.error), cause: asking.error };

  const permissions = status.data?.permissions;

  // Note that both grants are one flow, because Allow… on either row opens the pane of the first one missing.
  useForwardOnGrant(
    flow,
    COMPUTER_USE_GRANTS.map((grant) => permissions?.[grant.key] ?? true),
  );

  // Note that a status that cannot be read lists no grant, as a permission whose standing cannot be read is left out.
  if (permissions === undefined) return null;
  const firstMissing = COMPUTER_USE_GRANTS.find((grant) => !permissions[grant.key]);
  const missing = firstMissing !== undefined;

  return (
    <>
      {COMPUTER_USE_GRANTS.map((grant) => (
        <PermissionRow
          key={grant.key}
          icon={<grant.icon />}
          label={grant.label}
          standing={permissions[grant.key] ? PERMISSION_STANDING.ALLOWED : PERMISSION_STANDING.ASK}
          purpose={grant.purpose}
          error={
            firstMissing === grant
              ? refusalShown(askRefused, FAILURE_SURFACE.COMPUTER_USE_PERMISSIONS)
              : undefined
          }
          onOpenSettings={flow.sent(openSettings[grant.key], missing)}
          onAllow={flow.sent(
            () =>
              asking.mutateAsync().then(
                () => undefined,
                () => undefined,
              ),
            missing,
          )}
        />
      ))}
    </>
  );
}
