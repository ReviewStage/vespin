// queue-edit-model.ts -- an edit of a queued message as a box holds one, the panel's and the iOS app's alike: what the box keeps aside while it holds the message's words, the change its Save or Steer sends, and whether the message left the queue under it.

import {
  type AgentAttachment,
  type AgentQueueChange,
  hasWordsOrFiles,
  QUEUE_CHANGE,
} from "./agent-wire.js";

/** What a box holds: its words and the files beside them. */
export interface QueueEditHeld {
  readonly text: string;
  readonly attachments: readonly AgentAttachment[];
}

/** The box's own words and files, kept aside while it holds the words of the queued message `id` names. */
export interface QueueEditStash extends QueueEditHeld {
  readonly id: string;
}

/** How an edit goes once its words are written: saved back into the message's place, or sent now as that message. */
export const QUEUE_EDIT_SEND = {
  SAVE: QUEUE_CHANGE.EDIT,
  STEER: QUEUE_CHANGE.STEER,
} as const;

export type QueueEditSend = (typeof QUEUE_EDIT_SEND)[keyof typeof QUEUE_EDIT_SEND];

/**
 * What a box keeps aside as it takes the message `messageId` names to edit:
 * what it held, or, where an edit already stands, what that edit kept, so
 * a second edit never keeps the first message's words as the box's own.
 */
export function queueEditStash(
  standing: QueueEditStash | undefined,
  messageId: string,
  held: QueueEditHeld,
): QueueEditStash {
  return { ...(standing ?? held), id: messageId };
}

/** The change an edit's Save or Steer sends with what the box holds; none where the box was emptied, which gives the edit up. */
export function queueEditChange(
  way: QueueEditSend,
  messageId: string,
  held: QueueEditHeld,
): AgentQueueChange | undefined {
  const text = held.text.trim();
  const { attachments } = held;

  if (!hasWordsOrFiles(text, attachments)) return undefined;

  return {
    change: way,
    messageId,
    text,
    ...(attachments.length === 0 ? undefined : { attachments }),
  };
}

/**
 * Whether the message an edit stands on left the queue under it, sent or
 * deleted from another window, which closes the edit with its words left in
 * the box: once the queue listed it since the edit opened, it lists it no
 * more, and it is not the box's own Save or Steer settling it.
 */
export function queueEditLeft(
  stash: QueueEditStash | undefined,
  seen: boolean,
  listed: boolean,
  settling: string | undefined,
): boolean {
  return stash !== undefined && seen && !listed && settling !== stash.id;
}
