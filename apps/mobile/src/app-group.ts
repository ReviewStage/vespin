/**
 * app-group.ts -- the files the app shares with its extensions through its App Group (`APP_GROUP` in `app.config.ts`): the one door the app's JavaScript writes, reads, and removes them through.
 *
 * Each file is flat JSON at the group container's root, named by
 * `APP_GROUP_FILE` for what it holds, and each feature writes only its own,
 * but for the JPEGs a share sheet draft's pictures are kept in beside it,
 * which only the extension writes (`SHARE_DRAFT_PICTURE_FILES`).
 * The extensions read them in Swift from the same container, the group
 * named by their Info.plist's `VespinAppGroup`, and the container is the
 * one expo-file-system finds through the app's own entitlement, so the
 * group is spelled nowhere here. Note that a build without that
 * entitlement, a simulator build signed for no team among them, may find no
 * container: there a write keeps nothing and a read finds nothing, rather
 * than failing the screen that asked.
 */

import type { ShareDraftPictureFile } from "@repo/features/ios-share-wire";
import { File, Paths } from "expo-file-system";

/** The files the app and its extensions share, by what each holds. */
export const APP_GROUP_FILE = {
  /** The Inbox the widgets draw. */
  INBOX_WIDGET: "inbox-widget.json",
  /** The workspaces and repositories the share sheet offers (`@repo/features/ios-share-wire`). */
  SHARE_SNAPSHOT: "share-snapshot.json",
  /** What the share sheet kept for New task to open on. */
  SHARE_DRAFT: "share-draft.json",
} as const;

type AppGroupFile = (typeof APP_GROUP_FILE)[keyof typeof APP_GROUP_FILE] | ShareDraftPictureFile;

/** The file named, in the container of the one group the app is entitled to, or none where the build reaches no container. */
function groupFile(name: AppGroupFile): File | undefined {
  const container = Object.values(Paths.appleSharedContainers)[0];

  return container === undefined ? undefined : new File(container, name);
}

/** The address of the file named, where it stands, for a reader that takes a file's address. */
export function appGroupFileUri(name: AppGroupFile): string | undefined {
  const file = groupFile(name);

  return file?.exists === true ? file.uri : undefined;
}

/** Writes `json` as the file named, in place of what it held. */
export function writeAppGroupFile(name: AppGroupFile, json: string): void {
  groupFile(name)?.writeSync(json);
}

/** The text the file named holds, or none where it was never written or was removed. */
export function readAppGroupFile(name: AppGroupFile): string | undefined {
  const file = groupFile(name);

  return file?.exists === true ? file.textSync() : undefined;
}

/** Removes the file named, where it stands. */
export function removeAppGroupFile(name: AppGroupFile): void {
  const file = groupFile(name);

  if (file?.exists === true) file.delete();
}
