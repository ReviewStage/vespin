import { describe, expect, it } from "vitest";
import { commentRowLines } from "./description-comment-model.js";
import {
  DESCRIPTION_COMMENT_ACTOR,
  DESCRIPTION_COMMENT_ENTRY,
  DESCRIPTION_COMMENT_SCOPE,
  DESCRIPTION_COMMENT_STATUS,
  type DescriptionCommentEntry,
  type DescriptionCommentThread,
} from "./description-comment-wire.js";

const ADA = { userId: "user-ada", name: "Ada Lovelace" };

function entry(
  id: number,
  kind: DescriptionCommentEntry["kind"],
  words?: string,
): DescriptionCommentEntry {
  return {
    id: `00000000-0000-4000-8000-${String(id).padStart(12, "0")}`,
    kind,
    writer: { actor: DESCRIPTION_COMMENT_ACTOR.MEMBER, by: ADA },
    ...(words === undefined ? undefined : { words }),
    at: id,
  };
}

function thread(entries: readonly DescriptionCommentEntry[]): DescriptionCommentThread {
  return {
    id: "00000000-0000-4000-8000-000000000100",
    scope: DESCRIPTION_COMMENT_SCOPE.WORDS,
    quote: "Invites expire after seven days.",
    anchor: { from: 0, to: 32 },
    section: "",
    status: DESCRIPTION_COMMENT_STATUS.OPEN,
    entries,
    createdAt: 1,
    updatedAt: 5,
    revision: 1,
  };
}

describe("commentRowLines", () => {
  it("says the first comment's Markdown as plain words, a mention by its name and a file by its name, and counts the replies but not the lines of what happened", () => {
    const lines = commentRowLines(
      thread([
        entry(
          1,
          DESCRIPTION_COMMENT_ENTRY.COMMENT,
          "Can we **resend** it? [@Grace Hopper](https://vespin.dev/personal/person/user-grace) asked, see [Picture 1].",
        ),
        entry(2, DESCRIPTION_COMMENT_ENTRY.COMMENT, "Yes."),
        entry(3, DESCRIPTION_COMMENT_ENTRY.RESOLVED),
        entry(4, DESCRIPTION_COMMENT_ENTRY.REOPENED),
        entry(5, DESCRIPTION_COMMENT_ENTRY.COMMENT, "Reopened to add Resend."),
      ]),
    );

    expect(lines.first?.at).toBe(1);
    expect(lines.preview).toBe("Can we resend it? Grace Hopper asked, see Picture 1.");
    expect(lines.replies).toBe(2);
  });

  it("stands the thread's quote for the words where its first comment says nothing", () => {
    const lines = commentRowLines(thread([entry(1, DESCRIPTION_COMMENT_ENTRY.COMMENT, "")]));

    expect(lines.preview).toBe("Invites expire after seven days.");
  });
});
