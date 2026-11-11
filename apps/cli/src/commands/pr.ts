/**
 * pr.ts -- `vespin pr`: any pull request of a repository the workspace reaches, read by its link or as `owner/name#number`, each subcommand in a file of its own.
 */

import { Command } from "effect/cli";
import { chaptersCommand } from "./pr-chapters.js";
import { viewCommand } from "./pr-view.js";
import { viewedCommand } from "./pr-viewed.js";

export const prCommand = Command.make("pr").pipe(
  Command.withDescription("Read pull requests, their chapters, and mark their files viewed"),
  Command.withSubcommands([viewCommand, viewedCommand, chaptersCommand]),
  Command.withExamples([
    { command: "vespin pr view acme/relay#42", description: "Its overview and description" },
    { command: "vespin pr view acme/relay#42 --diff", description: "Every file's patch" },
  ]),
);
