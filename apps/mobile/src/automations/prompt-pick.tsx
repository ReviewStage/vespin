// prompt-pick.tsx -- the door between the automation editor and its prompt's page pushed over it in its sheet: the editor lends the page its prompt and workspace and listens, and the page hands back the prompt as it is typed.
//
// Note that the prompt goes through this door rather than expo-router's params, as the time zone and the agent go back (`pickedRoute`), because it is Markdown that can run to thousands of characters, which a route's params would carry in its address and hand back only on a pop, losing what was typed on a swipe back.

import { createContext, type ReactNode, useContext, useEffect, useState } from "react";

/** What the editor under the prompt's page lends it: the draft's prompt as it stands, and the workspace whose people and things an `@` offers. */
export interface PromptLent {
  readonly prompt: string;
  readonly workspaceId: string;
}

/** What the sheet's pages share: the editor's listener and what it lends, and the prompt that reaches it. */
interface PromptDoor {
  readonly listen: (
    onPrompt: ((prompt: string) => void) | undefined,
    lent: PromptLent | undefined,
  ) => void;
  readonly lent: () => PromptLent | undefined;
  readonly write: (prompt: string) => void;
}

const PromptContext = createContext<PromptDoor | undefined>(undefined);

/** A door with no listener yet. */
function promptDoor(): PromptDoor {
  let listener: ((prompt: string) => void) | undefined;
  let lending: PromptLent | undefined;

  return {
    listen: (onPrompt, lent) => {
      listener = onPrompt;
      lending = lent;
    },
    lent: () => lending,
    write: (prompt) => listener?.(prompt),
  };
}

/** Holds the door for the sheet's pages, around its stack, made once so nothing under it draws again. */
export function PromptPickProvider({ children }: { readonly children: ReactNode }) {
  const [door] = useState(promptDoor);

  return <PromptContext value={door}>{children}</PromptContext>;
}

/** Listens for the prompt typed on the page pushed over the caller, and lends the page the prompt and the workspace, while the caller stands. */
export function usePromptPicked(onPrompt: (prompt: string) => void, lent: PromptLent): void {
  const door = useContext(PromptContext);

  useEffect(() => {
    door?.listen(onPrompt, lent);

    return () => door?.listen(undefined, undefined);
  }, [door, onPrompt, lent]);
}

/** The prompt's page's side of the door: what the editor lent as the page opened, and the write that hands the prompt back. */
export interface PromptPicking {
  readonly lent: PromptLent | undefined;
  readonly write: (prompt: string) => void;
}

/** Writes the prompt for the editor under the caller, nothing where no editor listens. */
export function usePromptPick(): PromptPicking {
  const door = useContext(PromptContext);
  const [lent] = useState(() => door?.lent());

  return { lent, write: (prompt) => door?.write(prompt) };
}
