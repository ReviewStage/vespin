/**
 * keeping.ts -- what the app does with a picture, a recording, a file, or a message's words that a long press or the full-screen viewer's share button asks for: copies it to the system's pasteboard, saves it to Photos, or opens the system's share sheet on it, buzzing as a copy or a save goes and saying in the failure notice what did not.
 *
 * The desktop and the web copy and save through the window's act port
 * (`WINDOW_COPY_IMAGE`, `WINDOW_COPY_RICH`, `WINDOW_SAVE_FILE`); the phone has the system's
 * own pasteboard, Photos, and share sheet, so it answers them here, as it
 * copies a link through `expo-clipboard`. A picture is held as its
 * `data:` address, so it is written under the app's caches before Photos
 * or the share sheet takes it, named for what it shows; a recording or a
 * file is already the file the app wrote (`cached-media.ts`). Photos is
 * asked for add-only access, once, the first time something is saved, and
 * a refusal says where it is allowed again rather than offering Try again.
 * A draft's Copy message puts its body on the pasteboard as rich text.
 * Note that these do not go through `useWrite`, since nothing here reaches
 * the service: a copy that fails while the phone is offline failed on the
 * phone, and says so rather than the offline hint.
 */

import type { DraftCopy } from "@repo/features/draft-text";
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
} from "@repo/ui-native";
import { StringFormat, setImageAsync, setStringAsync } from "expo-clipboard";
import { randomUUID } from "expo-crypto";
import { File } from "expo-file-system";
import { Asset, requestPermissionsAsync } from "expo-media-library";
import { useMemo } from "react";
import { Share } from "react-native";
import { cachedFile } from "./cached-media.js";

/** What each act that did not go says, in the panel's words for a copy that failed. */
const KEEP_FAILED = {
  [KEEP_ACT.COPY]: "Could not copy to the clipboard. Try again.",
  [KEEP_ACT.SAVE_TO_PHOTOS]: "Could not save that to Photos. Try again.",
  [KEEP_ACT.SHARE]: "Could not open the share sheet. Try again.",
} as const satisfies Record<KeepAct, string>;

/** What a save says where Photos refused the app, which only the system's Settings allows again. */
const PHOTOS_REFUSED =
  "Vespin can't save to Photos. Allow it in Settings › Privacy & Security › Photos.";

/** The folder prefix a picture written to be saved or shared stands under in the app's caches. */
const KEPT_PREFIX = "kept";

/** The name a picture that says nothing of itself is written under. */
const PICTURE_NAME = "Picture";

/** The longest a picture's file name runs, taken from what it shows. */
const NAME_MAX = 60;

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
 * Copies a draft's body as rich text: the system reads its HTML into the
 * pasteboard's rich text, HTML, and plain words at once (expo-clipboard's
 * HTML input), as the desktop writes HTML and plain words together. Note
 * that the words are set in the system's face, since HTML read with no face
 * of its own pastes into Mail in Times; and that the plain words are the
 * system's reading of the HTML, each link by its label alone, since one
 * item cannot hold words of our own beside it without native code.
 */
async function copiedRich(copy: DraftCopy): Promise<void> {
  await setStringAsync(`<span style="font-family: -apple-system, sans-serif">${copy.html}</span>`, {
    inputFormat: StringFormat.HTML,
  });
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
      keep: (kept, act) =>
        run(() => KEEP_WORK[act](kept), KEEP_FAILED[act], act !== KEEP_ACT.SHARE),
      copyWords: (words) =>
        run(() => setStringAsync(words).then(() => undefined), KEEP_FAILED[KEEP_ACT.COPY], true),
      copyRich: (copy) =>
        run(() => copiedRich(copy).then(() => undefined), KEEP_FAILED[KEEP_ACT.COPY], true),
    };
  }, [notices]);
}
