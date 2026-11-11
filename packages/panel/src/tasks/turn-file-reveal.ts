/**
 * turn-file-reveal.ts -- the file a press on a turn's files row asked the turn's Changes tab to stand on, kept until the tab reads it.
 *
 * A chip in the row opens the turn's Changes tab (`turn-files.tsx`), which
 * the side panel draws from the tab alone, its agent and the line that
 * opened its turn. The file pressed travels beside it, here, by agent and
 * then by that line, counted so a second press of the same chip stands the
 * tab on the file again; the tab reads it as it draws (`TurnChangesPane`)
 * and stands on the file once per ask. Nothing is kept past the window.
 */

import { useSyncExternalStore } from "react";

/** A file to stand on, as a press asked: its path, and the press, so each is its own. */
export interface TurnFileReveal {
  readonly path: string;
  readonly ask: number;
}

const asks = new Map<string, Map<string, TurnFileReveal>>();
const listeners = new Set<() => void>();
let count = 0;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Asks the turn's Changes tab, once it draws, to stand on the file: the turn by its agent and the line that opened it. */
export function askTurnFileReveal(agentId: string, messageId: string, path: string): void {
  const ofAgent = asks.get(agentId) ?? new Map<string, TurnFileReveal>();
  asks.set(agentId, ofAgent);
  count += 1;
  ofAgent.set(messageId, { path, ask: count });
  for (const listener of listeners) listener();
}

/** The file the turn's Changes tab was last asked to stand on; none where no press asked one. */
export function useTurnFileReveal(agentId: string, messageId: string): TurnFileReveal | undefined {
  return useSyncExternalStore(subscribe, () => asks.get(agentId)?.get(messageId));
}
