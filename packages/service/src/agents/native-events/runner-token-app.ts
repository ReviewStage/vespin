/**
 * runner-token-app.ts -- where a cloud Codex runner on its starter's ChatGPT plan asks for the plan's access token, mid-turn included.
 *
 * A runner in the cloud's sandbox asks here (`@repo/agent-runner`'s
 * `codex-token.ts`) under its bearer as it signs app-server in on
 * host-supplied tokens and whenever app-server asks it for fresh ones after
 * a 401. This answers the access token of the subscription the agent's
 * launch put it on (`agent.subscription_id`), the account's first where none
 * is recorded, renewed first where
 * less than the token margin is left of it (`refreshChatGptAccess`, under
 * the row's lock, so two runners of one account never race its rotating
 * refresh token), and the ChatGPT workspace it pays from as the plan names
 * it, none where it names none.
 *
 * The bearer is admitted as the events route admits it (`../workspace-mcp/bearer.ts`):
 * a bearer no standing coding agent's conversation holds, a retired one's
 * among them, is refused. So is one whose agent does not run on Codex on its
 * starter's ChatGPT plan, one past the brake, which is kept per agent, and
 * a local agent's, which runs on its machine's own Codex login and is
 * handed no token of the account's. A runner asks through the sandbox's
 * firewall, which sets its bearer in place of the launch's placeholder.
 * What this answers is the token the runner's launch pays
 * with as the plan's payer, to the same machine the same bearer already
 * reaches our MCP server from. The token is never logged, and travels in
 * the answer's body alone, which no cache keeps. No device is answered
 * anything here: a host's agents reach GitHub on the machine's own sign-in.
 */

import type { RunnerTokenAnswer } from "@repo/agent-runner/protocol";
import type { DatabaseServices } from "@repo/database/core/query";
import { readAgentHeaderOfConversation, readAgentRouting } from "@repo/database/models/agent-store";
import { parseKeyRing } from "@repo/database/models/provider-key-seal";
import { CONVERSATION_RUNTIME } from "@repo/database/storage-vocabulary";
import { HOSTED_SERVICE_PATH } from "@repo/features";
import { AGENT_MACHINE, AGENT_PAYER } from "@repo/features/agent-wire";
import { HTTP_METHOD } from "@repo/wire";
import { Duration, Effect, Layer, Option, Redacted, Result } from "effect";
import type { HttpClient } from "effect/http";
import { HttpRouter, HttpServerRequest, type HttpServerResponse } from "effect/http";
import {
  CHATGPT_ACCESS,
  type ChatGptAccess,
  refreshChatGptAccess,
} from "../../accounts/chatgpt-credentials.js";
import { HostedEnvironment } from "../../environment.js";
import { HOSTED_HTTP_STATUS } from "../../http/http.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedJsonResponse,
  hostedNotFoundRoute,
  hostedRefusing,
  hostedStoreOrUnavailable,
} from "../../http/http-effect.js";
import { createRateBrake, type RateBrake } from "../../http/rate-brake.js";
import { ANY_METHOD, type WebRoutes } from "../../route.js";
import { CODEX_TOKEN_MARGIN } from "../coder-host/codex-sessions.js";
import { admitRunnerBearer, presentedBearer, presentedLaunch } from "../workspace-mcp/bearer.js";

/** The path a cloud Codex runner asks for the plan's token at. */
export const RUNNER_TOKEN_PATH = HOSTED_SERVICE_PATH.RUNNER_TOKEN;

/**
 * How often one agent may ask: a sandbox's runner asks as it launches and
 * after each 401, so a runner that asks more than this in ten minutes is
 * asking for something else.
 */
export const RUNNER_TOKEN_BRAKE = {
  windowMs: Duration.toMillis(Duration.minutes(10)),
  maxRequestsPerWindow: 20,
  maxTrackedUsers: 10_000,
} as const;

/** The refusal each way the sign-in can fail to answer a token, as a launch on it is refused. */
const REFUSAL_OF_ACCESS = {
  [CHATGPT_ACCESS.NONE]: HOSTED_REFUSAL.AGENT_PLAN_SIGNED_OUT,
  [CHATGPT_ACCESS.SIGNED_OUT]: HOSTED_REFUSAL.AGENT_PLAN_SIGNED_OUT,
  [CHATGPT_ACCESS.UNREADABLE]: HOSTED_REFUSAL.UNAVAILABLE,
  [CHATGPT_ACCESS.UNREACHABLE]: HOSTED_REFUSAL.AGENT_PLAN_UNREACHABLE,
  [CHATGPT_ACCESS.LIMIT_REACHED]: HOSTED_REFUSAL.AGENT_PLAN_LIMIT_REACHED,
  [CHATGPT_ACCESS.INELIGIBLE]: HOSTED_REFUSAL.AGENT_PLAN_INELIGIBLE,
} as const satisfies Record<Exclude<ChatGptAccess["outcome"], "ready">, HostedRefusal>;

/** POST: the plan's access token and workspace, for the cloud Codex agent on the plan the bearer stands for. */
const runnerTokenEndpoint = /* @__PURE__ */ Effect.fn("web/runnerTokenEndpoint")(function* (
  brake: RateBrake,
): Effect.fn.Return<
  HttpServerResponse.HttpServerResponse,
  HostedRefusal,
  HttpServerRequest.HttpServerRequest | DatabaseServices | HostedEnvironment | HttpClient.HttpClient
> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.POST) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const bearer = presentedBearer(request);
  if (bearer === undefined) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
  const admitted = yield* hostedStoreOrUnavailable(
    admitRunnerBearer(bearer, presentedLaunch(request)),
  );
  if (Option.isNone(admitted)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
  const { target } = admitted.value;
  const agent = yield* hostedStoreOrUnavailable(
    readAgentHeaderOfConversation(target.userId, target.conversationId),
  );
  if (Option.isNone(agent)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
  const routing = yield* hostedStoreOrUnavailable(readAgentRouting(target.userId, agent.value.id));
  // Note that only a cloud agent its starter's plan pays for, on Codex, is handed the plan's token: one
  // whose latest launch chose the plan (`launchPayerOf`); a local agent runs on its machine's own login.
  const codex = Option.getOrUndefined(
    Option.filter(routing, (row) => row.runtime === CONVERSATION_RUNTIME.CODEX),
  );
  const onPlan =
    agent.value.machine !== AGENT_MACHINE.DEVICE &&
    codex?.payer === AGENT_PAYER.CHATGPT_SUBSCRIPTION;
  if (!onPlan) return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
  if (!(yield* brake.check(agent.value.id))) {
    return yield* Effect.fail(HOSTED_REFUSAL.QUOTA_EXHAUSTED);
  }
  const environment = yield* HostedEnvironment;
  const keys = environment.providerKeyEncryptionKeys;
  const ring = keys === undefined ? undefined : parseKeyRing(keys);
  if (ring === undefined || Result.isFailure(ring)) {
    return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
  }
  const access = yield* hostedStoreOrUnavailable(
    refreshChatGptAccess(
      target.userId,
      ring.success,
      CODEX_TOKEN_MARGIN,
      codex?.subscriptionId ?? undefined,
    ),
  );
  if (access.outcome !== CHATGPT_ACCESS.READY) {
    return yield* Effect.fail(REFUSAL_OF_ACCESS[access.outcome]);
  }
  const { chatgptAccountId } = access.plan;
  const answer: RunnerTokenAnswer = {
    accessToken: Redacted.value(access.accessToken),
    ...(chatgptAccountId === undefined ? undefined : { chatgptAccountId }),
  };
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, answer);
});

/** The group: the one token path, braked per agent, and the hosted vocabulary's own refusal for any other. */
export function runnerTokenApp(): WebRoutes<
  DatabaseServices | HostedEnvironment | HttpClient.HttpClient
> {
  const endpoint = runnerTokenEndpoint(createRateBrake(RUNNER_TOKEN_BRAKE));
  return Layer.mergeAll(
    HttpRouter.add(ANY_METHOD, RUNNER_TOKEN_PATH, hostedRefusing(endpoint)),
    hostedNotFoundRoute,
  );
}
