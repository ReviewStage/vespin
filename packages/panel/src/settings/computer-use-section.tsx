import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { ACT_KIND } from "@repo/host/acts";
import type { ComputerUseStatus } from "@repo/host/contract";
import { AccessibilityIcon, ScreenRecordingIcon } from "@repo/ui";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { actFailureWords, askAct } from "../act.js";
import { refusalShown } from "../failure-report.js";
import { QUERY_ROOT } from "../query-keys.js";
import { PERMISSION_STANDING, PermissionRow } from "./permission-row.js";
import type { SettingRefusal } from "./row-write.js";

/**
 * computer-use-section.tsx -- This Mac's computer use: whether macOS lets agents see and use apps here.
 *
 * The two grants macOS holds against the app, Screen Recording to see an
 * app's window and Accessibility to click and type in it, each say whether
 * they stand; one that does not offers Allow, which raises macOS's own
 * prompt, as only macOS may grant them. They are read again as the window
 * comes back to the front, since the developer grants them in System
 * Settings. The switch that lets agents use apps, and the apps they use
 * without asking, stand under this Mac on Settings › Machines.
 */

/** Computer use on this Mac, read through the host's helper, read again as the window comes back. */
const computerUseStatusQuery = queryOptions({
  queryKey: [QUERY_ROOT.COMPUTER_USE_STATUS],
  queryFn: () => askAct(ACT_KIND.COMPUTER_USE_STATUS, {}),
  refetchOnWindowFocus: true,
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
 * permission reads (`PermissionRow`): Allow… raises macOS's own prompt or
 * pane for the first one still missing, read again as it answers and as the
 * window comes back to the front, and an ask that never reached macOS says
 * why under that row.
 */
export function ComputerUsePermissionRows(): React.JSX.Element | null {
  const queries = useQueryClient();
  const status = useQuery(computerUseStatusQuery);

  const asking = useMutation({
    mutationFn: () => askAct(ACT_KIND.COMPUTER_USE_ASK_PERMISSIONS, {}),
    onSettled: () => queries.invalidateQueries({ queryKey: computerUseStatusQuery.queryKey }),
  });

  // Note that only a request that did not reach macOS is said here: a grant macOS was asked for stands as the developer leaves it in System Settings, which the status read says.
  const askRefused: SettingRefusal | undefined =
    asking.error === null
      ? undefined
      : { words: actFailureWords(asking.error), cause: asking.error };

  const permissions = status.data?.permissions;

  // Note that a status that cannot be read lists no grant, as a permission whose standing cannot be read is left out.
  if (permissions === undefined) return null;
  const firstMissing = COMPUTER_USE_GRANTS.find((grant) => !permissions[grant.key]);

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
          onAllow={() =>
            asking.mutateAsync().then(
              () => undefined,
              () => undefined,
            )
          }
        />
      ))}
    </>
  );
}
