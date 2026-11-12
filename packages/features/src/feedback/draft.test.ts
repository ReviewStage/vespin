import { describe, expect, it } from "vitest";
import { draftSubmission } from "./draft.js";
import { FEEDBACK_KIND } from "./submission.js";

const SIGNATURE = { name: "Ada Lovelace", email: "ada@example.com" };

describe("draftSubmission", () => {
  it.each([
    [
      "carries the signature while it is ticked",
      true,
      {
        kind: "feedback",
        message: "Send sticks",
        name: "Ada Lovelace",
        email: "ada@example.com",
        images: [],
      },
    ],
    [
      "carries no name or email once it is unticked",
      false,
      { kind: "feedback", message: "Send sticks", images: [] },
    ],
  ])("%s", (_case, signed, sent) => {
    const draft = { message: "  Send sticks \n", images: [], signed };

    expect(draftSubmission(FEEDBACK_KIND.FEEDBACK, draft, SIGNATURE)).toEqual(sent);
  });
});
