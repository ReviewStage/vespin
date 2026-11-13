import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { Database } from "../../core/query.js";
import { account, user } from "../../schemas/auth.js";
import {
  getTestDB,
  joinWorkspace,
  openAgentOnOwnTask,
  openInstallationWorkspace,
} from "../../testing/index.js";
import {
  claimGitHubMentionTurn,
  githubMentionMember,
  githubMentionWorkspace,
  recordGitHubMentionAgent,
} from "../github-mention-store.js";

/**
 * Who a mention of the GitHub App's bot is from, over a real dialect: the
 * installation's own workspace answers only its own member whose linked
 * GitHub account wrote the comment, and an agent's first settled turn is
 * claimed once.
 *
 * Synthetic accounts, workspaces, installations, and GitHub ids throughout.
 */

/** An account with the GitHub account given linked to it, as Better Auth's sign-in leaves the row. */
const openLinkedAccount = (githubUserId: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const id = `user-${randomUUID()}`;
    yield* db.insert(user).values({ id, name: "Test User", email: `${id}@app.test` });
    yield* db.insert(account).values({
      id: randomUUID(),
      accountId: githubUserId,
      providerId: "github",
      userId: id,
      updatedAt: new Date(),
    });

    return id;
  });

/** A fresh installation's GitHub ids. */
const installationOf = (seed: number) => ({
  installationId: seed,
  accountId: seed + 1,
  accountLogin: `acme-${seed}`,
});

it.layer(getTestDB())("the GitHub mention store", (it) => {
  it.effect("a mention is read in the installation's own workspace, as its own member alone", () =>
    Effect.gen(function* () {
      const writer = yield* openLinkedAccount("9001");
      const outsider = yield* openLinkedAccount("9002");
      const ours = yield* openInstallationWorkspace(writer, installationOf(71_001));
      const theirs = yield* openInstallationWorkspace(outsider, installationOf(71_011));

      assert.deepEqual(yield* githubMentionWorkspace(71_001), Option.some(ours));
      assert.deepEqual(yield* githubMentionMember(ours, "9001"), Option.some(writer));
      // A member of another workspace is no one here, though their GitHub account is linked.
      assert.deepEqual(yield* githubMentionMember(ours, "9002"), Option.none());
      yield* joinWorkspace(theirs, writer);
      assert.deepEqual(yield* githubMentionMember(theirs, "9001"), Option.some(writer));
    }),
  );

  it.effect(
    "an agent's first settled turn is claimed once, and an agent no mention started never",
    () =>
      Effect.gen(function* () {
        const writer = yield* openLinkedAccount("9101");
        const workspace = yield* openInstallationWorkspace(writer, installationOf(71_021));
        const started = yield* openAgentOnOwnTask(writer, workspace);
        const other = yield* openAgentOnOwnTask(writer, workspace);
        const place = { repository: "acme/api", number: 41 };
        yield* recordGitHubMentionAgent({ agentId: started, userId: writer, ...place });

        assert.deepEqual(yield* claimGitHubMentionTurn(started, "turn-1"), Option.some(place));
        assert.deepEqual(yield* claimGitHubMentionTurn(started, "turn-2"), Option.none());
        assert.deepEqual(yield* claimGitHubMentionTurn(other, "turn-1"), Option.none());
      }),
  );
});
