// menu-photos.ts -- a picture as a file in the app's caches, which a system menu draws round in a choice's glyph place: each member's sign-in picture, and a workspace's photo.

import { accountPictureAt, pinnedPictureUrl } from "@repo/features/account-picture";
import { MARK_SIZE } from "@repo/ui-native";
import { File, Paths } from "expo-file-system";
import { useEffect, useMemo, useState } from "react";
import { AppState, PixelRatio } from "react-native";
import type { PictureOf } from "./member-pictures.js";

/** What a photo's file is named with, before the picture it holds. */
const PHOTO_PREFIX = "menu-photo";

/**
 * How long a photo's file stands before it's read again, in milliseconds: a
 * day. Note that a picture's address can stay the same when the member
 * changes their photo, as GitHub's does, so a file kept for good would show
 * the old face until iOS cleared the app's caches.
 */
const PHOTO_LIFETIME = 24 * 60 * 60 * 1000;

/** A `data:` address holding its bytes in base64, as the host holds a workspace's photo, its base64 captured. */
const DATA_ADDRESS = /^data:[^,]*;base64,(.+)$/su;

/** FNV-1a's offset basis and prime, for a short, steady name from a picture's address. */
const FNV_OFFSET = 0x81_1c_9d_c5;
const FNV_PRIME = 0x01_00_01_93;

/** A photo's file as a hook holds it: where it stands, and since when it counts as fresh. */
interface HeldPhoto {
  readonly uri: string;
  readonly at: number;
}

/** Each download still under way, by the address of the file it writes, so two menus asking for one photo share its download. */
const downloading = new Map<string, Promise<HeldPhoto | undefined>>();

/** A picture's address as a short name: its FNV-1a hash, in hex. */
function addressName(address: string): string {
  let hash = FNV_OFFSET;

  for (let index = 0; index < address.length; index++) {
    hash ^= address.charCodeAt(index);
    hash = Math.imul(hash, FNV_PRIME);
  }

  return (hash >>> 0).toString(16);
}

/**
 * Where a picture stands as a file of the app's caches, named by its address
 * at the size a menu draws it, so a changed address is a new file and the
 * same one is read again from disk while it's fresh.
 */
function photoFile(address: string): File {
  return new File(Paths.cache, `${PHOTO_PREFIX}-${addressName(address)}`);
}

/** Whether a photo counted fresh since `at` is still within its lifetime. */
function freshSince(at: number | undefined): at is number {
  return at !== undefined && Date.now() - at < PHOTO_LIFETIME;
}

/** A `data:` address's bytes as the base64 it carries; none for any other address, or one not in base64. */
function dataBase64(address: string): string | undefined {
  return DATA_ADDRESS.exec(address)?.[1];
}

/** Writes or fetches the picture into its file: a `data:` address's bytes written as they are, any other address downloaded. */
function fetched(address: string, file: File): Promise<string> {
  const base64 = dataBase64(address);

  return base64 === undefined
    ? File.downloadFileAsync(address, file, { idempotent: true }).then((saved) => saved.uri)
    : file.write(base64, { encoding: "base64" }).then(() => file.uri);
}

/**
 * The picture's file: the one already written while it's fresh, the
 * download under way, or one begun now, which writes over a stale file. A
 * download that fails keeps the stale file where there is one, counted fresh
 * from now so it's tried again only after another lifetime, and answers none
 * where there isn't.
 */
function downloaded(address: string): Promise<HeldPhoto | undefined> {
  const file = photoFile(address);
  const written = file.exists ? file.info().modificationTime : undefined;

  if (freshSince(written)) return Promise.resolve({ uri: file.uri, at: written });
  const under = downloading.get(file.uri);

  if (under !== undefined) return under;
  const kept = file.exists ? file.uri : undefined;

  const download = fetched(address, file)
    .then((uri) => ({ uri, at: Date.now() }))
    .catch(() => (kept === undefined ? undefined : { uri: kept, at: Date.now() }))
    .finally(() => downloading.delete(file.uri));

  downloading.set(file.uri, download);

  return download;
}

/** A sign-in picture, asked for at `size` points in device pixels, a menu photo's where none is given; none for someone with no picture the app may draw. */
export function menuAddress(
  picture: string | undefined,
  size: number = MARK_SIZE.MENU_PHOTO,
): string | undefined {
  const pinned = pinnedPictureUrl(picture);

  return pinned === undefined ? undefined : accountPictureAt(pinned, size * PixelRatio.get());
}

/** A menu's pictures as files on this device: each address's file once written, and whether it is still on its way rather than failed. */
export interface MenuPictures {
  readonly fileOf: (address: string) => string | undefined;
  /** Whether the address's file is still being downloaded or written, so its choice shows nothing rather than its fallback meanwhile. */
  readonly coming: (address: string) => boolean;
}

/**
 * Each picture address's file on this device, for a menu that draws them,
 * and which of them are still on their way, as against failed. Note that a
 * system menu reads its images once, as it opens, so a photo still on its
 * way shows the next time the menu opens. A photo held past its lifetime is
 * read again as the app comes back to the front, since a picture can change
 * under the same address while a screen stays mounted.
 */
export function useMenuPictures(addresses: readonly string[]): MenuPictures {
  const [files, setFiles] = useState<ReadonlyMap<string, HeldPhoto>>(new Map());
  const [missed, setMissed] = useState<ReadonlySet<string>>(new Set());
  const [resumes, setResumes] = useState(0);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") setResumes((count) => count + 1);
    });

    return () => subscription.remove();
  }, []);

  useEffect(() => {
    let live = true;
    // Note that a resume runs this again, so a photo past its lifetime is read again while the screen stays mounted.
    void resumes;

    for (const address of new Set(addresses)) {
      if (freshSince(files.get(address)?.at)) continue;

      // Note that a photo tried again is on its way again, not failed, so its choice shows nothing rather than its fallback until this try settles.
      setMissed((held) => {
        if (!held.has(address)) return held;
        const next = new Set(held);
        next.delete(address);

        return next;
      });

      void downloaded(address).then((photo) => {
        if (!live) return;

        if (photo === undefined) setMissed((held) => new Set(held).add(address));
        else setFiles((held) => new Map(held).set(address, photo));
      });
    }

    return () => {
      live = false;
    };
  }, [addresses, files, resumes]);

  // Note that the readers stand still while nothing landed, so a memo drawn from them does too.
  return useMemo(
    () => ({
      fileOf: (address: string) => files.get(address)?.uri,
      coming: (address: string) => !files.has(address) && !missed.has(address),
    }),
    [files, missed],
  );
}

/** Each picture address's file on this device, for a menu that draws them; none while one is still on its way, or failed (`useMenuPictures`). */
export function useMenuPictureFiles(
  addresses: readonly string[],
): (address: string) => string | undefined {
  return useMenuPictures(addresses).fileOf;
}

/** Each of `userIds`' pictures as a file on this device, for a menu that draws them, as `useMenuPictureFiles` holds them; none for a member with no picture. */
export function useMenuPhotos(
  pictureOf: PictureOf,
  userIds: readonly string[],
): (userId: string) => string | undefined {
  const byUser = useMemo(() => {
    const addresses = new Map<string, string>();

    for (const userId of userIds) {
      const address = menuAddress(pictureOf(userId));

      if (address !== undefined) addresses.set(userId, address);
    }

    return addresses;
  }, [pictureOf, userIds]);

  const addresses = useMemo(() => [...byUser.values()], [byUser]);
  const fileOf = useMenuPictureFiles(addresses);

  return (userId) => {
    const address = byUser.get(userId);

    return address === undefined ? undefined : fileOf(address);
  };
}
