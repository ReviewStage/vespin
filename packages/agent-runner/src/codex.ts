/**
 * codex.ts -- one launch of Codex for an agent: `codex app-server` spawned on the account's ChatGPT plan or API key in the cloud, or the machine's own login on a host, the thread started or resumed, the service's lines turned into turns, steers, interrupts and restarts, every notification posted out, and the launch ended, or kept warm, once the agent's turn is over.
 *
 * One controller fiber owns the launch's state and acts on one signal at a
 * time: a line the service wrote, or what app-server reported (a message a turn
 * took, a turn completed, the process gone). Notifications are posted by the
 * reader as Codex writes them, so their order is Codex's own; the controller
 * only decides. A request it sends is awaited where it is sent, and whatever
 * app-server reports meanwhile waits its turn in the signal queue, so a
 * steered message is always recorded as sent before the notification that
 * says the turn took it.
 *
 * When the agent's turn is over (Codex's end-of-run rule). It is over at
 * the `turn/completed` of the turn the launch is running, on its own thread,
 * once no message the service sent is left unanswered. Each `turn/start` and `turn/steer`
 * carries a `clientUserMessageId`, which Codex echoes as the `clientId` of
 * the `userMessage` item a turn takes it in, and which is the service's own id for
 * the line where a message goes alone. As app-server takes a line (its
 * `turn/start` or `turn/steer` answered), the launch posts ACCEPTED naming
 * the line, as Claude Code's launch does, once for each line a merged turn
 * carries; a message no such item has
 * named by the turn's end (a steer the turn accepted too late to take, one
 * app-server refused because the turn had just ended, one that arrived in
 * between) is sent again, merged into one, as the next turn of the same
 * launch, which ends at that turn's completion by the same rule. Codex's
 * turn holds its own waits (its unified exec polls a long command inside the
 * turn, as P16 found), so nothing outlives `turn/completed` the way Claude
 * Code's background work outlives a `result`. A turn that is over ends the
 * launch as `turn_ended`, or, where the config asks it to stay `warm`, posts
 * IDLE and keeps the launch up (`RUNNER_WARM`) for the service's next message,
 * until the service or its host retires it or its warm window ends it as
 * `idled`; a `warm` line runs that window again from now, and such a launch is
 * warm from its start too. A message line marked `compact` compacts the
 * thread in its place (`thread/compact/start`) once no turn runs, the turn
 * app-server runs for it taken up from its `turn/started` and over at its
 * `turn/completed` by the same rule. One interrupted
 * after the service's stop ends the launch as `stopped`; a
 * failed turn, or one interrupted without a stop, as `failed`, with the
 * turn's error, so it shows as interrupted and Continue resumes the thread. A
 * stop with no turn running ends the launch at once; so does stdin closing
 * with none, while one running is let finish. App-server exiting, or the service
 * refusing the events, ends it as `failed`.
 *
 * Tokens. In the cloud's sandbox the runner signs app-server in on the
 * plan with host-supplied ChatGPT tokens, OpenAI's documented mode for a
 * host that owns the sign-in (https://learn.chatgpt.com/docs/app-server,
 * `chatgptAuthTokens`): as the process starts it asks the service at the
 * config's `tokenUrl`, under the runner's bearer, for the plan's access
 * token and the workspace it pays from, and hands them to
 * `account/login/start`; Codex's own OpenAI provider then sends them to
 * Codex's ChatGPT backend as its built-in ChatGPT sign-in does. When a
 * request gets a 401, app-server asks the runner for fresh ones
 * (`account/chatgptAuthTokens/refresh`), which it asks the service for in
 * turn, and retries the request, so a turn outlives any one token. The
 * sign-in that renews the token stays with the service; only the access
 * token enters the sandbox, held by app-server and in no environment.
 *
 * On a host app-server runs on the machine's own login, the one `codex
 * login` keeps in `CODEX_HOME` (`~/.codex` by default), through Codex's own
 * provider, and the runner names no provider, token, or key of its own: the
 * launch is handed none of the account's (`harnessEnvOf`). A cloud launch
 * whose environment holds `OPENAI_API_KEY` (one the account's OpenAI API key
 * pays for) asks no token: app-server reads the key from there, the
 * provider's documented `env_key`, and no command it runs inherits it; it is
 * a placeholder there, the key set in its place at the firewall.
 *
 * Speed. Each turn names its service tier: `fast` for a fast version,
 * which Codex sends as the API's `priority`, on the plan and an API key
 * alike, `ultrafast` for an Ultrafast one, on an API key alone, and null for
 * the standard tier. Codex sends a tier only
 * where its catalog lists it for the model (`service_tier_for_request`),
 * and the catalog it bundles lists no `ultrafast`, so an API-key launch
 * hands app-server a catalog of its own (`model_catalog_json`), read once
 * as it starts in place of the bundled one: the pinned release's own
 * (`codex-protocol/bundled-models.ts`) with the Ultrafast tier listed on
 * every model, which leaves the service's catalog, which offers an
 * Ultrafast version only where OpenAI prices one, the one gate on it.
 *
 * Subagents. A plan's launch hands app-server a catalog of its own too: the
 * pinned release's with no model naming a `multi_agent_version`, which is
 * what has Codex offer its subagent tools whatever its features say. OpenAI
 * refuses a plan's request that carries an `agent_message` item
 * (`subscription_sharing_unsupported_capability`), and a spawned subagent's
 * first request carries its task as one, as the parent's history carries
 * the subagent's answer, so one spawn would fail every later turn of the
 * thread.
 *
 * Sandbox. The agent's mode (`PERMISSION_MODE`) runs Codex as the Codex
 * app means it (https://learn.chatgpt.com/docs/sandboxing), set as the
 * thread starts and again in each `turn/start`, as app-server documents, so
 * a thread started under another mode runs under this one from its next
 * turn. Full access runs no sandbox of Codex's own, `danger-full-access`
 * with approval `never`: the machine is the boundary, a host's box, to which
 * an agent there has full access, or the cloud's sandbox, whose firewall
 * holds every credential and leaves only placeholders inside. Ask for
 * approval and Approve for me run Codex's workspace sandbox on its own
 * defaults, as the Codex app does: the checkout writable, its `.git`
 * protected, the network off, and approval `on-request`, so Codex asks to run
 * a command outside the sandbox, to reach the network, or to write outside
 * the checkout, a commit and an install among them, with no extras of
 * ours. Under Ask for approval the
 * member answers each ask (`approvals.ts`): Allow is Codex's `accept`, Always
 * allow its `acceptForSession`, which keeps the rule in the session rather
 * than writing one into `CODEX_HOME`, Deny or a message sent meanwhile its
 * `decline`, and a launch's end its `cancel`; app-server settling an ask
 * itself (`serverRequest/resolved`) withdraws it. Under Approve for me
 * Codex's automatic review answers them in the member's place, and a
 * command it denies or could not review says why at the end of its output
 * (`reviewNotes`). An MCP server's elicitation, which Codex declines itself
 * under approval `never`, is declined here under every mode. Note that two
 * gaps stand under the workspace sandbox: a command reaches Docker's socket,
 * through which it can write anywhere, and a checkout beside this one, which
 * the config does not name, is read-only. Commands still inherit no bearer
 * or key (`shell_environment_policy`), since none is theirs to use, a
 * placeholder or not.
 */

import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { Data, Duration, Effect, Exit, Fiber, Option, Queue, Schema, Scope, Stream } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import type { ChildProcessSpawner } from "effect/process";
import {
  type AppServer,
  AppServerError,
  type AppServerListener,
  type AppServerRequest,
  AppServerRequestFailed,
  spawnAppServer,
} from "./app-server.js";
import {
  type Approvals,
  cutInput,
  denyForMessage,
  denyWaiting,
  holdAsk,
  makeApprovals,
  settleAsk,
} from "./approvals.js";
import { CheckoutSnapshots } from "./checkout-snapshot.js";
import { CODEX_BUNDLED_MODELS_JSON } from "./codex-protocol/bundled-models.js";
import type {
  ApprovalsReviewer,
  AskForApproval,
  ChatgptAuthTokensRefreshResponse,
  CommandExecutionApprovalDecision,
  SandboxMode,
  SandboxPolicy,
  ThreadStartParams,
  TurnStatus,
  UserInput,
} from "./codex-protocol/v2/index.js";
import {
  mirrorRollout,
  openRolloutMirror,
  type RolloutMirror,
  restoreRollouts,
} from "./codex-rollout.js";
import { askPlanTokens, type CodexTokenFailed } from "./codex-token.js";
import {
  installedSkillsPath,
  type LaunchContext,
  type LaunchOutcome,
  runsOnHost,
  toolEnvOf,
} from "./launch.js";
import { codexMemoryWatch } from "./out-of-memory.js";
import {
  APPROVAL_BY,
  APPROVAL_DECISION,
  type ApprovalBy,
  type ApprovalDecision,
  type CheckoutSnapshot,
  CODEX_EFFORT,
  CODEX_ERROR_INFO,
  CONNECTION_LOST_DETAIL,
  type CodexConfig,
  type CodexEffort,
  type CodexNotification,
  type ContentBlock,
  codexErrorKind,
  connectionLostFailure,
  INPUT_LINE,
  INSTALLED_SKILLS,
  InputLineSchema,
  PERMISSION_MODE,
  type PermissionMode,
  RUNNER_END,
  RUNNER_ENV,
  RUNNER_EVENT,
  RUNNER_WARM,
  type RunnerApprovalRequested,
  type RunnerEnd,
} from "./protocol.js";
import {
  awaitProvider,
  codexConnectionLost,
  type ProbeTarget,
  type ProviderProbe,
  probeTargetOf,
  providerTargetOf,
} from "./reconnect.js";
import { RUNNER_SPAN } from "./trace.js";
import { transcriptStore } from "./transcripts.js";

/**
 * OpenAI's documented provider for a ChatGPT plan's token
 * (developers.openai.com/siwc/token-sharing-open-source/codex-app-server).
 */
const CHATGPT_PROVIDER = {
  ID: "openai_chatgpt_plan",
  NAME: "ChatGPT plan",
  BASE_URL: "https://api.openai.com/v1",
} as const;

/**
 * Where Codex's built-in ChatGPT sign-in sends its model calls (Codex
 * 0.163.0's `CHATGPT_CODEX_BASE_URL`), which a host's launch on the
 * machine's own login probes when a turn could not reach its provider.
 */
const CHATGPT_BACKEND_BASE_URL = "https://chatgpt.com/backend-api/codex";

/** The name our MCP server is registered under in Codex's config (`@repo/features/agent-tools`'s `WORKSPACE_MCP_SERVER`). */
const MCP_SERVER = "workspace";

/**
 * How long Codex waits on one of our tool calls, in seconds: our MCP
 * function's own duration (`workspace-mcp/app.ts`'s `WORKSPACE_MCP_FUNCTION`, the
 * longest `run_on_mac` and two minutes around it), so Codex never gives up
 * on a call the service is still running. Note that Codex's default is 60 s, past
 * which it fails the call while the service carries it out, and the agent retries a
 * call that already ran.
 */
const MCP_TOOL_TIMEOUT_SECONDS = 600;

/**
 * How long Codex waits on an integration's server to start, in seconds:
 * past the bound the service lists a provider's tools within
 * (`connection-door.ts`'s `LIST_TIMEOUT`, ten seconds), so a slow provider's
 * server answers no tools rather than being failed by Codex at its default
 * of ten (https://learn.chatgpt.com/docs/extend/mcp, `startup_timeout_sec`).
 */
const INTEGRATION_STARTUP_TIMEOUT_SECONDS = 20;

/**
 * Who the runner tells app-server it is. OpenAI asks that the name match the
 * `agent_name_hint` the sign-in sent, which is the product's name. The version is the
 * package's, which the bundle's build writes in (`--define`); an unbundled
 * runner, such as the tests', says `dev`.
 */
const CLIENT_INFO = {
  name: "Vespin",
  title: "Vespin",
  version: process.env.APP_RUNNER_VERSION ?? "dev",
} as const;

/** The JSON-RPC methods the runner sends, and the notifications it acts on. */
const METHOD = {
  INITIALIZE: "initialize",
  INITIALIZED: "initialized",
  ACCOUNT_LOGIN_START: "account/login/start",
  CHATGPT_AUTH_TOKENS_REFRESH: "account/chatgptAuthTokens/refresh",
  SKILLS_EXTRA_ROOTS_SET: "skills/extraRoots/set",
  THREAD_START: "thread/start",
  THREAD_RESUME: "thread/resume",
  THREAD_FORK: "thread/fork",
  THREAD_TURNS_LIST: "thread/turns/list",
  THREAD_REVERT: "thread/revert",
  THREAD_COMPACT_START: "thread/compact/start",
  TURN_START: "turn/start",
  TURN_STEER: "turn/steer",
  TURN_INTERRUPT: "turn/interrupt",
  TURN_STARTED: "turn/started",
  TURN_COMPLETED: "turn/completed",
  ITEM_STARTED: "item/started",
  ITEM_COMPLETED: "item/completed",
  COMMAND_APPROVAL: "item/commandExecution/requestApproval",
  FILE_CHANGE_APPROVAL: "item/fileChange/requestApproval",
  MCP_ELICITATION: "mcpServer/elicitation/request",
  SERVER_REQUEST_RESOLVED: "serverRequest/resolved",
  AUTO_REVIEW_COMPLETED: "item/autoApprovalReview/completed",
} as const;

/** JSON-RPC's code for a request the receiver refuses as it stands. */
const INVALID_REQUEST = -32600;

/** What the controller acts on, one at a time. */
const SIGNAL = {
  LINE: "line",
  INPUT_CLOSED: "input_closed",
  MESSAGE_TAKEN: "message_taken",
  TURN_STARTED: "turn_started",
  TURN_COMPLETED: "turn_completed",
  /** The provider's host was probed after a turn failed to reach it: it answered, or never did within the bound (`reconnect.ts`). */
  PROBED: "probed",
  EXITED: "exited",
  CUT_OFF: "cut_off",
} as const;

type Signal =
  | { readonly kind: typeof SIGNAL.LINE; readonly text: string }
  | { readonly kind: typeof SIGNAL.INPUT_CLOSED }
  | { readonly kind: typeof SIGNAL.MESSAGE_TAKEN; readonly clientId: string }
  | { readonly kind: typeof SIGNAL.TURN_STARTED; readonly turnId: string }
  | {
      readonly kind: typeof SIGNAL.TURN_COMPLETED;
      readonly turnId: string;
      readonly status: TurnStatus;
      readonly error: string | undefined;
      /** Codex's own word for why the turn failed (`codexErrorInfo`), as it wrote it. */
      readonly errorInfo: unknown;
    }
  | { readonly kind: typeof SIGNAL.PROBED; readonly answered: boolean }
  | { readonly kind: typeof SIGNAL.EXITED; readonly stderrTail: string }
  | { readonly kind: typeof SIGNAL.CUT_OFF; readonly why: string };

const LAUNCH_STATE = {
  IDLE: "idle",
  TURN: "turn",
  /** The launch waits for the provider's host to answer again; the service's messages wait with it (`waiting`). */
  RECONNECTING: "reconnecting",
} as const;

/**
 * Where the launch stands: idle, warm where it started warm or its turn
 * completed with nothing left and an IDLE posted, and no message taken since;
 * running the turn app-server named, stopping once a Stop interrupted it; or
 * reconnecting. A message sent while its turn stops waits for the next turn
 * rather than being steered into the one ending.
 */
type LaunchState =
  | { readonly kind: typeof LAUNCH_STATE.IDLE; readonly warm: boolean }
  | { readonly kind: typeof LAUNCH_STATE.TURN; readonly id: string; readonly stopping: boolean }
  | { readonly kind: typeof LAUNCH_STATE.RECONNECTING };

const IDLE: LaunchState = { kind: LAUNCH_STATE.IDLE, warm: false };

/**
 * A message the service sent, as Codex takes it, under the id Codex echoes when a
 * turn takes it: the service's own id for the line where it goes alone. `lines` are
 * the ids of the service's lines it carries, one for a line, several for a merged
 * next turn.
 */
interface Outgoing {
  readonly clientId: string;
  readonly input: readonly UserInput[];
  readonly lines: readonly string[];
  /** The checkout as it stood before the turn this message started (`checkout-snapshot.ts`); none for a steer, or where it could not be recorded. */
  readonly snapshot?: CheckoutSnapshot | undefined;
}

/** The fields of an answer the controller reads. */
const ThreadAnswerSchema = Schema.Struct({
  thread: Schema.Struct({
    id: Schema.String,
    path: Schema.optionalKey(Schema.NullOr(Schema.String)),
  }),
});
const TurnAnswerSchema = Schema.Struct({ turn: Schema.Struct({ id: Schema.String }) });
/** A page of a thread's turns as the rewind reads it: each turn's id and its user messages' client ids. */
const TurnsPageSchema = Schema.Struct({
  data: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      items: Schema.Array(
        Schema.Struct({
          type: Schema.String,
          clientId: Schema.optionalKey(Schema.NullOr(Schema.String)),
        }),
      ),
    }),
  ),
  nextCursor: Schema.NullOr(Schema.String),
});
const decodeThreadAnswer = Schema.decodeUnknownOption(ThreadAnswerSchema);

/** App-server's word for a thread resumed on another model provider than it was written on, in its refusal's message or data. */
const PROVIDER_MISMATCH = /model\s*provider\s*mismatch/i;
const decodeTurnsPage = Schema.decodeUnknownOption(TurnsPageSchema);
const decodeTurnAnswer = Schema.decodeUnknownOption(TurnAnswerSchema);
const decodeLine = Schema.decodeUnknownOption(Schema.fromJsonString(InputLineSchema));
/** The field of a refusal's `data` read here: the `TurnError`'s info, where app-server sent one. */
const decodeRefusalData = Schema.decodeUnknownOption(
  Schema.Struct({ codexErrorInfo: Schema.optionalKey(Schema.NullOr(Schema.Unknown)) }),
);

const CODEX_EFFORTS: ReadonlySet<string> = new Set(Object.values(CODEX_EFFORT));

/** Whether a model line's effort is one Codex takes. */
function isCodexEffort(effort: string): effort is CodexEffort {
  return CODEX_EFFORTS.has(effort);
}

/** A TOML basic string, as Codex's `-c key=value` reads one. */
function toml(value: string): string {
  return JSON.stringify(value);
}

/**
 * The service tiers a turn names on an API key: a fast version's, Codex's
 * documented `fast`, which it sends as the API's `priority`, and an
 * Ultrafast version's, which it sends as it is; a turn naming none runs on
 * the standard tier.
 */
const SERVICE_TIER = {
  FAST: "fast",
  ULTRAFAST: "ultrafast",
} as const;

type ServiceTier = (typeof SERVICE_TIER)[keyof typeof SERVICE_TIER];

/**
 * The Ultrafast tier as Codex's catalog lists a model's tiers
 * (`ModelServiceTier`, each of whose keys it requires), in the words
 * OpenAI's own catalog gives its tiers.
 */
const ULTRAFAST_CATALOG_TIER = {
  id: SERVICE_TIER.ULTRAFAST,
  name: "Ultrafast",
  description: "Fastest speed, highest usage",
} as const;

/** The file a launch writes its catalog to, in a folder of its own it removes as it ends. */
const CATALOG_FILE = { PREFIX: "vespin-codex-", NAME: "models.json" } as const;

/** The tier a turn names for the speed keys given; null, the standard tier, for neither. */
function serviceTierOf(
  fast: boolean | undefined,
  ultrafast: boolean | undefined,
): ServiceTier | null {
  if (ultrafast === true) return SERVICE_TIER.ULTRAFAST;
  return fast === true ? SERVICE_TIER.FAST : null;
}

/** A catalog entry as this file reads it: its tiers, and whatever else Codex reads, kept as it is. */
const CatalogSchema = Schema.Struct({
  models: Schema.Array(
    Schema.StructWithRest(
      Schema.Struct({ service_tiers: Schema.optionalKey(Schema.Array(Schema.Unknown)) }),
      [Schema.Record(Schema.String, Schema.Unknown)],
    ),
  ),
});

/** The pinned release's bundled catalog, as this file reads it. */
function bundledCatalog() {
  return Schema.decodeUnknownSync(CatalogSchema)(JSON.parse(CODEX_BUNDLED_MODELS_JSON));
}

/**
 * The pinned release's bundled catalog with the Ultrafast tier listed on
 * every model that lists none, as Codex's `model_catalog_json` reads it.
 */
function ultrafastCatalog(): string {
  const catalog = bundledCatalog();
  const isUltrafast = (tier: unknown) =>
    typeof tier === "object" && tier !== null && "id" in tier && tier.id === SERVICE_TIER.ULTRAFAST;
  const models = catalog.models.map((model) => {
    const tiers = model.service_tiers ?? [];
    return tiers.some(isUltrafast)
      ? model
      : { ...model, service_tiers: [...tiers, ULTRAFAST_CATALOG_TIER] };
  });
  return JSON.stringify({ ...catalog, models });
}

/**
 * The pinned release's bundled catalog with no model naming a
 * `multi_agent_version`, so Codex offers no subagent tools on the plan
 * (the file header's Subagents), as Codex's `model_catalog_json` reads it.
 */
function planCatalog(): string {
  const catalog = bundledCatalog();
  const models = catalog.models.map((model) =>
    Object.fromEntries(Object.entries(model).filter(([key]) => key !== "multi_agent_version")),
  );
  return JSON.stringify({ ...catalog, models });
}

/** The catalog given written to a folder of the launch's own, which the launch's scope removes; its absolute path, as `model_catalog_json` takes it. */
const catalogFile = (catalog: string) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const folder = mkdtempSync(join(tmpdir(), CATALOG_FILE.PREFIX));
      const file = join(folder, CATALOG_FILE.NAME);
      writeFileSync(file, catalog);
      return { folder, file };
    }),
    ({ folder }) => Effect.sync(() => rmSync(folder, { recursive: true, force: true })),
  ).pipe(Effect.map(({ file }) => file));

/**
 * OpenAI's API as an API key pays for it: the same endpoint, its key read
 * from the launch's environment through the provider's documented `env_key`
 * (https://developers.openai.com/codex/config-advanced/).
 */
const API_KEY_PROVIDER = {
  ID: "openai_api_key",
  NAME: "OpenAI API key",
} as const;

/** Which credential a launch's app-server runs on. */
const CODEX_AUTH = {
  /** The account's ChatGPT plan in the cloud's sandbox, app-server signed in on host-supplied tokens the runner asks the service for. */
  CHATGPT_TOKENS: "chatgpt_tokens",
  /** The machine's own login on a host, which app-server reads from `CODEX_HOME` itself. */
  MACHINE_LOGIN: "machine_login",
  /** The account's OpenAI API key, in the launch's environment. */
  API_KEY: "api_key",
} as const;

type CodexAuth = (
  | { readonly kind: typeof CODEX_AUTH.MACHINE_LOGIN }
  | {
      readonly kind: typeof CODEX_AUTH.CHATGPT_TOKENS;
      /** Where the plan's tokens are asked for: the service's token route. */
      readonly tokenUrl: string;
    }
  | { readonly kind: typeof CODEX_AUTH.API_KEY }
) & {
  /** The catalog app-server reads in place of its bundled one (`catalogFile`): `planCatalog` on the plan and the machine's login, `ultrafastCatalog` on an API key. */
  readonly catalog: string;
};

/**
 * Our provider for an API key, handed its key from `OPENAI_API_KEY` (the
 * documented `env_key`), and sending to OpenAI's API; none on host-supplied
 * tokens or the machine's own login, which Codex's own OpenAI provider
 * sends.
 */
function providerOverrides(auth: CodexAuth): (readonly [string, string])[] {
  if (auth.kind !== CODEX_AUTH.API_KEY) return [];
  const provider = `model_providers.${API_KEY_PROVIDER.ID}`;
  return [
    ["model_provider", toml(API_KEY_PROVIDER.ID)],
    [`${provider}.name`, toml(API_KEY_PROVIDER.NAME)],
    [`${provider}.base_url`, toml(CHATGPT_PROVIDER.BASE_URL)],
    [`${provider}.env_key`, toml(RUNNER_ENV.OPENAI_API_KEY)],
    [`${provider}.wire_api`, toml("responses")],
    [`${provider}.requires_openai_auth`, "false"],
    [`${provider}.supports_websockets`, "false"],
  ];
}

/**
 * The host app-server sends its model calls to on this credential: Codex's
 * ChatGPT backend for the machine's own login, which is most often a ChatGPT
 * sign-in, and OpenAI's API for every other, host-supplied tokens among
 * them, which Codex's own OpenAI provider sends there.
 */
function providerOf(auth: CodexAuth): ProbeTarget {
  return providerTargetOf(
    auth.kind === CODEX_AUTH.MACHINE_LOGIN ? CHATGPT_BACKEND_BASE_URL : CHATGPT_PROVIDER.BASE_URL,
  );
}

/** What every launch turns on beside its provider: the fast tier, the Ultrafast one on an API key, and the catalog the launch wrote. */
function featureOverrides(auth: CodexAuth): (readonly [string, string])[] {
  return [
    // A fast version runs on the `fast` tier, which the documented feature turns on, on the plan and an API key alike
    // (https://learn.chatgpt.com/docs/agent-configuration/speed). On an API key alone an Ultrafast one runs on the
    // `ultrafast` tier, which its own feature turns on and our catalog lists.
    ["features.fast_mode", "true"],
    ...(auth.kind === CODEX_AUTH.API_KEY ? ([["features.ultrafast_mode", "true"]] as const) : []),
    ["model_catalog_json", toml(auth.catalog)],
  ];
}

/** Codex's own folder under a home, where it keeps its login and threads unless `CODEX_HOME` names another. */
const CODEX_HOME_FOLDER = ".codex";

/**
 * How a launch runs Codex for its mode: the approval policy and sandbox
 * every thread and turn names, who answers an ask where one is asked, and
 * the argv beside them. Full access names no reviewer, as a launch from
 * before modes named none.
 */
interface CodexPermissions {
  readonly approvalPolicy: AskForApproval;
  readonly approvalsReviewer: ApprovalsReviewer | undefined;
  readonly sandbox: SandboxMode;
  readonly sandboxPolicy: SandboxPolicy;
  readonly overrides: readonly (readonly [string, string])[];
}

/** Full access: none of Codex's own sandbox, nothing asked (the file header's Sandbox). */
const FULL_ACCESS: CodexPermissions = {
  approvalPolicy: "never",
  approvalsReviewer: undefined,
  sandbox: "danger-full-access",
  sandboxPolicy: { type: "dangerFullAccess" },
  overrides: [
    ["approval_policy", toml("never")],
    ["sandbox_mode", toml("danger-full-access")],
  ],
};

/** Who answers Codex's asks in each mode that asks: the member, or Codex's automatic review. */
const REVIEWER_OF = {
  [PERMISSION_MODE.ASK]: "user",
  [PERMISSION_MODE.AUTO]: "auto_review",
} as const satisfies Record<
  Exclude<PermissionMode, typeof PERMISSION_MODE.FULL_ACCESS>,
  ApprovalsReviewer
>;

/**
 * The mode's permissions: full access as it always ran, or Codex's
 * workspace sandbox on its own defaults (no writable root beside the
 * checkout, the network off) with approval `on-request`, as the Codex app
 * runs its Ask for approval and Approve for me.
 */
function permissionsOf(mode: PermissionMode | undefined): CodexPermissions {
  if (mode === undefined || mode === PERMISSION_MODE.FULL_ACCESS) return FULL_ACCESS;
  const approvalsReviewer = REVIEWER_OF[mode];
  return {
    approvalPolicy: "on-request",
    approvalsReviewer,
    sandbox: "workspace-write",
    sandboxPolicy: {
      type: "workspaceWrite",
      writableRoots: [],
      networkAccess: false,
      excludeTmpdirEnvVar: false,
      excludeSlashTmp: false,
    },
    overrides: [
      ["approval_policy", toml("on-request")],
      ["approvals_reviewer", toml(approvalsReviewer)],
      ["sandbox_mode", toml("workspace-write")],
    ],
  };
}

/**
 * App-server's argv: our provider and its credential where the launch
 * runs on one of ours (`providerOverrides`), our MCP
 * server and each integration's beside it with the bearer read from the environment and their tools approved up
 * front (under `approval_policy = "never"` Codex 0.163.0 otherwise fails
 * every MCP call, as P16 found) and given as long as the service runs a call, the
 * mode's sandbox and approval policy (`CodexPermissions`), and commands inheriting the launch's whole
 * environment, the workspace's variables among it whatever their names,
 * without the bearer or the key, and handed in the cloud's sandbox the
 * image's tools' own (`toolEnvOf`), as Claude Code's commands are (`runner.ts`). Note
 * that Codex's default excludes, which drop every name holding `KEY`,
 * `SECRET`, or `TOKEN`, are ignored, because a workspace's variables are
 * mostly such names, and those a member set are its agents' to use. Nothing
 * in argv is secret.
 */
function appServerArgs(
  config: CodexConfig,
  auth: CodexAuth,
  permissions: CodexPermissions,
  toolEnv: Readonly<Record<string, string>>,
): string[] {
  const mcp = `mcp_servers.${MCP_SERVER}`;
  // Each integration the agent is handed is a server of its own on the same bearer, its tools approved and bounded as ours are.
  // Note that a cached catalog satisfies an integration's startup (`startup_readiness`) while it connects, so a
  // known integration holds no first turn; an integration with none waits no longer than Codex's grace for optional servers.
  const integrations = (config.integrations ?? [])
    .filter((integration) => integration.name !== MCP_SERVER)
    .flatMap((integration): (readonly [string, string])[] => {
      const server = `mcp_servers.${integration.name}`;
      return [
        [`${server}.url`, toml(integration.url)],
        [`${server}.bearer_token_env_var`, toml(RUNNER_ENV.BEARER)],
        [`${server}.default_tools_approval_mode`, toml("approve")],
        [`${server}.startup_timeout_sec`, INTEGRATION_STARTUP_TIMEOUT_SECONDS.toFixed(1)],
        [`${server}.startup_readiness`, toml("catalog")],
        [`${server}.tool_timeout_sec`, MCP_TOOL_TIMEOUT_SECONDS.toFixed(1)],
      ];
    });
  const excluded = [
    RUNNER_ENV.BEARER,
    ...(auth.kind === CODEX_AUTH.API_KEY ? [RUNNER_ENV.OPENAI_API_KEY] : []),
  ];
  const overrides: (readonly [string, string])[] = [
    ...providerOverrides(auth),
    ...featureOverrides(auth),
    [`${mcp}.url`, toml(config.mcpUrl)],
    [`${mcp}.bearer_token_env_var`, toml(RUNNER_ENV.BEARER)],
    [`${mcp}.default_tools_approval_mode`, toml("approve")],
    [`${mcp}.tool_timeout_sec`, MCP_TOOL_TIMEOUT_SECONDS.toFixed(1)],
    ...integrations,
    ...permissions.overrides,
    ["shell_environment_policy.inherit", toml("all")],
    ["shell_environment_policy.ignore_default_excludes", "true"],
    ["shell_environment_policy.exclude", `[${excluded.map(toml).join(", ")}]`],
    // Note that the image's tools are set apart, since app-server's own environment does not hold them.
    ...(Object.keys(toolEnv).length === 0
      ? []
      : ([
          [
            "shell_environment_policy.set",
            `{ ${Object.entries(toolEnv)
              .map(([name, value]) => `${name} = ${toml(value)}`)
              .join(", ")} }`,
          ],
        ] as const)),
  ];
  return [
    "app-server",
    "--listen",
    "stdio://",
    ...overrides.flatMap(([key, value]) => ["-c", `${key}=${value}`]),
  ];
}

/**
 * Whether a steer app-server refused waits for the next turn: the turn it
 * runs cannot take one (a review or a compaction, `activeTurnNotSteerable`
 * in the refusal's `TurnError`), or the turn ended under the steer, which
 * app-server refuses as an invalid request with no data (no active turn, or
 * another turn's id). Any other refusal, or no answer in time, fails the
 * launch rather than holding a message no turn may ever take.
 */
function steerWaits(error: AppServerError): boolean {
  if (error.data === undefined || error.data === null) return error.code === INVALID_REQUEST;
  const read = decodeRefusalData(error.data);
  return (
    Option.isSome(read) &&
    codexErrorKind(read.value.codexErrorInfo) === CODEX_ERROR_INFO.ACTIVE_TURN_NOT_STEERABLE
  );
}

/**
 * Whether app-server refused to resume a thread for its model provider: the
 * thread was written on another provider than this launch's
 * (`modelProviderMismatch`), as a plan's thread is once the agent's API key
 * pays, or the other way round. Such a thread is forked on this launch's
 * provider instead, which goes on with its history.
 */
function providerMismatch(error: AppServerError): boolean {
  return PROVIDER_MISMATCH.test(`${error.detail} ${JSON.stringify(error.data ?? null)}`);
}

/** A message line's blocks as Codex's `UserInput`: text as text, a base64 image as a data URL. */
function userInput(content: readonly ContentBlock[]): UserInput[] {
  return content.map((block) =>
    block.type === "text"
      ? { type: "text", text: block.text, text_elements: [] }
      : { type: "image", url: `data:${block.source.media_type};base64,${block.source.data}` },
  );
}

/** The launch's state, owned by the controller alone. */
interface CodexLaunch {
  readonly context: LaunchContext<CodexConfig>;
  readonly signals: Queue.Queue<Signal>;
  server: AppServer;
  serverScope: Scope.Closeable;
  threadId: string;
  state: LaunchState;
  /** Messages a turn was handed and has not yet taken, by the id Codex echoes. */
  readonly sent: Map<string, Outgoing>;
  /** Messages for the next turn. */
  waiting: Outgoing[];
  /** A compaction the service asked for while a turn ran, started once none runs. */
  compactNext: Outgoing | undefined;
  /** The service's lines this launch has said app-server took, each said once. */
  readonly accepted: Set<string>;
  /** The credential app-server runs on. */
  readonly auth: CodexAuth;
  /** How the launch's mode runs Codex. */
  readonly permissions: CodexPermissions;
  /** The asks waiting on the member (`approvals.ts`). */
  readonly approvals: Approvals;
  model: string;
  effort: CodexEffort | undefined;
  /** The service tier the next turn names (`turnTierOf`); null for the standard one. */
  tier: ServiceTier | null;
  /**
   * Whether the agent's turn is under way, as the service holds it: opened
   * by the turn a message starts, and over at the completion that leaves
   * no message unanswered (the end-of-run rule above). A turn started
   * while it is under way, for a steer the last turn could not take, is a
   * continuation of the same turn of the service's, so it records no
   * checkout: the one recorded as the turn opened stands.
   */
  open: boolean;
  /** The thread's rollout as the store mirrors it, where the config names the store. */
  readonly mirror: RolloutMirror | undefined;
  /** The provider's host, as app-server reaches it, which a lost connection is probed for. */
  readonly providerHost: string;
  /** Where that host is probed: the proxy app-server goes through, or the host itself. */
  readonly probeTarget: ProbeTarget;
  /** How many items the thread had started when the last carry-on was asked for, so a connection lost before any more fails the launch rather than probing again. */
  carriedOnAt: number | undefined;
  /** How many items the thread has started but the service's own messages, which say nothing of the model. */
  readonly heard: { count: number };
  /** The checkout recorded before a turn the line named opens (`checkout-snapshot.ts`); none where it could not be. */
  readonly snapshot: (lineId: string) => Effect.Effect<CheckoutSnapshot | undefined>;
}

/**
 * The service tier a turn of the launch names: the one asked for, but on the
 * plan, which hands Codex no catalog listing Ultrafast, the fast tier for an
 * Ultrafast version, as a runner from before Ultrafast runs it, rather than
 * a tier Codex would drop for the standard one.
 */
function turnTierOf(launch: Pick<CodexLaunch, "auth" | "tier">): ServiceTier | null {
  return launch.tier === SERVICE_TIER.ULTRAFAST && launch.auth.kind !== CODEX_AUTH.API_KEY
    ? SERVICE_TIER.FAST
    : launch.tier;
}

/** Ends the launch: the outcome the controller's loop stops on. */
function ended(end: RunnerEnd, failure = ""): LaunchOutcome {
  return { end, failure };
}

/** Where the listener reads the launch's thread from: known once the thread is open, or given to resume. */
interface ThreadSeen {
  readonly context: LaunchContext<CodexConfig>;
  readonly signals: Queue.Queue<Signal>;
  readonly approvals: Approvals;
  /** Whether the launch's mode asks, which serves app-server's approval requests rather than refusing them. */
  readonly asks: boolean;
  threadId: string | undefined;
  /** How many items the thread has started but the service's own messages (`CodexLaunch`'s `heard`). */
  readonly heard: { count: number };
}

/**
 * The plan's tokens as Codex's sign-in on host-supplied tokens takes them,
 * the service's answer passed on as it came. Codex is told no plan type,
 * which it takes as optional.
 */
const planTokens = (
  tokenUrl: string,
  bearer: LaunchContext<CodexConfig>["bearer"],
): Effect.Effect<ChatgptAuthTokensRefreshResponse, CodexTokenFailed, HttpClient.HttpClient> =>
  Effect.map(
    askPlanTokens(tokenUrl, bearer),
    // SAFETY: the workspace goes to app-server as the service named it; where it named none, app-server refuses the request.
    (answer) => ({ ...answer, chatgptPlanType: null }) as ChatgptAuthTokensRefreshResponse,
  );

/** The fields of an approval request the ask is posted with: the item that asks, and Codex's words for it. */
const ApprovalAskSchema = Schema.Struct({
  itemId: Schema.String,
  reason: Schema.optionalKey(Schema.NullOr(Schema.String)),
  command: Schema.optionalKey(Schema.NullOr(Schema.String)),
  cwd: Schema.optionalKey(Schema.NullOr(Schema.String)),
  grantRoot: Schema.optionalKey(Schema.NullOr(Schema.String)),
});
const decodeApprovalAsk = Schema.decodeUnknownOption(ApprovalAskSchema);
const decodeResolved = Schema.decodeUnknownOption(
  Schema.Struct({ requestId: Schema.Union([Schema.Number, Schema.String]) }),
);

/** Each approval request app-server makes, by the item type that asks, as the transcript names the call, and the words its ask is titled with. */
const APPROVAL_ASK = {
  [METHOD.COMMAND_APPROVAL]: { toolName: "commandExecution", title: "Run this command" },
  [METHOD.FILE_CHANGE_APPROVAL]: { toolName: "fileChange", title: "Make this file change" },
} as const;

/** Whether a method is one of app-server's approval requests. */
function isApprovalMethod(method: string): method is keyof typeof APPROVAL_ASK {
  return method === METHOD.COMMAND_APPROVAL || method === METHOD.FILE_CHANGE_APPROVAL;
}

/**
 * The member's decision in Codex's words (the file header's Sandbox): an ask
 * the launch's end or app-server itself settled is canceled; every other is
 * accepted, accepted for the session, or declined as decided.
 */
function codexDecisionOf(
  decision: ApprovalDecision,
  by: ApprovalBy,
): Extract<CommandExecutionApprovalDecision, string> {
  if (by === APPROVAL_BY.ENDED || by === APPROVAL_BY.ABORTED) return "cancel";
  switch (decision) {
    case APPROVAL_DECISION.ALLOW:
      return "accept";
    case APPROVAL_DECISION.ALLOW_FOR_AGENT:
      return "acceptForSession";
    case APPROVAL_DECISION.DENY:
      return "decline";
  }
}

/**
 * One approval request, posted as the ask on the item that made it and held
 * for the member's answer, under an id of the runner's own, since
 * app-server's restart with each launch; `asked` keeps which ask each of
 * app-server's ids stands for until it settles.
 */
function servedAsk(
  seen: ThreadSeen,
  asked: Map<string, string>,
  request: AppServerRequest & { readonly method: keyof typeof APPROVAL_ASK },
): Effect.Effect<Schema.Json, AppServerRequestFailed> {
  const params = decodeApprovalAsk(request.params);
  if (Option.isNone(params)) {
    return Effect.fail(
      new AppServerRequestFailed({ detail: "the approval request is unreadable" }),
    );
  }
  const { itemId, reason, command, cwd, grantRoot } = params.value;
  const { toolName, title } = APPROVAL_ASK[request.method];
  const requestId = randomUUID();
  const input = Object.fromEntries(
    Object.entries({ command, cwd, grantRoot }).filter(([, value]) => typeof value === "string"),
  );
  const requested: RunnerApprovalRequested = {
    type: RUNNER_EVENT.APPROVAL_REQUESTED,
    requestId,
    toolUseId: itemId,
    toolName,
    title,
    ...(typeof reason === "string" && reason !== "" ? { description: reason } : undefined),
    input: cutInput(input),
  };
  const key = String(request.id);
  return Effect.sync(() => asked.set(key, requestId)).pipe(
    Effect.andThen(
      holdAsk(seen.approvals, requested, (decision, by) => ({
        decision: codexDecisionOf(decision, by),
      })),
    ),
    Effect.ensuring(Effect.sync(() => asked.delete(key))),
  );
}

/** An MCP server's elicitation, declined: nobody answers a form for an agent. */
const DECLINED_ELICITATION = { action: "decline", content: null, _meta: null } as const;

/**
 * A command Codex's automatic review denied, or could not finish, said at
 * the end of the command's output as it is posted, so its row in the
 * transcript says why it did not run, a review that failed among them,
 * which would otherwise leave only a declined command. Note that the model
 * reads Codex's own words for the review, not this line.
 */
function reviewNotes(): (notification: CodexNotification) => CodexNotification {
  const notes = new Map<string, string>();
  return (notification) => {
    if (notification.method === METHOD.AUTO_REVIEW_COMPLETED) {
      const { targetItemId, review } = notification.params;
      const why = review.rationale ?? "";
      if (targetItemId === null || targetItemId === undefined) return notification;
      if (review.status === "denied") {
        notes.set(targetItemId, `Codex's automatic review denied this command. ${why}`.trim());
      } else if (review.status === "timedOut") {
        notes.set(targetItemId, "Codex's automatic review timed out, so this command did not run.");
      }
      return notification;
    }
    if (notification.method !== METHOD.ITEM_COMPLETED) return notification;
    const { item } = notification.params;
    const note = notes.get(item.id);
    if (item.type !== "commandExecution" || note === undefined) return notification;
    notes.delete(item.id);
    const said = item.aggregatedOutput ?? "";
    const aggregatedOutput = said === "" ? note : `${said.replace(/\n$/, "")}\n${note}`;
    return {
      ...notification,
      params: { ...notification.params, item: { ...item, aggregatedOutput } },
    };
  };
}

/**
 * What app-server reports, posted in order and turned into the controller's
 * signals; on host-supplied tokens, its ask for fresh ones after a 401,
 * answered with the service's (`refresh`); where the launch's mode asks,
 * each approval it asks, held for the member's answer, and withdrawn as it
 * settles it itself; and every MCP elicitation, declined.
 */
function listenerFor(
  seen: ThreadSeen,
  refresh: Effect.Effect<ChatgptAuthTokensRefreshResponse, CodexTokenFailed> | undefined,
): AppServerListener {
  const annotate = codexMemoryWatch();
  const reviewed = reviewNotes();
  const asked = new Map<string, string>();
  return {
    onRequest: (request) => {
      if (request.method === METHOD.CHATGPT_AUTH_TOKENS_REFRESH && refresh !== undefined) {
        return refresh.pipe(
          Effect.mapError((failure) => new AppServerRequestFailed({ detail: failure.detail })),
        );
      }
      if (request.method === METHOD.MCP_ELICITATION) return Effect.succeed(DECLINED_ELICITATION);
      if (!seen.asks || !isApprovalMethod(request.method)) return undefined;
      return servedAsk(seen, asked, { ...request, method: request.method });
    },
    onNotification: (notification) =>
      Effect.gen(function* () {
        yield* seen.context.sink.emit(
          reviewed(yield* Effect.promise(() => annotate(notification))),
        );
        if (notification.method === METHOD.SERVER_REQUEST_RESOLVED) {
          // App-server settled an ask itself, as an interrupt does: it is withdrawn, where it still waits.
          const resolved = decodeResolved(notification.params);
          const requestId = Option.isSome(resolved)
            ? asked.get(String(resolved.value.requestId))
            : undefined;
          if (requestId === undefined) return;
          yield* settleAsk(seen.approvals, requestId, APPROVAL_DECISION.DENY, APPROVAL_BY.ABORTED);
          return;
        }
        if (notification.method === METHOD.TURN_STARTED) {
          const { threadId, turn } = notification.params;
          if (threadId !== seen.threadId) return;
          yield* Queue.offer(seen.signals, { kind: SIGNAL.TURN_STARTED, turnId: turn.id });
          return;
        }
        if (notification.method === METHOD.TURN_COMPLETED) {
          const { threadId, turn } = notification.params;
          if (threadId !== seen.threadId) return;
          yield* Queue.offer(seen.signals, {
            kind: SIGNAL.TURN_COMPLETED,
            turnId: turn.id,
            status: turn.status,
            error: turn.error?.message,
            errorInfo: turn.error?.codexErrorInfo,
          });
          return;
        }
        if (notification.method !== METHOD.ITEM_STARTED) return;
        const { threadId, item } = notification.params;
        if (threadId !== seen.threadId) return;
        // Every item but a message of ours is the model's doing, so it counts as the model heard from.
        if (item.type !== "userMessage") {
          seen.heard.count += 1;
          return;
        }
        if (item.clientId === null) return;
        yield* Queue.offer(seen.signals, { kind: SIGNAL.MESSAGE_TAKEN, clientId: item.clientId });
      }),
    onExit: (stderrTail) =>
      Queue.offer(seen.signals, { kind: SIGNAL.EXITED, stderrTail }).pipe(Effect.asVoid),
  };
}

/** What a launch whose resumed thread's rollout the service's store did not hand back ends with. */
const ROLLOUT_UNREAD = "the thread's rollout could not be read from the service";

/** The resumed thread's rollout not written back from the service's store, which fails the launch before its thread opens. */
class RolloutUnread extends Data.TaggedError("RolloutUnread") {}

/**
 * Starts app-server in a scope of its own and opens the thread on it:
 * `thread/fork` where the thread is another agent's, `thread/resume` where
 * there is a thread to continue, `thread/start` otherwise. Answers the
 * server, its scope, the thread's id, and its rollout's path where
 * app-server named one. App-server is spawned, initialized and signed in
 * while the thread's rollout is written back (`rollouts`), which only the
 * thread's open waits on, because app-server reads a thread's rollout as
 * the thread opens rather than as it starts.
 */
const openAppServer = Effect.fn("agent-runner/openAppServer")(function* (
  launch: Pick<
    CodexLaunch,
    "context" | "signals" | "model" | "auth" | "heard" | "permissions" | "approvals"
  >,
  threadId: string | undefined,
  fork: boolean,
  /** Whether the thread's rollout stands on the sandbox's disk, written back where it had to be. */
  rollouts: Effect.Effect<boolean>,
) {
  const { config, env, bearer } = launch.context;
  const { auth } = launch;
  const serverScope = yield* Scope.make();
  const client = yield* HttpClient.HttpClient;
  // Note that the tokens are asked for on the launch's own client, since app-server's ask is answered on the reader's fiber.
  const tokens =
    auth.kind === CODEX_AUTH.CHATGPT_TOKENS
      ? planTokens(auth.tokenUrl, bearer).pipe(Effect.provideService(HttpClient.HttpClient, client))
      : undefined;
  // Note that the listener reads the thread's id from here, because a new
  // thread's notifications arrive before `thread/start` answers.
  const { permissions } = launch;
  const seen: ThreadSeen = {
    context: launch.context,
    signals: launch.signals,
    approvals: launch.approvals,
    asks: permissions !== FULL_ACCESS,
    threadId: fork ? undefined : threadId,
    heard: launch.heard,
  };
  const server = yield* spawnAppServer(
    {
      executable: config.executable,
      args: appServerArgs(config, launch.auth, permissions, toolEnvOf(env)),
      cwd: config.cwd,
      // Note that Claude Code's credentials, were they set, are no business of Codex's.
      env: {
        ...env,
        PATH: pathWithCodexTools(config.executable, env.PATH),
        [RUNNER_ENV.CLAUDE_TOKEN]: undefined,
        [RUNNER_ENV.API_KEY]: undefined,
      },
      inRunnerGroup: runsOnHost(env),
    },
    listenerFor(seen, tokens),
  ).pipe(Scope.provide(serverScope), (spawned) =>
    launch.context.trace.step(RUNNER_SPAN.CLI, spawned),
  );
  const opened = Effect.gen(function* () {
    // Note that the sign-in on host-supplied tokens is experimental, which app-server serves only to a client that opted in.
    yield* server.request(METHOD.INITIALIZE, {
      clientInfo: CLIENT_INFO,
      capabilities:
        tokens === undefined ? null : { experimentalApi: true, requestAttestation: false },
    });
    yield* server.notify(METHOD.INITIALIZED);
    if (tokens !== undefined) {
      const signedIn = yield* tokens.pipe(
        Effect.mapError(
          (failure) =>
            new AppServerError({ method: METHOD.ACCOUNT_LOGIN_START, detail: failure.detail }),
        ),
      );
      yield* server.request(METHOD.ACCOUNT_LOGIN_START, {
        type: "chatgptAuthTokens",
        ...signedIn,
      });
    }
    // The member's installed skills, beside the checkout's `.agents/skills`, before the thread lists them.
    const skills = installedSkillsPath(config.installedSkills, INSTALLED_SKILLS.SKILLS);
    if (skills !== undefined) {
      yield* server.request(METHOD.SKILLS_EXTRA_ROOTS_SET, { extraRoots: [skills] });
    }
    if (!(yield* rollouts)) return yield* new RolloutUnread();
    const thread = {
      cwd: config.cwd,
      model: launch.model,
      approvalPolicy: permissions.approvalPolicy,
      ...(permissions.approvalsReviewer === undefined
        ? undefined
        : { approvalsReviewer: permissions.approvalsReviewer }),
      sandbox: permissions.sandbox,
      developerInstructions: config.developerInstructions,
    } satisfies ThreadStartParams;
    // Note that a resume refused for its provider forks the thread, so whether it forked is told with the answer.
    const forking = (forkedId: string) =>
      server.request(METHOD.THREAD_FORK, { ...thread, threadId: forkedId, excludeTurns: true });
    const { answer, forked } =
      threadId === undefined
        ? { answer: yield* server.request(METHOD.THREAD_START, thread), forked: false }
        : fork
          ? { answer: yield* forking(threadId), forked: true }
          : yield* server
              .request(METHOD.THREAD_RESUME, { ...thread, threadId, excludeTurns: true })
              .pipe(
                Effect.map((resumed) => ({ answer: resumed, forked: false })),
                Effect.catchIf(providerMismatch, () =>
                  Effect.map(forking(threadId), (forkedAnswer) => ({
                    answer: forkedAnswer,
                    forked: true,
                  })),
                ),
              );
    const opened = decodeThreadAnswer(answer);
    if (Option.isNone(opened)) {
      return yield* new AppServerError({
        method: METHOD.THREAD_START,
        detail: "no thread in the answer",
      });
    }
    seen.threadId = opened.value.thread.id;
    return { ...opened.value.thread, forked };
  });
  const openedThread = yield* opened.pipe(
    (handshake) => launch.context.trace.step(RUNNER_SPAN.HANDSHAKE, handshake),
    Effect.tapError(() => Scope.close(serverScope, Exit.void)),
  );
  return {
    server,
    serverScope,
    threadId: openedThread.id,
    path: openedThread.path ?? undefined,
    forked: openedThread.forked,
  };
});

/** How many turns a page of the rewind's read back from the thread's end holds. */
const TURNS_PAGE = 10;

/**
 * The resumed thread reverted to before the turn that took the message a
 * rewind dropped, found by its client id reading back from the thread's
 * end; a thread no turn of which took it is left whole, as a rewind Codex
 * never heard of leaves nothing of its own to cut. Answers the path of the
 * segment the revert began (`codex-rollout.ts`), where Codex named one,
 * which the thread's later lines are written to. A revert that fails is
 * logged and the thread goes on whole, since the launch's message still
 * stands to be answered.
 */
const revertedBefore = Effect.fn("agent-runner/codex/revertedBefore")(function* (
  server: AppServer,
  threadId: string,
  rewindBefore: string,
): Effect.fn.Return<string | undefined, AppServerError> {
  let cursor: string | null = null;
  for (;;) {
    const page = decodeTurnsPage(
      yield* server.request(METHOD.THREAD_TURNS_LIST, {
        threadId,
        cursor,
        limit: TURNS_PAGE,
        sortDirection: "desc",
        itemsView: "full",
      }),
    );
    if (Option.isNone(page)) return undefined;
    const taking = page.value.data.find((turn) =>
      turn.items.some((item) => item.type === "userMessage" && item.clientId === rewindBefore),
    );
    if (taking !== undefined) {
      const answer = yield* server.request(METHOD.THREAD_REVERT, {
        threadId,
        beforeTurnId: taking.id,
      });
      const reverted = decodeThreadAnswer(answer);
      return Option.isSome(reverted) ? (reverted.value.thread.path ?? undefined) : undefined;
    }
    if (page.value.nextCursor === null) return undefined;
    cursor = page.value.nextCursor;
  }
});

/**
 * Says each of the service's lines a message carries was taken by app-server, as
 * Claude Code's launch says a line was handed to the SDK, so the service ties the
 * line to the turn that runs it. A line said once is not said again when a
 * message is sent again in the next turn. The checkout recorded before the
 * turn is said with the line that opened it alone, the first of a merged
 * message, since that is the line the turn stands under.
 */
const accepted = Effect.fn("agent-runner/codex/accepted")(function* (
  launch: CodexLaunch,
  outgoing: Outgoing,
) {
  for (const uuid of outgoing.lines) {
    if (launch.accepted.has(uuid)) continue;
    launch.accepted.add(uuid);
    const opening = uuid === outgoing.lines[0] ? outgoing.snapshot : undefined;
    yield* launch.context.sink.emit({
      type: RUNNER_EVENT.ACCEPTED,
      uuid,
      ...(opening === undefined ? undefined : { snapshot: opening }),
    });
  }
});

/** Starts the next turn with the messages given, merged into one. */
const startTurn = Effect.fn("agent-runner/startTurn")(function* (
  launch: CodexLaunch,
  messages: readonly Outgoing[],
) {
  const merged: Outgoing =
    messages.length === 1 && messages[0] !== undefined
      ? messages[0]
      : {
          clientId: randomUUID(),
          input: messages.flatMap((message) => message.input),
          lines: messages.flatMap((message) => message.lines),
        };
  // The checkout is recorded before app-server can touch it, under the first line the turn takes,
  // where the turn opens the agent's; a turn continuing one under way leaves the opening record standing.
  const first = merged.lines[0];
  const snapshot = launch.open || first === undefined ? undefined : yield* launch.snapshot(first);
  launch.open = true;
  const outgoing: Outgoing = { ...merged, snapshot };
  const answer = decodeTurnAnswer(
    yield* launch.server.request(METHOD.TURN_START, {
      threadId: launch.threadId,
      clientUserMessageId: outgoing.clientId,
      input: [...outgoing.input],
      model: launch.model,
      effort: launch.effort ?? null,
      approvalPolicy: launch.permissions.approvalPolicy,
      ...(launch.permissions.approvalsReviewer === undefined
        ? undefined
        : { approvalsReviewer: launch.permissions.approvalsReviewer }),
      sandboxPolicy: launch.permissions.sandboxPolicy,
      // Note that a null tier is the standard one, which a fast or Ultrafast version turned off goes back to.
      serviceTier: turnTierOf(launch),
    }),
  );
  if (Option.isNone(answer)) {
    return yield* new AppServerError({
      method: METHOD.TURN_START,
      detail: "no turn in the answer",
    });
  }
  launch.state = { kind: LAUNCH_STATE.TURN, id: answer.value.turn.id, stopping: false };
  launch.sent.set(outgoing.clientId, outgoing);
  yield* accepted(launch, outgoing);
});

/**
 * The turn a compaction runs as, until app-server names it: the thread's
 * compaction answers no turn of its own, and its `turn/started` names the
 * turn the launch then runs.
 */
const COMPACTION_TURN = "";

/**
 * Compacts the thread in the message's place, a turn app-server runs of
 * its own, which takes no words; the line is said taken once app-server
 * took the ask. Note that it is never among the messages a turn was
 * handed (`sent`), because no message item ever names it.
 */
const startCompaction = Effect.fn("agent-runner/codex/startCompaction")(function* (
  launch: CodexLaunch,
  outgoing: Outgoing,
) {
  yield* launch.server.request(METHOD.THREAD_COMPACT_START, { threadId: launch.threadId });
  launch.state = { kind: LAUNCH_STATE.TURN, id: COMPACTION_TURN, stopping: false };
  yield* accepted(launch, outgoing);
});

/** One of the service's lines, acted on; answers the launch's outcome where the line ends it. */
const takeLine = Effect.fn("agent-runner/codex/takeLine")(function* (
  launch: CodexLaunch,
  text: string,
) {
  const line = decodeLine(text);
  if (Option.isNone(line)) {
    // Note that we never echo the line: a message carries the user's words, a token line a secret.
    yield* Effect.logWarning("agent-runner: skipped a stdin line it could not read");
    return undefined;
  }
  const value = line.value;
  switch (value.type) {
    case INPUT_LINE.MESSAGE: {
      yield* launch.context.trace.taken;
      // A message sent while a call waits on the member's answer declines the call, and goes on as the member's words.
      yield* denyForMessage(launch.approvals, value.content);
      // Note that our id for the line is the id Codex echoes, so a turn that takes it names it.
      const uuid = value.uuid ?? randomUUID();
      const outgoing: Outgoing = { clientId: uuid, input: userInput(value.content), lines: [uuid] };
      const { state } = launch;
      // A compaction waits for a turn running, or a host being probed, to be over, as app-server compacts no thread at work.
      if (value.compact === true) {
        if (state.kind === LAUNCH_STATE.IDLE) yield* startCompaction(launch, outgoing);
        else launch.compactNext = outgoing;
        return undefined;
      }
      if (state.kind === LAUNCH_STATE.IDLE) {
        yield* startTurn(launch, [outgoing]);
        return undefined;
      }
      // A message sent while the provider's host is probed waits for it, and one sent while
      // the turn stops waits for that turn to end: either starts the next turn.
      if (state.kind === LAUNCH_STATE.RECONNECTING || state.stopping) {
        launch.waiting.push(outgoing);
        return undefined;
      }
      // A steer the turn cannot take waits for the next turn; any other refusal fails the launch.
      const steered = yield* launch.server
        .request(METHOD.TURN_STEER, {
          threadId: launch.threadId,
          expectedTurnId: state.id,
          clientUserMessageId: outgoing.clientId,
          input: [...outgoing.input],
        })
        .pipe(
          Effect.as(true),
          Effect.catchIf(steerWaits, () => Effect.succeed(false)),
        );
      if (!steered) {
        launch.waiting.push(outgoing);
        return undefined;
      }
      launch.sent.set(outgoing.clientId, outgoing);
      yield* accepted(launch, outgoing);
      return undefined;
    }
    case INPUT_LINE.STOP: {
      // A stop for another launch's turn is not this launch's to take.
      if (value.launch !== undefined && value.launch !== launch.context.config.firstSequence) {
        yield* Effect.logWarning("agent-runner: skipped a stop for another launch");
        return undefined;
      }
      const { state } = launch;
      if (state.kind !== LAUNCH_STATE.TURN) return ended(RUNNER_END.STOPPED);
      launch.state = { ...state, stopping: true };
      // Note that a turn app-server did not interrupt ends with the launch, which closes app-server, so a stop never waits on a hung one.
      const interrupted = yield* launch.server
        .request(METHOD.TURN_INTERRUPT, { threadId: launch.threadId, turnId: state.id })
        .pipe(
          Effect.as(true),
          Effect.catch(() =>
            Effect.logWarning("agent-runner: turn/interrupt failed").pipe(Effect.as(false)),
          ),
        );
      return interrupted ? undefined : ended(RUNNER_END.STOPPED);
    }
    case INPUT_LINE.RETIRE: {
      // Lines are taken one at a time, so a message ahead of this one already took the launch out of warm.
      const { state } = launch;
      if (state.kind === LAUNCH_STATE.IDLE && state.warm && launch.waiting.length === 0) {
        return ended(RUNNER_END.IDLED);
      }
      yield* Effect.logWarning("agent-runner: skipped a retire for a launch at work");
      return undefined;
    }
    // Note that a warm launch's window is its wait for the next signal, which this one already ran again from now.
    case INPUT_LINE.WARM:
      return undefined;
    case INPUT_LINE.APPROVAL: {
      const { requestId, decision, message } = value;
      if (!(yield* settleAsk(launch.approvals, requestId, decision, APPROVAL_BY.MEMBER, message))) {
        yield* Effect.logWarning("agent-runner: skipped an approval for no waiting call");
      }
      return undefined;
    }
    case INPUT_LINE.MODEL: {
      if (value.model !== undefined) launch.model = value.model;
      // Note that a line naming either speed key says both, the one it leaves out being off.
      if (value.fast !== undefined || value.ultrafast !== undefined) {
        launch.tier = serviceTierOf(value.fast, value.ultrafast);
      }
      if (value.effort !== undefined && isCodexEffort(value.effort)) launch.effort = value.effort;
      else if (value.effort !== undefined) {
        yield* Effect.logWarning("agent-runner: skipped an effort Codex does not take");
      }
      return undefined;
    }
  }
});

/** The rollout's new lines sent to the store, where the launch mirrors it; one the store did not take goes with the next. */
function mirrored(launch: Pick<CodexLaunch, "mirror">) {
  if (launch.mirror === undefined) return Effect.void;
  return mirrorRollout(launch.mirror).pipe(
    Effect.catch(() => Effect.logWarning("agent-runner: the rollout was not mirrored")),
  );
}

/** The turn this launch ran completed: the launch ends, or its unanswered messages start the next turn. */
const takeTurnCompleted = Effect.fn("agent-runner/codex/takeTurnCompleted")(function* (
  launch: CodexLaunch,
  signal: Extract<Signal, { kind: typeof SIGNAL.TURN_COMPLETED }>,
) {
  const { state } = launch;
  if (state.kind !== LAUNCH_STATE.TURN || signal.turnId !== state.id) return undefined;
  launch.state = IDLE;
  yield* mirrored(launch);
  // A stopped turn's own messages end with it; those sent since the stop start the next turn.
  if (state.stopping) {
    const since = launch.waiting;
    launch.sent.clear();
    launch.waiting = [];
    if (since.length === 0) return ended(RUNNER_END.STOPPED);
    yield* startTurn(launch, since);
    return undefined;
  }
  // A turn app-server gave up on for want of its provider's host is carried on once the host answers, not ended.
  if (signal.status === "failed" && codexConnectionLost(signal.errorInfo)) {
    return yield* connectionLost(launch);
  }
  if (signal.status === "failed")
    return ended(RUNNER_END.FAILED, signal.error ?? "the turn failed");
  if (signal.status === "interrupted") {
    return ended(RUNNER_END.FAILED, signal.error ?? "the turn was interrupted");
  }
  const unanswered = [...launch.sent.values(), ...launch.waiting];
  launch.sent.clear();
  launch.waiting = [];
  if (unanswered.length > 0) {
    yield* startTurn(launch, unanswered);
    return undefined;
  }
  // What the service wrote before the turn completed, still queued behind the
  // completion, is acted on before the launch is called over, so a
  // follow-up already sent starts the next turn rather than being dropped.
  for (;;) {
    const queued = yield* Queue.poll(launch.signals);
    if (Option.isNone(queued)) break;
    const done = yield* takeSignal(launch, queued.value);
    if (done !== undefined) return done;
  }
  if (launch.state.kind !== LAUNCH_STATE.IDLE) return undefined;
  launch.open = false;
  const compaction = launch.compactNext;
  if (compaction !== undefined) {
    launch.compactNext = undefined;
    yield* startCompaction(launch, compaction);
    return undefined;
  }
  if (launch.context.config.warm !== true) return ended(RUNNER_END.TURN_ENDED);
  // The agent's turn is over: the launch stays warm for the service's next message
  // rather than ending.
  launch.state = { kind: LAUNCH_STATE.IDLE, warm: true };
  yield* launch.context.sink.emit({ type: RUNNER_EVENT.IDLE });
  return undefined;
});

/**
 * App-server could not reach its provider: the launch posts CONNECTION_LOST
 * and probes the provider's host, unless the connection was lost again before
 * the thread started any item since the last carry-on, when the launch ends
 * failed rather than loop (`reconnect.ts`).
 */
const connectionLost = Effect.fn("agent-runner/codex/connectionLost")(function* (
  launch: CodexLaunch,
) {
  if (launch.carriedOnAt === launch.heard.count) {
    yield* Effect.logWarning(
      "agent-runner: the connection was lost again before the model answered",
    );
    return ended(
      RUNNER_END.FAILED,
      connectionLostFailure(launch.providerHost, CONNECTION_LOST_DETAIL.LOST_AGAIN),
    );
  }
  yield* Effect.logWarning(`agent-runner: lost the connection to ${launch.providerHost}`);
  launch.state = { kind: LAUNCH_STATE.RECONNECTING };
  yield* launch.context.sink.emit({
    type: RUNNER_EVENT.CONNECTION_LOST,
    host: launch.providerHost,
  });
  yield* awaitProvider(launch.probeTarget).pipe(
    Effect.flatMap((answered) => Queue.offer(launch.signals, { kind: SIGNAL.PROBED, answered })),
    Effect.forkScoped,
  );
  return undefined;
});

/**
 * The probe settled: the host answered, so the messages that waited start
 * the next turn, or, with none waiting, CONNECTION_RESTORED asks the service
 * for a carry-on line; or the bound passed, and the launch ends failed with
 * why.
 */
const connectionProbed = Effect.fn("agent-runner/codex/connectionProbed")(function* (
  launch: CodexLaunch,
  answered: boolean,
) {
  if (launch.state.kind !== LAUNCH_STATE.RECONNECTING) return undefined;
  launch.state = IDLE;
  if (!answered) {
    yield* Effect.logWarning(`agent-runner: ${launch.providerHost} did not answer within the wait`);
    return ended(
      RUNNER_END.FAILED,
      connectionLostFailure(launch.providerHost, CONNECTION_LOST_DETAIL.GAVE_UP),
    );
  }
  launch.carriedOnAt = launch.heard.count;
  const waiting = launch.waiting;
  launch.waiting = [];
  if (waiting.length > 0) yield* startTurn(launch, waiting);
  yield* launch.context.sink.emit({
    type: RUNNER_EVENT.CONNECTION_RESTORED,
    host: launch.providerHost,
    carryOn: waiting.length === 0,
  });
  return undefined;
});

/** One signal, acted on; answers the launch's outcome where it ends the launch. */
function takeSignal(
  launch: CodexLaunch,
  signal: Signal,
): Effect.Effect<
  LaunchOutcome | undefined,
  AppServerError,
  ChildProcessSpawner.ChildProcessSpawner | ProviderProbe | Scope.Scope
> {
  switch (signal.kind) {
    case SIGNAL.LINE:
      return takeLine(launch, signal.text);
    case SIGNAL.INPUT_CLOSED: {
      // A turn still running is let finish; the launch ends with it.
      const idle = launch.state.kind !== LAUNCH_STATE.TURN && launch.waiting.length === 0;
      return Effect.succeed(idle ? ended(RUNNER_END.INPUT_CLOSED) : undefined);
    }
    case SIGNAL.MESSAGE_TAKEN:
      launch.sent.delete(signal.clientId);
      return Effect.succeed(undefined);
    case SIGNAL.TURN_STARTED:
      if (launch.state.kind === LAUNCH_STATE.TURN && launch.state.id === COMPACTION_TURN) {
        launch.state = { ...launch.state, id: signal.turnId };
      }
      return Effect.succeed(undefined);
    case SIGNAL.TURN_COMPLETED:
      return takeTurnCompleted(launch, signal);
    case SIGNAL.PROBED:
      return connectionProbed(launch, signal.answered);
    case SIGNAL.EXITED:
      return Effect.succeed(
        ended(RUNNER_END.FAILED, `app-server exited: ${signal.stderrTail.trim()}`.trim()),
      );
    case SIGNAL.CUT_OFF:
      return Effect.succeed(ended(RUNNER_END.FAILED, signal.why));
  }
}

/** Whether the launch's environment holds the account's OpenAI API key, which app-server then runs on in place of the plan's token. */
function onApiKey(context: LaunchContext<CodexConfig>): boolean {
  const key = context.env[RUNNER_ENV.OPENAI_API_KEY];
  return key !== undefined && key !== "";
}

/**
 * The credential a launch's app-server runs on, with the catalog written for
 * it: on a host the machine's own login; in the cloud's sandbox the
 * account's API key where the environment holds it, and otherwise the plan
 * on host-supplied tokens.
 */
const authOf = Effect.fn("agent-runner/codexAuthOf")(function* (
  context: LaunchContext<CodexConfig>,
) {
  if (runsOnHost(context.env)) {
    return { kind: CODEX_AUTH.MACHINE_LOGIN, catalog: yield* catalogFile(planCatalog()) } as const;
  }
  if (onApiKey(context)) {
    return { kind: CODEX_AUTH.API_KEY, catalog: yield* catalogFile(ultrafastCatalog()) } as const;
  }
  return {
    kind: CODEX_AUTH.CHATGPT_TOKENS,
    tokenUrl: context.config.tokenUrl,
    catalog: yield* catalogFile(planCatalog()),
  } as const;
});

/**
 * Where Codex keeps its threads, which the rollout's mirror reads and
 * writes back to: `CODEX_HOME` where the launch names it, and on a host
 * that names none Codex's own default under the machine's home; none
 * where neither is known.
 */
function codexHomeOf(env: Readonly<Record<string, string | undefined>>): string | undefined {
  const named = env.CODEX_HOME;
  if (named !== undefined && named !== "") return named;
  const home = env.HOME;
  return runsOnHost(env) && home !== undefined && home !== ""
    ? join(home, CODEX_HOME_FOLDER)
    : undefined;
}

/**
 * The PATH app-server runs with: the one given, behind the folder of tools
 * Codex's own package keeps beside its binary (`codex-path`, its `rg`) where
 * the binary stands in one, as Codex's npm launcher puts it first.
 */
function pathWithCodexTools(executable: string, path: string | undefined): string | undefined {
  const tools = join(dirname(executable), "..", "codex-path");
  if (!existsSync(tools)) return path;
  return path === undefined || path === "" ? tools : `${tools}${delimiter}${path}`;
}

/**
 * One Codex launch, from its config to the moment app-server is ended.
 * Answers why it ended, and the failure where it failed.
 */
export const runCodex = Effect.fn("agent-runner/runCodex")(function* (
  context: LaunchContext<CodexConfig>,
) {
  const { config } = context;
  const snapshots = yield* CheckoutSnapshots;
  const auth = yield* authOf(context);
  const signals = yield* Queue.unbounded<Signal>();
  yield* context.cutOff.pipe(
    Effect.flatMap((why) => Queue.offer(signals, { kind: SIGNAL.CUT_OFF, why })),
    Effect.forkScoped,
  );
  // A thread resumed or forked has its rollout written back where the sandbox no longer holds it,
  // beside app-server's start.
  const codexHome = codexHomeOf(context.env);
  const store =
    config.transcriptsUrl === undefined || codexHome === undefined
      ? undefined
      : {
          store: transcriptStore(config.transcriptsUrl, context.bearer, context.trace.headers),
          codexHome,
        };
  const restoring = yield* (
    store === undefined || config.threadId === undefined
      ? Effect.void
      : restoreRollouts(store.store, store.codexHome, config.threadId)
  ).pipe(
    Effect.as(true),
    Effect.orElseSucceed(() => false),
    Effect.forkScoped,
  );
  const heard = { count: 0 };
  const provider = providerOf(auth);
  const permissions = permissionsOf(config.permissionMode);
  const approvals = yield* makeApprovals(context.sink);
  const opened = yield* openAppServer(
    { context, signals, model: config.model, auth, heard, permissions, approvals },
    config.threadId,
    config.fork === true,
    Fiber.join(restoring),
  ).pipe(Effect.result);
  if (opened._tag === "Failure") {
    const failure = opened.failure;
    return ended(
      RUNNER_END.FAILED,
      failure._tag === "RolloutUnread" ? ROLLOUT_UNREAD : `${failure.method}: ${failure.detail}`,
    );
  }
  const { path, forked, ...server } = opened.success;
  const reverting =
    config.threadId !== undefined && config.rewindBefore !== undefined
      ? revertedBefore(server.server, server.threadId, config.rewindBefore).pipe(
          Effect.catch((error) =>
            Effect.as(
              Effect.logWarning(`agent-runner: the thread was not rewound: ${error.method}`),
              undefined,
            ),
          ),
        )
      : Effect.succeed(undefined);
  const segment = yield* reverting;
  // Note that only a thread resumed as it was stands in the store whole: a fork's file, the fallback's for a provider among them, is Codex's new writing.
  const resumed = config.threadId !== undefined && !forked;
  // A fork cut by a revert stands on the file Codex forked it into, which the store holds none of, so it is sent whole before the mirror follows the thread.
  if (store !== undefined && path !== undefined && segment !== undefined && !resumed) {
    const forked = yield* openRolloutMirror(
      store.store,
      store.codexHome,
      server.threadId,
      path,
      false,
    ).pipe(Effect.option);
    if (Option.isSome(forked)) {
      yield* mirrorRollout(forked.value).pipe(
        Effect.catch(() => Effect.logWarning("agent-runner: the forked rollout was not mirrored")),
      );
    }
  }
  // The mirror follows the thread onto the segment a revert began, which the store holds none of yet.
  const mirroredPath = segment ?? path;
  const mirror =
    store === undefined || mirroredPath === undefined
      ? undefined
      : yield* openRolloutMirror(
          store.store,
          store.codexHome,
          server.threadId,
          mirroredPath,
          resumed && segment === undefined,
        ).pipe(Effect.option, Effect.map(Option.getOrUndefined));
  const launch: CodexLaunch = {
    context,
    signals,
    ...server,
    // Note that a warm launch is warm from its start, so one launched with no message waits for its first as one past an IDLE does.
    state: { kind: LAUNCH_STATE.IDLE, warm: config.warm === true },
    sent: new Map(),
    waiting: [],
    compactNext: undefined,
    accepted: new Set(),
    auth,
    permissions,
    approvals,
    model: config.model,
    effort: config.effort,
    tier: serviceTierOf(config.fast, config.ultrafast),
    open: false,
    mirror,
    providerHost: provider.host,
    probeTarget: probeTargetOf(context.env, provider),
    carriedOnAt: undefined,
    heard,
    snapshot: (lineId) =>
      config.agentId === undefined
        ? Effect.succeed(undefined)
        : snapshots.take(config.cwd, config.agentId, lineId),
  };

  // The service's lines join the signals in a loop of their own, so a line is
  // never held up behind what the controller is waiting on.
  yield* Stream.fromQueue(context.lines).pipe(
    Stream.runForEach((text) => Queue.offer(signals, { kind: SIGNAL.LINE, text })),
    Effect.andThen(Queue.offer(signals, { kind: SIGNAL.INPUT_CLOSED })),
    Effect.forkScoped,
  );
  const outcome = yield* Effect.gen(function* () {
    for (;;) {
      // A warm launch waits at most its window for the next signal, and ends where none came.
      const next =
        launch.state.kind === LAUNCH_STATE.IDLE && launch.state.warm
          ? yield* Queue.take(signals).pipe(
              Effect.timeoutOption(Duration.millis(config.warmForMs ?? RUNNER_WARM.IDLE_CAP_MS)),
            )
          : Option.some(yield* Queue.take(signals));
      if (Option.isNone(next)) return ended(RUNNER_END.IDLED);
      const done = yield* takeSignal(launch, next.value);
      if (done !== undefined) return done;
    }
  }).pipe(
    Effect.catch((error: AppServerError) =>
      Effect.succeed(ended(RUNNER_END.FAILED, `${error.method}: ${error.detail}`)),
    ),
  );
  // App-server ends before the launch's last event, so nothing it emits on
  // the way down is numbered after it. A call still waiting on the member is
  // canceled first, so its ask is resolved ahead of the launch's last event.
  yield* denyWaiting(approvals, APPROVAL_BY.ENDED);
  yield* Scope.close(launch.serverScope, Exit.void);
  yield* mirrored(launch);
  return outcome;
});
