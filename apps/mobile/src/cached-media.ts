/**
 * cached-media.ts -- a video's or a file's bytes written once under the app's caches: a video named by its id and its type's extension, for the system's player, which reads a file and knows its kind by its extension, an Inbox thread's and an agent's recordings alike; and a file, such as a PDF, under its own name, for the web view that draws it and the share sheet that keeps it.
 */

import { AGENT_ATTACHMENT_TYPE } from "@repo/features/agent-wire";
import { CONVERSATION_MEDIA_TYPE } from "@repo/features/conversation-picture-wire";
import { MP4_TYPE } from "@repo/features/video-signature";
import { Directory, File, Paths } from "expo-file-system";

/** What a video's file is named with while its bytes are still being written, so no read takes it for the whole file. */
const WRITING_SUFFIX = ".writing";

/** The extension each video type a read answers is written under. */
const VIDEO_EXTENSION: ReadonlyMap<string, string> = new Map([
  [MP4_TYPE, "mp4"],
  [CONVERSATION_MEDIA_TYPE.WEBM, "webm"],
]);

/** How many writes this launch has begun, which names each one's partial file apart. */
let begun = 0;

/** What in a file's name would part a path, which an underscore stands in for. */
const PATH_PARTS = /[/\\:]/gu;

/** A name of dots alone, which names a folder rather than a file. */
const DOTS_ALONE = /^\.*$/u;

/** A file's name where none it was attached under can stand. */
const UNNAMED = "file";

/** The extension a PDF is written under whatever it was named, since its viewer draws a file by its extension. */
const PDF_EXTENSION = ".pdf";

/** Bytes written under a name of their own beside `file`, apart from every other write's, and moved into place as it, answering its address once they are all on disk. */
async function written(file: File, base64: string): Promise<string> {
  begun += 1;
  const partial = new File(file.parentDirectory, `${file.name}.${begun}${WRITING_SUFFIX}`);
  // Note that the folder is made first where it is missing, because nothing in Expo makes the app's caches folder, and a write into a folder that is not there fails.
  file.parentDirectory.create({ intermediates: true, idempotent: true });

  // A write an earlier launch left unfinished is cleared rather than written over.
  if (partial.exists) partial.delete();
  await partial.write(base64, { encoding: "base64" });

  // Note that the bytes move into place only where no other write has landed the file, and never over it, so a player already reading that file never finds it gone; the write that loses keeps the one that landed.
  try {
    await partial.move(file, { overwrite: false });
  } catch (cause) {
    if (!file.exists) throw cause;
    partial.delete();
  }

  return file.uri;
}

/**
 * The file written once: the file already written, or a write begun now.
 * Note that a read of a file another read is still writing begins a write
 * of its own rather than waiting on that one, because a native write can
 * hang on a cold boot, and a read tried again after it must not wait on the
 * same write; each is written whole under its own partial name, and the
 * first to move into place stands while the rest are let go (`written`).
 */
function once(file: File, base64: string): Promise<string> {
  return file.exists ? Promise.resolve(file.uri) : written(file, base64);
}

/**
 * Where a video's bytes were written for the system's player to read: a
 * file of the app's caches named `<prefix>-<id>.<extension>`, written once,
 * so a recording read again is the file already written, and answered only
 * once its bytes are all on disk. Note that the bytes are written under a
 * name of their own and moved into place, so a write cut short, as the app
 * is closed, never stands as the file a later read finds; that a read of a
 * video another read is still writing writes it anew (`once`); that an MP4 plays
 * only under its extension; and that a WebM, which iOS's player cannot read,
 * says so in the player's place.
 */
export async function cachedVideo(
  prefix: string,
  id: string,
  contentType: string,
  base64: string,
): Promise<string> {
  const extension = VIDEO_EXTENSION.get(contentType);
  const name = extension === undefined ? `${prefix}-${id}` : `${prefix}-${id}.${extension}`;

  return once(new File(Paths.cache, name), base64);
}

/**
 * Where a file's bytes were written for its viewer and the share sheet: a
 * file of the app's caches under the name it was attached with, in a folder
 * of its own named `<prefix>-<id>`, so two files of one name stand apart and
 * the share sheet saves it under its own name. Written once, and answered
 * only once its bytes are all on disk, as a video is (`cachedVideo`). Note
 * that a name that would part a path, or stands as none, is made safe, and
 * that a PDF always ends in `.pdf`, because the web view that draws it reads
 * a file's kind from its extension, and a PDF named as a page, `plan.html`,
 * would be drawn as one.
 */
export async function cachedFile(
  prefix: string,
  id: string,
  name: string,
  mediaType: string,
  base64: string,
): Promise<string> {
  const folder = new Directory(Paths.cache, `${prefix}-${id}`);
  folder.create({ intermediates: true, idempotent: true });
  const trimmed = name.replace(PATH_PARTS, "_").trim();
  const safe = DOTS_ALONE.test(trimmed) ? UNNAMED : trimmed;
  const pdf = mediaType === AGENT_ATTACHMENT_TYPE.PDF;

  const named =
    pdf && !safe.toLowerCase().endsWith(PDF_EXTENSION) ? `${safe}${PDF_EXTENSION}` : safe;

  return once(new File(folder, named), base64);
}
