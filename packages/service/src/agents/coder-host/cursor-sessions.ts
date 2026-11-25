/**
 * cursor-sessions.ts -- a coding agent's sessions on Cursor: the runner in its Cursor mode, which runs Cursor's SDK in its own process on the account's Cursor API key in the cloud, and on a Mac's own Cursor sign-in there.
 *
 * The `cursor` implementation of `AgentSessions`
 * (`sessions/agent-sessions.ts`), on the launch machinery every native
 * harness shares (`runner-sessions.ts`). What is Cursor's own:
 *
 * - The runner's config names the SDK the image installs
 *   (`MachineLayout`'s `cursorSdk`), the model as Cursor's SDK takes it,
 *   built from Cursor's catalog entry, the agent's effort and its speed
 *   (`cursorModelSelectionOf`), and our coder instructions, which the
 *   runner sends ahead of the agent's first message since the SDK takes
 *   none beside its own prompt (`@repo/agent-runner`'s `cursor.ts`).
 * - Cursor's agent id is ours to mint: a relaunch names the conversation's
 *   `native_session`, the agent id as the events route records it, and a
 *   fresh session a new one, which the runner makes the agent under. The
 *   runner keeps the agent's store at the transcripts route under the
 *   project `cursor`, and resumes it from there in a sandbox made anew.
 *   Cursor keeps nothing on a Mac's disk (`sessionsOnDisk`), so a Mac's
 *   launch of a session the store does not hold whole replays the agent's
 *   steps into a fresh one, as a sandbox's does.
 * - Every turn in the cloud is paid by the account's Cursor API key (Cursor
 *   keeps no plan here), declared as `CURSOR_API_KEY`: a placeholder minted for the
 *   launch, swapped for the key at the sandbox's firewall on both hosts
 *   Cursor's SDK sends it to, `api2.cursor.sh`, where it is exchanged for
 *   the hour's token every other call carries, and `api.cursor.com`
 *   (`LAUNCH_SWAP.CURSOR_KEY`). The runner hands it to the SDK as its
 *   `apiKey`, never through the environment the agent's shell inherits. A
 *   key gone or unreadable refuses the launch.
 * - Cursor runs Full access and Auto (Cursor's own Auto-review) alone;
 *   Ask is never offered (`harnessTakesMode`), and an agent somehow on it
 *   is refused rather than run unasked.
 * - A rewind or a fork at a message hands the launch its cut as the other
 *   harnesses' launches are handed theirs, and the runner points the agent
 *   back at the checkpoint it marked before that line (`cursor-store.ts`).
 * - A local agent runs on its Mac's own Cursor sign-in
 *   (`AGENT_PAYER.MAC_SIGN_IN`), the key Cursor's SDK keeps there once the
 *   member signs in (`vespin-host cursor-login`), so its launch is handed no
 *   credential, and the runner hands the SDK none. It runs the SDK the Mac
 *   registered (`MachineLayout`'s `cursorSdk`); a device that registered
 *   none, a Linux host or a host from before it, refuses the launch.
 * - A `model` line with the agent's model as Cursor takes it goes ahead of
 *   every message, as the other harnesses' lines do.
 */

import { randomUUID } from "node:crypto";
import {
  CURSOR_AGENT_PREFIX,
  type CursorConfig,
  INPUT_LINE,
  type InputLine,
  PERMISSION_MODE,
  RUNNER_ENV,
  RUNNER_HARNESS,
} from "@repo/agent-runner/protocol";
import type { Agent } from "@repo/database/models/agent-store";
import { PROVIDER_KEY_UNREADABLE } from "@repo/database/models/provider-key-seal";
import { CONVERSATION_RUNTIME } from "@repo/database/storage-vocabulary";
import { AGENT_PAYER } from "@repo/features/agent-wire";
import { MODEL_PROVIDER } from "@repo/features/models-wire";
import { PROVIDER_KEY_PROVIDER } from "@repo/features/provider-key-wire";
import { Effect, type Redacted } from "effect";
import { ownApiKeyOf } from "../../accounts/own-api-key.js";
import { HostedEnvironment } from "../../environment.js";
import { SERVER_AGENT_HARNESS } from "../../events/server-events.js";
import { CursorModelCatalog, cursorModelSelectionOf } from "../../providers/cursor-models.js";
import {
  LaunchRefused,
  type MachineLayout,
  type RunnerCredential,
} from "../machine/agent-machine.js";
import { LAUNCH_SWAP } from "../sandbox-firewall.js";
import { KEY_REFUSAL, type SessionTurn } from "../sessions/agent-sessions.js";
import { launchPayerOf } from "./agent-runtime-choice.js";
import { cursorCommandRoute } from "./harness-commands.js";
import { NATIVE_SESSION_PREFIX } from "./native-runtime.js";
import { launchPermissionMode } from "./permission-mode.js";
import {
  type HarnessLaunch,
  type RunnerHarness,
  type RunnerServices,
  type RunnerSessionsOptions,
  runnerSessions,
} from "./runner-sessions.js";
import type { NativeSessions } from "./runtime-sessions.js";

/** The header Cursor's SDK sends its key in, named in lower case as the firewall matches it, and the scheme ahead of the key there. */
const BEARER_HEADER = "authorization";
const BEARER_SCHEME = "Bearer ";

/**
 * Cursor's two hosts its SDK sends the key to: the exchange that mints the
 * hour's token every other call carries, and the API's account and model
 * calls (the spike's finding).
 */
const CURSOR_API = {
  EXCHANGE: { domain: "api2.cursor.sh", path: { startsWith: "/auth/exchange_user_api_key" } },
  API: { domain: "api.cursor.com" },
} as const;

/** The account's Cursor API key as a launch declares it: sent to Cursor's two hosts, fixed for the launch. */
function apiKeyCredential(key: Redacted.Redacted<string>): RunnerCredential {
  return {
    variable: RUNNER_ENV.CURSOR_API_KEY,
    value: key,
    target: { ...CURSOR_API.EXCHANGE, alsoOn: [CURSOR_API.API] },
    header: BEARER_HEADER,
    scheme: BEARER_SCHEME,
    slot: LAUNCH_SWAP.CURSOR_KEY,
  };
}

/** The agent's model, on its window, as Cursor's SDK takes it, read against the Cursor models its starter is offered (`cursorModelSelectionOf`); refused only where it is not Cursor's. */
const selectionOf = Effect.fnUntraced(function* (agent: Agent) {
  const cursorModels = yield* (yield* CursorModelCatalog).forAccount(agent.userId);

  const selection = cursorModelSelectionOf(
    cursorModels,
    agent.model,
    agent.effort,
    agent.contextWindow,
  );

  if (selection === undefined) return yield* new LaunchRefused({ reason: "model" });

  return selection;
});

/** Cursor as the shared launch drives it, for one account. */
function cursor(options: RunnerSessionsOptions): RunnerHarness<{ readonly _tag: string }> {
  const { userId } = options;

  /**
   * No credential on a device, whose Cursor runs on the Mac's own sign-in;
   * else the account's Cursor API key, declared as `CURSOR_API_KEY`; a
   * Preview's stand-in where the key is gone or unreadable
   * (`accounts/own-api-key.ts`); refused where neither is.
   */
  const launch = (agent: Agent, _layout: MachineLayout) =>
    Effect.gen(function* () {
      const turn = yield* launchPayerOf(userId, agent, MODEL_PROVIDER.CURSOR);

      if (turn.payer === AGENT_PAYER.MAC_SIGN_IN) {
        const onMachineLogin: HarnessLaunch = { env: {} };

        return onMachineLogin;
      }

      const environment = yield* HostedEnvironment;

      const key = yield* ownApiKeyOf(
        userId,
        PROVIDER_KEY_PROVIDER.CURSOR,
        environment,
        turn.subscriptionId,
      );

      if (key === undefined) {
        return yield* new LaunchRefused({ reason: "no API key", keyRefusal: KEY_REFUSAL.MISSING });
      }

      if (key === PROVIDER_KEY_UNREADABLE) {
        return yield* new LaunchRefused({
          reason: "API key unreadable",
          keyRefusal: KEY_REFUSAL.UNREADABLE,
        });
      }

      const launched: HarnessLaunch = { env: {}, credentials: [apiKeyCredential(key)] };

      return launched;
    });

  const config = (
    agent: Agent,
    layout: MachineLayout,
    resume: string | undefined,
    firstSequence: number,
    rewindBefore: string | undefined,
  ) =>
    Effect.gen(function* () {
      const model = yield* selectionOf(agent);

      // Note that a device runs only the SDK it registered, and one that registered none runs no Cursor agent.
      if (layout.cursorSdk === undefined) return yield* new LaunchRefused({ reason: "no cursor" });

      const mode = launchPermissionMode(agent);

      // Note that Cursor asks nobody, so a mode that asks would run unasked; it is refused instead.
      if (mode !== undefined && mode.permissionMode === PERMISSION_MODE.ASK) {
        return yield* new LaunchRefused({ reason: "permission mode", modesUnsupported: true });
      }

      const written: CursorConfig = {
        harness: RUNNER_HARNESS.CURSOR,
        cwd: layout.checkoutPath,
        agentId: agent.id,
        sdk: layout.cursorSdk,
        session: resume ?? `${CURSOR_AGENT_PREFIX}${randomUUID()}`,
        ...(rewindBefore === undefined ? undefined : { rewindBefore }),
        model,
        instructions: yield* options.instructions(agent, layout),
        firstSequence,
        eventsUrl: options.eventsUrl,
        mcpUrl: options.mcpUrl,
        integrations: yield* options.integrations(agent),
        ...(layout.installedSkills === undefined
          ? undefined
          : { installedSkills: layout.installedSkills }),
        ...(mode?.permissionMode === PERMISSION_MODE.AUTO
          ? { permissionMode: PERMISSION_MODE.AUTO }
          : undefined),
      };

      return written;
    });

  // The agent's model as Cursor takes it, as it stands.
  const ahead = (agent: Agent) =>
    Effect.map(selectionOf(agent), (selection) => {
      const choice: InputLine = { type: INPUT_LINE.MODEL, selection };

      return { lines: [choice] };
    });

  return {
    name: "Cursor",
    runtime: SERVER_AGENT_HARNESS.CURSOR,
    sessionPrefix: NATIVE_SESSION_PREFIX[CONVERSATION_RUNTIME.CURSOR],
    sessionsOnDisk: false,
    launch,
    config,
    ahead,
    commandRoute: cursorCommandRoute,
  };
}

/** The sessions for one account, over the calling fiber's services. */
export const cursorSessions = <Turn extends SessionTurn = SessionTurn>(
  options: RunnerSessionsOptions,
): Effect.Effect<NativeSessions<Turn>, never, RunnerServices> =>
  runnerSessions<{ readonly _tag: string }, Turn>(cursor(options), options);
