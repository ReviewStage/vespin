import { SHELLS_LOOK_EVERY_MS } from "@repo/features/run-actions-model";
import { knownTaskSectionIcon, type LooseTaskSectionIcon } from "@repo/features/task-section-wire";
import { ACT_KIND } from "@repo/host/acts";
import { PlayIcon, SPINNER_SIZE, Spinner } from "@repo/ui";
import { STRIP_TAB_KIND } from "@repo/ui/tab-strip-model";
import { queryOptions, useQueries } from "@tanstack/react-query";
import { useCallback, useContext, useMemo } from "react";
import { askAct } from "../act.js";
import { sectionGlyph } from "../desktop/section-icon-picker.js";
import { QUERY_ROOT } from "../query-keys.js";
import { type HeldAction, useOwnedShells } from "./terminal-held.js";
import { TERMINAL_KIND, type TerminalKind } from "./terminal-session.js";
import { type ShellTab, TerminalsContext } from "./use-terminal-session.js";
import { useWindowAccount } from "./window-account.js";

/**
 * run-action-shells.tsx -- a run action's shell as the panel reads it: whether its process runs, read off the agent's shells, and the icon its tab wears.
 *
 * Each run action runs as its own process in a read-only tab: a cloud
 * agent's in a Terminal tab of its sandbox (`@repo/service`'s `tmux.ts`),
 * whose list of the agent's shells says of each run action's whether its
 * process runs, and a local agent's in a Local tab on this Mac, which the
 * host holds and lists the same way (`@repo/host`'s
 * `mac-shell-procedures.ts`).
 * The Run button reads that list to offer Run or Stop
 * (`run-actions-button.tsx`), and each run action's tab reads the same list
 * to wear the action's icon, with a spinner at its end while it runs, and to
 * offer Run or Stop in its header.
 */

/** An agent's shells and where its sandbox stands, read again every few seconds while shown. */
export function shellsQuery(agentId: string, shown: boolean, enabled: boolean) {
  return queryOptions({
    queryKey: [QUERY_ROOT.AGENT_SHELLS, agentId],
    queryFn: () => askAct(ACT_KIND.TERMINAL_LIST, { agentId }),
    enabled,
    refetchInterval: shown ? SHELLS_LOOK_EVERY_MS : false,
    retry: false,
  });
}

/** A local agent's run actions on this Mac and whether each runs, read again every few seconds while shown. */
export function localRunsQuery(agentId: string, shown: boolean, enabled: boolean) {
  return queryOptions({
    queryKey: [QUERY_ROOT.MAC_RUN_ACTIONS, agentId],
    queryFn: () => askAct(ACT_KIND.MAC_SHELL_ACTIONS, { agentId }),
    enabled,
    refetchInterval: shown ? SHELLS_LOOK_EVERY_MS : false,
    retry: false,
  });
}

/** A run action's glyph: its own icon, or the play triangle where it wears none. */
export function runActionGlyph(icon: LooseTaskSectionIcon | undefined): React.JSX.Element {
  return (
    (icon === undefined ? undefined : sectionGlyph(knownTaskSectionIcon(icon))) ?? <PlayIcon />
  );
}

/** What a run action's tab says to a reader while its process runs, its ring saying it on screen. */
const RUNNING_WORDS = "Running";

/**
 * The mark at the end of a run action's tab, in its ×'s place: the ring a
 * wait is drawn with while its process runs, as a pull request's chapters
 * generating wear it, nothing otherwise. Note that it stands at once, since
 * a process running is no read that may land in a moment.
 */
export function runEndMark(run: RunTabLook | undefined): React.JSX.Element | undefined {
  if (run?.running !== true) return undefined;

  return <Spinner label={RUNNING_WORDS} size={SPINNER_SIZE.SMALL} delay={false} />;
}

/** How a run action's Terminal tab looks: the action it runs, and whether its process runs once its shell is read. */
export interface RunTabLook {
  readonly action: HeldAction;
  readonly running: boolean | undefined;
}

/** A terminal tab's kind and agent. */
function placeOf(tab: ShellTab): { readonly kind: TerminalKind; readonly agentId: string } {
  return tab.kind === STRIP_TAB_KIND.TERMINAL
    ? { kind: TERMINAL_KIND.CLOUD, agentId: tab.terminal }
    : { kind: TERMINAL_KIND.LOCAL, agentId: tab.local };
}

/** The agents of a kind whose tabs among those given show a run action, each once. */
function runAgentsOf(
  tabs: readonly ShellTab[],
  kind: TerminalKind,
  showsAction: (tab: ShellTab) => boolean,
): string[] {
  return [
    ...new Set(
      tabs.flatMap((tab) => {
        const place = placeOf(tab);

        return place.kind === kind && showsAction(tab) ? [place.agentId] : [];
      }),
    ),
  ];
}

/**
 * How each open run action's tab looks, by its tab: its action's icon, and
 * where it stands, read off its agent's shells, a cloud agent's from the
 * service and a local agent's from this Mac, every few seconds while the
 * panel shows them; none for a tab of a developer's own shell.
 */
export function useRunTabLooks(
  tabs: readonly ShellTab[],
  shown: boolean,
): (tab: ShellTab | undefined) => RunTabLook | undefined {
  const { held } = useContext(TerminalsContext);
  const owned = useOwnedShells(held, useWindowAccount());

  const heldOf = useCallback(
    (tab: ShellTab) => {
      const { kind, agentId } = placeOf(tab);

      return owned[kind][agentId]?.find((each) => each.shell === tab.shell);
    },
    [owned],
  );

  const cloudIds = useMemo(
    () => runAgentsOf(tabs, TERMINAL_KIND.CLOUD, (tab) => heldOf(tab)?.action !== undefined),
    [tabs, heldOf],
  );

  const localIds = useMemo(
    () => runAgentsOf(tabs, TERMINAL_KIND.LOCAL, (tab) => heldOf(tab)?.action !== undefined),
    [tabs, heldOf],
  );

  const cloudLists = useQueries({
    queries: cloudIds.map((agentId) => shellsQuery(agentId, shown, true)),
  });

  const localLists = useQueries({
    queries: localIds.map((agentId) => localRunsQuery(agentId, shown, true)),
  });

  return useCallback(
    (tab) => {
      const entry = tab === undefined ? undefined : heldOf(tab);

      if (tab === undefined || entry?.action === undefined) return undefined;
      const { kind, agentId } = placeOf(tab);

      const listed =
        kind === TERMINAL_KIND.CLOUD
          ? cloudLists[cloudIds.indexOf(agentId)]?.data
          : localLists[localIds.indexOf(agentId)]?.data;

      const shells = listed !== undefined && "terminals" in listed ? listed.terminals : [];
      const shell = shells.find((each) => each.id === entry.terminal);

      return {
        action: entry.action,
        running: shell?.running,
      };
    },
    [heldOf, cloudLists, cloudIds, localLists, localIds],
  );
}
