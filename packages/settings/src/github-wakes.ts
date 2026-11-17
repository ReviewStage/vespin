/**
 * github-wakes.ts -- which kinds of GitHub activity on an agent's pull request the account has turned off as wakes.
 *
 * What happens on an agent's pull request reaches the agent as a message
 * from GitHub, which starts a turn (`agent-wakes.ts` in the service). Each
 * kind is on until the account turns it off in Preferences › Agents, so the
 * account stores only the kinds it turned off
 * (`APP_SETTING_SCHEMA.githubWakesOff`), as the JSON list of their ids: a
 * setting holds one plain value, and nothing stored reads as every kind on.
 *
 * Note that the stored list keeps an id this build does not know, a newer
 * build's kind, and the guard takes it, because refusing the list would
 * refuse the whole part to the older build; only the reader
 * (`githubWakesOffFrom`) passes it over.
 */

import type { UnparsedWireValue } from "@repo/wire";
import { Option, Schema } from "effect";

/** Each kind of GitHub activity that wakes an agent, by the id it is stored under, in the order Preferences lists them. */
export const GITHUB_WAKE = {
  REVIEW: "review",
  COMMENT: "comment",
  CHECK_FAILED: "check_failed",
  CHECKS_FINISHED: "checks_finished",
  DEQUEUED: "dequeued",
  /** The pull request merged, or closed without merging. */
  CLOSED: "closed",
} as const;

export type GitHubWake = (typeof GITHUB_WAKE)[keyof typeof GITHUB_WAKE];

export const GITHUB_WAKE_LIST: readonly GitHubWake[] = Object.values(GITHUB_WAKE);

/** The most ids a stored list holds, well past every kind there will be. */
const GITHUB_WAKES_OFF_MAX = 32;

/** The longest id a stored list holds, well past any kind's. */
const GITHUB_WAKE_ID_MAX_CHARS = 64;

const githubWakesOffJson = Schema.fromJsonString(
  Schema.Array(Schema.String.check(Schema.isMaxLength(GITHUB_WAKE_ID_MAX_CHARS))).check(
    Schema.isMaxLength(GITHUB_WAKES_OFF_MAX),
  ),
);

const decodeWakesOff = Schema.decodeUnknownOption(githubWakesOffJson);

const encodeWakesOff = Schema.encodeSync(githubWakesOffJson);

/** Whether `id` names a kind this build knows. */
function isGitHubWake(id: string): id is GitHubWake {
  return GITHUB_WAKE_LIST.some((wake) => wake === id);
}

/** Guards a list arriving from storage or the wire, as its JSON: any ids, this build's or a newer one's. */
export function isGitHubWakesOffJson(value: UnparsedWireValue): value is string {
  return Option.isSome(decodeWakesOff(value));
}

/** The kinds a stored list turns off that this build knows, each once; none where it holds no list. */
export function githubWakesOffFrom(value: UnparsedWireValue): readonly GitHubWake[] {
  const ids: readonly string[] = Option.getOrElse(decodeWakesOff(value), () => []);

  return [...new Set(ids.filter(isGitHubWake))];
}

/**
 * A stored list with `wake` turned on or off, as a switch writes it: the
 * ids it held, a newer build's among them, with `wake` added or taken out.
 * An empty list is still written, since it is what turns the last kind back on.
 */
export function githubWakesOffWith(
  stored: UnparsedWireValue,
  wake: GitHubWake,
  on: boolean,
): string {
  const ids: readonly string[] = Option.getOrElse(decodeWakesOff(stored), () => []);
  const held = ids.filter((id) => id !== wake);

  return encodeWakesOff(on ? held : [...held, wake].sort());
}
