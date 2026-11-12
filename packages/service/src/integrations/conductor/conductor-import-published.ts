/**
 * conductor-import-published.ts -- the branch and pull request a Conductor workspace's chats name, found by pattern in their transcripts, before GitHub confirms them.
 *
 * Conductor's API answers neither, so they are read from what the chats'
 * harness did: a `git push` naming a branch, and a link to a pull request of
 * the workspace's own repository, which is also what `gh pr create`
 * answers. Every string an agent event holds is searched, its tool inputs
 * and outputs among them, so no harness's shape is parsed. The newest match
 * wins, within a chat by its order and across chats by when Conductor
 * received it. Nothing here is trusted until GitHub confirms it
 * (`conductor-import.ts`).
 */

import type { WireValue } from "@repo/wire";
import { Predicate } from "effect";
import type { ConductorMessage } from "./conductor-client.js";

/** A pull request link, `https://github.com/<owner>/<name>/pull/<number>`. */
const PULL_REQUEST_LINK = /https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)/giu;

/** A `git push` and its arguments, up to the end of the command it stands in. */
const GIT_PUSH = /\bgit\s+push\b([^\n;&|)]*)/gu;

/** The prefix a full branch ref carries. */
const HEADS_PREFIX = "refs/heads/";

/** A push that deletes a branch rather than naming one to publish. */
const DELETE_FLAGS: ReadonlySet<string> = new Set(["--delete", "-d"]);

/** A match and when Conductor received the record it stood in, as epoch milliseconds. */
interface Found<A> {
  readonly value: A;
  readonly at: number;
}

/** The newest branch and pull request number a transcript names, each where one was found. */
export interface PublishedCandidates {
  readonly branch?: Found<string>;
  readonly pullRequest?: Found<number>;
}

/** Every string a payload holds, in order; an array of strings alone also as one line, as a harness may pass a command's words apart. */
function stringsOf(value: WireValue, into: string[]): string[] {
  if (Predicate.isString(value)) {
    into.push(value);
  } else if (Array.isArray(value)) {
    if (value.length > 0 && value.every(Predicate.isString)) into.push(value.join(" "));

    for (const each of value) stringsOf(each, into);
  } else if (Predicate.isObject(value)) {
    for (const each of Object.values(value)) stringsOf(each, into);
  }

  return into;
}

/** The branch one `git push`'s arguments publish: the destination of its last refspec, where it names one past the remote. */
function pushedBranch(argumentsText: string): string | undefined {
  const words = argumentsText
    .trim()
    .split(/\s+/u)
    .map((word) => word.replace(/^["']|["']$/gu, ""))
    .filter((word) => word !== "" && !/[<>]/u.test(word));

  if (words.some((word) => DELETE_FLAGS.has(word))) return undefined;
  const [, ...refspecs] = words.filter((word) => !word.startsWith("-"));
  const last = refspecs.at(-1);

  if (last === undefined) return undefined;
  const [source = "", destination = source] = last.replace(/^\+/u, "").split(":");

  // Note that an empty source deletes the destination, and HEAD alone names no branch.
  if (source === "") return undefined;

  const branch = destination.startsWith(HEADS_PREFIX)
    ? destination.slice(HEADS_PREFIX.length)
    : destination;

  return branch === "" || branch === "HEAD" || /[$`]/u.test(branch) ? undefined : branch;
}

/** The last branch and pull request one string names. */
function matchesIn(text: string, repository: string) {
  let branch: string | undefined;
  let pullRequest: number | undefined;

  for (const push of text.matchAll(GIT_PUSH)) {
    branch = pushedBranch(push[1] ?? "") ?? branch;
  }

  for (const link of text.matchAll(PULL_REQUEST_LINK)) {
    const named = `${link[1]}/${link[2]}`.toLowerCase();

    if (named === repository.toLowerCase()) pullRequest = Number(link[3]);
  }

  return { branch, pullRequest };
}

/** The newer of two matches, the later one where they tie. */
function newer<A>(held: Found<A> | undefined, found: Found<A> | undefined) {
  if (found === undefined) return held;

  return held === undefined || found.at >= held.at ? found : held;
}

/**
 * The newest branch pushed and pull request linked of the repository
 * (`owner/name`) that one chat's transcript, oldest first, names.
 */
export function publishedCandidates(
  repository: string,
  messages: readonly ConductorMessage[],
): PublishedCandidates {
  let candidates: PublishedCandidates = {};

  for (const message of messages) {
    if (message.type !== "agent") continue;
    const parsed = Date.parse(message.receivedAt);
    const at = Number.isNaN(parsed) ? 0 : parsed;

    for (const text of stringsOf(message.content.rawPayload, [])) {
      const { branch, pullRequest } = matchesIn(text, repository);

      candidates = newestCandidates([
        candidates,
        {
          ...(branch === undefined ? undefined : { branch: { value: branch, at } }),
          ...(pullRequest === undefined ? undefined : { pullRequest: { value: pullRequest, at } }),
        },
      ]);
    }
  }

  return candidates;
}

/** The newest branch and the newest pull request among several chats', each on its own. */
export function newestCandidates(chats: readonly PublishedCandidates[]): PublishedCandidates {
  let branch: Found<string> | undefined;
  let pullRequest: Found<number> | undefined;

  for (const chat of chats) {
    branch = newer(branch, chat.branch);
    pullRequest = newer(pullRequest, chat.pullRequest);
  }

  return {
    ...(branch === undefined ? undefined : { branch }),
    ...(pullRequest === undefined ? undefined : { pullRequest }),
  };
}
