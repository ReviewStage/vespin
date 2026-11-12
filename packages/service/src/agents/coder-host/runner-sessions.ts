/**
 * runner-sessions.ts -- a coding agent's sessions on a native harness: the runner launched on the machine we open for it, its stdin written to, and the machine's place stopped, resumed, and thrown away around it.
 *
 * The launch machinery the `claude_code` and `codex` implementations of
 * `AgentSessions` (`sessions/agent-sessions.ts`) share; each names what is
 * its own as a `RunnerHarness` (`claude-code-sessions.ts`,
 * `codex-sessions.ts`): the credential its runner is started with, its
 * config line, and the lines that go ahead of a message to a runner already
 * running. Its session is our own: an id minted as the session opens,
 * which the machine finds the agent's place by (in a sandbox, the name the
 * sandbox is opened under, so the Terminal tab and the stop find the
 * sandbox by it: `../agent-sandbox-open.ts`'s `agentSandboxOf`). The
 * harness's own session or thread id is the conversation's
 * `native_session`, which the events route records from what the runner
 * reports, and a relaunch resumes.
 *
 * `open` reads the harness's credential, claims the conversation's record,
 * and queues the first message, its files and what its words hand carried
 * on its line, and answers; the turn the message awaits is delivered through
 * its queue (`turn-delivery.ts`), whose consumer opens the agent's place with
 * its repository checked out, writes the skills its member installed into
 * the app beside it in the cloud (`native-skills.ts`), and launches the runner
 * (`deliverTurn`). A launch there that cannot succeed is the agent's failed
 * turn. On a Mac, whose runner takes its lines on its stdin, the open
 * launches it itself, a line its Mac takes up. The place, the launch, and every
 * write to the runner's stdin go through the agent's machine
 * (`../machine/agent-machine.ts`: a cloud sandbox in
 * `../machine/sandbox-machine.ts`, or the starter's Mac in
 * `../machine/device-machine.ts`, which the agent's row picks). A launch mints
 * the runner's bearer and records its digest on the agent's row, and starts
 * the runner with the harness's credential and the bearer in its
 * environment and nowhere else: never in its argv, its config line, a file,
 * or a record. A credential held at the place's firewall (one of
 * `HarnessLaunch`'s `credentials` its machine holds there) is kept there with the launch's swaps before
 * the runner starts, its placeholder in the environment in its place, and
 * sent with every write to the place's firewall while the launch stands
 * (`../sandbox-firewall.ts`); it stays there, with every other credential,
 * until the place stops or the next launch writes its own, a place a
 * launch's end leaves up, for a Terminal or for the launch that hands its
 * lines on, included. The launch declares the bearer as a credential its
 * machine hands over (`AgentMachineService`'s `deliverCredentials`): in a
 * sandbox it goes no further than its firewall either, the runner handed a
 * placeholder for it, which the firewall swaps for the bearer on requests to
 * our host, kept on the same terms. The config line and the first message
 * are its first lines. The machine records the runner and the first event number of its launch
 * beside its place, which is how a later call finds the runner it writes to.
 *
 * A message's words go as text and its images as image blocks; any other
 * file it carries, such as a PDF, is written into the machine first, outside
 * the checkout, and the line names its path (`runnerContent`).
 *
 * `send` writes the harness's lines and then a message line to that runner
 * while it runs. Where the place stopped or the runner ended, a runner that
 * reads its lines is queued the message for whichever launch runs next, and
 * the turn the message awaits is delivered through its queue
 * (`turn-delivery.ts`), whose consumer resumes the place and launches the
 * runner anew (`deliverTurn`), the launch setting the repository's
 * credential at its firewall again, with the next event number and the
 * harness's session to resume where one may be resumed (`resumedSessionOf`),
 * a fresh one otherwise, handed the agent's steps; a Mac's runner, fed on its stdin, and a message naming files are launched
 * in the request instead. A Mac's runner warm past its window
 * (`CODER.RUNNER_WARM`), or one a Stop was written to since its launch, is
 * ended rather than written to, and the message relaunches it, so no line
 * goes to a runner on its way down.
 * `cancel` writes `stop` to a runner that runs, scoped to the launch running
 * the turn the Stop names, and nothing once that turn is no longer under way;
 * past the answer, a turn still running `CODER.STOP_CONFIRM` on has its
 * runner ended and is settled canceled. `reset` retires the runner's
 * bearer and throws the place away. Nothing here streams: the runner posts its
 * events to the service itself.
 *
 * `warm`, for an agent a client has on screen, touches its running sandbox,
 * writes a runner that runs a `warm` line, which runs its warm window again
 * from now, or launches the runner with no message where none runs, past its
 * answer, so the next message goes into the running session as a line. A
 * sandbox's runner lives until its sandbox stops (`@repo/sandbox`'s
 * `SANDBOX_IDLE`); a Mac's ends itself past its window (`CODER.RUNNER_WARM`).
 *
 * At a launch's end (`runnerEnded`, which the events route calls on the
 * runner's END event) the place is left as it stands, for its own idle stop;
 * where a message waits on a launch that read its lines, the turn's delivery
 * is published again. An END from a launch a newer one replaced, told by its
 * event number, does nothing.
 *
 * `open`, `send`, `deliverTurn`, `cancel`, and `retune` each hold the
 * agent's runner lease (`agent-runner-lease.ts`) from before they read where
 * its runner stands until they wrote to it or launched it, so two calls at
 * once never both relaunch, each minting a bearer that shuts the other's
 * runner out, nor write at one stdin offset; the later call waits, and finds
 * the runner the earlier one launched. A call that waits past
 * `CODER.RUNNER_LEASE.WAIT` fails as unavailable; a send that finds the lease
 * held queues its message at once instead, and a turn's delivery is tried
 * again shortly.
 *
 * Every call answers in `AgentSessions`' outcomes, so a caller holds one interface
 * whichever runtime answers. What fails here (the machine, the store, GitHub, a
 * missing credential or snapshot) answers `failed`, said once in the log as an
 * error naming the agent, in the failure's own words, the sandbox's answer for a
 * sandbox's, and reported where no named refusal explains it (`agent-log.ts`);
 * a launch refused for the account's plan says which way its plan failed.
 * A turn's delivery whose launch cannot succeed fails its turn, with why,
 * and one whose store or machine was unreachable is delivered again by its
 * queue. Nothing else is retried but a resume that meets its sandbox still
 * stopping or being snapshotted, and a create on an image the registry is
 * still preparing (`sandbox-machine.ts`).
 */

import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  type ContentBlock,
  IMAGE_MEDIA_TYPE,
  INPUT_LINE,
  type InputLine,
  type IntegrationServer,
  LAUNCH_PATH,
  type LaunchPath,
  RUNNER_END,
  RUNNER_ENV,
  type RunnerConfig,
  type RunnerEnd,
  type RunnerTrace,
} from "@repo/agent-runner/protocol";
import type { DatabaseServices, StoreFailure } from "@repo/database/core/query";
import { settleRunnerLostTurns } from "@repo/database/models/abandoned-turns";
import {
  type Agent,
  hasRepository,
  lastSettledTurnsOfReached,
  latestTurnsOfReached,
  RUNNING_TURN_STATUSES,
  readAgent,
  readAgentOfConversation,
  readAgentRouting,
  readNativeRunStanding,
  recordAgentNativeSession,
  recordAgentRunnerLaunch,
  recordAgentRunnerToken,
  runnerLaunchOf,
} from "@repo/database/models/agent-store";
import { holdsSession, markSessionBroken } from "@repo/database/models/claude-session-entries";
import {
  clearNativeRewindHanded,
  readNativeRewind,
} from "@repo/database/models/conversation-rewind";
import { deviceAgentAwaitsUpdate } from "@repo/database/models/device-agent-store";
import { holdsSessionClearedMark } from "@repo/database/models/message-reads";
import { parseKeyRing } from "@repo/database/models/provider-key-seal";
import {
  claimRuntimeSession,
  recordedRuntimeSession,
} from "@repo/database/models/recorded-session";
import {
  ANY_LAUNCH,
  clearRunnerLines,
  queueRunnerLine,
  requeueRunnerLine,
  runnerLineWaitingSince,
  waitingRunnerFiles,
  withdrawRunnerLine,
} from "@repo/database/models/runner-line-store";
import { turnAwaitedByLine } from "@repo/database/models/turn-state";
import { openWorkspaceEnvironment } from "@repo/database/models/workspace-environment-store";
import {
  readInstallScript,
  readRepositorySetup,
} from "@repo/database/models/workspace-sandbox-script-store";
import { type ConversationTarget, storeWriter } from "@repo/database/models/writer";
import type { RunnerLineFile } from "@repo/database/schemas/runner-line";
import {
  AGENT_PERMISSION_MODE,
  type AgentPermissionMode,
} from "@repo/features/agent-approval-wire";
import { BOOT_FAILURE, type BootFailure } from "@repo/features/agent-boot";
import { AGENT_MACHINE, type AgentMachineKind } from "@repo/features/agent-wire";
import { leadingCommand } from "@repo/features/slash-command";
import { TURN_FAILURE } from "@repo/features/turn-run";
import { REPOSITORY_SCRIPT_KIND } from "@repo/features/workspace-sandbox-setup-wire";
import { causeKind, failureKind } from "@repo/runtime/effect";
import {
  isSandboxError,
  type Sandbox,
  type SandboxError,
  type SandboxFile,
  SandboxUnavailable,
} from "@repo/sandbox";
import { TURN_STATUS, type WireValue } from "@repo/wire";
import type { UserContent } from "ai";
import { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import {
  Clock,
  Context,
  Deferred,
  Duration,
  Effect,
  Exit,
  Match,
  Option,
  Predicate,
  Redacted,
  Result,
  Schedule,
  Schema,
} from "effect";
import { SqlError } from "effect/sql/SqlError";
import { HostedEnvironment } from "../../environment.js";
import {
  recordServerEvent,
  type SERVER_AGENT_HARNESS,
  SERVER_EVENT,
  SERVER_HANDOFF_PATH,
} from "../../events/server-events.js";
import { AfterResponse, afterResponse } from "../../http/after-response.js";
import { logStoreFailure } from "../../http/store-failure.js";
import { agentSpanAttributes, sentryRunnerTrace } from "../../observability/sentry.js";
import {
  AgentMachine,
  type AgentMachineService,
  ATTACHMENT_FILE_MODE,
  type DeliveredCredentials,
  type FoundPlace,
  LaunchRefused,
  type MachineLayout,
  type MachineLifecycle,
  type MachineName,
  type MachinePlace,
  type RecordedRunner,
  RUNNER_RECORD,
  type RunnerCredential,
  type RunnerHandle,
  type RunnerMark,
  type SandboxSetup,
} from "../machine/agent-machine.js";
import { deploymentLifecycle } from "../machine/agent-machines.js";
import { REPOSITORY_REFUSAL } from "../repository-shell.js";
import { LAUNCH_SWAP } from "../sandbox-firewall.js";
import { touchAgentSandbox } from "../sandbox-use.js";
import type { AdmittedConversation } from "../sessions/admitted-conversation.js";
import {
  MACHINE_UP,
  PLAN_REFUSAL,
  RUNTIME_REFUSAL,
  SESSION_CANCEL_OUTCOME,
  SESSION_RESET_OUTCOME,
  SESSION_SEND_OUTCOME,
  type SessionMessage,
  type SessionTurn,
} from "../sessions/agent-sessions.js";
import { experimentsOnIn, experimentsReadIn } from "../workspace-experiment-on.js";
import { BEARER_PREFIX, launchUrl, runnerTokenDigest } from "../workspace-mcp/bearer.js";
import { type AgentImage, AgentImageMissing } from "./agent-image.js";
import { agentFailureSaid, agentLogIds, keptFailureWords, runningLogId } from "./agent-log.js";
import { CODER, CODER_REFUSAL } from "./bounds.js";
import {
  type AgentRepositoryRead,
  agentFirewallSources,
  agentRepositoryRead,
  CheckoutRefused,
  type CheckoutServices,
  repositoryCredentialOf,
} from "./checkout.js";
import { contextWindowOf } from "./context.js";
import { COMMAND_ROUTE, type CommandRoute, routeBesideReplay } from "./harness-commands.js";
import { nativeSkillFiles } from "./native-skills.js";
import { permissionModeOf } from "./permission-mode.js";
import { restartReplayOf } from "./replay.js";
import { fileBlocksBytes, REPLAY_FIT } from "./replay-summary.js";
import { holdingRunner, holdingRunnerIfFree } from "./runner-lease.js";
import {
  type ApprovalLine,
  type NativeSessions,
  RUNNER_ANSWER,
  RUNNER_CHOICE,
  TURN_HANDOVER,
  type TurnHandover,
} from "./runtime-sessions.js";
import { nativeSkills } from "./skills.js";
import { CODER_TOOL_SET } from "./tool-set.js";
import type { TurnHanded } from "./turn-context.js";
import { TURN_DELIVERY } from "./turn-delivery-bounds.js";
import {
  coderTurnMessage,
  handedValue,
  readNativeTurnHanded,
  readPendingTurnHanded,
  recordNativeTurnHanded,
} from "./turn-message.js";

/** What the sessions reach: the store, GitHub, the sandboxes, the agent's machine, the agents' image, and the deployment's key ring. */
export type RunnerServices =
  | CheckoutServices
  | AgentMachine
  | AgentImage
  | HostedEnvironment
  | Sandbox;

/** What every harness's sessions are composed with. */
export interface RunnerSessionsOptions {
  /** The account the sessions act for: the agent's starter, whose conversation and key they read. */
  readonly userId: string;
  /**
   * Where the runner posts its events: the events route, which the composing
   * edge names. Every address the runner reaches us at is under its origin
   * (`native-agent-sessions.ts`), whose host a sandbox's firewall swaps the
   * runner's bearer in on (`runnerBearer`).
   */
  readonly eventsUrl: string;
  /** Where a runner on a machine that has it read its lines reads them (`RUNNER_LINES`), which the composing edge names. */
  readonly linesUrl: string;
  /** Our MCP server's endpoint, which the composing edge names. */
  readonly mcpUrl: string;
  /** Where a runner on a machine that keeps it keeps the CLI's transcript (`RUNNER_TRANSCRIPTS`), which the composing edge names. */
  readonly transcriptsUrl: string;
  /** The integrations the agent is handed as its launch starts, each an MCP server of its own beside ours. */
  readonly integrations: (agent: Agent) => Effect.Effect<readonly IntegrationServer[]>;
  /** Our coder instructions for the agent, naming its checkout and the files the service reads back where its machine keeps them, which the harness's config carries. */
  readonly instructions: (
    agent: Agent,
    place: Pick<MachineLayout, "checkoutPath" | "sharedFiles">,
  ) => Effect.Effect<string>;
  /** One past the last event the store applied of the conversation's runner, where a launch numbers its events from. */
  readonly nextSequence: (
    conversationId: string,
  ) => Effect.Effect<number, { readonly _tag: string }>;
}

/** What a launch's command is started with of the harness's own. */
export interface HarnessLaunch {
  /** The variables beside the bearer and the declared credentials: whatever else the harness reads. Never written anywhere but the command's environment. */
  readonly env: Readonly<Record<string, string>>;
  /** The harness's credentials, which its machine hands over beside the bearer (`AgentMachineService`'s `deliverCredentials`). */
  readonly credentials?: readonly RunnerCredential[];
}

/** The lines a message to a running runner goes behind. */
interface HarnessAhead {
  readonly lines: readonly InputLine[];
}

/**
 * What a harness's sessions do of their own; everything else is shared. Its
 * effects reach the shared services alone, and fail with `LaunchRefused`, or
 * with anything else tagged, which answers as unavailable.
 */
export interface RunnerHarness<E extends { readonly _tag: string }> {
  /** How the log and a message's unsupported attachment name it. */
  readonly name: string;
  /** Which harness it is, as a counted hand-off names it (`SERVER_EVENT.AGENT_HANDOFF`). */
  readonly runtime: (typeof SERVER_AGENT_HARNESS)[keyof typeof SERVER_AGENT_HARNESS];
  /** What a session id it mints begins with, before a fresh UUID. */
  readonly sessionPrefix: string;
  /** The credential a launch on a machine of the layout given starts with, read afresh for every launch. */
  readonly launch: (
    agent: Agent,
    layout: MachineLayout,
  ) => Effect.Effect<HarnessLaunch, E | LaunchRefused, RunnerServices>;
  /** The config line of a launch on a machine of the layout given, resuming the harness's session where one is named, cut before the line a rewind dropped where one waits. */
  readonly config: (
    agent: Agent,
    layout: MachineLayout,
    resume: string | undefined,
    firstSequence: number,
    rewindBefore: string | undefined,
  ) => Effect.Effect<RunnerConfig, E | LaunchRefused, RunnerServices>;
  /** What goes ahead of a message to a runner already running. */
  readonly ahead: (agent: Agent) => Effect.Effect<HarnessAhead, E | LaunchRefused, RunnerServices>;
  /** How a message opening with the command named is handed to the harness (`harness-commands.ts`). */
  readonly commandRoute: (name: string) => CommandRoute;
}

/** How many hex characters of a launch's fingerprint its record keeps. */
const FINGERPRINT_CHARS = 32;

/**
 * The statuses a failure answers as, which a caller logs: unavailable where
 * a machine or the store did not answer, and refused where the launch could
 * not start at all (no agent, no credential, no snapshot, no bundle).
 */
const FAILED_STATUS = { UNAVAILABLE: 503, REFUSED: 422 } as const;

/** The image types a message's file may carry to the harness as an image block. */
const isImageMediaType = Schema.is(Schema.Literals(Object.values(IMAGE_MEDIA_TYPE)));

/** How many hex digits a session id spells the instant it was minted in: enough for every millisecond until the year 10889. */
const MINTED_AT_DIGITS = 12;

/**
 * A session id the harness's prefix begins, minted at the instant given: the
 * instant in fixed-width hex, then a fresh UUID. The instant is what lets a
 * session opened later claim the conversation's record over one that
 * ended (`claimRuntimeSession`, forward only, by the instant each was minted in,
 * whatever prefix either begins with).
 */
function sessionIdOf(prefix: string, mintedAt: number): string {
  return `${prefix}${mintedAt.toString(16).padStart(MINTED_AT_DIGITS, "0")}-${randomUUID()}`;
}

/** The bearer's bytes before it is spelled, as many as a session key. */
const BEARER_BYTES = 32;

/** The header the runner presents its bearer in, named in lower case as the firewall matches it. */
const BEARER_HEADER = "authorization";

/**
 * The runner's bearer as its launch declares it: presented to our host in
 * the authorization header as a bearer, and fixed for the launch. Its
 * machine hands it over (`AgentMachineService`'s `deliverCredentials`): a
 * sandbox holds it at its firewall behind a placeholder, so its bytes never
 * enter the machine, and a Mac, which has no firewall of ours, hands the
 * runner the bearer itself.
 */
function runnerBearer(bearer: string, host: string): RunnerCredential {
  return {
    variable: RUNNER_ENV.BEARER,
    value: Redacted.make(bearer),
    target: { domain: host },
    header: BEARER_HEADER,
    scheme: BEARER_PREFIX,
    slot: LAUNCH_SWAP.RUNNER,
  };
}

/** How long a written file's name may be, which a tar header holds whole. */
const ATTACHMENT_NAME_CHARS = 80;

/** The developer's line as the runner takes it, under our id for it. */
type MessageLine = Extract<InputLine, { readonly type: typeof INPUT_LINE.MESSAGE }> & {
  readonly uuid: string;
};

/** A message line and the files it names, which are written into the running session before the line, and the turn it opens as the message named it. */
interface RunnerMessage {
  readonly line: MessageLine;
  readonly files: readonly SandboxFile[];
  readonly turn: SessionTurn;
  readonly spoken: boolean;
  readonly timeZone: string | undefined;
}

type RoutedContentResult = {
  readonly content: readonly ContentBlock[];
  readonly compact?: true;
  readonly goal?: true;
};

/**
 * A message line's blocks as its route hands them: the turn's words ahead
 * of the developer's, as every message goes; after them, so the harness
 * reads the line as words rather than a command; or the developer's alone,
 * for the harness to run as its own command or, marked, as the session's
 * compaction or a change of its goal (`harness-commands.ts`).
 */
function routedContent(
  route: CommandRoute,
  ahead: readonly ContentBlock[],
  content: readonly ContentBlock[],
): RoutedContentResult {
  switch (route) {
    case COMMAND_ROUTE.WORDS:
      return { content: [...ahead, ...content] };
    case COMMAND_ROUTE.ESCAPED:
      return { content: [...content, ...ahead] };
    case COMMAND_ROUTE.BARE:
      return { content };
    case COMMAND_ROUTE.COMPACT:
      return { content, compact: true };
    case COMMAND_ROUTE.GOAL:
      return { content, goal: true };
  }
}

/** A message line's words: its text blocks, one after another. */
function textOf(content: readonly ContentBlock[]): string {
  return content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n\n");
}

/** The bytes a line carries beside a replay ahead of it: the turn's words, the developer's, and each picture or document counted as a file (`fileBlocksBytes`). */
function besideBytes(turnText: string | undefined, content: readonly ContentBlock[]): number {
  const words = [
    turnText ?? "",
    ...content.flatMap((block) => (block.type === "text" ? [block.text] : [])),
  ];

  const files = content.filter((block) => block.type !== "text").length;

  return new TextEncoder().encode(words.join("\n\n")).byteLength + fileBlocksBytes(files);
}

/**
 * The session a launch resumes, as `resumedSessionOf` decides it: the
 * harness's session, forked as the CLI's own where it is a continued or
 * forked agent's source's; none for a fresh one, which `replay` says is
 * handed the agent's steps so far, since the session the agent had is one
 * no launch may resume.
 */
interface ResumedSession {
  readonly resume?: string;
  /** Whether the session resumes from the CLI's own files with the store left out of the launch, as one the store does not hold whole on a machine whose disk keeps it (`MachineLayout`'s `diskSessions`). */
  readonly fromDisk?: boolean;
  readonly fork?: boolean;
  /** The client id of the source's line a forked session is cut just before (`StoredStartedFrom`'s `cutBefore`); none where it is forked whole. */
  readonly cut?: string;
  readonly replay?: boolean;
}

/** The message line as the runner takes it, the turn's own words ahead of the developer's, and what the session has handed once it took it. */
interface OpenedLine {
  readonly line: InputLine;
  /**
   * What the session has handed once the line is, as the row keeps it: a
   * line queued for a runner that reads its lines carries it, and its
   * runner's ACCEPTED writes it (`runner-line-store.ts`'s `acceptRunnerLine`),
   * so a line no runner took hands nothing.
   */
  readonly handed: Option.Option<WireValue>;
  /** The same written on the row at once, for a line written to a runner's stdin, which takes it as it is written. */
  readonly taken: Effect.Effect<void, never, DatabaseServices>;
}

/** What a message line carries beside its words to the launch that takes it: the files it names, and what the session has handed once it is taken. */
interface CarriedLine {
  readonly files: readonly SandboxFile[];
  readonly handed: Option.Option<WireValue>;
}

/** A file's name as the sandbox's path holds it: a single segment of safe characters, cut short, its extension kept. */
function attachmentFileName(name: string, at: number): string {
  const safe = name.replace(/[^A-Za-z0-9._-]+/gu, "-").replace(/^[.-]+/u, "");
  const dot = safe.lastIndexOf(".");
  const extension = dot > 0 ? safe.slice(dot).slice(0, 16) : "";

  const stem = (dot > 0 ? safe.slice(0, dot) : safe).slice(
    0,
    ATTACHMENT_NAME_CHARS - extension.length,
  );

  return `${at + 1}-${stem === "" ? "attachment" : stem}${extension}`;
}

type RunnerContentResult = {
  readonly content: readonly ContentBlock[];
  readonly files: readonly SandboxFile[];
};

/**
 * A message's content as the runner's lines carry it, and the files it
 * names: words as text, an image as an image block, and any other file,
 * such as a PDF, written into the machine under the line's own folder of
 * the attachments folder given and named by its path. A file whose bytes
 * are not in the message, a URL
 * elsewhere, is named as not passed.
 */
function runnerContent(
  message: string | UserContent,
  harness: string,
  lineId: string,
  attachments: string,
): RunnerContentResult {
  if (Predicate.isString(message)) return { content: [{ type: "text", text: message }], files: [] };
  const files: SandboxFile[] = [];

  const content = message.flatMap((part, at): ContentBlock[] => {
    if (part.type === "text") return [{ type: "text" as const, text: part.text }];

    if (part.type !== "file" && part.type !== "image") return [];
    const mediaType = part.type === "file" ? part.mediaType : (part.mediaType ?? "");
    const data = part.type === "file" ? part.data : part.image;
    const base64 = base64Of(data);

    if (isImageMediaType(mediaType) && base64 !== undefined) {
      return [
        {
          type: "image" as const,
          source: {
            type: "base64" as const,
            media_type: mediaType,
            data: base64,
          },
        },
      ];
    }

    const name = part.type === "file" ? (part.filename ?? "a file") : "an image";

    if (base64 === undefined) {
      return [
        {
          type: "text" as const,
          text: `[${name} (${mediaType}) was attached but cannot be passed to ${harness}]`,
        },
      ];
    }

    const path = `${attachments}/${lineId}/${attachmentFileName(name, at)}`;
    files.push({
      path,
      contents: new Uint8Array(Buffer.from(base64, "base64")),
      mode: ATTACHMENT_FILE_MODE,
    });

    return [
      {
        type: "text" as const,
        text: `[${name} (${mediaType}) was attached: it is at ${path}, read it from there]`,
      },
    ];
  });

  return { content, files };
}

/** What a file or image part of a message carries, as the AI SDK types it. */
type PartData =
  | Extract<UserContent[number], { readonly type: "file" }>["data"]
  | Extract<UserContent[number], { readonly type: "image" }>["image"];

/** A file part's data as base64: a `data:` URL's payload, a string as it stands, or bytes encoded; nothing for a URL elsewhere. */
function base64Of(data: PartData): string | undefined {
  if (data instanceof Uint8Array) return Buffer.from(data).toString("base64");

  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("base64");
  const text = data instanceof URL ? data.href : Predicate.isString(data) ? data : undefined;

  if (text === undefined) return undefined;

  if (text.startsWith("data:")) {
    const comma = text.indexOf(",");

    return comma < 0 || !text.slice(0, comma).endsWith(";base64")
      ? undefined
      : text.slice(comma + 1);
  }

  return /^[A-Za-z0-9+/=\s]+$/u.test(text) ? text : undefined;
}

/** A line of the runner's stdin. */
function line(value: RunnerConfig | InputLine): string {
  return `${JSON.stringify(value)}\n`;
}

/** Lines as one write to the runner's stdin. */
function stdinText(lines: readonly InputLine[]): string {
  return lines.map(line).join("");
}

/**
 * The stop a Stop or a halt writes to the runner of the launch named, by its
 * first event number. One spelling, because a send looks for the very write
 * a Stop made (`stopWritten`), so a field added to the line moves both.
 */
function stopLine(launch: number): InputLine {
  return { type: INPUT_LINE.STOP, launch };
}

/**
 * What a runner was launched with that it cannot take up while it runs: its
 * credential, the integrations it was handed, and its permission mode
 * where it asks, as a digest. A warm
 * runner whose fingerprint no longer matches is relaunched rather than
 * handed the next message (`sendHolding`). The digest is one-way and
 * truncated, so the record carries nothing of the credential. Note that a
 * credential held at the firewall is read by its kind and its real value,
 * never its placeholder, which every launch mints afresh, under the key a
 * slot once named it by, so a digest reads as it did; that a declared
 * credential its machine hands the runner itself is read among the
 * variables, as one the harness set there itself once was; and that a
 * launch holding none digests what it did before any was held.
 */
function launchFingerprint(
  credential: HarnessLaunch,
  delivered: DeliveredCredentials,
  integrations: readonly IntegrationServer[],
  mode: AgentPermissionMode,
): string {
  const declared = credential.credentials ?? [];
  const isHeld = (each: RunnerCredential) => delivered.swaps.has(each.slot);

  const handed = declared.flatMap((each) => {
    const value = delivered.env[each.variable];

    return isHeld(each) || value === undefined ? [] : [[each.variable, value] as const];
  });

  const env = [...Object.entries(credential.env), ...handed].sort(([one], [other]) =>
    one.localeCompare(other),
  );

  const names = integrations.map((each) => each.name).sort();

  const slots = declared.filter(isHeld).map((each) => ({
    slot: each.slot,
    credential: Redacted.value(each.value),
  }));

  // Note that one slot is digested alone, under the key it was digested by, as the one a launch could hold before credentials were declared.
  const swapped = Match.value(slots.length).pipe(
    Match.when(0, () => undefined),
    Match.when(1, () => slots[0]),
    Match.orElse(() => slots),
  );

  // Note that full access is digested as nothing, as every launch before modes was, so its runners stay warm across the change.
  const asks = mode === AGENT_PERMISSION_MODE.FULL_ACCESS ? undefined : mode;

  return createHash("sha256")
    .update(JSON.stringify({ env, names, held: swapped, mode: asks }))
    .digest("hex")
    .slice(0, FINGERPRINT_CHARS);
}

/**
 * Whether a Mac's agent's last turn ended longer ago than its warm window
 * (`CODER.RUNNER_WARM`), so its runner may soon end itself
 * (`CODER.RUNNER_WARM_SLACK`); a sandbox's runner has no window. Never
 * while a turn runs; and never before any turn ended, whose
 * runner was launched for the turn that opened. Note that the window counts
 * from the newest turn to end, whatever turn stands queued behind it, since
 * no runner took that turn's line yet, this message's own among them.
 */
function pastWarmWindow(turnRunning: boolean, lastEndedAt: Date | undefined, now: number) {
  if (turnRunning || lastEndedAt === undefined) return false;

  return now - lastEndedAt.getTime() > Duration.toMillis(CODER.RUNNER_WARM);
}

/** The place a runner's handle names, without the runner. */
function placeOfHandle(handle: RunnerHandle): MachinePlace {
  return {
    machine: handle.machine,
    session: handle.session,
    name: handle.name,
    running: handle.running,
  };
}

/** Where a found place's record is kept, under the account and agent given. */
function recordOf(found: FoundPlace, userId: string, agentId: string) {
  return { machine: found.machine, session: found.session, name: found.name, userId, agentId };
}

/**
 * The agent's workspace's variables, opened for its launch on a cloud
 * machine; none on a Mac, nor in a deployment with no ring, under which
 * none could have been set.
 */
export function workspaceEnvironmentOf(agent: Agent, machine: AgentMachineKind) {
  return Effect.gen(function* () {
    if (machine !== AGENT_MACHINE.VERCEL) return {};
    const keys = (yield* HostedEnvironment).providerKeyEncryptionKeys;
    const ring = keys === undefined ? undefined : parseKeyRing(keys);

    if (ring === undefined || Result.isFailure(ring)) return {};

    return yield* openWorkspaceEnvironment(ring.success, agent.organizationId);
  });
}

/**
 * The agent's workspace's cloud setup scripts for a sandbox its launch
 * creates on a cloud machine, with the workspace's variables the setup
 * script runs with: its install script, and its repository's setup script,
 * each where one is saved; none on a Mac, where neither is saved, or where
 * they could not be read, which leaves the sandbox set up as before.
 */
function sandboxSetupOf(agent: Agent, machine: AgentMachineKind) {
  return Effect.gen(function* () {
    if (machine !== AGENT_MACHINE.VERCEL || agent.repository === null) return undefined;

    const [install, repository] = yield* Effect.all(
      [
        readInstallScript(agent.organizationId),
        readRepositorySetup(agent.organizationId, agent.repository, REPOSITORY_SCRIPT_KIND.SETUP),
      ],
      { concurrency: "unbounded" },
    );

    if (Option.isNone(install) && Option.isNone(repository)) return undefined;

    return {
      install: Option.getOrUndefined(Option.map(install, (row) => row.script)),
      repository: Option.getOrUndefined(Option.map(repository, (row) => row.script)),
      environment: yield* workspaceEnvironmentOf(agent, machine),
    } satisfies SandboxSetup;
  }).pipe(
    Effect.catch((failure) =>
      Effect.as(
        Effect.logWarning(`A workspace's cloud setup was not read: ${failure._tag}`),
        undefined,
      ),
    ),
  );
}

/** The agent's workspace's cloud setup scripts as `sandboxSetupOf` reads them, bound to the caller's services, for a relaunch whose place may be made anew. */
const cloudSetupOf = (agent: Agent, machine: AgentMachineKind) =>
  Effect.map(Effect.context<DatabaseServices | HostedEnvironment>(), (services) =>
    Effect.provideContext(sandboxSetupOf(agent, machine), services),
  );

/** How a message reached its runner, as the handoff counts it. */
type HandoffPath = (typeof SERVER_HANDOFF_PATH)[keyof typeof SERVER_HANDOFF_PATH];

/** The span one launch of a runner runs under, from its swaps kept to its first lines taken, which the launch's path, harness, and machine annotate. */
const LAUNCH_SPAN = "web/agentLaunch";

/** The path of a launch in a place found and run again: made anew where its disk was lost, else launched again where it was still up, else resumed from its snapshot. */
function resumedPath(created: boolean, wasUp: boolean): LaunchPath {
  if (created) return LAUNCH_PATH.FRESH;

  return wasUp ? LAUNCH_PATH.RELAUNCHED : LAUNCH_PATH.RESUMED;
}

/** Whether a call failed because its sandbox's run was stopping, or being snapshotted, under it: one a resume mends. */
function sandboxEnding(failure: { readonly _tag: string }): boolean {
  return Predicate.isTagged(failure, "SandboxEnding");
}

/** Whether a call failed because what it named is gone: a sandbox's run, or a Mac's runner, ended. */
function sandboxGone(failure: { readonly _tag: string }): boolean {
  return Predicate.isTagged(failure, "SandboxGone");
}

/** A resume past an answer tried again while its sandbox is still stopping or being snapshotted (`CODER.RESUME_WHILE_ENDING`). */
const RESUME_WHILE_ENDING = {
  schedule: Schedule.spaced(CODER.RESUME_WHILE_ENDING.SPACING),
  times: CODER.RESUME_WHILE_ENDING.TRIES,
  while: sandboxEnding,
};

/** A file a message names, as its runner line carries it to the launch that takes it. */
function carriedFile(file: SandboxFile): RunnerLineFile {
  return {
    path: file.path,
    contents: Buffer.from(file.contents).toString("base64"),
    mode: file.mode,
  };
}

/** A file a waiting runner line carries, as its launch writes it into the place. */
function writtenFile(file: RunnerLineFile): SandboxFile {
  return {
    path: file.path,
    contents: new Uint8Array(Buffer.from(file.contents, "base64")),
    mode: file.mode,
  };
}

/**
 * Lines queued for the account's agent's runner to read, written for the
 * launch named by its first event number, each message line under its own
 * id with what it carries (`CarriedLine`), its caller holding the agent's
 * runner lease, which keeps them in their order; refused where the account
 * holds the agent no longer.
 */
function queuedFor(
  userId: string,
  agentId: string,
  launch: number,
  lines: readonly InputLine[],
  carried?: CarriedLine,
) {
  return Effect.forEach(
    lines,
    (each) =>
      Effect.flatMap(
        queueRunnerLine(userId, {
          agentId,
          launch,
          text: JSON.stringify(each),
          ...(each.type === INPUT_LINE.MESSAGE && each.uuid !== undefined
            ? {
                lineId: each.uuid,
                ...(carried === undefined
                  ? undefined
                  : {
                      files: carried.files.map(carriedFile),
                      ...(Option.isSome(carried.handed)
                        ? { handed: carried.handed.value }
                        : undefined),
                    }),
              }
            : undefined),
        }),
        (place) =>
          Option.isSome(place)
            ? Effect.void
            : Effect.fail(new LaunchRefused({ reason: "no agent" })),
      ),
    { discard: true },
  );
}

/**
 * Lines handed to the runner a place records, for the account's agent:
 * queued for it to read where its launch reads its lines, which no 404
 * answers, written to its stdin where it does not.
 */
function deliveredTo(
  machine: MachineLifecycle,
  userId: string,
  agentId: string,
  runner: RecordedRunner,
  lines: readonly InputLine[],
): Effect.Effect<void, LaunchRefused | StoreFailure | SandboxError, DatabaseServices> {
  return runner.mark.linesRead === true
    ? queuedFor(userId, agentId, runner.mark.firstSequence, lines)
    : machine.writeLine(runner.handle, stdinText(lines));
}

/**
 * Whether a Stop's line was written to the runner since its launch, as
 * `deliveredTo` wrote it, which the runner ends on whether or not its turn
 * still runs: at once with no turn under way, and as `RUNNER_END.STOPPED`
 * once the turn it interrupts ends. Read under the agent's runner lease, which every
 * Stop holds while it writes, so a Stop written ahead of the caller is seen.
 * False on a machine that keeps nothing of what it wrote (`wrote`).
 */
function stopWritten(machine: MachineLifecycle, runner: RecordedRunner) {
  return machine.wrote(runner.handle, stdinText([stopLine(runner.mark.firstSequence)]));
}

/** The status a failure answers as. */
function failedStatus(failure: { readonly _tag: string }): number {
  if (failure instanceof LaunchRefused) {
    return failure.planRefusal === PLAN_REFUSAL.UNREACHABLE
      ? FAILED_STATUS.UNAVAILABLE
      : FAILED_STATUS.REFUSED;
  }

  if (failure instanceof AgentImageMissing) return FAILED_STATUS.REFUSED;

  return FAILED_STATUS.UNAVAILABLE;
}

/** Why a first launch's boot failed, in its own fixed words, from what its machine's open failed with. */
function bootFailureOf(failure: { readonly _tag: string }): BootFailure {
  if (failure instanceof CheckoutRefused) return BOOT_FAILURE.CHECKOUT_FAILED;

  if (failure instanceof LaunchRefused && (failure.deviceAway || failure.deviceRemoved)) {
    return BOOT_FAILURE.MAC_AWAY;
  }

  return BOOT_FAILURE.MACHINE_UNAVAILABLE;
}

/**
 * A failure in the words a line and a turn's record keep: a refusal's
 * reason, with what the sandbox's run threw where it threw; a sandbox's own
 * words (the call, and what its provider answered); and
 * the kind alone for any other.
 */
function failureWords(failure: { readonly _tag: string }): string {
  if (failure instanceof LaunchRefused) return failure.reason;

  if (failure instanceof CheckoutRefused) {
    return failure.detail === undefined ? failure.reason : `${failure.reason} ${failure.detail}`;
  }

  return isSandboxError(failure) ? failure.message : failureKind(failure);
}

/**
 * Whether a failure is a named outcome the developer is told as such, which
 * is logged and never reported: the account's plan or key refused, its
 * device removed or away, or the repository its workspace no longer reaches.
 */
function namedOutcome(failure: { readonly _tag: string }): boolean {
  if (failure instanceof CheckoutRefused) return failure.reason === CODER_REFUSAL.NOT_REACHABLE;

  return (
    failure instanceof LaunchRefused &&
    (failure.planRefusal !== undefined ||
      failure.keyRefusal !== undefined ||
      failure.deviceRemoved === true ||
      failure.deviceAway === true ||
      failure.modesUnsupported === true)
  );
}

/**
 * Whether a turn's hand-over that failed may succeed if the turn is
 * delivered again: the store unreached or refusing a statement, a checkout
 * that could not read the store or GitHub (`CODER_REFUSAL.GITHUB_UNAVAILABLE`),
 * or the sandbox answering that it is busy or at fault (`retryable`). Any other failure
 * (a refusal, a repository no longer reached, a snapshot missing, a sandbox
 * that could not be readied, a row that does not decode) is the turn's, as
 * every launch's failure past a Start's answer is.
 */
function mayTakeAgain(failure: { readonly _tag: string }): boolean {
  if (failure instanceof CheckoutRefused) {
    return failure.reason === CODER_REFUSAL.GITHUB_UNAVAILABLE;
  }

  if (failure instanceof SandboxUnavailable) return failure.retryable === true;

  return failure instanceof SqlError || failure instanceof EffectDrizzleQueryError;
}

/** The sessions for one account on the harness given, over the calling fiber's services. */
export const runnerSessions = <
  E extends { readonly _tag: string },
  Turn extends SessionTurn = SessionTurn,
>(
  harness: RunnerHarness<E>,
  options: RunnerSessionsOptions,
): Effect.Effect<NativeSessions<Turn>, never, RunnerServices> =>
  Effect.gen(function* () {
    const context = yield* Effect.context<RunnerServices>();
    const machine: AgentMachineService = yield* AgentMachine;
    const { userId } = options;
    const serviceHost = new URL(options.eventsUrl).hostname;

    /** The agent whose conversation the message is for. */
    const agentOf = (conversationId: string) =>
      Effect.flatMap(readAgentOfConversation(userId, conversationId), (agent) =>
        Option.isSome(agent)
          ? Effect.succeed(agent.value)
          : Effect.fail(new LaunchRefused({ reason: "no agent" })),
      );

    /** Whether the agent a place names is one the account reaches. */
    const ownsPlace = (found: FoundPlace) =>
      found.agentId === undefined
        ? Effect.succeed(false)
        : Effect.map(readAgent(userId, found.agentId), Option.isSome);

    /** The repository's credential set at the running place's firewall again, minted afresh, beside the launch's swaps; an agent with no repository has none, and nothing is written. */
    const renewCredential = (target: ConversationTarget, agent: Agent, place: MachinePlace) =>
      Effect.gen(function* () {
        if (!hasRepository(agent)) return;
        const sources = yield* agentFirewallSources(target, agent);
        yield* machine.firewall.write(place, agent.userId, sources);
      });

    /**
     * The files of the member's installed skills, less the repository's, for
     * the launch to install (`native-skills.ts`); none on a machine that
     * installs none (`MachineLayout`'s `skillsUpload`), as a device, whose
     * harnesses find whatever skills the machine's own home holds, so no
     * skill is even read for it.
     */
    const installedSkillFiles = (
      target: ConversationTarget,
      agent: Agent,
      layout: MachineLayout,
    ) => {
      const upload = layout.skillsUpload;

      return upload === undefined
        ? Effect.succeed<readonly SandboxFile[]>([])
        : Effect.map(nativeSkills(target, agent), (skills) => nativeSkillFiles(skills, upload));
    };

    /**
     * The member's installed skills uploaded for the launch to install, as a
     * new place opens; nothing where there are none. A write that fails is
     * logged, and the agent opens without them rather than not at all.
     */
    const writeInstalledSkills = (place: MachinePlace, files: readonly SandboxFile[]) =>
      (files.length === 0 ? Effect.void : machine.writeFiles(place, files)).pipe(
        Effect.catch((failure) =>
          Effect.logWarning(
            `The installed skills of a ${harness.name} agent were not written: ${keptFailureWords(failureWords(failure))}`,
          ),
        ),
      );

    /**
     * A failed launch's place thrown away where its agent is gone, deleted
     * while the place opened (its workspace's delete among them), so no
     * sandbox stands that nothing could reach or retire; a place whose agent
     * stands is left for the next message. A failure here is logged by its
     * kind alone, and the launch's own failure answered all the same.
     */
    const discardedWhereAgentGone = (agent: Agent, sessionId: string) =>
      Effect.gen(function* () {
        if (Option.isSome(yield* readAgent(userId, agent.id))) return;
        const found = yield* machine.findPlace(userId, sessionId);

        if (Option.isSome(found)) yield* machine.discard(found.value);
      }).pipe(
        Effect.catch((failure) =>
          Effect.logWarning(`a deleted agent's place was not discarded: ${failureKind(failure)}`),
        ),
      );

    /**
     * What one launch of the runner reads and records with no place, run
     * beside the place's opening or resume rather than after it, since none
     * of it waits on the place: the credentials its machine delivers
     * (`HarnessLaunch`'s `credentials`, `runnerBearer`), a fresh bearer
     * recorded, numbering the launch, ahead of its config, whose URLs name
     * that number (`launchUrl`); its first message's words; the
     * repository's credential where the machine keeps swaps at its firewall,
     * the one its start minted (`repositoryToken`) or minted afresh; the
     * workspace's variables; and the fingerprint its
     * record keeps. The session it resumes (`from`) is read as the launch
     * decides it, so a resume waits on whether its place was made anew only
     * where that decides the session (`resumedSessionWhen`).
     */
    const prepared = <FE, FR>(
      agent: Agent,
      sessionId: string,
      kind: AgentMachineKind,
      layout: MachineLayout,
      first: RunnerMessage | undefined,
      credential: HarnessLaunch,
      from: Effect.Effect<ResumedSession, FE, FR>,
      /** The first message as the Start composed and queued it before it answered, which the launch takes over rather than composes again, its words marked handed once the runner has it. */
      queuedFirst?: OpenedLine,
      /** The repository's write token as its start minted it, which the launch's firewall write carries rather than minting another. */
      repositoryToken?: Effect.Effect<AgentRepositoryRead | undefined, CheckoutRefused>,
    ) =>
      Effect.gen(function* () {
        const bearer = randomBytes(BEARER_BYTES).toString("base64url");

        const delivered = machine.deliverCredentials(agent, [
          ...(credential.credentials ?? []),
          runnerBearer(bearer, serviceHost),
        ]);

        const target: ConversationTarget = { userId, conversationId: agent.conversationId };

        const made = Effect.gen(function* () {
          // The bearer is recorded first, as a launch numbered past every one before it, so the
          // URLs its runner posts to name that number: a bearer alone does not tell launches apart.
          const [[firstSequence, recordedLaunch], resumed] = yield* Effect.all(
            [
              Effect.all(
                [
                  options.nextSequence(agent.conversationId),
                  recordAgentRunnerLaunch(userId, agent.id, runnerTokenDigest(bearer)),
                ],
                { concurrency: "unbounded" },
              ),
              from,
            ],
            { concurrency: "unbounded" },
          );

          // An agent deleted while its launch prepared, its workspace's delete among them, takes no
          // bearer, and the launch is refused rather than start a runner nothing could reach or retire.
          if (Option.isNone(recordedLaunch))
            return yield* new LaunchRefused({ reason: "no agent" });
          const named = (url: string) => launchUrl(url, recordedLaunch.value);

          // A rewind's cut is handed to the launch that resumes the harness's session, and let go
          // once the runner has it; a fresh session never heard the line it names. A forked session
          // is cut where the Start cut it, through the same cut, since the line it names is the source's.
          const read = Effect.gen(function* () {
            const rewind = Option.getOrUndefined(
              yield* readNativeRewind({ userId, conversationId: agent.conversationId }),
            );

            const rewindBefore = resumed.resume === undefined ? undefined : (resumed.cut ?? rewind);

            const config = yield* harness
              .config(agent, layout, resumed.resume, firstSequence, rewindBefore)
              .pipe(Effect.withSpan("web/runnerConfig"));

            // Note that a runner stays warm past the agent's turn: a Mac's for its window
            // (`CODER.RUNNER_WARM`), ending itself once it passes, and a sandbox's until its sandbox stops.
            const warmForMs =
              kind === AGENT_MACHINE.DEVICE
                ? Duration.toMillis(Duration.sum(CODER.RUNNER_WARM, CODER.RUNNER_WARM_SLACK))
                : undefined;

            return {
              config: {
                ...config,
                eventsUrl: named(config.eventsUrl),
                ...("tokenUrl" in config ? { tokenUrl: named(config.tokenUrl) } : undefined),
                ...(layout.linesRead ? { linesUrl: named(options.linesUrl) } : undefined),
                ...(layout.transcriptsKept && resumed.fromDisk !== true
                  ? { transcriptsUrl: named(options.transcriptsUrl) }
                  : undefined),
                ...(resumed.fork === true ? { fork: true } : undefined),
                warm: true,
                ...(warmForMs === undefined ? undefined : { warmForMs }),
              },
              rewind,
            };
          });

          // The turn's words ahead of the first message, on what the harness's session has handed;
          // a session not resumed is fresh, and its history holds none of it, but for the agent's
          // steps replayed where it lets go of one. A first message the Start or the send already
          // composed and queued is taken over as it stands, its words handed once.
          const opened =
            first === undefined
              ? Effect.succeed(undefined)
              : queuedFirst !== undefined
                ? Effect.succeed(queuedFirst)
                : openedLine(
                    agent,
                    sessionId,
                    first,
                    resumed.resume === undefined,
                    resumed.replay === true,
                  );

          const [config, opening] = yield* Effect.all([read, opened], {
            concurrency: "unbounded",
          });

          return { firstSequence, ...config, opening };
        });

        const [launch, sources, environment, integrations] = yield* Effect.all(
          [
            made,
            // The launch's swaps stand before the runner starts, so its first request carries the
            // real value, the repository's credential beside them: its start's, or minted afresh.
            delivered.swaps.size === 0
              ? Effect.succeed(undefined)
              : repositoryToken === undefined
                ? agentFirewallSources(target, agent)
                : Effect.map(repositoryToken, (read) =>
                    read === undefined ? {} : { github: repositoryCredentialOf(read) },
                  ),
            workspaceEnvironmentOf(agent, kind),
            options.integrations(agent),
          ],
          { concurrency: "unbounded" },
        );

        return {
          ...launch,
          delivered,
          sources,
          // Note that the workspace's variables go first, so ours win a name they share.
          env: { ...environment, ...credential.env, ...delivered.env },
          fingerprint: launchFingerprint(
            credential,
            delivered,
            integrations,
            permissionModeOf(agent),
          ),
        };
      }).pipe(Effect.withSpan("web/runnerLaunchPrepared"));

    /** What a launch prepared with no place (`prepared`), which it takes up once its place runs. */
    type PreparedLaunch = Effect.Success<ReturnType<typeof prepared>>;

    /**
     * One launch of the runner in the running place, on what it prepared
     * beside the place (`prepared`): its swaps kept at the place's firewall
     * where its machine holds them there, ahead of every write that composes
     * the place's policy; then the launch's record written and the caller's
     * own steps (`alongside`) run, which the runner's start waits on
     * (`started`), and beside them and the runner's start the place's whole
     * policy written, the files its lines name, and an earlier launch's
     * lines cleared, which only its config line waits on (`ready`); then
     * the runner, recorded by the machine before it reads anything, handed
     * its config line and first message as its first lines. On a machine whose runner
     * reads its lines (`MachineLayout`'s `linesRead`), the config names the
     * read and is its only line, the first message is queued for the launch,
     * and the launch is handed beside it every message an earlier launch
     * never took; such a launch may have no first message of its own, as one
     * a turn's delivery launches (`deliverTurn`). A runner started but never
     * configured is ended, its record cleared and its first message
     * withdrawn, so the next message relaunches whole rather than writing to
     * a runner that waits for its config.
     */
    const launch = <AE, AR>(
      agent: Agent,
      place: {
        readonly name: MachineName;
        readonly running: MachinePlace;
        readonly session: string;
      },
      layout: MachineLayout,
      first: RunnerMessage | undefined,
      made: PreparedLaunch,
      alongside: Effect.Effect<void, AE, AR>,
      /** How the message reached the place, as the launch's span names it; none where its machine names none. */
      path: LaunchPath | undefined,
    ) =>
      Effect.gen(function* () {
        // The launch's trace, read here on its span, for a runner in the cloud's sandbox to trace
        // its startup in; a device's runner is handed none and sends Sentry nothing.
        const traced =
          place.running.machine === AGENT_MACHINE.VERCEL
            ? yield* Effect.sync(sentryRunnerTrace)
            : undefined;

        const trace: RunnerTrace | undefined =
          traced === undefined
            ? undefined
            : { ...traced, ...(path === undefined ? undefined : { path }) };

        // The swaps its machine keeps for what it delivered; none on a machine with no firewall of ours.
        const { swaps } = made.delivered;

        // Kept before any write of this launch's, so the checkout's finish and the launch's own each send them.
        if (swaps.size > 0) {
          yield* machine.firewall.keepLaunch(place.running, agent.userId, {
            agentId: agent.id,
            swaps,
          });
        }

        const recorded = {
          machine: place.running.machine,
          session: place.running.session,
          name: place.name,
          userId,
          agentId: agent.id,
        };

        const launching = (firstSequence: number) =>
          machine.recordRunner(recorded, {
            kind: RUNNER_RECORD.LAUNCHED,
            mark: { firstSequence },
          });

        const started = Effect.all(
          [
            // The launch's record is written before its command starts, so an END the launch it
            // replaces posts late is told apart from this one's and stops nothing.
            launching(made.firstSequence),
            // The caller's own steps finish the checkout the runner starts in and upload what its
            // machine readies for it.
            alongside,
          ],
          { concurrency: "unbounded", discard: true },
        ).pipe(Effect.withSpan("web/runnerStartReady"));

        // Note that none of these waits on the runner's start, nor it on them, because a runner
        // reads, posts, and asks for nothing before its config line, which waits on them all.
        const ready = Effect.all(
          [
            // The files the lines it is handed name go before its runner reads them: its first
            // message's, and those of the messages waiting for a launch, which their lines carry.
            first === undefined ? Effect.void : filesWritten(place.running, first),
            layout.linesRead ? waitingFilesWritten(agent, place.running) : Effect.void,
            // An earlier launch's lines go but its untaken messages in the window, which this launch is handed.
            layout.linesRead ? clearRunnerLines(userId, agent.id) : Effect.void,
            // Note that a post refused for want of its bearer is refused for good.
            made.sources === undefined
              ? Effect.void
              : machine.firewall.write(place.running, agent.userId, made.sources),
          ],
          { concurrency: "unbounded", discard: true },
        ).pipe(Effect.withSpan("web/runnerLaunchReady"));

        const { handle } = yield* machine.launchRunner(place.running, {
          env: made.env,
          userId,
          agentId: agent.id,
          name: place.name,
          started,
          ready,
          firstLines: () =>
            Effect.gen(function* () {
              const mark: RunnerMark = {
                firstSequence: made.firstSequence,
                fingerprint: made.fingerprint,
                permissionMode: permissionModeOf(agent),
                ...(layout.linesRead ? { linesRead: true } : undefined),
              };

              const config = { ...made.config, ...(trace === undefined ? undefined : { trace }) };
              const opened = made.opening === undefined ? [] : [made.opening.line];

              if (layout.linesRead) {
                yield* queued(agent, made.firstSequence, opened, {
                  files: first?.files ?? [],
                  handed: made.opening?.handed ?? Option.none(),
                });

                return { lines: line(config), mark };
              }

              // Note that a runner fed on its stdin is launched without a message only to boot an agent's first launch,
              // warm from its start, its first message handed it as a later line once the queue lets it go (`boot`).
              return { lines: [config, ...opened].map(line).join(""), mark };
            }),
          // Note that its first message goes with it, since the send that queued it answers failed.
          abandon: () =>
            Effect.andThen(
              layout.linesRead && first !== undefined
                ? withdrawRunnerLine(userId, agent.id, first.line.uuid)
                : Effect.void,
              launching(made.firstSequence),
            ),
        });

        // The runner was handed the first message, so what its words handed is kept for the next.
        // A runner fed on its stdin has its first message as it starts; one that reads its lines hands it on its ACCEPTED.
        if (made.opening !== undefined && !layout.linesRead) yield* made.opening.taken;

        if (made.rewind !== undefined) {
          yield* clearNativeRewindHanded(agent.conversationId, made.rewind).pipe(
            Effect.tapError(() =>
              Effect.ignore(Effect.andThen(machine.kill(handle), launching(made.firstSequence))),
            ),
          );
        }
      }).pipe(
        Effect.withSpan(LAUNCH_SPAN, {
          attributes: {
            ...agentSpanAttributes({
              agentId: agent.id,
              userId: agent.userId,
              workspaceId: agent.organizationId,
              repository: agent.repository,
              harness: harness.runtime,
            }),
            machine: place.running.machine,
            ...(path === undefined ? undefined : { path }),
          },
        }),
      );

    /** Lines queued for the agent's runner to read, written for the launch named (`queuedFor`). */
    const queued = (
      agent: Agent,
      launch: number,
      lines: readonly InputLine[],
      carried?: CarriedLine,
    ) => queuedFor(userId, agent.id, launch, lines, carried);

    /** Lines handed to the runner a place records, as it takes them (`deliveredTo`). */
    const delivered = (agent: Agent, runner: RecordedRunner, lines: readonly InputLine[]) =>
      deliveredTo(machine, userId, agent.id, runner, lines);

    /**
     * How a message reached its runner, counted with where the agent's turns
     * stood: whether one ran, and how long the agent had been idle since its
     * last turn settled, where none did.
     */
    const handoffCounted = (
      agent: Agent,
      path: HandoffPath,
      turnRunning: boolean,
      settledAt: Date | null,
      handedAt: number,
    ) =>
      Effect.andThen(
        Effect.annotateCurrentSpan("path", path),
        recordServerEvent(
          SERVER_EVENT.AGENT_HANDOFF,
          { userId, workspaceId: agent.organizationId },
          {
            harness: harness.runtime,
            path,
            turn_running: turnRunning,
            ...(!turnRunning &&
              settledAt !== null && {
                idle_seconds: Math.max(0, Math.round((handedAt - settledAt.getTime()) / 1_000)),
              }),
          },
        ),
      );

    /** The message as a line, under our id for it where the caller named one, and the files it names, where the machine's layout keeps them. */
    const messageLine = (message: SessionMessage<Turn>, layout: MachineLayout): RunnerMessage => {
      const uuid = message.lineId ?? randomUUID();

      const { content, files } = runnerContent(
        message.message,
        harness.name,
        uuid,
        layout.attachments,
      );

      return {
        line: { type: INPUT_LINE.MESSAGE, uuid, content },
        files,
        turn: message.turn,
        spoken: message.spoken === true,
        timeZone: message.timeZone,
      };
    };

    /** How the line's command, where its words open with one, reaches the harness; as words where a replay rides ahead of it, which must reach the session. */
    const commandRouteOf = (content: readonly ContentBlock[], replaying: boolean): CommandRoute => {
      const first = content.find((block) => block.type === "text");
      const command = first === undefined ? undefined : leadingCommand(first.text);

      if (command === undefined) return COMMAND_ROUTE.WORDS;
      const route = harness.commandRoute(command.name);

      return replaying ? routeBesideReplay(route) : route;
    };

    /**
     * The message line with the turn's own words ahead of the developer's
     * (`turn-message.ts`), composed on what the harness's session has handed
     * (`native_handed`): nothing yet for a fresh session, whose history
     * holds none of it, and what the row keeps otherwise. A fresh session
     * keeps the workspace's experiments it opens on beside what it was
     * handed, and a resumed one the ones it opened on, or, for one opened
     * before they were kept, the ones standing. A session opened afresh on
     * the agent's own conversation (`replayed`) is handed its steps so far
     * ahead of the turn's words, in the one block they ride in
     * (`restartReplayOf`). A read of what a line still waiting for its runner
     * hands that failed fails the message (`readPendingTurnHanded`).
     */
    const openedLine = (
      agent: Agent,
      sessionId: string,
      sent: RunnerMessage,
      fresh: boolean,
      replayed = false,
    ): Effect.Effect<OpenedLine, StoreFailure, DatabaseServices> =>
      Effect.gen(function* () {
        const target: ConversationTarget = { userId, conversationId: agent.conversationId };
        // Note that a line still waiting for its runner hands what it composed once taken, so this one goes behind it.
        const pending = yield* readPendingTurnHanded(target, agent.id);

        const handed = Option.isSome(pending)
          ? pending.value
          : fresh
            ? {}
            : yield* readNativeTurnHanded(target);

        const admitted: AdmittedConversation = {
          caller: userId,
          target,
          runtimeSessionId: sessionId,
          timeZone: sent.timeZone,
        };

        const now = yield* Clock.currentTimeMillis;

        // Note that the turn the line awaits is named, so its own words never read it as the turn before it.
        const awaited = yield* turnAwaitedByLine(agent.conversationId, sent.line.uuid).pipe(
          Effect.tapError(logStoreFailure),
          Effect.orElseSucceed(() => Option.none<string>()),
        );

        const { content } = sent.line;

        const turn = {
          kind: sent.turn,
          turnId: Option.getOrUndefined(awaited),
          spoken: sent.spoken,
          words: textOf(content),
        };

        const [opened, experiments] = yield* Effect.all(
          [coderTurnMessage(admitted, agent, turn, handed, now), experimentsOnIn(agent)],
          { concurrency: "unbounded" },
        );

        // Note that the replay is fitted beside what else the line carries, so the whole line fits the window.
        const replay = replayed
          ? yield* restartReplay(agent, besideBytes(opened.text, content), sent.line.uuid)
          : undefined;

        const words = [replay, opened.text].filter((part) => part !== undefined);

        const ahead: readonly ContentBlock[] =
          words.length === 0 ? [] : [{ type: "text", text: words.join("\n\n") }];

        const route = commandRouteOf(content, replay !== undefined);

        // Note that a line the harness takes as its own command never reads the turn's words, so the session is not told it was handed them.
        const read =
          route !== COMMAND_ROUTE.BARE &&
          route !== COMMAND_ROUTE.COMPACT &&
          route !== COMMAND_ROUTE.GOAL;

        const next: TurnHanded = {
          ...(read ? opened.handed : handed),
          experiments:
            fresh && Option.isNone(pending) ? experiments : (handed.experiments ?? experiments),
        };

        return {
          line: { ...sent.line, ...routedContent(route, ahead, content) },
          handed: handedValue(next),
          taken: recordNativeTurnHanded(target, next),
        };
      });

    /**
     * The agent's own steps so far, as a session opened afresh on its
     * conversation is handed them (`restartReplayOf`), fitted to its model's
     * window less the instructions told where none was measured and the
     * bytes the rest of its line comes to, and without the line being sent
     * (`sending`); nothing where its rows cannot be read, logged, so the
     * session still opens on the turn's words.
     */
    const restartReplay = (agent: Agent, beside: number, sending: string) =>
      restartReplayOf(
        agent,
        {
          windowTokens: contextWindowOf([], agent.model, agent.contextWindow),
          instructionsTokens: REPLAY_FIT.INSTRUCTIONS_FALLBACK_TOKENS,
          besideBytes: beside,
        },
        sending,
      ).pipe(
        Effect.tapError(logStoreFailure),
        Effect.orElseSucceed(() => undefined),
      );

    /**
     * Whether the message must open the harness's session afresh, its
     * conversation replayed into it: the workspace's experiments its session
     * opened on (`native_handed`) are no longer the ones standing, since a
     * resumed Claude Code or Codex session keeps the instructions it opened
     * with until it compacts. Never while a turn runs, which goes on with what
     * it has, the change caught by the next message after it; never for a
     * session opened before its experiments were kept; and never on a read of
     * them that failed, which says nothing of whether they changed, while a
     * read of a waiting line's that failed fails the message as `openedLine`'s
     * does. Note that the experiments
     * are kept only once a runner took the line that opened the fresh session
     * (`openedLine`'s `taken`), so a restart whose launch failed stays pending,
     * its harness's session already let go, and the next message opens it
     * afresh with its replay again rather than with the turn's words alone.
     */
    const experimentsChanged = (agent: Agent, turnRunning: boolean) =>
      Effect.gen(function* () {
        if (turnRunning) return false;
        // Note that a line still waiting for its runner opens on what it composed, as `openedLine` reads it.
        const target = { userId, conversationId: agent.conversationId };
        const pending = yield* readPendingTurnHanded(target, agent.id);

        const opened = (
          Option.isSome(pending) ? pending.value : yield* readNativeTurnHanded(target)
        ).experiments;

        if (opened === undefined) return false;
        // Note that a read that failed is no change, since restarting on it would open a session with every experiment off.
        const read = yield* experimentsReadIn(agent);

        if (Option.isNone(read)) return false;
        const standing = read.value;

        return (
          opened.descriptionsOn !== standing.descriptionsOn ||
          opened.memoryOn !== standing.memoryOn ||
          (opened.turnEndOn ?? false) !== standing.turnEndOn ||
          (opened.replyButtonsOn ?? false) !== standing.replyButtonsOn ||
          (opened.computerUseOn ?? false) !== standing.computerUseOn
        );
      });

    /** The agent's native session marked broken (`markSessionBroken`), so no launch resumes it from the store again (`holdsSession`). */
    const lostSessionMarked = (agent: Agent) =>
      Effect.gen(function* () {
        const routing = yield* readAgentRouting(userId, agent.id);

        const own = Option.getOrUndefined(
          Option.flatMapNullishOr(routing, (read) => read.nativeSession),
        );

        if (own !== undefined) yield* markSessionBroken(userId, agent.conversationId, own);
      });

    /** The files a message names written into the running place, before its line names them. */
    const filesWritten = (place: MachinePlace, message: RunnerMessage) =>
      message.files.length === 0 ? Effect.void : machine.writeFiles(place, message.files);

    /** The files the agent's messages waiting for a launch name, which their lines carry, written into the place a launch reads them in. */
    const waitingFilesWritten = (agent: Agent, place: MachinePlace) =>
      Effect.flatMap(waitingRunnerFiles(userId, agent.id), (files) =>
        files.length === 0 ? Effect.void : machine.writeFiles(place, files.map(writtenFile)),
      );

    /**
     * A failure as the log says it and the caller reads it, in its own words
     * (`failureWords`): said once as an error, since the caller refuses what
     * was asked, and reported where no named refusal explains it
     * (`agentFailureSaid`).
     */
    const failed = (call: string) => (failure: { readonly _tag: string }) =>
      Effect.as(
        agentFailureSaid(
          `A ${harness.name} ${call} failed: ${keptFailureWords(failureWords(failure))}`,
          failureKind(failure),
          !namedOutcome(failure),
        ),
        {
          outcome: SESSION_SEND_OUTCOME.FAILED,
          status: failedStatus(failure),
          ...(failure instanceof LaunchRefused && failure.planRefusal !== undefined
            ? { planRefusal: failure.planRefusal }
            : undefined),
          ...(failure instanceof LaunchRefused && failure.planResetsAt !== undefined
            ? { planResetsAt: failure.planResetsAt }
            : undefined),
          ...(failure instanceof LaunchRefused && failure.keyRefusal !== undefined
            ? { keyRefusal: failure.keyRefusal }
            : undefined),
          ...(failure instanceof LaunchRefused && failure.deviceRemoved === true
            ? { runtimeRefusal: RUNTIME_REFUSAL.DEVICE_REMOVED }
            : undefined),
          ...(failure instanceof LaunchRefused && failure.deviceAway === true
            ? { runtimeRefusal: RUNTIME_REFUSAL.DEVICE_AWAY }
            : undefined),
          ...(failure instanceof LaunchRefused && failure.modesUnsupported === true
            ? { runtimeRefusal: RUNTIME_REFUSAL.MODES_UNSUPPORTED }
            : undefined),
        } as const,
      );

    /** A cancel's or a reset's failure, as the log says it: a sandbox's own words, the kind alone for any other. */
    const unavailable = (call: string) => (failure: { readonly _tag: string }) =>
      Effect.as(
        Effect.logWarning(
          `A ${harness.name} ${call} failed: ${keptFailureWords(failureWords(failure))}`,
        ),
        {
          outcome: "failed" as const,
          status: failedStatus(failure),
        },
      );

    /**
     * The session a launch resumes, the one decision every launch, the line
     * a send queues for one, and a warm call ask. On a machine that keeps the
     * CLI's transcript (`MachineLayout`'s `transcriptsKept`), the harness
     * resumes from the store whenever it holds any entry of the session, and
     * from those alone, whatever the disk holds, so a session resumes from
     * the store only where it holds it from its first entry
     * (`holdsSession`). One it holds a tail of, or none of, as a session
     * begun before it kept transcripts, is let go in a sandbox, and the fresh
     * session that opens in its place is handed the agent's steps so far
     * (`replay`); on a Mac, whose disk keeps it (`diskSessions`), it resumes
     * from the disk with the store left out of the launch (`fromDisk`), so
     * the store never comes to hold a tail it would load alone. On a machine
     * that keeps none, the session resumes from the disk alone, so not in a
     * place made anew (`created`), whose disk is gone. A continued or forked agent with
     * no session of its own yet forks its source's in a new place, where the
     * Start copied a transcript the store holds from its first entry, cut
     * where the Start cut it.
     * Whether the place was made anew is read only where it decides the
     * session, so a launch prepared beside its place's resume waits on that
     * resume only there.
     */
    const resumedSessionWhen = <CE, CR>(
      agent: Agent,
      layout: MachineLayout,
      created: Effect.Effect<boolean, CE, CR>,
    ) =>
      Effect.gen(function* () {
        const routing = yield* readAgentRouting(userId, agent.id);

        const own = Option.getOrUndefined(
          Option.flatMapNullishOr(routing, (read) => read.nativeSession),
        );

        const { conversationId } = agent;

        if (own !== undefined) {
          if (layout.transcriptsKept && (yield* holdsSession(userId, conversationId, own))) {
            return { resume: own } satisfies ResumedSession;
          }

          const fromDisk = (!layout.transcriptsKept || layout.diskSessions) && !(yield* created);

          return (fromDisk ? { resume: own, fromDisk } : { replay: true }) satisfies ResumedSession;
        }

        const source = agent.startedFrom?.session;

        if (!layout.transcriptsKept || source === undefined || !(yield* created)) return {};

        // A session let go (`/clear`) leaves the agent a fresh one of its own, never its source's again.
        if (yield* holdsSessionClearedMark({ userId, conversationId })) return {};
        const held = yield* holdsSession(userId, conversationId, source);

        if (!held) return {} satisfies ResumedSession;
        const cut = agent.startedFrom?.cutBefore;

        return (
          cut === undefined ? { resume: source, fork: true } : { resume: source, fork: true, cut }
        ) satisfies ResumedSession;
      });

    /** The session a launch resumes in a place known made anew or not (`resumedSessionWhen`). */
    const resumedSessionOf = (agent: Agent, layout: MachineLayout, created: boolean) =>
      resumedSessionWhen(agent, layout, Effect.succeed(created));

    /**
     * A new place opened under the session given on the agent's machine, the
     * agent's repository checked out in it, then at once its finish
     * (`finishCheckoutWith`, the machine's `finishCheckout`): the
     * write token at the firewall and the commit identity, since the
     * harness's own shell has no hook for a first write; and the runner
     * launched on the first line. The member's installed skills are read,
     * and the launch prepared (`prepared`), beside the opening, and the
     * finish and the skills' upload run beside the launch's own uploads. A
     * preparation that failed is kept as it ended and fails the launch only
     * once the place stands, so it never cuts the opening short. A place
     * whose launch failed is left standing for the session's next message.
     * `sandboxOpened` runs once the place stands, before the launch.
     */
    const openedPlace = (
      agent: Agent,
      sessionId: string,
      layout: MachineLayout,
      first: RunnerMessage | undefined,
      credential: HarnessLaunch,
      queuedFirst?: OpenedLine,
      sandboxOpened: Effect.Effect<void> = Effect.void,
      /** How the message reached the place where the caller knows better than the machine, as a place made anew where the one found was gone. */
      path?: LaunchPath,
    ) =>
      Effect.gen(function* () {
        const target: ConversationTarget = { userId, conversationId: agent.conversationId };
        // Note that the place opens on the machine the agent's row names, as `open` is routed.
        const kind = agent.machine ?? AGENT_MACHINE.VERCEL;

        const services = yield* Effect.context<
          DatabaseServices | HostedEnvironment | CheckoutServices
        >();

        // The repository's write token is minted once, as the machine first asks for it, and shared.
        const repositoryToken = yield* Effect.cached(
          Effect.provideContext(
            hasRepository(agent) ? agentRepositoryRead(target, agent) : Effect.succeed(undefined),
            services,
          ),
        );

        yield* machine.open(
          {
            session: sessionId,
            target,
            agent,
            harness: harness.name,
            repositoryToken,
            setup: Effect.provideContext(sandboxSetupOf(agent, kind), services),
            beside: Effect.all(
              [
                installedSkillFiles(target, agent, layout),
                Effect.exit(
                  prepared(
                    agent,
                    sessionId,
                    kind,
                    layout,
                    first,
                    credential,
                    resumedSessionOf(agent, layout, true),
                    queuedFirst,
                    repositoryToken,
                  ),
                ),
              ],
              { concurrency: "unbounded" },
            ),
          },
          (opened, [skills, made]) =>
            Effect.andThen(
              Effect.andThen(
                Effect.logInfo(`A ${harness.name} launch opened its sandbox`),
                sandboxOpened,
              ),
              Effect.flatMap(made, (ready) =>
                launch(
                  agent,
                  { name: opened.name, running: opened.place, session: sessionId },
                  layout,
                  first,
                  ready,
                  Effect.all([opened.finishCheckout, writeInstalledSkills(opened.place, skills)], {
                    concurrency: "unbounded",
                    discard: true,
                  }),
                  path ?? opened.path,
                ),
              ).pipe(
                // Note that a launch failing for its agent's delete, prepared or launched, leaves no place behind.
                Effect.tapError(() => discardedWhereAgentGone(agent, sessionId)),
              ),
            ).pipe(Effect.annotateLogs(runningLogId(opened.place.running))),
        );
      });

    /**
     * The runner launched again in the place the caller's step runs
     * (`placed`): a running one as it stands, or one resumed, on the machine
     * named; its credential set afresh by the launch and the harness's
     * session resumed where it may be (`resumedSessionWhen`); with no message
     * of its own where it only hands on the lines an earlier launch never
     * took. The launch is prepared (`prepared`) beside that step, and a
     * preparation that failed fails the launch once the place runs, as an
     * open's does. In a place made anew in place of one whose disk was lost
     * (`created`), the member's installed skills went with that disk, so
     * they are uploaded again, as a new place's are. A launch whose
     * harness's session was lost (`replayed`) resumes it by no path, the disk's
     * included, and opens a fresh one handed the agent's steps. Answers the place.
     */
    const relaunched = <PE, PR>(
      agent: Agent,
      sessionId: string,
      placed: Effect.Effect<{ readonly place: MachinePlace; readonly created: boolean }, PE, PR>,
      kind: AgentMachineKind,
      wasUp: boolean,
      layout: MachineLayout,
      sent: RunnerMessage | undefined,
      queuedFirst?: OpenedLine,
      replayed = false,
    ) =>
      Effect.gen(function* () {
        const target = { userId, conversationId: agent.conversationId };
        const created = yield* Deferred.make<boolean>();

        const [place, made] = yield* Effect.all(
          [
            placed.pipe(
              Effect.tap((place) => Deferred.succeed(created, place.created)),
              // Note that the agent's own checkout is cloned here where the place holds none, as a launch whose checkout failed leaves it.
              Effect.tap((place) =>
                Effect.flatMap(cloudSetupOf(agent, kind), (setup) =>
                  machine.checkOutMissing(place.place, target, agent, setup),
                ),
              ),
            ),
            Effect.exit(
              Effect.flatMap(harness.launch(agent, layout), (credential) =>
                prepared(
                  agent,
                  sessionId,
                  kind,
                  layout,
                  sent,
                  credential,
                  replayed
                    ? Effect.succeed({ replay: true } satisfies ResumedSession)
                    : resumedSessionWhen(agent, layout, Deferred.await(created)),
                  queuedFirst,
                ),
              ),
            ),
          ],
          { concurrency: "unbounded" },
        );

        const running = place.place;
        yield* Effect.flatMap(made, (ready) =>
          launch(
            agent,
            { name: running.name, running, session: sessionId },
            layout,
            sent,
            ready,
            place.created
              ? Effect.flatMap(installedSkillFiles(target, agent, layout), (files) =>
                  writeInstalledSkills(running, files),
                )
              : Effect.void,
            resumedPath(place.created, wasUp),
          ),
        ).pipe(
          // Note that a launch failing for its agent's delete, prepared or launched, leaves no place behind.
          Effect.tapError(() => discardedWhereAgentGone(agent, sessionId)),
        );

        return place;
      });

    /**
     * Whether the runner is warm, no turn of the agent's under way, and was
     * launched with a credential, integrations, or a permission mode that have changed since,
     * which it cannot take up while it runs. A runner at work keeps going on
     * what it has, and one from before fingerprints were tagged is never
     * read as stale.
     */
    const staleWarm = (
      agent: Agent,
      layout: MachineLayout,
      runner: RunnerMark,
      turnRunning: boolean,
    ) =>
      Effect.gen(function* () {
        if (runner.fingerprint === undefined || turnRunning) return false;
        const credential = yield* harness.launch(agent, layout);
        const delivered = machine.deliverCredentials(agent, credential.credentials ?? []);

        const now = launchFingerprint(
          credential,
          delivered,
          yield* options.integrations(agent),
          permissionModeOf(agent),
        );

        return now !== runner.fingerprint;
      });

    /**
     * The runner the found place records let go, its caller holding the
     * agent's runner lease: its command ended, one already gone counting as
     * ended, its bearer dropped, so nothing it posts on its way down is
     * taken, and the place's record cleared of it, so the next launch reads
     * no runner up rather than one on its way down.
     */
    const letGo = (found: FoundPlace, agentId: string, handle: RunnerHandle) =>
      Effect.gen(function* () {
        yield* machine.kill(handle);
        yield* recordAgentRunnerToken(userId, agentId, null);
        yield* machine.recordRunner(recordOf(found, userId, agentId), {
          kind: RUNNER_RECORD.NONE,
        });
      });

    /**
     * A message to the session, under the agent's runner lease: the place and
     * the agent read afresh, since a call the lease waited behind may have
     * relaunched. `handsOn` says whether a runner that must be resumed or
     * launched again is left to the delivery of the turn the message awaits
     * (`deliverTurn`), the message queued for whichever launch runs next, and
     * a runner that must not take it ended here, as for every runner that
     * reads its lines; otherwise, for a runner fed on its stdin, it is
     * launched here.
     */
    const sendHolding = (
      sessionId: string,
      message: SessionMessage<Turn>,
      layout: MachineLayout,
      sent: RunnerMessage,
      handsOn: boolean,
      /** Whether a runner up is ended and launched again whatever it holds, as a retry on the next payer asks (`retry`). */
      relaunch = false,
      /** Whether the harness's session is let go and the conversation replayed, as a retry of a turn whose launch could not resume it asks (`retry`). */
      replayed = false,
    ) =>
      Effect.gen(function* () {
        // The agent is read beside the place, and its read answers only for a place found or opening.
        const [found, agentRead] = yield* Effect.all(
          [machine.findPlace(userId, sessionId), Effect.exit(agentOf(message.conversationId))],
          { concurrency: "unbounded" },
        );

        const standing = Option.getOrUndefined(found);

        // Note that a session whose first place its turn's delivery has yet to open, as a Start's has
        // until then, is no session ended, because a line of its agent waits on that delivery, which
        // opens the place (`deliveredHolding`): the message is queued beside it, as one to a place with
        // no runner up is.
        const opening =
          standing === undefined &&
          handsOn &&
          Exit.isSuccess(agentRead) &&
          Option.isSome(yield* runnerLineWaitingSince(userId, agentRead.value.id));

        if (standing === undefined && !opening) {
          return { outcome: SESSION_SEND_OUTCOME.RETIRED } as const;
        }

        const agent = yield* agentRead;

        // The session must be the conversation's own agent's, which the account reaches.
        if (standing !== undefined && standing.agentId !== agent.id) {
          return { outcome: SESSION_SEND_OUTCOME.RETIRED } as const;
        }

        const target = { userId, conversationId: agent.conversationId };

        const accepted = {
          outcome: SESSION_SEND_OUTCOME.ACCEPTED,
          sessionId,
          deliveryId: sent.line.uuid,
        } as const;

        // Where the agent's turns stand as the message arrives, counted with how it reached the runner.
        // Note that a turn queued for a runner, as the one this message's own send may have queued, runs nothing yet.
        const { conversationId } = agent;
        const turn = (yield* latestTurnsOfReached([conversationId])).get(conversationId);
        const turnRunning = turn?.status === TURN_STATUS.RUNNING;
        // A session the harness could not resume, or opened on experiments since changed, is opened
        // afresh, on the same place, its conversation replayed into it: its harness's session is let
        // go before anything is handed, so every launch past here, the turn's delivery's among them,
        // resumes none, and the first line, its replay ahead of it, is composed once.
        const restart = replayed || (yield* experimentsChanged(agent, turnRunning));

        // Note that a session the harness could not resume is marked broken rather than forgotten,
        // so the store never resumes it again, the launch below resumes it by no path
        // (`relaunched`), and a Mac whose disk a later launch resumes it from again loses it once
        // more and replays then.
        if (replayed) yield* lostSessionMarked(agent);
        else if (restart) yield* recordAgentNativeSession(userId, agent.id, null);

        const restartLine = restart
          ? yield* openedLine(agent, sessionId, sent, true, true)
          : undefined;

        const handedAt = yield* Clock.currentTimeMillis;

        const handed = (path: HandoffPath) =>
          handoffCounted(agent, path, turnRunning, turn?.settledAt ?? null, handedAt);

        // The message queued for whichever launch runs next, its words composed on whether the
        // harness's session resumes, which the turn's delivery launches (`deliverTurn`), its files
        // and what its words hand carried on its line for that launch to write and its runner's
        // ACCEPTED to keep. Note that the request answers once it is queued, so a resume that waits
        // out a stop's snapshot never holds the send past the store's dispatch deadline.
        const queuedForDelivery = Effect.gen(function* () {
          // Note that a machine whose runner reads its lines keeps the CLI's transcript, so whether
          // the session resumes does not turn on whether the delivery's place is made anew.
          const from = yield* resumedSessionOf(agent, layout, false);

          const opened =
            restartLine ??
            (yield* openedLine(
              agent,
              sessionId,
              sent,
              from.resume === undefined,
              from.replay === true,
            ));

          yield* queued(agent, ANY_LAUNCH, [opened.line], {
            files: sent.files,
            handed: opened.handed,
          });

          return accepted;
        });

        const running = standing?.runner;

        if (standing !== undefined && running !== undefined) {
          const runnerPlace = placeOfHandle(running.handle);

          // A runner that would not take the message as it should is ended, and the message
          // relaunches it: a Mac's warm past its window, which may end itself at its idle cap
          // as the line lands; one a Stop was written to since its launch, which ends on it; and a
          // warm one launched with what has changed since. Note that the first two hold whether
          // or not the sweep or the IDLE's retire ran, since a Mac drops a line once its runner
          // has gone, so a line written to a runner on its way down is lost.
          if (
            restart ||
            relaunch ||
            (standing.machine === AGENT_MACHINE.DEVICE &&
              pastWarmWindow(
                turnRunning,
                (yield* lastSettledTurnsOfReached([conversationId])).get(conversationId),
                handedAt,
              )) ||
            (yield* stopWritten(machine, running)) ||
            (yield* staleWarm(agent, layout, running.mark, turnRunning))
          ) {
            if (handsOn) {
              yield* letGo(standing, agent.id, running.handle);

              return yield* queuedForDelivery;
            }

            yield* machine.kill(running.handle);
            yield* relaunched(
              agent,
              sessionId,
              Effect.succeed({ place: runnerPlace, created: false }),
              runnerPlace.machine,
              true,
              layout,
              sent,
              restartLine,
              replayed,
            );
            yield* handed(SERVER_HANDOFF_PATH.RELAUNCHED);

            return accepted;
          }

          // The harness's lines (the agent's model and effort as they stand) go ahead of the message,
          // which a change since the launch takes effect from. The choice read here stands until
          // the write: a change of it is handed to the runner by `retune`, which holds the same
          // lease, so it is written after this line, never undone by it. A sandbox stopping under
          // the files' upload is read as the runner gone, and relaunches below, which uploads the
          // files again.
          const reads = running.mark.linesRead === true;

          const [ahead, opened, uploaded] = yield* Effect.all(
            [
              harness.ahead(agent),
              openedLine(agent, sessionId, sent, false),
              filesWritten(runnerPlace, sent).pipe(
                Effect.as(true),
                Effect.catchIf(sandboxEnding, () => Effect.succeed(false)),
              ),
            ],
            { concurrency: "unbounded" },
          );

          const lines = [...ahead.lines, opened.line];

          // Note that a runner that reads its lines, as a sandbox's does, is queued them with no
          // read of its own liveness, since its place was found running in the runner's session:
          // one that ends before it takes them leaves them to the launch the turn's delivery starts
          // once its END republishes the turn (`deliverTurn`), and one lost with no END leaves its
          // turn to the reap past its pickup deadline (`reconcile.ts`). A write to a Mac's runner
          // is its own liveness check: one whose launch line its Mac settled answers
          // as gone (`SandboxGone`), which relaunches below.
          const wrote =
            uploaded &&
            (reads
              ? yield* Effect.as(
                  queued(agent, running.mark.firstSequence, lines, {
                    files: sent.files,
                    handed: opened.handed,
                  }),
                  true,
                )
              : yield* machine.writeLine(running.handle, lines.map(line).join("")).pipe(
                  Effect.as(true),
                  Effect.catchIf(
                    (failure) => sandboxGone(failure) || sandboxEnding(failure),
                    () => Effect.succeed(false),
                  ),
                ));

          if (wrote) {
            // A runner fed on its stdin has the line as it is written; one that reads its lines hands it on its ACCEPTED.
            if (!reads) yield* opened.taken;
            // The installation token lives an hour, so each message sets a fresh one, past the
            // answer (`after-response.ts`): the runner already holds a token that stands, so the
            // message never waits on a GitHub mint and a policy write. Note that a renewal that
            // fails is logged and the message stands, since the runner already took it; the next
            // message renews it.
            yield* afterResponse(
              `A ${harness.name} runner's credential renewal`,
              renewCredential(target, agent, runnerPlace).pipe(
                Effect.catch((failure) =>
                  Effect.logWarning(
                    `A ${harness.name} runner's credential was not renewed: ${keptFailureWords(failureWords(failure))}`,
                  ),
                ),
                Effect.annotateLogs(runningLogId(runnerPlace.running)),
              ),
            );
            yield* handed(SERVER_HANDOFF_PATH.WARM);

            return accepted;
          }
        }

        // The place stopped or the runner ended: resumed, its credential set again, and the runner relaunched on the harness's session.
        if (handsOn || standing === undefined) return yield* queuedForDelivery;
        // A runner fed on its stdin, as a Mac's is, is launched again here, its launch a line its
        // machine takes up (`device-machine.ts`), whose place is never lost the way a sandbox's is.
        const wasUp = standing.running !== undefined;
        yield* relaunched(
          agent,
          sessionId,
          machine.resume(standing, agent, yield* cloudSetupOf(agent, standing.machine)),
          standing.machine,
          wasUp,
          layout,
          sent,
          restartLine,
          replayed,
        );
        yield* handed(wasUp ? SERVER_HANDOFF_PATH.RELAUNCHED : SERVER_HANDOFF_PATH.RESUMED);

        return accepted;
      }).pipe(Effect.withSpan("web/runnerSend", { attributes: { harness: harness.runtime } }));

    /**
     * A Stop of the turn named, under the agent's runner lease, to the runner
     * as it stands once the lease is held; answers the launch the stop line
     * was written to, which its force ends (`forcedStop`). A turn still
     * running whose runner is no longer up, or one that
     * exited before the line reached it (`SandboxGone`), is a Stop taken all
     * the same, with no line to write, which the force settles.
     */
    const cancelHolding = (sessionId: string, turnId: string, agent: Agent) =>
      Effect.gen(function* () {
        const found = yield* machine.findPlace(userId, sessionId);

        if (Option.isNone(found) || found.value.agentId !== agent.id) {
          return { outcome: SESSION_CANCEL_OUTCOME.NO_ACTIVE_TURN } as const;
        }

        const { conversationId } = agent;
        const turn = (yield* latestTurnsOfReached([conversationId])).get(conversationId);

        if (turn?.id !== turnId || !RUNNING_TURN_STATUSES.has(turn.status)) {
          return { outcome: SESSION_CANCEL_OUTCOME.NO_ACTIVE_TURN } as const;
        }

        // Note that its exit is read at most `CODER.RUNNER_EXIT_READ`, so a Stop never waits out a live runner's exit.
        const live = found.value.runner;

        if (live === undefined) return { outcome: SESSION_CANCEL_OUTCOME.ACCEPTED } as const;
        yield* delivered(agent, live, [stopLine(live.mark.firstSequence)]).pipe(
          Effect.catchIf(sandboxGone, () => Effect.void),
        );

        return {
          outcome: SESSION_CANCEL_OUTCOME.ACCEPTED,
          launch: live.mark.firstSequence,
        } as const;
      });

    /**
     * A Stop's force, `CODER.STOP_CONFIRM` after its line was written: the
     * turn the Stop named, where it still runs with its Stop stamped, has the
     * launch the line went to ended, and is settled canceled as a turn whose
     * runner was lost is (`settleRunnerLostTurns`), which drops the turn the
     * native projection holds too, so nothing the runner posted late lands
     * on it. Note that a newer launch, which a message after the Stop
     * started, runs on. The ended runner's bearer is let go and the place's
     * record cleared, as `haltHolding` leaves them, so nothing it posts on its
     * way down is taken and the next message relaunches; its sandbox stops
     * at its timeout, since a killed runner posts
     * no END. A turn ended meanwhile, as a runner that heard the Stop ends
     * it within seconds, is left as it ended.
     */
    const forcedStop = (
      sessionId: string,
      turnId: string,
      agent: Agent,
      launch: number | undefined,
    ) =>
      Effect.andThen(
        Effect.sleep(CODER.STOP_CONFIRM),
        holdingRunner(
          agent.id,
          Effect.gen(function* () {
            const { conversationId } = agent;
            const turn = (yield* latestTurnsOfReached([conversationId])).get(conversationId);

            if (turn?.id !== turnId || !RUNNING_TURN_STATUSES.has(turn.status)) return;

            if (turn.cancelRequestedAt === null) return;
            const found = yield* machine.findPlace(userId, sessionId);

            const live =
              Option.isSome(found) && found.value.agentId === agent.id
                ? found.value.runner
                : undefined;

            if (Option.isSome(found) && live !== undefined && live.mark.firstSequence === launch) {
              yield* Effect.logWarning(
                `A ${harness.name} runner did not end its turn on a Stop, and was ended`,
              );
              yield* letGo(found.value, agent.id, live.handle);
            }

            const writer = yield* storeWriter({ tools: CODER_TOOL_SET });
            const now = yield* Clock.currentTimeMillis;
            yield* settleRunnerLostTurns(writer, conversationId, now, undefined, new Set([turnId]));
          }),
        ),
      );

    /**
     * The session's runner ended, under the agent's runner lease, so the
     * next message relaunches it: a Stop written to it, its exit waited for
     * at most `CODER.RUNNER_HALT`, its command ended where it still runs and
     * waited for again, its bearer let go, so nothing it posts on the way
     * down is taken, and the place's record cleared of it. Note that the
     * record is what says a runner runs, so a message sent next would
     * otherwise be written to a runner on its way down and lost. A session
     * no runner runs in has nothing to end.
     */
    const haltHolding = (sessionId: string, conversationId: string) =>
      Effect.gen(function* () {
        const found = yield* machine.findPlace(userId, sessionId);

        if (Option.isNone(found)) return;
        const agent = yield* agentOf(conversationId);

        if (found.value.agentId !== agent.id) return;
        const live = found.value.runner;

        if (live === undefined) return;
        const { handle } = live;
        yield* delivered(agent, live, [stopLine(live.mark.firstSequence)]);
        // Note that the read is handed the bound, because it answers null for a command still running once its own wait is up.
        const exited = machine.runnerExit(handle, CODER.RUNNER_HALT);
        const stopped = yield* exited;

        if (stopped === null) {
          yield* machine.kill(handle);
          yield* exited;
        }

        yield* recordAgentRunnerToken(userId, agent.id, null);
        yield* machine.recordRunner(recordOf(found.value, userId, agent.id), {
          kind: RUNNER_RECORD.NONE,
        });
      });

    /** A change of model or effort, under the agent's runner lease. */
    const retuneHolding = (sessionId: string, conversationId: string) =>
      Effect.gen(function* () {
        const found = yield* machine.findPlace(userId, sessionId);

        if (Option.isNone(found)) return RUNNER_CHOICE.NOT_LIVE;
        const agent = yield* agentOf(conversationId);

        if (found.value.agentId !== agent.id) return RUNNER_CHOICE.NOT_LIVE;
        const live = found.value.runner;

        if (live === undefined) return RUNNER_CHOICE.NOT_LIVE;
        const ahead = yield* harness.ahead(agent);
        const model = ahead.lines.filter((each) => each.type === INPUT_LINE.MODEL);

        if (model.length === 0) return RUNNER_CHOICE.NOT_LIVE;
        // Note that it goes the way the runner's messages go, so it never overtakes, nor is overtaken by, a message's own model line.
        yield* delivered(agent, live, model);

        return RUNNER_CHOICE.WRITTEN;
      });

    /**
     * A member's answer to an ask, under the agent's runner lease, written to
     * the runner that runs the way its messages go. Nothing where no runner
     * runs, or one whose command is gone, since none holds the ask then.
     */
    const answerHolding = (sessionId: string, conversationId: string, line: ApprovalLine) =>
      Effect.gen(function* () {
        const found = yield* machine.findPlace(userId, sessionId);

        if (Option.isNone(found)) return RUNNER_ANSWER.NOT_LIVE;
        const agent = yield* agentOf(conversationId);
        const live = found.value.runner;

        if (found.value.agentId !== agent.id || live === undefined) return RUNNER_ANSWER.NOT_LIVE;

        return yield* delivered(agent, live, [line]).pipe(
          Effect.as(RUNNER_ANSWER.WRITTEN),
          Effect.catchIf(sandboxGone, () => Effect.succeed(RUNNER_ANSWER.NOT_LIVE)),
        );
      });

    /**
     * The runner launched with no message of its own where none runs, its
     * caller holding the agent's runner lease: the place resumed, made anew
     * where its disk is gone, and the runner launched on the
     * harness's session, reading whatever lines wait for it. A resume that
     * meets the sandbox still stopping or being snapshotted waits it out
     * (`RESUME_WHILE_ENDING`), since no request waits on it. Nothing where
     * the session's place is none or another agent's, where a runner runs,
     * or on a machine whose runner takes its lines on stdin, which is never
     * launched without a message. Answers how the launch reached its runner,
     * or none where no runner was launched.
     */
    const launchedWithoutMessage = (sessionId: string, agent: Agent) =>
      Effect.gen(function* () {
        const found = yield* machine.findPlace(userId, sessionId);

        if (Option.isNone(found) || found.value.agentId !== agent.id) return undefined;

        if (found.value.runner !== undefined) return undefined;
        const layout = yield* machine.layout(agent);

        if (!layout.linesRead) return undefined;
        const wasUp = found.value.running !== undefined;

        const resumed = yield* relaunched(
          agent,
          sessionId,
          machine.resume(found.value, agent, yield* cloudSetupOf(agent, found.value.machine)),
          found.value.machine,
          wasUp,
          layout,
          undefined,
        ).pipe(Effect.retry(RESUME_WHILE_ENDING));

        if (resumed.created) return SERVER_HANDOFF_PATH.FRESH;

        return wasUp ? SERVER_HANDOFF_PATH.RELAUNCHED : SERVER_HANDOFF_PATH.RESUMED;
      });

    /**
     * The place a session that has none yet opens, as a Start's first turn
     * finds it, and the runner launched there on the lines waiting for it:
     * nothing on a machine whose runner takes its lines on stdin, whose open
     * launched it already.
     */
    const openedForWaiting = (sessionId: string, agent: Agent) =>
      Effect.gen(function* () {
        const layout = yield* machine.layout(agent);

        if (!layout.linesRead) return;
        yield* openedPlace(
          agent,
          sessionId,
          layout,
          undefined,
          yield* harness.launch(agent, layout),
        );
      });

    /**
     * The lines a queued turn awaits handed on, under the agent's runner
     * lease: where a message line no launch took still has its turn waiting
     * on it (`runnerLineWaitingSince`), the place its session opens, a
     * Start's first among them, is opened (`openedForWaiting`), or the runner
     * is launched again in the place it has where none is up
     * (`launchedWithoutMessage`), and how a message reached it counted, as a
     * Start's first message is not. Nothing where none waits, as a Mac's
     * lines, which its own runner's launch line carries.
     *
     * A runner the place's record names up reads its lines itself, and takes
     * a message the moment it reads it, its turn running or not, so its turn
     * is awaited (`TURN_HANDOVER.AWAITED`), and its delivery comes once more
     * after `TURN_DELIVERY.TAKE_GRACE`. A line still untaken past that grace
     * is one the runner is not reading, whatever its command's exit says, so
     * the runner is let go and launched again, once: the delivery is then
     * acknowledged, and a relaunch that takes nothing either is the pickup
     * deadline's to fail.
     */
    const deliveredHolding = (sessionId: string, agent: Agent) =>
      Effect.gen(function* () {
        const waiting = yield* runnerLineWaitingSince(userId, agent.id);

        if (Option.isNone(waiting)) return TURN_HANDOVER.HANDED;
        const found = yield* machine.findPlace(userId, sessionId);

        if (Option.isNone(found)) {
          yield* openedForWaiting(sessionId, agent);

          return TURN_HANDOVER.HANDED;
        }

        const runner = found.value.agentId === agent.id ? found.value.runner : undefined;

        if (runner !== undefined) {
          const waited = (yield* Clock.currentTimeMillis) - waiting.value.getTime();

          if (waited < Duration.toMillis(TURN_DELIVERY.TAKE_GRACE)) return TURN_HANDOVER.AWAITED;
          yield* Effect.logWarning(
            `A ${harness.name} runner left its line untaken past its grace, and was launched again`,
          );
          yield* letGo(found.value, agent.id, runner.handle);
        }

        const path = yield* launchedWithoutMessage(sessionId, agent);

        if (path !== undefined) {
          yield* handoffCounted(agent, path, false, null, yield* Clock.currentTimeMillis);
        }

        return TURN_HANDOVER.HANDED;
      });

    /**
     * An agent on screen kept warm, under its runner lease, where none of its
     * turns runs: its running sandbox touched (`@repo/sandbox`'s `touch`),
     * since nothing else keeps it up between turns, a runner that runs is
     * written a `warm` line, which runs its
     * warm window again from now, and where none runs, the runner is launched
     * with no message (`launchedWithoutMessage`), warm from its start, for the
     * next message to go into its running session as a line. A turn that runs
     * has a runner of its own, whose IDLE arms a window of its own.
     */
    const warmHolding = (sessionId: string, agent: Agent) =>
      Effect.gen(function* () {
        const { conversationId } = agent;
        const turn = (yield* latestTurnsOfReached([conversationId])).get(conversationId);

        if (turn?.status === TURN_STATUS.RUNNING) return;
        const found = yield* machine.findPlace(userId, sessionId);

        if (Option.isNone(found) || found.value.agentId !== agent.id) return;

        // An agent on screen is its sandbox in use: a running one is touched, a stopped one resumed by the launch below.
        if (found.value.machine === AGENT_MACHINE.VERCEL && found.value.running !== undefined) {
          yield* touchAgentSandbox(found.value.name);
        }

        const live = found.value.runner;

        if (live !== undefined) {
          return yield* deliveredTo(machine, userId, agent.id, live, [{ type: INPUT_LINE.WARM }]);
        }

        // Note that a session no launch may resume is let go by the next message, whose line carries
        // the agent's steps replayed, so none is launched warm with no line to hand them.
        if ((yield* resumedSessionOf(agent, yield* machine.layout(agent), false)).replay) return;
        yield* launchedWithoutMessage(sessionId, agent);
      });

    /**
     * A turn's delivery whose launch could not succeed: said once as an error
     * with the agent's ids and why, and reported where no named refusal
     * explains it (`agentFailureSaid`); then the turns it was for settled
     * failed as a turn whose runner was lost is (`settleRunnerLostTurns`),
     * with why, so the agent reads failed at once rather than waiting out its
     * pickup deadline. Its lines stand, for the developer to resend, and no
     * launch is handed them, their turn no longer waiting. A write that fails
     * is logged.
     */
    const launchFailed =
      (agent: Agent, sessionId: string) => (failure: { readonly _tag: string }) =>
        Effect.gen(function* () {
          const words = keptFailureWords(failureWords(failure));
          // The turn's failure is the one `settleRunnerLostTurns` writes below.
          yield* agentFailureSaid(
            `A ${harness.name} launch failed on a turn's delivery: ${words}`,
            failureKind(failure),
            !namedOutcome(failure),
            TURN_FAILURE.MODEL,
          );
          const writer = yield* storeWriter({ tools: CODER_TOOL_SET });

          // The turn its first message queued is the one failed. The checkout's own sentence names GitHub or the sandbox (`status.ts`'s `FAILURE_WORDS`);
          // any other failure, a missing snapshot among them, reads as the sandbox's, with its reason,
          // and a sandbox's failure with its own words after the sentence the status reads it by.
          const detail =
            failure instanceof CheckoutRefused
              ? words
              : failure instanceof LaunchRefused
                ? `${REPOSITORY_REFUSAL.SANDBOX_UNAVAILABLE}: ${failure.reason}`
                : `${REPOSITORY_REFUSAL.SANDBOX_UNAVAILABLE} ${words}`;

          yield* settleRunnerLostTurns(
            writer,
            agent.conversationId,
            yield* Clock.currentTimeMillis,
            detail,
          );
        }).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning(`A failed launch's turn was not written: ${causeKind(cause)}`),
          ),
          Effect.annotateLogs(agentLogIds(agent, sessionId)),
        );

    /**
     * A turn's delivery whose launch its plan's usage limit refused, with
     * the reset named, as `turnPayerOf` chooses the plan that resets soonest
     * where no payer has room and no API key is kept: the conversation's
     * queued turns held until then (`holdQueuedTurns`), their lines kept for
     * the launch the sweep's release delivers them to (`resumeWaitedTurns`),
     * as a running turn the limit cut short waits; answers whether any was
     * held. Any other refusal holds nothing, and the turn fails as before.
     */
    const heldForReset = (agent: Agent, failure: { readonly _tag: string }) =>
      Effect.gen(function* () {
        if (
          !(failure instanceof LaunchRefused) ||
          failure.planRefusal !== PLAN_REFUSAL.LIMIT_REACHED ||
          failure.planResetsAt === undefined
        ) {
          return false;
        }

        const writer = yield* storeWriter({ tools: CODER_TOOL_SET });

        const held = yield* writer.holdQueuedTurns(
          { userId, conversationId: agent.conversationId },
          new Date(failure.planResetsAt),
        );

        return Result.isSuccess(held) && held.success.length > 0;
      });

    /**
     * A message to the session for the agent its conversation is, as `send`
     * hands it on: held behind the agent's runner lease, or queued at once
     * where the lease is another call's, as `send` says.
     */
    const sentTo = (agent: Agent, sessionId: string, message: SessionMessage<Turn>) =>
      Effect.gen(function* () {
        const layout = yield* machine.layout(agent);
        const sent = messageLine(message, layout);
        const handsOn = layout.linesRead;

        // Note that a message naming files waits on the lease, which orders its files and its line
        // after any launch under way: a launch writes the waiting lines' files only as it starts,
        // so a line queued past it would reach its runner without them.
        const handed = yield* handsOn && sent.files.length === 0
          ? holdingRunnerIfFree(agent.id, sendHolding(sessionId, message, layout, sent, handsOn))
          : Effect.map(
              holdingRunner(
                agent.id,
                sendHolding(sessionId, message, layout, sent, handsOn),
                CODER.RUNNER_LEASE.SEND_WAIT,
              ),
              Option.some,
            );

        if (Option.isSome(handed)) return handed.value;
        // A session another agent's place stands for has ended for this one, as `sendHolding`
        // answers it. Note that no place at all is no answer yet, because a Start's launch still
        // opening its sandbox holds the lease, which is the very case this queue is for.
        const found = yield* machine.findPlace(userId, sessionId);

        if (Option.isSome(found) && found.value.agentId !== agent.id) {
          return { outcome: SESSION_SEND_OUTCOME.RETIRED } as const;
        }

        // A runner launched in another mode than the agent's now would take the message on the mode
        // it has, so the message waits on the lease, under which a warm runner on a changed mode is
        // launched again first (`staleWarm`), rather than being queued for it at once.
        const recorded = Option.isSome(found) ? found.value.runner : undefined;

        if (
          recorded !== undefined &&
          (recorded.mark.permissionMode ?? AGENT_PERMISSION_MODE.FULL_ACCESS) !==
            permissionModeOf(agent)
        ) {
          return yield* holdingRunner(
            agent.id,
            sendHolding(sessionId, message, layout, sent, handsOn),
            CODER.RUNNER_LEASE.SEND_WAIT,
          );
        }

        // The harness's lines are read as `sendHolding` reads them, so a plan refused now refuses
        // the message, and go ahead of it for a recorded runner's launch; with none recorded, the
        // message alone is queued for whichever launch runs, its words composed on whether that
        // launch resumes the harness's session. Its words and what they hand ride on its line, as
        // every queued line's do, so they compose against the lines still waiting and are kept as
        // handed once a runner took it. Note that the credential is not renewed here, because the
        // lease is another call's; it lives an hour, and the next message renews it. A runner the
        // call holding the lease leaves up reads it, and where none is, the turn's delivery
        // launches one (`deliverTurn`).
        const ahead = yield* harness.ahead(agent);

        const from =
          recorded === undefined ? yield* resumedSessionOf(agent, layout, false) : undefined;

        const opened = yield* openedLine(
          agent,
          sessionId,
          sent,
          from !== undefined && from.resume === undefined,
          from?.replay === true,
        );

        const carried = { files: [], handed: opened.handed };
        yield* recorded === undefined
          ? queued(agent, ANY_LAUNCH, [opened.line], carried)
          : queued(agent, recorded.mark.firstSequence, [...ahead.lines, opened.line], carried);

        return {
          outcome: SESSION_SEND_OUTCOME.ACCEPTED,
          sessionId,
          deliveryId: sent.line.uuid,
        } as const;
      });

    /**
     * The session the conversation's record names once it is claimed for a
     * session now opening, before that session's first line is queued or its
     * launch scheduled: the session itself, or the one minted after it that
     * holds the record already, as when a Start's open and a message's race
     * on a fresh agent; none where the conversation is gone. A claim that
     * fails fails the open with nothing started, rather than answering failed
     * for words a launch then takes.
     */
    const recordClaimed = (agent: Agent, sessionId: string) =>
      Effect.gen(function* () {
        const target = { userId: agent.userId, conversationId: agent.conversationId };
        const now = yield* Clock.currentTimeMillis;

        if (yield* claimRuntimeSession(target, sessionId, new Date(now))) return sessionId;

        return yield* recordedRuntimeSession(target);
      });

    /**
     * An open whose claim a later session won, its message handed to that
     * session as a send would hand it, so one agent never runs two runners
     * and the losing session launches nothing; failed where the conversation
     * records no session, or the send was not taken, as a send's own failure
     * fails the open.
     */
    const deferredTo = (
      agent: Agent,
      recorded: string | undefined,
      message: SessionMessage<Turn>,
    ) =>
      Effect.gen(function* () {
        yield* Effect.logInfo("a native session found its record held by a later session");

        const unavailable = {
          outcome: SESSION_SEND_OUTCOME.FAILED,
          status: FAILED_STATUS.UNAVAILABLE,
        } as const;

        if (recorded === undefined) return unavailable;
        const sent = yield* sentTo(agent, recorded, message);

        return sent.outcome === SESSION_SEND_OUTCOME.ACCEPTED
          ? ({ outcome: SESSION_SEND_OUTCOME.ACCEPTED, sessionId: recorded } as const)
          : unavailable;
      });

    const sessions: NativeSessions<Turn> = {
      // An open answers once the plan's credential is read and its session claims the conversation's
      // record, so a plan refused or at its limit is refused at once, and nothing past it waits on a
      // sandbox. On a machine whose runner reads its lines, the first message is queued, its files
      // and what its words hand carried on its line, and the turn it awaits is delivered through its
      // queue once its line's write records it taken (`turn-delivery.ts`), whose consumer opens the
      // place and launches the runner (`deliverTurn`). On one fed on its stdin, as a Mac's is, the
      // place is opened and the runner launched here, under the lease, its launch a line its
      // machine takes up (`device-machine.ts`).
      open: (message) =>
        Effect.gen(function* () {
          const agent = yield* agentOf(message.conversationId);
          const sessionId = sessionIdOf(harness.sessionPrefix, yield* Clock.currentTimeMillis);

          return yield* Effect.gen(function* () {
            const layout = yield* machine.layout(agent);
            const credential = yield* harness.launch(agent, layout);
            const recorded = yield* recordClaimed(agent, sessionId);

            if (recorded !== sessionId) return yield* deferredTo(agent, recorded, message);
            const first = messageLine(message, layout);

            if (layout.linesRead) {
              const opened = yield* openedLine(agent, sessionId, first, true);
              yield* queued(agent, ANY_LAUNCH, [opened.line], {
                files: first.files,
                handed: opened.handed,
              });
            } else {
              yield* holdingRunner(
                agent.id,
                openedPlace(agent, sessionId, layout, first, credential),
                CODER.RUNNER_LEASE.SEND_WAIT,
              );
            }

            return { outcome: SESSION_SEND_OUTCOME.ACCEPTED, sessionId } as const;
          }).pipe(Effect.catch(failed("open")), Effect.annotateLogs(agentLogIds(agent, sessionId)));
        }).pipe(
          Effect.catch(failed("open")),
          Effect.annotateLogs(agentLogIds({ conversationId: message.conversationId })),
          Effect.provideContext(context),
        ),

      // A first launch's boot claims a session afresh, past any an earlier boot claimed, so a Retry opens
      // a machine of its own rather than one a failed boot left half made; the plan's credential is read
      // first, so a plan refused or at its limit refuses the Start at once, as an open does. The machine
      // opens in `up`, under the runner lease, its runner launched with no message: warm from its start,
      // reading the lines the agent's queue hands it once it is up.
      boot: (conversationId) =>
        Effect.gen(function* () {
          const agent = yield* agentOf(conversationId);
          const sessionId = sessionIdOf(harness.sessionPrefix, yield* Clock.currentTimeMillis);

          return yield* Effect.gen(function* () {
            const layout = yield* machine.layout(agent);
            const credential = yield* harness.launch(agent, layout);
            const recorded = yield* recordClaimed(agent, sessionId);

            if (recorded !== sessionId) {
              return {
                outcome: SESSION_SEND_OUTCOME.FAILED,
                status: FAILED_STATUS.UNAVAILABLE,
              } as const;
            }

            const up = holdingRunner(
              agent.id,
              openedPlace(agent, sessionId, layout, undefined, credential),
              CODER.RUNNER_LEASE.SEND_WAIT,
            ).pipe(
              // Note that a runner fed on its stdin is up once its Mac starts it, not once its launch line is written.
              Effect.as(layout.linesRead ? MACHINE_UP.READY : MACHINE_UP.AWAITS_HOST),
              Effect.catch((failure) =>
                Effect.as(
                  agentFailureSaid(
                    `A ${harness.name} boot failed: ${keptFailureWords(failureWords(failure))}`,
                    failureKind(failure),
                    !namedOutcome(failure),
                  ),
                  bootFailureOf(failure),
                ),
              ),
              Effect.annotateLogs(agentLogIds(agent, sessionId)),
              Effect.provideContext(context),
            );

            return { outcome: SESSION_SEND_OUTCOME.ACCEPTED, sessionId, up } as const;
          }).pipe(Effect.catch(failed("boot")), Effect.annotateLogs(agentLogIds(agent, sessionId)));
        }).pipe(
          Effect.catch(failed("boot")),
          Effect.annotateLogs(agentLogIds({ conversationId })),
          Effect.provideContext(context),
        ),

      // A message to a runner that reads its lines never waits behind another call's lease, as a
      // turn's delivery holds it while its sandbox comes up: it is queued at once, read by the runner
      // that call leaves running. One that finds no runner up is queued too, for the launch the
      // turn it awaits is delivered to (`deliverTurn`), so the send answers once its line is
      // written. One naming files waits on the lease, so its files are written into a place that
      // runs before its line, or carried on its line for the launch that writes them as it starts.
      send: (sessionId, message) =>
        Effect.gen(function* () {
          const after = yield* Effect.serviceOption(AfterResponse);

          return yield* Effect.gen(function* () {
            const agent = yield* agentOf(message.conversationId);

            return yield* sentTo(agent, sessionId, message).pipe(
              Effect.catch(failed("send")),
              Effect.annotateLogs(agentLogIds(agent, sessionId)),
            );
          }).pipe(
            Effect.catch(failed("send")),
            Effect.annotateLogs(agentLogIds({ conversationId: message.conversationId }, sessionId)),
            Effect.provideContext(
              Option.isSome(after) ? Context.add(context, AfterResponse, after.value) : context,
            ),
          );
        }),

      // A turn its plan's limit cut short goes on with its own line in a launch on the next payer:
      // the runner, wherever it runs and whatever it holds, ended and launched again here under the
      // lease, as a message to a Mac's is, its payer chosen afresh as every launch's is
      // (`turnPayerOf`) and the harness's session resumed (`resumedSessionWhen`); or, for a turn
      // whose launch could not resume it (`replayed`), let go and the conversation replayed. Note
      // that on a machine whose runner reads its lines, the line the ended launch took is put back
      // untaken first, because the launch queues it again under the same id, and a line taken is
      // never handed again (`requeueRunnerLine`). The line is resent, since the session it resumes
      // already holds it under its id.
      retry: (sessionId, message, replayed = false) =>
        Effect.gen(function* () {
          const after = yield* Effect.serviceOption(AfterResponse);

          return yield* Effect.gen(function* () {
            const agent = yield* agentOf(message.conversationId);
            const layout = yield* machine.layout(agent);
            const first = messageLine(message, layout);
            const sent = { ...first, line: { ...first.line, resent: true } };

            return yield* holdingRunner(
              agent.id,
              Effect.andThen(
                layout.linesRead
                  ? requeueRunnerLine(userId, agent.id, sent.line.uuid)
                  : Effect.void,
                sendHolding(sessionId, message, layout, sent, false, true, replayed),
              ),
              CODER.RUNNER_LEASE.SEND_WAIT,
            ).pipe(
              Effect.catch(failed("retry")),
              Effect.annotateLogs(agentLogIds(agent, sessionId)),
            );
          }).pipe(
            Effect.catch(failed("retry")),
            Effect.annotateLogs(agentLogIds({ conversationId: message.conversationId }, sessionId)),
            Effect.provideContext(
              Option.isSome(after) ? Context.add(context, AfterResponse, after.value) : context,
            ),
          );
        }),

      // The Stop is scoped to the turn it names: written only while that turn is the
      // conversation's turn under way, to the command of the launch running it, and naming that
      // launch, so a Stop delayed past its turn never interrupts the next launch's. A Stop taken
      // is forced past the answer (`forcedStop`), its wait run there rather than holding the
      // request; a caller with no after-response door leaves an unconfirmed Stop to the turn's lease.
      cancel: (sessionId, turnId) =>
        Effect.gen(function* () {
          const after = yield* Effect.serviceOption(AfterResponse);

          return yield* Effect.gen(function* () {
            const found = yield* machine.findPlace(userId, sessionId);
            const agentId = Option.isSome(found) ? found.value.agentId : undefined;
            const agent = agentId === undefined ? Option.none() : yield* readAgent(userId, agentId);

            if (Option.isNone(agent)) {
              return { outcome: SESSION_CANCEL_OUTCOME.NO_ACTIVE_TURN } as const;
            }

            const canceled = yield* holdingRunner(
              agent.value.id,
              cancelHolding(sessionId, turnId, agent.value),
            );

            if (canceled.outcome !== SESSION_CANCEL_OUTCOME.ACCEPTED || Option.isNone(after)) {
              return { outcome: canceled.outcome } as const;
            }

            const launch = "launch" in canceled ? canceled.launch : undefined;
            yield* afterResponse(
              `A ${harness.name} Stop's force`,
              forcedStop(sessionId, turnId, agent.value, launch).pipe(
                Effect.annotateLogs(agentLogIds(agent.value, sessionId)),
              ),
            );

            return { outcome: canceled.outcome } as const;
          }).pipe(
            Effect.catch(unavailable("cancel")),
            Effect.annotateLogs(agentLogIds({}, sessionId)),
            Effect.provideContext(
              Option.isSome(after) ? Context.add(context, AfterResponse, after.value) : context,
            ),
          );
        }),

      reset: (sessionId) =>
        Effect.gen(function* () {
          const found = yield* machine.findPlace(userId, sessionId);

          // A session whose place is another account's agent's is none of this account's to retire.
          if (Option.isNone(found) || !(yield* ownsPlace(found.value))) {
            return { outcome: SESSION_RESET_OUTCOME.NO_ACTIVE_SESSION } as const;
          }

          // The bearer goes first, so a runner still up is refused by us before its place is gone.
          const { agentId } = found.value;

          if (agentId !== undefined) yield* recordAgentRunnerToken(userId, agentId, null);
          yield* machine.discard(found.value);

          return { outcome: SESSION_RESET_OUTCOME.RESET } as const;
        }).pipe(
          Effect.catch(unavailable("reset")),
          Effect.annotateLogs(agentLogIds({}, sessionId)),
          Effect.provideContext(context),
        ),

      halt: (sessionId, conversationId) =>
        Effect.gen(function* () {
          const { id } = yield* agentOf(conversationId);
          yield* holdingRunner(id, haltHolding(sessionId, conversationId));

          return true;
        }).pipe(
          Effect.catch((failure) =>
            Effect.as(
              Effect.logWarning(
                `A ${harness.name} halt failed: ${keptFailureWords(failureWords(failure))}`,
              ),
              false,
            ),
          ),
          Effect.annotateLogs(agentLogIds({ conversationId }, sessionId)),
          Effect.provideContext(context),
        ),

      // A queued turn's delivery, from its queue's consumer (`turn-delivery.ts`): taken up only where
      // no other call holds the runner lease, which is at work on the runner and is tried again
      // after; a launch its plan's limit refused, with the reset named, holds the turn until then
      // (`heldForReset`); any other launch that cannot succeed is written as the agent's failed
      // turn, as a Start's is, and one that may yet, its store or its machine unreachable, fails
      // for the queue to deliver the turn again.
      deliverTurn: (sessionId, conversationId) =>
        Effect.gen(function* () {
          // Note that only an agent gone is unreached; a store that could not be read fails, for the queue to deliver the turn again.
          const agent = yield* agentOf(conversationId).pipe(
            Effect.map(Option.some),
            Effect.catchIf(
              (failure) => failure instanceof LaunchRefused,
              () => Effect.succeed(Option.none<Agent>()),
            ),
          );

          if (Option.isNone(agent)) return TURN_HANDOVER.UNREACHED;

          return yield* holdingRunnerIfFree(
            agent.value.id,
            deliveredHolding(sessionId, agent.value),
          ).pipe(
            Effect.map(Option.getOrElse((): TurnHandover => TURN_HANDOVER.BUSY)),
            Effect.catchIf(
              (failure) => !mayTakeAgain(failure),
              (failure) =>
                Effect.flatMap(heldForReset(agent.value, failure), (held) =>
                  held
                    ? Effect.succeed(TURN_HANDOVER.WAITING)
                    : Effect.as(
                        launchFailed(agent.value, sessionId)(failure),
                        TURN_HANDOVER.FAILED,
                      ),
                ),
            ),
            Effect.annotateLogs(agentLogIds(agent.value, sessionId)),
          );
        }).pipe(
          Effect.annotateLogs(agentLogIds({ conversationId }, sessionId)),
          Effect.provideContext(context),
        ),

      // A warm call runs past the answer, and only where no other call holds the runner lease: a
      // Start or a message holding it is launching or writing to the runner already, and the next
      // warm call, a minute on, finds what it left. A launch that fails here is logged alone, and
      // written as no failed turn, since no message of the developer's waits on it.
      warm: (sessionId, conversationId) =>
        Effect.gen(function* () {
          const agent = yield* agentOf(conversationId);
          yield* afterResponse(
            `A ${harness.name} warm launch`,
            holdingRunnerIfFree(agent.id, warmHolding(sessionId, agent)).pipe(
              Effect.catch((failure) =>
                Effect.logWarning(
                  `A ${harness.name} warm launch failed: ${keptFailureWords(failureWords(failure))}`,
                ),
              ),
              Effect.annotateLogs(agentLogIds(agent, sessionId)),
            ),
          );
        }).pipe(
          Effect.catch((failure) =>
            Effect.logWarning(
              `A ${harness.name} warm call failed: ${keptFailureWords(failureWords(failure))}`,
            ),
          ),
          Effect.annotateLogs(agentLogIds({ conversationId }, sessionId)),
          Effect.provideContext(context),
        ),

      // A member's answer goes to the runner that holds the ask, as its messages go.
      answer: (sessionId, conversationId, line) =>
        Effect.gen(function* () {
          const { id } = yield* agentOf(conversationId);

          return yield* holdingRunner(id, answerHolding(sessionId, conversationId, line));
        }).pipe(
          Effect.catch((failure) =>
            Effect.as(
              Effect.logWarning(
                `A ${harness.name} answer to an ask failed: ${keptFailureWords(failureWords(failure))}`,
              ),
              RUNNER_ANSWER.FAILED,
            ),
          ),
          Effect.annotateLogs(agentLogIds({ conversationId }, sessionId)),
          Effect.provideContext(context),
        ),

      // A change of model or effort goes to a runner that runs as the harness's `model` lines alone,
      // which it takes at its next model call; a runner not up takes it at the next message's launch.
      retune: (sessionId, conversationId) =>
        Effect.gen(function* () {
          const { id } = yield* agentOf(conversationId);

          return yield* holdingRunner(id, retuneHolding(sessionId, conversationId));
        }).pipe(
          Effect.catch((failure) =>
            Effect.as(
              Effect.logWarning(
                `A ${harness.name} model change failed: ${keptFailureWords(failureWords(failure))}`,
              ),
              RUNNER_CHOICE.FAILED,
            ),
          ),
          Effect.annotateLogs(agentLogIds({ conversationId }, sessionId)),
          Effect.provideContext(context),
        ),
    };

    return sessions;
  });

/** What the events route names of a launch's end: the agent, its session, the END event's number, why it ended where the END said, and the launch its post named (`agent.runner_launch`), where it named one. */
export interface RunnerEnding {
  readonly target: ConversationTarget;
  readonly sessionId: string;
  readonly sequence: number;
  readonly reason?: RunnerEnd | undefined;
  readonly launch?: number | undefined;
}

/**
 * Whether the agent's runner may have taken a message since its turn ended:
 * its newest turn is still open, queued for a runner or running. A send
 * writes its line with the turn it awaits before it takes the runner lease
 * (`turn-state.ts`), so read under the lease this sees every message a send
 * wrote to the runner ahead of it.
 */
const runnerMayBeAtWork = (agentId: string) =>
  Effect.map(
    readNativeRunStanding(agentId),
    (standing) => Option.isSome(standing) && standing.value.endedAt === null,
  );

/** A warm runner a retire names: the session its place is found by, the agent's starter, whose account its retire line is queued under, the agent, and the machine's session the caller found the place running. */
interface WarmRunner {
  readonly sessionId: string;
  readonly userId: string;
  readonly agentId: string;
  readonly running: string;
}

/**
 * The retire `retireWarmRunner` makes, its caller holding the agent's
 * runner lease: the place read again, and the retire line written to the
 * runner it runs now, where it still runs in the session given.
 */
const retiredHolding = (machine: MachineLifecycle, retiring: WarmRunner) =>
  Effect.gen(function* () {
    if (yield* runnerMayBeAtWork(retiring.agentId)) return false;
    const found = yield* machine.findPlace(retiring.userId, retiring.sessionId);

    if (Option.isNone(found)) return false;
    const live = found.value.runner;

    if (live === undefined || live.handle.running !== retiring.running) return false;
    const retire: InputLine = { type: INPUT_LINE.RETIRE };
    yield* deliveredTo(machine, retiring.userId, retiring.agentId, live, [retire]);
    // The runner is told of no longer, before the lease goes, so a message sent while it ends
    // relaunches it rather than landing behind the retire, which the runner ends on unread.
    const { launch } = found.value;
    yield* machine.recordRunner(
      recordOf(found.value, retiring.userId, found.value.agentId ?? retiring.agentId),
      launch === undefined
        ? { kind: RUNNER_RECORD.NONE }
        : { kind: RUNNER_RECORD.LAUNCHED, mark: launch },
    );

    return true;
  });

/**
 * A warm runner asked to end, under the agent's runner lease: its place
 * read again once the lease is held, and the retire line written to the
 * runner the place runs now, where it still runs in the session given.
 * The runner ends only where it is still warm, so a message a `send` wrote
 * ahead of the line, on the same stdin, keeps it (`INPUT_LINE.RETIRE`); its
 * END then stops the place as any launch's end does. Nothing is written
 * where the runner may have taken a message since its turn ended
 * (`runnerMayBeAtWork`), since the runner would decline the line and its
 * record, cleared here, would send the next message to a second runner beside
 * it; its next turn's end retires it. Answers whether the line was written.
 */
const retireWarmRunner = Effect.fn("web/retireWarmRunner")(function* (retiring: WarmRunner) {
  const machine = yield* deploymentLifecycle;

  return yield* holdingRunner(retiring.agentId, retiredHolding(machine, retiring));
});

/** How a launch's end left its place. */
export const RUNNER_ENDED = {
  /** The place left as it stands, for its own idle stop. */
  LEFT: "left",
  /** The END is from a launch a newer one replaced, or the place is gone or already down. */
  STALE: "stale",
  /**
   * The launch read its lines, and a message line no launch took waits, so
   * the place is left up for the launch the turn's delivery starts in it
   * (`deliverTurn`), which the END republishes the turn for.
   * Not for a launch that failed, whose relaunch might fail before it read
   * the line just as well, again and again; its turn reads failed, and the
   * developer's Continue relaunches it.
   */
  LINES_WAITING: "lines_waiting",
} as const;

/**
 * A launch's end, as its END event tells it, for either harness: a
 * sandbox's runner cleared from its place's record, and the place left as
 * it stands, for its own idle stop, and where a message waits for the
 * launch the turn's delivery starts, said so, for the END to hand it on;
 * nothing for an END older than the launch its place runs now. Decided under
 * the agent's runner lease, read again once it is held, so a delivery
 * relaunching the runner either finishes first, and its newer launch makes
 * this END stale, or starts after it. Fails where the machine or the store
 * could not be asked, or the lease stayed held past its wait.
 */
export const runnerEnded = Effect.fn("web/runnerEnded")(function* (ending: RunnerEnding) {
  const machine = yield* deploymentLifecycle;
  const found = yield* machine.findPlace(ending.target.userId, ending.sessionId);

  if (Option.isNone(found)) return RUNNER_ENDED.STALE;
  const { agentId } = found.value;

  // A place no agent is recorded for was never launched into, so no runner of it has a lease to wait out.
  if (agentId === undefined) return yield* leftAtEnd(machine, ending);

  return yield* holdingRunner(agentId, leftAtEnd(machine, ending));
});

/**
 * A device's launch's IDLE, its runner warm past the agent's turn: the
 * runner retired at once (`retireWarmRunner`) where its device last beat
 * that it waits to switch release (`HOST_UPDATE.WAITING`), so a host waiting
 * to update goes idle as its last turn ends. It otherwise stays warm for the
 * next message, and past its window ends itself or is retired by a message
 * sent past it (`sendHolding`). Retiring under the runner lease is what keeps a message
 * sent at the turn's end: one a send wrote first is taken by the runner,
 * which still reads its stdin, and one sent after finds the runner no
 * longer told of and relaunches. Nothing for a sandbox's runner, which
 * stays warm until its sandbox stops, nor for an IDLE older than the launch
 * its place runs now.
 * Answers whether the retire line was written.
 */
export const runnerIdled = Effect.fn("web/runnerIdled")(function* (idle: RunnerEnding) {
  const machine = yield* deploymentLifecycle;
  const found = yield* machine.findPlace(idle.target.userId, idle.sessionId);

  if (Option.isNone(found) || found.value.machine !== AGENT_MACHINE.DEVICE) return false;
  const { agentId, launch, running } = found.value;

  if (agentId === undefined || running === undefined) return false;

  if (launch !== undefined && idle.sequence < launch.firstSequence) return false;

  if (!(yield* deviceAgentAwaitsUpdate(idle.target.userId, agentId))) return false;

  return yield* retireWarmRunner({
    sessionId: idle.sessionId,
    userId: idle.target.userId,
    agentId,
    running: running.running,
  });
});

/** What `runnerEnded` decides, on the place as it stands when read here. */
const leftAtEnd = Effect.fn("web/leftAtEnd")(function* (
  machine: MachineLifecycle,
  ending: RunnerEnding,
) {
  const found = yield* machine.findPlace(ending.target.userId, ending.sessionId);

  if (Option.isNone(found)) return RUNNER_ENDED.STALE;
  // Read apart from the runner's record, which a launch writes only once its command started.
  const { launch, running, agentId } = found.value;

  // An END is a newer launch's to stop only where it is that launch's own: by the launch its post
  // named, read under the lease every launch records its number under, or, for a post that named
  // none, by its event's number, which launches that posted nothing between them share.
  if (ending.launch !== undefined && agentId !== undefined) {
    if (ending.launch !== (yield* runnerLaunchOf(agentId))) return RUNNER_ENDED.STALE;
  } else if (launch !== undefined && ending.sequence < launch.firstSequence) {
    return RUNNER_ENDED.STALE;
  }

  if (running === undefined) return RUNNER_ENDED.STALE;

  // The runner said it ended, so its record tells of it no longer, its launch kept for a late END:
  // a message or a delivery after this reads no runner up, and launches one rather than awaiting it.
  if (launch?.linesRead === true && agentId !== undefined) {
    const place = recordOf(found.value, ending.target.userId, agentId);
    yield* machine.recordRunner(place, { kind: RUNNER_RECORD.LAUNCHED, mark: launch });
  }

  if (
    launch?.linesRead === true &&
    agentId !== undefined &&
    ending.reason !== RUNNER_END.FAILED &&
    Option.isSome(yield* runnerLineWaitingSince(ending.target.userId, agentId))
  ) {
    return RUNNER_ENDED.LINES_WAITING;
  }

  return RUNNER_ENDED.LEFT;
});
