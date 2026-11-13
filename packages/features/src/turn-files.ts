/**
 * turn-files.ts -- the developer's line that opened each reply's turn, which a turn's changes are read by.
 *
 * What a turn changed is read off its row (`turn-files-wire.ts`), as its
 * runner diffed its checkout when it ended; a turn's Changes tab reads the
 * whole diff by the line that opened the turn (`agents.turnChanges`), which
 * this names for each reply.
 */

import { MESSAGE_ROLE } from "@repo/wire";
import type { AgentTranscriptMessage } from "./agent-wire.js";

/**
 * The developer's line that opened each reply's turn, by the reply's id: the
 * nearest line before the reply that opened a turn, which a line that
 * arrived inside one did not; none for a reply before any such line. The
 * turn's changes are read by that line (`agents.turnChanges`).
 */
export function turnLinesOf(
  messages: readonly AgentTranscriptMessage[],
): ReadonlyMap<string, string> {
  const lines = new Map<string, string>();
  let opened: string | undefined;

  for (const message of messages) {
    if (message.role === MESSAGE_ROLE.USER) {
      if (message.arrivedIn === undefined) opened = message.id;
      continue;
    }

    if (opened !== undefined) lines.set(message.id, opened);
  }

  return lines;
}
