import { describe, expect, it } from "vitest";
import { followersView } from "./task-followers-model.js";

const ADA = { userId: "user-ada", assignee: false, machines: false };
const MANUEL = { userId: "user-manuel", assignee: true, machines: true };
const CHARLES = { userId: "user-charles", assignee: false, machines: false };

describe("followersView", () => {
  it.each([
    {
      when: "the reader follows, behind others",
      readerId: ADA.userId,
      ids: [ADA.userId, MANUEL.userId, CHARLES.userId],
      chipWords: "Following",
    },
    {
      when: "the reader does not follow",
      readerId: "user-dana",
      ids: [MANUEL.userId, CHARLES.userId, ADA.userId],
      chipWords: "Follow",
    },
  ])(
    "lists the reader first, then the rest as they followed, when $when",
    ({ readerId, ids, chipWords }) => {
      const view = followersView([MANUEL, CHARLES, ADA], readerId);

      expect(view.followers.map((each) => each.userId)).toEqual(ids);
      expect(view.chipWords).toBe(chipWords);
    },
  );
});
