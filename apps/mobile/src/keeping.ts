/**
 * keeping.ts -- what the app does with a picture, a recording, a file, or a message's words that a press or a long press asks for: opens it full screen in the system's Quick Look, copies it to the system's pasteboard, saves it to Photos, or opens the system's share sheet on it, buzzing as a copy or a save goes and saying in the failure notice what did not.
 *
 * The desktop and the web copy and save through the window's act port
 * (`WINDOW_COPY_IMAGE`, `WINDOW_COPY_RICH`, `WINDOW_SAVE_FILE`); the phone has the system's
 * own pasteboard, Photos, and share sheet, so it answers them here, as it
 * copies a link through `expo-clipboard`. A picture is held as its
 * `data:` address, so it is written under the app's caches before Photos
 * or the share sheet takes it, named for what it shows; a recording or a
 * file is already the file the app wrote (`cached-media.ts`). Quick Look
 * reads a file too, so a picture is written the same way before it opens,
 * and one drawn from a web address is fetched under the caches first; Quick
 * Look's own share button then offers Copy and Save Image. Photos is
 * asked for add-only access, once, the first time something is saved, and
 * a refusal says where it is allowed again rather than offering Try again.
 * A draft's Copy message puts its body on the pasteboard as rich text.
 * Note that these do not go through `useWrite`, since nothing here reaches
 * the service: a copy that fails while the phone is offline failed on the
 * phone, and says so rather than the offline hint.
 */

import type { DraftCopy } from "@repo/features/draft-text";
import { PRODUCT_NAME } from "@repo/features/product-name";
import {
  BUZZ,
  buzz,
  heldPicture,
  KEEP_ACT,
  KEPT_KIND,
  type KeepAct,
  type Keeping,
  type Kept,
  NOTICE_KIND,
  useFailureNotices,
  type WindowFrame,
} from "@repo/ui-native";
import { StringFormat, setImageAsync, setStringAsync } from "expo-clipboard";
import { randomUUID } from "expo-crypto";
import { Directory, File, Paths } from "expo-file-system";
import { Asset, requestPermissionsAsync } from "expo-media-library";
import { useMemo } from "react";
import { Share } from "react-native";
import { cachedFile } from "./cached-media.js";
import { quickLookModule } from "./quick-look-module.js";
import { richPasteboardModule } from "./rich-pasteboard-module.js";

/** What each act that did not go says, in the panel's words for a copy that failed. */
const KEEP_FAILED = {
  [KEEP_ACT.COPY]: "Could not copy to the clipboard. Try again.",
  [KEEP_ACT.SAVE_TO_PHOTOS]: "Could not save that to Photos. Try again.",
  [KEEP_ACT.SHARE]: "Could not open the share sheet. Try again.",
} as const satisfies Record<KeepAct, string>;

/** What a save says where Photos refused the app, which only the system's Settings allows again. */
const PHOTOS_REFUSED = `${PRODUCT_NAME} can't save to Photos. Allow it in Settings › Privacy & Security › Photos.`;

/** The folder prefix a picture written to be saved or shared stands under in the app's caches. */
const KEPT_PREFIX = "kept";

/** The name a picture that says nothing of itself is written under. */
const PICTURE_NAME = "Picture";

/** The longest a picture's file name runs, taken from what it shows. */
const NAME_MAX = 60;

/** What a draft's HTML opens with: its encoding, which the system reads as Latin-1 where none is named. */
const RICH_HEAD = '<meta charset="utf-8">';

/** The face a draft's words paste in, the system's, where HTML with no face of its own pastes into Mail in Times. */
const RICH_FACE = "font-family: -apple-system, sans-serif";

/** What an open that did not go says. */
const OPEN_FAILED = "Could not open that. Try again.";

/** The folder prefix a picture fetched from its web address stands under in the app's caches. */
const FETCHED_PREFIX = "fetched";

/** A web address, from which a picture drawn from the web is fetched. */
const WEB_ADDRESS = /^https?:\/\//iu;

/** The scheme of a file the app already wrote, which Quick Look reads as it is. */
const FILE_ADDRESS = "file://";

/** Photos refused the app's add-only access. */
class PhotosRefused extends Error {}

/** A picture's bytes as its `data:` address holds them, which every act on a picture needs. */
function picturesBytes(kept: Kept) {
  const held = heldPicture(kept.source);

  if (held === undefined) throw new Error("A picture with no bytes held was kept.");

  return held;
}

/** The file Photos or the share sheet takes: a picture written under the app's caches, named for what it shows, or the file a recording or a file already is. */
async function fileOf(kept: Kept): Promise<string> {
  if (kept.kind !== KEPT_KIND.PICTURE) return kept.source;
  const held = picturesBytes(kept);
  const name = kept.name.trim().slice(0, NAME_MAX).trim() || PICTURE_NAME;

  return cachedFile(
    KEPT_PREFIX,
    randomUUID(),
    `${name}.${held.extension}`,
    held.mediaType,
    held.base64,
  );
}

/** Copies a picture as a picture, or a text file's words. */
async function copied(kept: Kept): Promise<void> {
  if (kept.kind === KEPT_KIND.PICTURE) {
    await setImageAsync(picturesBytes(kept).base64);

    return;
  }

  await setStringAsync(await new File(kept.source).text());
}

/**
 * Copies a draft's body as one pasteboard item holding its HTML, the rich
 * text the system reads from it, and its plain words, a link's address after
 * its label, as the desktop writes HTML and plain words together
 * (`modules/rich-pasteboard/`). Note that the words are set in the system's
 * face, since HTML read with no face of its own pastes into Mail in Times;
 * and that the HTML names its encoding, since the system reads HTML that
 * names none as Latin-1, which garbles a curly quote, a dash, or an emoji.
 * A build without the module copies through expo-clipboard's HTML input,
 * whose plain words are the system's reading of the HTML, each link by its
 * label alone.
 */
async function copiedRich(copy: DraftCopy): Promise<void> {
  const html = `${RICH_HEAD}<span style="${RICH_FACE}">${copy.html}</span>`;

  if (richPasteboardModule !== null) {
    await richPasteboardModule.copy(html, copy.text);

    return;
  }

  await setStringAsync(html, { inputFormat: StringFormat.HTML });
}

/** Saves a picture or a recording to Photos, asking for add-only access the first time. */
async function savedToPhotos(kept: Kept): Promise<void> {
  const access = await requestPermissionsAsync(true);

  if (!access.granted) throw new PhotosRefused();
  await Asset.create(await fileOf(kept));
}

/** Opens the system's share sheet on the file, which also saves it to Files or opens it in another app. */
async function shared(kept: Kept): Promise<void> {
  await Share.share({ url: await fileOf(kept), title: kept.name });
}

/** A picture drawn from a web address, fetched under the app's caches in a folder of its own, under the name its address ends in. */
async function fetchedPicture(source: string): Promise<string> {
  const folder = new Directory(Paths.cache, `${FETCHED_PREFIX}-${randomUUID()}`);
  folder.create({ intermediates: true, idempotent: true });

  return (await File.downloadFileAsync(source, folder)).uri;
}

/** The file Quick Look reads: a picture written from its bytes or fetched from its address, or the file a recording or a file already is. */
function previewFile(kept: Kept): Promise<string> {
  if (kept.kind !== KEPT_KIND.PICTURE || kept.source.startsWith(FILE_ADDRESS)) {
    return Promise.resolve(kept.source);
  }

  return WEB_ADDRESS.test(kept.source) ? fetchedPicture(kept.source) : fileOf(kept);
}

/**
 * Opens a picture or a file full screen in the system's Quick Look, grown
 * from the thumbnail's frame (`modules/quick-look/`). Note that a file
 * Quick Look can't read, and every file in a build without the module, opens
 * the share sheet instead, which offers an app that reads it.
 */
async function opened(kept: Kept, from: WindowFrame | undefined): Promise<void> {
  const file = await previewFile(kept);
  const frame = from === undefined ? null : [from.x, from.y, from.width, from.height];
  const shown = quickLookModule !== null && (await quickLookModule.preview(file, kept.name, frame));

  if (!shown) await Share.share({ url: file, title: kept.name });
}

/** Each act's work. */
const KEEP_WORK = {
  [KEEP_ACT.COPY]: copied,
  [KEEP_ACT.SAVE_TO_PHOTOS]: savedToPhotos,
  [KEEP_ACT.SHARE]: shared,
} as const satisfies Record<KeepAct, (kept: Kept) => Promise<void>>;

/**
 * What `@repo/ui-native`'s menus do with what is held: each act run, a
 * copy or a save that went buzzing as the system's own do, the share sheet
 * opening quietly, and one that failed saying why in the failure notice
 * with Try again, but for Photos refused.
 */
export function useKeeping(): Keeping {
  const notices = useFailureNotices();

  return useMemo(() => {
    const run = (work: () => Promise<void>, failed: string, buzzes: boolean): void => {
      work()
        .then(() => {
          if (buzzes) buzz(BUZZ.SUCCESS);
        })
        .catch((cause: unknown) => {
          console.error(failed, cause);
          buzz(BUZZ.ERROR);
          const refused = cause instanceof PhotosRefused;

          notices.say({
            kind: NOTICE_KIND.REFUSED,
            words: refused ? PHOTOS_REFUSED : failed,
            retry: refused ? undefined : () => run(work, failed, buzzes),
          });
        });
    };

    return {
      open: (kept, from) => run(() => opened(kept, from), OPEN_FAILED, false),
      keep: (kept, act) =>
        run(() => KEEP_WORK[act](kept), KEEP_FAILED[act], act !== KEEP_ACT.SHARE),
      copyWords: (words) =>
        run(() => setStringAsync(words).then(() => undefined), KEEP_FAILED[KEEP_ACT.COPY], true),
      copyRich: (copy) =>
        run(() => copiedRich(copy).then(() => undefined), KEEP_FAILED[KEEP_ACT.COPY], true),
    };
  }, [notices]);
}
