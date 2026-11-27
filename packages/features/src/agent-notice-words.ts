/**
 * agent-notice-words.ts -- what the quiet notices an agent's transcript keeps between its stretches of work say: compacted, a new session, moved, and the connection lost.
 *
 * The panel's lines (`@repo/ui`'s `session-line.tsx` and
 * `connection-lost-notice.tsx`) and the iOS app's transcript both say them
 * through this, so a notice reads the same wherever it is drawn.
 */
import type { AgentMovedMark, CompactedNotice, ConnectionLostNotice } from "@repo/wire/ui-messages";
import { isThisMac, THIS_MAC, type ThisMac } from "./machine-name.js";
import { dueText } from "./time-format.js";

/** A token count as a compaction's line says it: "148K". */
const TOKENS = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 0 });

/** What the line where the agent's harness was started on a fresh session says. */
export const NEW_SESSION_WORDS = "New session. The agent no longer has the messages above.";

/** What the line where the harness compacted its session says, with the tokens it held before where the harness counted them. */
export function compactedWords(notice: CompactedNotice): string {
  return notice.tokensBefore === null
    ? "Compacted the conversation"
    : `Compacted the conversation from ${TOKENS.format(notice.tokensBefore)} tokens`;
}

/** Where the agent moved to, as the reader's machines call it: This Mac where it is the one the window runs on, else the name it had as the agent moved, else "a Mac"; none for the cloud. */
export function movedTo(mark: AgentMovedMark, thisMac: ThisMac): string | undefined {
  const { deviceId, name } = mark.to;

  if (deviceId === undefined) return undefined;

  return isThisMac({ deviceId, name: name ?? "" }, thisMac) ? THIS_MAC : (name ?? "a Mac");
}

/** What the line where the agent moved says, naming where it runs now (`movedTo`), the cloud where that names none. */
export function movedWords(to: string | undefined): string {
  return `Moved to ${to ?? "the cloud"}`;
}

/** What the notice where the agent lost the connection to its model's provider heads with. */
export function connectionLostWords(notice: ConnectionLostNotice): string {
  return `Lost the connection to ${notice.provider}`;
}

/** What the notice says under the loss: that the agent waits, or when the host answered again. */
export function connectionLostCaption(
  notice: ConnectionLostNotice,
  now: number = Date.now(),
): string {
  if (notice.restoredAt === null) return "Carries on when it's back";
  // Note that a restore in the future reads as now: the clocks differ, not the order of events.

  return notice.restoredAt > now ? "Back now" : `Back at ${dueText(notice.restoredAt, now)}`;
}
