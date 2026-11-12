/**
 * agent-lifecycle.ts -- `vespin agent rewind`, `delete`, and `wake`: a coding agent taken back to just before one of the lines sent to it, deleted for good, and its cloud sandbox resumed and its runner started.
 *
 * Each is a door over the hosted procedure the app's own control calls
 * (`agents.rewind`, `agents.delete`, `agents.sandboxResume` and
 * `agents.warm`), which hold every rule of who may and when; nothing here
 * decides one. A rewind names its line by the message id `vespin agent logs
 * --json` prints, the same id the member MCP server's `read_agent` names a
 * line's `lineId`. A delete cannot be taken back, so it asks first at a
 * terminal and takes `--yes` elsewhere (`confirmOrYes`); like the app's, it
 * stops an agent still working before it deletes it.
 */

import { SANDBOX_STATE, type SandboxState } from "@repo/features/terminal-wire";
import { Effect } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { answer, confirmOrYes } from "../output.js";
import { askService, session } from "../session.js";

const agentArgument = Argument.String("agent").pipe(Argument.withDescription("The agent's id"));

/** What a person reads of where the agent's sandbox stands after a wake. */
const SANDBOX_WORDS = {
  [SANDBOX_STATE.RUNNING]: "The agent's sandbox is running.",
  [SANDBOX_STATE.STOPPED]: "The agent's sandbox is still stopped.",
  [SANDBOX_STATE.STARTING]: "The agent's sandbox opens on its first command.",
} as const satisfies Record<SandboxState, string>;

/** `vespin agent rewind`: the agent taken back to just before one of the lines sent to it. */
export const rewindCommand = Command.make(
  "rewind",
  {
    agent: agentArgument,
    message: Argument.String("message").pipe(
      Argument.withDescription(
        "The line to go back to just before, by its message id (vespin agent logs <id> --json)",
      ),
    ),
  },
  ({ agent: id, message }) =>
    Effect.gen(function* () {
      const { hosted } = yield* session;

      const { agent } = yield* askService(hosted.agents.rewind, {
        params: { id },
        body: { messageId: message },
      });

      yield* answer({
        json: agent,
        lines: [`Rewound agent ${agent.id} to just before that line.`],
        ids: [agent.id],
      });
    }),
).pipe(
  Command.withDescription(
    "Take an agent back to just before one of the lines sent to it, stopping it first; its checkout stays",
  ),
  Command.withExamples([
    {
      command: "vespin agent rewind <id> <message-id>",
      description: "Drop that line and everything after it",
    },
  ]),
);

/** `vespin agent delete`: the agent deleted for good, asked first. */
export const deleteCommand = Command.make(
  "delete",
  {
    agent: agentArgument,
    yes: Flag.Boolean("yes").pipe(
      Flag.withAlias("y"),
      Flag.withDefault(false),
      Flag.withDescription("Delete without asking; needed where there is no terminal to ask"),
    ),
  },
  ({ agent: id, yes }) =>
    Effect.gen(function* () {
      yield* confirmOrYes(`Delete agent ${id} for good?`, yes);
      const { hosted } = yield* session;
      yield* askService(hosted.agents.delete, { id });
      yield* answer({ json: { id, deleted: true }, lines: [`Deleted agent ${id}.`], ids: [id] });
    }),
).pipe(
  Command.withDescription(
    "Delete an agent for good, stopping it first; its branch and pull request on GitHub stay",
  ),
  Command.withExamples([
    { command: "vespin agent delete <id>", description: "Asks before it deletes" },
    { command: "vespin agent delete <id> --yes", description: "From a script" },
  ]),
);

/** `vespin agent wake`: the agent's stopped sandbox resumed, and its runner started where none runs. */
export const wakeCommand = Command.make("wake", { agent: agentArgument }, ({ agent: id }) =>
  Effect.gen(function* () {
    const { hosted } = yield* session;
    const { sandbox } = yield* askService(hosted.agents.sandboxResume, { id });
    yield* askService(hosted.agents.warm, { id });
    yield* answer({ json: { id, sandbox }, lines: [SANDBOX_WORDS[sandbox]], ids: [id] });
  }),
).pipe(
  Command.withDescription(
    "Resume an agent's stopped cloud sandbox and start its runner, so it answers at once",
  ),
  Command.withExamples([{ command: "vespin agent wake <id>", description: "Wake it up" }]),
);
