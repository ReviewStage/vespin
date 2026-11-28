import {
  DESCRIPTION_COMMENT_ACTION,
  DESCRIPTION_COMMENT_SCOPE,
  DESCRIPTION_COMMENT_STATUS,
} from "@repo/features/description-comment-wire";
import { LIVE_READ } from "@repo/features/live-wire";
import { COMMENT_SUBJECT, IDLE_TASKS_VIEW, NO_TASK_LIST } from "@repo/features/tasks-view";
import { expect, test } from "vitest";
import { ACT_KIND } from "./acts.js";
import type { AppStateSnapshot } from "./app-state.js";
import { initialAppState } from "./client/app-state-store.js";
import { chosenTasksView, inboxActAnswer, inboxAppState, inboxTasksView } from "./fixture-inbox.js";
import { FIXTURE_IDS } from "./fixture-stage.js";
import { runModeFor } from "./run-mode.js";

/** The profile the iOS flows launch on, which stages the invites task's comments. */
const PROFILE = "inbox";

/** The id a window mints for the thread it starts. */
const STARTED = "4f1c2b3a-5d6e-4f70-8a9b-0c1d2e3f4a5b";

/** The invites task's comment threads as `state` lays them. */
function threadsOf(state: AppStateSnapshot) {
  return (
    state[LIVE_READ.DESCRIPTION_COMMENTS][COMMENT_SUBJECT.DESCRIPTION][FIXTURE_IDS.TASK]?.rows ?? []
  );
}

test("a thread the run starts, and a staged one it resolves, stand on the comments laid again after each", () => {
  const launched: AppStateSnapshot = {
    ...initialAppState(
      {
        launch: { profile: PROFILE, captureMode: false, fixtureMode: true },
        runMode: runModeFor({ capture: false, fixture: true }),
        appVersion: "1.2.3",
        packaged: true,
        platform: "ios",
      },
      false,
      [],
    ),
    version: 1,
    window: { fullScreen: false },
  };

  const staged = inboxAppState(launched, []);

  const open = threadsOf(staged).find(
    (thread) => thread.status === DESCRIPTION_COMMENT_STATUS.OPEN,
  );

  expect(open).toBeDefined();

  // Note that each write is answered before the act reaches the host, and the run is then laid again over the document it already laid, as the iOS fixture stages it.
  inboxActAnswer(PROFILE, ACT_KIND.TASKS_COMMENT_START, {
    taskId: FIXTURE_IDS.TASK,
    start: {
      id: STARTED,
      clientKey: STARTED,
      scope: DESCRIPTION_COMMENT_SCOPE.BLOCK,
      quote: "Goal",
      anchor: { from: 0, to: 4 },
      text: "Goal",
      words: "Should this name the expiry?",
      attachments: [],
    },
  });

  const started = inboxAppState(staged, []);

  expect(threadsOf(started).find((thread) => thread.id === STARTED)?.entries[0]).toMatchObject({
    words: "Should this name the expiry?",
  });

  inboxActAnswer(PROFILE, ACT_KIND.TASKS_COMMENT_ACT, {
    taskId: FIXTURE_IDS.TASK,
    threadId: open?.id ?? "",
    action: { action: DESCRIPTION_COMMENT_ACTION.RESOLVE },
  });

  const resolved = threadsOf(inboxAppState(started, []));

  expect(resolved.find((thread) => thread.id === open?.id)?.status).toBe(
    DESCRIPTION_COMMENT_STATUS.RESOLVED,
  );
  expect(resolved.some((thread) => thread.id === STARTED)).toBe(true);
});

test("a Manager the run pins stands among the reader's pins, as the service keeps a pin on no task", () => {
  const staged = inboxTasksView(PROFILE, { ...IDLE_TASKS_VIEW, ...NO_TASK_LIST });
  const release = staged.taskAgents?.find((agent) => agent.title === "Release manager");

  expect(release?.taskId).toBeNull();

  const pinned = chosenTasksView(staged, new Map([[release?.id ?? "", { pinned: true }]]));

  expect(pinned.taskAgentPins?.some((pin) => pin.agentId === release?.id)).toBe(true);
});
