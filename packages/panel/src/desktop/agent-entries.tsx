/**
 * agent-entries.tsx -- the task's agents as rows in their tabs' look, which History, the Overview's agents list, and ⌘K list them by.
 */

import type { AgentSummary } from "@repo/features/agent-wire";
import type { EditReader } from "@repo/ui/actor-model";
import { agentTab, sameTab } from "@repo/ui/tab-strip-model";
import { agentSummaryEnd } from "../tasks/agent-menu-row.js";
import { agentName } from "../tasks/agent-model.js";
import { agentCardReading } from "../tasks/agent-ref.js";
import { AgentTabCard } from "../tasks/agent-tab-card.js";
import { TAB_KIND, tabLook } from "../tasks/tab-look.js";
import type { AgentsControl } from "../tasks/use-agents.js";
import type { MainTabsControl } from "../tasks/use-main-tabs.js";
import type { AddEntry, HeldTranscripts } from "./strip-tabs.js";

/** The section the task's agents stand under where they are listed among other things, as ⌘K lists them, and the details' way back names. */
export const AGENTS_SECTION = "Agents";

/**
 * Each of the task's agents in the order started, or of those given (`listed`), as History lists a closed
 * or an archived one (`agent-history.tsx`), the Overview's agents list it, and ⌘K finds it, in its
 * tab's look: its harness's mark wearing where it stands, and at its end
 * what every agent row ends in (`agentSummaryEnd`): a teammate's face where
 * the reader did not start it, then a failure, as its tab does. Picking an agent
 * whose tab is open chooses that tab rather than opening another, as a
 * browser's tab search does.
 */
export function agentEntries(
  main: Pick<MainTabsControl, "tab" | "onChoose">,
  agents: AgentsControl,
  directory: EditReader,
  held?: HeldTranscripts,
  listed: readonly AgentSummary[] = agents.agents ?? [],
): AddEntry[] {
  return listed.map((agent) => {
    const label = agentName(agent, agents.models);
    const chosen = main.tab !== undefined && sameTab(agentTab(agent.id), main.tab);

    return {
      row: {
        id: agent.id,
        ...tabLook({ kind: TAB_KIND.AGENT, name: label, agent }),
        section: AGENTS_SECTION,
        replayMasked: true,
      },
      endMark: agentSummaryEnd(agent, directory),
      // Note that a caller handing what its tabs hold gets the card its tab hangs; ⌘K and the summary hang theirs themselves.
      card:
        held === undefined ? undefined : (
          <AgentTabCard
            name={label}
            models={agents.models ?? []}
            read={agentCardReading(agent, label, held, chosen, agents)}
          />
        ),
      onPick: () => main.onChoose(agentTab(agent.id)),
      agent,
    };
  });
}
