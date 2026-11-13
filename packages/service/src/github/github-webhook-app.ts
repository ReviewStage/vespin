import { createHmac, timingSafeEqual } from "node:crypto";
import type { DatabaseServices } from "@repo/database/core/query";
import {
  GITHUB_INSTALLATION_STATUS,
  type GitHubInstallationStatus,
} from "@repo/database/github-installation-vocabulary";
import { listAgentsOnBranches } from "@repo/database/models/agent-store";
import {
  noteGitHubRepository,
  type RepositorySighting,
} from "@repo/database/models/github-repositories";
import { causeKind } from "@repo/runtime/effect";
import type { Sandbox } from "@repo/sandbox";
import { EXCESS_KEYS, HTTP_METHOD, type UnparsedWireValue, WireValueSchema } from "@repo/wire";
import { readEither } from "@repo/wire/effect";
import { send } from "@vercel/queue";
import {
  Clock,
  Config,
  ConfigProvider,
  Context,
  Duration,
  Effect,
  Layer,
  Option,
  Redacted,
  Result,
  Schema,
} from "effect";
import {
  type HttpClient,
  HttpRouter,
  HttpServerRequest,
  type HttpServerResponse,
} from "effect/http";
import { agentPublished } from "../agents/coder-host/published.js";
import { routedSessions } from "../agents/coder-host/runtime-sessions.js";
import { installationDriveRegenerated } from "../agents/workspace-drive.js";
import { AUTH_DEPLOYMENT_ENVIRONMENT, DEPLOYMENT_ENVIRONMENT } from "../auth/auth-deployment.js";
import { cadenceOrUnavailable } from "../automations/automation-cadence.js";
import { queueGithubRuns } from "../automations/automation-github.js";
import type { SessionsForAccount } from "../automations/automation-runs.js";
import { HostedEnvironment } from "../environment.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedJsonResponse,
  hostedNotFoundRoute,
  hostedRefusing,
  hostedStoreOrUnavailable,
  parseJsonBytes,
  readBodyBytesEffect,
} from "../http/http-effect.js";
import { QUEUE_ACKNOWLEDGED, queueConsumer } from "../queues/queue-consumer.js";
import { ANY_METHOD, type WebRoutes } from "../route.js";
import { agentWakeOf, checksCompletedWakeOf, wakeAgents } from "./agent-wakes.js";
import { clearRevokedAuthorization, GitHubApp } from "./github-app.js";
import { GITHUB_DELIVERY_READ } from "./github-delivery-read-bounds.js";
import { setInstallationStatus } from "./github-installations.js";
import { actOnGitHubMention, githubMentionOf, type MentionServices } from "./github-mentions.js";
import { GitHubBackground } from "./github-rate-gate.js";

/**
 * github-webhook-app.ts -- our GitHub App's webhook: a delivery about a pull request or its checks reads what the agents on that branch published again, one about an installation marks its workspace active or not, and a revoked authorization clears that GitHub user's tokens.
 *
 * The events read are a pull request's, a check suite's, and a commit
 * status's, since the checks' one word counts the statuses beside the runs.
 * Note that a check run's delivery is not read, because GitHub sends one per
 * job, often many to a push, and the check suite completing covers the head once. GitHub signs every delivery with the App's webhook secret, and nothing is
 * read before the signature over the body's own bytes is confirmed in
 * constant time; a deployment holding no secret refuses every delivery as
 * unavailable, so an unconfigured webhook trusts nothing. Of a delivery only
 * its event, its action, the repository's id and full name, and the branches it
 * names are read, and none of them is logged: the branch finds the
 * agents whose rows stand on it, of whichever account, by their own
 * repository or one they work in beside it, and those that linked a pull
 * request from it whichever branch they stand on now, and what each
 * published is read again from GitHub on its owner's own token, exactly as
 * the agent's tab reads it (`packages/service/src/agents/coder-host/published.ts`), which writes
 * it on the agent's row for the task list. A delivery is therefore
 * idempotent: GitHub redelivering it reads the same pull request again. A
 * read that fails is logged by its kind alone and the delivery is still
 * answered, since GitHub retries nothing on its own and the next delivery
 * or the tab's next read reads again.
 *
 * A delivery's reads of GitHub, the pull requests read again and the
 * agents told, run past its answer on production and on a Preview: they are
 * published to the github-delivery-reads queue, whose consumer is a function
 * of its own, so a burst of deliveries never shares an instance with a
 * member's request, as GitHub asks
 * (https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks).
 * Anywhere else, as in a test, the reads run in the delivery before its
 * answer.
 *
 * Before anything else of a delivery is read, the repository it names is
 * recorded by GitHub's id under the name it carries
 * (`@repo/database/models/github-repositories`), which relabels every stored
 * name of the repository where GitHub renamed or transferred it since it was
 * last seen, so the agents, tasks, and automations below are found under
 * its name now; a delivery late or redelivered, older by the repository's
 * own `updated_at` than the one it was last seen in, moves nothing back. A `repository` delivery, which the App reads where it
 * subscribes to the Repository event, is read for that alone, its
 * `renamed` and `transferred` actions naming the name it had before, so a
 * repository renamed before the service ever saw it is relabeled too.
 *
 * An installation's own deliveries, which GitHub sends every App without
 * its subscribing, move the status of the workspace that stands for it
 * (`@repo/service/github/github-installations`): removed or suspended marks it
 * inactive, and unsuspended active again. Nothing is deleted, so an installation
 * suspended and brought back keeps its members and its tasks. GitHub never
 * redelivers a failed delivery on its own, so a status one missed is mended
 * by the next read of the installation from GitHub (`github-app.ts`). Its
 * `installation_repositories` deliveries, a repository given or taken, move
 * nothing held, because no repository of an installation is held: the chip
 * lists them from GitHub each time it opens, and every start checks its
 * repository there (`github-procedures.ts`, `workspace-repository.ts`). But
 * a repository given or taken, or an installation made, deleted, or brought
 * back, regenerates its workspace's drive past the answer
 * (`workspace-drive.ts`), so the drive holds what the workspace connects.
 *
 * A user revoking their authorization of the App, which GitHub also sends
 * without subscribing (`github_app_authorization`), drops that GitHub user's
 * account row and its tokens, so no account stands linked to a GitHub that no
 * longer answers it.
 *
 * Every delivery is also read as an automation's trigger
 * (`packages/service/src/automations/automation-github.ts`): a pull request or issue opened or
 * labeled, a check suite that failed, or a push queues a run, under the
 * delivery's own id, for each automation listing the repository that
 * listens for it, which the automation-runs queue's consumer starts. A
 * comment that mentions the App's bot, by a person with write access,
 * starts an agent as its writer or reaches the agent whose pull request it
 * is (`github-mentions.ts`). And a
 * review, a comment on a pull request, or a check that failed on an
 * agent's branch is told to the agents on that pull request as a message
 * from GitHub (`agent-wakes.ts`), and so is every check on an agent's head
 * finished, to the agent at work waiting on them, each through the sessions
 * of the harness its conversation runs on, acting for the agent's starter
 * (`routedSessions`).
 */

/** The path GitHub delivers to, as the App's settings name it under the deployment's origin. */
const GITHUB_WEBHOOK_PATH = "/api/github/webhook";

/** The headers a delivery carries that are read here. */
const DELIVERY_HEADER = {
  EVENT: "x-github-event",
  /** GitHub's id for the delivery, the same on a redelivery, which an automation's run is recorded under. */
  DELIVERY: "x-github-delivery",
  SIGNATURE: "x-hub-signature-256",
} as const;

/** What the signature header leads with before the HMAC's hex. */
const SIGNATURE_PREFIX = "sha256=";

/** The events a delivery is read for; any other is answered and ignored. */
const WEBHOOK_EVENT = {
  /** GitHub's own test delivery as the webhook is saved. */
  PING: "ping",
  PULL_REQUEST: "pull_request",
  CHECK_SUITE: "check_suite",
  /** A commit status, which the checks' one word counts beside the check runs. */
  STATUS: "status",
  /** The App installed, removed, suspended, or brought back on an account. */
  INSTALLATION: "installation",
  /** Repositories given to an installation or taken from it. */
  INSTALLATION_REPOSITORIES: "installation_repositories",
  /** A user revoked their authorization of the App. */
  APP_AUTHORIZATION: "github_app_authorization",
  /** A repository created, renamed, transferred, or otherwise changed. */
  REPOSITORY: "repository",
} as const;

/** The repository actions whose delivery names the name it had before. */
const REPOSITORY_ACTION = {
  RENAMED: "renamed",
  TRANSFERRED: "transferred",
} as const;

/** The one action an authorization delivery has: the user revoked it. */
const AUTHORIZATION_REVOKED = "revoked";

/** What each installation action leaves its workspace's status at; any other action moves nothing. */
const INSTALLATION_ACTION_STATUS: ReadonlyMap<string, GitHubInstallationStatus> = new Map([
  ["deleted", GITHUB_INSTALLATION_STATUS.DELETED],
  ["suspend", GITHUB_INSTALLATION_STATUS.SUSPENDED],
  ["unsuspend", GITHUB_INSTALLATION_STATUS.ACTIVE],
]);

/** The installation actions after which the repositories it grants changed, as GitHub spells them. */
const GRANT_CHANGE_ACTION = {
  CREATED: "created",
  DELETED: "deleted",
  UNSUSPEND: "unsuspend",
  /** An `installation_repositories` delivery's: repositories given to the installation. */
  ADDED: "added",
  /** An `installation_repositories` delivery's: repositories taken from it. */
  REMOVED: "removed",
} as const;

/** The actions, by event, after which the workspace's drive is regenerated, since the repositories it connects changed. */
const DRIVE_CHANGE_ACTIONS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  [
    WEBHOOK_EVENT.INSTALLATION,
    new Set<string>([
      GRANT_CHANGE_ACTION.CREATED,
      GRANT_CHANGE_ACTION.DELETED,
      GRANT_CHANGE_ACTION.UNSUSPEND,
    ]),
  ],
  [
    WEBHOOK_EVENT.INSTALLATION_REPOSITORIES,
    new Set<string>([GRANT_CHANGE_ACTION.ADDED, GRANT_CHANGE_ACTION.REMOVED]),
  ],
]);

/** A pull request's actions that change what a task's row says of it: where it stands, its merge queue among it, its title, or its size. */
const PULL_REQUEST_ACTIONS: ReadonlySet<string> = new Set([
  "opened",
  "reopened",
  "closed",
  "edited",
  "synchronize",
  "ready_for_review",
  "converted_to_draft",
  "enqueued",
  "dequeued",
]);

/** GitHub caps a delivery at 25 MB; a pull request's is a few kilobytes, so this is generous and still bounded. */
const MAXIMUM_DELIVERY_BYTES = 5 * 1024 * 1024;

/** The most agents one delivery reads again, newest started first, so a delivery answers inside GitHub's ten seconds. */
const MAXIMUM_AGENTS_PER_DELIVERY = 10;

/** How many of those reads run at once. */
const READ_CONCURRENCY = 4;

const RepositorySchema = Schema.Struct({
  full_name: Schema.String,
  default_branch: Schema.optionalKey(Schema.String),
});

const HeadSchema = Schema.Struct({ head: Schema.Struct({ ref: Schema.String }) });

/** A delivery as far as it is read: what happened, and the repository and branches it names. */
const PullRequestDeliverySchema = Schema.Struct({
  action: Schema.String,
  repository: RepositorySchema,
  pull_request: HeadSchema,
});

const CheckSuiteDeliverySchema = Schema.Struct({
  repository: RepositorySchema,
  check_suite: Schema.Struct({
    head_branch: Schema.NullOr(Schema.String),
    pull_requests: Schema.Array(HeadSchema),
  }),
});

const StatusDeliverySchema = Schema.Struct({
  repository: RepositorySchema,
  branches: Schema.Array(Schema.Struct({ name: Schema.String })),
});

const InstallationDeliverySchema = Schema.Struct({
  action: Schema.String,
  installation: Schema.Struct({ id: Schema.Number }),
});

/** The repository any delivery names, by GitHub's id, its name, and when GitHub last saw it change, as of the delivery; absent from an installation's or an authorization's. */
const SightedDeliverySchema = Schema.Struct({
  repository: Schema.Struct({
    id: Schema.Number,
    full_name: Schema.String,
    updated_at: Schema.DateFromString,
  }),
});

const OwnerLoginSchema = Schema.Struct({ login: Schema.String });

/**
 * A repository delivery as far as its name before is read: a rename's old
 * name, or a transfer's old owner, a user or an organization
 * (https://docs.github.com/en/webhooks/webhook-events-and-payloads#repository).
 */
const RepositoryChangeDeliverySchema = Schema.Struct({
  action: Schema.String,
  repository: Schema.Struct({ name: Schema.String, owner: OwnerLoginSchema }),
  changes: Schema.Struct({
    repository: Schema.optionalKey(Schema.Struct({ name: Schema.Struct({ from: Schema.String }) })),
    owner: Schema.optionalKey(
      Schema.Struct({
        from: Schema.Struct({
          user: Schema.optionalKey(OwnerLoginSchema),
          organization: Schema.optionalKey(OwnerLoginSchema),
        }),
      }),
    ),
  }),
});

/** An authorization delivery as far as it is read: what happened, and GitHub's own id of the user it happened to. */
const AuthorizationDeliverySchema = Schema.Struct({
  action: Schema.String,
  sender: Schema.Struct({ id: Schema.Number }),
});

/** A delivery read against the few fields it is read for; every other key GitHub sends is dropped unread. */
function readDelivery<S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  payload: UnparsedWireValue,
) {
  return readEither(schema, { excess: EXCESS_KEYS.DROP })(payload);
}

/** The repository and branches a delivery is about, where it is one this webhook reads. */
interface DeliveryTarget {
  readonly repository: string;
  readonly branches: readonly string[];
}

/** Whether the signature header is the HMAC-SHA256 of the body's own bytes under the secret, compared in constant time. */
function signatureMatches(
  body: Uint8Array,
  header: string | null,
  secret: Redacted.Redacted,
): boolean {
  if (header === null || !header.startsWith(SIGNATURE_PREFIX)) return false;
  const offered = Buffer.from(header.slice(SIGNATURE_PREFIX.length), "hex");
  // The secret is revealed here alone, into the HMAC the compare reads.
  const wanted = createHmac("sha256", Redacted.value(secret)).update(body).digest();

  return offered.length === wanted.length && timingSafeEqual(offered, wanted);
}

/**
 * Each branch named once, the null a detached head leaves dropped, and the
 * repository's default branch dropped too. Note that the default branch
 * is never dropped where a delivery names none, and that an agent standing
 * on it has published nothing from it (`coder-host/published.ts`), so
 * reading every such agent again on each check of the default branch cost
 * a few queries an agent and could only answer nothing.
 */
function branchesOf(
  named: readonly (string | null)[],
  defaultBranch: string | undefined,
): readonly string[] {
  return [
    ...new Set(
      named.filter((branch): branch is string => branch !== null && branch !== defaultBranch),
    ),
  ];
}

/** The repository and branches the delivery is about, where its event and action are ones that move a pull request's row; nothing otherwise. */
function deliveryTarget(event: string, payload: UnparsedWireValue): DeliveryTarget | undefined {
  switch (event) {
    case WEBHOOK_EVENT.PULL_REQUEST: {
      const read = readDelivery(PullRequestDeliverySchema, payload);

      if (Result.isFailure(read) || !PULL_REQUEST_ACTIONS.has(read.success.action))
        return undefined;

      return {
        repository: read.success.repository.full_name,
        branches: branchesOf(
          [read.success.pull_request.head.ref],
          read.success.repository.default_branch,
        ),
      };
    }

    case WEBHOOK_EVENT.CHECK_SUITE: {
      const read = readDelivery(CheckSuiteDeliverySchema, payload);

      if (Result.isFailure(read)) return undefined;
      const suite = read.success.check_suite;

      return {
        repository: read.success.repository.full_name,
        branches: branchesOf(
          [suite.head_branch, ...suite.pull_requests.map((pr) => pr.head.ref)],
          read.success.repository.default_branch,
        ),
      };
    }

    case WEBHOOK_EVENT.STATUS: {
      const read = readDelivery(StatusDeliverySchema, payload);

      if (Result.isFailure(read)) return undefined;

      return {
        repository: read.success.repository.full_name,
        branches: branchesOf(
          read.success.branches.map((branch) => branch.name),
          read.success.repository.default_branch,
        ),
      };
    }

    default:
      return undefined;
  }
}

/** The `owner/name` a repository delivery says the repository had before, where its action is a rename or a transfer. */
function formerName(payload: UnparsedWireValue): string | undefined {
  const read = readDelivery(RepositoryChangeDeliverySchema, payload);

  if (Result.isFailure(read)) return undefined;
  const { action, repository, changes } = read.success;

  if (action === REPOSITORY_ACTION.RENAMED && changes.repository !== undefined) {
    return `${repository.owner.login}/${changes.repository.name.from}`;
  }

  const from = changes.owner?.from;
  const formerOwner = from?.organization?.login ?? from?.user?.login;

  return action === REPOSITORY_ACTION.TRANSFERRED && formerOwner !== undefined
    ? `${formerOwner}/${repository.name}`
    : undefined;
}

/** The repository a delivery names, with the name it had before where a repository delivery says; nothing for a delivery that names none. */
function repositorySighting(
  event: string,
  payload: UnparsedWireValue,
): RepositorySighting | undefined {
  const read = readDelivery(SightedDeliverySchema, payload);

  if (Result.isFailure(read)) return undefined;
  const { id, full_name: fullName, updated_at: updatedAt } = read.success.repository;
  const formerly = event === WEBHOOK_EVENT.REPOSITORY ? formerName(payload) : undefined;

  return { id, fullName, updatedAt, formerly };
}

/** The installation an installation delivery is about and the status its action leaves it at, where its action moves one. */
function installationTarget(
  payload: UnparsedWireValue,
): { readonly installationId: number; readonly status: GitHubInstallationStatus } | undefined {
  const read = readDelivery(InstallationDeliverySchema, payload);

  if (Result.isFailure(read)) return undefined;
  const status = INSTALLATION_ACTION_STATUS.get(read.success.action);

  return status === undefined
    ? undefined
    : { installationId: read.success.installation.id, status };
}

/** The installation a delivery says now grants other repositories; nothing for any other event or action. */
function installationRegranted(event: string, payload: UnparsedWireValue): number | undefined {
  const actions = DRIVE_CHANGE_ACTIONS.get(event);

  if (actions === undefined) return undefined;
  const read = readDelivery(InstallationDeliverySchema, payload);

  if (Result.isFailure(read) || !actions.has(read.success.action)) return undefined;

  return read.success.installation.id;
}

/** The GitHub user whose authorization a delivery says was revoked; nothing for any other action. */
function revokedAuthorization(payload: UnparsedWireValue): number | undefined {
  const read = readDelivery(AuthorizationDeliverySchema, payload);

  if (Result.isFailure(read) || read.success.action !== AUTHORIZATION_REVOKED) return undefined;

  return read.success.sender.id;
}

/** What the agents on the target's branches published, read again on each owner's token; answers how many reads landed. */
const readAgainOnBranches = /* @__PURE__ */ Effect.fn("web/githubWebhookReadAgain")(function* (
  target: DeliveryTarget,
): Effect.fn.Return<
  number,
  HostedRefusal,
  DatabaseServices | HttpClient.HttpClient | GitHubApp | Sandbox
> {
  const agents = yield* hostedStoreOrUnavailable(
    listAgentsOnBranches(target.repository, target.branches, MAXIMUM_AGENTS_PER_DELIVERY),
  );

  const landed = yield* Effect.forEach(
    agents,
    ({ userId, agent }) =>
      agentPublished(userId, agent, target.branches).pipe(
        Effect.as(true),
        // The kind alone: nothing of the delivery or the owner's token rides the line.
        Effect.catch((failure) =>
          Effect.as(
            Effect.logWarning("github webhook: an agent's pull request could not be read again", {
              failure: failure._tag,
            }),
            false,
          ),
        ),
      ),
    { concurrency: READ_CONCURRENCY },
  );

  return landed.filter(Boolean).length;
});

/** A delivery as its reads are handed on: its event, its id, and its payload as GitHub sent it. */
interface DeliveryToRead {
  readonly event: string;
  readonly deliveryId: string;
  readonly payload: UnparsedWireValue;
}

/** What a delivery's reads came to: the agents' pull requests read again, and the agents told. */
interface DeliveryReadCounts {
  readonly read: number;
  readonly told: number;
}

type DeliveryReadServices =
  | DatabaseServices
  | HttpClient.HttpClient
  | GitHubApp
  | Sandbox
  | MentionServices;

const NOTHING_READ: DeliveryReadCounts = { read: 0, told: 0 };

/**
 * A delivery's reads of GitHub: a comment that mentions the App's bot acted
 * on as its writer (`github-mentions.ts`), what the agents on its branches
 * published read again, then the agents its review, comment, failure, or
 * finished checks concern told, in the background lane, since no member
 * waits on it. Note that a comment the mention took is told no agent as
 * GitHub's own, because the mention sent it to the agent that holds the
 * pull request as its writer's message, and the agent hears it once.
 */
const deliveryReads = /* @__PURE__ */ Effect.fn("web/githubDeliveryReads")(
  function* ({
    event,
    deliveryId,
    payload,
  }: DeliveryToRead): Effect.fn.Return<DeliveryReadCounts, HostedRefusal, DeliveryReadServices> {
    // A deployment with no App configured knows no bot of its own, so every bot is another's.
    const agentLogin = yield* Effect.orElseSucceed((yield* GitHubApp).botLogin, () => undefined);
    const mention = githubMentionOf(event, payload, agentLogin);
    const taken = mention === undefined ? false : yield* actOnGitHubMention(mention);
    const target = deliveryTarget(event, payload);
    const read = target === undefined ? 0 : yield* readAgainOnBranches(target);
    const now = yield* Clock.currentTimeMillis;

    // Note that the checks finishing are read after the agents' pull requests were read again above,
    // because a wake tells only the agents whose row keeps the finished commit as their head.
    const wakes = [
      taken ? undefined : agentWakeOf(event, payload, now),
      checksCompletedWakeOf(event, payload, now),
    ];

    // Each agent's sessions as the deployment acting for its owner, as an automation's run reaches them.
    const sessionsForAccount: SessionsForAccount = routedSessions;

    const counts = yield* Effect.forEach(wakes, (wake) =>
      wake === undefined
        ? Effect.succeed(0)
        : wakeAgents(sessionsForAccount, wake, deliveryId, agentLogin),
    );

    return { read, told: counts.reduce((sum, count) => sum + count, 0) };
  },
  Effect.provideService(GitHubBackground, true),
);

/** A delivery's reads as a queue message carries them. */
const DeliveryMessageSchema = Schema.Struct({
  event: Schema.String,
  deliveryId: Schema.String,
  payload: WireValueSchema,
});

/** On Vercel: the reads published to their topic under GitHub's id for the delivery, so a redelivery is dropped; a publish that failed fails the delivery. */
const vercelHand = (delivery: DeliveryToRead) =>
  Effect.tryPromise(() =>
    send(GITHUB_DELIVERY_READ.TOPIC, delivery, {
      idempotencyKey: delivery.deliveryId,
      retentionSeconds: Math.ceil(Duration.toSeconds(GITHUB_DELIVERY_READ.RETAINED)),
    }),
  ).pipe(
    Effect.timeout(GITHUB_DELIVERY_READ.PUBLISH_WAIT),
    Effect.as(NOTHING_READ),
    Effect.mapError(() => HOSTED_REFUSAL.UNAVAILABLE),
  );

interface GitHubDeliveryReadsService {
  /** The delivery's reads handed on, answering what they came to where they ran before the answer. */
  readonly hand: (
    delivery: DeliveryToRead,
  ) => Effect.Effect<DeliveryReadCounts, HostedRefusal, DeliveryReadServices>;
}

/** Where a delivery's reads run: in the delivery by default, as a test or a local run has it. */
const GitHubDeliveryReads = Context.Reference<GitHubDeliveryReadsService>(
  "@repo/service/GitHubDeliveryReads",
  { defaultValue: () => ({ hand: deliveryReads }) },
);

/** The reads as the deployment's environment names them: on Vercel's queue on production and on a Preview, in the delivery anywhere else. */
export const githubDeliveryReadsFromEnvironment = Layer.effect(
  GitHubDeliveryReads,
  Effect.map(
    Config.option(Config.String(AUTH_DEPLOYMENT_ENVIRONMENT.ENVIRONMENT)),
    (deployment): GitHubDeliveryReadsService => ({
      hand: Option.exists(
        deployment,
        (named) =>
          named === DEPLOYMENT_ENVIRONMENT.PRODUCTION || named === DEPLOYMENT_ENVIRONMENT.PREVIEW,
      )
        ? vercelHand
        : deliveryReads,
    }),
  ).pipe(
    Effect.provideServiceEffect(
      ConfigProvider.ConfigProvider,
      Effect.sync(() => ConfigProvider.fromEnv()),
    ),
  ),
);

/**
 * The consumer's route handler over the services the function's runtime
 * handed it: each delivery's reads run and acknowledged, one that does not
 * decode dropped, and a failure left for the queue to deliver again after
 * `GITHUB_DELIVERY_READ.FAILED_AGAIN`.
 */
export function githubDeliveryReadsHandler(
  services: Context.Context<DeliveryReadServices>,
): (request: Request) => Promise<Response> {
  return queueConsumer(
    services,
    (message) =>
      Effect.gen(function* () {
        const decoded = yield* Effect.option(
          Schema.decodeUnknownEffect(DeliveryMessageSchema)(message),
        );

        if (Option.isNone(decoded)) {
          yield* Effect.logError("a github-delivery-reads message did not decode; it is dropped");

          return QUEUE_ACKNOWLEDGED;
        }

        yield* deliveryReads(decoded.value).pipe(
          Effect.tapCause((cause) =>
            Effect.logWarning(`a delivery's reads will run again: ${causeKind(cause)}`),
          ),
        );

        return QUEUE_ACKNOWLEDGED;
      }),
    GITHUB_DELIVERY_READ.FAILED_AGAIN,
  );
}

/** POST: one delivery, its signature confirmed before anything of it is read. */
const deliveryEndpoint = /* @__PURE__ */ Effect.fn("web/githubWebhookEndpoint")(
  function* (): Effect.fn.Return<
    HttpServerResponse.HttpServerResponse,
    HostedRefusal,
    HttpServerRequest.HttpServerRequest | HostedEnvironment | DeliveryReadServices
  > {
    const request = yield* HttpServerRequest.HttpServerRequest;

    if (request.method !== HTTP_METHOD.POST) {
      return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
    }

    const { githubWebhookSecret } = yield* HostedEnvironment;

    if (githubWebhookSecret === undefined) return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
    const body = yield* readBodyBytesEffect(MAXIMUM_DELIVERY_BYTES);
    const signature = request.headers[DELIVERY_HEADER.SIGNATURE] ?? null;

    if (!signatureMatches(body, signature, githubWebhookSecret)) {
      return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
    }

    const event = request.headers[DELIVERY_HEADER.EVENT] ?? "";

    if (event === WEBHOOK_EVENT.PING) return hostedJsonResponse(200, { read: 0 });
    const payload = yield* parseJsonBytes(body);

    if (event === WEBHOOK_EVENT.INSTALLATION || event === WEBHOOK_EVENT.INSTALLATION_REPOSITORIES) {
      const moved = event === WEBHOOK_EVENT.INSTALLATION ? installationTarget(payload) : undefined;

      if (moved !== undefined) {
        yield* hostedStoreOrUnavailable(setInstallationStatus(moved.installationId, moved.status));
      }

      // Note that the status is moved first, so an installation deleted regenerates a drive that drops its repositories.
      const regranted = installationRegranted(event, payload);

      if (regranted !== undefined) yield* installationDriveRegenerated(regranted);

      return hostedJsonResponse(200, { read: 0 });
    }

    if (event === WEBHOOK_EVENT.APP_AUTHORIZATION) {
      const githubUserId = revokedAuthorization(payload);

      if (githubUserId !== undefined) {
        yield* hostedStoreOrUnavailable(clearRevokedAuthorization(githubUserId));
      }

      return hostedJsonResponse(200, { read: 0 });
    }

    // Note that the repository is recorded first, because a rename relabels the stored names the reads below match on.
    const sighting = repositorySighting(event, payload);

    if (sighting !== undefined) yield* hostedStoreOrUnavailable(noteGitHubRepository(sighting));

    if (event === WEBHOOK_EVENT.REPOSITORY) return hostedJsonResponse(200, { read: 0 });
    // A deployment with no App configured knows no bot of its own, so every bot is another's.
    const agentLogin = yield* Effect.orElseSucceed((yield* GitHubApp).botLogin, () => undefined);

    const queued = yield* cadenceOrUnavailable(
      queueGithubRuns(request.headers[DELIVERY_HEADER.DELIVERY] ?? "", event, payload, agentLogin),
    );

    const delivery = {
      event,
      deliveryId: request.headers[DELIVERY_HEADER.DELIVERY] ?? "",
      payload,
    };

    const { read, told } = yield* (yield* GitHubDeliveryReads).hand(delivery);

    return hostedJsonResponse(200, { read, queued, told });
  },
  // Note that no member waits on a delivery, so what it asks GitHub waits in the background lane (`github-rate-gate.ts`).
  Effect.provideService(GitHubBackground, true),
);

/** The group: the one delivery path, and the hosted vocabulary's own refusal for any other. */
export function githubWebhookApp(): WebRoutes<DeliveryReadServices> {
  return Layer.mergeAll(
    HttpRouter.add(ANY_METHOD, GITHUB_WEBHOOK_PATH, hostedRefusing(deliveryEndpoint())),
    hostedNotFoundRoute,
  );
}
