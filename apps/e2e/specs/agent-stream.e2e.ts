// agent-stream.e2e.ts -- a member starts an agent on a task and watches its scripted turn stream into the transcript and end.

import { expect, test } from "../support/signed-in.js";

const TASK_NAME = "Stream a turn";

test.use({ memberAsk: { taskName: TASK_NAME, credential: true, setupFinished: true } });

/**
 * The regression this catches: Start, the turn it runs, or the live
 * delivery of that turn's events to the panel broken anywhere end to end,
 * so a started agent shows nothing, or shows its words only once the turn
 * is over. The member opens the seeded task from the list, writes a Start
 * prompt holding the stream script's cue (`[script:stream]`,
 * `scripted-agent-sessions.ts`), and sends it. The script plays two
 * sentences, a `Read` call, and two more, a beat apart, all of it written
 * by the service, so none of it is the page's own copy of the Start. Its
 * first sentence standing beside the reply's "Working…" says the turn
 * reached the panel while it ran; "Worked for" in its place says the turn
 * ended. The seeded credential is a placeholder Anthropic key, which lets
 * Start pass for the composer's default Claude model.
 */
test("a member starts an agent and watches its turn stream in and end", async ({
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
    .fill("Look around. [script:stream]");
  await start.getByRole("button", { name: "Send", exact: true }).click();

  const reply = page
    .getByRole("log")
    .getByRole("listitem")
    .filter({ hasText: "Reading the repository first." });

  // The first sentence beside the turn's "Working…" is the stream reaching the panel before the turn's end.
  await expect(reply).toContainText("Working…");

  await expect(reply.getByText(/^Worked for /)).toBeVisible();
  await expect(reply.getByRole("group").filter({ hasText: "Read README.md" })).toBeVisible();
  await expect(reply).toContainText(
    "Reading the repository first. The README says where to start.",
  );
  await expect(reply).toContainText(
    "The README is short. Nothing here needs changing, so I am done.",
  );
  await expect(
    page.getByRole("tablist", { name: "Agents" }).getByRole("tab", { selected: true }),
  ).not.toHaveAccessibleName(/^Working\b/);
});
