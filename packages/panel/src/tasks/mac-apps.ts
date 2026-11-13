import { ACT_KIND } from "@repo/host/acts";
import type { MacApp } from "@repo/host/contract";
import { EXPERIMENT, HOST_CAPABILITY } from "@repo/settings";
import { queryOptions, skipToken, useQuery, useQueryClient } from "@tanstack/react-query";
import { askAct } from "../act.js";
import { QUERY_ROOT } from "../query-keys.js";
import { appStateQuery, selectCapability, selectExperiment } from "../use-app-state.js";

/**
 * mac-apps.ts -- the apps on this Mac an agent may be pointed at, as the composer's `@` list offers them, and an app's icon, as a mention of one draws it.
 *
 * Both are read from this Mac's own host (`compose-mac-commands.ts`), and
 * only where the window runs on a Mac whose host takes commands and the
 * account has Computer use on; the host answers none while Settings has
 * agents use no apps here. Note that the list is read into this window's
 * cache alone and never sent anywhere: a mention carries only the one app
 * it names. A window elsewhere, the web's or the phone's, reads neither,
 * and a mention of an app draws a screen's glyph there.
 */

/** How long the list stands before an `@` asks for it again: apps open and close, but not between two words. */
const APPS_FRESH_MS = 30_000;

const NO_APPS: readonly MacApp[] = [];

/** One app's icon, by its bundle id or its name, read once and kept for the session. */
function iconQuery(app: string, reads: boolean) {
  return queryOptions({
    queryKey: [QUERY_ROOT.COMPUTER_USE_APP_ICON, app],
    queryFn: reads ? () => askAct(ACT_KIND.COMPUTER_USE_APP_ICON, { app }) : skipToken,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
}

/** An icon's PNG as an address an image draws. */
export function macAppIconAddress(iconPng: string | undefined): string | undefined {
  return iconPng === undefined ? undefined : `data:image/png;base64,${iconPng}`;
}

/** Whether this window may read the apps on its Mac: a host that takes commands, and Computer use on. */
export function useMacAppsReadable(): boolean {
  const onMac =
    useQuery({ ...appStateQuery, select: selectCapability(HOST_CAPABILITY.MAC_COMMANDS) }).data ===
    true;

  const computerUse =
    useQuery({ ...appStateQuery, select: selectExperiment(EXPERIMENT.COMPUTER_USE) }).data === true;

  return onMac && computerUse;
}

/** The apps on this Mac as the `@` list reads them: the rows, whether the read is out, and whether it failed, with the press that reads it again. */
export interface MacAppsRead {
  readonly apps: readonly MacApp[];
  readonly reading: boolean;
  readonly failed: boolean;
  readonly retry: () => void;
}

/**
 * The apps on this Mac, those running first, read while `asked` and the
 * window may read them; none otherwise. Each running app's icon, which the
 * list carries, is kept as its icon's read, so its mark draws without
 * asking the helper again. Note that a read that failed says so rather than
 * answering no apps, so the list can offer to read it again.
 */
export function useMacApps(asked: boolean): MacAppsRead {
  const readable = useMacAppsReadable();
  const queryClient = useQueryClient();
  const reads = asked && readable;

  const apps = useQuery({
    queryKey: [QUERY_ROOT.COMPUTER_USE_APPS],
    queryFn: async () => {
      const answer = await askAct(ACT_KIND.COMPUTER_USE_APPS, {});

      for (const app of answer.apps) {
        if (app.iconPng === undefined) continue;
        queryClient.setQueryData(iconQuery(app.bundleId ?? app.name, true).queryKey, {
          iconPng: app.iconPng,
        });
      }

      return answer.apps;
    },
    enabled: reads,
    staleTime: APPS_FRESH_MS,
    retry: false,
  });

  return {
    apps: reads ? (apps.data ?? NO_APPS) : NO_APPS,
    reading: reads && apps.isPending && !apps.isError,
    failed: reads && apps.isError && !apps.isFetching,
    retry: () => void apps.refetch(),
  };
}

/** The address of an app's icon on this Mac, by its bundle id or its name; none where the window reads none or the Mac drew none. */
export function useMacAppIcon(app: string): string | undefined {
  const readable = useMacAppsReadable();

  return macAppIconAddress(useQuery(iconQuery(app, readable)).data?.iconPng);
}
