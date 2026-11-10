/**
 * refused-send.ts -- a refused send's words and files put back into the box it left, ahead of whatever the box holds since.
 *
 * A box lets go of what it sends as it is pressed, so the next message can
 * be written while one is out. One refused comes back ahead of what the box
 * holds by then: its words first, then those written since, and its files
 * before theirs, so nothing either holds is lost, as a reply on an Inbox
 * thread does (`use-task-inbox.ts`'s `withRefused`). Where the two together
 * would pass the box's word bound or what a message's files may hold
 * (`AGENT_BOUNDS`), the box is left as it stands, because an editor laying in
 * words past its bound keeps none of them, and the send is kept on a toast
 * that stands until dismissed, whose Put back tries again once room is made.
 */

import { AGENT_BOUNDS, type AgentAttachment, base64Bytes } from "@repo/features/agent-wire";
import { STATUS_TONE } from "@repo/ui";
import { showToast } from "../toast.js";

/** What the toast keeping a send that did not fit back says. */
const NO_ROOM = {
  WORDS: "Your unsent message didn't fit back in the box",
  DETAIL: "Make room, then put it back ahead of what you wrote since.",
  PUT_BACK: "Put back",
} as const;

/** The words and files a box holds. */
export interface BoxHeld {
  readonly text: string;
  readonly attachments: readonly AgentAttachment[];
}

/**
 * Moves a box's words and files on from what its draft holds as the change
 * lands, leaving them as they stand where `next` answers none. Note that it
 * reads the draft where it is kept, never a render's copy of it, because a
 * send answered after its box was let go of, or a Put back pressed later,
 * must not write over words written since in a box drawn afresh.
 */
export type HeldUpdate = (next: (now: BoxHeld) => BoxHeld | undefined) => void;

/** A send refused after the box let go of it: what went, the box's word bound, and how the box is changed. */
export interface RefusedSend {
  readonly went: BoxHeld;
  /** The most characters the box's words may spell. */
  readonly most: number;
  readonly update: HeldUpdate;
}

/** Whether files fit one message: no more than its count, and their bytes together no more than its bound. */
function filesFit(files: readonly AgentAttachment[]): boolean {
  const bytes = files.reduce((sum, file) => sum + base64Bytes(file.data), 0);
  return (
    files.length <= AGENT_BOUNDS.MAX_ATTACHMENTS && bytes <= AGENT_BOUNDS.MAX_ATTACHMENTS_BYTES
  );
}

/** The words and files that went, then those after them, as one box holds them. */
export function joinedAhead(went: BoxHeld, after: BoxHeld): BoxHeld {
  return {
    text: [went.text, after.text].filter((words) => words !== "").join("\n"),
    attachments: [...went.attachments, ...after.attachments],
  };
}

/** The words and files that went ahead of those the box holds now; none where together they would not fit it. */
function heldAhead(went: BoxHeld, now: BoxHeld, most: number): BoxHeld | undefined {
  const joined = joinedAhead(went, now);
  return joined.text.length <= most && filesFit(joined.attachments) ? joined : undefined;
}

/**
 * Puts a refused send back into its box ahead of what the box holds, or,
 * where the two would not fit together, keeps it on a toast whose Put back
 * tries again from what the box holds then.
 */
export function putBackRefused(refused: RefusedSend): void {
  let laid = false;
  refused.update((now) => {
    const joined = heldAhead(refused.went, now, refused.most);
    laid = joined !== undefined;
    return joined;
  });
  if (laid) return;
  showToast({
    replayUnmasked: true,
    words: NO_ROOM.WORDS,
    detail: NO_ROOM.DETAIL,
    tone: STATUS_TONE.ATTENTION,
    persists: true,
    action: {
      label: NO_ROOM.PUT_BACK,
      replayUnmasked: true,
      onPress: () => putBackRefused(refused),
    },
  });
}
