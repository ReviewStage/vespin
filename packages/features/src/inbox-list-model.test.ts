import { describe, expect, it } from "vitest";
import { inboxAttachmentAddress } from "./inbox-attachment-link.js";
import { INBOX_MEDIA, inboxThreadMessages } from "./inbox-list-model.js";
import {
  INBOX_MESSAGE_AUTHOR,
  INBOX_STATUS,
  INBOX_WIRE_VERSION,
  type InboxItem,
} from "./inbox-wire.js";
import { LINK_PLACE } from "./link-grammar.js";

/**
 * inbox-list-model.test.ts -- a thread's message as a client draws it: what
 * its words name in place is drawn there as what it is, a recording as a
 * video, and only what they do not name stands after them.
 */

const ITEM = "0b6e2f1a-3c4d-4e5f-8a9b-1c2d3e4f5a60";
const PLAN = "1c7f3a2b-4d5e-4f60-9b0c-2d3e4f5a6b71";
const STILL = "2d804b3c-5e6f-4071-8c1d-3e4f5a6b7c82";
const CLIP = "3e915c4d-6f70-4182-9d2e-4f5a6b7c8d93";
const SHOT = "4fa26d5e-7081-4293-8e3f-5a6b7c8d9ea4";
const MOVIE = "50b37e6f-8192-43a4-9f40-6b7c8d9eafb5";

/** One of the item's files' addresses, as an agent's post names it in its words. */
function address(attachmentId: string): string {
  return inboxAttachmentAddress(
    { kind: LINK_PLACE.INBOX_ITEM, planId: PLAN, itemId: ITEM },
    attachmentId,
    "acme",
  );
}

describe("inboxThreadMessages", () => {
  it("plays a recording its words name where they name it, a WebM or an MP4, and draws after them only what they leave unnamed", () => {
    const item: InboxItem = {
      id: ITEM,
      agentId: "agent-1",
      key: "recording",
      revision: 1,
      version: INBOX_WIRE_VERSION,
      title: "Recorded the flow",
      needsReply: false,
      status: INBOX_STATUS.OPEN,
      thread: [
        {
          id: "message-1",
          author: INBOX_MESSAGE_AUTHOR.AGENT,
          text: `The page:\n\n![The page](${address(STILL)})\n\nThe flow:\n\n![The flow](${address(CLIP)})\n\n![The export](${address(MOVIE)})`,
          files: [
            { attachmentId: STILL, name: "page.png", mediaType: "image/png" },
            { attachmentId: CLIP, name: "flow.webm", mediaType: "video/webm" },
            { attachmentId: SHOT, name: "after.png", mediaType: "image/png" },
            { attachmentId: MOVIE, name: "export.mp4", mediaType: "video/mp4" },
          ],
          createdAt: 1_000,
        },
      ],
      postedAt: 1_000,
      updatedAt: 1_000,
    };

    const [message] = inboxThreadMessages(item, "Agent", undefined);

    expect(message?.drawn).toEqual([
      { kind: INBOX_MEDIA.PICTURE, attachmentId: STILL },
      { kind: INBOX_MEDIA.VIDEO, attachmentId: CLIP },
      { kind: INBOX_MEDIA.VIDEO, attachmentId: MOVIE },
    ]);
    expect(message?.media.map(({ kind, attachmentId }) => ({ kind, attachmentId }))).toEqual([
      { kind: INBOX_MEDIA.PICTURE, attachmentId: SHOT },
    ]);
  });
});
