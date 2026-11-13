// menu-photos.ts -- each member's sign-in picture as a file in the app's caches, which a system menu draws round in a choice's glyph place.

import { accountPictureAt, pinnedPictureUrl } from "@repo/features/account-picture";
import { MARK_SIZE } from "@repo/ui-native";
import { File, Paths } from "expo-file-system";
import { useEffect, useMemo, useState } from "react";
import { PixelRatio } from "react-native";
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

/** FNV-1a's offset basis and prime, for a short, steady name from a picture's address. */
const FNV_OFFSET = 0x81_1c_9d_c5;
const FNV_PRIME = 0x01_00_01_93;

/** Each download still under way, by the address of the file it writes, so two menus asking for one photo share its download. */
const downloading = new Map<string, Promise<string | undefined>>();

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

/** Whether a photo's file was written within its lifetime. */
function fresh(file: File): boolean {
  const written = file.info().modificationTime;

  return written !== undefined && Date.now() - written < PHOTO_LIFETIME;
}

/**
 * The picture's file: the one already written while it's fresh, the
 * download under way, or one begun now, which writes over a stale file. A
 * download that fails keeps the stale file where there is one, and answers
 * none where there isn't.
 */
function downloaded(address: string): Promise<string | undefined> {
  const file = photoFile(address);

  if (file.exists && fresh(file)) return Promise.resolve(file.uri);
  const under = downloading.get(file.uri);

  if (under !== undefined) return under;
  const kept = file.exists ? file.uri : undefined;

  const download = File.downloadFileAsync(address, file, { idempotent: true })
    .then((written) => written.uri)
    .catch(() => kept)
    .finally(() => downloading.delete(file.uri));

  downloading.set(file.uri, download);

  return download;
}

/** A member's picture, asked for at a menu photo's size in device pixels; none for someone with no picture the app may draw. */
function menuAddress(picture: string | undefined): string | undefined {
  const pinned = pinnedPictureUrl(picture);

  return pinned === undefined
    ? undefined
    : accountPictureAt(pinned, MARK_SIZE.MENU_PHOTO * PixelRatio.get());
}

/**
 * Each of `userIds`' pictures as a file on this device, for a menu that
 * draws them; none for a member with no picture, or while theirs is still
 * downloading, whose choice keeps its glyph meanwhile. Note that a system
 * menu reads its images once, as it opens, so a photo still downloading
 * shows the next time the menu opens.
 */
export function useMenuPhotos(
  pictureOf: PictureOf,
  userIds: readonly string[],
): (userId: string) => string | undefined {
  const [files, setFiles] = useState<ReadonlyMap<string, string>>(new Map());

  const addresses = useMemo(() => {
    const byUser = new Map<string, string>();

    for (const userId of userIds) {
      const address = menuAddress(pictureOf(userId));

      if (address !== undefined) byUser.set(userId, address);
    }

    return byUser;
  }, [pictureOf, userIds]);

  useEffect(() => {
    let live = true;

    for (const address of new Set(addresses.values())) {
      if (files.has(address)) continue;

      void downloaded(address).then((uri) => {
        if (live && uri !== undefined) setFiles((held) => new Map(held).set(address, uri));
      });
    }

    return () => {
      live = false;
    };
  }, [addresses, files]);

  return (userId) => {
    const address = addresses.get(userId);

    return address === undefined ? undefined : files.get(address);
  };
}
