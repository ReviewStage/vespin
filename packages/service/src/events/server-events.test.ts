import { createHmac, randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { member, organization, user } from "@repo/database/schemas/auth";
import { getTestDB } from "@repo/database/testing";
import { AGENT_KIND } from "@repo/features/agent-wire";
import { fakeHttpClientLayer } from "@repo/wire/testing";
import { eq } from "drizzle-orm";
import { Effect, Layer, Redacted } from "effect";
import { TestClock } from "effect/testing";
import { HostedEnvironment, type HostedEnvironmentValues } from "../environment.js";
import type { PosthogBatch, PosthogBatchItem } from "../providers/posthog.js";
import { DEPLOYMENT_VARIABLE } from "./events.js";
import {
  productAnalyticsFromEnvironment,
  recordServerEvent,
  recordSurveyResponse,
  SERVER_AGENT_START_KIND,
  SERVER_AGENT_STARTER,
  SERVER_EVENT,
  SERVER_SIGN_IN_METHOD,
  workspaceRenamed,
} from "./server-events.js";

const NOW = Date.parse("2026-08-19T12:00:00.000Z");

/** When the workspace a group test names was made. */
const CREATED = Date.parse("2026-03-02T09:30:00.000Z");

/** The key the test deployment hashes an account's id under. */
const DISTINCT_ID_KEY = "distinct-id-key";

/** The id PostHog should hold an account's counts under: HMAC-SHA256 of its id under the deployment's key, as hex. */
const hashedId = (userId: string) =>
  createHmac("sha256", DISTINCT_ID_KEY).update(userId).digest("hex");

/** A deployment that records the service's counts: a project token and the key its ids are hashed under. */
const RECORDING = {
  posthogProjectApiKey: Redacted.make("phc_project"),
  posthogDistinctIdKey: Redacted.make(DISTINCT_ID_KEY),
};

const NO_ENVIRONMENT: HostedEnvironmentValues = {
  posthogPersonalApiKey: undefined,
  posthogProjectId: undefined,
  posthogApiHost: undefined,
  posthogProjectApiKey: undefined,
  posthogIngestHost: undefined,
  posthogDistinctIdKey: undefined,
  cronSecret: undefined,
  githubWebhookSecret: undefined,
  providerKeyEncryptionKeys: undefined,
  titleAnthropicApiKey: undefined,
  previewApiKeys: {},
};

interface Posted {
  readonly url: string;
  readonly body: PosthogBatch;
}

/** The deployment's analytics over a processor that records what reached it and answers `status`. */
function analytics(environment: Partial<HostedEnvironmentValues>, status = 200) {
  const posted: Posted[] = [];

  const http = fakeHttpClientLayer((url, init) => {
    // SAFETY: the body is the batch document the capture just serialized.
    posted.push({ url, body: JSON.parse(String(init.body)) as PosthogBatch });

    return new Response("{}", { status });
  });

  const layer = productAnalyticsFromEnvironment.pipe(
    Layer.provide(
      Layer.merge(http, Layer.succeed(HostedEnvironment, { ...NO_ENVIRONMENT, ...environment })),
    ),
  );

  return { layer, posted };
}

/** An account the service holds, answering its id. */
const openUser = Effect.gen(function* () {
  const db = yield* Database;
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@app.test` });

  return userId;
});

/** An agent's start counted by the account in the workspace, which no row of the test's holds unless it opened one. */
const agentStartIn = (userId: string, workspaceId: string) =>
  recordServerEvent(
    SERVER_EVENT.AGENT_START,
    { userId, workspaceId },
    {
      model: "anthropic/claude-opus-5.5",
      effort: "high",
      start_kind: SERVER_AGENT_START_KIND.FRESH,
      is_from_automation: false,
      started_by: SERVER_AGENT_STARTER.MEMBER,
      has_task: true,
      agent_kind: AGENT_KIND.CODER,
    },
  );

const agentStart = (userId: string) => agentStartIn(userId, "workspace-1");

/** Every item the processor was posted, across its batches, in order. */
const itemsOf = (posted: readonly Posted[]): PosthogBatchItem[] =>
  posted.flatMap((each) => [...each.body.batch]);

/** Each `$groupidentify` the processor was posted: who it was filed under, and the group it named. */
const namedGroups = (posted: readonly Posted[]) =>
  itemsOf(posted)
    .filter((item) => item.event === "$groupidentify")
    .map((item) => ({
      by: item.distinct_id,
      type: item.properties["$group_type"],
      key: item.properties["$group_key"],
      set: item.properties["$group_set"],
    }));

/** A workspace the service holds, named and made as given, with the accounts as its members, answering its id. */
const openWorkspaceNamed = (id: string, name: string, members: readonly string[]) =>
  Effect.gen(function* () {
    const db = yield* Database;
    yield* db
      .insert(organization)
      .values({ id, name, slug: `workspace-${id}`, createdAt: new Date(CREATED) });

    for (const userId of members) {
      yield* db
        .insert(member)
        .values({ id: randomUUID(), organizationId: id, userId, createdAt: new Date(CREATED) });
    }

    return id;
  });

afterEach(() => {
  vi.unstubAllEnvs();
});

it.layer(getTestDB())("server events", (it) => {
  it.effect(
    "posts the event under the account's hashed id with no person properties, its workspace's group, its own properties, the deployment, and no location",
    () => {
      // The layer reads the deployment's name as it is built, so it is named before.
      vi.stubEnv(DEPLOYMENT_VARIABLE, "preview");

      const processor = analytics({ ...RECORDING, posthogIngestHost: "https://eu.i.posthog.com" });

      return Effect.gen(function* () {
        yield* TestClock.setTime(NOW);
        const userId = yield* openUser;
        yield* agentStart(userId);
        expect(processor.posted).toEqual([
          {
            url: "https://eu.i.posthog.com/batch/",
            body: {
              api_key: "phc_project",
              historical_migration: false,
              batch: [
                {
                  event: "agent:start",
                  distinct_id: hashedId(userId),
                  timestamp: "2026-08-19T12:00:00.000Z",
                  properties: {
                    model: "anthropic/claude-opus-5.5",
                    effort: "high",
                    start_kind: "fresh",
                    is_from_automation: false,
                    started_by: "member",
                    has_task: true,
                    agent_kind: "coder",
                    $groups: { workspace: "workspace-1" },
                    $geoip_disable: true,
                    platform: "server",
                    environment: "preview",
                    $lib: "vespin-service",
                  },
                },
              ],
            },
          },
        ]);
      }).pipe(Effect.provide(processor.layer));
    },
  );

  it.effect(
    "posts a survey response as PostHog's survey SDKs do, under no person, keyed by each answered question",
    () => {
      vi.stubEnv(DEPLOYMENT_VARIABLE, "production");
      const processor = analytics(RECORDING);

      return Effect.gen(function* () {
        yield* TestClock.setTime(NOW);
        const userId = yield* openUser;
        yield* recordSurveyResponse({
          userId,
          surveyId: "survey-onboarding",
          surveyName: "Onboarding",
          answers: [
            {
              id: "q-where",
              responseKey: "$survey_response_q-where",
              question: "Where?",
              response: "A meetup",
            },
            {
              id: "q-why",
              responseKey: "$survey_response_q-why",
              question: "Why?",
              response: undefined,
            },
          ],
        });
        expect(itemsOf(processor.posted)).toEqual([
          {
            event: "survey sent",
            distinct_id: expect.not.stringContaining(userId),
            timestamp: "2026-08-19T12:00:00.000Z",
            properties: {
              $survey_id: "survey-onboarding",
              $survey_name: "Onboarding",
              $survey_completed: false,
              $survey_questions: [
                { id: "q-where", question: "Where?", response: "A meetup" },
                { id: "q-why", question: "Why?", response: null },
              ],
              "$survey_response_q-where": "A meetup",
              $process_person_profile: false,
              $geoip_disable: true,
              platform: "server",
              environment: "production",
              $lib: "vespin-service",
            },
          },
        ]);
      }).pipe(Effect.provide(processor.layer));
    },
  );

  it.effect("files an account's own event under no workspace", () => {
    const processor = analytics(RECORDING);

    return Effect.gen(function* () {
      yield* recordServerEvent(
        SERVER_EVENT.ACCOUNT_SIGN_UP,
        { userId: yield* openUser },
        { method: SERVER_SIGN_IN_METHOD.GITHUB },
      );
      const items = itemsOf(processor.posted);
      expect(items.map((item) => item.event)).toEqual(["account:sign_up"]);
      expect(items[0]?.properties).not.toHaveProperty("$groups");
    }).pipe(Effect.provide(processor.layer));
  });

  it.effect(
    "names a team's workspace group by its name and creation alone, beside its first event and again on a rename",
    () => {
      const processor = analytics(RECORDING);

      const named = () => namedGroups(processor.posted);

      return Effect.gen(function* () {
        const userId = yield* openUser;
        const teammate = yield* openUser;
        const workspaceId = yield* openWorkspaceNamed("workspace-acme", "Acme", [userId, teammate]);
        yield* agentStartIn(userId, workspaceId);
        yield* agentStartIn(userId, workspaceId);
        const db = yield* Database;
        yield* db
          .update(organization)
          .set({ name: "Acme Labs" })
          .where(eq(organization.id, workspaceId));
        yield* workspaceRenamed(userId, workspaceId);
        const created_at = new Date(CREATED).toISOString();
        const by = hashedId(userId);
        expect(named()).toEqual([
          { by, type: "workspace", key: workspaceId, set: { name: "Acme", created_at } },
          { by, type: "workspace", key: workspaceId, set: { name: "Acme Labs", created_at } },
        ]);
      }).pipe(Effect.provide(processor.layer));
    },
  );

  it.effect("names a workspace of one member by its key, never its name", () => {
    const processor = analytics(RECORDING);

    return Effect.gen(function* () {
      const userId = yield* openUser;
      const workspaceId = yield* openWorkspaceNamed("workspace-solo", "Ada's workspace", [userId]);
      yield* agentStartIn(userId, workspaceId);
      expect(namedGroups(processor.posted)).toEqual([
        {
          by: hashedId(userId),
          type: "workspace",
          key: workspaceId,
          set: { name: workspaceId, created_at: new Date(CREATED).toISOString() },
        },
      ]);
    }).pipe(Effect.provide(processor.layer));
  });

  it.effect.each([
    {
      lacking: "a project token",
      environment: { posthogDistinctIdKey: RECORDING.posthogDistinctIdKey },
    },
    {
      lacking: "the key ids are hashed under",
      environment: { posthogProjectApiKey: RECORDING.posthogProjectApiKey },
    },
  ])("records no count on a deployment without $lacking", ({ environment }) => {
    const processor = analytics(environment);

    return Effect.gen(function* () {
      yield* agentStart(yield* openUser);
      expect(processor.posted).toEqual([]);
    }).pipe(Effect.provide(processor.layer));
  });

  it.effect("a refusing processor costs the count, never the caller", () => {
    const processor = analytics(RECORDING, 500);

    return Effect.gen(function* () {
      const settled = yield* Effect.exit(agentStart(yield* openUser));
      expect(settled._tag).toBe("Success");
      expect(processor.posted).toHaveLength(1);
    }).pipe(Effect.provide(processor.layer));
  });

  it.effect("posts nothing for an account deleted before its event is captured", () => {
    const processor = analytics(RECORDING);

    return Effect.gen(function* () {
      const userId = yield* openUser;
      yield* Database.use((db) => db.delete(user).where(eq(user.id, userId)));
      yield* agentStart(userId);
      expect(processor.posted).toEqual([]);
    }).pipe(Effect.provide(processor.layer));
  });

  it.effect("a runtime that provides no analytics records nothing and still succeeds", () =>
    Effect.gen(function* () {
      const settled = yield* Effect.exit(agentStart("user-1"));
      expect(settled._tag).toBe("Success");
    }),
  );
});
