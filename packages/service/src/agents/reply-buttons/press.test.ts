import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import {
  claimReplyButtonPress,
  makeReplyButton,
  settleReplyButtonPress,
} from "@repo/database/models/reply-buttons";
import { storeWriter } from "@repo/database/models/writer";
import { user } from "@repo/database/schemas/auth";
import {
  experimentInTestWorkspace,
  getTestDB,
  joinWorkspace,
  openTaskAgent,
  startTask,
} from "@repo/database/testing";
import { REPLY_BUTTON_ACTION } from "@repo/features/reply-button-wire";
import { memorySandbox } from "@repo/sandbox/testing";
import { EXPERIMENT } from "@repo/settings";
import { Effect, Layer } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import { GitHubApp } from "../../github/github-app.js";
import { HOSTED_REFUSAL } from "../../http/http-effect.js";
import { ModelCatalog } from "../../providers/model-catalog.js";
import { CODER_TOOL_SET } from "../coder-host/tool-set.js";
import { pressReplyButton, readReplyButtonView } from "./press.js";

/**
 * A button in an agent's reply as a member reads and presses it, over a real
 * dialect: not found while its workspace has Reply buttons off, and once
 * pressed, answered to every later press, another member's included, as its
 * first press landed, without running again. Nothing here starts an agent
 * or reaches a session, so the services a press could reach are mocks that
 * answer nothing. Synthetic accounts and briefs throughout.
 */

const NOW = new Date("2026-11-10T12:00:00Z");

const SUITE = Layer.mergeAll(
  getTestDB(),
  memorySandbox().layer,
  Layer.mock(GitHubApp)({}),
  Layer.mock(ModelCatalog)({}),
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make(() => Effect.die("a press that runs nothing reaches no network")),
  ),
);

const writer = storeWriter({ tools: CODER_TOOL_SET });

const noSummary = () => Effect.die("a press that runs nothing summarizes nothing");

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Ada Lovelace", email: `${id}@app.test` });
  return id;
});

it.layer(SUITE)("a button in an agent's reply", (it) => {
  it.effect(
    "is not found while its workspace has Reply buttons off, and once pressed answers its first press to another member without running again",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount;
        const teammate = yield* openAccount;
        const task = yield* startTask(owner, { name: "Invitations", repository: "acme/relay" });
        yield* joinWorkspace(task.workspaceId, teammate);
        const agentId = yield* openTaskAgent(owner, task.workspaceId, task.id);
        const reached = yield* openTaskAgent(owner, task.workspaceId, task.id);
        const buttonId = yield* makeReplyButton(
          agentId,
          "Wire up the invite email",
          { kind: REPLY_BUTTON_ACTION.START, prompt: "Send the invite email." },
          NOW,
        );

        const off = yield* Effect.flip(readReplyButtonView(teammate, agentId, buttonId));
        assert.equal(off, HOSTED_REFUSAL.NOT_FOUND);

        yield* experimentInTestWorkspace(owner, EXPERIMENT.REPLY_BUTTONS);
        assert.equal(yield* claimReplyButtonPress(buttonId, owner, NOW), true);
        yield* settleReplyButtonPress(buttonId, owner, reached, NOW);
        const again = yield* pressReplyButton(writer, teammate, agentId, buttonId, noSummary);
        assert.deepEqual(
          { by: again.pressed?.by, agent: again.pressed?.agent?.id },
          { by: "Ada Lovelace", agent: reached },
        );
      }),
  );
});
