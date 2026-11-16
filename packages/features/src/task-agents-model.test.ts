import { describe, expect, it } from "vitest";
import { AGENT_STATUS, type AgentStatus, type AgentSummary } from "./agent-wire.js";
import { agentTree } from "./task-agents-model.js";

/**
 * task-agents-model.test.ts -- a task's Agents group nests each agent under
 * the listed one that started it, or the one that continued its starter,
 * its rows at the top standing where their first agent stands, each
 * counting what it started. Synthetic agents.
 */

/** What the tree reads of an agent, made here a field at a time. */
type TreeAgent = {
  -readonly [Field in keyof Pick<
    AgentSummary,
    "id" | "status" | "startedByAgentId" | "from"
  >]: AgentSummary[Field];
};

/** An agent of the tree, by its id, with who started it and what it continues or forks. */
function agent(
  id: string,
  status: AgentStatus,
  more: { startedByAgentId?: string; continues?: string; forks?: string } = {},
) {
  const from =
    more.continues !== undefined
      ? { agentId: more.continues, steps: 0, totalSteps: 0 }
      : more.forks !== undefined
        ? {
            agentId: more.forks,
            messageId: "f0e1d2c3-b4a5-4968-8776-655443322110",
            steps: 0,
            totalSteps: 0,
          }
        : undefined;

  const made: TreeAgent = { id, status };

  if (more.startedByAgentId !== undefined) made.startedByAgentId = more.startedByAgentId;

  if (from !== undefined) made.from = from;

  return made;
}

// An orchestrator continued from one no longer listed, the workers each started, a fork of one, and an agent the member started.
const EARLIER = "earlier-orchestrator";
const LEAD = agent("lead", AGENT_STATUS.RUNNING, { continues: EARLIER });
const BUILT = agent("built", AGENT_STATUS.COMPLETED, { startedByAgentId: "lead" });
const WAITS = agent("waits", AGENT_STATUS.COMPLETED, { startedByAgentId: "lead" });
const OLDER = agent("older", AGENT_STATUS.FAILED, { startedByAgentId: EARLIER });
const FORK = agent("fork", AGENT_STATUS.RUNNING, { forks: EARLIER });
const MINE = agent("mine", AGENT_STATUS.RUNNING);

// The order the group lists them in, the fork last, so a fork read as a continue would take on what the earlier one started.
const ORDERED = [WAITS, MINE, LEAD, BUILT, OLDER, FORK];

/** The tree's rows as each agent's id, its depth, and what it started, none where it started none. */
function drawn(open: (id: string) => boolean) {
  return agentTree(ORDERED, (each) => each, open).map(({ entry, depth, started, folded }) => [
    entry.id,
    depth,
    started,
    folded?.map((each) => each.id),
  ]);
}

describe("agentTree", () => {
  it("nests each agent under the listed one that started it or continued its starter, never a fork, a lead standing where its first agent does", () => {
    expect(drawn(() => true)).toEqual([
      ["lead", 0, { finished: 3, total: 3 }, undefined],
      ["waits", 1, undefined, undefined],
      ["built", 1, undefined, undefined],
      ["older", 1, undefined, undefined],
      ["mine", 0, undefined, undefined],
      ["fork", 0, undefined, undefined],
    ]);
  });

  it("passes by the agents under a row that stands folded, still counting them and naming them on it", () => {
    expect(drawn(() => false)).toEqual([
      ["lead", 0, { finished: 3, total: 3 }, ["waits", "built", "older"]],
      ["mine", 0, undefined, undefined],
      ["fork", 0, undefined, undefined],
    ]);
  });
});
