// agent-ask.e2e.ts -- a member answers the ask a scripted agent's turn ended on, from the agent's page, and the agent's next turn takes the answer.

import { expect, test } from "../support/signed-in.js";

const TASK_NAME = "Answer an ask";

const QUESTION = "Which color should the button be?";

test.use({ memberAsk: { taskName: TASK_NAME, credential: true, setupFinished: true } });

/**
 * The regression this catches: an agent's ask not shown on its page, its
 * options not answerable there, or the answer never reaching the agent. The
 * member starts an agent on the ask script's cue (`[script:ask]`,
 * `scripted-agent-sessions.ts`), whose turn says it needs a decision and
 * posts a decide ask with Blue and Green. The member opens the ask from the
 * agent's own Inbox dock, picks Green, and sends. Only the scripted session
 * writes "Thanks for the answer.", and only on the message the answer hands
 * it, so that turn in the transcript says the answer reached the agent.
 */
test("a member answers the agent's ask on its page and the agent's next turn takes it", async ({
  page,
  signedIn,
}) => {
  expect(signedIn.taskId).toBeDefined();

  await page.goto("/app");
  await page
    .getByRole("navigation", { name: "My tasks" })
    .getByRole("button", { name: new RegExp(`^${TASK_NAME}\\b`) })
    .click();
  await expect(page.getByRole("main").getByRole("heading", { level: 1 })).toHaveText(TASK_NAME);

  const start = page.getByRole("region", { name: "New agent" });
  await start
    .getByRole("textbox", { name: "Message to the agent" })
    .fill("Pick a color. [script:ask]");
  await start.getByRole("button", { name: "Send", exact: true }).click();

  const log = page.getByRole("log");

  const asking = log
    .getByRole("listitem")
    .filter({ hasText: "I need one decision before I go on." });

  await expect(asking.getByText(/^Worked for /)).toBeVisible();
  await expect(asking.getByRole("group").filter({ hasText: QUESTION })).toBeVisible();

  // The agent's own Inbox dock, not the sidebar's Inbox, opens the ask on the agent's page.
  await page
    .getByRole("list", { name: "Inbox" })
    .getByRole("button", { name: /needs you$/ })
    .click();

  const ask = page.getByRole("region", { name: QUESTION });
  await expect(ask).toContainText("The button can be blue or green.");
  await ask.getByRole("button", { name: "Green", exact: true }).click();
  await ask.getByRole("button", { name: "Send", exact: true }).click();

  // The ask opened over the transcript, so the transcript comes back to read the next turn.
  await page.getByRole("button", { name: "Transcript" }).click();

  const heard = log
    .getByRole("listitem")
    .filter({ hasText: "Thanks for the answer. I will go on with it." });

  await expect(heard.getByText(/^Worked for /)).toBeVisible();
});
