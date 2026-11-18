/**
 * chosen-workspace.ts -- the workspace the phone works in, chosen in Settings and remembered across launches, as the panel keeps its window's choice (`@repo/panel`'s `chosen-workspace.ts`).
 *
 * The service is told the workspace on each request, so the host keeps no
 * workspace of its own; the choice is the device's, held in memory and kept
 * in the app's `NSUserDefaults` through React Native's `Settings` for the
 * next launch, and every screen reading it hears a new choice as it is
 * made, the Inbox's among them. A
 * choice no longer listed, a workspace left or deleted, falls back to the
 * account's first, which the host lists first, as the panel's does.
 */

import type { Workspace } from "@repo/features/workspace-wire";
import { heldValue, useHeldValue } from "@repo/ui-native";
import { Predicate } from "effect";
import { Settings } from "react-native";

/** The defaults key the choice is kept under. */
const CHOSEN_WORKSPACE_KEY = "chosenWorkspace";

/** The id kept at launch, or none where nothing was ever chosen. */
function launchChoice(): string | undefined {
  const kept: unknown = Settings.get(CHOSEN_WORKSPACE_KEY);

  return Predicate.isString(kept) ? kept : undefined;
}

/**
 * The choice as the phone holds it now. Note that it is held here rather
 * than read back from React Native's `Settings`, because that module's copy
 * of the defaults takes every key from each change the defaults report,
 * and its own write lands on the native side only later; a default another
 * piece of the app wrote in between, as the host and the Swift modules do as
 * the app opens, reported the old choice back over the new one, so a switch
 * sprang back, or held off until a relaunch read the defaults afresh. Only
 * this module writes the choice, so what it holds is the choice.
 */
const choice = heldValue(launchChoice());

/** Keeps `id` as the workspace the phone works in, for this launch and the next, and tells every screen reading it. */
function choose(id: string): void {
  if (choice.read() === id) return;

  Settings.set({ [CHOSEN_WORKSPACE_KEY]: id });
  choice.set(id);
}

/**
 * Chooses `next` only where the phone still works in `over`, so a write
 * that moved the phone for itself, such as a task's move, puts it back or
 * forward again without overriding a newer choice made since.
 */
export function chooseOver(over: string, next: string): void {
  if (choice.read() === over) choose(next);
}

type UseChosenWorkspaceResult = {
  readonly chosen: Workspace | undefined;
  readonly choose: (id: string) => void;
};

/** The workspace the phone works in, among `workspaces`, and the choice of another, which is kept and heard by every screen reading it. */
export function useChosenWorkspace(workspaces: readonly Workspace[]): UseChosenWorkspaceResult {
  const kept = useHeldValue(choice);
  const chosen = workspaces.find((workspace) => workspace.id === kept) ?? workspaces[0];

  return { chosen, choose };
}
