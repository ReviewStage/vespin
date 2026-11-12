import { hostMintedId } from "@repo/wire/host-ids";

/**
 * The ids the host mints for what a runtime's stream names only relatively. A turn
 * of the retired runtime's is `turn_<n>` inside its session, and a received message or a
 * reasoning item has no id of its own; the store keys a turn by uuid and a
 * message by a client id unique in its conversation. Each id here is the
 * same function of the same coordinates, so a retried step that re-emits an
 * event under a new event id lands on the row the first attempt opened
 * rather than beside it. The function is `@repo/wire`'s (`host-ids.ts`), so a
 * window derives the id a line it sent is written under (`sentLineId`).
 */

const ID_KIND = {
  CHILD: "child",
  TURN: "turn",
  RECEIVED: "received",
  ANSWER: "answer",
  REASONING: "reasoning",
  NATIVE_TURN: "native-turn",
  IMPORTED_TURN: "imported-turn",
} as const;

/**
 * The store's id for the child conversation a subagent's session is recorded
 * in: one per call that started a subagent, so the parent's call alone finds
 * its subagent's record.
 */
export function childConversationId(parentConversationId: string, callId: string): string {
  return hostMintedId([ID_KIND.CHILD, parentConversationId, callId]);
}

/**
 * The store's id for one turn of a native harness's conversation, by the
 * number of the runner event that opened it, which no other turn of the
 * conversation shares, so a batch posted again opens the same turn.
 */
export function nativeTurnId(conversationId: string, openingSequence: number): string {
  return hostMintedId([ID_KIND.NATIVE_TURN, conversationId, String(openingSequence)]);
}

/**
 * The store's id for one turn of a transcript imported from elsewhere, by the
 * imported record that opened it, so an import run again lands on the turn
 * the first run wrote, and two accounts importing one transcript never share
 * a turn.
 */
export function importedTurnId(conversationId: string, openingRecordId: string): string {
  return hostMintedId([ID_KIND.IMPORTED_TURN, conversationId, openingRecordId]);
}

/** The id a reasoning item stands under, since the runtime's stream carries none of the provider's. */
export function reasoningItemId(
  sessionId: string,
  runtimeTurnId: string,
  stepIndex: number,
  ordinal: number,
): string {
  return hostMintedId([
    ID_KIND.REASONING,
    sessionId,
    runtimeTurnId,
    String(stepIndex),
    String(ordinal),
  ]);
}
