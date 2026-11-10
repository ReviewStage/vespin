/**
 * chosen-workspace.ts -- the workspace the phone works in, chosen in Settings and remembered across launches, as the panel keeps its window's choice (`@repo/panel`'s `chosen-workspace.ts`).
 *
 * The service is told the workspace on each request, so the host keeps no
 * workspace of its own; the choice is the device's, kept in the app's
 * `NSUserDefaults` through React Native's `Settings`, and every screen
 * reading it hears a new choice as it is made, the Inbox's among them. A
 * choice no longer listed, a workspace left or deleted, falls back to the
 * account's first, which the host lists first, as the panel's does.
 */

import type { Workspace } from "@repo/features/workspace-wire";
import { useSyncExternalStore } from "react";
import { Settings } from "react-native";

/** The defaults key the choice is kept under. */
const CHOSEN_WORKSPACE_KEY = "chosenWorkspace";

/** The id kept, or none where nothing was ever chosen. */
function keptChoice(): string | undefined {
  const kept: unknown = Settings.get(CHOSEN_WORKSPACE_KEY);
  return typeof kept === "string" ? kept : undefined;
}

/** The screens reading the choice, each told when it is made here. */
const readers = new Set<() => void>();

/**
 * Calls `listener` each time the kept choice changes until the returned
 * function stops it. Note that a choice made here is told to the readers
 * directly, because React Native's settings manager hears no change of the
 * defaults it wrote itself, and `watchKeys` only one made elsewhere.
 */
function watchChoice(listener: () => void): () => void {
  readers.add(listener);
  const watching = Settings.watchKeys([CHOSEN_WORKSPACE_KEY], listener);
  return () => {
    readers.delete(listener);
    Settings.clearWatch(watching);
  };
}

/** Keeps `id` as the workspace the phone works in, and tells every screen reading it. */
function choose(id: string): void {
  Settings.set({ [CHOSEN_WORKSPACE_KEY]: id });
  for (const reader of readers) reader();
}

/** The workspace the phone works in, among `workspaces`, and the choice of another, which is kept and heard by every screen reading it. */
export function useChosenWorkspace(workspaces: readonly Workspace[]): {
  readonly chosen: Workspace | undefined;
  readonly choose: (id: string) => void;
} {
  const kept = useSyncExternalStore(watchChoice, keptChoice);
  const chosen = workspaces.find((workspace) => workspace.id === kept) ?? workspaces[0];
  return { chosen, choose };
}
