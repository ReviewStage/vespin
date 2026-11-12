/**
 * routed-exits.ts -- the window's ways out of a routed place, and what its routes remember for as long as it lives.
 *
 * A routed place is left for the place the window's state says by the Tasks
 * tab's navigation there (`TasksControl.onLeaveRouted`), and kept standing
 * where a door asks for the place already standing, which the window's leave
 * guard hears (`PlaceLeave.stays`), and both are made after the routes that
 * read them. So the window's root provides `RoutedExits`, two callbacks the
 * window fills in once the tab stands and every route hook calls as it is
 * pressed, the way a ref handed down would be, and any surface may call a
 * route hook with no input threaded to it.
 *
 * The narrow rooms' ways back read the window's history the same way
 * (`narrow-backs.ts`): whether a list is the step behind is its answer, so
 * the window fills in `behind` beside the two once its history stands.
 *
 * Three routes remember something no address holds, for as long as the
 * window lives: the Inbox's items as a door chose them, the automations seen
 * deleted, and the names a person's page was opened with. Each is one
 * TanStack Store per window (`RoutedMemory`), so every caller of a route
 * hook, the tasks tab and the window's history among them, reads and writes
 * the same one.
 */

import { Store } from "@tanstack/react-store";
import { createContext, createElement, type ReactNode, useContext, useState } from "react";
import type { InboxChoice } from "../tasks/use-tasks-tab.js";
import type { StepsBehind } from "./narrow-backs.js";

/** The window's ways out of the routed place standing, filled in by the window once its history stands, and read as they are pressed. */
export interface RoutedExits {
  /** Leaves the routed place standing for the place the window's state says, a navigation the router's blocker holds (`TasksControl.onLeaveRouted`). */
  leave: () => void;
  /** Says a door asked for the routed place standing, which moves nothing, so the window's leave guard keeps its ask (`PlaceLeave.stays`). */
  stay: () => void;
  /** The window's history as a way back reads it, which holds no step behind until the window's own stands. */
  behind: StepsBehind;
}

/** What the routes remember for as long as the window lives, which no address holds. */
export interface RoutedMemory {
  /** Each Inbox item a door chose, by its id. */
  readonly inboxChoices: Store<ReadonlyMap<string, InboxChoice>>;
  /** Every automation the window has seen deleted, by its id. */
  readonly deletedAutomations: Store<ReadonlyMap<string, true>>;
  /** Each name a person's page was opened with, by the person, which the address leaves out. */
  readonly personNames: Store<ReadonlyMap<string, string>>;
}

/** The history a window holds before its own stands: no step behind, so each way back stands its list. */
const NO_STEPS_BEHIND: StepsBehind = {
  backTo: () => false,
  upTo: (_to, stand) => stand(),
  stepBack: () => false,
};

/** The window's routed exits and memory, none outside a window's root. */
const RoutedExitsContext = createContext<
  { readonly exits: RoutedExits; readonly memory: RoutedMemory } | undefined
>(undefined);

/** The window's routed exits and memory, which only a window's root provides. */
function useRouted(): { readonly exits: RoutedExits; readonly memory: RoutedMemory } {
  const routed = useContext(RoutedExitsContext);

  if (routed === undefined) throw new Error("A route hook is called outside RoutedExitsProvider.");

  return routed;
}

/** The window's ways out of the routed place standing. */
export function useRoutedExits(): RoutedExits {
  return useRouted().exits;
}

/** What the window's routes remember. */
export function useRoutedMemory(): RoutedMemory {
  return useRouted().memory;
}

/** Holds one window's routed exits, leaving and staying nowhere and holding no step behind until the window fills them in, and its memory, each made once. */
export function RoutedExitsProvider({ children }: { readonly children?: ReactNode }): ReactNode {
  const [routed] = useState(() => ({
    exits: {
      leave: () => undefined,
      stay: () => undefined,
      behind: NO_STEPS_BEHIND,
    },
    memory: {
      inboxChoices: new Store<ReadonlyMap<string, InboxChoice>>(new Map()),
      deletedAutomations: new Store<ReadonlyMap<string, true>>(new Map()),
      personNames: new Store<ReadonlyMap<string, string>>(new Map()),
    },
  }));

  return createElement(RoutedExitsContext.Provider, { value: routed }, children);
}
