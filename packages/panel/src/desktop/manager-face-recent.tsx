/**
 * manager-face-recent.tsx -- the faces the account picked last for a Manager, kept on the account as a section's recent icons are, which every face picker offers under Recent.
 *
 * They are one of the account's view choices
 * (`VIEW_CHOICE_KEY.RECENT_MANAGER_FACES`, `../view-choices.ts`), so every
 * device offers the same Recent; what an earlier build kept in this
 * window's storage moves up once. A picker reads them through the well or
 * the menu panel here, so only a picker drawn holds the read, never every
 * Manager's row.
 */

import type { ManagerFace } from "@repo/features/manager-face";
import { managerFaceSchema } from "@repo/features/manager-face";
import { VIEW_CHOICE_KEY, VIEW_CHOICE_LIST_BOUNDS } from "@repo/features/view-choice-wire";
import {
  ManagerFaceMenuPanel,
  type ManagerFaceRecent,
  ManagerFaceWell,
} from "@repo/ui/manager-face-picker";
import { Schema } from "effect";
import type { ComponentProps } from "react";
import { selectFixtureStaged, useAppStateSlice } from "../use-app-state.js";
import { keptKey, useKeptLeaving } from "../use-kept.js";
import { useAccountChoice } from "../view-choices.js";

/** Where an earlier build kept the faces this window picked last, moved up to the account once. */
const KEPT_RECENT = keptKey(
  "app.recentManagerFaces",
  Schema.fromJsonString(Schema.Array(managerFaceSchema)),
);

/** No face picked yet, one list for every draw. */
const NO_RECENT: readonly ManagerFace[] = [];

/** The faces the account picked last, read as a picker opens and kept on the account as it picks, Recent's worth of them. */
function useRecentManagerFaces(): ManagerFaceRecent {
  const [left, forgetLeft] = useKeptLeaving(KEPT_RECENT);

  const { value, choose } = useAccountChoice(
    VIEW_CHOICE_KEY.RECENT_MANAGER_FACES,
    null,
    NO_RECENT,
    useAppStateSlice(selectFixtureStaged) === true,
    [left?.slice(0, VIEW_CHOICE_LIST_BOUNDS.RECENT), forgetLeft],
  );

  return {
    read: () => value,
    write: (faces) => choose(faces.slice(0, VIEW_CHOICE_LIST_BOUNDS.RECENT)),
  };
}

/** A Manager's face well whose picker offers the account's Recent. */
export function RecentManagerFaceWell(
  props: Omit<ComponentProps<typeof ManagerFaceWell>, "recent">,
): React.JSX.Element {
  return <ManagerFaceWell {...props} recent={useRecentManagerFaces()} />;
}

/** Change face's menu panel, whose picker offers the account's Recent. */
export function RecentManagerFaceMenuPanel(
  props: Omit<ComponentProps<typeof ManagerFaceMenuPanel>, "recent">,
): React.JSX.Element {
  return <ManagerFaceMenuPanel {...props} recent={useRecentManagerFaces()} />;
}
