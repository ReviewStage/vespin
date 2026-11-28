// index.tsx -- the share page on a draft the share sheet kept, which the app opens once it comes forward (`share-sheet.ts`): its words, the places it ticked, its pictures, the repository New task starts in, and the keys the sheet sent each place under.

import { Predicate } from "effect";
import { useLocalSearchParams } from "expo-router";
import { ShareDraftScreen } from "../../../screens/share-screens.js";
import { draftPictures } from "../../../share/draft-pictures.js";

export { ScreenBoundary as ErrorBoundary } from "../../../screen-boundary.js";

/** The place ids `param`, a JSON list, names; none where it reads as no list. */
function draftDestinations(param: string | undefined): readonly string[] {
  if (param === undefined) return [];

  try {
    const read: unknown = JSON.parse(param);

    return Array.isArray(read) ? read.filter(Predicate.isString) : [];
  } catch {
    return [];
  }
}

/** The key each place's write went under in the share sheet, from `param`, a JSON object of them by place; none where it reads as no object of words. */
function draftKeys(param: string | undefined): ReadonlyMap<string, string> {
  if (param === undefined) return new Map();

  try {
    const read: unknown = JSON.parse(param);

    if (!Predicate.isObject(read) || Array.isArray(read)) return new Map();

    return new Map(
      Object.entries(read).flatMap(([to, key]) => (Predicate.isString(key) ? [[to, key]] : [])),
    );
  } catch {
    return new Map();
  }
}

export default function ShareRoute() {
  const { prompt, destinations, pictures, repository, keys, taskId } = useLocalSearchParams<{
    prompt?: string;
    destinations?: string;
    pictures?: string;
    repository?: string;
    keys?: string;
    taskId?: string;
  }>();

  return (
    <ShareDraftScreen
      draft={{
        prompt: prompt ?? "",
        destinations: draftDestinations(destinations),
        pictures: draftPictures(pictures),
        repository: repository === "" ? undefined : repository,
        keys: draftKeys(keys),
        taskId: taskId === "" ? undefined : taskId,
      }}
    />
  );
}
