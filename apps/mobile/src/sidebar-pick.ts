// sidebar-pick.ts -- the app sidebar's last pick, the place and the Tasks collection it stood on, kept across launches so a wide window opens where it was left, as Mail opens on the mailbox last read.

import { Predicate } from "effect";
import { useSyncExternalStore } from "react";
import { Settings } from "react-native";
import type { SidebarPlace } from "./screens/app-sidebar.js";

/** The defaults keys the pick is kept under. */
const KEY = {
  PLACE: "sidebarPlace",
  COLLECTION: "tasksCollection",
} as const;

/** A string kept under `key`, none where nothing non-empty is. */
function kept(key: (typeof KEY)[keyof typeof KEY]): string | undefined {
  const value: unknown = Settings.get(key);

  return Predicate.isString(value) && value !== "" ? value : undefined;
}

/** The screens reading the collection, each told as a pick changes it. */
const readers = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  readers.add(listener);

  return () => {
    readers.delete(listener);
  };
}

/** Tells every reader that the kept pick changed, since React Native's settings manager hears no change it wrote itself. */
function tell(): void {
  for (const reader of readers) reader();
}

/** Keeps the place a sidebar row picked. */
export function keepSidebarPlace(place: SidebarPlace): void {
  Settings.set({ [KEY.PLACE]: place });
  tell();
}

/**
 * Keeps the group of tasks a sidebar row picked, by its key, or none for
 * every task, as the Tasks row picks. A pick of the Inbox or Search leaves
 * it as it was, so Tasks comes back on it. Note that none is kept as an
 * empty string, since React Native's `Settings` takes no value away.
 */
export function keepTasksCollection(key: string | undefined): void {
  Settings.set({ [KEY.COLLECTION]: key ?? "" });
  tell();
}

/** The place the sidebar last picked, as it was kept; none before any pick. */
export function keptSidebarPlace(): string | undefined {
  return kept(KEY.PLACE);
}

/** The group of tasks the sidebar last picked, Pinned, Following, or a section, by its key; none for every task. */
export function useTasksCollection(): string | undefined {
  return useSyncExternalStore(subscribe, () => kept(KEY.COLLECTION));
}
