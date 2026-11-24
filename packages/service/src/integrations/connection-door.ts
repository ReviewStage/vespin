/**
 * connection-door.ts -- a native agent's integrations, each its own MCP server: which it is handed, and the tools each lists and calls, on the member's own grants.
 *
 * A native harness's agent is handed each connection as an MCP server of
 * its own at the service (`../agents/workspace-mcp/app.ts`), the way Claude Code and
 * Codex take any remote server: its launch names one server per connection
 * (`nativeAgentConnections`), and each server lists the provider's own tools
 * and forwards a call of one, which is this door.
 *
 * The connections are the ones a coding agent's turn is handed
 * (`turnServers`): every integration this deployment offers the caller but
 * those switched off for the agent, and those the native turn under way
 * took as mentions. Every request reads them afresh, so a switch turned off
 * after the launch lists no tools and refuses a call from the next request.
 * Each request reads the connection's grant afresh for the member acting in
 * the conversation from the store (`integrationGrant`), so a Disconnect
 * takes effect at the next request.
 *
 * A token is asked of Vercel Connect only when it is used, as Connect's docs
 * say: the harness lists every server's tools at each launch, for tools the
 * agent may never call, so a server's list is answered from the one kept on
 * its grant (`integration-tool-store.ts`), and only a grant that keeps none,
 * or one listed more than `TOOLS_KEPT` ago, is listed live on its token and
 * kept. A call reads the token and opens one MCP session to the provider's
 * own server (`mcp-tools.ts`), which lists the tools before calling one, so
 * every call keeps its grant's list current at no further ask. A token the
 * provider refuses is dropped from Connect's in-process cache and read once
 * more (`evictGrantToken`), never forced fresh on every read. A grant
 * revoked at the provider that we have not yet seen lists its kept tools,
 * and its first call answers why.
 *
 * A teammate's words never drive the starter's accounts: while the newest
 * message to the agent is another member's, or another account's agent's
 * (`ledByAnotherAccount`), every call is refused with why, read again at
 * each call, so a teammate's steer mid-turn stops the next call and the
 * starter's own next message lets them through again. The tools are still
 * listed, because a list carries no account's data and a warm runner lists
 * them only as it launches.
 *
 * A Manager, shared across its workspace, acts instead for whoever asked
 * where its workspace has Managers act for whoever asked on
 * (`EXPERIMENT.MANAGER_ACTS_FOR_ASKER`): each call is read under the member
 * who asked for its turn under way (`turnAsker`), read again at each call,
 * on their own grant under the connection's name, and never falls back to
 * the owner's; one who has not connected it is refused with the sentence
 * that says how. That rule stands in place of the lockout, since no call
 * runs on another member's accounts. Its servers and their tools stay its
 * owner's, listed at launch as for any agent, so the tools a session lists
 * never change with who asks, and the model's prompt keeps its cache; a
 * provider its owner lists no tools for is one no asker reaches through it.
 *
 * The app's account settings are where an integration is connected, so
 * nothing here starts a sign-in: a connection the member has not
 * connected, or whose grant expired, lists no tools, and a call of it is
 * refused with `requiresSignIn` and the sentence that says how to connect it.
 *
 * Every upstream read is bounded: the token's read, and the provider's
 * session (`mcp-tools.ts`'s own bounds), so a slow provider costs its own
 * server its tools and never holds the agent's start; a list that fails
 * lists no tools and logs one line naming the connection and the failure's
 * kind.
 *
 * The bearer goes to the provider's server and nowhere else: no answer, no
 * refusal, and no log line here carries it, and a server's own error
 * message is kept only where nothing in it is shaped like a credential
 * (`mcp-tools.ts`). What a provider's tool answers reaches the agent
 * whole, as `AGENTS.md`'s carve-out for integrations allows.
 *
 * The door does not check a call's input against the tool's schema before
 * calling it: the provider's server checks it, and its refusal is the
 * call's error.
 */

import type { DatabaseServices, StoreFailure } from "@repo/database/core/query";
import { readAgentOfConversation } from "@repo/database/models/agent-store";
import { ledByAnotherAccount } from "@repo/database/models/machine-command-store";
import { readNativeProjection } from "@repo/database/models/native-projection-store";
import { turnAsker } from "@repo/database/models/turn-asker";
import { AGENT_KIND } from "@repo/features/agent-wire";
import type { IntegrationProvider } from "@repo/features/integration-wire";
import { causeKind } from "@repo/runtime/effect";
import { EXPERIMENT } from "@repo/settings";
import { isRecord, type WireRecord } from "@repo/wire";
import { DateTime, Duration, Effect, Option, Result } from "effect";
import type { HttpClient } from "effect/http";
import { CONNECTION_POLICY } from "../agents/agent-runtime/role.js";
import { type HandedConnection, turnServers } from "../agents/agent-runtime/servers.js";
import { heldProjection, turnServersOf } from "../agents/native-events/native-projection.js";
import type { AdmittedConversation } from "../agents/sessions/admitted-conversation.js";
import { experimentOnIn } from "../agents/workspace-experiment-on.js";
import { ACTION_RESULT_STATUS } from "../core.js";
import type { GitHubApp } from "../github/github-app.js";
import type { IntegrationConnect } from "./integration-connect.js";
import {
  evictGrantToken,
  grantAccessToken,
  type IntegrationAdmission,
  type IntegrationGrantRef,
  integrationGrant,
  integrationUnavailable,
} from "./integration-token.js";
import { readStoredTools, storeTools } from "./integration-tool-store.js";
import { INTEGRATION, integrationInstructions } from "./integrations.js";
import {
  callMcpTool,
  listMcpToolSchemas,
  MCP_TOOLS_FAILURE,
  type McpToolSchema,
  type McpToolsFailure,
} from "./mcp-tools.js";

/** What the door runs against, every one of which a web function's runtime provides. */
export type ConnectionDoorServices =
  | DatabaseServices
  | IntegrationConnect
  | GitHubApp
  | HttpClient.HttpClient;

/**
 * How long reading a connection's token may take, past which the
 * connection is taken as unreachable: the token is read from Vercel Connect,
 * an upstream of its own.
 */
const GRANT_TIMEOUT = Duration.seconds(10);

/**
 * How long a grant's kept list answers its server's listing before it is
 * listed live again: long enough that a launch almost never asks Connect for
 * a token, short enough that a tool a provider adds reaches an agent that
 * never calls that integration within the week.
 */
const TOOLS_KEPT = Duration.days(7);

/**
 * How long listing one connection's tools may take whole, its grant's read
 * included: under the time Codex gives a server to start
 * (`agent-runner/src/codex.ts`), so a slow provider's server answers no
 * tools rather than being failed by the harness.
 */
const LIST_TIMEOUT = Duration.seconds(10);

/**
 * Why a call ran nothing while a teammate leads the agent
 * (`ledByAnotherAccount`): its integrations are its starter's own accounts,
 * which another member's words never drive. A Manager is never taken over, so
 * the words say so rather than offering a takeover it has none of.
 */
const LED_BY_TEAMMATE =
  "Not run: this agent's integrations are its starter's own accounts, and they are off while " +
  "the newest message to it is a teammate's. They come back once its starter writes to it " +
  "again. Carry on without them. If this agent works on a task, tell the teammate they can take " +
  "it over to go on with their own integrations; a Manager is never taken over, so its " +
  "integrations stay its owner's and are simply off while a teammate leads it.";

/** A refusal: the words the call is failed with, and, for a connection the member must connect, which and that it must. */
export interface ConnectionRefusal {
  readonly status: typeof ACTION_RESULT_STATUS.REJECTED;
  readonly error: string;
  readonly connection?: string;
  readonly requiresSignIn?: true;
}

/** What a call of a connection's tool answered: the provider's own MCP result, as it sent it, or why there is none. */
type ConnectionCall = Result.Result<WireRecord, ConnectionRefusal>;

function refused(error: string, extra: Partial<ConnectionRefusal> = {}): ConnectionRefusal {
  return { status: ACTION_RESULT_STATUS.REJECTED, error, ...extra };
}

/** The admission the reads run under: the conversation the runner's bearer admitted. */
function admissionOf(admitted: AdmittedConversation): IntegrationAdmission {
  return Effect.succeed(Result.succeed(admitted));
}

/** Who a call of an integration's tool acts for: the conversation admitted under that account, and whether it is the asker of a Manager's turn rather than the agent's starter. */
interface CallActor {
  readonly admitted: AdmittedConversation;
  readonly forAsker: boolean;
}

/**
 * Who a call acts for, as the module says: for a Manager whose workspace has
 * Managers act for whoever asked on, the member who asked for its turn under
 * way (`turnAsker`), its owner standing in where no member did; for every
 * other agent, the starter the runner's bearer admitted. A read that fails
 * fails the call rather than falling back to the owner.
 */
function callActor(
  admitted: AdmittedConversation,
): Effect.Effect<CallActor, StoreFailure, DatabaseServices> {
  return Effect.gen(function* () {
    const starter: CallActor = { admitted, forAsker: false };
    const { userId, conversationId } = admitted.target;
    const agent = yield* readAgentOfConversation(userId, conversationId);

    if (Option.isNone(agent) || agent.value.kind !== AGENT_KIND.MANAGER) return starter;

    if (!(yield* experimentOnIn(agent.value.organizationId, EXPERIMENT.MANAGER_ACTS_FOR_ASKER))) {
      return starter;
    }

    const asker = yield* turnAsker(admitted.target);

    return { admitted: { ...admitted, caller: asker }, forAsker: true };
  });
}

/**
 * The servers the native turn under way took as it started, mentioned to
 * the agent since its last turn (`native-events/runner-events-app.ts`),
 * which its calls are handed whatever the switches say; none where none was taken, or where the projection cannot be read,
 * so a passing store failure costs the call a mention, never a switch.
 */
function turnMentionsOf(
  admitted: AdmittedConversation,
): Effect.Effect<readonly string[], never, DatabaseServices> {
  return readNativeProjection(admitted.target).pipe(
    Effect.map(
      Option.match({
        onNone: (): readonly string[] => [],
        onSome: (saved) => turnServersOf(heldProjection(saved)),
      }),
    ),
    Effect.catchCause((cause) =>
      Effect.as(
        Effect.logWarning(`a native turn's mentioned servers were not read: ${causeKind(cause)}`),
        [],
      ),
    ),
  );
}

/** The connections a coding agent's turn is handed. */
function handedConnections(
  admitted: AdmittedConversation,
): Effect.Effect<readonly HandedConnection[], never, ConnectionDoorServices> {
  return Effect.map(
    Effect.flatMap(turnMentionsOf(admitted), (mentioned) =>
      turnServers(admissionOf(admitted), CONNECTION_POLICY.AGENT_SWITCHES, mentioned),
    ),
    (standing) => (standing.on ? standing.connections : []),
  );
}

/** The one connection named, where the agent is handed it. */
function handedConnection(
  admitted: AdmittedConversation,
  name: string,
): Effect.Effect<Option.Option<HandedConnection>, never, ConnectionDoorServices> {
  return Effect.map(handedConnections(admitted), (handed) =>
    Option.fromUndefinedOr(handed.find((each) => each.connectionName === name)),
  );
}

/** Whether a token read's sentence is one the member answers by connecting the integration again in settings. */
function asksSignIn(provider: IntegrationProvider, sentence: string): boolean {
  const sentences = integrationUnavailable(provider);

  return [sentences.NOT_CONNECTED, sentences.EXPIRED].includes(sentence);
}

/** A refusal of the connection for a grant or token read's sentence, saying the member must connect it where the sentence asks that. */
function refusedFor(connection: HandedConnection, sentence: string): ConnectionRefusal {
  return refused(sentence, {
    connection: connection.connectionName,
    ...(asksSignIn(connection.provider, sentence) && { requiresSignIn: true as const }),
  });
}

/**
 * The line a listing refused its grant or token logs: a warning, but where
 * the member must only connect the integration (again), which is their
 * account's state and would be repeated by every launch, at debug.
 */
function noToolsLogged(name: string, refusal: ConnectionRefusal): Effect.Effect<void> {
  const line = `integration server ${name} lists no tools: ${refusal.error}`;

  return refusal.requiresSignIn ? Effect.logDebug(line) : Effect.logWarning(line);
}

/** The account the connection names, as the token reads take it. */
function accountOf({ provider, connectionName, instanceKey }: HandedConnection) {
  return { provider, connectionName, connectSubject: instanceKey };
}

/** The grant the connection's token is read on for the member acting in the conversation, or why there is none, read from the store alone. */
function connectionGrant(
  admitted: AdmittedConversation,
  connection: HandedConnection,
): Effect.Effect<
  Result.Result<IntegrationGrantRef, ConnectionRefusal>,
  never,
  ConnectionDoorServices
> {
  return Effect.map(
    integrationGrant(accountOf(connection), admissionOf(admitted)),
    Result.mapError((sentence) => refusedFor(connection, sentence)),
  );
}

/** The bearer on the grant (`grantAccessToken`), or why there is none, read within its bound. */
function grantToken(
  connection: HandedConnection,
  grant: IntegrationGrantRef,
): Effect.Effect<Result.Result<string, ConnectionRefusal>, never, ConnectionDoorServices> {
  const { connectionName } = connection;

  return grantAccessToken(grant).pipe(
    Effect.map((answer) =>
      Result.isSuccess(answer)
        ? Result.succeed(answer.success.token)
        : Result.fail(refusedFor(connection, answer.failure)),
    ),
    Effect.timeoutOrElse({
      duration: GRANT_TIMEOUT,
      orElse: () =>
        Effect.succeed(
          Result.fail(
            refused(`Failed to reach "${connectionName}": its credential could not be read.`, {
              connection: connectionName,
            }),
          ),
        ),
    }),
  );
}

/**
 * One session's work with the provider on the grant's token: where the
 * provider refuses the token, it is dropped from Connect's cache and the
 * work runs once more on the token read next, as Connect's docs say, and a
 * second refusal is the answer. Answers why no token could be read, or the
 * work's own answer.
 */
function onGrantToken<A>(
  connection: HandedConnection,
  grant: IntegrationGrantRef,
  work: (token: string) => Effect.Effect<A, McpToolsFailure, ConnectionDoorServices>,
): Effect.Effect<
  Result.Result<Result.Result<A, McpToolsFailure>, ConnectionRefusal>,
  never,
  ConnectionDoorServices
> {
  const attempt = Effect.gen(function* () {
    const bearer = yield* grantToken(connection, grant);

    if (Result.isFailure(bearer)) return Result.fail(bearer.failure);

    return Result.succeed(yield* Effect.result(work(bearer.success)));
  });

  return Effect.flatMap(attempt, (first) => {
    if (Result.isFailure(first)) return Effect.succeed(first);
    const done = first.success;

    const refusedByProvider =
      Result.isFailure(done) && done.failure.reason === MCP_TOOLS_FAILURE.REFUSED;

    return refusedByProvider
      ? Effect.andThen(evictGrantToken(grant), attempt)
      : Effect.succeed(first);
  });
}

/** Keeps the tools a read begun at `from` listed on the grant (`storeTools`); a store that cannot be written costs the next listing a live read, never this request. */
function keepTools(
  name: string,
  grant: IntegrationGrantRef,
  tools: readonly McpToolSchema[],
  from: Date,
): Effect.Effect<void, never, ConnectionDoorServices> {
  return storeTools(grant, tools, from).pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning(`integration server ${name}'s tools were not kept: ${causeKind(cause)}`),
    ),
  );
}

/** Why a session with a provider's server failed, in words that name nothing of its bearer. */
function sessionFailed(connectionName: string, doing: string, failure: McpToolsFailure): string {
  if (failure.reason === MCP_TOOLS_FAILURE.REFUSED) {
    return `Authorization failed for "${connectionName}": the service refused the connection's credential.`;
  }

  const said = failure.serverMessage === undefined ? "" : `: ${failure.serverMessage}`;

  return `Failed to ${doing} "${connectionName}": the service was ${failure.reason}${said}.`;
}

/**
 * What the model is told of one connection the agent is handed: the integration's description and, where the member holds more
 * than one account there, the note naming which account this one is, so the
 * agent can pick the account the developer named; nothing for a connection
 * it is not handed. Its server answers it as its `initialize`'s
 * `instructions`, which the harness shows the model beside the server's
 * tools.
 */
export function connectionInstructions(
  admitted: AdmittedConversation,
  name: string,
): Effect.Effect<Option.Option<string>, never, ConnectionDoorServices> {
  return Effect.map(
    handedConnection(admitted, name),
    Option.map(({ provider, accountNote }) => integrationInstructions(provider, accountNote)),
  );
}

/**
 * The names of the connections a native agent is handed as its launch
 * starts, one MCP server each; none where they cannot be read, so a passing
 * failure costs the launch its integrations, never the launch.
 */
export function nativeAgentConnections(
  admitted: AdmittedConversation,
): Effect.Effect<readonly string[], never, ConnectionDoorServices> {
  return Effect.map(handedConnections(admitted), (handed) =>
    handed.map((each) => each.connectionName),
  );
}

/**
 * The tools one connection's provider lists for the member, as it listed
 * them, within `LIST_TIMEOUT`: the list kept on the connection's grant
 * while it is younger than `TOOLS_KEPT`, so listing asks Connect for no
 * token, and otherwise the provider's own list on the grant's token, kept
 * for the next listing. A connection the agent is not handed lists none,
 * and so does one whose grant or list failed, with one log line naming the
 * connection and why in words that carry no credential, a warning but for
 * a connection the member must connect (`noToolsLogged`).
 */
export function listConnectionTools(
  admitted: AdmittedConversation,
  name: string,
): Effect.Effect<readonly McpToolSchema[], never, ConnectionDoorServices> {
  const listed = Effect.gen(function* () {
    const connection = yield* handedConnection(admitted, name);

    if (Option.isNone(connection)) return [];
    const grant = yield* connectionGrant(admitted, connection.value);

    if (Result.isFailure(grant)) {
      yield* noToolsLogged(name, grant.failure);

      return [];
    }

    const from = yield* DateTime.nowAsDate;
    const kept = yield* readStoredTools(grant.success);

    if (
      kept !== undefined &&
      from.getTime() - kept.listedAt.getTime() < Duration.toMillis(TOOLS_KEPT)
    ) {
      return kept.tools;
    }

    const url = INTEGRATION[connection.value.provider].MCP_URL;

    const read = yield* onGrantToken(connection.value, grant.success, (token) =>
      listMcpToolSchemas(url, token),
    );

    if (Result.isFailure(read)) {
      yield* noToolsLogged(name, read.failure);

      return [];
    }

    const tools = read.success;

    if (Result.isSuccess(tools)) {
      yield* keepTools(name, grant.success, tools.success, from);

      return tools.success;
    }

    yield* Effect.logWarning(
      `integration server ${name} lists no tools: ${sessionFailed(name, "load tools for", tools.failure)}`,
    );

    return [];
  });

  return listed.pipe(
    Effect.timeoutOrElse({
      duration: LIST_TIMEOUT,
      orElse: () =>
        Effect.as(Effect.logWarning(`integration server ${name} lists no tools: timed out`), []),
    }),
    Effect.catchCause((cause) =>
      Effect.as(
        Effect.logWarning(`integration server ${name} lists no tools: ${causeKind(cause)}`),
        [],
      ),
    ),
  );
}

/**
 * One call of a connection's tool with its input, on the own grant of the
 * member it acts for (`callActor`): the provider's MCP result as it sent
 * it, its own error among them. A connection the agent is not handed, one
 * the member has not connected, a tool the server lists none of, a session
 * that failed, and, but for a Manager acting for whoever asked, every call
 * while a teammate leads the agent (`LED_BY_TEAMMATE`) are each refused. The
 * tools the session listed are kept on the grant, so the next launch's
 * listing shows what the provider lists now.
 */
export function callConnectionTool(
  admitted: AdmittedConversation,
  name: string,
  tool: string,
  input: WireRecord,
): Effect.Effect<ConnectionCall, never, ConnectionDoorServices> {
  return Effect.gen(function* () {
    // Note that who the call acts for is read at each call, because each turn of a Manager may be another member's.
    const actor = yield* callActor(admitted);
    const connection = yield* handedConnection(actor.admitted, name);

    if (Option.isNone(connection)) {
      return Result.fail(refused(`Connection "${name}" is not available to this agent.`));
    }

    // Note that the lead is read at each call, because a teammate may steer a turn the starter began.
    if (!actor.forAsker && (yield* ledByAnotherAccount(admitted.target))) {
      return Result.fail(refused(LED_BY_TEAMMATE, { connection: name }));
    }

    const grant = yield* connectionGrant(actor.admitted, connection.value);

    if (Result.isFailure(grant)) return Result.fail(grant.failure);
    const from = yield* DateTime.nowAsDate;
    const url = INTEGRATION[connection.value.provider].MCP_URL;

    const read = yield* onGrantToken(connection.value, grant.success, (token) =>
      callMcpTool(url, token, tool, input),
    );

    if (Result.isFailure(read)) return Result.fail(read.failure);
    const call = read.success;
    const listed = Result.isSuccess(call) ? call.success.tools : call.failure.listed;

    if (listed !== undefined) yield* keepTools(name, grant.success, listed, from);

    if (Result.isFailure(call)) {
      return Result.fail(refused(sessionFailed(name, "call a tool of", call.failure)));
    }

    if (!call.success.called) {
      return Result.fail(refused(`Connection "${name}" has no tool named "${tool}".`));
    }

    const { result } = call.success;

    if (!isRecord(result)) {
      return Result.fail(
        refused(`Failed to call a tool of "${name}": the service was unreadable.`),
      );
    }

    return Result.succeed(result);
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.as(
        Effect.logWarning(`integration server ${name} call failed: ${causeKind(cause)}`),
        Result.fail(
          refused("This integration could not be reached just now; try again in a moment."),
        ),
      ),
    ),
  );
}
