import assert from "node:assert/strict";
import { test } from "vitest";
import { CHAPTER_KIND, CHAPTER_RISK, type Chapter } from "./pull-request-chapters.js";
import {
  CHAPTERS_SHOWN,
  chaptersModelLabel,
  chaptersShown,
} from "./pull-request-chapters-shown.js";
import {
  PULL_REQUEST_CHAPTERS_CALL_FAILURE,
  type PullRequestChaptersAnswerView,
} from "./pull-request-chapters-view.js";
import {
  PULL_REQUEST_CHAPTERS_FAILURE_KIND,
  PULL_REQUEST_CHAPTERS_STATE,
  type PullRequestChaptersState,
} from "./pull-request-chapters-wire.js";

/**
 * pull-request-chapters-shown.test.ts -- the Chapters view draws one state at
 * a time from its read and its own Generate, chapters made for an older head
 * as stale, "Other changes" last, and a model by its label. Synthetic
 * chapters only.
 */

const HEAD = "b".repeat(40);
const OLDER = "a".repeat(40);
const BASE = "c".repeat(40);

/** A chapter of the story holding the hunks named. */
function chapter(title: string, hunkRefs: Chapter["hunkRefs"]): Chapter {
  return {
    kind: CHAPTER_KIND.STORY,
    title,
    summary: "",
    hunkRefs,
    keyChanges: [],
    risk: CHAPTER_RISK.LOW,
    riskReasons: [],
  };
}

const FIRST = chapter("Read the store", [{ path: "src/store.ts", oldStart: 1 }]);
const SECOND = chapter("Write the store", [{ path: "src/store.ts", oldStart: 10 }]);

const OTHER: Chapter = {
  ...chapter("Other changes", [{ path: "pnpm-lock.yaml", oldStart: 3 }]),
  kind: CHAPTER_KIND.OTHER,
  risk: null,
};

/** A read answering the pull request's newest chapters as given. */
function answering(
  chapters: PullRequestChaptersState,
  generatable = true,
): PullRequestChaptersAnswerView {
  return { pullRequest: { number: 42, generatable, chapters } };
}

/** Ready chapters made for `headSha`. */
function ready(headSha: string, chapters: readonly Chapter[]): PullRequestChaptersState {
  return {
    status: PULL_REQUEST_CHAPTERS_STATE.READY,
    headSha,
    baseSha: BASE,
    model: "claude",
    chapters,
  };
}

test("the view waits on its first read, and draws a read that failed as failed", () => {
  const failed = { failure: PULL_REQUEST_CHAPTERS_CALL_FAILURE.GITHUB_UNANSWERED } as const;

  assert.equal(chaptersShown(undefined, undefined).kind, CHAPTERS_SHOWN.READING);
  assert.deepEqual(chaptersShown(failed, undefined), {
    kind: CHAPTERS_SHOWN.FAILED,
    failure: PULL_REQUEST_CHAPTERS_CALL_FAILURE.GITHUB_UNANSWERED,
  });
});

test("no pull request, no chapters yet, chapters being made, and a generation that failed are each their own state", () => {
  assert.equal(
    chaptersShown({ pullRequest: null }, undefined).kind,
    CHAPTERS_SHOWN.NO_PULL_REQUEST,
  );
  assert.deepEqual(
    chaptersShown(answering({ status: PULL_REQUEST_CHAPTERS_STATE.NONE }, false), undefined),
    { kind: CHAPTERS_SHOWN.NONE, generatable: false, runsOn: undefined, runsOnChoices: undefined },
  );
  assert.deepEqual(
    chaptersShown(
      answering({
        status: PULL_REQUEST_CHAPTERS_STATE.GENERATING,
        headSha: HEAD,
        baseSha: BASE,
        startedAt: 5_000,
      }),
      undefined,
    ),
    { kind: CHAPTERS_SHOWN.GENERATING, startedAt: 5_000, ours: false },
  );
  assert.deepEqual(
    chaptersShown(
      answering({
        status: PULL_REQUEST_CHAPTERS_STATE.FAILED,
        headSha: HEAD,
        baseSha: BASE,
        failureKind: PULL_REQUEST_CHAPTERS_FAILURE_KIND.TOO_LARGE,
      }),
      undefined,
    ),
    {
      kind: CHAPTERS_SHOWN.GENERATION_FAILED,
      failureKind: PULL_REQUEST_CHAPTERS_FAILURE_KIND.TOO_LARGE,
      generatable: true,
    },
  );
});

test("this window's own Generate stands over whatever the read last said, timed from its press", () => {
  const shown = chaptersShown(answering(ready(OLDER, [FIRST])), 9_000);

  assert.deepEqual(shown, { kind: CHAPTERS_SHOWN.GENERATING, startedAt: 9_000, ours: true });
});

test("chapters made for an older head than the tab holds are stale, those for the head now are not, and Other changes is read last wherever it was put", () => {
  const now = { pullRequest: HEAD, files: HEAD };
  const current = chaptersShown(answering(ready(HEAD, [OTHER, FIRST, SECOND])), undefined, now);
  const older = chaptersShown(answering(ready(OLDER, [FIRST])), undefined, now);

  assert.equal(current.kind, CHAPTERS_SHOWN.READY);
  assert.equal(older.kind, CHAPTERS_SHOWN.READY);

  if (current.kind !== CHAPTERS_SHOWN.READY || older.kind !== CHAPTERS_SHOWN.READY) return;
  assert.equal(current.stale, false);
  assert.equal(older.stale, true);
  assert.deepEqual(
    current.chapters.map((each) => each.title),
    ["Read the store", "Write the store", "Other changes"],
  );
});

test("chapters are stale where the files drawn are of another push than they were made for, or name no head, whatever the pull request's head", () => {
  const stale = (files: string | undefined) => {
    const shown = chaptersShown(answering(ready(HEAD, [FIRST])), undefined, {
      pullRequest: undefined,
      files,
    });

    return shown.kind === CHAPTERS_SHOWN.READY && shown.stale;
  };

  assert.equal(stale("c".repeat(40)), true);
  assert.equal(stale(undefined), true);
});

test("the model that told the chapters reads as its label where Settings offers it, else as its id", () => {
  assert.equal(chaptersModelLabel("claude-haiku-5-5"), "Haiku 5.5");
  assert.equal(chaptersModelLabel("claude-3-opus"), "claude-3-opus");
  assert.equal(chaptersModelLabel("toString"), "toString");
});
