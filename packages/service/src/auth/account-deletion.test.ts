import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import {
  GITHUB_ACCOUNT_TYPE,
  GITHUB_INSTALLATION_STATUS,
} from "@repo/database/github-installation-vocabulary";
import { workspaceSeams } from "@repo/database/models/workspace-seams";
import { agentTable } from "@repo/database/schemas/agent";
import {
  member,
  organization as organizationTable,
  session,
  user,
} from "@repo/database/schemas/auth";
import { automation } from "@repo/database/schemas/automation";
import { githubInstallation } from "@repo/database/schemas/github-installation";
import { conversations } from "@repo/database/schemas/storage";
import { openMigratedPglite, openTaskAgent, sqlClientOverPglite } from "@repo/database/testing";
import {
  AUTOMATION_ACTION,
  AUTOMATION_DEFAULT_GUARDS,
  AUTOMATION_TRIGGER,
} from "@repo/features/automation-wire";
import { memorySandbox } from "@repo/sandbox/testing";
import { HTTP_METHOD } from "@repo/wire";
import { jsonResponse, recordingHttpClient } from "@repo/wire/testing";
import { betterAuth } from "better-auth";
import { organization } from "better-auth/plugins";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { ConfigProvider, Effect, Layer, Schema } from "effect";
import { HttpRouter } from "effect/http";
import { SqlClient } from "effect/sql";
import { accountDeletionSteps, workspaceDeletionSteps } from "../accounts/deletion-hooks.js";
import { onboardingEventsFromEnvironment } from "../accounts/onboarding-events.js";
import { WELCOME_MAIL_ENVIRONMENT } from "../accounts/welcome-mail.js";
import { SESSION_TAG } from "../agents/agent-sandbox-open.js";
import { BASE_DRIVE, baseDriveName } from "../agents/base-drive.js";
import { AutomationCadence } from "../automations/automation-cadence.js";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import { accountDeletionTestServices } from "../testing/account-deletion-services.js";
import { authApp } from "./auth-app.js";
import { authDatabaseAdapter } from "./auth-database.js";
import {
  accountDeletion,
  DISABLED_AUTH_PATHS,
  ORGANIZATION_OPTIONS,
  type OrganizationDeletionApi,
  workspaceDeletion,
} from "./auth-policy.js";

/**
 * An account deleted at Better Auth's own `/delete-user`, through the auth
 * route, as the Mac and the browser ask for it: Better Auth checks the
 * session is fresh, its hooks run the deletion's own steps on the route's
 * services, and the workspaces the account alone belongs to go before it.
 * One PGlite holds both Better Auth's rows and ours. Email and password
 * sign-up stands in for the Google or GitHub sign-in. Synthetic accounts
 * throughout.
 */

const BASE_URL = "http://127.0.0.1";

const decodeSignedUp = Schema.decodeUnknownSync(
  Schema.Struct({ user: Schema.Struct({ id: Schema.String }) }),
);

const decodeRefusal = Schema.decodeUnknownSync(Schema.Struct({ code: Schema.String }));

/** The role the account holds in the workspace, as its member row stands. */
const roleIn = (organizationId: string, userId: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const rows = yield* db
      .select({ role: member.role })
      .from(member)
      .where(and(eq(member.organizationId, organizationId), eq(member.userId, userId)));
    return rows.map((row) => row.role);
  });

/** The auth route over a Better Auth on the PGlite given, with our account deletion and organization policy. */
const openAuthRoute = (client: Awaited<ReturnType<typeof openMigratedPglite>>) =>
  Effect.gen(function* () {
    const auth = betterAuth({
      database: authDatabaseAdapter(drizzle({ client })),
      baseURL: BASE_URL,
      secret: "account-deletion-test-secret-of-enough-length",
      emailAndPassword: { enabled: true },
      disabledPaths: [...DISABLED_AUTH_PATHS],
      user: {
        deleteUser: accountDeletion((): OrganizationDeletionApi => auth.api, accountDeletionSteps),
      },
      plugins: [
        organization({
          ...ORGANIZATION_OPTIONS,
          organizationHooks: workspaceDeletion(workspaceDeletionSteps),
        }),
      ],
    });
    const sandboxes = memorySandbox();
    const forgotten: string[] = [];
    // Resend answers every onboarding call, and each is kept to read back.
    const resend = recordingHttpClient(() => jsonResponse({ object: "contact" }));
    const onboarding = onboardingEventsFromEnvironment.pipe(
      Layer.provide(
        Layer.merge(
          resend.layer,
          ConfigProvider.layer(
            ConfigProvider.fromUnknown({
              [WELCOME_MAIL_ENVIRONMENT.RESEND_API_KEY]: "re_test",
              [WELCOME_MAIL_ENVIRONMENT.FROM]: "Charles <charles@app.test>",
            }),
          ),
        ),
      ),
    );
    const services = Layer.mergeAll(
      Layer.succeed(SqlClient.SqlClient, yield* SqlClient.SqlClient),
      Layer.succeed(Database, yield* Database),
      accountDeletionTestServices,
      sandboxes.layer,
      Layer.succeed(AutomationCadence, {
        keep: () => Effect.void,
        forget: (scheduled) => Effect.sync(() => void forgotten.push(scheduled.id)),
        publish: () => Effect.void,
      }),
      onboarding,
    );
    const { handler, dispose } = HttpRouter.toWebHandler(
      authApp((request) => auth.handler(request), workspaceSeams(auth.api)).pipe(
        HttpRouter.provideRequest(services),
      ),
      { disableLogger: true },
    );
    yield* Effect.addFinalizer(() => Effect.promise(() => dispose()));
    const post = (path: string, body: object, cookie?: string) =>
      Effect.promise(() =>
        handler(
          new Request(`${BASE_URL}/api/auth/${path}`, {
            method: "POST",
            headers: {
              origin: BASE_URL,
              "content-type": "application/json",
              ...(cookie === undefined ? undefined : { cookie }),
            },
            body: JSON.stringify(body),
          }),
        ),
      );
    /** An account signed up and signed in: its id and the cookie its session rides on. */
    const signUp = (name: string) =>
      Effect.gen(function* () {
        const answered = yield* post("sign-up/email", {
          name,
          email: `${name}@example.com`,
          password: "a-password-long-enough",
        });
        assert.equal(answered.status, HOSTED_HTTP_STATUS.OK);
        const cookie = answered.headers
          .getSetCookie()
          .map((line) => line.split(";")[0])
          .join("; ");
        const { id } = decodeSignedUp(yield* Effect.promise(() => answered.json())).user;
        return { id, cookie };
      });
    return { auth, post, signUp, sandboxes, forgotten, resend };
  });

/** A workspace of Ada's alone, holding a GitHub connection, an agent a member who has since left ran in a sandbox on a repository whose base drive a fill is still filling, and that member's scheduled automation, and one she shares with Grace, holding her own scheduled automation. */
const openWorkspaces = (
  route: Effect.Success<ReturnType<typeof openAuthRoute>>,
  ada: string,
  grace: string,
) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const solo = yield* Effect.promise(() =>
      route.auth.api.createOrganization({ body: { name: "Ada", slug: "ada", userId: ada } }),
    );
    const shared = yield* Effect.promise(() =>
      route.auth.api.createOrganization({ body: { name: "Acme", slug: "acme", userId: ada } }),
    );
    assert.ok(solo && shared);
    yield* Effect.promise(() =>
      route.auth.api.addMember({
        body: { userId: grace, organizationId: shared.id, role: "member" },
      }),
    );
    const now = new Date("2099-01-01T00:00:00.000Z");
    yield* db.insert(githubInstallation).values({
      installationId: 4_200,
      organizationId: solo.id,
      accountId: 4_201,
      accountLogin: "ada",
      accountType: GITHUB_ACCOUNT_TYPE.ORGANIZATION,
      status: GITHUB_INSTALLATION_STATUS.ACTIVE,
      createdAt: now,
      updatedAt: now,
    });
    const agentId = yield* openTaskAgent(grace, solo.id, null);
    const [agent] = yield* db
      .select({ conversationId: agentTable.conversationId })
      .from(agentTable)
      .where(eq(agentTable.id, agentId));
    assert.ok(agent);
    yield* db
      .update(conversations)
      .set({ runtimeSessionId: "session-of-grace" })
      .where(eq(conversations.id, agent.conversationId));
    yield* db
      .update(agentTable)
      .set({ repository: "acme/relay" })
      .where(eq(agentTable.id, agentId));
    route.sandboxes.stand({
      name: "sandbox-of-grace",
      tags: { [SESSION_TAG]: "session-of-grace" },
    });
    const baseDrive = baseDriveName({ workspaceId: solo.id, fullName: "acme/relay" });
    route.sandboxes.state.drives.set(baseDrive, { name: baseDrive, forkedFrom: undefined });
    route.sandboxes.stand({ name: baseDrive, drive: { name: baseDrive, at: BASE_DRIVE.MOUNT } });
    const [scheduled] = yield* db
      .insert(automation)
      .values({
        userId: grace,
        organizationId: solo.id,
        name: "Every morning",
        enabled: true,
        triggerKind: AUTOMATION_TRIGGER.SCHEDULE,
        trigger: { kind: AUTOMATION_TRIGGER.SCHEDULE, cron: "0 9 * * *", timezone: "UTC" },
        action: { kind: AUTOMATION_ACTION.AGENT, prompt: "Triage the issues" },
        guards: AUTOMATION_DEFAULT_GUARDS,
      })
      .returning({ id: automation.id });
    assert.ok(scheduled);
    const [sharedScheduled] = yield* db
      .insert(automation)
      .values({
        userId: ada,
        organizationId: shared.id,
        name: "Every evening",
        enabled: true,
        triggerKind: AUTOMATION_TRIGGER.SCHEDULE,
        trigger: { kind: AUTOMATION_TRIGGER.SCHEDULE, cron: "0 18 * * *", timezone: "UTC" },
        action: { kind: AUTOMATION_ACTION.AGENT, prompt: "Summarize the day" },
        guards: AUTOMATION_DEFAULT_GUARDS,
      })
      .returning({ id: automation.id });
    assert.ok(sharedScheduled);
    return {
      solo: solo.id,
      shared: shared.id,
      leftBehind: agent.conversationId,
      baseDrive,
      schedule: scheduled.id,
      sharedSchedule: sharedScheduled.id,
    };
  });

it.effect(
  "deleting an account at Better Auth's endpoint deletes the workspace it alone belongs to, with its GitHub connection, deletes the agents' conversations and sandboxes it left, its repositories' base drives, and its automations' schedules, and leaves a workspace others share, forgetting the account's own schedule there",
  () =>
    Effect.gen(function* () {
      const client = yield* Effect.acquireRelease(Effect.promise(openMigratedPglite), (opened) =>
        Effect.promise(() => opened.close()),
      );
      yield* Effect.gen(function* () {
        const db = yield* Database;
        const route = yield* openAuthRoute(client);
        const ada = yield* route.signUp("ada");
        const grace = yield* route.signUp("grace");
        const { shared, leftBehind, baseDrive, schedule, sharedSchedule } = yield* openWorkspaces(
          route,
          ada.id,
          grace.id,
        );

        const deleted = yield* route.post("delete-user", {}, ada.cookie);

        assert.equal(deleted.status, HOSTED_HTTP_STATUS.OK);
        assert.deepEqual(yield* db.select({ id: organizationTable.id }).from(organizationTable), [
          { id: shared },
        ]);
        // Grace, the shared workspace's one other member, is handed it.
        assert.deepEqual(yield* roleIn(shared, grace.id), ["owner"]);
        assert.deepEqual(yield* db.select().from(githubInstallation), []);
        assert.deepEqual(
          yield* db.select({ id: user.id }).from(user).where(eq(user.id, ada.id)),
          [],
        );
        assert.deepEqual(
          yield* db
            .select({ id: conversations.id })
            .from(conversations)
            .where(eq(conversations.id, leftBehind)),
          [],
        );
        assert.deepEqual(route.sandboxes.state.deleted.toSorted(), [baseDrive, "sandbox-of-grace"]);
        assert.deepEqual(route.sandboxes.state.deletedDrives, [baseDrive]);
        // The solo workspace's schedule goes with it, then Ada's own in the shared one with her account.
        assert.deepEqual(route.forgotten, [schedule, sharedSchedule]);
        const contactDeletes = route.resend.requests
          .filter((request) => request.method === HTTP_METHOD.DELETE)
          .map((request) => decodeURIComponent(request.pathname));
        assert.deepEqual(contactDeletes, ["/contacts/ada@example.com"]);
      }).pipe(Effect.provide(sqlClientOverPglite(client)), Effect.scoped);
    }),
);

it.effect(
  "an owner's account deletion hands a workspace others share to its longest-standing admin before a member who joined earlier",
  () =>
    Effect.gen(function* () {
      const client = yield* Effect.acquireRelease(Effect.promise(openMigratedPglite), (opened) =>
        Effect.promise(() => opened.close()),
      );
      yield* Effect.gen(function* () {
        const db = yield* Database;
        const route = yield* openAuthRoute(client);
        const ada = yield* route.signUp("ada");
        const grace = yield* route.signUp("grace");
        const alan = yield* route.signUp("alan");
        const barbara = yield* route.signUp("barbara");
        const acme = yield* Effect.promise(() =>
          route.auth.api.createOrganization({
            body: { name: "Acme", slug: "acme", userId: ada.id },
          }),
        );
        assert.ok(acme);
        // Grace joined first, then Alan, then Barbara, a day apart.
        for (const [day, userId, role] of [
          [1, grace.id, "member"],
          [2, alan.id, "admin"],
          [3, barbara.id, "admin"],
        ] as const) {
          yield* Effect.promise(() =>
            route.auth.api.addMember({ body: { userId, organizationId: acme.id, role } }),
          );
          yield* db
            .update(member)
            .set({ createdAt: new Date(Date.UTC(2099, 0, day)) })
            .where(and(eq(member.organizationId, acme.id), eq(member.userId, userId)));
        }

        const deleted = yield* route.post("delete-user", {}, ada.cookie);

        assert.equal(deleted.status, HOSTED_HTTP_STATUS.OK);
        assert.deepEqual(yield* roleIn(acme.id, alan.id), ["owner"]);
        assert.deepEqual(yield* roleIn(acme.id, grace.id), ["member"]);
        assert.deepEqual(yield* roleIn(acme.id, barbara.id), ["admin"]);
      }).pipe(Effect.provide(sqlClientOverPglite(client)), Effect.scoped);
    }),
);

it.effect(
  "a member left alone in a workspace with no owner deletes it with their own account",
  () =>
    Effect.gen(function* () {
      const client = yield* Effect.acquireRelease(Effect.promise(openMigratedPglite), (opened) =>
        Effect.promise(() => opened.close()),
      );
      yield* Effect.gen(function* () {
        const db = yield* Database;
        const route = yield* openAuthRoute(client);
        const ada = yield* route.signUp("ada");
        const grace = yield* route.signUp("grace");
        const { shared } = yield* openWorkspaces(route, ada.id, grace.id);
        // Ada's owner row went with her account before an heir was named.
        yield* db
          .delete(member)
          .where(and(eq(member.organizationId, shared), eq(member.userId, ada.id)));

        const deleted = yield* route.post("delete-user", {}, grace.cookie);

        assert.equal(deleted.status, HOSTED_HTTP_STATUS.OK);
        assert.deepEqual(
          yield* db
            .select({ id: organizationTable.id })
            .from(organizationTable)
            .where(eq(organizationTable.id, shared)),
          [],
        );
      }).pipe(Effect.provide(sqlClientOverPglite(client)), Effect.scoped);
    }),
);

it.effect(
  "a session signed in longer ago than Better Auth deletes for is refused as expired, and nothing is deleted",
  () =>
    Effect.gen(function* () {
      const client = yield* Effect.acquireRelease(Effect.promise(openMigratedPglite), (opened) =>
        Effect.promise(() => opened.close()),
      );
      yield* Effect.gen(function* () {
        const db = yield* Database;
        const route = yield* openAuthRoute(client);
        const ada = yield* route.signUp("ada");
        const grace = yield* route.signUp("grace");
        const { solo, leftBehind } = yield* openWorkspaces(route, ada.id, grace.id);
        // Ada signed in two days ago, past Better Auth's one-day fresh age.
        yield* db
          .update(session)
          .set({ createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) })
          .where(eq(session.userId, ada.id));

        const refused = yield* route.post("delete-user", {}, ada.cookie);

        assert.equal(refused.status, HOSTED_HTTP_STATUS.BAD_REQUEST);
        assert.equal(
          decodeRefusal(yield* Effect.promise(() => refused.json())).code,
          "SESSION_EXPIRED",
        );
        assert.equal(
          (yield* db.select({ id: user.id }).from(user).where(eq(user.id, ada.id))).length,
          1,
        );
        assert.equal(
          (yield* db
            .select({ id: organizationTable.id })
            .from(organizationTable)
            .where(eq(organizationTable.id, solo))).length,
          1,
        );
        assert.equal(
          (yield* db
            .select({ id: conversations.id })
            .from(conversations)
            .where(eq(conversations.id, leftBehind))).length,
          1,
        );
      }).pipe(Effect.provide(sqlClientOverPglite(client)), Effect.scoped);
    }),
);

it.effect(
  "the organization plugin's own delete stays shut over HTTP, so a workspace is deleted only with its last member's account",
  () =>
    Effect.gen(function* () {
      const client = yield* Effect.acquireRelease(Effect.promise(openMigratedPglite), (opened) =>
        Effect.promise(() => opened.close()),
      );
      yield* Effect.gen(function* () {
        const db = yield* Database;
        const route = yield* openAuthRoute(client);
        const ada = yield* route.signUp("ada");
        const grace = yield* route.signUp("grace");
        const { solo } = yield* openWorkspaces(route, ada.id, grace.id);

        const refused = yield* route.post(
          "organization/delete",
          { organizationId: solo },
          ada.cookie,
        );

        assert.equal(refused.status, HOSTED_HTTP_STATUS.NOT_FOUND);
        assert.equal(
          (yield* db
            .select({ id: organizationTable.id })
            .from(organizationTable)
            .where(eq(organizationTable.id, solo))).length,
          1,
        );
      }).pipe(Effect.provide(sqlClientOverPglite(client)), Effect.scoped);
    }),
);
