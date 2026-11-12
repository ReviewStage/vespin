import { describe, expect, it } from "vitest";
import { draftSubmission } from "./draft.js";
import { FEEDBACK_KIND } from "./submission.js";

describe("draftSubmission", () => {
  it("carries no name or email once the signature is unticked", () => {
    const draft = { message: "  Send sticks \n", images: [], signed: false };
    const signature = { name: "Ada Lovelace", email: "ada@example.com" };

    expect(draftSubmission(FEEDBACK_KIND.FEEDBACK, draft, signature)).toEqual({
      kind: "feedback",
      message: "Send sticks",
      images: [],
    });
  });
});
