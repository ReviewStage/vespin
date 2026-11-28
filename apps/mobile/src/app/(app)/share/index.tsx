// index.tsx -- the share page on a draft the share sheet kept, which the app opens once it comes forward (`share-sheet.ts`): its words, the places it ticked, its pictures, and the repository New task starts in.

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

export default function ShareRoute() {
  const { prompt, destinations, pictures, repository } = useLocalSearchParams<{
    prompt?: string;
    destinations?: string;
    pictures?: string;
    repository?: string;
  }>();

  return (
    <ShareDraftScreen
      draft={{
        prompt: prompt ?? "",
        destinations: draftDestinations(destinations),
        pictures: draftPictures(pictures),
        repository: repository === "" ? undefined : repository,
      }}
    />
  );
}
