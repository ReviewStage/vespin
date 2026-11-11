// app-group.ts -- the files the app shares with its extensions through its App Group (`APP_GROUP` in `app.config.ts`): the one door the app's JavaScript writes, reads, and removes them through.

import { File, Paths } from "expo-file-system";

export const APP_GROUP_FILE = {
  INBOX_WIDGET: "inbox-widget.json",
  SHARE_SNAPSHOT: "share-snapshot.json",
  SHARE_DRAFT: "share-draft.json",
} as const;
export type AppGroupFile = (typeof APP_GROUP_FILE)[keyof typeof APP_GROUP_FILE];

function groupFile(name: AppGroupFile): File | undefined {
  const container = Object.values(Paths.appleSharedContainers)[0];
  return container === undefined ? undefined : new File(container, name);
}
export function writeAppGroupFile(name: AppGroupFile, json: string): void {
  groupFile(name)?.writeSync(json);
}
export function readAppGroupFile(name: AppGroupFile): string | undefined {
  const file = groupFile(name);
  return file?.exists === true ? file.textSync() : undefined;
}
export function removeAppGroupFile(name: AppGroupFile): void {
  const file = groupFile(name);
  if (file?.exists === true) file.delete();
}
