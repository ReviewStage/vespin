// chip-names.tsx -- what a chip in a line of words is called by the entity it names, as the app holds it, read as the chip draws, as the panel's chip reads the window's names (`useNamesOf`).

import type { Entity, KnownNames } from "@repo/features/entity-kind";
import { createContext, type ReactNode, useContext } from "react";

/**
 * The names the app holds for the one entity a chip names, under the
 * workspace its link was written in, which a task's number counts within;
 * none where it holds none, as for a task still being found, one the reader
 * may not open, or one deleted. Note that it is a hook: a chip calls it as
 * it draws, so it reads what it names by key and draws again as that moves.
 */
export type UseChipNames = (
  entity: Entity | undefined,
  workspace: string | undefined,
) => KnownNames | undefined;

const noNames: UseChipNames = () => undefined;

const ChipNamesContext = createContext<UseChipNames>(noNames);

/**
 * Hands every line of words under it the app's reading of what its chips
 * name, so a bare link to a task, an agent, or a person says its name now,
 * as the panel's chip does, rather than its kind. It stands at the app's
 * root and is never swapped, since a chip calls what it hands as a hook.
 */
export function ChipNamesProvider({
  useNames,
  children,
}: {
  readonly useNames: UseChipNames;
  readonly children: ReactNode;
}) {
  return <ChipNamesContext value={useNames}>{children}</ChipNamesContext>;
}

/** The names the app holds for the entity a chip names; none outside a `ChipNamesProvider`. */
export function useChipNames(
  entity: Entity | undefined,
  workspace: string | undefined,
): KnownNames | undefined {
  const useNames = useContext(ChipNamesContext);

  return useNames(entity, workspace);
}
