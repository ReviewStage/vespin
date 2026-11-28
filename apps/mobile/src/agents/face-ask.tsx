/**
 * face-ask.tsx -- where a Manager's face is changed outside its sheets: the face picker a screen stands for its Managers' rows, which a row's Change face… asks for by the Manager it names.
 *
 * A row stands inside a SwiftUI list, where no sheet can stand, so the
 * screen listing it stands one picker (`FaceAsking`) and its rows ask it
 * through `useFaceAsk`; each screen stands its own, so a page pushed over
 * the list, or an iPad's detail beside it, never raises a second.
 */

import type { ManagerFace } from "@repo/features/manager-face";
import { ManagerFaceSheet } from "@repo/ui-native";
import {
  type ComponentProps,
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useState,
} from "react";
import { keepRecentFace, useRecentFaces } from "./recent-faces.js";
import { useAgentRowActs } from "./use-agent.js";

/** What a Manager's row and page menus call the act that opens its face picker, the panel's Change face, its ellipsis saying it asks more first. */
export const CHANGE_FACE = "Change face…";

/** Opens the face picker over a Manager: its id and the face it wears. */
export type FaceAsk = (agentId: string, face: ManagerFace) => void;

/** The picker the screen stands for its rows; none outside one. */
const FaceAskContext = createContext<FaceAsk | undefined>(undefined);

/** The face picker, offering the faces this phone picked last as Recent, and keeping each pick among them. */
export function FaceSheet({
  onPick,
  ...sheet
}: Omit<ComponentProps<typeof ManagerFaceSheet>, "recent">) {
  const recent = useRecentFaces();

  return (
    <ManagerFaceSheet
      {...sheet}
      recent={recent}
      onPick={(picked) => {
        keepRecentFace(picked);
        onPick(picked);
      }}
    />
  );
}

/**
 * The screen's face picker, which a row under it opens over its Manager
 * (`useFaceAsk`), the pick changing the face at once, as a Manager's
 * Settings changes it, and a refusal saying so in the failure notice.
 */
export function FaceAsking({ children }: { readonly children: ReactNode }) {
  const acts = useAgentRowActs();
  const [asked, setAsked] = useState<{ agentId: string; face: ManagerFace } | undefined>(undefined);

  const ask = useCallback<FaceAsk>((agentId, face) => setAsked({ agentId, face }), []);

  return (
    <FaceAskContext.Provider value={ask}>
      {children}
      <FaceSheet
        face={asked?.face}
        presented={asked !== undefined}
        onDismiss={() => setAsked(undefined)}
        onPick={(picked) => {
          if (asked !== undefined) acts.changeFace(asked.agentId, picked);
        }}
      />
    </FaceAskContext.Provider>
  );
}

/** What opens the screen's face picker over a Manager; none on a screen that stands none. */
export function useFaceAsk(): FaceAsk | undefined {
  return useContext(FaceAskContext);
}
