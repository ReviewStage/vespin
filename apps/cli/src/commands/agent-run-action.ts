/**
 * agent-run-action.ts -- `vespin agent run`: one of a cloud agent's repository's run actions run in its sandbox, or with `--stop` interrupted, as the Run menu over the agent's tabs would.
 *
 * A door over the hosted procedures the Run menu calls (`agents.runAction`
 * and `agents.stopRunAction`), which hold every rule of who may and when:
 * run actions are behind the workspace's Run actions experiment, only a
 * cloud agent with a repository has them, and a stopped sandbox is refused,
 * never woken (`vespin agent wake` wakes it). The action is named by its id,
 * as `vespin setup actions` lists it.
 */

import { Effect } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { answer } from "../output.js";
import { askService, session } from "../session.js";

/** `vespin agent run`: a run action run, or stopped, in the agent's sandbox. */
export const runCommand = Command.make(
  "run",
  {
    agent: Argument.String("agent").pipe(Argument.withDescription("The agent's id")),
    action: Argument.String("action").pipe(
      Argument.withDescription("The run action's id, as `vespin setup actions` lists it"),
    ),
    stop: Flag.Boolean("stop").pipe(
      Flag.withDefault(false),
      Flag.withDescription("Interrupt what the action runs, leaving its Terminal tab open"),
    ),
  },
  ({ agent: id, action, stop }) =>
    Effect.gen(function* () {
      const { hosted } = yield* session;
      if (stop) {
        const shells = yield* askService(hosted.agents.stopRunAction, { id, action });
        yield* answer({ json: shells, lines: [`Stopped run action ${action}.`], ids: [action] });
        return;
      }
      const { terminal } = yield* askService(hosted.agents.runAction, { id, action });
      yield* answer({
        json: { terminal },
        lines: [
          `${terminal.running ? "Running" : "Ran"} ${terminal.title} in agent ${id}'s sandbox; vespin agent shell ${id} ${terminal.id} attaches to it.`,
        ],
        ids: [terminal.id],
      });
    }),
).pipe(
  Command.withDescription(
    "Run one of a cloud agent's repository's run actions in its sandbox, or stop it with --stop",
  ),
  Command.withExamples([
    { command: "vespin agent run <id> <action-id>", description: "Run it in its own shell" },
    { command: "vespin agent run <id> <action-id> --stop", description: "Interrupt it" },
  ]),
);
