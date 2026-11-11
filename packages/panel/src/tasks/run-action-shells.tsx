import { knownTaskSectionIcon, type LooseTaskSectionIcon } from "@repo/features/task-section-wire";
import type { TerminalSummary } from "@repo/features/terminal-wire";
import { ACT_KIND } from "@repo/host/acts";
import { GLYPH } from "@repo/ui/icons";
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
 * run-action-shells.tsx -- a run action's shell as the panel reads it: whether its process runs or how it exited, read off the agent's shells, and the icon and words its tab wears.
 *
 * Each run action runs as its own process in a read-only Terminal tab of the
 * agent's sandbox (`@repo/service`'s `tmux.ts`), and the service's list of
 * the agent's shells says of each run action's whether its process runs or
 * how it exited. The Run button reads that list to offer Run or Stop
 * (`run-actions-button.tsx`), and each run action's tab reads the same list
 * to say where its action stands ("Running", "Exited 1", "Stopped") as its
 * own words beside its label, never joined to it, wearing the action's icon
 * rather than the terminal's.
 */

/** How often a shown list of an agent's shells is read again, as the Terminal tab's own list goes. */
const SHELLS_EVERY_MS = 5_000;

/** The signals a stop sends, which a tab says as stopped rather than by number: HUP, INT, KILL, and TERM. */
const STOP_SIGNALS: ReadonlySet<number> = new Set([1, 2, 9, 15]);

/** What a run action's tab says of where it stands. */
const STANDING_WORDS = {
  RUNNING: "Running",
  STOPPED: "Stopped",
  EXITED: (code: number) => `Exited ${code}`,
  SIGNALED: (signal: number) => `Ended by signal ${signal}`,
} as const;

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

/** A run action's glyph: its own icon, or the run action's rocket where it wears none. */
export function runActionGlyph(icon: LooseTaskSectionIcon | undefined): React.JSX.Element {
  return (
    (icon === undefined ? undefined : sectionGlyph(knownTaskSectionIcon(icon))) ?? (
      <GLYPH.RUN_ACTION />
    )
  );
}

/** Where a run action's shell stands in a word or two: running, stopped, or how it exited. */
function runStandingWords(shell: TerminalSummary): string {
  const { exited } = shell;
  if (shell.running || exited === undefined) return STANDING_WORDS.RUNNING;
  if ("code" in exited) return STANDING_WORDS.EXITED(exited.code);
  return STOP_SIGNALS.has(exited.signal)
    ? STANDING_WORDS.STOPPED
    : STANDING_WORDS.SIGNALED(exited.signal);
}

/** How a run action's Terminal tab looks: the action it runs, and whether it runs and in what words once its shell is read. */
export interface RunTabLook {
  readonly action: HeldAction;
  readonly running: boolean | undefined;
  readonly standing: string | undefined;
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
        standing: shell === undefined ? undefined : runStandingWords(shell),
      };
    },
    [heldOf, lists, agentIds],
  );
}
