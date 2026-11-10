/**
 * agent-pull-requests.test.ts -- every pull request an agent opened, over a real dialect: each
 * one linked once and written again as GitHub answers it, a merge counted by the one write that
 * first keeps it and never moved back by a read begun before it, and none of another account's
 * agent read or written. Synthetic accounts throughout.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import {
  CHECK_SUMMARY,
  PULL_REQUEST_STATE,
  type PullRequestState,
} from "@repo/features/agent-wire";
import { GITHUB_ACCESS } from "@repo/features/github-repositories-wire";
import { Effect, Option } from "effect";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { CONVERSATION_RUNTIME } from "../../storage-vocabulary.js";
import { getTestDB, openWorkspace } from "../../testing/index.js";
import { readAgentPullRequests, recordAgentPullRequests } from "../agent-pull-requests.js";
import { createAgent } from "../agent-store.js";
import { createTask } from "../task-store.js";

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@app.test` });
  return id;
});

/** An agent of the account's on a task of its workspace, in `acme/api`; its id. */
const openAgent = (userId: string, organizationId: string) =>
  Effect.gen(function* () {
    const { id: taskId } = yield* createTask(userId, { organizationId, name: "Invitations" });
    const started = yield* createAgent(userId, {
      taskId,
      descriptionSnapshot: null,
      prompt: "Expire teammate invitations",
      idempotencyKey: randomUUID(),
      model: "anthropic/claude-opus-5.5",
      effort: "high",
      repository: "acme/api",
      githubAccess: GITHUB_ACCESS.APP,
      runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
    });
    return Option.getOrThrow(started).agent.id;
  });

/** A read of pull request `number` of `acme/api` from its own branch, in the state named. */
const read = (number: number, state: PullRequestState) => ({
  repository: "acme/api",
  headBranch: `agent/${number}`,
  pullRequest: {
    number,
    title: "Expire teammate invitations",
    url: `https://github.com/acme/api/pull/${number}`,
    state,
    checks: CHECK_SUMMARY.PASSING,
    additions: 12,
    deletions: 3,
    changedFiles: 2,
  },
});

/** The agent's pull requests as the account reads them, by number and state, newest linked first. */
const statesOf = (userId: string, agentId: string) =>
  Effect.map(readAgentPullRequests(userId, agentId), (rows) =>
    rows.map(({ pullRequest }) => [pullRequest.number, pullRequest.state]),
  );

it.layer(getTestDB())("the pull requests an agent opened", (it) => {
  it.effect(
    "are each linked once and counted merged once, a merge never moved back by a read begun before it",
    () =>
      Effect.gen(function* () {
        const dean = yield* openAccount;
        const agentId = yield* openAgent(dean, yield* openWorkspace(dean));

        yield* recordAgentPullRequests(dean, agentId, [read(41, PULL_REQUEST_STATE.OPEN)]);
        yield* recordAgentPullRequests(dean, agentId, [read(42, PULL_REQUEST_STATE.OPEN)]);
        const merged = yield* recordAgentPullRequests(dean, agentId, [
          read(42, PULL_REQUEST_STATE.MERGED),
          read(41, PULL_REQUEST_STATE.MERGED),
        ]);
        const again = yield* recordAgentPullRequests(dean, agentId, [
          read(41, PULL_REQUEST_STATE.MERGED),
        ]);
        const stale = yield* recordAgentPullRequests(dean, agentId, [
          read(41, PULL_REQUEST_STATE.OPEN),
        ]);

        assert.deepEqual([merged, again, stale], [2, 0, 0]);
        assert.deepEqual(
          (yield* statesOf(dean, agentId)).toSorted(([a], [b]) => Number(a) - Number(b)),
          [
            [41, PULL_REQUEST_STATE.MERGED],
            [42, PULL_REQUEST_STATE.MERGED],
          ],
        );
      }),
  );

  it.effect("are neither read nor written by an account outside the agent's workspace", () =>
    Effect.gen(function* () {
      const dean = yield* openAccount;
      const outsider = yield* openAccount;
      const agentId = yield* openAgent(dean, yield* openWorkspace(dean));
      yield* recordAgentPullRequests(dean, agentId, [read(41, PULL_REQUEST_STATE.OPEN)]);

      const written = yield* recordAgentPullRequests(outsider, agentId, [
        read(42, PULL_REQUEST_STATE.MERGED),
      ]);

      assert.equal(written, 0);
      assert.deepEqual(yield* readAgentPullRequests(outsider, agentId), []);
      assert.deepEqual(yield* statesOf(dean, agentId), [[41, PULL_REQUEST_STATE.OPEN]]);
    }),
  );
});
