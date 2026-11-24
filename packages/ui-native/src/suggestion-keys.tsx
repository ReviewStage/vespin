// suggestion-keys.tsx -- a hardware keyboard's ↑, ↓ and Return over the list a composer floats: the composer hears them from its field and hands them to the list standing in its float, which moves the row it has chosen and picks it, as the desktop's picker takes them.

import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { LIST_KEY, type ListKey, movedChoice } from "./suggestion-keys-model.js";

export { LIST_KEY, type ListKey, listKeyOf } from "./suggestion-keys-model.js";

/** What a composer's field is handed while a list floats over it: whether a row is chosen, which Return then picks, and where each key goes. */
export interface ListKeysField {
  readonly picks: boolean;
  readonly onKey: (key: ListKey) => void;
}

/** The door a floating list tells its composer through what its field should hand it, or that it no longer stands. */
type ListKeysDoor = (listening: ListKeysField | undefined) => void;

const ListKeysContext = createContext<ListKeysDoor | undefined>(undefined);

/** A composer's side of the keys: the door its float's list tells it through, and what its field is handed, none while no list stands. */
export interface SuggestionKeysHost {
  readonly door: ListKeysDoor;
  readonly field: ListKeysField | undefined;
}

/** The keys' host a composer holds (`SuggestionKeysHost`). */
export function useSuggestionKeysHost(): SuggestionKeysHost {
  const [field, setField] = useState<ListKeysField | undefined>(undefined);

  return { door: setField, field };
}

/** Opens a composer's door to the list its float holds. */
export function SuggestionKeysDoor({
  door,
  children,
}: {
  readonly door: ListKeysDoor;
  readonly children: ReactNode;
}) {
  return <ListKeysContext value={door}>{children}</ListKeysContext>;
}

/**
 * The row of `count` a hardware keyboard's arrows have chosen in a list a
 * composer floats, none until an arrow is pressed, so a list a finger
 * works stands with no row marked, and Return keeps breaking the line
 * until one is chosen; Return then picks it through `pick`. Note that the
 * row stays chosen by its place as the words narrow the list, held to its
 * last row, as the desktop's highlight holds; outside a composer, such as
 * a document's dock, no key reaches it and nothing is chosen.
 */
export function useSuggestionKeys(
  count: number,
  pick: (index: number) => void,
): number | undefined {
  const door = useContext(ListKeysContext);
  const [chosen, setChosen] = useState<number | undefined>(undefined);
  const at = chosen === undefined || count === 0 ? undefined : Math.min(chosen, count - 1);
  const latest = useRef({ count, at, pick });
  const picks = at !== undefined;

  // Note that a key reads the list as it last stood, so a key pressed as the words narrow it acts on the rows drawn.
  useLayoutEffect(() => {
    latest.current = { count, at, pick };
  });

  useEffect(() => {
    door?.({
      picks,
      onKey: (key) => {
        const now = latest.current;

        if (key !== LIST_KEY.PICK) return setChosen(movedChoice(now.count, now.at, key));

        if (now.at !== undefined) now.pick(now.at);
      },
    });
  }, [door, picks]);

  useEffect(() => () => door?.(undefined), [door]);

  return at;
}
