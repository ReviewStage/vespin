/**
 * picture-files.ts -- a picture of the service's as the file the platform's image loader keeps it in: expo-image downloads it under the account's header, caches it on disk, and answers its file, which every view, the viewer, and the share sheet draw from.
 *
 * The host answers where a picture stands (`ACCOUNT_PICTURE_SOURCE`): the
 * service's address and the header its read carries, or in a fixture run the
 * picture's own `data:` address. expo-image (SDWebImage) keeps the bytes
 * under that address, which names the picture by its ids alone, so a picture
 * read once is found again with no request, whatever header read it. Note
 * that the header goes to the loader's request alone, never to a log, a
 * report, or a counted event.
 */

import { PRODUCT_PICTURE_FROM } from "@repo/features/analytics";
import type { PictureSourceParams } from "@repo/features/picture-source-wire";
import { ACT_KIND } from "@repo/host/acts";
import { File } from "expo-file-system";
import { Image } from "expo-image";
import type { useHostActs } from "./host/host-provider.js";
import type { PictureShown } from "./picture-shown.js";

/** The scheme a file the loader keeps is addressed by. */
const FILE_SCHEME = "file://";

/** The scheme a fixture's picture is addressed by, drawn as it is. */
const DATA_SCHEME = "data:";

/** Where the loader read a picture, as the host answered it. */
type PictureSource = { readonly uri: string; readonly headers?: Readonly<Record<string, string>> };

/** The file the loader keeps under `uri`, by its address; none where it keeps none. */
async function keptFile(uri: string): Promise<string | undefined> {
  const path = await Image.getCachePathAsync(uri);

  return path === null ? undefined : `${FILE_SCHEME}${path}`;
}

/** Where the host says a picture stands, renewed first where `renew`; it throws where it answers none, so the read is tried again on its own. */
async function sourceOf(
  acts: ReturnType<typeof useHostActs>,
  picture: PictureSourceParams,
  renew: boolean,
): Promise<PictureSource> {
  const source = await acts[ACT_KIND.ACCOUNT_PICTURE_SOURCE](
    renew ? { ...picture, renew: true } : picture,
  );

  if ("failure" in source) throw new Error(`The picture has no source: ${source.failure}.`);

  return source;
}

/** Whether the loader downloaded and kept the picture under its source's address. */
function downloaded(source: PictureSource): Promise<boolean> {
  return Image.prefetch([source.uri], {
    cachePolicy: "disk",
    ...(source.headers === undefined ? undefined : { headers: { ...source.headers } }),
  });
}

/**
 * The file a picture of the service's is drawn from: the one the loader
 * already keeps for it, read with no request, or one it downloads now under
 * the account's header, as a picture is read the first time; a fixture's
 * picture is its own `data:` address. Note that a download the service
 * refused is tried once more under a renewed header, as the account's own
 * calls retry a 401; and that each picture is counted as it lands
 * (`shown`), as kept or downloaded, with its size.
 */
export async function pictureFile(
  acts: ReturnType<typeof useHostActs>,
  picture: PictureSourceParams,
  shown: PictureShown,
): Promise<string> {
  const askedAt = performance.now();
  const source = await sourceOf(acts, picture, false);

  if (source.uri.startsWith(DATA_SCHEME)) return source.uri;
  const kept = await keptFile(source.uri);

  if (kept !== undefined) {
    shown(PRODUCT_PICTURE_FROM.KEPT, askedAt, new File(kept).size);

    return kept;
  }

  const landed =
    (await downloaded(source)) || (await downloaded(await sourceOf(acts, picture, true)));

  const file = landed ? await keptFile(source.uri) : undefined;

  if (file === undefined) throw new Error("The picture was not downloaded.");
  shown(PRODUCT_PICTURE_FROM.DOWNLOADED, askedAt, new File(file).size);

  return file;
}

/** Lets go of every picture the loader keeps, as a sign-out does, so another account is never drawn this one's. */
export async function forgetPictureFiles(): Promise<void> {
  await Promise.all([Image.clearDiskCache(), Image.clearMemoryCache()]);
}
