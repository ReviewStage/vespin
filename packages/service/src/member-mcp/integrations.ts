/**
 * integrations.ts -- the member's own integrations, the outside MCP clients they allowed, and their workspaces' Sentry, as an outside agent acting for them reads and ends them: through the operations the window's own procedures run.
 *
 * Every call runs the operation its hosted procedure runs, on the admitted
 * member, so it answers what Settings › Integrations and Settings › MCP
 * answer them and refuses what those refuse: the integrations read and
 * settled as the desktop's bearer reads them (`statusesAnswer`), an account
 * at a provider signed in, named, or disconnected
 * (`integrations-procedures.ts`), the clients listed
 * (`clients-procedures.ts`), and a workspace's Sentry installations read by
 * any member of it and one disconnected by an owner or an admin
 * (`../triggers/sentry/sentry-installations.ts`).
 *
 * A sign-in is never run here: a connect answers the address the member
 * opens in their own browser to finish it, at the deployment's own callback,
 * as the desktop's Connect does. Revoking a client, which deletes the
 * member's consent under a session of theirs, is not offered. Root
 * AGENTS.md pins that no credential travels in an answer, and none of these
 * carries one: each answers status words, names, labels, and the sign-in
 * address, never a token.
 */

import { MEMBER_MCP_TOOL } from "@repo/features/member-mcp-tool";
import { Effect } from "effect";
import { agentToolRejected } from "../agents/agent-tools.js";
import { ACTION_RESULT_STATUS, HOSTED_API_ERROR } from "../core.js";
import type { HostedRefusal } from "../http/http-effect.js";
import { integrationAccountSeams } from "../integrations/integration-account-seams.js";
import {
  beginConnect,
  disconnectAccount,
  renameAccount,
  requestedAccount,
  statusesAnswer,
  type UnnamedHold,
} from "../integrations/integrations-procedures.js";
import {
  disconnectWorkspaceSentry,
  readWorkspaceSentry,
} from "../triggers/sentry/sentry-installations.js";
import { AdmittedMember } from "./admission.js";
import { mcpClientsRead } from "./mcp-client-operations.js";
import { memberMcpResourceUrl } from "./resource.js";

/**
 * The accounts whose provider lately answered no name, held for as long as
 * this instance stands, as the procedures' own hold is, so a provider that
 * keeps failing is asked again only once its hold has passed.
 */
const UNNAMED: UnnamedHold = new Map();

/** Why a call did nothing, in words for one acting for the member. */
const MEMBER_INTEGRATION_REFUSAL = {
  NO_ACCOUNT: `Not done: the member holds no such account; ${MEMBER_MCP_TOOL.LIST_INTEGRATIONS} names theirs, each by its connection.`,
  UNAVAILABLE:
    "Not done: that integration is not offered to the member on this deployment, it holds as " +
    "many accounts as it takes, it is GitHub, whose sign-in is the member's own, or it could " +
    "not be reached just now.",
  NO_WORKSPACE: "Not done: the member belongs to no such workspace.",
  NOT_PERMITTED: "Not done: only an owner or an admin of the workspace may disconnect its Sentry.",
  NO_INSTALLATION: `Not done: the workspace holds no such Sentry installation; ${MEMBER_MCP_TOOL.LIST_SENTRY_INSTALLATIONS} names its installations.`,
  UNANSWERED: "Not done: it could not be read or written just now; try again in a moment.",
} as const;

/** A refusal in the member's words: what it names not found in the words given, a role refused, and anything else not answered. */
function refusalWords(refusal: HostedRefusal, notFound: string): string {
  switch (refusal.error) {
    case HOSTED_API_ERROR.NOT_FOUND:
      return notFound;
    case HOSTED_API_ERROR.NOT_PERMITTED:
      return MEMBER_INTEGRATION_REFUSAL.NOT_PERMITTED;
    default:
      return MEMBER_INTEGRATION_REFUSAL.UNANSWERED;
  }
}

/** An operation's answer as the tool's, or its refusal in the words given. */
const accepted = <A extends object, R>(
  work: Effect.Effect<A, HostedRefusal, R>,
  notFound: string,
  unavailable: string = MEMBER_INTEGRATION_REFUSAL.UNANSWERED,
) =>
  work.pipe(
    Effect.map((answer): object => ({ status: ACTION_RESULT_STATUS.ACCEPTED, ...answer })),
    Effect.catch((refusal) =>
      Effect.succeed(
        agentToolRejected(
          refusal.error === HOSTED_API_ERROR.UNAVAILABLE
            ? unavailable
            : refusalWords(refusal, notFound),
        ),
      ),
    ),
  );

/** One account at a provider a call names: the provider its connection name is of, and that name. */
const namedAccount = (provider: string, connection: string | undefined) =>
  requestedAccount({ params: { provider }, query: { connection } });

/** Where every one of the member's integrations stands, each sign-in under way settled first, as the desktop's read settles it. */
export const listIntegrationsAsMember = () =>
  Effect.gen(function* () {
    const member = yield* AdmittedMember;
    return yield* accepted(
      statusesAnswer(integrationAccountSeams(), UNNAMED, member.userId, true),
      MEMBER_INTEGRATION_REFUSAL.NO_ACCOUNT,
    );
  });

/** What a connect names: the provider, the account to sign in again, or a new one. */
export interface IntegrationConnectAsked {
  readonly provider: string;
  readonly connection?: string | undefined;
  readonly add?: boolean | undefined;
}

/** The address the member opens in their browser to sign in to one account at a provider, and the account it signs in; the sign-in itself is theirs to finish. */
export const connectIntegrationAsMember = ({
  provider,
  connection,
  add,
}: IntegrationConnectAsked) =>
  Effect.gen(function* () {
    const member = yield* AdmittedMember;
    const work = Effect.flatMap(namedAccount(provider, connection), (asked) =>
      beginConnect(integrationAccountSeams(), member.userId, asked, add === true, member.baseURL),
    );
    // Note that the transaction is the window's to wait on, so the agent is answered the address and the account alone.
    return yield* accepted(
      Effect.map(work, ({ url, connection: signedIn }) => ({ url, connection: signedIn })),
      MEMBER_INTEGRATION_REFUSAL.NO_ACCOUNT,
      MEMBER_INTEGRATION_REFUSAL.UNAVAILABLE,
    );
  });

/** One of the member's accounts named as they call it, answered as it then stands. */
export const renameIntegrationAsMember = (provider: string, connection: string, label: string) =>
  Effect.gen(function* () {
    const member = yield* AdmittedMember;
    const work = Effect.flatMap(namedAccount(provider, connection), (asked) =>
      renameAccount(integrationAccountSeams(), member.userId, asked, label),
    );
    return yield* accepted(
      Effect.map(work, ({ account }) => ({ account })),
      MEMBER_INTEGRATION_REFUSAL.NO_ACCOUNT,
    );
  });

/** One of the member's accounts disconnected, its grant revoked, answered as the provider then stands for it. */
export const disconnectIntegrationAsMember = (provider: string, connection: string) =>
  Effect.gen(function* () {
    const member = yield* AdmittedMember;
    const work = Effect.flatMap(namedAccount(provider, connection), (asked) =>
      disconnectAccount(integrationAccountSeams(), member.userId, asked),
    );
    return yield* accepted(
      Effect.map(work, (answer) => ({ connection, standing: answer.status })),
      MEMBER_INTEGRATION_REFUSAL.NO_ACCOUNT,
      MEMBER_INTEGRATION_REFUSAL.UNAVAILABLE,
    );
  });

/** The outside MCP clients the member allowed, as Settings › MCP lists them, with this server's address. */
export const listMcpClientsAsMember = () =>
  Effect.gen(function* () {
    const member = yield* AdmittedMember;
    return yield* accepted(
      mcpClientsRead(member.userId, memberMcpResourceUrl(member.baseURL)),
      MEMBER_INTEGRATION_REFUSAL.UNANSWERED,
    );
  });

/** A workspace's Sentry, to any member of it: whether this deployment offers it, and the installations linked. */
export const readSentryAsMember = (userId: string, workspaceId: string) =>
  accepted(readWorkspaceSentry(userId, workspaceId), MEMBER_INTEGRATION_REFUSAL.NO_WORKSPACE);

/** One of a workspace's Sentry installations disconnected by an owner or an admin of it, answered with the installations left. */
export const disconnectSentryAsMember = (
  userId: string,
  workspaceId: string,
  installationId: string,
) =>
  accepted(
    Effect.map(
      disconnectWorkspaceSentry(userId, workspaceId, installationId),
      ({ configured, installations }) => ({ configured, installations }),
    ),
    MEMBER_INTEGRATION_REFUSAL.NO_INSTALLATION,
  );
