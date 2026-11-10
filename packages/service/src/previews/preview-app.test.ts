import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { archiveAgent } from "@repo/database/models/agent-store";
import { organization, user } from "@repo/database/schemas/auth";
import { getTestDB, openTaskAgent, startTask } from "@repo/database/testing";
import { PAGE_SANDBOX_ORIGIN } from "@repo/features/page-frame";
import { memorySandbox } from "@repo/sandbox/testing";
import { eq } from "drizzle-orm";
import { Clock, Effect, Layer, Redacted } from "effect";
import { HttpRouter } from "effect/http";
import { SqlClient } from "effect/sql";
import { AgentSandbox, type AgentSandboxService } from "../agents/terminal/agent-sandbox.js";
import { HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "../http/http.js";
import { PageLinks, type PageSandbox } from "../pages/page-links.js";
import { previewProxyApp } from "./preview-app.js";
import {
  mintPreviewSession,
  PREVIEW_LINK,
  PREVIEW_NAME_KIND,
  type PreviewName,
  previewNameOf,
  previewOrigin,
} from "./preview-links.js";

/**
 * A shared port's preview host, over a real dialect: a member's page load of
 * an archived agent's preview is drawn the no-preview page under the
 * refusal's status, never the API's refusal as JSON, while a request that is
 * no page load still gets the refusal; and a host named by the agent's task
 * admits only a session for the agent it names.
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

/** The preview host's route over the test's own database and clock, its member's visit of the agent's preview as the routing hands it on, at its agent-id host and as a page load unless said. */
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
  return (
    userId: string,
    agentId: string,
    pageLoad = true,
    name: PreviewName = { kind: PREVIEW_NAME_KIND.AGENT, agentId },
  ) =>
    Effect.gen(function* () {
      const cookie = mintPreviewSession(
        SANDBOX,
        { userId, agentId },
        yield* Clock.currentTimeMillis,
      );
      const address = `${previewOrigin(SANDBOX, name)}${PREVIEW_LINK.PROXY_PATH}/app`;
      return yield* Effect.promise(() =>
        route.handler(
          new Request(address, {
            headers: {
              cookie: `${PREVIEW_LINK.COOKIE}=${cookie}`,
              ...(pageLoad ? { "sec-fetch-mode": "navigate" } : {}),
            },
          }),
        ),
      );
    });
});

it.layer(getTestDB())("a shared port's preview host", (it) => {
  it.effect(
    "an archived agent's preview is drawn the no-preview page on a page load, and refused otherwise",
    () =>
      Effect.gen(function* () {
        const visit = yield* standing;
        const member = yield* openAccount;
        const task = yield* startTask(member, { name: "Teammate invitations" });
        const agentId = yield* openTaskAgent(member, task.workspaceId, task.id);
        yield* archiveAgent(member, agentId, true);

        const page = yield* visit(member, agentId);
        const fetched = yield* visit(member, agentId, false);

        assert.equal(page.status, HOSTED_HTTP_STATUS.CONFLICT);
        assert.equal(page.headers.get("content-type"), "text/html; charset=utf-8");
        assert.ok((yield* Effect.promise(() => page.text())).includes("Nothing running here"));
        assert.equal(fetched.status, HOSTED_HTTP_STATUS.CONFLICT);
        assert.deepEqual(yield* Effect.promise(() => fetched.json()), {
          error: HOSTED_API_ERROR.AGENT_RETIRED,
        });
      }),
  );

  it.effect(
    "a host named by the agent's task reaches the agent its session admits, and sends a session for another agent to sign in",
    () =>
      Effect.gen(function* () {
        const visit = yield* standing;
        const member = yield* openAccount;
        const task = yield* startTask(member, { name: "Teammate invitations" });
        const agentId = yield* openTaskAgent(member, task.workspaceId, task.id);
        const other = yield* openTaskAgent(member, task.workspaceId, task.id);
        yield* archiveAgent(member, agentId, true);
        const [workspace] = yield* (yield* Database)
          .select({ slug: organization.slug })
          .from(organization)
          .where(eq(organization.id, task.workspaceId));
        const name = previewNameOf(workspace?.slug ?? "", task.number ?? 0, agentId);

        const own = yield* visit(member, agentId, true, name);
        const another = yield* visit(member, other, true, name);

        // The task's host found the archived agent, and so met its refusal.
        assert.equal(own.status, HOSTED_HTTP_STATUS.CONFLICT);
        assert.equal(another.status, HOSTED_HTTP_STATUS.FOUND);
        const signIn = new URL(another.headers.get("location") ?? "");
        assert.equal(signIn.origin, "https://tryluke.dev");
        assert.equal(signIn.pathname, PREVIEW_LINK.SIGN_IN_PATH);
      }),
  );
});
