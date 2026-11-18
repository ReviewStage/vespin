/**
 * workspace-keys.ts -- ⌃1 through ⌃9: the account's workspaces by their place in the workspace menu, on a desktop app.
 *
 * The first nine workspaces the workspace menu lists are reached by ⌃ and
 * their number, as Conductor reaches its own, and the menu prints each one's
 * chord at its row's end (`workspace-switcher.tsx`), so a key it prints
 * always works. A press switches as choosing the row does, through the
 * sidebar's own switch, which reopens what was last open there; on the
 * workspace listed already it does nothing, and a number past the last
 * workspace is left to whatever else wants it.
 *
 * The keys are a desktop app's alone, as ⌃Tab is, because a browser on
 * Windows and Linux keeps Ctrl and a digit for its own tabs. A dialog or ⌘K's
 * palette over the window keeps them, so nothing moves behind it, and a
 * surface that keeps its Control chords for itself, a terminal's shell
 * (`terminal-keys.ts`), claims the press before the window hears it.
 */

import { HOST_CAPABILITY } from "@repo/settings";
import { type ShortcutChord, WORKSPACE_CHORDS, workspaceIndexFor } from "@repo/settings/shortcuts";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useRef } from "react";
import { overlayHoldsKeyboard } from "../app-commands.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { appStateQuery, selectCapability } from "../use-app-state.js";

/** No chords, where the window answers none. */
const NO_CHORDS: readonly ShortcutChord[] = [];

/** The chords that switch workspaces in this window, in the menu's order: ⌃1 through ⌃9 on a desktop app, and none anywhere else. */
export function useWorkspaceChords(): readonly ShortcutChord[] {
  const desktop =
    useQuery({ ...appStateQuery, select: selectCapability(HOST_CAPABILITY.DESKTOP_APP) }).data ===
    true;

  return desktop ? WORKSPACE_CHORDS : NO_CHORDS;
}

/** Answers ⌃1 through ⌃9 with the workspace at that place in `tasks`' list, while `available`, past the sign-in, on a desktop app. */
export function useWorkspaceKeys(tasks: TasksControl, available: boolean): void {
  const chords = useWorkspaceChords();
  const answers = available && chords.length > 0;
  const latest = useRef(tasks);
  useLayoutEffect(() => {
    latest.current = tasks;
  });

  useEffect(() => {
    if (!answers) return undefined;

    const down = (event: KeyboardEvent) => {
      if (event.defaultPrevented || overlayHoldsKeyboard()) return;
      const index = workspaceIndexFor(event);

      if (index === undefined) return;
      const { workspaces, workspace, onChooseWorkspace } = latest.current;
      const chosen = workspaces[index];

      if (chosen === undefined) return;
      event.preventDefault();

      // Note that a held chord switches once, and the workspace listed already stays as it stands.
      if (event.repeat || chosen.id === workspace?.id) return;
      onChooseWorkspace(chosen.id);
    };

    window.addEventListener("keydown", down);

    return () => window.removeEventListener("keydown", down);
  }, [answers]);
}
