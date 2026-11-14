/**
 * merge-queue.test.ts -- a workspace's merge queues join each queued pull request to the task whose agent opened it, carry GitHub's estimate and how its merge group's checks stand, and refuse a member of another workspace.
 *
 * Over the real `GitHubApp`, a GitHub the test scripts, and the account,
 * workspace, task, and agent rows on a real dialect.
 *
 * Synthetic accounts, tokens, and repositories throughout.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { writeAccountPreferences } from "@repo/database/models/account-store";
import { createTask } from "@repo/database/models/task-store";
import { user } from "@repo/database/schemas/auth";
import {
  getTestDB,
  openedPullRequest,
  openInstallationWorkspace,
  openTaskAgent,
} from "@repo/database/testing";
import { CHECK_SUMMARY, PULL_REQUEST_STATE } from "@repo/features/agent-wire";
import { MERGE_QUEUE_ENTRY_STATE } from "@repo/features/merge-queue-wire";
import { EXPERIMENT } from "@repo/settings";
import { Effect } from "effect";
import { HOSTED_REFUSAL, upstreamRefused } from "../http/http-effect.js";
import {
  githubReaching,
  openGithubUser,
  type RepositoryScript,
} from "../testing/github-app-fake.js";
import { readWorkspaceMergeQueue } from "./merge-queue.js";

const RELAY = "acme/relay";

/** `acme/relay`'s queue as GitHub's GraphQL answers it: pull request 42, which an agent opened, its merge group's checks passed, failed, and running, more of them tallied than named, ahead of 43, which a person did, with no merge group or estimate yet. */
function relayQueue(sent: { readonly url: string; readonly method: string }): Response | undefined {
  if (new URL(sent.url).pathname !== "/graphql" || sent.method !== "POST") return undefined;

  return Response.json({
    data: {
      r0: {
        mergeQueue: {
          url: "https://github.com/acme/relay/queue/main",
          entries: {
            nodes: [
              {
                position: 2,
                state: "QUEUED",
                enqueuedAt: "2026-11-12T10:05:00Z",
                estimatedTimeToMerge: null,
                headCommit: null,
                pullRequest: {
                  number: 43,
                  title: "Bump the linter",
                  url: "https://github.com/acme/relay/pull/43",
                  author: { login: "octo-dev", avatarUrl: "https://avatars.test/octo-dev" },
                },
              },
              {
                position: 1,
                state: "AWAITING_CHECKS",
                enqueuedAt: "2026-11-12T10:00:00Z",
                estimatedTimeToMerge: 240,
                headCommit: {
                  statusCheckRollup: {
                    contexts: {
                      totalCount: 8,
                      checkRunCountsByState: [
                        { state: "SUCCESS", count: 3 },
                        { state: "FAILURE", count: 2 },
                        { state: "IN_PROGRESS", count: 1 },
                      ],
                      statusContextCountsByState: [
                        { state: "ERROR", count: 1 },
                        { state: "SUCCESS", count: 1 },
                      ],
                      nodes: [
                        { __typename: "CheckRun", name: "Tests", conclusion: "SUCCESS" },
                        { __typename: "CheckRun", name: "Lint", conclusion: "FAILURE" },
                        { __typename: "CheckRun", name: "Build", conclusion: null },
                        { __typename: "StatusContext", context: "deploy", state: "ERROR" },
                        { __typename: "StatusContext", context: "license", state: "SUCCESS" },
                      ],
                    },
                  },
                },
                pullRequest: {
                  number: 42,
                  title: "Send invitations in batches",
                  url: "https://github.com/acme/relay/pull/42",
                  author: { login: "relay-bot", avatarUrl: "https://avatars.test/relay-bot" },
                },
              },
            ],
          },
        },
      },
    },
  });
}

/** A member with the experiment on, in a workspace whose installation of this id reaches `acme/relay`, with a task there whose agent opened pull request 42. */
const openQueuedWorkspace = Effect.fnUntraced(function* (
  installationId: number,
  script: RepositoryScript = relayQueue,
) {
  const github = githubReaching(
    [{ id: installationId, login: "acme", repositories: [{ owner: "acme", name: "relay" }] }],
    undefined,
    {},
    script,
  );

  const member = yield* openGithubUser();

  const workspace = yield* openInstallationWorkspace(member, {
    installationId,
    accountId: installationId + 2_000,
    accountLogin: "acme",
  });

  yield* writeAccountPreferences(member, { experiments: { [EXPERIMENT.MERGE_QUEUE]: true } });

  const task = yield* createTask(member, {
    organizationId: workspace,
    name: "Batch invitations",
    repository: RELAY,
  });

  const agent = yield* openTaskAgent(member, workspace, task.id);
  yield* openedPullRequest(
    member,
    agent,
    {
      number: 42,
      title: "Send invitations in batches",
      url: "https://github.com/acme/relay/pull/42",
      state: PULL_REQUEST_STATE.OPEN,
      checks: CHECK_SUMMARY.PENDING,
      additions: 12,
      deletions: 3,
      changedFiles: 2,
    },
    RELAY,
  );

  return { github, member, workspace, task };
});

const REFUSED = {
  type: "FORBIDDEN",
  path: ["r0", "mergeQueue"],
  message: "Resource not accessible by integration",
};

/** A GraphQL body that refuses the queue: its alias's data, where it answers any, and its errors. */
interface RefusingAnswer {
  readonly data?: { readonly r0: { readonly mergeQueue: null } };
  readonly errors: readonly (typeof REFUSED)[];
}

/** The GraphQL body as GitHub answers it, and nothing for any other request. */
function graphqlAnswering(body: RefusingAnswer): RepositoryScript {
  return (sent) =>
    new URL(sent.url).pathname === "/graphql" && sent.method === "POST"
      ? Response.json(body)
      : undefined;
}

/**
 * GitHub refusing `acme/relay`'s queue to the App's token: its alias null,
 * as a repository with no queue answers, beside an error saying why; or the
 * whole query refused, with no data at all.
 */
const REFUSALS = [
  { refusal: "the queue", body: { data: { r0: { mergeQueue: null } }, errors: [REFUSED] } },
  { refusal: "the whole query", body: { errors: [{ ...REFUSED, path: ["r0"] }] } },
];

it.layer(getTestDB())("a workspace's merge queues", (it) => {
  it.effect(
    "join a queued pull request to its task, its estimate, and its merge group's checks",
    () =>
      Effect.gen(function* () {
        const { github, member, workspace, task } = yield* openQueuedWorkspace(7811);

        const answer = yield* readWorkspaceMergeQueue(member, workspace).pipe(
          Effect.provide(github.layer),
        );

        assert.deepEqual(
          answer.repositories.map((queue) => ({
            repository: queue.repository,
            url: queue.url,
            entries: queue.entries.map((entry) => [
              entry.position,
              entry.state,
              entry.pullRequest.number,
              entry.task?.id ?? null,
              entry.estimatedMergeAt,
              entry.checks,
            ]),
          })),
          [
            {
              repository: RELAY,
              url: "https://github.com/acme/relay/queue/main",
              entries: [
                // Note that the test clock stands at the epoch, so the estimate's 240 seconds land at 240,000 ms.
                [
                  1,
                  MERGE_QUEUE_ENTRY_STATE.AWAITING_CHECKS,
                  42,
                  task.id,
                  240_000,
                  // Note that a third failure past the first page is counted from the tallies, though only the two on it are named.
                  { total: 8, passed: 4, failedCount: 3, failed: ["Lint", "deploy"] },
                ],
                [2, MERGE_QUEUE_ENTRY_STATE.QUEUED, 43, null, null, null],
              ],
            },
          ],
        );
      }),
  );

  it.effect("refuse a member of another workspace as not found, asking GitHub nothing", () =>
    Effect.gen(function* () {
      const { github, workspace } = yield* openQueuedWorkspace(7812);
      const outsider = `user-${randomUUID()}`;
      yield* (yield* Database)
        .insert(user)
        .values({ id: outsider, name: "Test User", email: `${outsider}@app.test` });
      yield* writeAccountPreferences(outsider, {
        experiments: { [EXPERIMENT.MERGE_QUEUE]: true },
      });

      const refused = yield* readWorkspaceMergeQueue(outsider, workspace).pipe(
        Effect.provide(github.layer),
        Effect.flip,
      );

      assert.deepEqual(refused, HOSTED_REFUSAL.NOT_FOUND);
      assert.equal(github.sent.length, 0);
    }),
  );

  it.effect.each(REFUSALS.map((each, index) => ({ ...each, installationId: 7813 + index })))(
    "fail as GitHub's refusal where it refuses $refusal, never as no queue",
    ({ body, installationId }) =>
      Effect.gen(function* () {
        const { github, member, workspace } = yield* openQueuedWorkspace(
          installationId,
          graphqlAnswering(body),
        );

        const refused = yield* readWorkspaceMergeQueue(member, workspace).pipe(
          Effect.provide(github.layer),
          Effect.flip,
        );

        assert.deepEqual(refused, upstreamRefused(403));
      }),
  );
});
