/**
 * conductor-import.ts -- an import from Conductor: a key checked, a run begun, and each workspace and chat of it taken off the conductor-imports queue.
 *
 * Every Conductor workspace a key sees, archived included, becomes a task in
 * the member's Vespin workspace, and each of its chats an agent on it with
 * its whole transcript (`conductor-chat-import.ts`). No model is called and
 * nothing is written to Conductor. The import can be run again: what a
 * workspace imported is kept by Conductor's id (`conductor_import`), so a
 * run creates only what is missing and leaves an imported chat as it
 * stands, even where it grew in Conductor since.
 *
 * A run reads the key's workspaces, seals the key on a run row of its own
 * (`provider-key-seal.ts`'s `sealConductorKey`), and publishes one message
 * per workspace. A workspace's delivery makes its task, with a description
 * written from its facts (`conductor-import-description.ts`), assigned to
 * the member whose name is its creator's where exactly one is, else to the
 * member who ran the import, Done where it was archived and To do
 * otherwise, and publishes one message per chat it has not imported. A
 * chat's delivery reads its whole transcript and writes it. Each workspace
 * and chat of a run stands as an item the form reads, settled imported,
 * skipped, or failed with why; once none is queued, the run's key is
 * cleared, and the sweep clears it a day after the run began at the latest.
 *
 * The key is a `Redacted` from the moment a procedure reads it, opened only
 * for the delivery that reads Conductor, and never logged, traced, or put
 * in a message, an item, or a failure; the read client drops what `/me`
 * echoes of it. A failure that may pass, such as Conductor not answering, is
 * delivered again, up to `CONDUCTOR_IMPORTS.MAX_DELIVERIES` times.
 */

import { createHash, randomUUID } from "node:crypto";
import type { DatabaseServices } from "@repo/database/core/query";
import {
  beginConductorImportRun,
  type ConductorImportQueued,
  type ConductorImportRunRow,
  clearEndedConductorImportKey,
  queueConductorImportItems,
  readConductorImportRun,
  readConductorImports,
  readNewestConductorImportRun,
  recordConductorImport,
  settleConductorImportItem,
  workspaceMembersNamed,
} from "@repo/database/models/conductor-import-store";
import { openConductorKey, sealConductorKey } from "@repo/database/models/provider-key-seal";
import { readTask } from "@repo/database/models/task-store";
import { githubRepositoryOfRemote } from "@repo/features/cli-git-remote";
import {
  CONDUCTOR_IMPORT_FAILURE,
  CONDUCTOR_IMPORT_KIND,
  CONDUCTOR_IMPORT_REFUSAL,
  CONDUCTOR_IMPORT_STATUS,
  type ConductorImportCheckAnswer,
  type ConductorImportFailure,
  type ConductorImportProgressAnswer,
  type ConductorImportRefusal,
  type ConductorImportRunAnswer,
} from "@repo/features/conductor-import-wire";
import { DESCRIPTION_ACTOR, TASK_STATUS } from "@repo/features/task-wire";
import { causeKind } from "@repo/runtime/effect";
import type { WireValue } from "@repo/wire";
import { send } from "@vercel/queue";
import {
  Config,
  ConfigProvider,
  Context,
  DateTime,
  Duration,
  Effect,
  Layer,
  Option,
  type Redacted,
  Result,
  Schema,
} from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import { answeredWorkspace } from "../../accounts/workspace-access.js";
import { accountModelChoices } from "../../agents/coder-host/start.js";
import { AUTH_DEPLOYMENT_ENVIRONMENT, DEPLOYMENT_ENVIRONMENT } from "../../auth/auth-deployment.js";
import type { HostedEnvironment } from "../../environment.js";
import { SERVER_TASK_SOURCE } from "../../events/server-events.js";
import { GitHubApp } from "../../github/github-app.js";
import { workspaceRepository } from "../../github/workspace-repository.js";
import { hostedStoreOrUnavailable } from "../../http/http-effect.js";
import { hostedKeyRing } from "../../orpc/base.js";
import type { ModelCatalog } from "../../providers/model-catalog.js";
import {
  QUEUE_ACKNOWLEDGED,
  type QueueAnswer,
  queueConsumer,
} from "../../queues/queue-consumer.js";
import { createTaskAsked } from "../../tasks/task-create-relation.js";
import { importConductorChat } from "./conductor-chat-import.js";
import {
  CONDUCTOR_READ_FAILURE,
  ConductorChatSchema,
  type ConductorReadFailed,
  type ConductorWorkspace,
  ConductorWorkspaceSchema,
  listConductorChats,
  listConductorWorkspaces,
  readConductorFirstMessages,
  readConductorMessages,
} from "./conductor-client.js";
import { CONDUCTOR_IMPORTS } from "./conductor-import-bounds.js";
import {
  type DescribedChat,
  importedTaskDescription,
  importedTaskName,
} from "./conductor-import-description.js";

/** Conductor's word for a workspace that was archived, which lands as a Done task. */
const CONDUCTOR_ARCHIVED = "archived";

/** What names a task id drawn from a Conductor workspace, so no other name-based id spells the same. */
const IMPORTED_TASK_ID_PURPOSE = "conductor-import/task";

/** The queue's message for one workspace of a run: the workspace as the run read it. */
const WorkspaceMessageSchema = Schema.Struct({
  kind: Schema.Literal(CONDUCTOR_IMPORT_KIND.WORKSPACE),
  runId: Schema.String,
  workspace: ConductorWorkspaceSchema,
});

/** The queue's message for one chat: the chat as its workspace's delivery read it, and the task it lands on. */
const ChatMessageSchema = Schema.Struct({
  kind: Schema.Literal(CONDUCTOR_IMPORT_KIND.CHAT),
  runId: Schema.String,
  workspace: Schema.Struct({
    id: Schema.String,
    deepLink: Schema.optionalKey(Schema.NullOr(Schema.String)),
  }),
  chat: ConductorChatSchema,
  taskId: Schema.String,
  repository: Schema.NullOr(Schema.String),
});

const ImportMessageSchema = Schema.Union([WorkspaceMessageSchema, ChatMessageSchema]);

type ImportMessage = typeof ImportMessageSchema.Type;

type WorkspaceMessage = typeof WorkspaceMessageSchema.Type;

type ChatMessage = typeof ChatMessageSchema.Type;

const encodeMessage = Schema.encodeSync(ImportMessageSchema);

const decodeMessage = Schema.decodeUnknownEffect(ImportMessageSchema);

/** What a delivery ended as: an item settled, or a failure that may pass, for the queue to deliver again. */
type Settled =
  | { readonly status: typeof CONDUCTOR_IMPORT_STATUS.IMPORTED }
  | { readonly status: typeof CONDUCTOR_IMPORT_STATUS.SKIPPED }
  | {
      readonly status: typeof CONDUCTOR_IMPORT_STATUS.FAILED;
      readonly failure: ConductorImportFailure;
    };

/** A failure of a delivery that may pass if delivered again, with what it settles as once the deliveries run out. */
interface Passing {
  readonly passing: ConductorImportFailure;
}

/** The queue as one runtime has it: Vercel's on production and on a Preview, this process's anywhere else. */
export interface ConductorImportQueueService {
  readonly publish: (message: ImportMessage) => Effect.Effect<void, never, ConductorImportServices>;
}

/** What the consumer reads and writes through: the store, Conductor and GitHub over the deployment's client, the ring, and the models an agent may run on. */
export type ConductorImportServices =
  | DatabaseServices
  | HttpClient.HttpClient
  | GitHubApp
  | HostedEnvironment
  | ModelCatalog;

/** The id of the task a Conductor workspace becomes in a Vespin workspace: one per pair, so a run again finds the task the first made. */
function importedTaskId(organizationId: string, conductorWorkspaceId: string): string {
  const digest = createHash("sha256")
    .update(JSON.stringify([IMPORTED_TASK_ID_PURPOSE, organizationId, conductorWorkspaceId]))
    .digest();

  // A version 5 UUID's version and variant bits, so the id reads as the name-based one it is.
  digest[6] = ((digest[6] ?? 0) & 0x0f) | 0x50;
  digest[8] = ((digest[8] ?? 0) & 0x3f) | 0x80;
  const hex = digest.subarray(0, 16).toString("hex");

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

/** The key a message is published under, so Queues drops a second publish of it within a run. */
function publishKeyOf(message: ImportMessage): string {
  const conductorId =
    message.kind === CONDUCTOR_IMPORT_KIND.WORKSPACE ? message.workspace.id : message.chat.id;

  return createHash("sha256")
    .update(JSON.stringify([message.runId, conductorId]))
    .digest("hex");
}

/** Why Conductor refused a read made before anything was written, as the form is told it. */
function refusalOf(failure: ConductorReadFailed): ConductorImportRefusal {
  switch (failure.reason) {
    case CONDUCTOR_READ_FAILURE.BAD_KEY:
      return CONDUCTOR_IMPORT_REFUSAL.BAD_KEY;
    case CONDUCTOR_READ_FAILURE.RATE_LIMITED:
      return CONDUCTOR_IMPORT_REFUSAL.RATE_LIMITED;
    default:
      return CONDUCTOR_IMPORT_REFUSAL.UNAVAILABLE;
  }
}

/** A failed read of a workspace or a chat: settled at once where Conductor refused, or delivered again where it may answer later. */
function readFailure(failure: ConductorReadFailed): Settled | Passing {
  return failure.reason === CONDUCTOR_READ_FAILURE.BAD_KEY ||
    failure.reason === CONDUCTOR_READ_FAILURE.NOT_FOUND
    ? {
        status: CONDUCTOR_IMPORT_STATUS.FAILED,
        failure: CONDUCTOR_IMPORT_FAILURE.CONDUCTOR_REFUSED,
      }
    : { passing: CONDUCTOR_IMPORT_FAILURE.CONDUCTOR_UNAVAILABLE };
}

const failed = (failure: ConductorImportFailure): Settled => ({
  status: CONDUCTOR_IMPORT_STATUS.FAILED,
  failure,
});

/** The repository a workspace's remote names, as `owner/name`; none for a remote not on GitHub or no remote. */
function repositoryOf(workspace: ConductorWorkspace): string | undefined {
  return workspace.repoUrl == null ? undefined : githubRepositoryOfRemote(workspace.repoUrl);
}

/** The repository as the Vespin workspace reaches it, as GitHub spells it, or none where it does not. */
const reachedRepository = (organizationId: string, repository: string, userId: string) =>
  Effect.map(Effect.result(workspaceRepository(organizationId, repository, userId)), (reached) =>
    Result.isSuccess(reached) ? Option.some(reached.success.repository.fullName) : Option.none(),
  );

/** The run's key opened under the deployment's ring, or none where the run ended, its day ran out, or the ring cannot open it. */
const openedKey = (run: ConductorImportRunRow) =>
  Effect.gen(function* () {
    if (run.sealedKey === null) return Option.none<Redacted.Redacted<string>>();
    const ring = yield* Effect.option(hostedKeyRing);

    if (Option.isNone(ring)) return Option.none<Redacted.Redacted<string>>();

    const opened = openConductorKey(
      ring.value,
      { userId: run.userId, runId: run.id },
      run.sealedKey,
    );

    return Result.isSuccess(opened) ? Option.some(opened.success) : Option.none();
  });

/** The member a workspace's task is assigned to: the one whose name is its creator's, where exactly one is, else the member who ran the import. */
const assigneeOf = (organizationId: string, workspace: ConductorWorkspace, importer: string) =>
  Effect.gen(function* () {
    if (workspace.creatorName == null || workspace.creatorName.trim() === "") return importer;
    const named = yield* workspaceMembersNamed(organizationId, workspace.creatorName);
    const [only] = named;

    return named.length === 1 && only !== undefined ? only : importer;
  });

/** Each chat with the first message the developer sent it, read from its first page; one whose page did not read is listed by name alone. */
const describedChats = (key: Redacted.Redacted<string>, chats: readonly ChatMessage["chat"][]) =>
  Effect.forEach(
    chats,
    (chat) =>
      Effect.map(
        Effect.option(readConductorFirstMessages(key, chat.id)),
        (messages): DescribedChat => {
          const first = Option.flatMapNullishOr(messages, (read) =>
            read.find((message) => message.type === "userMessage"),
          );

          return {
            chat,
            firstMessage: Option.match(first, {
              onNone: () => undefined,
              onSome: (message) =>
                "message" in message.content ? message.content.message : undefined,
            }),
          };
        },
      ),
    { concurrency: CONDUCTOR_IMPORTS.READ_CONCURRENCY },
  );

/** The publishes of a run or a workspace, a few at once; a publish that failed is said in the log and its item left queued. */
const publishAll = (messages: readonly ImportMessage[]) =>
  Effect.gen(function* () {
    const queue = yield* ConductorImportQueue;

    yield* Effect.forEach(messages, queue.publish, {
      concurrency: CONDUCTOR_IMPORTS.PUBLISH_CONCURRENCY,
      discard: true,
    });
  });

/**
 * The task a workspace's delivery lands its chats on: the one an earlier
 * import made, where the member still reaches it, or a new one, made under
 * the id the workspace names and recorded as imported. Answers the task and
 * its repository, whether this delivery made it, or why it settled failed.
 */
const workspaceTask = Effect.fnUntraced(function* (
  run: ConductorImportRunRow,
  workspace: ConductorWorkspace,
  chats: () => Effect.Effect<readonly DescribedChat[], never, ConductorImportServices>,
) {
  const imported = (yield* readConductorImports(run.organizationId, [workspace.id])).get(
    workspace.id,
  );

  if (imported?.taskId != null) {
    const task = yield* readTask(run.userId, imported.taskId);

    if (Option.isNone(task)) return Result.fail(failed(CONDUCTOR_IMPORT_FAILURE.TASK_GONE));

    return Result.succeed({
      taskId: imported.taskId,
      repository: task.value.task.repository,
      made: false,
    });
  }

  const named = repositoryOf(workspace);

  const repository =
    named === undefined
      ? Option.none<string>()
      : yield* reachedRepository(run.organizationId, named, run.userId);

  if (named !== undefined && Option.isNone(repository)) {
    return Result.fail(failed(CONDUCTOR_IMPORT_FAILURE.REPOSITORY_UNREACHED));
  }

  const assigneeId = yield* assigneeOf(run.organizationId, workspace, run.userId);
  const text = importedTaskDescription(workspace, yield* chats());

  const made = yield* Effect.result(
    createTaskAsked(
      run.userId,
      {
        id: importedTaskId(run.organizationId, workspace.id),
        organizationId: run.organizationId,
        name: importedTaskName(workspace),
        repository: Option.getOrNull(repository),
        status: workspace.state === CONDUCTOR_ARCHIVED ? TASK_STATUS.DONE : TASK_STATUS.TODO,
        assigneeId,
        text,
        writer: { actor: DESCRIPTION_ACTOR.DEVELOPER },
        relations: [],
      },
      SERVER_TASK_SOURCE.SIDEBAR,
    ),
  );

  if (Result.isFailure(made)) return Result.fail(failed(CONDUCTOR_IMPORT_FAILURE.TASK_NOT_MADE));
  const taskId = made.success.task.task.id;
  const now = yield* DateTime.nowAsDate;

  yield* recordConductorImport(
    run.organizationId,
    { conductorId: workspace.id, kind: CONDUCTOR_IMPORT_KIND.WORKSPACE, taskId, agentId: null },
    now,
  );

  return Result.succeed({ taskId, repository: made.success.repository, made: true });
});

/**
 * One workspace's delivery: its task found or made, each of its chats not
 * yet imported queued on the run and published, each imported before
 * settled skipped, and the workspace settled as its task came.
 */
const consumeWorkspace = Effect.fnUntraced(function* (
  run: ConductorImportRunRow,
  key: Redacted.Redacted<string>,
  message: WorkspaceMessage,
) {
  const { workspace } = message;
  const listed = yield* Effect.result(listConductorChats(key, workspace.id));

  if (Result.isFailure(listed)) return readFailure(listed.failure);
  const chats = listed.success;
  const task = yield* workspaceTask(run, workspace, () => describedChats(key, chats));

  if (Result.isFailure(task)) return task.failure;
  const { taskId, repository, made } = task.success;

  const imported = yield* readConductorImports(
    run.organizationId,
    chats.map((chat) => chat.id),
  );

  const now = yield* DateTime.nowAsDate;

  const items: ConductorImportQueued[] = chats.map((chat) => ({
    conductorId: chat.id,
    kind: CONDUCTOR_IMPORT_KIND.CHAT,
    workspaceConductorId: workspace.id,
    name: chat.name ?? null,
  }));

  // Note that the chats are queued before the workspace settles, so the run's key outlives its last queued chat.
  yield* queueConductorImportItems(run.id, items, now);

  for (const chat of chats.filter((each) => imported.has(each.id))) {
    yield* settleConductorImportItem(
      run.id,
      chat.id,
      { status: CONDUCTOR_IMPORT_STATUS.SKIPPED, failure: null },
      now,
    );
  }

  yield* publishAll(
    chats
      .filter((chat) => !imported.has(chat.id))
      .map((chat) => ({
        kind: CONDUCTOR_IMPORT_KIND.CHAT,
        runId: run.id,
        workspace: { id: workspace.id, deepLink: workspace.deepLink ?? null },
        chat,
        taskId,
        repository,
      })),
  );

  // The place for one call per repository that carries the workspace's Conductor scripts over, once per task made.
  return made
    ? { status: CONDUCTOR_IMPORT_STATUS.IMPORTED }
    : { status: CONDUCTOR_IMPORT_STATUS.SKIPPED };
});

/** One chat's delivery: its whole transcript read and written as an agent on its workspace's task, and recorded as imported. */
const consumeChat = Effect.fnUntraced(function* (
  run: ConductorImportRunRow,
  key: Redacted.Redacted<string>,
  message: ChatMessage,
) {
  const imported = yield* readConductorImports(run.organizationId, [message.chat.id]);

  if (imported.has(message.chat.id)) return { status: CONDUCTOR_IMPORT_STATUS.SKIPPED } as const;
  const messages = yield* Effect.result(readConductorMessages(key, message.chat.id));

  if (Result.isFailure(messages)) return readFailure(messages.failure);
  const choices = yield* Effect.result(accountModelChoices(run.userId));

  if (Result.isFailure(choices)) return { passing: CONDUCTOR_IMPORT_FAILURE.CHAT_NOT_WRITTEN };

  const written = yield* Effect.result(
    importConductorChat({
      userId: run.userId,
      taskId: message.taskId,
      repository: message.repository,
      workspace: message.workspace,
      chat: message.chat,
      messages: messages.success,
      offered: choices.success.offered,
      fallback: choices.success.defaultChoice,
    }),
  );

  if (Result.isFailure(written)) return { passing: CONDUCTOR_IMPORT_FAILURE.CHAT_NOT_WRITTEN };
  const now = yield* DateTime.nowAsDate;

  yield* recordConductorImport(
    run.organizationId,
    {
      conductorId: message.chat.id,
      kind: CONDUCTOR_IMPORT_KIND.CHAT,
      taskId: null,
      agentId: written.success.agent.id,
    },
    now,
  );

  return { status: CONDUCTOR_IMPORT_STATUS.IMPORTED } as const;
});

/**
 * One delivery acted on: its run read and its key opened, its workspace or
 * chat imported, and its item settled; a failure that may pass is
 * delivered again until the last delivery, which settles it failed. A
 * message whose run is gone is dropped.
 */
export const consumeImportMessage = Effect.fnUntraced(function* (
  wire: WireValue,
  deliveryCount: number,
) {
  const decoded = yield* Effect.option(decodeMessage(wire));

  if (Option.isNone(decoded)) {
    yield* Effect.logError("a conductor-imports message did not decode; it is dropped");

    return QUEUE_ACKNOWLEDGED;
  }

  const message = decoded.value;
  const run = yield* readConductorImportRun(message.runId);

  if (Option.isNone(run)) return QUEUE_ACKNOWLEDGED;

  const conductorId =
    message.kind === CONDUCTOR_IMPORT_KIND.WORKSPACE ? message.workspace.id : message.chat.id;

  const key = yield* openedKey(run.value);

  const ended: Settled | Passing = Option.isNone(key)
    ? failed(CONDUCTOR_IMPORT_FAILURE.RUN_EXPIRED)
    : message.kind === CONDUCTOR_IMPORT_KIND.WORKSPACE
      ? yield* consumeWorkspace(run.value, key.value, message)
      : yield* consumeChat(run.value, key.value, message);

  const lastDelivery = deliveryCount >= CONDUCTOR_IMPORTS.MAX_DELIVERIES;

  if ("passing" in ended && !lastDelivery) {
    yield* Effect.logWarning(
      `a Conductor import's ${message.kind} will come again: ${ended.passing}`,
    );

    return { acknowledged: false, again: CONDUCTOR_IMPORTS.FAILED_AGAIN } satisfies QueueAnswer;
  }

  const settled = "passing" in ended ? failed(ended.passing) : ended;
  const now = yield* DateTime.nowAsDate;

  yield* settleConductorImportItem(
    run.value.id,
    conductorId,
    { status: settled.status, failure: "failure" in settled ? settled.failure : null },
    now,
  );

  return QUEUE_ACKNOWLEDGED;
});

/** The publisher's services as a delivery of its own runs on them: outside any transaction the publish ran inside. */
const inProcessQueue: ConductorImportQueueService = {
  publish: (message) =>
    Effect.gen(function* () {
      const services = yield* Effect.context<ConductorImportServices>();

      // Note that a delivery here is its last, so a failure that may pass settles at once rather than waiting on a retry no queue makes.
      yield* Effect.forkDetach(
        consumeImportMessage(encodeMessage(message), CONDUCTOR_IMPORTS.MAX_DELIVERIES).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning(`a Conductor import's delivery failed in place: ${causeKind(cause)}`),
          ),
          Effect.provideContext(services),
        ),
      );
    }),
};

/** On Vercel: the message sent to the topic under its run's and its Conductor id's key, waited on at most `PUBLISH_WAIT`; a send that failed is said in the log. */
const vercelQueue: ConductorImportQueueService = {
  publish: (message) =>
    Effect.tryPromise(() =>
      send(CONDUCTOR_IMPORTS.TOPIC, encodeMessage(message), {
        idempotencyKey: publishKeyOf(message),
        retentionSeconds: Math.ceil(Duration.toSeconds(CONDUCTOR_IMPORTS.RETENTION)),
      }),
    ).pipe(
      Effect.timeoutOption(CONDUCTOR_IMPORTS.PUBLISH_WAIT),
      Effect.flatMap((sent) =>
        Option.isSome(sent)
          ? Effect.void
          : Effect.logWarning("a Conductor import's publish outlasted its bound"),
      ),
      Effect.catch(() => Effect.logWarning("a Conductor import's message was not published")),
    ),
};

/** The queue one runtime has: this process's by default, as a test or a local run has it. */
export const ConductorImportQueue = Context.Reference<ConductorImportQueueService>(
  "@repo/service/ConductorImportQueue",
  { defaultValue: () => inProcessQueue },
);

/**
 * The queue as the deployment's environment names it: Vercel's on
 * production and on a Preview, where the developer tests an import before
 * it ships, and this process's anywhere else.
 */
export const conductorImportQueueFromEnvironment = Layer.effect(
  ConductorImportQueue,
  Effect.map(Config.option(Config.String(AUTH_DEPLOYMENT_ENVIRONMENT.ENVIRONMENT)), (deployment) =>
    Option.exists(
      deployment,
      (named) =>
        named === DEPLOYMENT_ENVIRONMENT.PRODUCTION || named === DEPLOYMENT_ENVIRONMENT.PREVIEW,
    )
      ? vercelQueue
      : inProcessQueue,
  ).pipe(
    Effect.provideServiceEffect(
      ConfigProvider.ConfigProvider,
      Effect.sync(() => ConfigProvider.fromEnv()),
    ),
  ),
);

/** The workspaces the key sees, or why Conductor refused it. */
const keyWorkspaces = (key: Redacted.Redacted<string>) =>
  Effect.map(Effect.result(listConductorWorkspaces(key)), (listed) =>
    Result.isSuccess(listed)
      ? Result.succeed(listed.success)
      : Result.fail(refusalOf(listed.failure)),
  );

/**
 * The repositories named, each once whatever its case, that the
 * workspace's GitHub installations do not reach. One listing of
 * everything they reach settles most; a name it lacks, such as one GitHub
 * renamed since Conductor kept it, or every name where GitHub did not
 * answer the listing, is asked of GitHub one at a time, as a task's
 * repository is reached, which follows a rename to the name it has now.
 */
const unreachedOf = (organizationId: string, named: readonly string[], userId: string) =>
  Effect.gen(function* () {
    if (named.length === 0) return [];
    const app = yield* GitHubApp;
    const listed = yield* Effect.option(app.workspaceRepositories(organizationId));

    const reached = new Set(
      Option.getOrElse(Option.flatten(listed), () => []).map((each) => each.fullName.toLowerCase()),
    );

    const missing = named.filter((repository) => !reached.has(repository.toLowerCase()));

    return yield* Effect.filter(
      missing,
      (repository) =>
        Effect.map(reachedRepository(organizationId, repository, userId), Option.isNone),
      { concurrency: CONDUCTOR_IMPORTS.READ_CONCURRENCY },
    );
  });

/** Each repository once, whatever case the remotes spelled it in, sorted. */
function distinctRepositories(workspaces: readonly ConductorWorkspace[]): readonly string[] {
  const byName = new Map<string, string>();

  for (const repository of workspaces.flatMap((each) => repositoryOf(each) ?? [])) {
    if (!byName.has(repository.toLowerCase())) byName.set(repository.toLowerCase(), repository);
  }

  return [...byName.values()].sort();
}

/**
 * A key checked for an import into the member's workspace: how many
 * workspaces it sees, and the repositories among theirs the workspace's
 * GitHub installation does not reach yet, each named once. Its reads are
 * Conductor's workspace pages and one listing of what the installations
 * reach, so a team of hundreds of workspaces answers in seconds. Nothing is
 * written.
 */
export const checkConductorImport = Effect.fnUntraced(function* (
  userId: string,
  workspaceId: string,
  key: Redacted.Redacted<string>,
) {
  const workspace = yield* answeredWorkspace(userId, workspaceId);
  const listed = yield* keyWorkspaces(key);

  if (Result.isFailure(listed))
    return { refused: listed.failure } satisfies ConductorImportCheckAnswer;
  const unreached = yield* unreachedOf(workspace.id, distinctRepositories(listed.success), userId);

  return {
    workspaces: listed.success.length,
    unreachedRepositories: unreached,
  } satisfies ConductorImportCheckAnswer;
});

/**
 * An import begun by the member in their workspace: the key's workspaces
 * read, the key sealed on a run of its own, each workspace queued on the
 * run, and each published. Answers the run, or why Conductor refused the
 * key, in which case nothing is written.
 */
export const runConductorImport = Effect.fnUntraced(function* (
  userId: string,
  workspaceId: string,
  key: Redacted.Redacted<string>,
) {
  const workspace = yield* answeredWorkspace(userId, workspaceId);
  const ring = yield* hostedKeyRing;
  const listed = yield* keyWorkspaces(key);

  if (Result.isFailure(listed))
    return { refused: listed.failure } satisfies ConductorImportRunAnswer;
  const runId = randomUUID();
  const now = yield* DateTime.nowAsDate;

  yield* hostedStoreOrUnavailable(
    Effect.gen(function* () {
      yield* beginConductorImportRun({
        id: runId,
        organizationId: workspace.id,
        userId,
        sealedKey: sealConductorKey(ring, { userId, runId }, key),
        startedAt: now,
        keyExpiresAt: new Date(now.getTime() + Duration.toMillis(CONDUCTOR_IMPORTS.KEY_LIFETIME)),
      });

      yield* queueConductorImportItems(
        runId,
        listed.success.map((each) => ({
          conductorId: each.id,
          kind: CONDUCTOR_IMPORT_KIND.WORKSPACE,
          workspaceConductorId: each.id,
          name: each.name ?? null,
        })),
        now,
      );

      // A key that sees no workspace has nothing queued, so its run ends here.
      yield* clearEndedConductorImportKey(runId);
    }),
  );

  yield* publishAll(
    listed.success.map((each) => ({
      kind: CONDUCTOR_IMPORT_KIND.WORKSPACE,
      runId,
      workspace: each,
    })),
  );

  return { runId, workspaces: listed.success.length } satisfies ConductorImportRunAnswer;
});

/** The member's newest run in their workspace, with where each of its workspaces and chats stands. */
export const conductorImportProgress = Effect.fnUntraced(function* (
  userId: string,
  workspaceId: string,
) {
  const workspace = yield* answeredWorkspace(userId, workspaceId);

  const newest = yield* hostedStoreOrUnavailable(
    readNewestConductorImportRun(userId, workspace.id),
  );

  if (Option.isNone(newest)) return { run: null } satisfies ConductorImportProgressAnswer;
  const { run, items } = newest.value;

  return {
    run: {
      runId: run.id,
      startedAt: run.startedAt.getTime(),
      ended: items.every((item) => item.status !== CONDUCTOR_IMPORT_STATUS.QUEUED),
      items,
    },
  } satisfies ConductorImportProgressAnswer;
});

/**
 * The consumer's route handler over the services the function's runtime
 * handed it: each delivery acted on, and a failure of the store logged and
 * left for the queue to deliver again after `FAILED_AGAIN`.
 */
export function conductorImportsHandler(
  services: Context.Context<ConductorImportServices>,
): (request: Request) => Promise<Response> {
  return queueConsumer(services, consumeImportMessage, CONDUCTOR_IMPORTS.FAILED_AGAIN);
}
