/**
 * pr.ts -- `vespin pr`: any pull request of a repository the workspace reaches on GitHub, named by its page or as `owner/name#number`, each subcommand in a file of its own.
 */

import { Command } from "effect/cli";
import { viewCommand } from "./pr-view.js";
import { viewedCommand } from "./pr-viewed.js";

export const prCommand = Command.make("pr").pipe(
  Command.withDescription("Read any pull request of a repository your workspace reaches on GitHub"),
  Command.withSubcommands([viewCommand, viewedCommand]),
  Command.withExamples([
    { command: "vespin pr view acme/relay#42", description: "Its overview and description" },
    { command: "vespin pr view acme/relay#42 --diff", description: "Every file's patch" },
  ]),
);
