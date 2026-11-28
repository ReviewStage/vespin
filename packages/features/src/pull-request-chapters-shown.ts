/**
 * pull-request-chapters-shown.ts -- a pull request's chapters as every client's Chapters view draws them: which of its states stands, whether the chapters are stale, the order they are read in, and the words each state says.
 *
 * The view draws one state at a time (`chaptersShown`): the read on its way,
 * failed, or saying there is no pull request; no chapters yet, offering
 * Generate where the member can make them; chapters being made, by this
 * window's own Generate or someone else's; a generation that failed; or the
 * chapters ready, stale where they were made for a head the pull request
 * has moved on from, or for another push than the files drawn, or for any
 * where the files name no head (`chaptersStale`). "Other changes" is always
 * read last (`orderedChapters`). The panel's Chapters tab and the iOS app's
 * Chapters page both draw from here, so they say the same.
 */

import { CHAPTERS_MODEL_LABEL, OPENAI_CHAPTERS_MODEL_LABEL } from "./chapters-model-choice.js";
import { formatCount } from "./number-format.js";
import { CHAPTER_KIND, type Chapter } from "./pull-request-chapters.js";
import type { PullRequestChaptersAnswerView } from "./pull-request-chapters-view.js";
import {
  type ChaptersRunsOn,
  PULL_REQUEST_CHAPTERS_FAILURE_KIND,
  PULL_REQUEST_CHAPTERS_STATE,
} from "./pull-request-chapters-wire.js";

/** Which of its states the Chapters view draws. */
export const CHAPTERS_SHOWN = {
  /** The read is on its way, or asked again after a failure. */
  READING: "reading",
  /** The read did not answer anything the view can draw. */
  FAILED: "failed",
  /** The agent has no pull request, or the number names none. */
  NO_PULL_REQUEST: "no-pull-request",
  /** No chapters were ever asked for this pull request. */
  NONE: "none",
  /** Chapters are being made, by this window's Generate or another's. */
  GENERATING: "generating",
  /** The newest generation was given up on. */
  GENERATION_FAILED: "generation-failed",
  /** The chapters, stale or not. */
  READY: "ready",
} as const;

type Failure = Extract<PullRequestChaptersAnswerView, { failure: unknown }>["failure"];

type Answered = Extract<PullRequestChaptersAnswerView, { pullRequest: unknown }>;

type Answer = NonNullable<Answered["pullRequest"]>;

type FailureKind = Extract<Answer["chapters"], { failureKind: unknown }>["failureKind"];

/** What the view draws, with what each state draws from. */
export type ChaptersShown =
  | { readonly kind: typeof CHAPTERS_SHOWN.READING }
  | { readonly kind: typeof CHAPTERS_SHOWN.FAILED; readonly failure: Failure }
  | { readonly kind: typeof CHAPTERS_SHOWN.NO_PULL_REQUEST }
  | {
      readonly kind: typeof CHAPTERS_SHOWN.NONE;
      readonly generatable: boolean;
      /** What the member's Generate would run on; none where the service did not say. */
      readonly runsOn: ChaptersRunsOn | undefined;
      /** Every model the member's Generate may run on, where they saved keys of two providers; none otherwise. */
      readonly runsOnChoices: readonly ChaptersRunsOn[] | undefined;
    }
  | {
      readonly kind: typeof CHAPTERS_SHOWN.GENERATING;
      readonly startedAt: number;
      /** Whether it is this window's own Generate, which answers once they land; else a read shows another's, which only a Refresh sees land. */
      readonly ours: boolean;
    }
  | {
      readonly kind: typeof CHAPTERS_SHOWN.GENERATION_FAILED;
      readonly failureKind: FailureKind;
      readonly generatable: boolean;
    }
  | {
      readonly kind: typeof CHAPTERS_SHOWN.READY;
      readonly chapters: readonly Chapter[];
      /** The provider's id of the model that told them. */
      readonly model: string;
      readonly stale: boolean;
      readonly generatable: boolean;
    };

/** Every chapters model's label, Claude's and OpenAI's alike, by its provider's id. */
const MODEL_LABELS: ReadonlyMap<string, string> = new Map([
  ...Object.entries(CHAPTERS_MODEL_LABEL),
  ...Object.entries(OPENAI_CHAPTERS_MODEL_LABEL),
]);

/** A chapters model as the view names it, one that told them or one a Generate would run on: its label where Generate offers it, else the id as stored. */
export function chaptersModelLabel(model: string): string {
  return MODEL_LABELS.get(model) ?? model;
}

/** What the Chapters view says, wherever it is drawn. */
export const CHAPTERS_WORDS = {
  /** What the view is named, as its tab and its row are. */
  CHAPTERS: "Chapters",
  READING: "Reading chapters",
  FAILED: "The chapters could not be read.",
  NO_PULL_REQUEST: "No pull request yet.",
  NO_CHAPTERS: "No chapters yet.",
  /** The Generate, naming the model it would run on where the read says, short enough that an empty state's width holds it whole. */
  generate: (runsOn: ChaptersRunsOn | undefined) =>
    runsOn === undefined
      ? "Generate chapters"
      : `Generate with ${chaptersModelLabel(runsOn.model)}`,
  GENERATING: "Generating chapters",
  REGENERATE: "Regenerate",
  REGENERATE_CHAPTERS: "Regenerate chapters",
  NOTHING: "This pull request has nothing to chapter.",
  /** Which model told the chapters, as quiet caption text. */
  credit: (model: string) => `Chapters by ${model}`,
  STALE: "New commits since these chapters",
  WHAT_TO_REVIEW: "What to review",
  RISK_REASONS: "Why",
  /** How many files a chapter holds. */
  files: (count: number) => (count === 1 ? "1 file" : `${formatCount(count)} files`),
  /** A chapter's place among them, as a reader hears it before its title. */
  place: (at: number) => `${at}. `,
} as const;

/** Why a generation failed, as the view says it. */
export const CHAPTERS_FAILURE_WORDS = {
  [PULL_REQUEST_CHAPTERS_FAILURE_KIND.TOO_LARGE]: "This pull request is too large to chapter.",
  [PULL_REQUEST_CHAPTERS_FAILURE_KIND.TIMEOUT]: "Generating chapters took too long.",
  [PULL_REQUEST_CHAPTERS_FAILURE_KIND.MODEL_REFUSED]:
    "The model declined to chapter this pull request.",
  [PULL_REQUEST_CHAPTERS_FAILURE_KIND.INVALID_ANSWER]: "The model's chapters could not be read.",
  [PULL_REQUEST_CHAPTERS_FAILURE_KIND.UNEXPECTED]: "The chapters could not be generated.",
} as const satisfies Record<
  (typeof PULL_REQUEST_CHAPTERS_FAILURE_KIND)[keyof typeof PULL_REQUEST_CHAPTERS_FAILURE_KIND],
  string
>;

/** How risky a chapter is, as GitHub-style review tools weigh it. */
export type ChapterRisk = NonNullable<Chapter["risk"]>;

/** A chapter's risk in words, as its chip and its row say it. */
export const CHAPTER_RISK_WORDS = {
  high: "High risk",
  medium: "Medium risk",
  low: "Low risk",
} as const satisfies Record<ChapterRisk, string>;

/** The heads the view's own reads hold now, each where it holds one: its pull request's, and its files'. */
export interface ChaptersHeads {
  readonly pullRequest: string | undefined;
  readonly files: string | undefined;
}

/**
 * Whether chapters cannot be drawn over the files the view holds: the files
 * are of another push than the chapters were made for, or of one no read
 * named, or the pull request has moved on past them.
 */
function chaptersStale(chapters: Answer["chapters"], heads: ChaptersHeads): boolean {
  if (chapters.status === PULL_REQUEST_CHAPTERS_STATE.NONE) return false;
  const { pullRequest, files } = heads;

  return (
    files !== chapters.headSha || (pullRequest !== undefined && pullRequest !== chapters.headSha)
  );
}

/** The chapters in reading order: the story's own as told, then "Other changes", wherever the answer put it. */
function orderedChapters(chapters: readonly Chapter[]): readonly Chapter[] {
  return [
    ...chapters.filter((chapter) => chapter.kind !== CHAPTER_KIND.OTHER),
    ...chapters.filter((chapter) => chapter.kind === CHAPTER_KIND.OTHER),
  ];
}

/**
 * What the view draws from its read as it stands, and this window's own
 * Generate where one is out, which stands over whatever the read last said
 * until it answers. A read asked again after a failure stands unread until
 * it answers, so the failure gives way to the wait.
 */
export function chaptersShown(
  answer: PullRequestChaptersAnswerView | undefined,
  /** When this window's own Generate was pressed, while it is out. */
  generating: number | undefined,
  heads: ChaptersHeads = { pullRequest: undefined, files: undefined },
): ChaptersShown {
  if (generating !== undefined) {
    return { kind: CHAPTERS_SHOWN.GENERATING, startedAt: generating, ours: true };
  }

  if (answer === undefined) return { kind: CHAPTERS_SHOWN.READING };

  if ("failure" in answer) return { kind: CHAPTERS_SHOWN.FAILED, failure: answer.failure };
  const { pullRequest } = answer;

  if (pullRequest === null) return { kind: CHAPTERS_SHOWN.NO_PULL_REQUEST };
  const { chapters, generatable } = pullRequest;

  switch (chapters.status) {
    case PULL_REQUEST_CHAPTERS_STATE.NONE:
      return {
        kind: CHAPTERS_SHOWN.NONE,
        generatable,
        runsOn: pullRequest.runsOn,
        runsOnChoices: pullRequest.runsOnChoices,
      };
    case PULL_REQUEST_CHAPTERS_STATE.GENERATING:
      return { kind: CHAPTERS_SHOWN.GENERATING, startedAt: chapters.startedAt, ours: false };
    case PULL_REQUEST_CHAPTERS_STATE.FAILED:
      return {
        kind: CHAPTERS_SHOWN.GENERATION_FAILED,
        failureKind: chapters.failureKind,
        generatable,
      };
    case PULL_REQUEST_CHAPTERS_STATE.READY:
      return {
        kind: CHAPTERS_SHOWN.READY,
        chapters: orderedChapters(chapters.chapters),
        model: chapters.model,
        stale: chaptersStale(chapters, heads),
        generatable,
      };
  }
}
