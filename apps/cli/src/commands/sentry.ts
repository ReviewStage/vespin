/**
 * sentry.ts -- `vespin sentry list|disconnect`: a workspace's installations of our Sentry integration, as its Settings › Integrations reads and ends them.
 *
 * Both are procedures of the hosted contract (`contract/workspace-sentry.ts`)
 * about the workspace the command acts in (`../workspace.js`): any member
 * lists them, and only an owner or an admin disconnects one, which the
 * service holds. Installing one takes a browser, in the app.
 */

import { HOSTED_API_ERROR } from "@repo/features";
import { Effect } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { answer, columns, confirmOrYes } from "../output.js";
import { askService, session } from "../session.js";
import { resolveWorkspace } from "../workspace.js";

/** The words a disconnect's refusal is told in. */
const DISCONNECT_REFUSAL = {
  [HOSTED_API_ERROR.NOT_FOUND]:
    "The workspace holds no such Sentry installation. vespin sentry list names its installations.",
  [HOSTED_API_ERROR.NOT_PERMITTED]:
    "Only an owner or an admin of the workspace may disconnect its Sentry.",
} as const;

const listCommand = Command.make("list", {}, () =>
  Effect.gen(function* () {
    const { workspace } = yield* resolveWorkspace;
    const { hosted } = yield* session;
    const sentry = yield* askService(hosted.workspaceSentry.installations, {
      workspaceId: workspace.id,
    });
    const lines = !sentry.configured
      ? ["Sentry is not offered on this deployment."]
      : sentry.installations.length === 0
        ? ["No Sentry organization is linked. Link one from Settings › Integrations in the app."]
        : columns(
            sentry.installations.map((one) => [one.installationId, one.account ?? "(unnamed)"]),
          );
    yield* answer({
      json: { workspaceId: workspace.id, ...sentry },
      lines,
      ids: sentry.installations.map(({ installationId }) => installationId),
    });
  }),
).pipe(
  Command.withDescription("List the Sentry organizations linked to the workspace"),
  Command.withExamples([
    { command: "vespin sentry list", description: "The workspace's Sentry installations" },
  ]),
);

const disconnectCommand = Command.make(
  "disconnect",
  {
    installation: Argument.String("installation").pipe(
      Argument.withDescription("The installation, by its id as list prints it"),
    ),
    yes: Flag.Boolean("yes").pipe(
      Flag.withAlias("y"),
      Flag.withDefault(false),
      Flag.withDescription("Disconnect without asking; required where stdin is no terminal"),
    ),
  },
  ({ installation, yes }) =>
    Effect.gen(function* () {
      const { workspace } = yield* resolveWorkspace;
      yield* confirmOrYes(
        `Disconnect Sentry installation ${installation} from ${workspace.name}? Its issues and alerts start no automation after.`,
        yes,
      );
      const { hosted } = yield* session;
      const sentry = yield* askService(
        hosted.workspaceSentry.disconnect,
        { workspaceId: workspace.id, installationId: installation },
        undefined,
        DISCONNECT_REFUSAL,
      );
      yield* answer({
        json: {
          workspaceId: workspace.id,
          configured: sentry.configured,
          installations: sentry.installations,
        },
        lines: [`Disconnected Sentry installation ${installation}.`],
        ids: [installation],
      });
    }),
).pipe(
  Command.withDescription("Disconnect one of the workspace's Sentry installations"),
  Command.withExamples([
    { command: "vespin sentry disconnect <installation>", description: "After you confirm" },
    { command: "vespin sentry disconnect <installation> --yes", description: "From a script" },
  ]),
);

export const sentryCommand = Command.make("sentry").pipe(
  Command.withDescription("List and disconnect the workspace's Sentry installations"),
  Command.withSubcommands([listCommand, disconnectCommand]),
  Command.withExamples([
    { command: "vespin sentry list", description: "The workspace's Sentry installations" },
  ]),
);
