/**
 * gates.ts -- what opens each of our narrowed tools to an agent, declared once, and where an agent stands against them.
 *
 * A tool of the catalog (`catalog.ts`) is offered every agent, or stands
 * behind its gates, each of which must open: the agent's task, its
 * repository, the sandbox of ours it runs in, or one of its workspace's
 * experiments, such as Memory or Task descriptions. Each gate is
 * declared here once, with how it is read off the agent and the words a
 * call it shuts would be refused with, so the list an agent is offered and
 * a refusal of a call it makes anyway read the same rule. An agent's
 * standing is the gates open to it and its experiments, which
 * word the tools it is listed, read once per list or call; an agent whose
 * row is gone has every gate shut and every experiment off, since no gated
 * tool's door would carry out a call for an agent that no longer stands.
 */

import type { DatabaseServices } from "@repo/database/core/query";
import {
  type Agent,
  type AgentStoreEffect,
  hasRepository,
  readAgent,
  readAgentOfConversation,
} from "@repo/database/models/agent-store";
import { AGENT_KIND, AGENT_MACHINE } from "@repo/features/agent-wire";
import { Effect, Option } from "effect";
import { logStoreFailure } from "../../http/store-failure.js";
import { CODER_REFUSAL } from "../coder-host/bounds.js";
import type { AdmittedConversation } from "../sessions/admitted-conversation.js";
import {
  EXPERIMENT_OFF_REFUSAL,
  type ExperimentsOn,
  experimentsOnIn,
  NO_EXPERIMENT_ON,
} from "../workspace-experiment-on.js";

/** The gates a tool may stand behind; a tool stands behind every one it names. */
export const TOOL_GATE = {
  /** The agent works on a task: one its pages, its browser, and its suggestions stand on. */
  TASK: "task",
  /** The agent works in a repository: a checkout to open a pull request from. */
  REPOSITORY: "repository",
  /** The agent runs in a sandbox of ours rather than on the developer's own machine. */
  SANDBOX: "sandbox",
  /** The agent's workspace has Memory on. */
  MEMORY: "memory",
  /** The agent's workspace has Task descriptions on. */
  DESCRIPTIONS: "descriptions",
  /** The agent's workspace has Reply buttons on. */
  REPLY_BUTTONS: "reply-buttons",
  /** The agent's workspace has Done and follow-ups on, and it is no Manager, whose words reach people through `send_to_user` alone. */
  TURN_END: "turn-end",
  /** The member whose Mac the agent reaches has Computer use on, as their own experiment. */
  COMPUTER_USE: "computer-use",
  /** The member the agent's threads would land with, its task's assignee else its starter, keeps an Inbox. */
  INBOX: "inbox",
  /** The agent is a Manager, whose page is a chat with the people who can open it. */
  MANAGER: "manager",
  /** No Manager started the agent: one a Manager started reaches people through that Manager alone, so it posts no threads of its own. */
  UNMANAGED: "unmanaged",
} as const;

export type ToolGate = (typeof TOOL_GATE)[keyof typeof TOOL_GATE];

/** What a gate reads beside the agent's row: its experiments, and whether a Manager started it, read once with them. */
interface GateFacts {
  readonly experiments: ExperimentsOn;
  readonly startedByManager: boolean;
}

/** One gate: whether it opens to an agent, given what it reads beside the row (`GateFacts`), and the words a call it shuts is refused with. */
interface Gate {
  readonly opens: (agent: Agent, facts: GateFacts) => boolean;
  readonly refusal: string;
}

/**
 * Each gate as it is read and refused. Note that `SANDBOX` shuts on a
 * device alone, because a local agent's machine runs no browser of ours
 * and shares no ports of ours. The refusals are the words each gate's doors
 * refused with before the catalog refused for them (`catalog.ts`'s
 * `callTool`), but `SANDBOX`'s, which no door said, and an experiment's,
 * which names none (`EXPERIMENT_OFF_REFUSAL`); a tool whose door answered
 * otherwise words its own (`CatalogTool`'s `refused`).
 */
export const GATES: Readonly<Record<ToolGate, Gate>> = {
  [TOOL_GATE.TASK]: {
    opens: (agent) => agent.taskId !== null,
    refusal: "Not run: you work on no task, and this tool works only for an agent on one.",
  },
  [TOOL_GATE.REPOSITORY]: {
    opens: (agent) => hasRepository(agent),
    refusal: CODER_REFUSAL.NO_REPOSITORY,
  },
  [TOOL_GATE.SANDBOX]: {
    opens: (agent) => agent.machine !== AGENT_MACHINE.DEVICE,
    refusal:
      "Not run: you run on the developer's own machine, where this tool is not offered; do it from your shell instead.",
  },
  [TOOL_GATE.MEMORY]: {
    opens: (_agent, { experiments }) => experiments.memoryOn,
    refusal: EXPERIMENT_OFF_REFUSAL,
  },
  [TOOL_GATE.DESCRIPTIONS]: {
    opens: (_agent, { experiments }) => experiments.descriptionsOn,
    refusal: EXPERIMENT_OFF_REFUSAL,
  },
  [TOOL_GATE.REPLY_BUTTONS]: {
    opens: (_agent, { experiments }) => experiments.replyButtonsOn,
    refusal: EXPERIMENT_OFF_REFUSAL,
  },
  // Note that a Manager ends no turn with a summary, since its page draws none: its chat holds its `send_to_user` messages alone.
  [TOOL_GATE.TURN_END]: {
    opens: (agent, { experiments }) => experiments.turnEndOn && agent.kind !== AGENT_KIND.MANAGER,
    refusal: EXPERIMENT_OFF_REFUSAL,
  },
  [TOOL_GATE.COMPUTER_USE]: {
    opens: (_agent, { experiments }) => experiments.computerUseOn,
    refusal: EXPERIMENT_OFF_REFUSAL,
  },
  [TOOL_GATE.INBOX]: {
    opens: (_agent, { experiments }) => experiments.inboxOn,
    refusal: EXPERIMENT_OFF_REFUSAL,
  },
  [TOOL_GATE.MANAGER]: {
    opens: (agent) => agent.kind === AGENT_KIND.MANAGER,
    refusal: "Not run: only a Manager has a chat to send to; reach people with your threads.",
  },
  [TOOL_GATE.UNMANAGED]: {
    opens: (_agent, { startedByManager }) => !startedByManager,
    refusal:
      "Not run: a Manager started you, and you post no threads; send questions and reports to it with message_agent.",
  },
};

/**
 * Whether the agent's own starter, where an agent started it, is a Manager.
 * Note that only the direct starter counts, and that a starter which cannot
 * be read is taken as none, logged for the operator.
 */
function startedByManager(agent: Agent): Effect.Effect<boolean, never, DatabaseServices> {
  if (agent.startedByAgentId === null) return Effect.succeed(false);

  return readAgent(agent.userId, agent.startedByAgentId).pipe(
    Effect.map(Option.exists((starter) => starter.kind === AGENT_KIND.MANAGER)),
    Effect.tapError(logStoreFailure),
    Effect.orElseSucceed(() => false),
  );
}

/** Where an agent stands against the gates: its row, where it still stands, the gates open to it, and its experiments, which word the tools it is listed. */
export interface AgentStanding {
  readonly agent: Option.Option<Agent>;
  readonly open: ReadonlySet<ToolGate>;
  readonly experiments: ExperimentsOn;
}

/** The standing of an agent's row, its experiments read once, or of none, whose every gate is shut and every experiment off. */
export function standingOfAgent(
  agent: Option.Option<Agent>,
): Effect.Effect<AgentStanding, never, DatabaseServices> {
  if (Option.isNone(agent)) {
    return Effect.succeed({ agent, open: new Set(), experiments: NO_EXPERIMENT_ON });
  }

  return Effect.map(
    Effect.all([experimentsOnIn(agent.value), startedByManager(agent.value)]),
    ([experiments, managed]) => ({
      agent,
      open: new Set(
        Object.values(TOOL_GATE).filter((gate) =>
          GATES[gate].opens(agent.value, { experiments, startedByManager: managed }),
        ),
      ),
      experiments,
    }),
  );
}

/** The standing of the agent whose conversation the call was admitted to. */
export function standingOf(admitted: AdmittedConversation): AgentStoreEffect<AgentStanding> {
  const { userId, conversationId } = admitted.target;

  return Effect.flatMap(readAgentOfConversation(userId, conversationId), standingOfAgent);
}
