/**
 * repo-pins.ts -- `vespin repo pins`, `pin`, and `unpin`: the repositories the signed-in member pinned in their sidebar.
 *
 * A pin is the member's own, in every workspace, as the sidebar's is
 * (`@repo/features/task-wire`'s `repositoryPinsAnswerSchema`): `pins` reads
 * them through `repositoryPins.list`, newest pinned first, and `pin` and
 * `unpin` are one `repositoryPins.set` each, answering the pins as they then
 * stand. A pin names the repository alone, so it asks GitHub nothing.
 */

import type { RepositoryPin } from "@repo/features/task-wire";
import { Effect } from "effect";
import { Argument, Command } from "effect/cli";
import { answer } from "../output.js";
import { askService, session } from "../session.js";

/** The pins as every answer prints them: the wire's answer bar the transaction a desktop waits for. */
function pinsAnswer(pins: readonly RepositoryPin[]) {
  return {
    json: { pins: pins.map(({ repository, pinnedAt }) => ({ repository, pinnedAt })) },
    lines:
      pins.length === 0 ? ["No pinned repositories."] : pins.map(({ repository }) => repository),
    ids: pins.map(({ repository }) => repository),
  };
}

const repositoryArgument = Argument.String("repository").pipe(
  Argument.withDescription("The repository, as owner/name"),
);

/** One repository pinned or unpinned, answered with the pins as they then stand. */
function setPin(repository: string, pinned: boolean) {
  return Effect.gen(function* () {
    const { hosted } = yield* session;
    const { pins } = yield* askService(hosted.repositoryPins.set, { repository, pinned });
    yield* answer(pinsAnswer(pins));
  });
}

export const repoPinsCommand = Command.make("pins", {}, () =>
  Effect.gen(function* () {
    const { hosted } = yield* session;
    const { pins } = yield* askService(hosted.repositoryPins.list, undefined);
    yield* answer(pinsAnswer(pins));
  }),
).pipe(
  Command.withDescription("List the repositories you pinned in your sidebar, newest first"),
  Command.withExamples([{ command: "vespin repo pins", description: "Your pinned repositories" }]),
);

export const repoPinCommand = Command.make(
  "pin",
  { repository: repositoryArgument },
  ({ repository }) => setPin(repository, true),
).pipe(
  Command.withDescription("Pin a repository in your sidebar"),
  Command.withExamples([{ command: "vespin repo pin acme/app", description: "Pin acme/app" }]),
);

export const repoUnpinCommand = Command.make(
  "unpin",
  { repository: repositoryArgument },
  ({ repository }) => setPin(repository, false),
).pipe(
  Command.withDescription("Unpin a repository from your sidebar"),
  Command.withExamples([{ command: "vespin repo unpin acme/app", description: "Unpin acme/app" }]),
);
