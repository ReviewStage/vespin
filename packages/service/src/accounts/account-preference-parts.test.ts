import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import {
  readAccountAccess,
  readAccountPreferences,
  writeAccountPreferences,
} from "@repo/database/models/account-store";
import { user } from "@repo/database/schemas/auth";
import { getTestDB } from "@repo/database/testing";
import { CHAPTERS_MODEL } from "@repo/features/chapters-model-choice";
import { LINK_OPEN } from "@repo/features/link-open";
import { type CatalogModel, MODEL_PROVIDER } from "@repo/features/models-wire";
import { PROVIDER_KEY_PROVIDER } from "@repo/features/provider-key-wire";
import { EXPERIMENT, SOUND_WHEN } from "@repo/settings";
import {
  HTTP_METHOD,
  isRecord,
  type UnparsedWireValue,
  unparsedWire,
  type WireBoundaryInput,
} from "@repo/wire";
import { COMPLETION_SOUND } from "@repo/wire/app-settings";
import { noNetwork } from "@repo/wire/testing";
import { Clock, Effect, Layer, Option } from "effect";
import { SqlClient } from "effect/sql";
import { accountFastOffer } from "../agents/coder-host/agent-runtime-choice.js";
import { HostedEnvironment, type HostedEnvironmentValues } from "../environment.js";
import { recordingProductAnalytics } from "../events/server-events.js";
import { HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "../http/http.js";
import { modelCatalogOf } from "../providers/model-catalog.js";
import { connectAgentApiKeys } from "../testing/agent-credentials.js";
import { hostedAnswer } from "../testing/hosted-route.js";
import { CONNECTOR_ASKED_NOTHING, integrationConnectOf } from "../testing/integration-connect.js";
import { accountProcedures } from "./account-procedures.js";

/**
 * The parts of the account's preferences snapshot that stand beside the
 * shared one, answered by the account procedures the way the hosted oRPC route answers
 * it, over a real dialect. The experiments: none until the account chooses,
 * a write that merges its keys over what stood and leaves the other parts as
 * they were, a key this deployment does not list passed over rather than
 * refused, and only a value that is not a record of choices refused. The
 * link choice: none until the account chooses, written on its own without
 * moving the instant a Mac reads as a snapshot to take, left standing by the
 * shared part a build that predates it writes back whole, and refused where
 * it names no choice. The chapters model: Haiku until the account chooses,
 * written on its own and read back, and refused where it names no model the
 * set offers. When and which sound plays as an agent finishes, and whether a notification is posted: none until
 * the account chooses, each written on its own and read back, and refused
 * where it names no choice. The agent default: GPT-6.1 Sol at high effort for an account
 * only an OpenAI key pays for until it stores one, an Effort kept on a model
 * no credential of the account's pays for, and a move to another such model
 * refused, keeping what stood. The bearer names the account and nothing else does.
 *
 * Synthetic accounts and bearers throughout.
 */

const ORIGIN = "https://app.test";
const PREFERENCES_PATH = "/api/account/preferences";

const OPUS: CatalogModel = {
  id: "anthropic/claude-opus-5.5",
  name: "Claude Opus 5.5",
  provider: MODEL_PROVIDER.ANTHROPIC,
  efforts: ["low", "medium", "high", "xhigh", "max"],
};

const OPUS_FAST: CatalogModel = { ...OPUS, id: "anthropic/claude-opus-5.5-fast" };

const SOL: CatalogModel = {
  id: "openai/gpt-6.1-sol",
  name: "GPT-6.1 Sol",
  provider: MODEL_PROVIDER.OPENAI,
  efforts: ["low", "high"],
};

const NO_ENVIRONMENT: HostedEnvironmentValues = {
  posthogPersonalApiKey: undefined,
  posthogProjectId: undefined,
  posthogApiHost: undefined,
  posthogProjectApiKey: undefined,
  posthogIngestHost: undefined,
  cronSecret: undefined,
  githubWebhookSecret: undefined,
  providerKeyEncryptionKeys: undefined,
  titleAnthropicApiKey: undefined,
  previewApiKeys: {},
};

/** What the procedures recorded for PostHog, across the file; a test reads its own account's. */
const ANALYTICS = recordingProductAnalytics();

interface Answer {
  readonly status: number;
  readonly body: WireBoundaryInput;
}

/** Two accounts behind their own bearers, and the procedures answering on the test's database and clock. */
const openAccounts = Effect.gen(function* () {
  const db = yield* Database;
  const [owner, other] = [`user-${randomUUID()}`, `user-${randomUUID()}`];
  for (const id of [owner, other]) {
    yield* db.insert(user).values({ id, name: "Test User", email: `${id}@app.test` });
  }
  const bearers = new Map([
    [`Bearer ${owner}`, owner],
    [`Bearer ${other}`, other],
  ]);
  const procedures = accountProcedures({
    resolveUserId: (incoming) =>
      Effect.succeed(
        Option.fromNullishOr(bearers.get(incoming.headers.get("authorization") ?? "")),
      ),
    readPreferences: readAccountPreferences,
    readAccess: readAccountAccess,
    accountFastOffer,
    writePreferences: writeAccountPreferences,
  });
  return { owner, other, ask: (request: Request) => answer(procedures, request) };
});

const answer = (procedures: ReturnType<typeof accountProcedures>, request: Request) =>
  Effect.gen(function* () {
    const client = yield* SqlClient.SqlClient;
    // The procedures run on oRPC's own fiber, so they are handed the test's clock and services.
    const services = Layer.mergeAll(
      Layer.succeed(SqlClient.SqlClient, client),
      Layer.succeed(Database, yield* Database),
      Layer.succeed(Clock.Clock, yield* Clock.Clock),
      Layer.succeed(HostedEnvironment, NO_ENVIRONMENT),
      noNetwork,
      modelCatalogOf([OPUS, OPUS_FAST, SOL]),
      // Only a delete asks Connect anything, and this suite deletes nothing.
      integrationConnectOf(() => CONNECTOR_ASKED_NOTHING),
      ANALYTICS.layer,
    );
    const response = yield* hostedAnswer({ account: procedures }, services, request);
    const text = yield* Effect.promise(() => response.text());
    // SAFETY: the route answers JSON; the test compares it as the wire value it is.
    const body = JSON.parse(text) as WireBoundaryInput;
    return { status: response.status, body } satisfies Answer;
  });

function request(userId: string, body?: WireBoundaryInput) {
  return new Request(new URL(PREFERENCES_PATH, ORIGIN), {
    method: body === undefined ? HTTP_METHOD.GET : HTTP_METHOD.PUT,
    headers: {
      authorization: `Bearer ${userId}`,
      ...(body === undefined ? undefined : { "content-type": "application/json" }),
    },
    ...(body === undefined ? undefined : { body: JSON.stringify(body) }),
  });
}

/** One part of an answered snapshot, failing the test where the answer is not one. */
function partOf(answered: Answer, part: string): UnparsedWireValue {
  assert.equal(answered.status, HOSTED_HTTP_STATUS.OK, JSON.stringify(answered.body));
  const body = unparsedWire(answered.body);
  if (!isRecord(body)) return assert.fail("the snapshot is not a record");
  return body[part];
}

it.layer(getTestDB())("the preferences snapshot's experiments part", (it) => {
  it.effect("is empty until the account chooses, and merges each write over what stood", () =>
    Effect.gen(function* () {
      const { owner, ask } = yield* openAccounts;
      assert.deepEqual(partOf(yield* ask(request(owner)), "experiments"), {});

      const turnedOn = yield* ask(request(owner, { experiments: { [EXPERIMENT.MEMORY]: true } }));
      assert.deepEqual(partOf(turnedOn, "experiments"), { [EXPERIMENT.MEMORY]: true });

      // The shared part's own write leaves the experiments standing.
      const shared = yield* ask(request(owner, { preferences: {} }));
      assert.deepEqual(partOf(shared, "experiments"), { [EXPERIMENT.MEMORY]: true });
      const turnedOff = yield* ask(request(owner, { experiments: { [EXPERIMENT.MEMORY]: false } }));
      assert.deepEqual(partOf(turnedOff, "experiments"), { [EXPERIMENT.MEMORY]: false });
    }),
  );

  it.effect("passes over a key this deployment does not list, and refuses what is no record", () =>
    Effect.gen(function* () {
      const { owner, ask } = yield* openAccounts;
      const newer = yield* ask(
        request(owner, { experiments: { [EXPERIMENT.MEMORY]: true, newer: true } }),
      );
      assert.deepEqual(partOf(newer, "experiments"), { [EXPERIMENT.MEMORY]: true });

      const refused = yield* ask(request(owner, { experiments: [EXPERIMENT.MEMORY] }));
      assert.deepEqual(refused, {
        status: HOSTED_HTTP_STATUS.BAD_REQUEST,
        body: { error: HOSTED_API_ERROR.INVALID_REQUEST },
      });
      assert.deepEqual(partOf(yield* ask(request(owner)), "experiments"), {
        [EXPERIMENT.MEMORY]: true,
      });
    }),
  );

  it.effect("answers the bearer's own account's choices and no other's", () =>
    Effect.gen(function* () {
      const { owner, other, ask } = yield* openAccounts;
      yield* ask(request(owner, { experiments: { [EXPERIMENT.MEMORY]: true } }));
      assert.deepEqual(partOf(yield* ask(request(other)), "experiments"), {});
    }),
  );
});

it.layer(getTestDB())("the preferences snapshot's link part", (it) => {
  it.effect("is absent until the account chooses, and a write of it alone moves no instant", () =>
    Effect.gen(function* () {
      const { owner, other, ask } = yield* openAccounts;
      assert.equal(partOf(yield* ask(request(owner)), "linkOpen"), undefined);

      const chosen = yield* ask(request(owner, { linkOpen: LINK_OPEN.MAC_APP }));
      assert.equal(partOf(chosen, "linkOpen"), LINK_OPEN.MAC_APP);
      assert.deepEqual(partOf(chosen, "preferences"), {});
      // Note that a Mac reads the instant as a snapshot to take over its own shared part, which this write carried none of.
      assert.equal(partOf(chosen, "updatedAt"), undefined);
      assert.equal(partOf(yield* ask(request(other)), "linkOpen"), undefined);
    }),
  );

  it.effect("stands through the shared part a build that predates it writes back whole", () =>
    Effect.gen(function* () {
      const { owner, ask } = yield* openAccounts;
      yield* ask(request(owner, { preferences: {}, linkOpen: LINK_OPEN.MAC_APP }));

      // Note that the voice an older build still writes is a preference this deployment no longer keeps.
      const olderBuild = yield* ask(request(owner, { preferences: { voice: "marin" } }));
      assert.deepEqual(partOf(olderBuild, "preferences"), {});
      assert.equal(partOf(olderBuild, "linkOpen"), LINK_OPEN.MAC_APP);

      const backToBrowser = yield* ask(request(owner, { linkOpen: LINK_OPEN.BROWSER }));
      assert.equal(partOf(backToBrowser, "linkOpen"), LINK_OPEN.BROWSER);
    }),
  );

  it.effect("the shared part passes over a preference this deployment does not know", () =>
    Effect.gen(function* () {
      const { owner, ask } = yield* openAccounts;
      const newer = yield* ask(request(owner, { preferences: { newer: true } }));
      assert.deepEqual(partOf(newer, "preferences"), {});
    }),
  );

  it.effect("refuses a link part naming no choice, and keeps what stood", () =>
    Effect.gen(function* () {
      const { owner, ask } = yield* openAccounts;
      yield* ask(request(owner, { linkOpen: LINK_OPEN.MAC_APP }));

      const refused = yield* ask(request(owner, { linkOpen: "elsewhere" }));
      assert.deepEqual(refused, {
        status: HOSTED_HTTP_STATUS.BAD_REQUEST,
        body: { error: HOSTED_API_ERROR.INVALID_REQUEST },
      });
      assert.equal(partOf(yield* ask(request(owner)), "linkOpen"), LINK_OPEN.MAC_APP);
    }),
  );
});

it.layer(getTestDB())("the preferences snapshot's sound and notification parts", (it) => {
  it.effect("are absent until the account chooses, and a choice written is the one read back", () =>
    Effect.gen(function* () {
      const { owner, other, ask } = yield* openAccounts;
      assert.equal(partOf(yield* ask(request(owner)), "soundWhen"), undefined);
      assert.equal(partOf(yield* ask(request(owner)), "completionSound"), undefined);
      assert.equal(partOf(yield* ask(request(owner)), "askSound"), undefined);
      assert.equal(partOf(yield* ask(request(owner)), "turnNotifications"), undefined);

      yield* ask(request(owner, { soundWhen: SOUND_WHEN.BACKGROUND }));
      yield* ask(request(owner, { completionSound: COMPLETION_SOUND.QUACK }));
      yield* ask(request(owner, { askSound: COMPLETION_SOUND.QUESTION }));
      const chosen = yield* ask(request(owner, { turnNotifications: true }));
      assert.equal(partOf(chosen, "soundWhen"), SOUND_WHEN.BACKGROUND);
      assert.equal(partOf(chosen, "completionSound"), COMPLETION_SOUND.QUACK);
      assert.equal(partOf(chosen, "askSound"), COMPLETION_SOUND.QUESTION);
      assert.equal(partOf(chosen, "turnNotifications"), true);
      assert.equal(partOf(chosen, "updatedAt"), undefined);
      assert.equal(partOf(yield* ask(request(other)), "soundWhen"), undefined);
      assert.equal(partOf(yield* ask(request(other)), "completionSound"), undefined);
      assert.equal(partOf(yield* ask(request(other)), "askSound"), undefined);
      assert.equal(partOf(yield* ask(request(other)), "turnNotifications"), undefined);
    }),
  );

  it.effect("refuses a part naming no choice, and keeps what stood", () =>
    Effect.gen(function* () {
      const { owner, ask } = yield* openAccounts;
      yield* ask(
        request(owner, {
          soundWhen: SOUND_WHEN.ALWAYS,
          completionSound: COMPLETION_SOUND.BELL,
          askSound: COMPLETION_SOUND.QUESTION,
          turnNotifications: true,
        }),
      );
      for (const refused of [
        { soundWhen: "sometimes" },
        { completionSound: "kazoo" },
        { askSound: "kazoo" },
        { turnNotifications: "yes" },
      ]) {
        assert.deepEqual(yield* ask(request(owner, refused)), {
          status: HOSTED_HTTP_STATUS.BAD_REQUEST,
          body: { error: HOSTED_API_ERROR.INVALID_REQUEST },
        });
      }
      const kept = yield* ask(request(owner));
      assert.equal(partOf(kept, "soundWhen"), SOUND_WHEN.ALWAYS);
      assert.equal(partOf(kept, "completionSound"), COMPLETION_SOUND.BELL);
      assert.equal(partOf(kept, "askSound"), COMPLETION_SOUND.QUESTION);
      assert.equal(partOf(kept, "turnNotifications"), true);
    }),
  );
});

it.layer(getTestDB())("the preferences snapshot's survey part", (it) => {
  it.effect(
    "keeps the account's answers with their words beside Other, records them for PostHog's onboarding survey once, keeps no key it does not name and no other account's, and refuses an answer no set offers or words beside no Other",
    () =>
      Effect.gen(function* () {
        const { owner, other, ask } = yield* openAccounts;
        const answers = '{"referral":"other","referralOther":"A meetup","role":"founder"}';
        assert.equal(
          partOf(yield* ask(request(owner, { onboardingSurvey: answers })), "onboardingSurvey"),
          answers,
        );
        // Note that the same answers written again, as a retry or another machine's sync writes them, post nothing more, and a key the survey does not name is not kept.
        const padded =
          '{"referral":"other","referralOther":"A meetup","role":"founder","notes":"x"}';
        assert.equal(
          partOf(yield* ask(request(owner, { onboardingSurvey: padded })), "onboardingSurvey"),
          answers,
        );
        assert.equal(partOf(yield* ask(request(other)), "onboardingSurvey"), undefined);

        // Note that words beside no Other are refused as an answer no set offers is.
        for (const refused of [
          '{"referral":"a billboard"}',
          '{"role":"founder","roleOther":"CEO"}',
          '{"role":"other","roleOther":"  "}',
        ]) {
          assert.deepEqual(yield* ask(request(owner, { onboardingSurvey: refused })), {
            status: HOSTED_HTTP_STATUS.BAD_REQUEST,
            body: { error: HOSTED_API_ERROR.INVALID_REQUEST },
          });
        }
        assert.equal(partOf(yield* ask(request(owner)), "onboardingSurvey"), answers);

        // Note that the response keys are the ones the onboarding survey's Slack destination in PostHog reads.
        const recorded = ANALYTICS.responses.filter((response) => response.userId === owner);
        assert.deepEqual(
          recorded.map((response) => [
            response.surveyName,
            response.answers.map((answer) => [answer.responseKey, answer.response]),
          ]),
          [
            [
              "Onboarding",
              [
                ["$survey_response_e1bfce32-292a-4a8c-a63c-751003d06501", "A meetup"],
                ["$survey_response_977afcf0-6d7b-4b69-a758-3e8487161ea1", "Founder"],
                ["$survey_response_b5f283ca-a870-4fc9-ae2a-a0b673b4fda0", undefined],
              ],
            ],
          ],
        );
      }),
  );
});

it.layer(getTestDB())("the preferences snapshot's chapters model part", (it) => {
  it.effect(
    "is Haiku until the account chooses, and a choice written is the one read back, OpenAI's model of a tier among them",
    () =>
      Effect.gen(function* () {
        const { owner, other, ask } = yield* openAccounts;
        assert.equal(partOf(yield* ask(request(owner)), "chaptersModel"), CHAPTERS_MODEL.HAIKU);

        const chosen = yield* ask(request(owner, { chaptersModel: CHAPTERS_MODEL.SONNET }));
        assert.equal(partOf(chosen, "chaptersModel"), CHAPTERS_MODEL.SONNET);
        assert.equal(partOf(chosen, "updatedAt"), undefined);
        assert.equal(partOf(yield* ask(request(owner)), "chaptersModel"), CHAPTERS_MODEL.SONNET);
        assert.equal(partOf(yield* ask(request(other)), "chaptersModel"), CHAPTERS_MODEL.HAIKU);

        // OpenAI's model of Haiku's tier, as the Chapters tab picks it, is kept as well.
        const openAi = yield* ask(request(owner, { chaptersModel: "gpt-6-luna" }));
        assert.equal(partOf(openAi, "chaptersModel"), "gpt-6-luna");
      }),
  );

  it.effect("refuses a model the set does not offer, and keeps what stood", () =>
    Effect.gen(function* () {
      const { owner, ask } = yield* openAccounts;
      yield* ask(request(owner, { chaptersModel: CHAPTERS_MODEL.OPUS }));
      for (const offered of ["gpt-5.5", "anthropic/claude-opus-5.5", 3]) {
        assert.deepEqual(yield* ask(request(owner, { chaptersModel: offered })), {
          status: HOSTED_HTTP_STATUS.BAD_REQUEST,
          body: { error: HOSTED_API_ERROR.INVALID_REQUEST },
        });
      }
      assert.equal(partOf(yield* ask(request(owner)), "chaptersModel"), CHAPTERS_MODEL.OPUS);
    }),
  );
});

it.layer(getTestDB())("the preferences snapshot's agent part", (it) => {
  it.effect(
    "keeps an Effort on a model nothing pays for, and refuses moving to another such model",
    () =>
      Effect.gen(function* () {
        const { owner, ask } = yield* openAccounts;
        yield* connectAgentApiKeys(owner, { providers: [PROVIDER_KEY_PROVIDER.OPENAI] });
        // Note that the Claude default stands from before, as one saved while a Claude credential paid for it.
        yield* writeAccountPreferences(owner, { agent: { model: OPUS.id, effort: "high" } });
        const lowEffort = { model: OPUS.id, effort: "low" };
        assert.deepEqual(
          partOf(yield* ask(request(owner, { agent: lowEffort })), "agent"),
          lowEffort,
        );

        // Note that an account with no Anthropic key of its own is offered every fast version, so only the payer refuses this one.
        const opusFast = yield* ask(
          request(owner, { agent: { model: OPUS_FAST.id, effort: "high" } }),
        );
        assert.deepEqual(opusFast, {
          status: HOSTED_HTTP_STATUS.BAD_REQUEST,
          body: { error: HOSTED_API_ERROR.INVALID_REQUEST },
        });
        assert.deepEqual(partOf(yield* ask(request(owner)), "agent"), lowEffort);
      }),
  );

  it.effect("is GPT-6.1 Sol for an account only an OpenAI key pays for, until it stores one", () =>
    Effect.gen(function* () {
      const { owner, ask } = yield* openAccounts;
      yield* connectAgentApiKeys(owner, { providers: [PROVIDER_KEY_PROVIDER.OPENAI] });
      assert.deepEqual(partOf(yield* ask(request(owner)), "agent"), {
        model: "openai/gpt-6.1-sol",
        effort: "high",
      });
    }),
  );
});
