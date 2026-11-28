// draft-pictures.ts -- the files a share draft's pictures were kept in, read from a route's param, as New task and the share page open a draft on them.

import { SHARE_DRAFT_PICTURE_FILES } from "@repo/features/ios-share-wire";
import { appGroupFileUri } from "../app-group.js";

/**
 * The addresses of the draft's picture files that `param`, a JSON list of
 * their names, names and that stand. Note that a route's params may come
 * from any link, so only the share sheet's own file names are read, from
 * the group, and never an address a param spells.
 */
export function draftPictures(param: string | undefined): readonly string[] | undefined {
  if (param === undefined) return undefined;
  let read: unknown;

  try {
    read = JSON.parse(param);
  } catch {
    return undefined;
  }

  if (!Array.isArray(read)) return undefined;

  return SHARE_DRAFT_PICTURE_FILES.filter((name) => read.includes(name)).flatMap(
    (name) => appGroupFileUri(name) ?? [],
  );
}
