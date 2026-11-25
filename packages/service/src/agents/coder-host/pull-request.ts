import type { DatabaseServices } from "@repo/database/core/query";
import {
  type AgentRepositoryEntry,
  readAgentRepositories,
  recordAgentRepositoryHead,
} from "@repo/database/models/agent-repositories";
import {
  type Agent,
  recordAgentAuthor,
  updateAgentBranch,
  type WithRepository,
} from "@repo/database/models/agent-store";
import { type ManagerAssignee, managerAssigneeOf } from "@repo/database/models/manager-assignee";
import { turnAsker } from "@repo/database/models/turn-asker";
import { readAccountNames } from "@repo/database/models/workspace-store";
import type { ConversationTarget } from "@repo/database/models/writer";
import { AGENT_TOOL } from "@repo/features/agent-tools";
import { AGENT_AUTHOR, AGENT_KIND, type AgentAuthor } from "@repo/features/agent-wire";
import {
  GITHUB_ACCESS,
  githubRepositoryFullNameSchema,
} from "@repo/features/github-repositories-wire";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { ACTION_RESULT_STATUS, EXCESS_KEYS, type UnparsedWireValue } from "@repo/wire";
import { describeWire, readEither } from "@repo/wire/effect";
import { Effect, Option, Result, Schema } from "effect";
import {
  recordServerEvent,
  SERVER_EVENT,
  SERVER_PULL_REQUEST_OPENER,
} from "../../events/server-events.js";
import {
  GitHubApp,
  type GitHubBearer,
  githubRead,
  repositoryParts,
} from "../../github/github-app.js";
import { agentRepositoryToken, type CheckoutServices } from "./checkout.js";
import { agentPublished } from "./published.js";

/**
 * pull-request.ts -- the coding agent's `open_pull_request` tool: its pull request opened by the service, as the developer it writes as, or as the App.
 *
 * An agent that writes as its developer (`checkout.ts`) has its pull request
 * opened by the service on the developer's own GitHub App token, read from
 * their sign-in where it is sealed, in one call to GitHub (`POST
 * /repos/{owner}/{name}/pulls`) on the agent's own repository and nowhere
 * else. The token never reaches the sandbox, whose firewall carries the
 * App's token alone, because the sandbox is the workspace's: any member may
 * steer the agent or open a terminal in it, and a developer's token reaches
 * every repository they and the App reach. So the most a teammate can do
 * through the agent as the developer is open a pull request on its one
 * repository. An agent that writes as the App has its pull request opened
 * on the App's token for that repository, as every push already goes. An
 * agent on its starter's own GitHub token, which no installation reaches
 * the repository for, has it opened on that token alone, as them, and a
 * refusal of the token opens nothing.
 *
 * Where GitHub refuses the developer's token, or their sign-in no longer
 * yields one, the pull request is opened as the App instead and the agent's
 * row records why (`recordAgentAuthor`), so the Changes tab says it and
 * the agent's later pull requests go out as the App without asking again;
 * the agent is told, so it can tell the developer. A refusal of the pull
 * request itself, such as one already open from the branch, is the agent's
 * to read and opens nothing. The description is the agent's own, with no
 * line of ours added: where its author is a person, the trailer on its
 * commits (`checkout.ts`) names our bot as co-author, which GitHub shows
 * on the pull request, as it does for Claude Code. It merges into the base
 * the agent names, which every call states: its start branch, the
 * repository's default branch, or the branch of the pull request it stacks
 * on; a base GitHub does not know is refused like any other. Once GitHub opens it, its branch and the pull
 * request are written on the agent's row at once rather than only as the
 * turn ends, so a comment on it finds the agent (`github/agent-wakes.ts`);
 * a refused call moves nothing.
 *
 * Every call names the repository it opens in, its own or one it works in
 * beside it (`readAgentRepositories`), refused with their names where it
 * names none or one it does not work in, so no call opens in a repository
 * the agent did not mean. A pull
 * request in an extra repository opens on the one token minted for the
 * agent's set, against the base it names, and its head is written on that
 * repository's row rather than the agent's (`recordAgentRepositoryHead`),
 * so GitHub's deliveries about it find the agent as they find its own.
 *
 * An agent a Manager started, on a task assigned to another member of its
 * workspace than the Manager's owner (`managerAssigneeOf`), opens its pull
 * request as that assignee, on their own sign-in's token, read in the
 * service as the developer's is above and never handed to the sandbox. So
 * whoever may assign a task a Manager's agent works on may have a pull
 * request opened under the assignee's GitHub account, on the agent's one
 * repository. Where their sign-in yields nothing GitHub takes, the App opens
 * it, its description ending on "Requested by" them, and nothing is
 * recorded on the agent's row, whose author stays the owner's. Commits, the
 * agent's account, and who pays are unchanged.
 *
 * A Manager's own pull request, in a turn another member than its owner
 * asked for (`turnAsker`), opens the same way as that asker: on their own
 * sign-in's token, else as the App with its description ending on
 * "Requested by" them, and never on the owner's token, so one member's ask
 * never goes out under another's GitHub account. A turn its owner asked
 * for, or one no member asked for, opens as it always did. Its commits stay
 * on the Manager's settled author.
 */

/** GitHub's own bounds on what a pull request carries. */
const PULL_REQUEST_BOUNDS = {
  MAX_TITLE_CHARS: 256,
  MAX_BODY_CHARS: 65_536,
  MAX_BRANCH_CHARS: 255,
  /** The most of GitHub's own words on a refusal the agent is told. */
  MAX_REFUSAL_CHARS: 500,
} as const;

const openPullRequestInputSchema = Schema.Struct({
  head: Schema.Trim.check(
    Schema.isNonEmpty(),
    Schema.isMaxLength(PULL_REQUEST_BOUNDS.MAX_BRANCH_CHARS),
  ),
  title: Schema.Trim.check(
    Schema.isNonEmpty(),
    Schema.isMaxLength(PULL_REQUEST_BOUNDS.MAX_TITLE_CHARS),
  ),
  body: Schema.String.check(Schema.isMaxLength(PULL_REQUEST_BOUNDS.MAX_BODY_CHARS)),
  draft: describeWire(
    Schema.Boolean,
    "false to open it ready for review, as is usual so checks and review start at once; true to open it as a draft.",
  ),
  base: Schema.Trim.check(
    Schema.isNonEmpty(),
    Schema.isMaxLength(PULL_REQUEST_BOUNDS.MAX_BRANCH_CHARS),
  ),
  repository: describeWire(
    githubRepositoryFullNameSchema,
    "The repository to open it in, as owner/name: your own, which your own values in your instructions name, or another you work in beside it.",
  ),
});

type OpenPullRequestInput = typeof openPullRequestInputSchema.Type;

/** A pull request as GitHub's API takes one to open: the branch, the branch it merges into, and its words. */
interface PullRequestAsked {
  readonly head: string;
  readonly base: string;
  readonly title: string;
  readonly body: string;
  readonly draft: boolean;
}

/** The tool as a coding agent is offered it: its name, its words, and its input. */
export const OPEN_PULL_REQUEST_TOOL = {
  name: AGENT_TOOL.OPEN_PULL_REQUEST,
  description:
    "Open the pull request for a branch you pushed: head is the branch, body its description in Markdown, and base the branch it " +
    "merges into: the branch your own values name, else the repository's default branch, or the parent's branch for a stacked pull request; " +
    "draft false opens it ready for review, true as a draft. " +
    `Use this rather than \`gh pr create\`: it opens as the developer who started you where you write as them, and as ${PRODUCT_NAME}'s GitHub ` +
    "App otherwise, and adds nothing to the description. Where GitHub refuses the developer's own access, it opens as the App " +
    "and the answer says so, and your later pull requests open as the App too; tell the developer, who can sign in with GitHub again. " +
    "Comments and reviews on the pull request then reach you as messages.",
  inputSchema: openPullRequestInputSchema,
} as const;

/** Why a call opened nothing, in the words the model reads. */
const PULL_REQUEST_REFUSAL = {
  UNAVAILABLE: "Not opened: GitHub could not be reached. The call may be made again.",
  RATE_LIMITED:
    "Not opened: GitHub is limiting how fast requests may come. Make the call again in a minute.",
  TOKEN_REFUSED:
    "Not opened: GitHub refused the developer's own GitHub token on this repository. Tell them.",
} as const;

/** The repositories the agent works in, as a refusal lists them. */
function listedRepositories(repositories: readonly AgentRepositoryEntry[]): string {
  return repositories.map((each) => `\`${each.repository}\``).join(", ");
}

/** Why a call missing a field, or naming one out of bounds, opened nothing, listing the repositories it may name. */
function unreadableRefusal(repositories: readonly AgentRepositoryEntry[]): string {
  return (
    `Not opened: the call needs head, title, body, repository, base, and draft, the title at most ${PULL_REQUEST_BOUNDS.MAX_TITLE_CHARS} characters, ` +
    `repository one you work in: ${listedRepositories(repositories)}, and base the branch it merges into: ` +
    "the branch your own values name, else the repository's default branch, or the parent's branch for a stacked pull request, " +
    "and draft false to open it ready for review or true to open it as a draft."
  );
}

/** Why a call naming a repository the agent does not work in opened nothing, listing those it works in. */
function repositoryRefusal(repositories: readonly AgentRepositoryEntry[]): string {
  return `Not opened: name the repository to open it in as repository, one you work in: ${listedRepositories(repositories)}.`;
}

/** Why a call opened nothing where the service could not reach GitHub or its store. */
export const PULL_REQUEST_UNAVAILABLE = PULL_REQUEST_REFUSAL.UNAVAILABLE;

/** Who a pull request the service opened is by. */
const OPENED_AS = {
  DEVELOPER: "developer",
  /** The member a Manager's agent's task is assigned to. */
  ASSIGNEE: "assignee",
  /** The member who asked for a Manager's turn. */
  ASKER: "asker",
  APP: "app",
} as const;

type OpenedAs = (typeof OPENED_AS)[keyof typeof OPENED_AS];

/** Who opened it, as the counted event names them. */
const OPENER_EVENT = {
  [OPENED_AS.DEVELOPER]: SERVER_PULL_REQUEST_OPENER.DEVELOPER,
  [OPENED_AS.ASSIGNEE]: SERVER_PULL_REQUEST_OPENER.ASSIGNEE,
  [OPENED_AS.ASKER]: SERVER_PULL_REQUEST_OPENER.ASKER,
  [OPENED_AS.APP]: SERVER_PULL_REQUEST_OPENER.APP,
} as const satisfies Record<OpenedAs, string>;

/** What a call answers, as the model reads it: the pull request opened and as whom, or why none was. */
export type PullRequestToolResult =
  | {
      readonly status: typeof ACTION_RESULT_STATUS.ACCEPTED;
      readonly url: string;
      readonly number: number;
      readonly openedAs: OpenedAs;
      readonly note?: string;
    }
  | { readonly status: typeof ACTION_RESULT_STATUS.REJECTED; readonly reason: string };

export function pullRequestRejected(reason: string): PullRequestToolResult {
  return { status: ACTION_RESULT_STATUS.REJECTED, reason };
}

/** What the agent is told where the App opened its pull request in the developer's place, by why. */
const FALLBACK_NOTE = {
  [AGENT_AUTHOR.APP_UNLINKED]:
    `Opened as ${PRODUCT_NAME}'s GitHub App: the developer's GitHub sign-in was refused. Tell them; signing in with GitHub again ` +
    "lets a later agent open its pull requests as them.",
  [AGENT_AUTHOR.APP_NO_PUSH]: `Opened as ${PRODUCT_NAME}'s GitHub App: the developer's own GitHub account may not open a pull request on this repository. Tell them.`,
} as const satisfies Partial<Record<AgentAuthor, string>>;

type FallbackReason = keyof typeof FALLBACK_NOTE;

const readInput = readEither(openPullRequestInputSchema, { excess: EXCESS_KEYS.DROP });

/** GitHub's answer to an opened pull request, read for its address and number. */
const OpenedSchema = Schema.Struct({ number: Schema.Int, html_url: Schema.String });

/** What GitHub answers a pull request it refuses, with its reason. */
const UNPROCESSABLE = 422;

/** How one attempt to open the pull request ended. */
const ATTEMPT = {
  OPENED: "opened",
  /** GitHub refused the token it went on, or the account behind it. */
  TOKEN_REFUSED: "token-refused",
  /** GitHub refused the pull request itself, or could not be reached. */
  REFUSED: "refused",
} as const;

type Attempt =
  | { readonly kind: typeof ATTEMPT.OPENED; readonly url: string; readonly number: number }
  | { readonly kind: typeof ATTEMPT.TOKEN_REFUSED; readonly reason: FallbackReason }
  | { readonly kind: typeof ATTEMPT.REFUSED; readonly reason: string };

/** An attempt that ended other than with its token refused. */
type Settled = Exclude<Attempt, { readonly kind: typeof ATTEMPT.TOKEN_REFUSED }>;

/** GitHub's refusal of the pull request in its own words (`@repo/github` names an error's field and code where it says none), cut to the bound. */
function refusalWords(words: string): string {
  return `Not opened: GitHub said: ${words.slice(0, PULL_REQUEST_BOUNDS.MAX_REFUSAL_CHARS)}`;
}

/**
 * One attempt to open the pull request on the bearer given. A token GitHub
 * will not take (`GitHubUnauthorized`), or whose account may not write the
 * repository (`GitHubForbidden`, or `GitHubNotFound` for a repository it
 * cannot see), is told apart from a refusal of the pull request itself,
 * which GitHub answers 422 with its reason, and from a rate limit, which
 * `@repo/github` tells apart from a 403 itself and which passes.
 */
const attempt = /* @__PURE__ */ Effect.fn("web/openPullRequestAttempt")(function* (
  bearer: GitHubBearer,
  fullName: string,
  pullRequest: PullRequestAsked,
): Effect.fn.Return<Attempt> {
  const opened = bearer.client.request("POST /repos/{owner}/{repo}/pulls", {
    ...repositoryParts(fullName),
    ...pullRequest,
  });

  return yield* githubRead(opened, OpenedSchema).pipe(
    Effect.map(
      (answer): Attempt => ({ kind: ATTEMPT.OPENED, url: answer.html_url, number: answer.number }),
    ),
    Effect.catchTags({
      GitHubUnauthorized: () =>
        Effect.succeed<Attempt>({ kind: ATTEMPT.TOKEN_REFUSED, reason: AGENT_AUTHOR.APP_UNLINKED }),
      GitHubForbidden: () =>
        Effect.succeed<Attempt>({ kind: ATTEMPT.TOKEN_REFUSED, reason: AGENT_AUTHOR.APP_NO_PUSH }),
      GitHubNotFound: () =>
        Effect.succeed<Attempt>({ kind: ATTEMPT.TOKEN_REFUSED, reason: AGENT_AUTHOR.APP_NO_PUSH }),
      GitHubRateLimited: () =>
        Effect.succeed<Attempt>({
          kind: ATTEMPT.REFUSED,
          reason: PULL_REQUEST_REFUSAL.RATE_LIMITED,
        }),
      GitHubRejected: (rejected) =>
        Effect.succeed<Attempt>({
          kind: ATTEMPT.REFUSED,
          reason:
            rejected.status === UNPROCESSABLE
              ? refusalWords(rejected.message)
              : PULL_REQUEST_REFUSAL.UNAVAILABLE,
        }),
    }),
    Effect.orElseSucceed(
      (): Attempt => ({ kind: ATTEMPT.REFUSED, reason: PULL_REQUEST_REFUSAL.UNAVAILABLE }),
    ),
  );
});

/**
 * The attempt on a member's own GitHub sign-in: the developer's, the
 * assignee of the task a Manager's agent works on, or the member who asked
 * for a Manager's turn. A sign-in that yields no token is
 * refused as their token would be; any other failure to read it refuses
 * the call, to be made again.
 */
const attemptAsMember = /* @__PURE__ */ Effect.fn("web/openPullRequestAsMember")(function* (
  target: ConversationTarget,
  userId: string,
  fullName: string,
  pullRequest: PullRequestAsked,
): Effect.fn.Return<Attempt, never, CheckoutServices> {
  const app = yield* GitHubApp;

  return yield* app.userToken(userId).pipe(
    Effect.flatMap((bearer) => attempt(bearer, fullName, pullRequest)),
    Effect.catchTag("GitHubSignInRequired", () =>
      Effect.succeed<Attempt>({
        kind: ATTEMPT.TOKEN_REFUSED,
        reason: AGENT_AUTHOR.APP_UNLINKED,
      }),
    ),
    Effect.catch((failure) =>
      Effect.as(
        Effect.logWarning(
          `A member's GitHub token for conversation ${target.conversationId} was not read: ${failure._tag}`,
        ),
        { kind: ATTEMPT.REFUSED, reason: PULL_REQUEST_REFUSAL.UNAVAILABLE } satisfies Attempt,
      ),
    ),
  );
});

/**
 * The attempt as the developer, where the agent writes as them, on their
 * own token; nothing for an agent that writes as the App. A sign-in that
 * yields no token is one GitHub no longer honors, and is refused as their
 * token would be; any other failure to read it, the store or GitHub's
 * refresh not answering, refuses the call to be made again, so a passing
 * outage never writes the developer out of their agent. Note that the
 * author is read off the row and never settled here, because an agent from
 * before the column, whose standing session and checkout are the App's,
 * must open as the App too.
 */
const attemptAsDeveloper = /* @__PURE__ */ Effect.fn("web/openPullRequestAsDeveloper")(function* (
  target: ConversationTarget,
  agent: Agent,
  fullName: string,
  pullRequest: PullRequestAsked,
): Effect.fn.Return<Attempt | undefined, never, CheckoutServices> {
  if (agent.author !== AGENT_AUTHOR.DEVELOPER) return undefined;

  return yield* attemptAsMember(target, target.userId, fullName, pullRequest);
});

/** The pull request with the line naming the member it was requested for at its foot, for the App to open in their place. */
function withRequestedBy(pullRequest: PullRequestAsked, member: ManagerAssignee): PullRequestAsked {
  const line = `Requested by ${member.name}.`;
  const body = pullRequest.body === "" ? line : `${pullRequest.body}\n\n${line}`;

  return { ...pullRequest, body };
}

/** What the agent is told where the App opened a pull request in the place of the member it was for. */
function memberFallbackNote(member: ManagerAssignee): string {
  return (
    `Opened as ${PRODUCT_NAME}'s GitHub App, the description ending on "Requested by ${member.name}.": ` +
    `their GitHub sign-in was refused or may not open a pull request on this repository. Tell them; signing in with GitHub again lets a later pull request open as them.`
  );
}

/**
 * An opening for another member than the agent's owner: a Manager's agent's
 * task assignee (`managerAssigneeOf`), or the asker of a Manager's own turn
 * (`turnAsker`). On the member's own sign-in where GitHub takes it, and as
 * the App otherwise, its description ending on who it was requested by.
 * Note that nothing is recorded on the agent's row, because its author is
 * the owner's standing, which the member's sign-in says nothing of.
 */
const attemptForMember = /* @__PURE__ */ Effect.fn("web/openPullRequestForMember")(function* (
  target: ConversationTarget,
  member: ManagerAssignee,
  openedAs: OpenedFor["openedAs"],
  app: GitHubBearer,
  fullName: string,
  pullRequest: PullRequestAsked,
): Effect.fn.Return<PullRequestToolResult, never, CheckoutServices> {
  const asMember = yield* attemptAsMember(target, member.userId, fullName, pullRequest);

  if (asMember.kind !== ATTEMPT.TOKEN_REFUSED) return answerOf(asMember, openedAs);
  const asApp = yield* attempt(app, fullName, withRequestedBy(pullRequest, member));

  if (asApp.kind === ATTEMPT.TOKEN_REFUSED) {
    return pullRequestRejected(PULL_REQUEST_REFUSAL.UNAVAILABLE);
  }

  return answerOf(asApp, OPENED_AS.APP, memberFallbackNote(member));
});

/** A member a pull request opens for in its owner's place, and what it is answered as opened as. */
interface OpenedFor {
  readonly member: ManagerAssignee;
  readonly openedAs: typeof OPENED_AS.ASSIGNEE | typeof OPENED_AS.ASKER;
}

/**
 * Who a pull request opens for in its owner's place: the assignee of a
 * Manager's agent's task, or the member who asked for a Manager's own turn,
 * where that is another than its owner; nothing where the owner's own
 * standing opens it. An asker whose name is not read fails, so the call
 * opens nothing rather than falling to the owner's token.
 */
const openedFor = /* @__PURE__ */ Effect.fn("web/pullRequestOpenedFor")(function* (
  target: ConversationTarget,
  agent: Agent,
) {
  if (agent.kind !== AGENT_KIND.MANAGER) {
    const assignee = yield* managerAssigneeOf(target.userId, agent.id);

    return Option.map(assignee, (member): OpenedFor => ({ member, openedAs: OPENED_AS.ASSIGNEE }));
  }

  const asker = yield* turnAsker(target);

  if (asker === target.userId) return Option.none<OpenedFor>();
  const name = yield* Effect.fromNullishOr((yield* readAccountNames([asker])).get(asker));

  return Option.some<OpenedFor>({ member: { userId: asker, name }, openedAs: OPENED_AS.ASKER });
});

/** The pull request GitHub is asked to open: the agent's branch against the base it named, its description as the agent wrote it. */
function pullRequestOf(input: OpenPullRequestInput): PullRequestAsked {
  return {
    head: input.head,
    base: input.base,
    title: input.title,
    body: input.body.trimEnd(),
    draft: input.draft,
  };
}

/** The answer for an attempt that ended other than with a token refused. */
function answerOf(ended: Settled, openedAs: OpenedAs, note?: string): PullRequestToolResult {
  if (ended.kind === ATTEMPT.REFUSED) return pullRequestRejected(ended.reason);

  return {
    status: ACTION_RESULT_STATUS.ACCEPTED,
    url: ended.url,
    number: ended.number,
    openedAs,
    ...(note === undefined ? undefined : { note }),
  };
}

/**
 * One call's opening: the pull request opened on the developer's own token
 * where that is the agent's credential, with nothing in its place; as the
 * developer where the agent writes as them and GitHub takes their sign-in's
 * token, and as the App otherwise, the App's opening in the developer's
 * place recorded on the agent's row with why; or GitHub's reason it opened
 * none.
 */
const attemptOpening = /* @__PURE__ */ Effect.fn("web/attemptPullRequestOpening")(function* (
  target: ConversationTarget,
  agent: WithRepository<Agent>,
  input: OpenPullRequestInput,
  extra: AgentRepositoryEntry | undefined,
): Effect.fn.Return<PullRequestToolResult, never, CheckoutServices | DatabaseServices> {
  const minted = yield* Effect.result(agentRepositoryToken(target, agent, extra?.repository));

  if (Result.isFailure(minted)) return pullRequestRejected(`Not opened: ${minted.failure.reason}`);
  const { bearer, fullName, access } = minted.success;
  const pullRequest = pullRequestOf(input);

  // Note that an agent on its starter's own token opens on it alone, since no installation reaches the repository.
  if (access.kind === GITHUB_ACCESS.TOKEN) {
    const asMember = yield* attempt(bearer, fullName, pullRequest);

    return asMember.kind === ATTEMPT.TOKEN_REFUSED
      ? pullRequestRejected(PULL_REQUEST_REFUSAL.TOKEN_REFUSED)
      : answerOf(asMember, OPENED_AS.DEVELOPER);
  }

  const forMember = yield* Effect.result(openedFor(target, agent));

  if (Result.isFailure(forMember)) return pullRequestRejected(PULL_REQUEST_REFUSAL.UNAVAILABLE);

  if (Option.isSome(forMember.success)) {
    const { member, openedAs } = forMember.success.value;

    return yield* attemptForMember(target, member, openedAs, bearer, fullName, pullRequest);
  }

  const asDeveloper = yield* attemptAsDeveloper(target, agent, fullName, pullRequest);

  if (asDeveloper !== undefined && asDeveloper.kind !== ATTEMPT.TOKEN_REFUSED) {
    return answerOf(asDeveloper, OPENED_AS.DEVELOPER);
  }

  const asApp = yield* attempt(bearer, fullName, pullRequest);

  if (asApp.kind === ATTEMPT.TOKEN_REFUSED) {
    return pullRequestRejected(PULL_REQUEST_REFUSAL.UNAVAILABLE);
  }

  if (asDeveloper === undefined || asApp.kind === ATTEMPT.REFUSED) {
    return answerOf(asApp, OPENED_AS.APP);
  }

  yield* recordAgentAuthor(target.userId, agent.id, asDeveloper.reason).pipe(
    Effect.catch((failure) =>
      Effect.logWarning(
        `Why conversation ${target.conversationId}'s pull request was opened as the App was not recorded: ${failure._tag}`,
      ),
    ),
  );

  return answerOf(asApp, OPENED_AS.APP, FALLBACK_NOTE[asDeveloper.reason]);
});

/**
 * What an opening GitHub took leaves on the agent's row: the branch it was
 * opened from, and the pull request read back from GitHub onto the row, as
 * a turn's end and a delivery about the branch would, so a comment on it
 * finds the agent at once. Either failing is logged by its kind and the
 * call still answers as opened.
 */
const recordOpened = (
  target: ConversationTarget,
  agent: Agent,
  head: string,
  extra: AgentRepositoryEntry | undefined,
) =>
  Effect.gen(function* () {
    if (extra === undefined) {
      yield* updateAgentBranch(target.userId, agent.id, head);
      yield* agentPublished(target.userId, { ...agent, branch: head });

      return;
    }

    // An extra's head is written on its own row, and its pull request read back with the agent's.
    yield* recordAgentRepositoryHead(target.userId, agent.id, extra.repository, head);
    yield* agentPublished(target.userId, agent);
  }).pipe(
    Effect.catch((failure) =>
      Effect.logWarning(
        `Conversation ${target.conversationId}'s opened pull request was not recorded on its agent: ${failure._tag}`,
      ),
    ),
  );

/**
 * Which of the agent's repositories (`readAgentRepositories`) the call opens
 * its pull request in: its own, where it names that one, answered as
 * undefined; one it works in beside it, where it names that one; else why it
 * opened nothing, listing them, where it names one it does not work in.
 */
function chosenExtra(
  named: string,
  repositories: readonly AgentRepositoryEntry[],
): Result.Result<AgentRepositoryEntry | undefined, string> {
  const [own, ...extras] = repositories;
  const lowered = named.toLowerCase();

  if (own === undefined || own.repository.toLowerCase() === lowered)
    return Result.succeed(undefined);
  const extra = extras.find((each) => each.repository.toLowerCase() === lowered);

  return extra === undefined ? Result.fail(repositoryRefusal(repositories)) : Result.succeed(extra);
}

/**
 * Runs one call: the opening above in the repository it names, and where
 * GitHub opened it, its branch and pull request recorded on the agent's row
 * for its own repository, or on that repository's row for one it works in
 * beside it. A refused call leaves the rows as they stood, the branch and
 * pull request the agent already had among them.
 */
export const openPullRequest = /* @__PURE__ */ Effect.fn("web/openPullRequest")(function* (
  target: ConversationTarget,
  agent: WithRepository<Agent>,
  input: UnparsedWireValue,
): Effect.fn.Return<PullRequestToolResult, never, CheckoutServices | DatabaseServices> {
  const repositories = yield* Effect.result(readAgentRepositories(target.userId, agent.id));

  if (Result.isFailure(repositories)) return pullRequestRejected(PULL_REQUEST_REFUSAL.UNAVAILABLE);
  const read = readInput(input);

  if (Result.isFailure(read)) return pullRequestRejected(unreadableRefusal(repositories.success));
  const chosen = chosenExtra(read.success.repository, repositories.success);

  if (Result.isFailure(chosen)) return pullRequestRejected(chosen.failure);
  const extra = chosen.success;
  const result = yield* attemptOpening(target, agent, read.success, extra);

  if (result.status === ACTION_RESULT_STATUS.ACCEPTED) {
    yield* recordOpened(target, agent, read.success.head, extra);
    yield* recordServerEvent(
      SERVER_EVENT.PULL_REQUEST_CREATE,
      { userId: target.userId, workspaceId: agent.organizationId },
      {
        opened_as: OPENER_EVENT[result.openedAs],
        is_draft: read.success.draft,
      },
    );
  }

  return result;
});
