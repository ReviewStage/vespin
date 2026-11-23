// inbox-answer.e2e.ts -- a member answers the agent's ask from the Inbox and the agent's next turn hears it.

import { expect, test } from "../support/signed-in.js";

const TASK_NAME = "Pick a color";

/** The ask the ask script (`[script:ask]`, `scripted-agent-sessions.ts`) posts, and the turn it plays once answered. */
const ASK = {
  TITLE: "Which color should the button be?",
  HEARD: "Thanks for the answer. I will go on with it.",
} as const;

test.use({ memberAsk: { taskName: TASK_NAME, credential: true, setupFinished: true } });

/**
 * The regression this catches: an agent's thread that never reaches the
 * member's Inbox, or an answer given there that is never routed back to
 * the agent, so it waits on it for good. The member starts an agent on a
 * prompt holding the ask script's cue; its first turn posts a decide ask
 * with Blue and Green to them and ends. They go to the Inbox from the
 * sidebar, find the thread by its question, choose Blue, and send it.
 * Then they follow the item's path to the agent, where the script's
 * second turn stands. Only the scripted session writes that turn, and it
 * plays it only on the message the answer hands the agent, so its words
 * in the transcript say the answer reached it.
 */
test("a member answers the agent's ask from the Inbox and the agent goes on", async ({
  page,
  signedIn,
}) => {
  expect(signedIn.taskId).toBeDefined();

  await page.goto("/app");
  await page
    .getByRole("navigation", { name: "My tasks" })
    .getByRole("button", { name: new RegExp(`^${TASK_NAME}\\b`) })
    .click();

  const start = page.getByRole("region", { name: "New agent" });
  await start
    .getByRole("textbox", { name: "Message to the agent" })
    .fill("Pick the button's color. [script:ask]");
  await start.getByRole("button", { name: "Send", exact: true }).click();

  const transcript = page.getByRole("log");

  // The ask's turn ended is the thread posted, so the Inbox can be read for it.
  await expect(
    transcript.getByRole("listitem").filter({ hasText: "I need one decision before I go on." }),
  ).toContainText("Worked for");

  await page
    .getByRole("complementary")
    .getByRole("button", { name: /^Inbox\b/ })
    .click();
  await page
    .getByRole("navigation", { name: /^Inbox items\b/ })
    .getByRole("button", { name: new RegExp(`${TASK_NAME}.*Which color should the button be\\?`) })
    .click();

  const item = page.getByRole("region", { name: ASK.TITLE });
  await expect(item.getByRole("heading", { level: 2 })).toHaveText(ASK.TITLE);
  await item.getByRole("button", { name: "Blue", exact: true }).click();
  await item.getByRole("button", { name: "Send", exact: true }).click();

  await item
    .getByRole("navigation", { name: "Path" })
    .getByRole("button", { name: "Opus 5.5" })
    .click();
  await expect(transcript.getByRole("listitem").filter({ hasText: ASK.HEARD })).toContainText(
    "Worked for",
  );
});
