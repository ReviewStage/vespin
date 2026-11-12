/**
 * cached-media.ts -- a video's bytes written once under the app's caches, named by its id and its type's extension, for the system's player, which reads a file and knows its kind by its extension: an Inbox thread's and an agent's recordings alike.
 */

import { CONVERSATION_MEDIA_TYPE } from "@repo/features/conversation-picture-wire";
import { MP4_TYPE } from "@repo/features/video-signature";
import { File, Paths } from "expo-file-system";

/** What a video's file is named with while its bytes are still being written, so no read takes it for the whole file. */
const WRITING_SUFFIX = ".writing";

/** The extension each video type a read answers is written under. */
const VIDEO_EXTENSION: Readonly<Record<string, string>> = {
  [MP4_TYPE]: "mp4",
  [CONVERSATION_MEDIA_TYPE.WEBM]: "webm",
};

/** Each write still under way, by the address of the file it writes, so a second read of one video waits on the first rather than writing over it. */
const writing = new Map<string, Promise<string>>();

/** A video's bytes written under a name of their own and moved into place as `file`, answering its address once they are all on disk. */
async function written(file: File, name: string, base64: string): Promise<string> {
  const partial = new File(Paths.cache, `${name}${WRITING_SUFFIX}`);

  // A write an earlier launch left unfinished is cleared rather than written over.
  if (partial.exists) partial.delete();
  await partial.write(base64, { encoding: "base64" });
  await partial.move(file, { overwrite: true });

  return file.uri;
}

/**
 * Where a video's bytes were written for the system's player to read: a
 * file of the app's caches named `<prefix>-<id>.<extension>`, written once,
 * so a recording read again is the file already written, and answered only
 * once its bytes are all on disk. Note that the bytes are written under a
 * name of their own and moved into place, so a write cut short, as the app
 * is closed, never stands as the file a later read finds; that a read of a
 * video another read is still writing waits on that write; that an MP4 plays
 * only under its extension; and that a WebM, which iOS's player cannot read,
 * says so in the player's place.
 */
export async function cachedVideo(
  prefix: string,
  id: string,
  contentType: string,
  base64: string,
): Promise<string> {
  const extension = VIDEO_EXTENSION[contentType];
  const name = extension === undefined ? `${prefix}-${id}` : `${prefix}-${id}.${extension}`;
  const file = new File(Paths.cache, name);

  if (file.exists) return file.uri;
  const under = writing.get(file.uri);

  if (under !== undefined) return under;
  const write = written(file, name, base64).finally(() => writing.delete(file.uri));
  writing.set(file.uri, write);

  return write;
}
