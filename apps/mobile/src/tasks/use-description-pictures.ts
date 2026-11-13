/**
 * use-description-pictures.ts -- a description's pictures as the task page draws them: each read through the host as the panel's description reads one (`TASKS_PICTURE_READ`), a picture drawn from its bytes and a video from a file of the app's caches, never from the address its words name it by.
 *
 * A description names its pictures by their address on vespin.dev
 * (`@repo/features/description-attachment-link`), which only the task's
 * readers may fetch, on their own sign-in. The host fetches each on the
 * account's behalf, in its own request path, and answers its bytes, so no
 * credential leaves the host and no vespin.dev picture is fetched by its
 * address: one still on its way stands as its well, and one that could not
 * be read, or a vespin.dev address that names no description's picture,
 * says so in its place.
 */

import { descriptionAttachmentOf } from "@repo/features/description-attachment-link";
import { drawnPictureAddresses } from "@repo/features/drawn-pictures";
import { isLinkHome } from "@repo/features/link-home";
import { PICTURE_TYPE } from "@repo/features/picture-wire";
import { TASK_CALL_FAILURE } from "@repo/features/tasks-view";
import { PLAYABLE_VIDEO_TYPE } from "@repo/features/video-signature";
import { ACT_KIND } from "@repo/host/acts";
import type { MarkdownVideo } from "@repo/ui-native";
import { useEffect, useMemo, useRef, useState } from "react";
import { cachedVideo } from "../cached-media.js";
import { useHostActs } from "../host/host-provider.js";
import { openInSafari } from "../open-link.js";

/** The prefix a description's video is written under in the app's caches. */
const DESCRIPTION_MEDIA_PREFIX = "description";

/** What a video in a description is called where the player stands. */
const VIDEO_LABEL = "Video";

/** The media types a description's picture is drawn by. */
const PICTURE_TYPES: ReadonlySet<string> = new Set(Object.values(PICTURE_TYPE));

/** The media types a description's picture is played by. */
const VIDEO_TYPES: ReadonlySet<string> = new Set(Object.values(PLAYABLE_VIDEO_TYPE));

/** How a picture's read stands: drawn from its `data:` address, played from its file, or unread for good. */
const PICTURE_READ = {
  PICTURE: "picture",
  VIDEO: "video",
  UNREAD: "unread",
} as const;

/** One picture's read, once it has landed. */
type PictureRead =
  | {
      readonly kind: typeof PICTURE_READ.PICTURE | typeof PICTURE_READ.VIDEO;
      readonly source: string;
    }
  | { readonly kind: typeof PICTURE_READ.UNREAD };

/** The pictures read, by the description that owns each, then by its id. */
type PicturesRead = ReadonlyMap<string, ReadonlyMap<string, PictureRead>>;

/** How the description's words draw its pictures, handed to `Markdown` as they are. */
export interface DescriptionPictures {
  /** The address a picture is drawn from: its bytes once read, none while on its way, and `null` where it cannot be drawn; any address off vespin.dev as it is written. */
  readonly pictureSource: (written: string) => string | null | undefined;
  /** The video a description's picture is, once read; none for a picture or any other address. */
  readonly videoAt: (written: string) => MarkdownVideo | undefined;
}

/** Nothing read yet. */
const NOTHING_READ: PicturesRead = new Map();

/** The picture a vespin.dev address drawn as one names, where it names one; none for an address elsewhere, or one the app scheme spells, which the words never draw. */
function namedPicture(written: string) {
  const url = URL.canParse(written) ? new URL(written) : undefined;

  if (url === undefined || url.protocol !== "https:" || !isLinkHome(url)) return undefined;

  return { ref: descriptionAttachmentOf(written) };
}

/** `read` with one more picture's read, under its description and its id. */
function withRead(
  read: PicturesRead,
  owner: string,
  id: string,
  picture: PictureRead,
): PicturesRead {
  const ofOwner = new Map(read.get(owner) ?? []).set(id, picture);

  return new Map(read).set(owner, ofOwner);
}

/** What a picture's bytes are drawn as, by its type; unread for a type neither drawn nor played, such as a PDF. */
async function readOf(id: string, contentType: string, base64: string): Promise<PictureRead> {
  if (VIDEO_TYPES.has(contentType)) {
    const source = await cachedVideo(DESCRIPTION_MEDIA_PREFIX, id, contentType, base64);

    return { kind: PICTURE_READ.VIDEO, source };
  }

  return PICTURE_TYPES.has(contentType)
    ? { kind: PICTURE_READ.PICTURE, source: `data:${contentType};base64,${base64}` }
    : { kind: PICTURE_READ.UNREAD };
}

/**
 * The description's pictures as `body` draws them, each read once through
 * the host while the page stands, as its own description's or, where a
 * picture was copied across, as the description that owns it, which only
 * that description's readers may read. Note that a picture the service
 * answers is not there, or one of a type it cannot draw, stands unread for
 * good, while one whose read got no answer is forgotten, so the next change
 * to the words asks for it again, as an Inbox thread's files are
 * (`useThreadMedia`).
 */
export function useDescriptionPictures(body: string | undefined): DescriptionPictures {
  const acts = useHostActs();
  const [read, setRead] = useState<PicturesRead>(NOTHING_READ);
  // The pictures asked for, by owner then id, so each is asked for once while the page stands.
  const asked = useRef(new Map<string, Set<string>>());
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;

    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (body === undefined) return;

    for (const address of drawnPictureAddresses(body)) {
      const ref = namedPicture(address)?.ref;

      if (ref === undefined) continue;
      const { taskId: owner, attachmentId: id } = ref;
      const ofOwner = asked.current.get(owner) ?? new Set<string>();

      if (ofOwner.has(id)) continue;
      asked.current.set(owner, ofOwner.add(id));

      const landed = (picture: PictureRead) => {
        if (mounted.current) setRead((held) => withRead(held, owner, id, picture));
      };

      acts[ACT_KIND.TASKS_PICTURE_READ]({ planId: owner, attachmentId: id })
        .then(async (answer) => {
          if ("base64" in answer) {
            landed(await readOf(id, answer.contentType, answer.base64));

            return;
          }

          // Note that a picture not there stays so, while one that got no answer is asked for again on the words' next change.
          if (answer.failure === TASK_CALL_FAILURE.NOT_FOUND) landed({ kind: PICTURE_READ.UNREAD });
          else asked.current.get(owner)?.delete(id);
        })
        .catch((cause: unknown) => {
          asked.current.get(owner)?.delete(id);
          console.error("A description's picture was not read.", cause);
        });
    }
  }, [acts, body]);

  return useMemo(() => {
    const readAt = (written: string) => {
      const named = namedPicture(written);

      if (named === undefined) return undefined;

      return {
        picture:
          named.ref === undefined
            ? ({ kind: PICTURE_READ.UNREAD } as const)
            : read.get(named.ref.taskId)?.get(named.ref.attachmentId),
      };
    };

    return {
      pictureSource: (written) => {
        const at = readAt(written);

        // Note that a vespin.dev picture is never drawn from its address, which would fetch it with no sign-in.
        if (at === undefined) return written;

        if (at.picture === undefined) return undefined;

        return at.picture.kind === PICTURE_READ.PICTURE ? at.picture.source : null;
      },
      videoAt: (written) => {
        const picture = readAt(written)?.picture;

        // A video the system's player cannot read, such as a WebM, opens on vespin.dev in Safari, which plays it.
        return picture?.kind === PICTURE_READ.VIDEO
          ? {
              source: picture.source,
              label: VIDEO_LABEL,
              onOpenElsewhere: () => openInSafari(written),
            }
          : undefined;
      },
    };
  }, [read]);
}
