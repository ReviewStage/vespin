// composer-drafts.test.ts -- an agent's unsent words never outlive the account that typed them.

import { expect, it } from "vitest";
import { followDraftsAccount, keepDraft, keptDraft } from "./composer-drafts.js";

it("opens the next account's composers empty after the last account signs out", () => {
  const draft = { words: "Ship it once CI is green", laidFor: undefined };

  followDraftsAccount(true);
  keepDraft("agent-a", undefined, draft);
  keepDraft("manager-a", "thread-a", draft);

  followDraftsAccount(false);
  followDraftsAccount(true);

  expect([keptDraft("agent-a", undefined), keptDraft("manager-a", "thread-a")]).toEqual([
    undefined,
    undefined,
  ]);
});
