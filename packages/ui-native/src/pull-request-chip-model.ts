// pull-request-chip-model.ts -- an agent's pull request as its capsule over the composer says it: its mark for where it stands, its number, its state's word where that matters, and how its checks went, as the panel's row pinned over the box says them.

import { type AgentPullRequest, PULL_REQUEST_STATE } from "@repo/features/agent-wire";
import {
  CHECK_SUMMARY_WORDS,
  pullRequestMarkLabel,
  pullRequestMarkState,
} from "@repo/features/pull-request-model";
import type { Glyph, MarkLook } from "./glyph.js";
import { PULL_REQUEST_LOOK } from "./inbox-line-model.js";
import { CHECK_SUMMARY_LOOK } from "./pull-request-look.js";
import type { StatusTone } from "./tokens/status-tone.js";

/** What a pull request's capsule is drawn from: its number, where it stands, whether the merge queue holds it, and how its checks went. */
export type PullRequestChipFacts = Pick<AgentPullRequest, "number" | "state" | "checks" | "queued">;

/** What the capsule draws and says: its leading mark, its words, the checks' mark after them, and its words for VoiceOver. */
export interface PullRequestChipLook {
  readonly glyph: Glyph;
  readonly tone: StatusTone;
  readonly words: string;
  /** How its checks went; none once it merged or closed, or where none ran. */
  readonly after: MarkLook | undefined;
  readonly heard: string;
}

/**
 * A pull request's capsule, live with what the app holds of it: GitHub's
 * glyph for where it stands in GitHub's color (`PULL_REQUEST_LOOK`), so an
 * open one reads green, a draft muted, merged purple, closed red, and one
 * the merge queue holds as the merge's glyph in the attention ink; its
 * number, and its state's word only where that changes what the reader
 * would do (Draft, Queued, Merged, Closed), as the panel's row says it;
 * then its checks' glyph, as the pull request's page draws them (running,
 * passed, failed), while it is still open and its checks still matter.
 * Note that VoiceOver hears all of it in words, so the colors never say
 * anything alone.
 */
export function pullRequestChipLook(pullRequest: PullRequestChipFacts): PullRequestChipLook {
  const mark = pullRequestMarkState(pullRequest);
  const look = PULL_REQUEST_LOOK[mark];
  const standing = pullRequestMarkLabel(pullRequest);
  const number = `#${pullRequest.number}`;

  const settled =
    pullRequest.state === PULL_REQUEST_STATE.MERGED ||
    pullRequest.state === PULL_REQUEST_STATE.CLOSED;

  const after = settled ? undefined : CHECK_SUMMARY_LOOK[pullRequest.checks];

  const heardChecks =
    after === undefined ? "" : `, checks ${CHECK_SUMMARY_WORDS[pullRequest.checks]}`;

  return {
    glyph: look.symbol,
    tone: look.tone,
    words: mark === PULL_REQUEST_STATE.OPEN ? number : `${number} · ${standing}`,
    after,
    heard: `Pull request ${number}, ${standing.toLowerCase()}${heardChecks}`,
  };
}
