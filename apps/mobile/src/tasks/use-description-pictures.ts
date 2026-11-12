/**
 * use-description-pictures.ts -- a description's pictures as the task page draws them: each read through the host as the panel's description reads one (`TASKS_PICTURE_READ`), a picture drawn from its bytes and a video from a file of the app's caches, never from the address its words name it by.
 *
 * A description names its pictures by their address on vespin.dev
 * (`@repo/features/description-attachment-link`), which only the task's
 * readers may fetch, on their own sign-in. The host fetches each on the
 * account's behalf, in its own request path, and answers its bytes, so no
 * credential leaves the host and no picture is fetched by its address: one
 * still on its way, or one that could not be read, draws its well alone.
 */

import {
  descriptionAttachmentOf,
  taskPicturesIn,
} from "@repo/features/description-attachment-link";
import { PLAYABLE_VIDEO_TYPE } from "@repo/features/video-signature";
import { ACT_KIND } from "@repo/host/acts";
import type { MarkdownVideo } from "@repo/ui-native";
import { useEffect, useMemo, useRef, useState } from "react";
import { cachedVideo } from "../cached-media.js";
import { useHostActs } from "../host/host-provider.js";

/** The prefix a description's video is written under in the app's caches. */
const DESCRIPTION_MEDIA_PREFIX = "description";

/** What a video in a description is called where the player stands. */
const VIDEO_LABEL = "Video";

/** The media types a description's picture is a video by. */
const VIDEO_TYPES: ReadonlySet<string> = new Set(Object.values(PLAYABLE_VIDEO_TYPE));

/** One picture read: a picture drawn from its `data:` address, or a video played from its file. */
type PictureRead = { readonly video: boolean; readonly source: string };

/** The pictures read, by the description that owns each, then by its id. */
type PicturesRead = ReadonlyMap<string, ReadonlyMap<string, PictureRead>>;

/** How the description's words draw its pictures, handed to `Markdown` as they are. */
export interface DescriptionPictures {
  /** The address a picture is drawn from: its bytes once read, none while on its way; any address that names no description's picture as it is written. */
  readonly pictureSource: (written: string) => string | undefined;
  /** The video a description's picture is, once read; none for a picture or any other address. */
  readonly videoAt: (written: string) => MarkdownVideo | undefined;
}

/** Nothing read yet. */
const NOTHING_READ: PicturesRead = new Map();

/** `read` with one more picture, under its description and its id. */
function withRead(
  read: PicturesRead,
  owner: string,
  id: string,
  picture: PictureRead,
): PicturesRead {
  const ofOwner = new Map(read.get(owner) ?? []).set(id, picture);

  return new Map(read).set(owner, ofOwner);
}

/**
 * The description's pictures as `body` names them, each read once through
 * the host while the page stands, as its own description's or, where a
 * picture was copied across, as the description that owns it, which only
 * that description's readers may read. Note that a read that fails is
 * forgotten, so the next change to the words asks for it again, as an Inbox
 * thread's files are (`useThreadMedia`).
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

    for (const address of taskPicturesIn(body)) {
      const named = descriptionAttachmentOf(address);

      if (named === undefined) continue;
      const { taskId: owner, attachmentId: id } = named;
      const ofOwner = asked.current.get(owner) ?? new Set<string>();

      if (ofOwner.has(id)) continue;
      asked.current.set(owner, ofOwner.add(id));

      acts[ACT_KIND.TASKS_PICTURE_READ]({ planId: owner, attachmentId: id })
        .then(async (answer) => {
          if (!("base64" in answer))
            throw new Error(`The picture was not read: ${answer.failure}.`);
          const video = VIDEO_TYPES.has(answer.contentType);

          const source = video
            ? await cachedVideo(DESCRIPTION_MEDIA_PREFIX, id, answer.contentType, answer.base64)
            : `data:${answer.contentType};base64,${answer.base64}`;

          if (mounted.current) setRead((held) => withRead(held, owner, id, { video, source }));
        })
        .catch((cause: unknown) => {
          asked.current.get(owner)?.delete(id);
          console.error("A description's picture was not read.", cause);
        });
    }
  }, [acts, body]);

  return useMemo(() => {
    const readOf = (written: string) => {
      const named = descriptionAttachmentOf(written);

      return named === undefined
        ? undefined
        : { read: read.get(named.taskId)?.get(named.attachmentId) };
    };

    return {
      pictureSource: (written) => {
        const named = readOf(written);

        // Note that a description's picture is never drawn from its address, which would fetch it with no sign-in.
        if (named === undefined) return written;

        return named.read?.video === false ? named.read.source : undefined;
      },
      videoAt: (written) => {
        const picture = readOf(written)?.read;

        return picture?.video === true ? { source: picture.source, label: VIDEO_LABEL } : undefined;
      },
    };
  }, [read]);
}
