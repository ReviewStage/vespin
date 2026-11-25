/**
 * keeping.ts -- what the app does with a picture, a recording, a file, or a message's words that a press or a long press asks for: opens a picture full screen in the app's viewer and anything else in the system's Quick Look, copies it to the system's pasteboard, saves it to Photos, or opens the system's share sheet on it, buzzing as a copy or a save goes and saying in the failure notice what did not.
 *
 * The desktop and the web copy and save through the window's act port
 * (`WINDOW_COPY_IMAGE`, `WINDOW_COPY_RICH`, `WINDOW_SAVE_FILE`); the phone has the system's
 * own pasteboard, Photos, and share sheet, so it answers them here, as it
 * copies a link through `expo-clipboard`. A picture held as its `data:`
 * address is written under the app's caches before Photos or the share
 * sheet takes it, named for what it shows; one the app already wrote to a
 * file, as an agent's are, a recording, and a file are taken as the file the
 * app wrote (`cached-media.ts`). A recording the system's player plays from
 * the service's address is downloaded under the caches as it is kept, with
 * the header its read carries, and deleted once Photos or the share sheet is
 * done with it; the header goes to that download alone, never to a log or a
 * notice, and a download that failed says so in the app's own words. Quick Look
 * reads a file too, so a picture is written the same way before it opens,
 * and one drawn from a web address is fetched under the caches first, once,
 * so it opens again from that file; Quick Look's own share button then
 * offers Copy and Save Image. Photos is
 * asked for add-only access, once, the first time something is saved, and
 * a refusal says where it is allowed again rather than offering Try again.
 * A draft's Copy message puts its body on the pasteboard as rich text.
 * Note that these do not go through `useWrite`, since nothing here reaches
 * the service: a copy that fails while the phone is offline failed on the
 * phone, and says so rather than the offline hint.
 */

import type { DraftCopy } from "@repo/features/draft-text";
import { sniffImageType } from "@repo/features/image-signature";
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
  pictureExtension,
  useFailureNotices,
  type ViewedPicture,
} from "@repo/ui-native";
import { Predicate } from "effect";
import { setImageAsync, setStringAsync } from "expo-clipboard";
import { CryptoDigestAlgorithm, digestStringAsync, randomUUID } from "expo-crypto";
import { Directory, File, FileMode, Paths } from "expo-file-system";
import { Image } from "expo-image";
import { Asset, requestPermissionsAsync } from "expo-media-library";
import { useMemo } from "react";
import { Share } from "react-native";
import { cachedFile } from "./cached-media.js";
import { pictureViewerModule } from "./picture-viewer-module.js";
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

/** The folder prefix a picture the image loader keeps stands under once named for what it is, as Photos and the share sheet read it. */
const LOADER_PREFIX = "loaded";

/** How many of a picture's first bytes say what kind of picture it is. */
const SIGNATURE_BYTES = 16;

/** The folder prefix a recording downloaded to be saved or shared stands under in the app's caches, until it is let go. */
const DOWNLOADED_PREFIX = "downloaded";

/** The name a recording that says nothing of itself is written under. */
const RECORDING_NAME = "Recording";

/** The extension a recording the system's player plays is written under, which Photos takes, and the one it cannot play under. */
const RECORDING_EXTENSION = { PLAYS: "mp4", ELSE: "webm" } as const;

/** A file's name's last extension, taken off a recording's name before its own is put on. */
const NAME_EXTENSION = /\.[^./]+$/u;

/** What a recording that could not be downloaded to be kept says, in the app's own words, never the download's. */
const RECORDING_UNREAD = "The recording could not be downloaded.";

/** A recording kept, as it is held. */
type KeptVideo = Extract<Kept, { readonly kind: typeof KEPT_KIND.VIDEO }>;

/** The service's address of a recording the player plays from, with the header its read carries. */
type VideoAddress = Exclude<KeptVideo["source"], string>;

/** Photos refused the app's add-only access. */
class PhotosRefused extends Error {}

/** A recording could not be downloaded to be kept; it carries no word of the request. */
class RecordingUnread extends Error {
  constructor() {
    super(RECORDING_UNREAD);
  }
}

/** A picture's bytes as its `data:` address holds them, which every act on a picture needs. */
function picturesBytes(source: string) {
  const held = heldPicture(source);

  if (held === undefined) throw new Error("A picture with no bytes held was kept.");

  return held;
}

/**
 * The file Quick Look, Photos, or the share sheet takes: a picture written
 * under the app's caches, named for what it shows, or the file a recording or
 * a file already is. Note that a picture's folder is named by a digest of its
 * bytes, so a picture opened, shared, or saved again is the file already
 * written rather than a second write of it.
 */
async function fileOf(kept: Kept): Promise<string> {
  if (kept.kind !== KEPT_KIND.PICTURE) {
    if (Predicate.isString(kept.source)) return kept.source;

    throw new Error("A recording held by its address has no file of its own.");
  }

  if (kept.source.startsWith(FILE_ADDRESS)) return kept.source;
  const held = picturesBytes(kept.source);
  const name = kept.name.trim().slice(0, NAME_MAX).trim() || PICTURE_NAME;
  const digest = await digestStringAsync(CryptoDigestAlgorithm.SHA256, held.base64);

  return cachedFile(KEPT_PREFIX, digest, `${name}.${held.extension}`, held.mediaType, held.base64);
}

/** Copies a picture as a picture, or a text file's words. */
async function copied(kept: Kept): Promise<void> {
  if (kept.kind === KEPT_KIND.PICTURE) {
    // Note that a picture the app wrote to a file is read for the copy alone, so its bytes stand in memory only while the pasteboard takes them.
    const bytes = kept.source.startsWith(FILE_ADDRESS)
      ? await new File(kept.source).base64()
      : picturesBytes(kept.source).base64;

    await setImageAsync(bytes);

    return;
  }

  await setStringAsync(await new File(await fileOf(kept)).text());
}

/** The address a recording is held by, where it is held by one rather than a file. */
function videoAddressOf(kept: Kept): VideoAddress | undefined {
  return kept.kind === KEPT_KIND.VIDEO && !Predicate.isString(kept.source)
    ? kept.source
    : undefined;
}

/** The name a downloaded recording is written under: what it is called, with the extension of what it is. */
function recordingName(kept: KeptVideo): string {
  const name = kept.name.trim().replace(NAME_EXTENSION, "").replaceAll("/", "-");
  const extension = kept.plays === true ? RECORDING_EXTENSION.PLAYS : RECORDING_EXTENSION.ELSE;

  return `${name.slice(0, NAME_MAX).trim() || RECORDING_NAME}.${extension}`;
}

/**
 * Runs `work` on the file a kept thing is: the one the app holds, or, for a
 * recording held by the service's address, one downloaded now under the
 * caches with the header its read carries and deleted once `work` is done.
 * Note that a download that failed throws the app's own words alone, since
 * the download's error may name the request it made.
 */
async function withFile(kept: Kept, work: (file: string) => Promise<void>): Promise<void> {
  const address = videoAddressOf(kept);

  if (address === undefined || kept.kind !== KEPT_KIND.VIDEO) {
    await work(await fileOf(kept));

    return;
  }

  const folder = new Directory(Paths.cache, `${DOWNLOADED_PREFIX}-${randomUUID()}`);

  try {
    folder.create({ intermediates: true, idempotent: true });
    const file = new File(folder, recordingName(kept));

    await File.downloadFileAsync(address.uri, file, { headers: { ...address.headers } }).catch(
      () => {
        throw new RecordingUnread();
      },
    );
    await work(file.uri);
  } finally {
    if (folder.exists) folder.delete();
  }
}

/**
 * Copies a draft's body as one pasteboard item holding its HTML, the rich
 * text the system reads from it, and its plain words, a link's address after
 * its label, as the desktop writes HTML and plain words together
 * (`modules/rich-pasteboard/`). Note that the words are set in the system's
 * face, since HTML read with no face of its own pastes into Mail in Times;
 * and that the HTML names its encoding, since the system reads HTML that
 * names none as Latin-1, which garbles a curly quote, a dash, or an emoji.
 */
async function copiedRich(copy: DraftCopy): Promise<void> {
  const html = `${RICH_HEAD}<span style="${RICH_FACE}">${copy.html}</span>`;

  await richPasteboardModule.copy(html, copy.text);
}

/** Saves a picture or a recording to Photos, asking for add-only access the first time. */
async function savedToPhotos(kept: Kept): Promise<void> {
  const access = await requestPermissionsAsync(true);

  if (!access.granted) throw new PhotosRefused();
  await withFile(kept, async (file) => {
    await Asset.create(file);
  });
}

/** Opens the system's share sheet on the file, which also saves it to Files or opens it in another app. */
async function shared(kept: Kept): Promise<void> {
  // Note that the share sheet answers once it is let go, so a downloaded recording stands until the app it went to has taken it.
  await withFile(kept, async (file) => {
    await Share.share({ url: file, title: kept.name });
  });
}

/** Each fetch of a web picture still under way, by its address, so a second press waits on the first rather than fetching it again. */
const fetching = new Map<string, Promise<string>>();

/** The picture fetched from `source`: the file in its folder where an earlier fetch left one, or a fetch begun now. */
async function fetchedFile(source: string): Promise<string> {
  const digest = await digestStringAsync(CryptoDigestAlgorithm.SHA256, source);
  const folder = new Directory(Paths.cache, `${FETCHED_PREFIX}-${digest}`);
  const [fetched] = folder.exists ? folder.list().filter((each) => each instanceof File) : [];

  if (fetched !== undefined) return fetched.uri;
  folder.create({ intermediates: true, idempotent: true });

  return (await File.downloadFileAsync(source, folder, { idempotent: true })).uri;
}

/**
 * A picture drawn from a web address, fetched under the app's caches in a
 * folder named by a digest of its address, under the name its address ends
 * in. Note that a picture already fetched is the file in its folder, so a
 * second press, or one after a relaunch, opens it with no fetch; and that the
 * system moves a download into place only once it is whole, so a file there
 * is never one cut short.
 */
function fetchedPicture(source: string): Promise<string> {
  const under = fetching.get(source);

  if (under !== undefined) return under;
  const begun = fetchedFile(source).finally(() => fetching.delete(source));
  fetching.set(source, begun);

  return begun;
}

/** The file Quick Look reads: a picture written from its bytes or fetched from its address, or the file a recording or a file already is. */
function previewFile(kept: Kept): Promise<string> {
  if (kept.kind !== KEPT_KIND.PICTURE || kept.source.startsWith(FILE_ADDRESS)) return fileOf(kept);

  return WEB_ADDRESS.test(kept.source) ? fetchedPicture(kept.source) : fileOf(kept);
}

/**
 * Opens a picture or a file full screen in the system's Quick Look
 * (`modules/quick-look/`). Note that a file Quick Look can't read, one UIKit
 * would not present it over, opens the share sheet instead, which offers an app that reads it.
 */
async function opened(kept: Kept): Promise<void> {
  const file = await previewFile(kept);
  const shown = await quickLookModule.preview(file, kept.name);

  if (!shown) await Share.share({ url: file, title: kept.name });
}

/**
 * Opens a picture full screen in the app's viewer (`modules/picture-viewer/`),
 * grown out of its thumbnail and drawn first from the bitmap the thumbnail
 * shows, a swipe stepping through the rest of its set. Note that one UIKit
 * would not present the viewer over opens in Quick Look instead, which asks
 * the same of UIKit and shares it where refused too.
 */
async function viewed(pictures: readonly ViewedPicture[], index: number): Promise<void> {
  const files = await Promise.all(
    pictures.map((picture) => loaderPicture(picture.source, picture.title)),
  );

  const shown = await pictureViewerModule.show(
    pictures.map((picture, at) => ({
      uri: files[at] ?? picture.source,
      ...picture.place,
      title: picture.title,
      subtitle: picture.subtitle ?? null,
    })),
    index,
  );

  const pressed = pictures[index];

  if (!shown && pressed !== undefined) {
    await opened({
      kind: KEPT_KIND.PICTURE,
      source: files[index] ?? pressed.source,
      name: pressed.title,
    });
  }
}

/**
 * The file a picture drawn from a web address is read from: the one the
 * image loader keeps for it, as every picture of the service's is drawn
 * (`use-pictures.tsx`), copied once under a name of what it shows and
 * its kind's extension, since the loader's own file is named by a digest
 * with none, which Photos and the share sheet read no kind from; the address
 * as it is where the loader keeps none, as for any other address.
 */
async function loaderPicture(source: string, name: string): Promise<string> {
  if (!WEB_ADDRESS.test(source)) return source;
  const path = await Image.getCachePathAsync(source);

  if (path === null) return source;
  const cached = new File(`${FILE_ADDRESS}${path}`);
  const handle = cached.open(FileMode.ReadOnly);
  const head = await handle.readBytes(SIGNATURE_BYTES).finally(() => handle.close());
  const type = sniffImageType(head);
  const extension = type === undefined ? undefined : pictureExtension(type);

  if (extension === undefined) return cached.uri;
  const digest = await digestStringAsync(CryptoDigestAlgorithm.SHA256, source);
  const folder = new Directory(Paths.cache, `${LOADER_PREFIX}-${digest}`);
  folder.create({ intermediates: true, idempotent: true });

  const named = new File(
    folder,
    `${name.trim().slice(0, NAME_MAX).trim() || PICTURE_NAME}.${extension}`,
  );

  if (!named.exists) cached.copy(named);

  return named.uri;
}

/** What is held, a picture drawn from a web address read as the file the image loader keeps for it. */
async function loaderKept(kept: Kept): Promise<Kept> {
  if (kept.kind !== KEPT_KIND.PICTURE) return kept;

  return { ...kept, source: await loaderPicture(kept.source, kept.name) };
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
      open: (kept) => run(() => loaderKept(kept).then(opened), OPEN_FAILED, false),
      view: (pictures, index) => run(() => viewed(pictures, index), OPEN_FAILED, false),
      keep: (kept, act) =>
        run(() => loaderKept(kept).then(KEEP_WORK[act]), KEEP_FAILED[act], act !== KEEP_ACT.SHARE),
      copyWords: (words) =>
        run(() => setStringAsync(words).then(() => undefined), KEEP_FAILED[KEEP_ACT.COPY], true),
      shareWords: (words) =>
        run(
          () => Share.share({ message: words }).then(() => undefined),
          KEEP_FAILED[KEEP_ACT.SHARE],
          false,
        ),
      copyRich: (copy) =>
        run(() => copiedRich(copy).then(() => undefined), KEEP_FAILED[KEEP_ACT.COPY], true),
    };
  }, [notices]);
}
