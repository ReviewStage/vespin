/**
 * cached-media.ts -- a video's, a sound clip's, or a file's bytes written once under the app's caches: a video or a clip named by its id and its type's extension, for the system's player, which reads a file and knows its kind by its extension, an Inbox thread's and an agent's recordings and clips alike; and a file, such as a PDF, under its own name, for Quick Look, which draws it, and the share sheet that keeps it.
 */

import { AGENT_ATTACHMENT_TYPE } from "@repo/features/agent-wire";
import { AUDIO_TYPE } from "@repo/features/audio-signature";
import { CONVERSATION_MEDIA_TYPE } from "@repo/features/conversation-picture-wire";
import { MP4_TYPE } from "@repo/features/video-signature";
import { PICTURE_FILE_EXTENSIONS, pictureExtension } from "@repo/ui-native";
import { Directory, File, Paths } from "expo-file-system";

/** What a video's file is named with while its bytes are still being written, so no read takes it for the whole file. */
const WRITING_SUFFIX = ".writing";

/** The extension each video or sound clip type a read answers is written under, which AVPlayer reads its kind by. */
const PLAYED_EXTENSION: ReadonlyMap<string, string> = new Map([
  [MP4_TYPE, "mp4"],
  [CONVERSATION_MEDIA_TYPE.WEBM, "webm"],
  [AUDIO_TYPE.WAV, "wav"],
  [AUDIO_TYPE.MP3, "mp3"],
  [AUDIO_TYPE.M4A, "m4a"],
  [AUDIO_TYPE.AAC, "aac"],
  [AUDIO_TYPE.OGG, "ogg"],
]);

/** Every extension a picture, a video, or a sound clip is written under, which a file already written is looked for by. */
const KEPT_EXTENSIONS: readonly string[] = [
  ...PICTURE_FILE_EXTENSIONS,
  ...new Set(PLAYED_EXTENSION.values()),
];

/** A file an earlier read wrote: its address, its size in bytes, and whether it is a picture rather than a video or a clip. */
export interface KeptMedia {
  readonly uri: string;
  readonly bytes: number;
  readonly picture: boolean;
}

/** Each write still under way, by the address of the file it writes, so a second read of one video, clip, or file waits on the first rather than writing over it. */
const writing = new Map<string, Promise<string>>();

/** What in a file's name would part a path, which an underscore stands in for. */
const PATH_PARTS = /[/\\:]/gu;

/** A name of dots alone, which names a folder rather than a file. */
const DOTS_ALONE = /^\.*$/u;

/** A file's name where none it was attached under can stand. */
const UNNAMED = "file";

/** The extension a PDF is written under whatever it was named, since its viewer draws a file by its extension. */
const PDF_EXTENSION = ".pdf";

/** Bytes written under a name of their own beside `file` and moved into place as it, answering its address once they are all on disk. */
async function written(file: File, base64: string): Promise<string> {
  const partial = new File(file.parentDirectory, `${file.name}${WRITING_SUFFIX}`);

  // A write an earlier launch left unfinished is cleared rather than written over.
  if (partial.exists) partial.delete();
  await partial.write(base64, { encoding: "base64" });
  await partial.move(file, { overwrite: true });

  return file.uri;
}

/** The file written once: the file already written, the write of it still under way, or a write begun now. */
function once(file: File, base64: string): Promise<string> {
  if (file.exists) return Promise.resolve(file.uri);
  const under = writing.get(file.uri);

  if (under !== undefined) return under;
  const write = written(file, base64).finally(() => writing.delete(file.uri));
  writing.set(file.uri, write);

  return write;
}

/**
 * Where a video's or a sound clip's bytes were written for the system's
 * player to read: a file of the app's caches named
 * `<prefix>-<id>.<extension>`, written once, so a recording read again is the
 * file already written, and answered only once its bytes are all on disk.
 * Note that the bytes are written under a name of their own and moved into
 * place, so a write cut short, as the app is closed, never stands as the file
 * a later read finds; that a read of one another read is still writing waits
 * on that write; that an MP4 or a clip plays only under its extension; and
 * that a WebM or an Ogg, which iOS's player cannot read, says so in the
 * player's place.
 */
export async function cachedPlayed(
  prefix: string,
  id: string,
  contentType: string,
  base64: string,
): Promise<string> {
  const extension = PLAYED_EXTENSION.get(contentType);
  const name = extension === undefined ? `${prefix}-${id}` : `${prefix}-${id}.${extension}`;

  return once(new File(Paths.cache, name), base64);
}

/**
 * Where a picture, a video, or a sound clip of `id` already stands under the
 * app's caches, as `cachedPicture` or `cachedPlayed` wrote it on an earlier
 * read, this launch's or one before it; none where no file of it stands, as
 * before its first read or once iOS has cleared the caches. Note that a page
 * asks this before it reads through the host, because the id names bytes
 * that never change, so a picture shown once draws from its file again with
 * no request, no base64 on the JS thread, and no write; and that a file
 * still being written stands under another name until it is whole, so one
 * found here is always whole.
 */
export function keptMedia(prefix: string, id: string): KeptMedia | undefined {
  for (const extension of KEPT_EXTENSIONS) {
    const file = new File(Paths.cache, `${prefix}-${id}.${extension}`);

    if (file.exists) {
      return {
        uri: file.uri,
        bytes: file.size,
        picture: PICTURE_FILE_EXTENSIONS.includes(extension),
      };
    }
  }

  return undefined;
}

/**
 * Where a picture's bytes were written for its row to draw from: a file of
 * the app's caches named `<prefix>-<id>.<extension>`, written once as a video
 * is (`cachedPlayed`), so a page holds the file's address rather than the
 * picture's bytes, and the system's image cache, not the JS heap, holds what
 * it decoded. None for a picture type no file can be named for.
 */
export async function cachedPicture(
  prefix: string,
  id: string,
  contentType: string,
  base64: string,
): Promise<string | undefined> {
  const extension = pictureExtension(contentType);

  if (extension === undefined) return undefined;

  return once(new File(Paths.cache, `${prefix}-${id}.${extension}`), base64);
}

/**
 * Where a file's bytes were written for its viewer and the share sheet: a
 * file of the app's caches under the name it was attached with, in a folder
 * of its own named `<prefix>-<id>`, so two files of one name stand apart and
 * the share sheet saves it under its own name; where one id holds several
 * files, such as a sent line's, each stands in a folder of its own place
 * under it (`place`). Written once, and answered
 * only once its bytes are all on disk, as a video is (`cachedPlayed`). Note
 * that a name that would part a path, or stands as none, is made safe, and
 * that a PDF always ends in `.pdf`, because Quick Look, which draws it, reads
 * a file's kind from its extension, and a PDF named as a page, `plan.html`,
 * would be drawn as one.
 */
export async function cachedFile(
  prefix: string,
  id: string,
  name: string,
  mediaType: string,
  base64: string,
  place?: string,
): Promise<string> {
  const owner = new Directory(Paths.cache, `${prefix}-${id}`);
  const folder = place === undefined ? owner : new Directory(owner, place);
  folder.create({ intermediates: true, idempotent: true });
  const trimmed = name.replace(PATH_PARTS, "_").trim();
  const safe = DOTS_ALONE.test(trimmed) ? UNNAMED : trimmed;
  const pdf = mediaType === AGENT_ATTACHMENT_TYPE.PDF;

  const named =
    pdf && !safe.toLowerCase().endsWith(PDF_EXTENSION) ? `${safe}${PDF_EXTENSION}` : safe;

  return once(new File(folder, named), base64);
}
