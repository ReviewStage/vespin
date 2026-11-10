/**
 * workspace-photo.ts -- `vespin workspace photo <file>` and `--remove`: the picture beside the workspace's name, set or removed by its owner or an admin.
 *
 * One `workspaces.setPhoto`, sent the file as the `data:` URL the app's
 * Settings › General sends, under the image type its first bytes say it
 * is, or null with `--remove`. The service holds the photo to its types and
 * its byte bound and decides who may (`workspace-operations.ts`); this only
 * says so in a person's words. It acts in the workspace `-w`,
 * `VESPIN_WORKSPACE`, or the default names (`../workspace.js`).
 */

import { HOSTED_API_ERROR } from "@repo/features";
import { CLI_EXIT } from "@repo/features/cli-exit";
import { HOSTED_DEADLINE } from "@repo/features/hosted-link";
import { sniffMediaType } from "@repo/features/media-signature";
import { WORKSPACE_PHOTO_BOUNDS, WORKSPACE_PHOTO_TYPE } from "@repo/features/workspace-wire";
import { Effect, FileSystem, Option } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { Base64 } from "effect/encoding";
import { answer, CommandFailed } from "../output.js";
import { askService, session } from "../session.js";
import { resolveWorkspace } from "../workspace.js";

/** What a photo the service takes is, in a person's words. */
const PHOTO_WORDS = `A workspace photo is a ${Object.values(WORKSPACE_PHOTO_TYPE).join(", ")} image of at most ${WORKSPACE_PHOTO_BOUNDS.MAX_BYTES} bytes.`;

/** What a photo set's refusals say, beyond what any call's would. */
const PHOTO_REFUSAL_WORDS = {
  [HOSTED_API_ERROR.NOT_PERMITTED]: "Only the workspace's owner or an admin may set its photo.",
  [HOSTED_API_ERROR.INVALID_REQUEST]: PHOTO_WORDS,
} as const;

/** The file as the `data:` URL a photo is sent as, under the type its first bytes say, or why it could not be read. */
const photoUrlOf = Effect.fnUntraced(function* (file: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  const bytes = yield* Effect.mapError(
    fileSystem.readFile(file),
    () => new CommandFailed({ exit: CLI_EXIT.USAGE, message: `Could not read ${file}.` }),
  );
  const type = sniffMediaType(bytes);
  if (type === undefined) {
    return yield* new CommandFailed({ exit: CLI_EXIT.USAGE, message: PHOTO_WORDS });
  }
  return `data:${type};base64,${Base64.encode(bytes)}`;
});

export const workspacePhotoCommand = Command.make(
  "photo",
  {
    file: Argument.String("file").pipe(
      Argument.withDescription("The photo: a PNG, JPEG, or WebP file, such as a 256-pixel square"),
      Argument.optional,
    ),
    remove: Flag.Boolean("remove").pipe(
      Flag.withDefault(false),
      Flag.withDescription("Remove the photo, so the workspace shows its owner's picture again"),
    ),
  },
  ({ file, remove }) =>
    Effect.gen(function* () {
      const named = Option.getOrUndefined(file);
      if ((named === undefined) === !remove) {
        return yield* new CommandFailed({
          exit: CLI_EXIT.USAGE,
          message: "Name a photo file, or pass --remove, not both.",
        });
      }
      const { workspace } = yield* resolveWorkspace;
      const photo = named === undefined ? null : yield* photoUrlOf(named);
      const { hosted } = yield* session;
      const { workspace: changed } = yield* askService(
        hosted.workspaces.setPhoto,
        { workspaceId: workspace.id, photo },
        HOSTED_DEADLINE.USUAL,
        PHOTO_REFUSAL_WORDS,
      );
      yield* answer({
        json: {
          workspace: {
            id: changed.id,
            slug: changed.slug,
            name: changed.name,
            photoVersion: changed.photoVersion ?? null,
          },
        },
        lines: [
          photo === null ? `Removed ${changed.name}'s photo.` : `Set ${changed.name}'s photo.`,
        ],
        ids: [changed.id],
      });
    }),
).pipe(
  Command.withDescription("Set or remove the workspace's photo (owner or admin)"),
  Command.withExamples([
    { command: "vespin workspace photo logo.png", description: "Set the photo" },
    { command: "vespin workspace photo --remove", description: "Show the owner's picture again" },
  ]),
);
