/**
 * claude-code-sessions.ts -- a coding agent's sessions on Claude Code: the runner in its Claude Code mode, launched on the account's setup-token.
 *
 * The `claude_code` implementation of `AgentSessions`
 * (`sessions/agent-sessions.ts`), on the launch machinery every native
 * harness shares (`runner-sessions.ts`). What is Claude Code's own: the
 * runner's config names the image's `claude` and appends our coder
 * instructions to Claude Code's prompt; each launch chooses who pays for
 * the agent's turns and records it on its row (`turnPayerOf`): the first of
 * the account's subscriptions with room, whose token, opened from its sealed
 * `claude_setup_token` row, is the launch's credential, or, where none has
 * room, the account's API key opened as `ANTHROPIC_API_KEY`, never both, since
 * the CLI prefers the key and bills it without a word where both are set;
 * where neither pays, the plan is refused in its own words, the row gone,
 * refused, unreadable, or at a limit whose named reset is still ahead; the
 * launch declares the credential, which the agent's machine
 * hands over (`launchCredential`): held at a sandbox's firewall, the CLI's
 * variable carrying a placeholder minted for the launch, and on a host the
 * variable's own; and every message to a running runner
 * goes behind a `model` line with the agent's model, effort, and fast mode
 * as they stand: a fast version runs its base model with Claude Code's own
 * fast mode on, which Anthropic bills to the account's usage credits. The
 * CLI's own session id is the conversation's `native_session`, which the
 * events route records from the runner's `init`, and a relaunch resumes.
 */

import { CLAUDE_EXECUTABLE } from "@repo/agent-runner/pins";
import {
  type ClaudeCodeConfig,
  EFFORT,
  type Effort,
  INPUT_LINE,
  RUNNER_ENV,
  RUNNER_HARNESS,
} from "@repo/agent-runner/protocol";
import { type Agent, readAgentRouting } from "@repo/database/models/agent-store";
import {
  openProviderKey,
  PROVIDER_KEY_UNREADABLE,
  parseKeyRing,
} from "@repo/database/models/provider-key-seal";
import { listProviderKeyRows } from "@repo/database/models/provider-key-store";
import { CONVERSATION_RUNTIME } from "@repo/database/storage-vocabulary";
import { AGENT_PAYER } from "@repo/features/agent-wire";
import { MODEL_PROVIDER, MODEL_SPEED } from "@repo/features/models-wire";
import {
  PROVIDER_KEY_KIND,
  PROVIDER_KEY_PROVIDER,
  PROVIDER_KEY_STATUS,
  planLimitResetsAt,
} from "@repo/features/provider-key-wire";
import { Clock, Effect, Option, type Redacted, Result } from "effect";
import { ownApiKeyOf } from "../../accounts/own-api-key.js";
import { HostedEnvironment } from "../../environment.js";
import { SERVER_AGENT_HARNESS } from "../../events/server-events.js";
import { providerModelOf } from "../../providers/model-catalog.js";
import { LaunchRefused, type MachineLayout } from "../machine/agent-machine.js";
import { SKILL_ROOT } from "../repository-skills.js";
import { LAUNCH_SWAP } from "../sandbox-firewall.js";
import { KEY_REFUSAL, PLAN_REFUSAL, type SessionTurn } from "../sessions/agent-sessions.js";
import { BEARER_PREFIX } from "../workspace-mcp/bearer.js";
import { turnPayerOf } from "./agent-runtime-choice.js";
import { NATIVE_SESSION_PREFIX } from "./native-runtime.js";
import {
  type HarnessLaunch,
  type RunnerHarness,
  type RunnerServices,
  type RunnerSessionsOptions,
  runnerSessions,
} from "./runner-sessions.js";
import type { NativeSessions } from "./runtime-sessions.js";

/** Anthropic's API: the one host the CLI sends its credential to, in either mode (CLI 2.1.304, as its requests were recorded). */
const ANTHROPIC_API = "api.anthropic.com";

/**
 * How the CLI sends each credential: the variable it reads it from, the
 * header it sends it in, named in lower case, and what goes ahead of it
 * there, as CLI 2.1.304's requests were recorded: the setup-token as a
 * bearer, and an API key in Anthropic's own `x-api-key`, each sent whole,
 * whatever its shape, so a placeholder keeps the CLI in its mode.
 */
const CLI_CREDENTIAL = {
  PLAN: { variable: RUNNER_ENV.CLAUDE_TOKEN, header: "authorization", scheme: BEARER_PREFIX },
  API_KEY: { variable: RUNNER_ENV.API_KEY, header: "x-api-key", scheme: "" },
} as const;

type CliCredential = (typeof CLI_CREDENTIAL)[keyof typeof CLI_CREDENTIAL];

/**
 * The credential as a launch declares it: read from the CLI's variable, sent
 * to Anthropic's API in the CLI's header, and fixed for the launch. The
 * agent's machine hands it over (`AgentMachineService`'s
 * `deliverCredentials`): a host, which has no firewall of ours, puts it in
 * the variable itself; a sandbox puts a placeholder minted for the launch
 * there, which keeps the CLI in the same mode, and its firewall sets the
 * real value in its place on requests to Anthropic's API that carry the
 * placeholder in the CLI's header, so the credential never enters the
 * sandbox.
 */
function launchCredential(
  sent: CliCredential,
  credential: Redacted.Redacted<string>,
): HarnessLaunch {
  return {
    env: {},
    credentials: [
      {
        variable: sent.variable,
        value: credential,
        target: { domain: ANTHROPIC_API },
        header: sent.header,
        scheme: sent.scheme,
        slot: LAUNCH_SWAP.CLAUDE,
      },
    ],
  };
}

/**
 * The half of Claude Code agents whose launches keep the main conversation's
 * prompt cache for an hour rather than the CLI's default five minutes, its
 * workers left on that default: those whose id, a UUID
 * as Postgres writes it, begins with one of these hex digits. Note that the
 * weekly agent audit reads this rule to tell the halves apart, recomputing it
 * from `agent.id` alone (`left(agent.id::text, 1) between '0' and '7'`), so
 * it changes only with the audit's query. An agent on a Claude subscription
 * is left out whatever its id, since the CLI already caches for an hour there.
 */
const PROMPT_CACHE_HOUR_DIGITS: ReadonlySet<string> = new Set("01234567");

/** The effort the CLI takes for the agent's own, where it names one of the SDK's. */
function effortOf(effort: string): Effort | undefined {
  return Object.values(EFFORT).find((level) => level === effort);
}

/** Claude Code as the shared launch drives it, for one account. */
function claudeCode(options: RunnerSessionsOptions): RunnerHarness<{ readonly _tag: string }> {
  const { userId } = options;

  /**
   * The setup-token's row of the subscription named, the account's first
   * where none is, where its plan may pay: refused in the
   * plan's words where it is gone, refused, or at a limit whose named reset
   * is still ahead. A launch and every message to a live runner ask it, so a
   * plan another agent's turn found refused stops this agent's too.
   */
  const standingPlan = Effect.fnUntraced(function* (subscriptionId: string | undefined) {
    const rows = (yield* listProviderKeyRows(userId, PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN)).filter(
      (each) => each.provider === PROVIDER_KEY_PROVIDER.ANTHROPIC,
    );
    const row =
      subscriptionId === undefined ? rows[0] : rows.find((each) => each.id === subscriptionId);
    if (row === undefined) {
      return yield* new LaunchRefused({
        reason: "no setup-token",
        planRefusal: PLAN_REFUSAL.SIGNED_OUT,
      });
    }
    if (row.status === PROVIDER_KEY_STATUS.INVALID) {
      return yield* new LaunchRefused({
        reason: "setup-token refused",
        planRefusal: PLAN_REFUSAL.SIGNED_OUT,
      });
    }
    const planResetsAt = planLimitResetsAt(row, yield* Clock.currentTimeMillis);
    if (planResetsAt !== undefined) {
      return yield* new LaunchRefused({
        reason: "plan limit reached",
        planRefusal: PLAN_REFUSAL.LIMIT_REACHED,
        planResetsAt,
      });
    }
    return row;
  });

  /** Who pays for the agent's turns and on which subscription, as its latest launch chose them; none for an agent from before payers were. */
  const recordedPayer = (agent: Agent) =>
    Effect.map(readAgentRouting(userId, agent.id), (routing) => ({
      payer: Option.getOrUndefined(Option.flatMapNullishOr(routing, (row) => row.payer)),
      subscriptionId: Option.getOrUndefined(
        Option.flatMapNullishOr(routing, (row) => row.subscriptionId),
      ),
    }));

  /** The deployment's ring, which every sealed credential opens under. */
  const keyRing = Effect.gen(function* () {
    const environment = yield* HostedEnvironment;
    const ring = environment.providerKeyEncryptionKeys;
    const parsed = ring === undefined ? undefined : parseKeyRing(ring);
    if (parsed === undefined || Result.isFailure(parsed)) {
      return yield* Effect.fail(new LaunchRefused({ reason: "no key ring" }));
    }
    return parsed.success;
  });

  /**
   * The account's Anthropic API key opened, as the CLI's documented
   * `ANTHROPIC_API_KEY` (https://code.claude.com/docs/en/agent-sdk/quickstart),
   * for a launch the starter's key pays for, or a Preview's stand-in where
   * that key is gone or unreadable (`accounts/own-api-key.ts`); refused
   * where neither is.
   */
  const apiKeyCredential = Effect.gen(function* () {
    const environment = yield* HostedEnvironment;
    const key = yield* ownApiKeyOf(userId, PROVIDER_KEY_PROVIDER.ANTHROPIC, environment);
    if (key === undefined) {
      return yield* new LaunchRefused({ reason: "no API key", keyRefusal: KEY_REFUSAL.MISSING });
    }
    if (key === PROVIDER_KEY_UNREADABLE) {
      return yield* new LaunchRefused({
        reason: "API key unreadable",
        keyRefusal: KEY_REFUSAL.UNREADABLE,
      });
    }
    return launchCredential(CLI_CREDENTIAL.API_KEY, key);
  });

  /** The CLI's credential and the variable it is read from: the plan token opened of the subscription the launch chose. */
  const planCredential = Effect.fnUntraced(function* (subscriptionId: string | undefined) {
    const ring = yield* keyRing;
    const row = yield* standingPlan(subscriptionId);
    const opened = openProviderKey(
      ring,
      {
        userId,
        provider: PROVIDER_KEY_PROVIDER.ANTHROPIC,
        kind: PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN,
      },
      row,
    );
    if (Result.isFailure(opened)) {
      return yield* new LaunchRefused({
        reason: "setup-token unreadable",
        planRefusal: PLAN_REFUSAL.UNREADABLE,
      });
    }
    return launchCredential(CLI_CREDENTIAL.PLAN, opened.success);
  });

  const config = (
    agent: Agent,
    layout: MachineLayout,
    resume: string | undefined,
    firstSequence: number,
    rewindBefore: string | undefined,
  ) =>
    Effect.gen(function* () {
      const model = providerModelOf(agent.model);
      if (model === undefined) return yield* Effect.fail(new LaunchRefused({ reason: "model" }));
      const effort = effortOf(agent.effort);
      // Note that the launch chose and recorded who pays before its config is written.
      const { payer } = yield* recordedPayer(agent);
      const cacheHour =
        payer === AGENT_PAYER.API_KEY && PROMPT_CACHE_HOUR_DIGITS.has(agent.id.charAt(0));
      const written: ClaudeCodeConfig = {
        harness: RUNNER_HARNESS.CLAUDE_CODE,
        cwd: layout.checkoutPath,
        executable: layout.claudeExecutable ?? CLAUDE_EXECUTABLE,
        model: model.modelId,
        ...(effort === undefined ? undefined : { effort }),
        ...(model.speed === MODEL_SPEED.FAST ? { fast: true } : undefined),
        ...(cacheHour ? { promptCacheHour: true } : undefined),
        append: yield* options.instructions(agent, layout),
        ...(resume === undefined ? undefined : { resume }),
        ...(rewindBefore === undefined ? undefined : { rewindBefore }),
        firstSequence,
        eventsUrl: options.eventsUrl,
        mcpUrl: options.mcpUrl,
        integrations: yield* options.integrations(agent),
        // Note that a host's older runner, bundled before Claude Code's command sandbox was removed, refuses a config without domains.
        allowedDomains: [],
        installedSkills: layout.installedSkills,
      };
      return written;
    });

  // The agent's model, effort, and fast mode as they stand go ahead of every message, which a change since the launch takes effect from.
  // Note that the subscription the runner launched on is asked first, so a message to a live runner on a refused or limited plan is
  // refused as a launch would be; a runner idle on another credential than a launch would now choose is launched again before it
  // gets here (`staleWarm`); an agent on its API key has no plan to ask, and its runner holds the key it launched with.
  const ahead = (agent: Agent) => {
    const effort = effortOf(agent.effort);
    const model = providerModelOf(agent.model);
    const asked = Effect.gen(function* () {
      const recorded = yield* recordedPayer(agent);
      if (recorded.payer === AGENT_PAYER.API_KEY) return;
      yield* standingPlan(recorded.subscriptionId);
    });
    return Effect.as(asked, {
      lines: [
        {
          type: INPUT_LINE.MODEL,
          ...(model === undefined
            ? undefined
            : { model: model.modelId, fast: model.speed === MODEL_SPEED.FAST }),
          ...(effort === undefined ? undefined : { effort }),
        },
      ],
    });
  };

  return {
    name: "Claude Code",
    runtime: SERVER_AGENT_HARNESS.CLAUDE_CODE,
    sessionPrefix: NATIVE_SESSION_PREFIX[CONVERSATION_RUNTIME.CLAUDE_CODE],
    // Note that a launch carries one credential alone, the key or the plan's token, because the CLI prefers the key where both are set.
    launch: (agent) =>
      Effect.gen(function* () {
        const turn = yield* turnPayerOf(userId, agent.id, MODEL_PROVIDER.ANTHROPIC);
        return yield* turn.payer === AGENT_PAYER.API_KEY
          ? apiKeyCredential
          : planCredential(turn.subscriptionId);
      }),
    config,
    // Note that Claude Code reads a checkout's skills from `.claude/skills` alone.
    skillRoots: [SKILL_ROOT.CLAUDE],
    ahead,
  };
}

/** The sessions for one account, over the calling fiber's services. */
export const claudeCodeSessions = <Turn extends SessionTurn = SessionTurn>(
  options: RunnerSessionsOptions,
): Effect.Effect<NativeSessions<Turn>, never, RunnerServices> =>
  runnerSessions<{ readonly _tag: string }, Turn>(claudeCode(options), options);
