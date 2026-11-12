/**
 * new-workspace.ts -- New workspace's cards: whether they stand in the window, and the doors that open and put them away.
 *
 * The cards stand alone in the window in the app's place while open
 * (`new-workspace-steps.tsx`): opened from the workspace switcher or a
 * phone's account menu, and put away by their own Cancel or Close. The shell
 * holds whether they stand (`useNewWorkspace`) and hands their opener down
 * on a context, so the menus that offer New workspace open them without
 * every surface between threading it on. Outside the shell, as in a test of
 * one menu, the opener does nothing.
 */

import type { AppStateSnapshot } from "@repo/host/app-state";
import { useQuery } from "@tanstack/react-query";
import { createContext, useContext, useState } from "react";
import type { PlaceLeave } from "../places/place-leave.js";
import { appStateQuery, selectFixtureStaged, selectSignedIn } from "../use-app-state.js";

/** Who the cards may stand for: whether an account reads the window, a fixture's reader among them, and its id. */
interface FoundingAccount {
  readonly signedIn: boolean;
  readonly accountId: string | undefined;
}

const NOTHING = () => undefined;

/** The account the window reads, with a fixture run's synthetic reader taken as signed in, as the task list takes it. */
const selectFoundingAccount = (state: AppStateSnapshot): FoundingAccount => {
  const account = selectSignedIn(state);

  return {
    signedIn: selectFixtureStaged(state) || account !== undefined,
    accountId: account?.id,
  };
};

const NewWorkspaceContext = createContext<() => void>(NOTHING);

/** Hands the shell's opener of New workspace's cards to everything under it. */
export const NewWorkspaceOpener = NewWorkspaceContext.Provider;

/** Opens New workspace's cards over the window, once its leave guard lets the page go. */
export function useOpenNewWorkspace(): () => void {
  return useContext(NewWorkspaceContext);
}

/** Whether New workspace's cards stand, and their doors. */
export interface NewWorkspace {
  readonly open: boolean;
  readonly onOpen: () => void;
  readonly onClose: () => void;
}

/**
 * New workspace's cards as the shell holds them. Open only for the account
 * that opened them, so a sign-out puts them away.
 */
export function useNewWorkspace(placeLeave: PlaceLeave): NewWorkspace {
  const { signedIn, accountId } = useQuery({
    ...appStateQuery,
    select: selectFoundingAccount,
  }).data ?? { signedIn: false, accountId: undefined };

  // The account the cards were opened for, which alone they stand for.
  const [founding, setFounding] = useState<{ accountId: string | undefined } | undefined>(
    undefined,
  );

  // A sign-out, or another account, puts the cards away for good, so the same account signing in again does not find them open.
  if (founding !== undefined && (!signedIn || founding.accountId !== accountId)) {
    setFounding(undefined);
  }

  return {
    open: signedIn && founding !== undefined && founding.accountId === accountId,
    // Note that the cards take the window in the page's place with no address of their own, so a page holding unsaved
    // work asks first inside `arrive`, as leaving it does, and they open once Leave is pressed.
    onOpen: () => placeLeave.arrive(NOTHING, () => setFounding({ accountId })),
    onClose: () => setFounding(undefined),
  };
}
