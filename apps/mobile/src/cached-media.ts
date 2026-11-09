/**
 * cached-media.ts -- a video's bytes written once under the app's caches, named by its id and its type's extension, for the system's player, which reads a file and knows its kind by its extension.
 */

import { CONVERSATION_MEDIA_TYPE } from "@repo/features/conversation-picture-wire";
import { MP4_TYPE } from "@repo/features/video-signature";
import { File, Paths } from "expo-file-system";

/** The extension each video type a read answers is written under. */
const VIDEO_EXTENSION: Readonly<Record<string, string>> = {
  [MP4_TYPE]: "mp4",
  [CONVERSATION_MEDIA_TYPE.WEBM]: "webm",
};

/**
 * Where a video's bytes were written for the system's player to read: a
 * file of the app's caches named `<prefix>-<id>.<extension>`, written once,
 * so a recording read again is the file already written. Note that an MP4
 * plays only under its extension, and a WebM, which iOS's player cannot
 * read, says so in the player's place.
 */
export function cachedVideo(
  prefix: string,
  id: string,
  contentType: string,
  base64: string,
): string {
  const extension = VIDEO_EXTENSION[contentType];
  const file = new File(
    Paths.cache,
    extension === undefined ? `${prefix}-${id}` : `${prefix}-${id}.${extension}`,
  );
  if (!file.exists) file.write(base64, { encoding: "base64" });
  return file.uri;
}
