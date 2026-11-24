// editor-pick.tsx -- the door between the automation editor and the pages pushed over it in its sheet, its time zone, its prompt, and the agent its runs go to: the editor listens through the door and lends the page what it edits, and the page picks through it.

import { createContext, type ReactNode, useContext, useEffect, useState } from "react";

/** What a page pushed over the editor hands back. */
export const EDITOR_PICK = {
  ZONE: "zone",
  PROMPT: "prompt",
  AGENT: "agent",
} as const;

/** One pick: a time zone, the prompt's words as Markdown, or the agent a same-agent automation's runs go to, none for the one its first run starts. */
export type EditorPick =
  | { readonly kind: typeof EDITOR_PICK.ZONE; readonly zone: string }
  | { readonly kind: typeof EDITOR_PICK.PROMPT; readonly prompt: string }
  | { readonly kind: typeof EDITOR_PICK.AGENT; readonly agentId: string | null };

/** What the editor under a page lends it: the draft's prompt and agent as they stand, and the workspace it is made in. */
export interface EditorLent {
  readonly prompt: string;
  readonly agentId: string | null;
  readonly workspaceId: string;
}

/** What the sheet's pages share: the editor's listener and what it lends, and the pick that reaches it. */
interface EditorPickDoor {
  readonly listen: (
    onPick: ((pick: EditorPick) => void) | undefined,
    lent: EditorLent | undefined,
  ) => void;
  readonly lent: () => EditorLent | undefined;
  readonly pick: (pick: EditorPick) => void;
}

const EditorPickContext = createContext<EditorPickDoor | undefined>(undefined);

/** A door with no listener yet. */
function editorPickDoor(): EditorPickDoor {
  let listener: ((pick: EditorPick) => void) | undefined;
  let lending: EditorLent | undefined;

  return {
    listen: (onPick, lent) => {
      listener = onPick;
      lending = lent;
    },
    lent: () => lending,
    pick: (pick) => listener?.(pick),
  };
}

/** Holds the door for the sheet's pages, around its stack, made once so nothing under it draws again. */
export function EditorPickProvider({ children }: { readonly children: ReactNode }) {
  const [door] = useState(editorPickDoor);

  return <EditorPickContext value={door}>{children}</EditorPickContext>;
}

/** Listens for a pick on a page pushed over the caller, and lends the pages what they edit, while the caller stands. */
export function useEditorPicked(onPick: (pick: EditorPick) => void, lent: EditorLent): void {
  const door = useContext(EditorPickContext);

  useEffect(() => {
    door?.listen(onPick, lent);

    return () => door?.listen(undefined, undefined);
  }, [door, onPick, lent]);
}

/** A page's side of the door: its pick, and what the editor under it lent as it opened. */
export interface EditorPicking {
  readonly pick: (pick: EditorPick) => void;
  readonly lent: EditorLent | undefined;
}

/** Picks for the editor under the caller, nothing where no editor listens, and what that editor lends as the page opens. */
export function useEditorPick(): EditorPicking {
  const door = useContext(EditorPickContext);
  const [lent] = useState(() => door?.lent());

  return { pick: (pick) => door?.pick(pick), lent };
}
