import { knownTaskSectionIcon, type LooseTaskSectionIcon } from "@repo/features/task-section-wire";
import { ACT_KIND } from "@repo/host/acts";
import { PlayIcon, SPINNER_SIZE, Spinner } from "@repo/ui";
import type { TerminalStripTab } from "@repo/ui/tab-strip-model";
import { queryOptions, useQueries } from "@tanstack/react-query";
import { useCallback, useContext, useMemo } from "react";
import { askAct } from "../act.js";
import { sectionGlyph } from "../desktop/section-icon-picker.js";
import { QUERY_ROOT } from "../query-keys.js";
import { type HeldAction, useOwnedShells } from "./terminal-held.js";
import { TERMINAL_KIND } from "./terminal-session.js";
import { TerminalsContext } from "./use-terminal-session.js";
import { useWindowAccount } from "./window-account.js";

/**
 * run-action-shells.tsx -- a run action's shell as the panel reads it: whether its process runs, read off the agent's shells, and the icon its tab wears.
 *
 * Each run action runs as its own process in a read-only Terminal tab of the
 * agent's sandbox (`@repo/service`'s `tmux.ts`), and the service's list of
 * the agent's shells says of each run action's whether its process runs.
 * The Run button reads that list to offer Run or Stop
 * (`run-actions-button.tsx`), and each run action's tab reads the same list
 * to wear the action's icon, with a spinner at its end while it runs, and to
 * offer Run or Stop in its header.
 */

/** How often a shown list of an agent's shells is read again, as the Terminal tab's own list goes. */
const SHELLS_EVERY_MS = 5_000;

/** An agent's shells and where its sandbox stands, read again every few seconds while shown. */
export function shellsQuery(agentId: string, shown: boolean, enabled: boolean) {
  return queryOptions({
    queryKey: [QUERY_ROOT.AGENT_SHELLS, agentId],
    queryFn: () => askAct(ACT_KIND.TERMINAL_LIST, { agentId }),
    enabled,
    refetchInterval: shown ? SHELLS_EVERY_MS : false,
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

/**
 * How each open run action's Terminal tab looks, by its tab: its action's
 * icon, and where it stands, read off its agent's shells every few seconds
 * while the panel shows them; none for a tab of a developer's own shell.
 */
export function useRunTabLooks(
  terminals: readonly TerminalStripTab[],
  shown: boolean,
): (tab: TerminalStripTab | undefined) => RunTabLook | undefined {
  const { held } = useContext(TerminalsContext);
  const owned = useOwnedShells(held, useWindowAccount());

  const heldOf = useCallback(
    (tab: TerminalStripTab) =>
      owned[TERMINAL_KIND.CLOUD][tab.terminal]?.find((each) => each.shell === tab.shell),
    [owned],
  );

  const agentIds = useMemo(
    () => [
      ...new Set(
        terminals.flatMap((tab) => (heldOf(tab)?.action === undefined ? [] : [tab.terminal])),
      ),
    ],
    [terminals, heldOf],
  );

  const lists = useQueries({
    queries: agentIds.map((agentId) => shellsQuery(agentId, shown, true)),
  });

  return useCallback(
    (tab) => {
      const entry = tab === undefined ? undefined : heldOf(tab);

      if (entry?.action === undefined) return undefined;
      const listed = tab === undefined ? undefined : lists[agentIds.indexOf(tab.terminal)]?.data;
      const shells = listed !== undefined && "terminals" in listed ? listed.terminals : [];
      const shell = shells.find((each) => each.id === entry.terminal);

      return {
        action: entry.action,
        running: shell?.running,
      };
    },
    [heldOf, lists, agentIds],
  );
}
