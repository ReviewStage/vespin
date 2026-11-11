/**
 * github.ts -- `vespin github`: the signed-in member's GitHub, `status` here and each other part a command group of its own file.
 *
 * `status` reads `github.connection`, which answers whether the account has
 * a GitHub link with a usable token and its login, never the token itself.
 * Connecting needs a browser, so it is done from the app's Settings.
 */

import { PRODUCT_NAME } from "@repo/features/product-name";
import { Effect } from "effect";
import { Command } from "effect/cli";
import { answer } from "../output.js";
import { askService, session } from "../session.js";
import { githubTokenCommand } from "./github-token.js";

const statusCommand = Command.make("status", {}, () =>
  Effect.gen(function* () {
    const { hosted } = yield* session;
    const connection = yield* askService(hosted.github.connection, undefined);
    yield* answer({
      json: connection,
      lines: [
        connection.connected
          ? `GitHub is connected${connection.login === null ? "" : ` as ${connection.login}`}.`
          : `GitHub is not connected; connect it from ${PRODUCT_NAME}'s Settings.`,
      ],
      ids: connection.login === null ? [] : [connection.login],
    });
  }),
).pipe(
  Command.withDescription(
    `Say whether your GitHub account is connected to ${PRODUCT_NAME}, and as whom`,
  ),
  Command.withExamples([
    { command: "vespin github status", description: "Your GitHub connection" },
  ]),
);

/** The github group: the connection, and the member's own token. */
export const githubCommand = Command.make("github").pipe(
  Command.withDescription("Your GitHub: its connection and your own classic token"),
  Command.withSubcommands([statusCommand, githubTokenCommand]),
  Command.withExamples([
    { command: "vespin github status", description: "Your GitHub connection" },
    { command: "vespin github token show", description: "Whether your token is set" },
  ]),
);
