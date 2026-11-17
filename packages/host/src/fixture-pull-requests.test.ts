import { LIVE_READ } from "@repo/features/live-wire";
import { expect, test } from "vitest";
import type { AppStateSnapshot } from "./app-state.js";
import { initialAppState } from "./client/app-state-store.js";
import { FIXTURE_PULL_REQUEST, pullRequestPartsAppState } from "./fixture-pull-requests.js";
import { FIXTURE_IDS } from "./fixture-stage.js";
import { runModeFor } from "./run-mode.js";

/** The repository the invitations agent works in, whose pull requests the fixture lays. */
const REPOSITORY = "ada/relay";

test("each part is laid as its own read where the launch holds every part as one empty slice", () => {
  // Note that a launch begins every pull request part on the one shared empty slice.
  const launched: AppStateSnapshot = {
    ...initialAppState(
      {
        launch: { profile: "inbox", captureMode: false, fixtureMode: true },
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

  const staged = pullRequestPartsAppState(launched, new Map());
  const ready = String(FIXTURE_PULL_REQUEST.READY);

  const conversation =
    staged[LIVE_READ.REPOSITORY_PULL_REQUEST_CONVERSATION][FIXTURE_IDS.WORKSPACE]?.[REPOSITORY]?.[
      ready
    ]?.rows;

  const checks =
    staged[LIVE_READ.REPOSITORY_PULL_REQUEST_CHECKS][FIXTURE_IDS.WORKSPACE]?.[REPOSITORY]?.[ready]
      ?.rows;

  expect(conversation).toMatchObject({ pullRequest: { earlier: 0 } });
  expect(conversation).toHaveProperty("pullRequest.conversation.length", 3);
  expect(checks).toHaveProperty("pullRequest.checks");
});
