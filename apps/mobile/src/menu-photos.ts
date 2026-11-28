// menu-photos.ts -- a picture as a file in the app's caches, which a system menu draws in a choice's glyph place: each member's sign-in picture, a workspace's photo, and a repository's owner's picture.

import { accountPictureAt, pinnedPictureUrl } from "@repo/features/account-picture";
import { repositoryOwnerPictureUrl } from "@repo/features/tasks-model";
import { MARK_SIZE, type MenuPhotoFile, menuPhotoFile } from "@repo/ui-native";
import { File, Paths } from "expo-file-system";
import { useCallback, useEffect, useMemo, useState } from "react";
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
 * The picture's file: the download under way, the one already written while
 * it's fresh, or one begun now, which writes over a stale file. A download
 * that fails keeps the stale file where there is one, counted fresh from now
 * so it's tried again only after another lifetime, and answers none where
 * there isn't. Note that the download under way is asked first, because it
 * owns the file: an idempotent download deletes the stale file before it
 * moves the new one in. And note that the file is read through
 * `lastModified`, which answers null for a file gone, since iOS may clear
 * the app's caches at any moment; `info()` checks the file stands, then
 * throws where it vanished before its attributes were read.
 */
function downloaded(address: string): Promise<HeldPhoto | undefined> {
  const file = photoFile(address);
  const under = downloading.get(file.uri);

  if (under !== undefined) return under;
  const written = file.lastModified ?? undefined;

  if (freshSince(written)) return Promise.resolve({ uri: file.uri, at: written });
  const kept = written === undefined ? undefined : file.uri;

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
  readonly fileOf: (address: string) => MenuPhotoFile | undefined;
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
      fileOf: (address: string) => {
        const uri = files.get(address)?.uri;

        return uri === undefined ? undefined : menuPhotoFile(uri);
      },
      coming: (address: string) => !files.has(address) && !missed.has(address),
    }),
    [files, missed],
  );
}

/** Each picture address's file on this device, for a menu that draws them; none while one is still on its way, or failed (`useMenuPictures`). */
export function useMenuPictureFiles(
  addresses: readonly string[],
): (address: string) => MenuPhotoFile | undefined {
  return useMenuPictures(addresses).fileOf;
}

/** Each of `userIds`' pictures as a file on this device, for a menu that draws them, as `useMenuPictureFiles` holds them; none for a member with no picture. */
export function useMenuPhotos(
  pictureOf: PictureOf,
  userIds: readonly string[],
): (userId: string) => MenuPhotoFile | undefined {
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

  // Note that the reader stands still while no photo landed, so a list memoized on it isn't built anew on every draw.
  return useCallback(
    (userId: string) => {
      const address = byUser.get(userId);

      return address === undefined ? undefined : fileOf(address);
    },
    [byUser, fileOf],
  );
}

/**
 * A repository's owner's picture, asked for at a menu photo's size in device
 * pixels. Note that it is GitHub's own address for an account's picture
 * (`repositoryOwnerPictureUrl`), which redirects to its avatar, so it is
 * sized here rather than through `menuAddress`, which takes only a picture
 * already on GitHub's avatar host and refused this one, drawing every
 * repository as its glyph.
 */
function repositoryMenuAddress(repository: string): string {
  const address = new URL(repositoryOwnerPictureUrl(repository));
  address.searchParams.set("size", String(Math.round(MARK_SIZE.MENU_PHOTO * PixelRatio.get())));

  return address.toString();
}

/** Each repository's owner's picture as a file on this device, by `owner/name`, for a menu that leads each repository with it, as `useMenuPictureFiles` holds them; none while it's on its way, or failed. */
export function useMenuRepositoryPictures(
  repositories: readonly string[],
): (repository: string) => MenuPhotoFile | undefined {
  const byRepository = useMemo(() => {
    const addresses = new Map<string, string>();

    for (const repository of repositories)
      addresses.set(repository, repositoryMenuAddress(repository));

    return addresses;
  }, [repositories]);

  const addresses = useMemo(() => [...byRepository.values()], [byRepository]);
  const fileOf = useMenuPictureFiles(addresses);

  return useCallback(
    (repository: string) => {
      const address = byRepository.get(repository);

      return address === undefined ? undefined : fileOf(address);
    },
    [byRepository, fileOf],
  );
}
