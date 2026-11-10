/**
 * repo.ts -- `vespin repo`: the repositories the signed-in member works with.
 *
 * Each subcommand lives in a file of its own beside this one and is listed
 * here: the member's sidebar pins (`repo-pins.ts`).
 */

import { Command } from "effect/cli";
import { repoPinCommand, repoPinsCommand, repoUnpinCommand } from "./repo-pins.js";

/** The repo group. */
export const repoCommand = Command.make("repo").pipe(
  Command.withDescription("Work with repositories: your sidebar pins"),
  Command.withSubcommands([repoPinsCommand, repoPinCommand, repoUnpinCommand]),
  Command.withExamples([{ command: "vespin repo pins", description: "Your pinned repositories" }]),
);
