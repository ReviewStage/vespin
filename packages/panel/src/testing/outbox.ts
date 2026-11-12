/**
 * outbox.ts -- a test's host's record of the member's messages on their way, as `@repo/host`'s `agent-queue-writes.ts` keeps it: a message sent drawn at once, a refusal kept where it went, and one let go, laid on each transcript the window holds.
 *
 * The host draws a message the moment the window sends it, keeps it where it
 * went once the service refuses it, and lets it go once its row lands, once
 * it is sent again under its key, or once the member lets it go. A test's
 * host does the same here, over whatever transcript the test lays
 * (`holdTranscripts`), so a tab draws its lines as it does over the real
 * host. The record starts empty with each test's host.
 */

import type { SendingMessage } from "@repo/features/agent-view";
import type { AppTranscript } from "@repo/host/app-state";
import { MESSAGE_ROLE } from "@repo/wire";
import { sentLineId } from "@repo/wire/host-ids";
import { useSyncExternalStore } from "react";
import type { MessageSender, MessageUnsender } from "../tasks/use-agent-composer.js";

/** Each agent's messages on their way and refused, by the agent's id, in the order sent. */
const record = new Map<string, readonly SendingMessage[]>();

/** What redraws as the record moves: each transcript's holder, and each composer drawn from it. */
const listeners = new Set<() => void>();

/** No message on its way. */
const NONE: readonly SendingMessage[] = [];

/** The agent's messages as `change` leaves them, every holder told. */
function changed(
  agentId: string,
  change: (was: readonly SendingMessage[]) => readonly SendingMessage[],
): void {
  record.set(agentId, change(record.get(agentId) ?? NONE));

  for (const listener of listeners) listener();
}

/** The agent's messages without the one drawn under `id`. */
function without(id: string): (was: readonly SendingMessage[]) => readonly SendingMessage[] {
  return (was) => was.filter((message) => message.id !== id);
}

/** Lets the record go, as a test's host starts with none. */
export function resetOutbox(): void {
  record.clear();
}

/** Tells `listener` each time the record moves, until the answer is called. */
export function onOutbox(listener: () => void): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

/** The agent's messages on their way and refused. */
export function outboxOf(agentId: string): readonly SendingMessage[] {
  return record.get(agentId) ?? NONE;
}

/** The agent's messages on their way and refused, drawn again as they move. */
export function useOutbox(agentId: string): readonly SendingMessage[] {
  return useSyncExternalStore(onOutbox, () => outboxOf(agentId));
}

/**
 * A transcript as the host lays it, its agent's messages on their way after
 * its rows: those whose row has landed let go, and those refused kept.
 */
export function withOutbox(agentId: string, rows: AppTranscript): AppTranscript {
  const landed = new Set(
    rows.messages.flatMap((message) =>
      message.role === MESSAGE_ROLE.USER && message.clientId !== undefined
        ? [message.clientId]
        : [],
    ),
  );

  const { sending: _drawn, ...page } = rows;
  const sending = outboxOf(agentId).filter((message) => !landed.has(message.id));

  return sending.length === 0 ? page : { ...page, sending };
}

/**
 * Sends as `send` does, drawn in the record first as the host draws it, and
 * kept there with why where `send` answered it refused.
 */
export function outboxed(send: MessageSender): MessageSender {
  return (agentId, message) => {
    const line: SendingMessage = {
      id: sentLineId(message.clientKey),
      clientKey: message.clientKey,
      text: message.text,
      ...(message.attachments === undefined
        ? undefined
        : {
            files: message.attachments.map((file, at) => ({
              name: file.name,
              mediaType: file.mediaType,
              ...(message.pictures?.[at] === undefined ? undefined : { id: message.pictures[at] }),
            })),
          }),
      sentAt: Date.now(),
      steers: message.steers === true,
      ...(message.rewinds === undefined ? undefined : { rewinds: message.rewinds.messageId }),
      ...(message.taskId === undefined ? undefined : { taskId: message.taskId }),
    };

    changed(agentId, (was) => [...without(line.id)(was), line]);

    return send(agentId, message).then((answer) => {
      // Note that the window's own unreached answer reached no host, so only the host's refusal is kept.
      if ("failure" in answer) {
        const { cause: _cause, ...refused } = answer;
        changed(agentId, (was) => [...without(line.id)(was), { ...line, refused }]);
      }

      return answer;
    });
  };
}

/** Lets a refused message go, as the host does. */
export const unsendOutbox: MessageUnsender = (agentId, lineId) => changed(agentId, without(lineId));
