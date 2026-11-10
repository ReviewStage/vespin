/**
 * pr.ts -- `vespin pr`: any pull request of a repository the workspace reaches, read by its link or as `owner/name#number`, each subcommand in a file of its own.
 */

import { Command } from "effect/cli";
import { chaptersCommand } from "./pr-chapters.js";

export const prCommand = Command.make("pr").pipe(
  Command.withDescription("Read pull requests and their chapters"),
  Command.withSubcommands([chaptersCommand]),
);
