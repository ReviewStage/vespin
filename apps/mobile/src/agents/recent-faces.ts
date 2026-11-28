/**
 * recent-faces.ts -- the Manager faces the member last picked on this phone, which the face picker's Recent offers, kept in the app's `NSUserDefaults` for the next launch.
 *
 * Each face is kept as the wire carries it (`managerFaceSchema`), in the
 * color it was picked in, newest first (`recentFaces`), as the panel's
 * section icon picker keeps the icons a Mac chose last. The list is held
 * here, read from the defaults once at launch, as `recent-opened.ts` holds
 * Search's, since only this module writes it.
 */

import { type ManagerFace, managerFaceSchema } from "@repo/features/manager-face";
import { heldValue, recentFaces, useHeldValue } from "@repo/ui-native";
import { Option, Schema } from "effect";
import { Settings } from "react-native";

/** The defaults key the list is kept under. */
const RECENT_KEY = "managerFacesRecent";

/** The list kept at launch, none where the defaults hold nothing readable, such as a build that kept another shape. */
const decodeKept = Schema.decodeUnknownOption(Schema.Array(managerFaceSchema));

/** The list as the phone holds it now, newest first. */
const recent = heldValue(
  Option.getOrElse(decodeKept(Settings.get(RECENT_KEY)), (): readonly ManagerFace[] => []),
);

/** Puts `picked` at the head of the list for this launch and the next, and tells every picker reading it. */
export function keepRecentFace(picked: ManagerFace): void {
  const next = recentFaces(recent.read(), picked);

  Settings.set({ [RECENT_KEY]: next });
  recent.set(next);
}

/** The faces the member last picked on this phone, newest first. */
export function useRecentFaces(): readonly ManagerFace[] {
  return useHeldValue(recent);
}
