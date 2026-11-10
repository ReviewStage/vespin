/**
 * github.ts -- `vespin github`: the signed-in member's GitHub, each part a command group of its own file.
 */

import { Command } from "effect/cli";
import { githubTokenCommand } from "./github-token.js";

/** The github group: the member's own token. */
export const githubCommand = Command.make("github").pipe(
  Command.withDescription("Your GitHub: your own classic token"),
  Command.withSubcommands([githubTokenCommand]),
  Command.withExamples([
    { command: "vespin github token show", description: "Whether your token is set" },
  ]),
);
