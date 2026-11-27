/**
 * service-file.ts -- a sound clip, a PDF, or any other file the service keeps for an agent, an Inbox thread, or a task, as a file under the app's caches: downloaded once by its id, with the header its read carries, by the system's URL session, so its bytes never cross into JavaScript, and found there again on its next read.
 *
 * A picture and a recording draw and play from the service's address
 * through expo-image and expo-video, which keep their own caches
 * (`use-pictures.tsx`); what the system's audio strip, Quick Look, and the
 * share sheet read must be a file of the app's, so it is downloaded here.
 * The host answers where the file stands and the header its read carries
 * (`ACCOUNT_PICTURE_SOURCE`), asked once more under a renewed header where
 * the download was refused. Each file stands in a folder of its own under
 * its owner and its id, named by what its type plays as, or by its own
 * name where it is a file a reader opens. Note that a download is written
 * under a name of its own and moved into place only once it is whole, so a
 * file found there is never one cut short, and one that failed is deleted;
 * that the header goes to the download alone, never to a log, a file's
 * name, or a notice, and a failure says only the app's own words; and that
 * every file here is let go on sign-out and whenever the account signed in
 * changes (`forgetServiceFiles`, `account-files.ts`), so another account
 * signed in never reads this one's. A fixture run's file, answered
 * as its own `data:` address, is written from it.
 */

import { AUDIO_TYPE } from "@repo/features/audio-signature";
import { CONVERSATION_MEDIA_TYPE } from "@repo/features/conversation-picture-wire";
import {
  PICTURE_OWNER,
  type PictureSourceParams,
  type PictureSourceView,
} from "@repo/features/picture-source-wire";
import { MP4_TYPE } from "@repo/features/video-signature";
import { ACT_KIND } from "@repo/host/acts";
import { randomUUID } from "expo-crypto";
import { Directory, File, Paths } from "expo-file-system";
import { downloadAsync } from "expo-file-system/legacy";
import type { useHostActs } from "./host/host-provider.js";

/** The folder every file here stands under, in the app's caches. */
const FILES_FOLDER = "service-files";

/** The prefix a download's partial file is named with until it is whole. */
const PARTIAL_PREFIX = ".partial-";

/** The extension each type the system's player plays is written under, which it reads the file's kind by. */
const PLAYED_EXTENSION: ReadonlyMap<string, string> = new Map([
  [MP4_TYPE, "mp4"],
  [CONVERSATION_MEDIA_TYPE.WEBM, "webm"],
  [AUDIO_TYPE.WAV, "wav"],
  [AUDIO_TYPE.MP3, "mp3"],
  [AUDIO_TYPE.M4A, "m4a"],
  [AUDIO_TYPE.AAC, "aac"],
  [AUDIO_TYPE.OGG, "ogg"],
]);

/** What in a file's name would part a path, which an underscore stands in for. */
const PATH_PARTS = /[/\\:]/gu;

/** The name a file with none that can stand is written under. */
const UNNAMED = "file";

/** A `data:` address of a file's bytes, its type and its base64. */
const DATA_ADDRESS = /^data:([^;,]+);base64,/u;

/** The HTTP status a download answers whole with. */
const OK = 200;

/** The HTTP status a file the service keeps none of answers with, which stands gone for good. */
const NOT_FOUND = 404;

/** The HTTP status a refused header answers with, which is renewed and tried once more. */
const REFUSED = 401;

/** What a file that could not be downloaded says, in the app's own words alone. */
const FILE_UNREAD = "The file could not be downloaded.";

/** A file the service keeps could not be downloaded; it carries no word of the request. */
export class FileUnread extends Error {
  constructor() {
    super(FILE_UNREAD);
  }
}

/** The service keeps no such file, so no Try again brings it back. */
export class FileGone extends FileUnread {}

/** A file the service keeps, as it stands under the app's caches: its address, its type, and how many bytes it holds. */
export interface ServiceFile {
  readonly uri: string;
  readonly contentType: string;
  readonly bytes: number;
}

/** The folder one file of `picture` stands in, under its owner and its id. */
function folderOf(picture: PictureSourceParams): Directory {
  switch (picture.owner) {
    case PICTURE_OWNER.AGENT:
      return new Directory(
        Paths.cache,
        FILES_FOLDER,
        picture.owner,
        picture.agentId,
        picture.pictureId,
      );
    case PICTURE_OWNER.INBOX:
      return new Directory(
        Paths.cache,
        FILES_FOLDER,
        picture.owner,
        picture.itemId,
        picture.attachmentId,
      );
    case PICTURE_OWNER.TASK:
      return new Directory(
        Paths.cache,
        FILES_FOLDER,
        picture.owner,
        picture.taskId,
        picture.attachmentId,
      );
  }
}

/** What a file of `contentType` is named: by its played type's extension, for the system's player, or by its own name, for Quick Look and the share sheet. */
function nameOf(contentType: string, name: string | undefined): string {
  const played = PLAYED_EXTENSION.get(contentType);

  if (played !== undefined) return `media.${played}`;

  return name?.replace(PATH_PARTS, "_").trim() || UNNAMED;
}

/** The file a folder already holds whole, where an earlier read left one. */
function keptIn(folder: Directory): File | undefined {
  if (!folder.exists) return undefined;

  return folder
    .list()
    .find((each): each is File => each instanceof File && !each.name.startsWith(PARTIAL_PREFIX));
}

/** The type a file was served as, from its response's headers, its parameters left off. */
function servedType(headers: Readonly<Record<string, string>>): string | undefined {
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === "content-type");

  return entry?.[1].split(";")[0]?.trim().toLowerCase();
}

/** A fixture run's file, written from its own `data:` address. */
async function writtenFromData(
  folder: Directory,
  address: string,
  name: string | undefined,
): Promise<File> {
  const data = DATA_ADDRESS.exec(address);

  if (data?.[1] === undefined) throw new FileUnread();
  const file = new File(folder, nameOf(data[1], name));
  await file.write(address.slice(data[0].length), { encoding: "base64" });

  return file;
}

/** One download into `partial` under the source's header: its served type where it came back whole, `undefined` where the header was refused, and a failure for anything else. */
async function downloaded(view: Exclude<PictureSourceView, { failure: unknown }>, partial: File) {
  const answer = await downloadAsync(view.uri, partial.uri, { headers: { ...view.headers } }).catch(
    () => {
      throw new FileUnread();
    },
  );

  if (answer.status === REFUSED) return undefined;

  if (answer.status === NOT_FOUND) throw new FileGone();

  const type = servedType(answer.headers);

  if (answer.status !== OK || type === undefined) throw new FileUnread();

  return type;
}

/** The source of `picture`, renewed first where `renew`, failing where the host offers none. */
async function sourceOf(
  acts: ReturnType<typeof useHostActs>,
  picture: PictureSourceParams,
  renew: boolean,
) {
  const view = await acts[ACT_KIND.ACCOUNT_PICTURE_SOURCE]({
    ...picture,
    ...(renew ? { renew: true } : undefined),
  });

  if ("failure" in view) throw new FileUnread();

  return view;
}

/**
 * The file `picture` names, under the app's caches: the one an earlier read
 * left whole, or one downloaded now with the header its read carries, tried
 * once more under a renewed header where it was refused, and moved into
 * place only once it is whole. `name` is what a file a reader opens is
 * written under; a clip is named by its type.
 */
export async function serviceFile(
  acts: ReturnType<typeof useHostActs>,
  picture: PictureSourceParams,
  name?: string,
): Promise<ServiceFile> {
  const folder = folderOf(picture);
  const kept = keptIn(folder);

  if (kept !== undefined) return { uri: kept.uri, contentType: kept.type, bytes: kept.size };
  folder.create({ intermediates: true, idempotent: true });
  const partialName = `${PARTIAL_PREFIX}${randomUUID()}`;
  const partial = new File(folder, partialName);

  try {
    let view = await sourceOf(acts, picture, false);

    if (view.uri.startsWith("data:")) {
      const file = await writtenFromData(folder, view.uri, name);

      return { uri: file.uri, contentType: file.type, bytes: file.size };
    }

    let type = await downloaded(view, partial);

    if (type === undefined) {
      view = await sourceOf(acts, picture, true);
      type = await downloaded(view, partial);
    }

    if (type === undefined) throw new FileUnread();
    const file = new File(folder, nameOf(type, name));
    // Note that a move points `partial` at the file it became, so the partial is cleaned up below by its own name alone.
    await partial.move(file);

    return { uri: file.uri, contentType: type, bytes: file.size };
  } catch (cause: unknown) {
    // Note that any other failure, a file system's or the host's, leaves as the app's own words alone, since its own might name the request.
    throw cause instanceof FileUnread ? cause : new FileUnread();
  } finally {
    const left = new File(folder, partialName);

    if (left.exists) left.delete();
  }
}

/** Lets go of every file here, as a sign-out does, so another account signed in never reads this one's. */
export function forgetServiceFiles(): void {
  const folder = new Directory(Paths.cache, FILES_FOLDER);

  if (folder.exists) folder.delete();
}
