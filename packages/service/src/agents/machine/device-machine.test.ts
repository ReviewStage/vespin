/**
 * device-machine.test.ts -- a local agent's machine over a real dialect: its launch laid out under the agents folder its Mac registered, its launch's secrets sealed in the row and handed over open once, a read that waits for its Mac's answer or is unavailable while the Mac is away, a launch or a message refused while it is away, a turn whose runner the Mac settled as gone settled lost, a run taken from a Mac quiet past its lease, and, over the sync hub, every write to the agent's lines and requests notifying its account, which wakes the Mac's held reads and the machine's waits within a coalesce window.
 *
 * Synthetic accounts, agents, Macs, bearers, and keys throughout.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { RUNNER_LOST_DETAIL } from "@repo/database/models/abandoned-turns";
import {
  hasRepository,
  latestTurnsOfReached,
  recordAgentRunnerToken,
} from "@repo/database/models/agent-store";
import {
  answerDeviceAgentRequest,
  claimDeviceAgentRequest,
  deviceAgentLineStanding,
  deviceAgentLinesWaiting,
  deviceAgentRequestsWaiting,
  queueDeviceAgentRequest,
  settleDeviceAgentLine,
  stepDeviceAgentLaunch,
  withdrawDeviceAgentRequest,
  withdrawExpiredDeviceAgentRows,
} from "@repo/database/models/device-agent-store";
import { beatDevice, registerDevice } from "@repo/database/models/device-store";
import { enrollOwnDevice, removeHost } from "@repo/database/models/host-store";
import { storeWriter } from "@repo/database/models/writer";
import { agentTable } from "@repo/database/schemas/agent";
import { device } from "@repo/database/schemas/device";
import { deviceAgentLine } from "@repo/database/schemas/device-agent";
import { MESSAGE_SENDER } from "@repo/database/storage-vocabulary";
import { type SyncTopic, TOPIC } from "@repo/database/sync/notification";
import { DEVICE_LAYOUT, expectTopicsFire, getTestDB } from "@repo/database/testing";
import { AGENT_FAILURE } from "@repo/features/agent-wire";
import { CHECKOUT_DIFF_EXIT } from "@repo/features/checkout-diff";
import { CHECKOUT_RESTORE_EXIT } from "@repo/features/checkout-restore";
import {
  DEVICE_AGENT_LINE_KIND,
  DEVICE_AGENT_REQUEST_KIND,
  DEVICE_CAPABILITY,
  DEVICE_LAUNCH_STEP,
  DEVICE_LAUNCH_UNSTARTED,
  type DeviceLaunchStep,
  type DeviceLaunchUnstarted,
  deviceAgentFilesPayloadSchema,
  deviceAgentLaunchPayloadSchema,
} from "@repo/features/device-agent-wire";
import { TURN_FAILURE } from "@repo/features/turn-run";
import { SandboxUnavailable } from "@repo/sandbox";
import { memorySandbox } from "@repo/sandbox/testing";
import { TURN_ORIGIN, TURN_STATUS } from "@repo/wire";
import { eq } from "drizzle-orm";
import { Clock, Effect, Fiber, Layer, Option, Redacted, Schema } from "effect";
import { TestClock } from "effect/testing";
import { HostedEnvironment, type HostedEnvironmentValues } from "../../environment.js";
import {
  GITHUB_FIXTURE_BOT,
  githubReaching,
  type InstallationFixture,
  NO_GITHUB,
} from "../../testing/github-app-fake.js";
import { openLocalAgent } from "../../testing/local-agent.js";
import { sandboxDouble } from "../../testing/repository-sandbox.js";
import { wokenOnHub } from "../../testing/sync-woken.js";
import {
  agentCheckoutPlan,
  agentRepositoryRead,
  cloneAgentRepository,
  finishCheckoutWith,
  repositoryCredentialOf,
} from "../coder-host/checkout.js";
import { reconcileAgent } from "../coder-host/reconcile.js";
import {
  agentFailureOf,
  hostLostOf,
  launchStoppedOf,
  launchUnstartedOf,
} from "../coder-host/status.js";
import {
  claimedDeviceAgentLine,
  deviceAgentLinesFor,
  deviceAgentRequestsFor,
  settledDeviceAgentLine,
} from "../device-agent.js";
import { CHECKOUT_DIFF_OUTCOME, LaunchRefused, RESTORE_OUTCOME } from "./agent-machine.js";
import { deviceMachine, MAC_MACHINE } from "./device-machine.js";

const RING = `1:${Buffer.alloc(32, 7).toString("base64")}`;
const BEARER = "fixture-runner-bearer-0123456789";
const PLAN_TOKEN = "sk-ant-oat01-fixture-plan-token";
const FIRST_LINES = '{"harness":"claude_code"}\n{"type":"message"}\n';
const ENV = { CLAUDE_CODE_OAUTH_TOKEN: PLAN_TOKEN, APP_RUNNER_BEARER: BEARER };

const ENVIRONMENT: HostedEnvironmentValues = {
  posthogPersonalApiKey: undefined,
  posthogProjectId: undefined,
  posthogApiHost: undefined,
  posthogProjectApiKey: undefined,
  posthogIngestHost: undefined,
  cronSecret: undefined,
  githubWebhookSecret: undefined,
  providerKeyEncryptionKeys: Redacted.make(RING),
  titleAnthropicApiKey: undefined,
  previewApiKeys: {},
};

/** The repository an agent works in where a test gives it one, and the installation reaching it. */
const RELAY = { owner: "Acme", name: "Relay", defaultBranch: "trunk" } as const;

const RELAY_INSTALLATION: InstallationFixture = {
  id: 31,
  login: RELAY.owner,
  repositories: [RELAY],
};

/** The runner launched in the agent's place, found by its session as a relaunch finds it. */
const launched = (opened: Effect.Success<ReturnType<typeof openLocalAgent>>) =>
  Effect.gen(function* () {
    const machine = yield* deviceMachine;
    const found = Option.getOrUndefined(yield* machine.findPlace(opened.userId, opened.session));
    assert.ok(found?.running !== undefined, "a local agent's place always stands");

    return yield* machine.launchRunner(found.running, {
      env: ENV,
      userId: opened.userId,
      agentId: opened.agent.id,
      name: found.name,
      ready: Effect.void,
      firstLines: () => Effect.succeed({ lines: FIRST_LINES, mark: { firstSequence: 4 } }),
      abandon: () => Effect.void,
    });
  });

/** The developer's message to the agent written as its send writes it, with the turn it queues. */
const messageSent = (opened: Effect.Success<ReturnType<typeof openLocalAgent>>) =>
  Effect.flatMap(storeWriter({ tools: {} }), (writer) =>
    writer.writeAwaitingLine(
      { userId: opened.userId, conversationId: opened.agent.conversationId },
      { text: "Draft the plan.", clientKey: "plan", sender: { kind: MESSAGE_SENDER.APP } },
      Effect.succeed(true),
    ),
  );

/** Lets a forked read's statements run until its request waits for the Mac. */
const untilAsked = (userId: string, deviceId: string) =>
  Effect.gen(function* () {
    while ((yield* deviceAgentRequestsWaiting(userId, deviceId)).length === 0)
      yield* Effect.yieldNow;
    const [request] = yield* deviceAgentRequestsWaiting(userId, deviceId);

    return Option.getOrThrow(Option.fromNullishOr(request));
  });

/** The first line waiting for the agent's Mac, once one does. */
const untilQueued = (userId: string, deviceId: string) =>
  Effect.gen(function* () {
    while ((yield* deviceAgentLinesWaiting(userId, deviceId)).length === 0) yield* Effect.yieldNow;
    const [line] = yield* deviceAgentLinesWaiting(userId, deviceId);

    return Option.getOrThrow(Option.fromNullishOr(line));
  });

/** GitHub unreached, and sandboxes kept in memory, which a Mac's agent never reaches. */
const NO_REACH = Layer.merge(NO_GITHUB, memorySandbox().layer);

it.layer(Layer.mergeAll(getTestDB(), Layer.succeed(HostedEnvironment, ENVIRONMENT), NO_REACH))(
  "a local agent's machine",
  (it) => {
    it.effect(
      "an agent on a host its account removed is refused by name, one on a host from before the folders a launch lays out as away, and one on no Mac of the account's as before",
      () =>
        Effect.gen(function* () {
          const { userId, deviceId, agent } = yield* openLocalAgent();
          const machine = yield* deviceMachine;
          const db = yield* Database;
          // The Mac stands as a host from before its temp and attachments folders registered it.
          yield* db
            .update(device)
            .set({ tempFolder: null, attachmentsFolder: null })
            .where(eq(device.id, deviceId));
          const outdated = yield* Effect.flip(machine.layout(agent));
          // The Mac the agent is pinned to is enrolled and removed, as Settings › Hosts removes one.
          yield* enrollOwnDevice(userId, {
            id: deviceId,
            version: "0.1.0",
            secretHash: `secret-${randomUUID()}`,
          });

          const unregistered = yield* Effect.flip(
            machine.layout({ ...agent, deviceId: randomUUID() }),
          );

          assert.notEqual(yield* removeHost(userId, deviceId), undefined);

          const refused = yield* Effect.flip(machine.layout(agent));

          assert.ok(refused instanceof LaunchRefused);
          assert.equal(refused.deviceRemoved, true);
          assert.ok(outdated instanceof LaunchRefused);
          assert.equal(outdated.deviceAway, true, "a host from before its folders reads away");
          assert.ok(unregistered instanceof LaunchRefused);
          assert.equal(
            unregistered.deviceRemoved,
            undefined,
            "a device never removed is no removed host",
          );
        }),
    );

    it.effect(
      "a launch on a Mac that registered its own agents folder is laid out under that folder, whatever this build's root",
      () =>
        Effect.gen(function* () {
          const opened = yield* openLocalAgent();
          // The Mac registers again, as a host whose release moved its agents' root would.
          yield* registerDevice(opened.userId, {
            id: opened.deviceId,
            name: "Studio",
            ...DEVICE_LAYOUT,
            agentsFolder: "/Users/fixture/.elsewhere/agents",
          });
          const { handle } = yield* launched(opened);
          const db = yield* Database;

          const [row] = yield* db
            .select({ payload: deviceAgentLine.payload })
            .from(deviceAgentLine)
            .where(eq(deviceAgentLine.id, handle.command));

          const payload = Schema.decodeUnknownSync(deviceAgentLaunchPayloadSchema)(row?.payload);

          assert.equal(
            payload.checkoutPath,
            `/Users/fixture/.elsewhere/agents/${opened.agent.id}/repository`,
          );
        }),
    );

    it.effect("a launch's secrets are sealed in its line and handed over open once", () =>
      Effect.gen(function* () {
        const opened = yield* openLocalAgent();
        const { handle } = yield* launched(opened);
        const db = yield* Database;

        const [row] = yield* db
          .select({ sealed: deviceAgentLine.sealedSecrets, payload: deviceAgentLine.payload })
          .from(deviceAgentLine)
          .where(eq(deviceAgentLine.id, handle.command));

        const stored = JSON.stringify(row);

        const first = yield* claimedDeviceAgentLine(opened.userId, opened.deviceId, handle.command);

        const second = yield* claimedDeviceAgentLine(
          opened.userId,
          opened.deviceId,
          handle.command,
        );

        const [after] = yield* db
          .select({ sealed: deviceAgentLine.sealedSecrets })
          .from(deviceAgentLine)
          .where(eq(deviceAgentLine.id, handle.command));

        assert.notEqual(row?.sealed ?? null, null, "the line carries its secrets sealed");

        for (const secret of [BEARER, PLAN_TOKEN, Buffer.from(BEARER).toString("base64")]) {
          assert.ok(!stored.includes(secret), "no secret stands in the row in the clear");
        }

        assert.deepEqual(
          Option.map(first, (claimed) => ("secrets" in claimed ? claimed.secrets : undefined)),
          Option.some({ env: ENV, stdin: FIRST_LINES }),
        );
        assert.ok(Option.isNone(second), "a line is claimed once");
        assert.equal(after?.sealed, null, "the claim clears the row's copy");
      }),
    );

    it.effect(
      "a launch in a repository carries who the agent's commits are by, as the cloud's checkout sets it",
      () =>
        Effect.gen(function* () {
          const opened = yield* openLocalAgent({ installation: RELAY_INSTALLATION });
          const github = githubReaching([RELAY_INSTALLATION]);
          const { handle } = yield* launched(opened).pipe(Effect.provide(github.layer));
          const db = yield* Database;

          const [row] = yield* db
            .select({ payload: deviceAgentLine.payload })
            .from(deviceAgentLine)
            .where(eq(deviceAgentLine.id, handle.command));

          const payload = Schema.decodeUnknownSync(deviceAgentLaunchPayloadSchema)(row?.payload);
          // The same agent's checkout in a cloud sandbox, finished as its launch finishes it.
          const { agent } = opened;
          assert.ok(hasRepository(agent));
          const target = { userId: opened.userId, conversationId: agent.conversationId };
          const sandbox = sandboxDouble(() => undefined);
          yield* Effect.gen(function* () {
            const read = yield* agentRepositoryRead(target, agent);
            yield* cloneAgentRepository(agent, sandbox, read);
            yield* finishCheckoutWith(
              sandbox,
              yield* agentCheckoutPlan(target, agent, repositoryCredentialOf(read)),
            );
          }).pipe(Effect.provide(github.layer));

          // A member with no GitHub sign-in writes as the App's bot, at the noreply address GitHub links to it.
          const bot = {
            name: GITHUB_FIXTURE_BOT.login,
            email: `${GITHUB_FIXTURE_BOT.id}+${GITHUB_FIXTURE_BOT.login}@users.noreply.github.com`,
          };

          assert.deepEqual(payload.identity, bot);
          assert.deepEqual(sandbox.identities, [bot]);
        }),
    );

    it.effect(
      "a launch of an agent in a repository to a host from before it works in every repository on its own GitHub sign-in is refused, queuing nothing",
      () =>
        Effect.gen(function* () {
          // Note that an installation of its own is linked, since another test linked the first.
          const installation = { ...RELAY_INSTALLATION, id: RELAY_INSTALLATION.id + 1 };
          const opened = yield* openLocalAgent({ installation, hostPredatesOwnSignIn: true });
          const github = githubReaching([installation]);
          const refused = yield* Effect.flip(launched(opened).pipe(Effect.provide(github.layer)));

          assert.ok(refused instanceof LaunchRefused);
          assert.equal(refused.reason, "host predates its own github sign-in");
          assert.deepEqual(yield* deviceAgentLinesWaiting(opened.userId, opened.deviceId), []);
        }),
    );

    it.effect(
      "a restore queues a restore line with the snapshot for the agent's Mac and answers as the Mac settles it, and a Mac whose host takes no such line restores nothing, queuing none",
      () =>
        Effect.gen(function* () {
          const { userId, deviceId, session } = yield* openLocalAgent();
          const machine = yield* deviceMachine;

          const snapshot = {
            commit: "0123456789abcdef0123456789abcdef01234567",
            head: "89abcdef0123456789abcdef0123456789abcdef",
            branch: "feat/invitations",
          };

          assert.equal(
            yield* machine.restoreCheckout(session, snapshot),
            RESTORE_OUTCOME.UNSUPPORTED,
          );
          assert.deepEqual(yield* deviceAgentLinesWaiting(userId, deviceId), []);

          // The Mac's host registers that it takes the line, as a newer release does.
          yield* registerDevice(userId, {
            id: deviceId,
            name: "Studio",
            ...DEVICE_LAYOUT,
            capabilities: [DEVICE_CAPABILITY.RESTORE_CHECKOUT],
          });
          const restoring = yield* Effect.forkChild(machine.restoreCheckout(session, snapshot));
          const line = yield* untilQueued(userId, deviceId);
          assert.equal(line.kind, DEVICE_AGENT_LINE_KIND.RESTORE);
          assert.deepEqual(line.payload, snapshot);
          yield* claimedDeviceAgentLine(userId, deviceId, line.id);
          yield* settleDeviceAgentLine(userId, deviceId, line.id, CHECKOUT_RESTORE_EXIT.MISSING);
          yield* TestClock.adjust("1 second");
          assert.equal(yield* Fiber.join(restoring), RESTORE_OUTCOME.MISSING);

          const again = yield* Effect.forkChild(machine.restoreCheckout(session, snapshot));
          const second = yield* untilQueued(userId, deviceId);
          yield* claimedDeviceAgentLine(userId, deviceId, second.id);
          yield* settleDeviceAgentLine(userId, deviceId, second.id, 0);
          yield* TestClock.adjust("1 second");
          assert.equal(yield* Fiber.join(again), RESTORE_OUTCOME.RESTORED);

          // A line the Mac never takes fails the restore once the wait ends, and is withdrawn with it.
          const unclaimed = yield* Effect.forkChild(machine.restoreCheckout(session, snapshot));
          const third = yield* untilQueued(userId, deviceId);
          yield* TestClock.adjust(MAC_MACHINE.RESTORE_WAIT);
          assert.equal(yield* Fiber.join(unclaimed), RESTORE_OUTCOME.FAILED);
          assert.deepEqual(
            (yield* deviceAgentLinesWaiting(userId, deviceId)).map((line) => line.id),
            [],
            `the line ${third.id} is withdrawn`,
          );
        }),
    );

    it.effect(
      "a diff asks the agent's Mac for it with the two sides and answers what the script printed, and a Mac whose host takes no such request diffs nothing, asking none",
      () =>
        Effect.gen(function* () {
          const { userId, deviceId, session } = yield* openLocalAgent();
          const machine = yield* deviceMachine;
          const range = { from: "0123456789abcdef0123456789abcdef01234567", to: null };

          assert.deepEqual(yield* machine.diffCheckout(session, range), {
            outcome: CHECKOUT_DIFF_OUTCOME.UNSUPPORTED,
          });
          assert.deepEqual(yield* deviceAgentRequestsWaiting(userId, deviceId), []);

          yield* registerDevice(userId, {
            id: deviceId,
            name: "Studio",
            ...DEVICE_LAYOUT,
            capabilities: [DEVICE_CAPABILITY.DIFF_CHECKOUT],
          });
          const diffing = yield* Effect.forkChild(machine.diffCheckout(session, range));
          const request = yield* untilAsked(userId, deviceId);
          assert.deepEqual(
            [request.kind, request.args],
            [DEVICE_AGENT_REQUEST_KIND.DIFF_CHECKOUT, range],
          );
          yield* claimDeviceAgentRequest(userId, deviceId, request.id);
          yield* answerDeviceAgentRequest(userId, deviceId, request.id, {
            kind: DEVICE_AGENT_REQUEST_KIND.DIFF_CHECKOUT,
            exit: 0,
            diff: "diff --git a/x b/x\n",
          });
          yield* TestClock.adjust("1 second");
          assert.deepEqual(yield* Fiber.join(diffing), {
            outcome: CHECKOUT_DIFF_OUTCOME.DIFFED,
            diff: "diff --git a/x b/x\n",
          });

          const gone = yield* Effect.forkChild(machine.diffCheckout(session, range));
          const again = yield* untilAsked(userId, deviceId);
          yield* claimDeviceAgentRequest(userId, deviceId, again.id);
          yield* answerDeviceAgentRequest(userId, deviceId, again.id, {
            kind: DEVICE_AGENT_REQUEST_KIND.DIFF_CHECKOUT,
            exit: CHECKOUT_DIFF_EXIT.MISSING,
            diff: "",
          });
          yield* TestClock.adjust("1 second");
          assert.deepEqual(yield* Fiber.join(gone), { outcome: CHECKOUT_DIFF_OUTCOME.MISSING });
        }),
    );

    it.effect("a read waits for its Mac's answer, and is unavailable while the Mac is away", () =>
      Effect.gen(function* () {
        const { userId, deviceId, session } = yield* openLocalAgent();
        const machine = yield* deviceMachine;
        const bytes = new Uint8Array([137, 80, 78, 71]);

        const reading = yield* Effect.forkChild(machine.readFile(session, "/tmp/shot.png", 1_024));
        const request = yield* untilAsked(userId, deviceId);
        yield* claimDeviceAgentRequest(userId, deviceId, request.id);
        yield* answerDeviceAgentRequest(userId, deviceId, request.id, {
          kind: DEVICE_AGENT_REQUEST_KIND.READ_FILE,
          bytes,
        });
        yield* TestClock.adjust("1 second");
        const answered = yield* Fiber.join(reading);

        yield* TestClock.adjust("1 minute");
        const away = yield* Effect.flip(machine.readFile(session, "/tmp/shot.png", 1_024));

        assert.deepEqual(answered, bytes);
        assert.ok(
          away instanceof SandboxUnavailable,
          "a Mac silent past its presence window is away",
        );
        assert.deepEqual(
          yield* deviceAgentRequestsWaiting(userId, deviceId),
          [],
          "nothing was asked of it",
        );
      }),
    );

    it.effect(
      "a file written by session goes in a files line under the agent's attachments folder its Mac registered, and the write answers its path once the Mac settled the line as written, and is unavailable where the Mac settled it as not",
      () =>
        Effect.gen(function* () {
          const { userId, deviceId, agent, session } = yield* openLocalAgent();
          const machine = yield* deviceMachine;
          const contents = new TextEncoder().encode("%PDF-1.7 the spec");

          const writing = yield* Effect.forkChild(
            machine.writeFile(session, { name: "description/spec.pdf", contents }),
          );

          const line = yield* untilQueued(userId, deviceId);
          yield* claimedDeviceAgentLine(userId, deviceId, line.id);
          yield* TestClock.adjust("1 second");
          const waiting = writing.pollUnsafe();
          yield* settledDeviceAgentLine(userId, deviceId, line.id, 0);
          yield* TestClock.adjust("1 second");
          const path = `${DEVICE_LAYOUT.attachmentsFolder}/${agent.id}/description/spec.pdf`;
          const written = yield* Fiber.join(writing);

          const failing = yield* Effect.forkChild(
            machine.writeFile(session, { name: "description/other.pdf", contents }),
          );

          const unwritten = yield* untilQueued(userId, deviceId);
          yield* claimedDeviceAgentLine(userId, deviceId, unwritten.id);
          yield* settledDeviceAgentLine(userId, deviceId, unwritten.id, 1);
          yield* TestClock.adjust("1 second");
          const failed = yield* Effect.flip(Fiber.join(failing));

          assert.equal(waiting, undefined, "the write waits for the Mac to settle its line");
          assert.equal(written, path);
          assert.ok(
            failed instanceof SandboxUnavailable,
            "a file the Mac did not write is no path",
          );
          assert.equal(line.kind, DEVICE_AGENT_LINE_KIND.FILES);
          assert.deepEqual(Schema.decodeUnknownSync(deviceAgentFilesPayloadSchema)(line.payload), {
            files: [{ path, mode: 0o644, contents }],
          });
        }),
    );

    it.effect(
      "a line queued, claimed, settled, and withdrawn each notify the agent's account and the agent, and a request queued, claimed, answered, and withdrawn the account",
      () =>
        Effect.gen(function* () {
          const opened = yield* openLocalAgent();
          const { userId, deviceId, agent } = opened;
          const account: readonly SyncTopic[] = [[TOPIC.ACCOUNT, userId]];
          const accountAndAgent: readonly SyncTopic[] = [...account, [TOPIC.AGENT, agent.id]];
          const id = randomUUID();

          const request = {
            id,
            agentId: agent.id,
            kind: DEVICE_AGENT_REQUEST_KIND.READ_FILE,
            args: { path: "/tmp/shot.png", maxBytes: 1_025 },
          };

          const { value: runner } = yield* expectTopicsFire(launched(opened), accountAndAgent);
          const line = runner.handle.command;
          yield* expectTopicsFire(claimedDeviceAgentLine(userId, deviceId, line), accountAndAgent);
          yield* expectTopicsFire(
            settleDeviceAgentLine(userId, deviceId, line, 0),
            accountAndAgent,
          );
          yield* expectTopicsFire(queueDeviceAgentRequest(userId, request), account);
          yield* expectTopicsFire(claimDeviceAgentRequest(userId, deviceId, id), account);
          yield* expectTopicsFire(
            answerDeviceAgentRequest(userId, deviceId, id, {
              kind: DEVICE_AGENT_REQUEST_KIND.READ_FILE,
              bytes: new Uint8Array([137, 80, 78, 71]),
            }),
            account,
          );
          yield* expectTopicsFire(withdrawDeviceAgentRequest(userId, id), account);
          const later = new Date((yield* Clock.currentTimeMillis) + 1);
          yield* expectTopicsFire(withdrawExpiredDeviceAgentRows(userId, later), accountAndAgent);
          assert.ok(
            Option.isNone(yield* deviceAgentLineStanding(userId, line)),
            "the settled line was withdrawn",
          );
        }),
    );

    it.effect(
      "on Vespin Sync, the Mac's held reads, a read's wait for its answer, and a wait for a runner's exit each answer within a coalesce window of the write that settles them",
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            const opened = yield* openLocalAgent();
            const { userId, deviceId, agent, session } = opened;
            const machine = yield* deviceMachine;
            const bytes = new Uint8Array([137, 80, 78, 71]);

            const lines = yield* wokenOnHub(
              deviceAgentLinesFor(userId, deviceId),
              launched(opened),
            );

            const line = lines.written.handle.command;

            const read = yield* wokenOnHub(
              machine.readFile(session, "/tmp/shot.png", 1_024),
              Effect.gen(function* () {
                const [asked] = yield* deviceAgentRequestsWaiting(userId, deviceId);
                assert.ok(asked !== undefined, "the read asked its Mac");
                yield* claimDeviceAgentRequest(userId, deviceId, asked.id);
                yield* answerDeviceAgentRequest(userId, deviceId, asked.id, {
                  kind: DEVICE_AGENT_REQUEST_KIND.READ_FILE,
                  bytes,
                });
              }),
            );

            const id = randomUUID();

            const requests = yield* wokenOnHub(
              deviceAgentRequestsFor(userId, deviceId),
              queueDeviceAgentRequest(userId, {
                id,
                agentId: agent.id,
                kind: DEVICE_AGENT_REQUEST_KIND.READ_FILE,
                args: { path: "/tmp/notes.md", maxBytes: 1_025 },
              }),
            );

            const exit = yield* wokenOnHub(
              machine.runnerExit(lines.written.handle),
              Effect.andThen(
                claimedDeviceAgentLine(userId, deviceId, line),
                settleDeviceAgentLine(userId, deviceId, line, 0),
              ),
            );

            assert.deepEqual(
              lines.answered.map((each) => each.id),
              [line],
            );
            assert.deepEqual(read.answered, bytes);
            assert.deepEqual(
              requests.answered.map((each) => each.id),
              [id],
            );
            assert.equal(exit.answered, 0);
          }),
        ),
    );

    it.effect(
      "a turn under way is settled lost once its Mac settles the newest launch, and only then",
      () =>
        Effect.gen(function* () {
          const opened = yield* openLocalAgent();
          const { userId, deviceId, agent } = opened;
          const older = yield* launched(opened);
          const newer = yield* launched(opened);
          yield* claimedDeviceAgentLine(userId, deviceId, older.handle.command);
          yield* claimedDeviceAgentLine(userId, deviceId, newer.handle.command);
          const writer = yield* storeWriter({ tools: {} });
          const turnId = randomUUID();
          yield* writer.enqueueTurn(
            { userId, conversationId: agent.conversationId },
            { turnId, runtimeTurnId: turnId, origin: TURN_ORIGIN.TYPED },
          );

          const statusNow = Effect.map(
            latestTurnsOfReached([agent.conversationId]),
            (turns) => turns.get(agent.conversationId)?.status,
          );

          yield* settledDeviceAgentLine(userId, deviceId, older.handle.command);
          const afterOlder = yield* statusNow;
          yield* settledDeviceAgentLine(userId, deviceId, newer.handle.command);
          const askedAgain = yield* settledDeviceAgentLine(userId, deviceId, newer.handle.command);

          assert.equal(askedAgain, true, "a settle the Mac asks again is answered as settled");
          assert.equal(
            afterOlder,
            TURN_STATUS.QUEUED,
            "a launch a newer one replaced settles nothing",
          );
          assert.equal(yield* statusNow, TURN_STATUS.FAILED);
        }),
    );

    /**
     * A local agent's launch claimed, then settled unstarted by its device,
     * past the step it reported where one is: the agent, and its turn as the
     * store reads it after. No turn is queued first, because a native turn is
     * queued by its harness's first event, which a runner that never started
     * never posts.
     */
    const unstartedTurn = (step?: DeviceLaunchStep, unstarted?: DeviceLaunchUnstarted) =>
      Effect.gen(function* () {
        const opened = yield* openLocalAgent();
        const { userId, deviceId, agent } = opened;
        yield* messageSent(opened);
        const launch = yield* launched(opened);
        yield* claimedDeviceAgentLine(userId, deviceId, launch.handle.command);

        if (step !== undefined) {
          yield* stepDeviceAgentLaunch(userId, deviceId, launch.handle.command, step);
        }

        yield* settledDeviceAgentLine(userId, deviceId, launch.handle.command, 1, unstarted);

        const turn = (yield* latestTurnsOfReached([agent.conversationId])).get(
          agent.conversationId,
        );

        return { agent, turn };
      });

    it.effect(
      "a launch its Mac settled unstarted with no step reported fails the turn its message queued as a lost runner's, though its runner never took it",
      () =>
        Effect.gen(function* () {
          const { turn } = yield* unstartedTurn();

          assert.equal(turn?.status, TURN_STATUS.FAILED);
          assert.equal(turn?.failure, TURN_FAILURE.MODEL);
          assert.equal(turn?.failureDetail, RUNNER_LOST_DETAIL);
        }),
    );

    it.effect(
      "a launch its Mac settled unstarted past a step it reported fails the agent's turn naming that step, read as a failure with no word of its own",
      () =>
        Effect.gen(function* () {
          const { turn } = yield* unstartedTurn(DEVICE_LAUNCH_STEP.FETCHING);

          assert.equal(turn?.status, TURN_STATUS.FAILED);
          assert.equal(launchStoppedOf(turn), DEVICE_LAUNCH_STEP.FETCHING);
          assert.equal(agentFailureOf(turn), AGENT_FAILURE.OTHER);
        }),
    );

    it.effect(
      "a launch its Mac settled unstarted for a reason it said, before its step report landed, fails the agent's turn naming that reason at the first step",
      () =>
        Effect.gen(function* () {
          const { turn } = yield* unstartedTurn(undefined, DEVICE_LAUNCH_UNSTARTED.GITHUB_SIGN_IN);

          assert.equal(launchStoppedOf(turn), DEVICE_LAUNCH_STEP.PREPARING);
          assert.equal(launchUnstartedOf(turn), DEVICE_LAUNCH_UNSTARTED.GITHUB_SIGN_IN);
          assert.equal(agentFailureOf(turn), AGENT_FAILURE.OTHER);
        }),
    );

    it.effect(
      "a launch, a message, or its files to an agent whose Mac is away are refused as a Start on it is, and by name on a host its account removed, queuing nothing",
      () =>
        Effect.gen(function* () {
          const opened = yield* openLocalAgent();
          const { handle } = yield* launched(opened);
          yield* claimedDeviceAgentLine(opened.userId, opened.deviceId, handle.command);
          const machine = yield* deviceMachine;
          yield* TestClock.adjust("2 minutes");

          const message = yield* Effect.flip(
            machine.writeLine(handle, '{"type":"message","content":[]}\n'),
          );

          const files = yield* Effect.flip(
            machine.writeFiles(handle, [
              { path: "/tmp/note.txt", mode: 0o644, contents: new Uint8Array([104, 105]) },
            ]),
          );

          const launch = yield* Effect.flip(launched(opened));
          // The Mac is enrolled and removed, as Settings › Hosts removes one.
          yield* enrollOwnDevice(opened.userId, {
            id: opened.deviceId,
            version: "0.1.0",
            secretHash: `secret-${randomUUID()}`,
          });
          assert.notEqual(yield* removeHost(opened.userId, opened.deviceId), undefined);

          const removed = yield* Effect.flip(
            machine.writeLine(handle, '{"type":"message","content":[]}\n'),
          );

          for (const refused of [message, files, launch]) {
            assert.ok(refused instanceof LaunchRefused);
            assert.equal(refused.deviceAway, true);
          }

          assert.ok(removed instanceof LaunchRefused);
          assert.equal(removed.deviceRemoved, true);
          assert.deepEqual(yield* deviceAgentLinesWaiting(opened.userId, opened.deviceId), []);
        }),
    );

    it.effect(
      "a Mac quiet past its lease before its runner took its message fails the turn the message's send queued at the agent's reconcile, naming the Mac",
      () =>
        Effect.gen(function* () {
          const opened = yield* openLocalAgent();
          const { userId, deviceId, agent } = opened;
          yield* messageSent(opened);
          const launch = yield* launched(opened);
          // The Mac took the launch and went quiet while preparing it, before its runner posted anything.
          yield* claimedDeviceAgentLine(userId, deviceId, launch.handle.command);
          yield* TestClock.adjust("6 minutes");

          yield* reconcileAgent(agent);

          const turn = (yield* latestTurnsOfReached([agent.conversationId])).get(
            agent.conversationId,
          );

          assert.equal(turn?.status, TURN_STATUS.FAILED);
          assert.equal(
            turn?.failureDetail,
            "Studio went away during this turn. Send a message to carry on once it's back.",
          );
        }),
    );

    it.effect(
      "a Mac quiet past its lease loses its open run at the agent's reconcile: the launch settled, the bearer let go, and the turn ended naming the Mac, with no stop queued; a Mac that beat within it keeps its run",
      () =>
        Effect.gen(function* () {
          const lapsed = yield* openLocalAgent();
          const kept = yield* openLocalAgent();
          const lapsedLaunch = yield* launched(lapsed);
          const keptLaunch = yield* launched(kept);
          yield* claimedDeviceAgentLine(
            lapsed.userId,
            lapsed.deviceId,
            lapsedLaunch.handle.command,
          );
          yield* claimedDeviceAgentLine(kept.userId, kept.deviceId, keptLaunch.handle.command);
          yield* recordAgentRunnerToken(lapsed.userId, lapsed.agent.id, "fixture-digest");
          const writer = yield* storeWriter({ tools: {} });

          for (const { userId, agent } of [lapsed, kept]) {
            const turnId = randomUUID();
            yield* writer.enqueueTurn(
              { userId, conversationId: agent.conversationId },
              { turnId, runtimeTurnId: turnId, origin: TURN_ORIGIN.TYPED },
            );
          }

          yield* TestClock.adjust("6 minutes");
          yield* beatDevice(kept.userId, kept.deviceId);

          for (const { agent } of [lapsed, kept]) yield* reconcileAgent(agent);

          const turns = yield* latestTurnsOfReached([
            lapsed.agent.conversationId,
            kept.agent.conversationId,
          ]);

          const db = yield* Database;

          const [bearer] = yield* db
            .select({ hash: agentTable.runnerTokenHash })
            .from(agentTable)
            .where(eq(agentTable.id, lapsed.agent.id));

          const lapsedTurn = turns.get(lapsed.agent.conversationId);
          assert.equal(lapsedTurn?.status, TURN_STATUS.FAILED);
          assert.equal(
            lapsedTurn?.failureDetail,
            "Studio went away during this turn. Send a message to carry on once it's back.",
          );
          // Note that the agent reads as its host lost, naming it, rather than as the model's failure.
          assert.equal(agentFailureOf(lapsedTurn), AGENT_FAILURE.OTHER);
          assert.deepEqual(hostLostOf(lapsedTurn), { host: "Studio" });
          assert.equal(bearer?.hash, null, "nothing the lapsed runner posts reaches the agent");
          assert.deepEqual(
            Option.map(
              yield* deviceAgentLineStanding(lapsed.userId, lapsedLaunch.handle.command),
              (standing) => [standing.settled, standing.exitCode],
            ),
            Option.some([true, null]),
          );
          assert.deepEqual(
            yield* deviceAgentLinesWaiting(lapsed.userId, lapsed.deviceId),
            [],
            "the Mac's own beat ends a run it holds no longer once it is back",
          );
          assert.equal(turns.get(kept.agent.conversationId)?.status, TURN_STATUS.QUEUED);
          assert.deepEqual(
            Option.map(
              yield* deviceAgentLineStanding(kept.userId, keptLaunch.handle.command),
              (standing) => standing.settled,
            ),
            Option.some(false),
          );
        }),
    );
  },
);
