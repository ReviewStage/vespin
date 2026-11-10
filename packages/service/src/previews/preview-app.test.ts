import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { archiveAgent } from "@repo/database/models/agent-store";
import { user } from "@repo/database/schemas/auth";
import { getTestDB, openTaskAgent, startTask } from "@repo/database/testing";
import { PAGE_SANDBOX_ORIGIN } from "@repo/features/page-frame";
import { memorySandbox } from "@repo/sandbox/testing";
import { Clock, Effect, Layer, Redacted } from "effect";
import { HttpRouter } from "effect/http";
import { SqlClient } from "effect/sql";
import { AgentSandbox, type AgentSandboxService } from "../agents/terminal/agent-sandbox.js";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import { PageLinks, type PageSandbox } from "../pages/page-links.js";
import { previewProxyApp } from "./preview-app.js";
import { mintPreviewSession, PREVIEW_LINK, previewOrigin } from "./preview-links.js";

/**
 * A shared port's preview host, over a real dialect: a member's page load of
 * an archived agent's preview is drawn the no-preview page, never the API's
 * refusal as JSON.
 *
 * Synthetic accounts, workspaces, tasks, agents, and keys throughout.
 */

const SANDBOX: PageSandbox = {
  origin: PAGE_SANDBOX_ORIGIN,
  key: Redacted.make("synthetic-page-link-key-for-tests-only-0000"),
  appOrigins: ["https://tryluke.dev"],
};

const openAccount = Effect.gen(function* () {
  const id = `user-${randomUUID()}`;
  yield* Database.use((db) =>
    db.insert(user).values({ id, name: "Test User", email: `${id}@app.test` }),
  );
  return id;
});

/** The preview host's route over the test's own database and clock, its member's page load of the agent's preview as the routing hands it on. */
const standing = Effect.gen(function* () {
  const services = Layer.mergeAll(
    Layer.succeed(SqlClient.SqlClient, yield* SqlClient.SqlClient),
    Layer.succeed(Database, yield* Database),
    Layer.succeed(Clock.Clock, yield* Clock.Clock),
    Layer.succeed(PageLinks, { sandbox: SANDBOX }),
    memorySandbox().layer,
  );
  // SAFETY: an archived agent is refused before its sandbox is asked anything, so no call of it is ever made.
  const sandbox = Layer.succeed(AgentSandbox, {} as AgentSandboxService);
  const route = HttpRouter.toWebHandler(
    previewProxyApp({ sandbox }).pipe(HttpRouter.provideRequest(services)),
    { disableLogger: true },
  );
  yield* Effect.addFinalizer(() => Effect.promise(() => route.dispose()));
  return (userId: string, agentId: string) =>
    Effect.gen(function* () {
      const cookie = mintPreviewSession(
        SANDBOX,
        { userId, agentId },
        yield* Clock.currentTimeMillis,
      );
      const address = `${previewOrigin(SANDBOX, agentId)}${PREVIEW_LINK.PROXY_PATH}/app`;
      return yield* Effect.promise(() =>
        route.handler(
          new Request(address, {
            headers: { cookie: `${PREVIEW_LINK.COOKIE}=${cookie}`, "sec-fetch-mode": "navigate" },
          }),
        ),
      );
    });
});

it.layer(getTestDB())("a shared port's preview host", (it) => {
  it.effect("a page load of an archived agent's preview is drawn the no-preview page", () =>
    Effect.gen(function* () {
      const visit = yield* standing;
      const member = yield* openAccount;
      const task = yield* startTask(member, { name: "Teammate invitations" });
      const agentId = yield* openTaskAgent(member, task.workspaceId, task.id);
      yield* archiveAgent(member, agentId, true);

      const answer = yield* visit(member, agentId);

      assert.equal(answer.status, HOSTED_HTTP_STATUS.NOT_FOUND);
      assert.equal(answer.headers.get("content-type"), "text/html; charset=utf-8");
      assert.ok((yield* Effect.promise(() => answer.text())).includes("Nothing running here"));
    }),
  );
});
