/**
 * mac-terminal-acts.ts -- the act that opens a local agent's worktree in the Mac's own Terminal, answered on the act port.
 *
 * Only a panel opens one, so the procedure refuses any other window.
 */

import { deviceAgentCheckoutPath } from "@repo/features/device-agent-wire";
import { actPortFor, type PlatformActProcedures, refuseUnlessPanel } from "@repo/host/act-port";
import { MAC_TERMINAL_ACT_KIND } from "@repo/host/contract";
import { Effect } from "effect";
import type { WebContents } from "electron";

type MacTerminalActKind = (typeof MAC_TERMINAL_ACT_KIND)[keyof typeof MAC_TERMINAL_ACT_KIND];

export interface MacTerminalActsDependencies {
  /** This Mac's home folder, under which a local agent's worktree stands (`deviceAgentCheckoutPath`). */
  home: string;
  /** Opens the Mac's own Terminal in a folder; the host's own, or a test's. */
  openInTerminal: (folder: string) => void;
  /** Whether a folder stands on this Mac; the file system's own, or a test's. */
  exists: (folder: string) => boolean;
}

const macTerminalPort = actPortFor<WebContents>();

export function macTerminalProcedures(
  dependencies: MacTerminalActsDependencies,
): Pick<PlatformActProcedures<WebContents>, MacTerminalActKind> {
  const { home, openInTerminal, exists } = dependencies;

  return {
    [MAC_TERMINAL_ACT_KIND.MAC_TERMINAL_LOCAL_AGENT]: macTerminalPort[
      MAC_TERMINAL_ACT_KIND.MAC_TERMINAL_LOCAL_AGENT
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      // Note that the worktree is the host's to make, as it takes the agent's launch, so one not made yet is refused rather than made here.
      const folder = deviceAgentCheckoutPath(home, input.agentId);

      if (!exists(folder)) return yield* Effect.fail(errors.REFUSED());
      openInTerminal(folder);
    }),
  };
}
