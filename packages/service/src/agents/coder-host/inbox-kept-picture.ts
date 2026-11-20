import type { DatabaseServices, StoreFailure } from "@repo/database/core/query";
import { readShownAgentPicture } from "@repo/database/models/conversation-pictures";
import { readWorkspaceDescriptionAttachment } from "@repo/database/models/description-attachments";
import { AGENT_TOOL } from "@repo/features/agent-tools";
import {
  type DescriptionAttachmentRef,
  descriptionAttachmentOf,
} from "@repo/features/description-attachment-link";
import {
  INBOX_PICTURE_IN_WORDS,
  inboxPictureDestination,
} from "@repo/features/inbox-attachment-link";
import { INBOX_FILE_TYPE } from "@repo/features/inbox-wire";
import { insideCode } from "@repo/features/mention-link";
import { Effect, Option, Result } from "effect";
import type { InboxBodyPicture } from "../../inbox/inbox-store.js";

/**
 * inbox-kept-picture.ts -- a picture a post draws from what is already kept in its workspace rather than from the poster's sandbox: one an agent showed with `show_media`, by the id that call answered, or one of a task's description, by its address.
 *
 * A Manager's agents take their screenshots in sandboxes of their own,
 * which no path of the Manager's reaches. So a post may draw a picture
 * as `![alt](<id> "caption")`, the id an agent's `show_media` answered,
 * which the agent hands its Manager in a message, or as
 * `![alt](<address> "caption")`, a description picture's address as
 * `read_task` writes it. Either is copied into the thread as the
 * message's own file: kept beside the message and deleted with it, as a
 * picture read from a sandbox is.
 *
 * Each is read as the poster's account, and only in the poster's
 * workspace: a transcript's picture where an agent the account may read
 * showed it with `show_media` (`readShownAgentPicture`), so a browser's
 * screenshot, a Mac's window, or a file a line handed an agent, each kept
 * on terms of its own, is none to copy; a description's where the account
 * reaches the task (`readWorkspaceDescriptionAttachment`). Anything else
 * is refused in one sentence alike, so a refusal never says that a
 * picture stands where the poster cannot read it. A description's PDF is
 * refused by name, since a post draws a picture where its words name it
 * and a PDF is no picture. Note that a copy is held to no bound of its
 * own, because `show_media` and a description hold a picture, a
 * recording, and a clip to the bounds a thread's message holds them to.
 */

/** Why a kept picture was not copied, in the words the model reads; each is followed by what the post named. */
export const KEPT_PICTURE_REFUSAL = {
  UNREACHED: `Not posted: a picture names no picture you may read that an agent of your workspace showed with ${AGENT_TOOL.SHOW_MEDIA}, by the id it answered, nor one of a task's description, by its address:`,
  PDF: "Not posted: a picture names a description's PDF, which a post does not copy; draw a picture, a recording, or a sound clip:",
} as const;

/** An id as the service mints one: a UUID in lower case. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/** Where a kept picture a post names stands: beside an agent's transcript, or in a task's description. */
type KeptSource = { readonly shown: string } | { readonly description: DescriptionAttachmentRef };

/** The kept picture a post's destination names; nothing for a path in the sandbox. */
function keptSourceOf(destination: string): KeptSource | undefined {
  if (UUID.test(destination)) return { shown: destination };
  const description = descriptionAttachmentOf(destination);

  return description === undefined ? undefined : { description };
}

/**
 * The description pictures' addresses a post's words draw, in the order
 * first drawn, each once; a picture in code is none. Note that an id a
 * post draws names no scheme, so it stands among the sandbox's paths
 * (`inboxSandboxPicturePaths`) and is not read here.
 */
export function keptAddressesIn(text: string): readonly string[] {
  const addresses = new Set<string>();

  for (const match of text.matchAll(INBOX_PICTURE_IN_WORDS)) {
    const destination = inboxPictureDestination(match[2] ?? "");

    if (insideCode(text, match.index) || descriptionAttachmentOf(destination) === undefined) {
      continue;
    }

    addresses.add(destination);
  }

  return [...addresses];
}

/** The file a kept row copies to: its type, its bytes, and its phone copy where it keeps one. */
interface KeptFile {
  readonly contentType: InboxBodyPicture["contentType"];
  readonly bytes: Uint8Array;
  readonly mp4Bytes: Uint8Array | null;
}

/** The kept row under the source, as the poster may read it; nothing where it may not. */
function keptFileOf(
  poster: { readonly userId: string; readonly organizationId: string },
  source: KeptSource,
): Effect.Effect<Option.Option<KeptFile>, StoreFailure, DatabaseServices> {
  if ("shown" in source) return readShownAgentPicture(poster, source.shown);

  return readWorkspaceDescriptionAttachment(poster, source.description);
}

/**
 * The kept picture a post's destination names, copied as the post keeps a
 * file it read from its sandbox, under the destination as written and
 * named by the id it is kept under; or the one sentence refusing it.
 * Nothing where the destination names no kept picture, which is then a
 * path in the sandbox.
 */
export function readKeptPicture(
  poster: { readonly userId: string; readonly organizationId: string },
  destination: string,
): Effect.Effect<
  Result.Result<InboxBodyPicture, string> | undefined,
  StoreFailure,
  DatabaseServices
> {
  const source = keptSourceOf(destination);

  if (source === undefined) return Effect.succeed(undefined);
  const id = "shown" in source ? source.shown : source.description.attachmentId;

  return Effect.map(keptFileOf(poster, source), (found) => {
    if (Option.isNone(found))
      return Result.fail(`${KEPT_PICTURE_REFUSAL.UNREACHED} ${destination}`);
    const { contentType, bytes, mp4Bytes } = found.value;

    if (contentType === INBOX_FILE_TYPE.PDF) {
      return Result.fail(`${KEPT_PICTURE_REFUSAL.PDF} ${destination}`);
    }

    return Result.succeed({
      path: destination,
      name: id,
      contentType,
      bytes,
      mp4Bytes: mp4Bytes ?? undefined,
    });
  });
}
