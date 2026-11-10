/**
 * workspace-create.ts -- `vespin workspace create <name>`: a new workspace, the signed-in member its owner.
 *
 * One `workspaces.create`, whose service trims and bounds the name and
 * spells the slug from it, as Create workspace in the app does. The default
 * workspace the config keeps is left as it is; `vespin workspace use` moves
 * it to the new one.
 */

import { Effect } from "effect";
import { Argument, Command } from "effect/cli";
import { answer } from "../output.js";
import { askService, session } from "../session.js";

export const createCommand = Command.make(
  "create",
  {
    name: Argument.String("name").pipe(Argument.withDescription("The new workspace's name")),
  },
  ({ name }) =>
    Effect.gen(function* () {
      const { hosted } = yield* session;
      const { workspace } = yield* askService(hosted.workspaces.create, { name });
      const named = workspace.slug ?? workspace.id;
      yield* answer({
        json: {
          workspace: {
            id: workspace.id,
            slug: workspace.slug,
            name: workspace.name,
            role: workspace.role,
          },
        },
        lines: [
          `Created ${workspace.name} (${named}).`,
          `Run vespin workspace use ${named} to act in it by default.`,
        ],
        ids: [workspace.id],
      });
    }),
).pipe(
  Command.withDescription("Create a workspace, with you as its owner"),
  Command.withExamples([
    { command: 'vespin workspace create "Acme"', description: "A new workspace named Acme" },
  ]),
);
