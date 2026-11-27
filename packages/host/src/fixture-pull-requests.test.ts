import { LIVE_READ } from "@repo/features/live-wire";
import { expect, test } from "vitest";
import type { AppStateSnapshot } from "./app-state.js";
import { initialAppState } from "./client/app-state-store.js";
import {
  FIXTURE_PULL_REQUEST,
  fixtureGeneratedChapters,
  pullRequestPartsAppState,
} from "./fixture-pull-requests.js";
import { FIXTURE_IDS } from "./fixture-stage.js";
import { runModeFor } from "./run-mode.js";

/** The repository the invitations agent works in, whose pull requests the fixture lays. */
const REPOSITORY = "ada/relay";

/** The document as an Inbox fixture run launches, every pull request part on the one shared empty slice. */
function launchedState(): AppStateSnapshot {
  return {
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
}

test("each part is laid as its own read where the launch holds every part as one empty slice", () => {
  const staged = pullRequestPartsAppState(launchedState(), new Map());
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

test("a Generate answers chapters told for the head of the pull request asked", () => {
  const failing = FIXTURE_PULL_REQUEST.FAILING;
  const staged = pullRequestPartsAppState(launchedState(), new Map());

  const laid =
    staged[LIVE_READ.REPOSITORY_PULL_REQUEST][FIXTURE_IDS.WORKSPACE]?.[REPOSITORY]?.[
      String(failing)
    ]?.rows;

  const head =
    laid !== undefined && "pullRequest" in laid ? laid.pullRequest?.merging?.headSha : undefined;

  const generated = fixtureGeneratedChapters(failing);
  const chapters = "pullRequest" in generated ? generated.pullRequest?.chapters : undefined;

  expect(head).toBeDefined();
  expect(chapters).toHaveProperty("headSha", head);
});
