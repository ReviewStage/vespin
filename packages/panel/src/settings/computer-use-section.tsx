import { PRODUCT_NAME } from "@repo/features/product-name";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { readFailedWords } from "@repo/features/words";
import { ACT_KIND } from "@repo/host/acts";
import type { ComputerUseStatus } from "@repo/host/contract";
import {
  APP_SETTING_SCHEMA,
  computerUseAppsOf,
  computerUseAppsWithout,
  type SettingsRowsInput,
} from "@repo/settings";
import { ErrorState, SettingsLine, SettingsSection } from "@repo/ui";
import { ACTION_RESULT_STATUS } from "@repo/wire";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { actFailureWords, askAct } from "../act.js";
import { refusalShown, unreadShown } from "../failure-report.js";
import { QUERY_ROOT } from "../query-keys.js";
import { appStateIn, selectAppSettingsView } from "../use-app-state.js";
import { AllowedAppList } from "./allowed-app-row.js";
import { PERMISSION_STANDING, PermissionRow } from "./permission-row.js";
import type { SettingRefusal } from "./row-write.js";
import { SECTION, settingsSectionHead } from "./settings-sections.js";
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
 * an agent asks about it again; a Remove the setting's write refused says
 * why under its row, as every row's refused write does. The switch that lets agents use apps here
 * stands among the page's rows above, as every schema row does.
 */

/** Computer use on this Mac, read through the host's helper, read again as the window comes back. */
export const computerUseStatusQuery = queryOptions({
  queryKey: [QUERY_ROOT.COMPUTER_USE_STATUS],
  queryFn: () => askAct(ACT_KIND.COMPUTER_USE_STATUS, {}),
  refetchOnWindowFocus: true,
});

/** What each grant lets agents do, and what they cannot do without it. */
export const COMPUTER_USE_GRANTS = [
  {
    key: "screenRecording",
    label: "Screen Recording",
    allowed: "Agents see the windows of the apps you allow",
    missing: "Not allowed yet, so agents cannot see apps' windows",
  },
  {
    key: "accessibility",
    label: "Accessibility",
    allowed: "Agents click and type in the apps you allow",
    missing: "Not allowed yet, so agents cannot click or type in apps",
  },
] as const satisfies readonly {
  key: keyof ComputerUseStatus["permissions"];
  label: string;
  allowed: string;
  missing: string;
}[];

export function ComputerUseSection({
  view,
  writes,
}: {
  view: SettingsRowsInput;
  writes: SettingsWrites;
}): React.JSX.Element {
  const queries = useQueryClient();
  const status = useQuery(computerUseStatusQuery);
  /** The Remove written last, which the next waits on, so no two writes of the list cross. */
  const writing = useRef<Promise<unknown>>(Promise.resolve());
  /** The apps whose Remove the store took, left out of every list written after, until the stored list leaves them out too. */
  const removed = useRef(new Set<string>());
  const listed = view.settings.computerUseApps;

  // Note that an app is let go of once the stored list leaves it out, so one allowed again after is not taken off by the next Remove.
  useEffect(() => {
    const apps = computerUseAppsOf(listed);

    for (const app of removed.current) if (!apps.includes(app)) removed.current.delete(app);
  }, [listed]);

  /**
   * An app taken off the list, or why the setting's write was refused, which
   * its row says. Note that each write waits for the one before it and is
   * built from the list as stored when it runs, read through the client
   * rather than this render, less every app a Remove already took off,
   * because a second Remove pressed before the first lands would otherwise
   * write the first app back; a refused Remove takes nothing off a later one.
   */
  const remove = (bundleId: string): Promise<SettingRefusal | undefined> => {
    const write = async (): Promise<SettingRefusal | undefined> => {
      const state = appStateIn(queries);
      const latest = state === undefined ? undefined : selectAppSettingsView(state);
      const stored = latest?.computerUseApps ?? view.settings.computerUseApps;

      const kept = [...removed.current, bundleId].reduce<string | undefined>(
        (apps, app) => computerUseAppsWithout(apps, app),
        stored,
      );

      const written = await writes.setting(APP_SETTING_SCHEMA.computerUseApps.field, kept);

      if (written.status !== ACTION_RESULT_STATUS.ACCEPTED) {
        return { words: written.reason, cause: written };
      }

      // Note that the stored list may already leave the app out as the answer lands, its update having come first, so it is held only while the list still has it.
      const now = appStateIn(queries);

      const listed = computerUseAppsOf(
        (now === undefined ? undefined : selectAppSettingsView(now))?.computerUseApps ??
          view.settings.computerUseApps,
      );

      if (listed.includes(bundleId)) removed.current.add(bundleId);
      await queries.invalidateQueries({ queryKey: computerUseStatusQuery.queryKey });

      return undefined;
    };

    const next = writing.current.then(write, write);
    writing.current = next;

    return next;
  };

  const apps = status.data?.apps ?? [];

  return (
    <SettingsSection
      {...settingsSectionHead(SECTION.COMPUTER_USE_APPS)}
      caption={`Agents use these without asking. Terminals, password managers, System Settings, and ${PRODUCT_NAME} itself are never offered.`}
    >
      {status.isError ? (
        <ErrorState
          failure={unreadShown(FAILURE_SURFACE.COMPUTER_USE_READ)}
          onRetry={() => void status.refetch()}
        >
          {readFailedWords("this Mac's computer use")}
        </ErrorState>
      ) : status.data === undefined ? null : apps.length === 0 ? (
        <SettingsLine>
          None yet. Choose Always allow when an agent asks to use an app, and it stands here.
        </SettingsLine>
      ) : (
        <AllowedAppList apps={apps} onRemove={remove} />
      )}
    </SettingsSection>
  );
}

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

  // Note that a status that cannot be read is said once, under Always-allowed apps, which reads the same status.
  if (permissions === undefined) return null;
  const firstMissing = COMPUTER_USE_GRANTS.find((grant) => !permissions[grant.key]);

  return (
    <>
      {COMPUTER_USE_GRANTS.map((grant) => (
        <PermissionRow
          key={grant.key}
          label={grant.label}
          standing={permissions[grant.key] ? PERMISSION_STANDING.ALLOWED : PERMISSION_STANDING.ASK}
          allowed={grant.allowed}
          missing={grant.missing}
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
