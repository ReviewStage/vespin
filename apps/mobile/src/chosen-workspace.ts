/**
 * chosen-workspace.ts -- the workspace the phone works in, chosen in Settings and remembered across launches, as the panel keeps its window's choice (`@repo/panel`'s `chosen-workspace.ts`).
 *
 * The service is told the workspace on each request, so the host keeps no
 * workspace of its own; the choice is the device's, kept in the app's
 * `NSUserDefaults` through React Native's `Settings`. A choice no longer
 * listed, a workspace left or deleted, falls back to the account's first,
 * which the host lists first, as the panel's does.
 */

import type { Workspace } from "@repo/features/workspace-wire";
import { useState } from "react";
import { Settings } from "react-native";

/** The defaults key the choice is kept under. */
const CHOSEN_WORKSPACE_KEY = "chosenWorkspace";

/** The id kept, or none where nothing was ever chosen. */
function keptChoice(): string | undefined {
  const kept: unknown = Settings.get(CHOSEN_WORKSPACE_KEY);
  return typeof kept === "string" ? kept : undefined;
}

/** The workspace the phone works in, among `workspaces`, and the choice of another, which is kept. */
export function useChosenWorkspace(workspaces: readonly Workspace[]): {
  readonly chosen: Workspace | undefined;
  readonly choose: (id: string) => void;
} {
  const [kept, setKept] = useState(keptChoice);
  const chosen = workspaces.find((workspace) => workspace.id === kept) ?? workspaces[0];
  const choose = (id: string) => {
    Settings.set({ [CHOSEN_WORKSPACE_KEY]: id });
    setKept(id);
  };
  return { chosen, choose };
}
