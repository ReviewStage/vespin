import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { agentQueueNow } from "@repo/database/models/agent-queue-store";
import { readAgent, readAgentByKey } from "@repo/database/models/agent-store";
import { heardFromAnotherAccount } from "@repo/database/models/mac-command-store";
import { createTask, readTask } from "@repo/database/models/task-store";
import { storeWriter } from "@repo/database/models/writer";
import { messages } from "@repo/database/schemas/storage";
import { task } from "@repo/database/schemas/task";
import { MESSAGE_SENDER } from "@repo/database/storage-vocabulary";
import { getTestDB, joinWorkspace, openWorkspace } from "@repo/database/testing";
import { BOOT_FAILURE, type BootFailure } from "@repo/features/agent-boot";
import { AGENT_KIND } from "@repo/features/agent-wire";
import { AUTOMATION_FIRING, type AutomationFiring } from "@repo/features/automation-wire";
import { AGENT_DEFAULT_CHOICE, MODEL_PROVIDER } from "@repo/features/models-wire";
import { TASK_MODE, TASK_STATUS, type TaskStatus } from "@repo/features/task-wire";
import { sessionKey } from "@repo/runtime/vocabulary";
import { memorySandbox } from "@repo/sandbox/testing";
import { and, eq, isNotNull } from "drizzle-orm";
import { Deferred, Effect, ErrorReporter, Fiber, Layer, Option, Result } from "effect";
import { TestClock } from "effect/testing";
import { MESSAGE_ROLE, RUN_EVENT, RUN_TURN_ORIGIN, TURN_ORIGIN, TURN_TRIGGER } from "../../core.js";
import { keptAfterResponse } from "../../http/after-response.js";
import { HOSTED_REFUSAL } from "../../http/http-effect.js";
import { modelCatalogOf } from "../../providers/model-catalog.js";
import { connectAgentApiKeys } from "../../testing/agent-credentials.js";
import {
  connectWorkspaceGitHub,
  githubReaching,
  type InstallationFixture,
  openGithubUser,
} from "../../testing/github-app-fake.js";
import {
  type AgentSessions,
  MACHINE_UP,
  type MachineUp,
  PLAN_REFUSAL,
  RUNTIME_REFUSAL,
  SESSION_CANCEL_OUTCOME,
  SESSION_RESET_OUTCOME,
  SESSION_SEND_OUTCOME,
  type SessionFailed,
  type SessionMessage,
} from "../sessions/agent-sessions.js";
import { type StartAsk, startAgent } from "./start.js";
import { CODER_TOOL_SET } from "./tool-set.js";

/** The attributes an error reporter is handed beside the failure it reports. */
type ReportedAttributes = Parameters<Parameters<typeof ErrorReporter.make>[0]>[0]["attributes"];

/** What every case runs over: the store, and sandboxes kept in memory. */
const SUITE = Layer.merge(getTestDB(), memorySandbox().layer);

/**
 * coder-start.test.ts -- an agent started on a task, by hand or as an automation's run starts one.
 *
 * The Start opens one agent on the task, on its repository, handed the
 * prompt, and a retry under its key is that agent and opens nothing again;
 * a member who did not make the task starts one as well, an account outside it starts nothing, and a
 * repository the workspace's installation does not reach is refused before
 * the harness is asked, and a Start whose session never opened leaves no agent. An agent started on a task moves it into progress from the
 * backlog or to do, and on a task stored in pilot mode it is a coder. The
 * agent's sessions are a fake, GitHub a script,
 * the catalog fixed, and the store PGlite. Synthetic accounts and words
 * throughout.
 */

const RELAY = { owner: "Acme", name: "Relay" } as const;
const RELAY_REPOSITORY = `${RELAY.owner}/${RELAY.name}`;

/** One installation for each test's workspace, since one installation connects to one workspace and the suite's tests share a database. */
const INSTALLATIONS: readonly InstallationFixture[] = Array.from({ length: 12 }, (_, index) => ({
  id: 8_000 + index,
  login: RELAY.owner,
  accountId: 80_000 + index,
  repositories: [RELAY],
}));

let installationsConnected = 0;

const TASK = "Find the flakiest test in CI this week and fix it.";

/** The agent's sessions, writing down the first message of every session opened. */
function fakeAgentSessions() {
  const opened: SessionMessage[] = [];

  const sessions: AgentSessions = {
    // Note that the machine is up at once, so the first message the Start queued goes as its boot answers.
    boot: () =>
      Effect.succeed({
        outcome: SESSION_SEND_OUTCOME.ACCEPTED,
        sessionId: `wrun_${randomUUID()}`,
        up: Effect.succeed(MACHINE_UP.READY),
      }),
    open: (message) =>
      Effect.sync(() => {
        opened.push(message);

        return { outcome: SESSION_SEND_OUTCOME.ACCEPTED, sessionId: `wrun_${randomUUID()}` };
      }),
    send: (sessionId, message) =>
      Effect.sync(() => {
        opened.push(message);

        return { outcome: SESSION_SEND_OUTCOME.ACCEPTED, sessionId, deliveryId: randomUUID() };
      }),
    cancel: () => Effect.succeed({ outcome: SESSION_CANCEL_OUTCOME.ACCEPTED }),
    reset: () => Effect.succeed({ outcome: SESSION_RESET_OUTCOME.RESET }),
  };

  const agentSessions = Effect.succeed(sessions);

  return { opened, sessions, agentSessions };
}

/** The catalog every Start is checked against. */
const catalog = modelCatalogOf([
  {
    id: AGENT_DEFAULT_CHOICE.model,
    name: "Claude Opus 5.5",
    provider: MODEL_PROVIDER.ANTHROPIC,
    efforts: ["low", "medium", "high", "max"],
  },
]);

/** What a Start reaches beside the store: GitHub reaching the repository, and the catalog. */
const services = Layer.mergeAll(githubReaching(INSTALLATIONS).layer, catalog);

/** A workspace connected to an installation reaching the repository, and its owner. */
const openConnectedWorkspace = Effect.gen(function* () {
  const owner = yield* openGithubUser();
  yield* connectAgentApiKeys(owner);
  const workspaceId = yield* openWorkspace(owner);
  const installation = INSTALLATIONS[installationsConnected++];
  assert.ok(installation);
  yield* connectWorkspaceGitHub(workspaceId, installation);

  return { owner, workspaceId };
});

/** A Start handed the prompt on a task the owner makes in the workspace on the repository, under a fresh key. */
const promptAsk = (owner: string, workspaceId: string, repository = RELAY_REPOSITORY) =>
  Effect.map(
    createTask(owner, { organizationId: workspaceId, repository }),
    (made): StartAsk => ({
      taskId: made.id,
      prompt: TASK,
      idempotencyKey: randomUUID(),
      choice: undefined,
    }),
  );

/**
 * The agent's lines once its first turn took the first message its Start
 * opened the session with, by the line's own id, as a native harness's
 * runner names it back, and whether it has heard from another account by
 * then.
 */
const openedLineTaken = (
  owner: string,
  conversationId: string,
  opened: readonly SessionMessage[],
) =>
  Effect.gen(function* () {
    const target = { userId: owner, conversationId };
    const lineId = opened[0]?.lineId;
    assert.ok(lineId !== undefined);
    const writer = yield* storeWriter({ tools: CODER_TOOL_SET });
    const turnId = randomUUID();
    yield* writer.enqueueTurn(target, { turnId, origin: TURN_ORIGIN.TYPED, runtimeTurnId: turnId });
    yield* writer.consume(target, {
      conversationId: sessionKey(conversationId),
      turnId,
      sequence: 1,
      kind: RUN_EVENT.TURN_STARTED,
      origin: RUN_TURN_ORIGIN.TYPED,
      trigger: TURN_TRIGGER.ASK,
      at: 0,
    });
    const taken = yield* writer.takeAwaitingLine(target, { clientId: lineId, turnId });
    assert.equal(Result.getOrUndefined(taken)?.length, 1);

    const db = yield* Database;

    const lines = yield* db
      .select({
        sender: messages.sender,
        senderUserId: messages.senderUserId,
        metadata: messages.metadata,
        taken: isNotNull(messages.turnId),
      })
      .from(messages)
      .where(
        and(eq(messages.conversationId, conversationId), eq(messages.role, MESSAGE_ROLE.USER)),
      );

    return { lines, heard: yield* heardFromAnotherAccount(target) };
  });

it.layer(SUITE)("an agent started on a prompt", (it) => {
  it.effect(
    "a Start opens one agent on the task, on its repository, handed the prompt, and a retry under its key opens nothing again",
    () =>
      Effect.gen(function* () {
        const { owner, workspaceId } = yield* openConnectedWorkspace;
        const { opened, agentSessions } = fakeAgentSessions();
        const ask = yield* promptAsk(owner, workspaceId);

        const first = yield* startAgent(agentSessions, owner, ask).pipe(Effect.provide(services));
        const again = yield* startAgent(agentSessions, owner, ask).pipe(Effect.provide(services));

        assert.equal(first.created, true);
        assert.deepEqual([again.created, again.agent.id], [false, first.agent.id]);
        const agent = Option.getOrThrow(yield* readAgent(owner, first.agent.id));
        assert.deepEqual(
          [
            agent.taskId,
            agent.organizationId,
            agent.repository,
            agent.prompt,
            agent.descriptionSnapshot,
          ],
          [ask.taskId, workspaceId, RELAY_REPOSITORY, TASK, null],
        );
        assert.deepEqual(
          opened.map((message) => message.conversationId),
          [agent.conversationId],
        );
      }),
  );

  it.effect(
    "a member who did not make the task starts one on it, and an account outside its workspace starts nothing and opens no session",
    () =>
      Effect.gen(function* () {
        const { owner, workspaceId } = yield* openConnectedWorkspace;
        const ask = yield* promptAsk(owner, workspaceId);
        const teammate = yield* openGithubUser();
        yield* connectAgentApiKeys(teammate);
        yield* joinWorkspace(workspaceId, teammate);
        const outsider = yield* openGithubUser();
        yield* connectAgentApiKeys(outsider);
        yield* openWorkspace(outsider);
        const { opened, agentSessions } = fakeAgentSessions();

        const theirs = yield* startAgent(agentSessions, teammate, ask).pipe(
          Effect.provide(services),
        );

        const refused = yield* Effect.result(
          startAgent(agentSessions, outsider, { ...ask, idempotencyKey: randomUUID() }).pipe(
            Effect.provide(services),
          ),
        );

        assert.equal(theirs.agent.organizationId, workspaceId);
        assert.ok(Result.isFailure(refused));
        assert.equal(refused.failure, HOSTED_REFUSAL.NOT_FOUND);
        assert.equal(opened.length, 1, "only the member's Start opened a session");
      }),
  );

  it.effect(
    "a Start's first message waits in the agent's queue until its machine is up, and goes nowhere where the machine never came up",
    () =>
      Effect.gen(function* () {
        const { owner, workspaceId } = yield* openConnectedWorkspace;

        const booting = (up: Effect.Effect<BootFailure | MachineUp>) =>
          Effect.gen(function* () {
            const { opened, agentSessions } = fakeAgentSessions();
            const sessions = yield* agentSessions;
            const after = keptAfterResponse();

            const { agent } = yield* startAgent(
              Effect.succeed<AgentSessions>({
                ...sessions,
                boot: (conversationId) =>
                  Effect.map(sessions.boot(conversationId), (booted) =>
                    booted.outcome === SESSION_SEND_OUTCOME.ACCEPTED ? { ...booted, up } : booted,
                  ),
              }),
              owner,
              yield* promptAsk(owner, workspaceId),
            ).pipe(Effect.provide(Layer.merge(services, after.layer)));

            const queuedWhileBooting = (yield* agentQueueNow(agent.id)).messages.map(
              (message) => message.text,
            );

            const sentWhileBooting = opened.length;
            yield* after.run;

            return {
              queuedWhileBooting,
              sentWhileBooting,
              sentOnceUp: opened.length,
              queuedOnceUp: (yield* agentQueueNow(agent.id)).messages.length,
            };
          });

        const cameUp = yield* booting(Effect.succeed(MACHINE_UP.READY));
        const neverCameUp = yield* booting(Effect.succeed(BOOT_FAILURE.MACHINE_UNAVAILABLE));

        assert.deepEqual(cameUp, {
          queuedWhileBooting: [TASK],
          sentWhileBooting: 0,
          sentOnceUp: 1,
          queuedOnceUp: 0,
        });
        assert.deepEqual(neverCameUp, {
          queuedWhileBooting: [TASK],
          sentWhileBooting: 0,
          sentOnceUp: 0,
          queuedOnceUp: 1,
        });
      }),
  );

  it.effect(
    "a repository the workspace's installation does not reach is refused before the harness is asked",
    () =>
      Effect.gen(function* () {
        const { owner, workspaceId } = yield* openConnectedWorkspace;
        const { opened, agentSessions } = fakeAgentSessions();

        const refused = yield* Effect.result(
          startAgent(
            agentSessions,
            owner,
            yield* promptAsk(owner, workspaceId, "Acme/Elsewhere"),
          ).pipe(Effect.provide(services)),
        );

        assert.ok(Result.isFailure(refused));
        assert.deepEqual(opened, []);
      }),
  );

  it.effect(
    "a Start whose session never opened, the harness not reached or the Start cut short before it was asked, leaves no agent behind, and one cut short while it was asked keeps it",
    () =>
      Effect.gen(function* () {
        const { owner, workspaceId } = yield* openConnectedWorkspace;
        const unreached = yield* promptAsk(owner, workspaceId);

        const refused = yield* Effect.result(
          startAgent(Effect.fail(HOSTED_REFUSAL.UNAVAILABLE), owner, unreached).pipe(
            Effect.provide(services),
          ),
        );

        // Each Start is held where it never gets past, and interrupted there. Note that one held while
        // its open is asked waits out its first line's hand-over deadline, as a send's does, which the
        // clock is moved past.
        const cutAt = (
          agentSessions: (reached: Deferred.Deferred<void>) => Effect.Effect<AgentSessions>,
        ) =>
          Effect.gen(function* () {
            const reached = yield* Deferred.make<void>();
            const ask = yield* promptAsk(owner, workspaceId);

            const starting = yield* startAgent(agentSessions(reached), owner, ask).pipe(
              Effect.provide(services),
              Effect.forkChild,
            );

            yield* Deferred.await(reached);
            const interrupting = yield* Effect.forkChild(Fiber.interrupt(starting));

            for (let second = 0; second <= 30; second += 1) {
              yield* Effect.yieldNow;
              yield* TestClock.adjust("1 second");
            }

            yield* Fiber.join(interrupting);

            return yield* readAgentByKey(owner, ask.idempotencyKey);
          });

        const beforeAsking = yield* cutAt((reached) =>
          Effect.andThen(Deferred.succeed(reached, undefined), Effect.never),
        );

        const whileAsking = yield* cutAt((reached) =>
          Effect.succeed({
            ...fakeAgentSessions().sessions,
            boot: () => Effect.andThen(Deferred.succeed(reached, undefined), Effect.never),
          }),
        );

        assert.ok(Result.isFailure(refused));
        assert.equal(refused.failure, HOSTED_REFUSAL.UNAVAILABLE);
        assert.ok(Option.isNone(yield* readAgentByKey(owner, unreached.idempotencyKey)));
        assert.ok(Option.isNone(beforeAsking));
        assert.ok(Option.isSome(whileAsking));
      }),
  );

  it.effect(
    "a Start no harness here could take is reported with the agent's ids, and one its plan refused is not",
    () =>
      Effect.gen(function* () {
        const { owner, workspaceId } = yield* openConnectedWorkspace;
        const reported: ReportedAttributes[] = [];

        const reporting = ErrorReporter.layer([
          ErrorReporter.make(({ attributes }) => {
            reported.push(attributes);
          }),
        ]);

        const refusing = (failed: SessionFailed) =>
          Effect.succeed<AgentSessions>({
            ...fakeAgentSessions().sessions,
            boot: () => Effect.succeed(failed),
          });

        const started = (failed: SessionFailed) =>
          Effect.flatMap(promptAsk(owner, workspaceId), (ask) =>
            Effect.result(
              startAgent(refusing(failed), owner, ask).pipe(
                Effect.provide(Layer.merge(services, reporting)),
              ),
            ),
          );

        yield* started({
          outcome: SESSION_SEND_OUTCOME.FAILED,
          status: 503,
          runtimeRefusal: RUNTIME_REFUSAL.NOT_HERE,
        });
        yield* started({
          outcome: SESSION_SEND_OUTCOME.FAILED,
          status: 429,
          planRefusal: PLAN_REFUSAL.LIMIT_REACHED,
        });

        assert.equal(reported.length, 1);
        assert.equal(reported[0]?.reason, HOSTED_REFUSAL.NATIVE_AGENT_NOT_HERE.error);
        assert.equal(typeof reported[0]?.agentId, "string");
        assert.equal(typeof reported[0]?.conversationId, "string");
      }),
  );

  it.effect(
    "a fresh agent, whose prompt stands as its first line, the Start's brief sent by its starter, which its first turn takes by its id, has heard from no one but its starter, so its Mac is still its own, unless the automation's run that started it handed it a webhook's body",
    () =>
      Effect.gen(function* () {
        const { owner, workspaceId } = yield* openConnectedWorkspace;

        const openedTaken = (ask: StartAsk) =>
          Effect.gen(function* () {
            const { opened, agentSessions } = fakeAgentSessions();

            const { agent } = yield* startAgent(agentSessions, owner, ask).pipe(
              Effect.provide(services),
            );

            return yield* openedLineTaken(owner, agent.conversationId, opened);
          });

        const ranFor = (firing: AutomationFiring) =>
          Effect.map(
            promptAsk(owner, workspaceId),
            (ask): StartAsk => ({
              ...ask,
              automationOrigin: { name: "Triage", firing, prompt: TASK },
            }),
          );

        const byHand = yield* openedTaken(yield* promptAsk(owner, workspaceId));
        assert.deepEqual(
          byHand.lines,
          [
            {
              sender: MESSAGE_SENDER.MEMBER,
              senderUserId: owner,
              metadata: { channel: "start", brief: "prompt" },
              taken: true,
            },
          ],
          "the prompt is the conversation's one line",
        );
        assert.equal(byHand.heard, false, "by hand");

        const scheduled = yield* openedTaken(
          yield* ranFor({ kind: AUTOMATION_FIRING.SCHEDULE, dueAt: 0 }),
        );

        assert.equal(scheduled.heard, false, "a schedule's run, its owner's prompt alone");

        const hooked = yield* openedTaken(
          yield* ranFor({ kind: AUTOMATION_FIRING.WEBHOOK, bytes: 2 }),
        );

        assert.equal(hooked.heard, true, "a webhook's run, its caller's body beside the prompt");
      }),
  );
});

it.layer(SUITE)("an agent started on a task", (it) => {
  /** A Start on the task, handed the description, under a fresh key. */
  const taskAsk = (taskId: string): StartAsk => ({
    taskId,
    prompt: undefined,
    idempotencyKey: randomUUID(),
    choice: undefined,
  });

  it.effect(
    "moves the task into progress from the backlog or to do, and takes up one done again",
    () =>
      Effect.gen(function* () {
        const { owner, workspaceId } = yield* openConnectedWorkspace;

        const made = (status: TaskStatus) =>
          createTask(owner, {
            organizationId: workspaceId,
            name: "Invites",
            repository: RELAY_REPOSITORY,
            status,
          });

        const filed = yield* made(TASK_STATUS.BACKLOG);
        const todo = yield* made(TASK_STATUS.TODO);
        const done = yield* made(TASK_STATUS.DONE);
        const { agentSessions } = fakeAgentSessions();

        for (const task of [filed, todo, done]) {
          yield* startAgent(agentSessions, owner, taskAsk(task.id)).pipe(Effect.provide(services));
        }

        const statusOf = (taskId: string) =>
          Effect.map(readTask(owner, taskId), (read) => Option.getOrUndefined(read)?.task.status);

        assert.equal(yield* statusOf(filed.id), TASK_STATUS.IN_PROGRESS);
        assert.equal(yield* statusOf(todo.id), TASK_STATUS.IN_PROGRESS);
        assert.equal(yield* statusOf(done.id), TASK_STATUS.IN_PROGRESS);
      }),
  );
  it.effect(
    "assigns its starter a task no one is assigned to when started by hand, and never one an automation's run starts or one already assigned",
    () =>
      Effect.gen(function* () {
        const { owner, workspaceId } = yield* openConnectedWorkspace;

        const made = (assigneeId?: string) =>
          createTask(owner, {
            organizationId: workspaceId,
            name: "Invites",
            repository: RELAY_REPOSITORY,
            ...(assigneeId === undefined ? undefined : { assigneeId }),
          });

        const byHand = yield* made();
        const byAutomation = yield* made();
        const { agentSessions } = fakeAgentSessions();

        yield* startAgent(agentSessions, owner, taskAsk(byHand.id)).pipe(Effect.provide(services));
        yield* startAgent(agentSessions, owner, {
          ...taskAsk(byAutomation.id),
          automationOrigin: {
            name: "Nightly",
            firing: { kind: AUTOMATION_FIRING.SCHEDULE, dueAt: 0 },
            prompt: "Sweep it.",
          },
        }).pipe(Effect.provide(services));

        const assigneeOf = (taskId: string) =>
          Effect.map(
            readTask(owner, taskId),
            (read) => Option.getOrUndefined(read)?.task.assignee?.userId,
          );

        assert.equal(yield* assigneeOf(byHand.id), owner);
        assert.equal(yield* assigneeOf(byAutomation.id), undefined);
      }),
  );

  it.effect("on a task stored in pilot mode with no agent, a Start makes a coder", () =>
    Effect.gen(function* () {
      const { owner, workspaceId } = yield* openConnectedWorkspace;

      const made = yield* createTask(owner, {
        organizationId: workspaceId,
        name: "Invites",
        repository: RELAY_REPOSITORY,
      });

      // Note that nothing writes pilot mode now, so the task is made one in place, as a release before stored it.
      yield* Database.use((db) =>
        db.update(task).set({ mode: TASK_MODE.PILOT }).where(eq(task.id, made.id)),
      );
      const { agentSessions } = fakeAgentSessions();

      const started = yield* startAgent(agentSessions, owner, taskAsk(made.id)).pipe(
        Effect.provide(services),
      );

      assert.equal(started.agent.kind, AGENT_KIND.CODER);
    }),
  );
});
