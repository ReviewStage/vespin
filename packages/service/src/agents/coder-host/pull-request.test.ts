import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { readAgentRepositories } from "@repo/database/models/agent-repositories";
import {
  type Agent,
  createAgent,
  hasRepository,
  readAgent,
  settleAgentAuthor,
  updateAgentBranch,
  type WithRepository,
} from "@repo/database/models/agent-store";
import { updateTask } from "@repo/database/models/task-store";
import { user } from "@repo/database/schemas/auth";
import { CONVERSATION_RUNTIME } from "@repo/database/storage-vocabulary";
import { getTestDB, joinWorkspace, startTask } from "@repo/database/testing";
import { AGENT_AUTHOR, AGENT_KIND, type AgentAuthor } from "@repo/features/agent-wire";
import { GITHUB_ACCESS } from "@repo/features/github-repositories-wire";
import { ACTION_RESULT_STATUS, unparsedWire, type WireBoundaryInput } from "@repo/wire";
import { eq } from "drizzle-orm";
import { Clock, Effect, Option } from "effect";
import {
  connectWorkspaceGitHub,
  GITHUB_APP_WITH_TOKENS,
  GITHUB_FIXTURE,
  GITHUB_FIXTURE_INSTALLATION_TOKEN,
  GITHUB_FIXTURE_MEMBER,
  type GitHubAccountRow,
  githubReaching,
  type InstallationFixture,
  memberRepositoryJson,
  openGithubUser,
  openTokenMember,
  type SentToGitHub,
} from "../../testing/github-app-fake.js";
import { openPullRequest } from "./pull-request.js";

/**
 * A coding agent's pull request, opened by the service: as the developer it
 * writes as, on their own token, in one call on the agent's repository; as
 * the App where it writes as the App; and as the App in the developer's
 * place where GitHub refuses their token, the agent's row recording why;
 * and on its starter's own token alone where that is its credential. A
 * Manager's agent opens as its task's assignee, and as the App naming them
 * where GitHub refuses their token.
 * A refusal of the pull request itself opens nothing and moves nothing.
 * GitHub is a script and the store PGlite; synthetic accounts and tokens
 * throughout.
 */

const RELAY = { owner: "Acme", name: "Relay", defaultBranch: "trunk" } as const;
const RELAY_FULL_NAME = `${RELAY.owner}/${RELAY.name}`;
const PULLS = `/repos/${RELAY_FULL_NAME}/pulls`;

/** The token the developer's GitHub sign-in left on their row (`standingGithubRow`). */
const DEVELOPER_TOKEN = "ghu_standing";

const INPUT = {
  head: "luke/teammate-invitations",
  title: "Expire teammate invitations",
  body: "Invitations now expire after a week.",
  repository: RELAY_FULL_NAME,
  base: RELAY.defaultBranch,
  draft: false,
};

/** How GitHub answers an opening, by the bearer it came on. */
type Opening = (bearer: string) => Response;

const opened = () =>
  Response.json(
    { number: 12, html_url: `https://github.com/${RELAY_FULL_NAME}/pull/12` },
    { status: 201 },
  );

/** GitHub answering a pull request's opening as given, every opening written down. */
function repository(answer: Opening) {
  const openings: SentToGitHub[] = [];

  const script = (sent: SentToGitHub): Response | undefined => {
    if (new URL(sent.url).pathname !== PULLS || sent.method !== "POST") return undefined;
    openings.push(sent);

    return answer(sent.headers.get("authorization") ?? "");
  };

  return { openings, script };
}

/** An agent of a signed-in developer on the repository, its author settled as given. */
const openAgent = (installationId: number, author: AgentAuthor | null, row?: GitHubAccountRow) =>
  Effect.gen(function* () {
    const installation: InstallationFixture = {
      id: installationId,
      login: RELAY.owner,
      repositories: [RELAY],
    };

    const userId = yield* openGithubUser(row);
    const task = yield* startTask(userId, { name: "Invitations", repository: RELAY_FULL_NAME });
    yield* connectWorkspaceGitHub(task.workspaceId, installation);

    const started = yield* createAgent(userId, {
      taskId: task.id,
      idempotencyKey: "start-1",
      model: "anthropic/claude-opus-5.5",
      effort: "high",
      descriptionSnapshot: "# Invitations\n",
      prompt: null,
      repository: RELAY_FULL_NAME,
      runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
    });

    const { agent } = Option.getOrThrow(started);

    if (author !== null) yield* settleAgentAuthor(userId, agent.id, author);
    const settled = Option.getOrThrow(yield* readAgent(userId, agent.id));
    assert.ok(hasRepository(settled));

    return {
      installation,
      agent: settled,
      target: { userId, conversationId: agent.conversationId },
    };
  });

/** Opens the agent's pull request against the GitHub given. */
const open = (
  opened: {
    readonly installation: InstallationFixture;
    readonly agent: WithRepository<Agent>;
  },
  target: { readonly userId: string; readonly conversationId: string },
  answer: Opening,
  input: WireBoundaryInput = INPUT,
) =>
  Effect.gen(function* () {
    const github = repository(answer);

    const result = yield* openPullRequest(target, opened.agent, unparsedWire(input)).pipe(
      Effect.provide(githubReaching([opened.installation], undefined, {}, github.script).layer),
    );

    const row = Option.getOrThrow(yield* readAgent(target.userId, opened.agent.id));

    return { result, openings: github.openings, author: row.author, branch: row.branch };
  });

/** An agent of a member who saved their own token, on the repository no installation of the plan's workspace reaches, writing on that token. */
const openTokenAgent = Effect.gen(function* () {
  const userId = yield* openTokenMember();
  const task = yield* startTask(userId, { name: "Invitations", repository: RELAY_FULL_NAME });

  const started = yield* createAgent(userId, {
    taskId: task.id,
    idempotencyKey: "start-1",
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    descriptionSnapshot: "# Invitations\n",
    prompt: null,
    repository: RELAY_FULL_NAME,
    githubAccess: GITHUB_ACCESS.TOKEN,
    runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
  });

  const { agent } = Option.getOrThrow(started);
  yield* settleAgentAuthor(userId, agent.id, AGENT_AUTHOR.TOKEN);
  const settled = Option.getOrThrow(yield* readAgent(userId, agent.id));
  assert.ok(hasRepository(settled));

  return {
    agent: settled,
    target: { userId, conversationId: agent.conversationId },
  };
});

/** Opens a token agent's pull request against a GitHub where the member's token may push to the repository and no installation reaches it. */
const openOnToken = (
  opened: {
    readonly agent: WithRepository<Agent>;
    readonly target: { userId: string; conversationId: string };
  },
  answer: Opening,
) =>
  Effect.gen(function* () {
    const github = repository(answer);

    const script = (sent: SentToGitHub): Response | undefined => {
      const onToken = sent.headers.get("authorization") === `Bearer ${GITHUB_FIXTURE_MEMBER.TOKEN}`;

      if (onToken && new URL(sent.url).pathname === `/repos/${RELAY_FULL_NAME}`) {
        return Response.json(memberRepositoryJson(RELAY, true));
      }

      return github.script(sent);
    };

    const result = yield* openPullRequest(opened.target, opened.agent, unparsedWire(INPUT)).pipe(
      Effect.provide(githubReaching([], GITHUB_APP_WITH_TOKENS, {}, script).layer),
    );

    const row = Option.getOrThrow(yield* readAgent(opened.target.userId, opened.agent.id));

    return { result, openings: github.openings, author: row.author };
  });

const DOCS = { owner: "Acme", name: "Docs", defaultBranch: "main" } as const;
const DOCS_FULL_NAME = `${DOCS.owner}/${DOCS.name}`;

/** An agent writing as the App on the repository, working in the docs beside it, its checkout there cloned at `next`. */
const openAgentBesideDocs = (installationId: number) =>
  Effect.gen(function* () {
    const installation: InstallationFixture = {
      id: installationId,
      login: RELAY.owner,
      repositories: [RELAY, DOCS],
    };

    const userId = yield* openGithubUser();
    const task = yield* startTask(userId, { name: "Invitations", repository: RELAY_FULL_NAME });
    yield* connectWorkspaceGitHub(task.workspaceId, installation);

    const started = yield* createAgent(userId, {
      taskId: task.id,
      idempotencyKey: "start-1",
      model: "anthropic/claude-opus-5.5",
      effort: "high",
      descriptionSnapshot: "# Invitations\n",
      prompt: null,
      repository: RELAY_FULL_NAME,
      extraRepositories: [{ repository: DOCS_FULL_NAME, baseBranch: "next" }],
      runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
    });

    const { agent } = Option.getOrThrow(started);
    yield* settleAgentAuthor(userId, agent.id, AGENT_AUTHOR.APP_AUTOMATION);
    const settled = Option.getOrThrow(yield* readAgent(userId, agent.id));
    assert.ok(hasRepository(settled));

    return {
      installation,
      agent: settled,
      target: { userId, conversationId: agent.conversationId },
    };
  });

/** The token the assignee's own GitHub sign-in left on their row. */
const ASSIGNEE_TOKEN = "ghu_assignee";

/** A signed-in account renamed as given, so a line naming it reads it apart. */
const openNamedGithubUser = (name: string, row?: GitHubAccountRow) =>
  Effect.gen(function* () {
    const userId = yield* openGithubUser(row);
    const db = yield* Database;
    yield* db.update(user).set({ name }).where(eq(user.id, userId));

    return userId;
  });

/** A coder a Manager of the owner's started, writing as the owner, on a task assigned to a signed-in teammate. */
const openManagersAgent = (installationId: number) =>
  Effect.gen(function* () {
    const installation: InstallationFixture = {
      id: installationId,
      login: RELAY.owner,
      repositories: [RELAY],
    };

    const now = yield* Clock.currentTimeMillis;
    const owner = yield* openNamedGithubUser("Dana Owner");

    const assignee = yield* openNamedGithubUser("Avery Assignee", {
      accessToken: ASSIGNEE_TOKEN,
      refreshToken: "ghr_assignee",
      accessTokenExpiresAt: new Date(now + 7 * GITHUB_FIXTURE.HOUR_MS),
      refreshTokenExpiresAt: new Date(now + 170 * 24 * GITHUB_FIXTURE.HOUR_MS),
    });

    const task = yield* startTask(owner, { name: "Invitations", repository: RELAY_FULL_NAME });
    yield* connectWorkspaceGitHub(task.workspaceId, installation);
    yield* joinWorkspace(task.workspaceId, assignee);
    yield* updateTask(owner, task.id, { assigneeId: assignee });

    const start = {
      taskId: task.id,
      model: "anthropic/claude-opus-5.5",
      effort: "high",
      descriptionSnapshot: null,
      repository: RELAY_FULL_NAME,
      runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
    };

    const manager = Option.getOrThrow(
      yield* createAgent(owner, {
        ...start,
        idempotencyKey: "manager",
        prompt: "Run the invitations work.",
        kind: AGENT_KIND.MANAGER,
      }),
    ).agent;

    const started = Option.getOrThrow(
      yield* createAgent(owner, {
        ...start,
        idempotencyKey: "coder",
        prompt: "Expire teammate invitations.",
        startedByAgentId: manager.id,
      }),
    ).agent;

    yield* settleAgentAuthor(owner, started.id, AGENT_AUTHOR.DEVELOPER);
    const agent = Option.getOrThrow(yield* readAgent(owner, started.id));
    assert.ok(hasRepository(agent));

    return {
      installation,
      agent,
      target: { userId: owner, conversationId: agent.conversationId },
    };
  });

it.layer(getTestDB())("a coding agent's pull request", (it) => {
  it.effect(
    "a Manager's agent on a task assigned to a teammate opens on the assignee's own token, its description as the agent wrote it",
    () =>
      Effect.gen(function* () {
        const managers = yield* openManagersAgent(51);

        const { result, openings, author } = yield* open(managers, managers.target, opened);

        assert.ok(result.status === ACTION_RESULT_STATUS.ACCEPTED);
        assert.equal(result.openedAs, "assignee");
        assert.deepEqual(
          openings.map((sent) => sent.headers.get("authorization")),
          [`Bearer ${ASSIGNEE_TOKEN}`],
        );
        assert.equal(JSON.parse(openings[0]?.body ?? "{}").body, INPUT.body);
        assert.equal(author, AGENT_AUTHOR.DEVELOPER, "the row is left as it stood");
      }),
  );

  it.effect(
    "where GitHub refuses the assignee's token, the App opens it in their place, its description ending on who it was requested by, and never on the owner's token",
    () =>
      Effect.gen(function* () {
        const managers = yield* openManagersAgent(52);

        const appOnly = (bearer: string) =>
          bearer === `Bearer ${GITHUB_FIXTURE_INSTALLATION_TOKEN}`
            ? opened()
            : Response.json({ message: "Bad credentials" }, { status: 401 });

        const { result, openings, author } = yield* open(managers, managers.target, appOnly);

        assert.ok(result.status === ACTION_RESULT_STATUS.ACCEPTED);
        assert.equal(result.openedAs, "app");
        assert.deepEqual(
          openings.map((sent) => sent.headers.get("authorization")),
          [`Bearer ${ASSIGNEE_TOKEN}`, `Bearer ${GITHUB_FIXTURE_INSTALLATION_TOKEN}`],
        );
        assert.equal(
          JSON.parse(openings[1]?.body ?? "{}").body,
          `${INPUT.body}\n\nRequested by Avery Assignee.`,
        );
        assert.equal(author, AGENT_AUTHOR.DEVELOPER, "the row is left as it stood");
      }),
  );

  it.effect(
    "an agent in several repositories names the one to open in, refused with their names where it names none or another, and its pull request in an extra one opens there against the base it names, its head written on that repository's row alone",
    () =>
      Effect.gen(function* () {
        const besideDocs = yield* openAgentBesideDocs(41);
        const openings: SentToGitHub[] = [];

        const script = (sent: SentToGitHub): Response | undefined => {
          const path = new URL(sent.url).pathname;

          if (sent.method !== "POST" || !path.endsWith("/pulls")) return undefined;
          openings.push(sent);

          return Response.json(
            { number: 7, html_url: `https://github.com/${DOCS_FULL_NAME}/pull/7` },
            { status: 201 },
          );
        };

        const call = (input: WireBoundaryInput) =>
          openPullRequest(besideDocs.target, besideDocs.agent, unparsedWire(input)).pipe(
            Effect.provide(githubReaching([besideDocs.installation], undefined, {}, script).layer),
          );

        const { repository: _, ...unnamed } = INPUT;
        const refusals = [yield* call(unnamed), yield* call({ ...INPUT, repository: "acme/web" })];
        assert.deepEqual(refusals, [
          {
            status: ACTION_RESULT_STATUS.REJECTED,
            reason:
              "Not opened: the call needs head, title, body, repository, base, and draft, the title at most 256 characters, repository one you work in: `Acme/Relay`, `Acme/Docs`, and base the branch it merges into: the branch your own values name, else the repository's default branch, or the parent's branch for a stacked pull request, and draft false to open it ready for review or true to open it as a draft.",
          },
          {
            status: ACTION_RESULT_STATUS.REJECTED,
            reason:
              "Not opened: name the repository to open it in as repository, one you work in: `Acme/Relay`, `Acme/Docs`.",
          },
        ]);
        assert.equal(openings.length, 0, "GitHub hears of no refused call");

        const inDocs = yield* call({ ...INPUT, repository: "acme/docs", base: "next" });
        assert.ok(inDocs.status === ACTION_RESULT_STATUS.ACCEPTED);
        assert.equal(inDocs.number, 7);
        assert.deepEqual(
          openings.map((sent) => new URL(sent.url).pathname),
          [`/repos/${DOCS_FULL_NAME}/pulls`],
        );
        assert.equal(JSON.parse(openings[0]?.body ?? "{}").base, "next");

        const [own, docs] = yield* readAgentRepositories(
          besideDocs.target.userId,
          besideDocs.agent.id,
        );

        assert.equal(own?.headBranch, null, "the agent's own repository is left as it stood");
        assert.equal(docs?.headBranch, INPUT.head);
      }),
  );

  it.effect(
    "an agent on its starter's own token opens on that token alone, as them, and a refusal of the token opens nothing in its place",
    () =>
      Effect.gen(function* () {
        const accepted = yield* openOnToken(yield* openTokenAgent, opened);

        const refused = yield* openOnToken(yield* openTokenAgent, () =>
          Response.json({ message: "Bad credentials" }, { status: 401 }),
        );

        assert.ok(accepted.result.status === ACTION_RESULT_STATUS.ACCEPTED);
        assert.equal(accepted.result.openedAs, "developer");
        assert.equal(refused.result.status, ACTION_RESULT_STATUS.REJECTED);

        for (const { openings, author } of [accepted, refused]) {
          assert.deepEqual(
            openings.map((sent) => sent.headers.get("authorization")),
            [`Bearer ${GITHUB_FIXTURE_MEMBER.TOKEN}`],
          );
          assert.equal(author, AGENT_AUTHOR.TOKEN, "the row is left as it stood");
        }
      }),
  );

  it.effect(
    "an agent writing as its developer has its pull request opened on their token, once, against the base it names, its description as the agent wrote it, its branch recorded on the agent as it opens",
    () =>
      Effect.gen(function* () {
        const agent = yield* openAgent(21, AGENT_AUTHOR.DEVELOPER);

        const { result, openings, author, branch } = yield* open(agent, agent.target, opened);

        assert.deepEqual(result, {
          status: ACTION_RESULT_STATUS.ACCEPTED,
          url: `https://github.com/${RELAY_FULL_NAME}/pull/12`,
          number: 12,
          openedAs: "developer",
        });
        assert.deepEqual(
          openings.map((sent) => sent.headers.get("authorization")),
          [`Bearer ${DEVELOPER_TOKEN}`],
        );
        assert.deepEqual(JSON.parse(openings[0]?.body ?? "{}"), {
          head: INPUT.head,
          base: RELAY.defaultBranch,
          title: INPUT.title,
          body: INPUT.body,
          draft: false,
        });
        assert.equal(author, AGENT_AUTHOR.DEVELOPER);
        // The branch stands on the row at once, so GitHub's delivery about the opening finds the agent mid-turn.
        assert.equal(branch, INPUT.head);
      }),
  );

  it.effect(
    "where GitHub refuses the developer's token or their account's access, the App opens it in their place and the row records why",
    () =>
      Effect.gen(function* () {
        const refusedToken = yield* openAgent(22, AGENT_AUTHOR.DEVELOPER);
        const noAccess = yield* openAgent(23, AGENT_AUTHOR.DEVELOPER);

        const appOnly = (status: number) => (bearer: string) =>
          bearer === `Bearer ${DEVELOPER_TOKEN}`
            ? Response.json({ message: "Refused" }, { status })
            : opened();

        const unlinked = yield* open(refusedToken, refusedToken.target, appOnly(401));
        const forbidden = yield* open(noAccess, noAccess.target, appOnly(403));

        for (const { result, openings } of [unlinked, forbidden]) {
          assert.equal(result.status, ACTION_RESULT_STATUS.ACCEPTED);
          assert.ok(result.status === ACTION_RESULT_STATUS.ACCEPTED);
          assert.equal(result.openedAs, "app");
          assert.match(result.note ?? "", /Opened as Vespin's GitHub App/u);
          assert.deepEqual(
            openings.map((sent) => sent.headers.get("authorization")),
            [`Bearer ${DEVELOPER_TOKEN}`, `Bearer ${GITHUB_FIXTURE_INSTALLATION_TOKEN}`],
          );
        }

        assert.deepEqual(
          [unlinked.author, forbidden.author],
          [AGENT_AUTHOR.APP_UNLINKED, AGENT_AUTHOR.APP_NO_PUSH],
        );
      }),
  );

  it.effect(
    "an agent writing as the App, or from before its author was settled, opens on the App's token and never reads the developer's",
    () =>
      Effect.gen(function* () {
        const automated = yield* openAgent(24, AGENT_AUTHOR.APP_AUTOMATION);
        const unsettled = yield* openAgent(25, null);

        for (const agent of [automated, unsettled]) {
          const { result, openings, author } = yield* open(agent, agent.target, opened);
          assert.ok(result.status === ACTION_RESULT_STATUS.ACCEPTED);
          assert.equal(result.openedAs, "app");
          assert.equal(result.note, undefined);
          assert.deepEqual(
            openings.map((sent) => sent.headers.get("authorization")),
            [`Bearer ${GITHUB_FIXTURE_INSTALLATION_TOKEN}`],
          );
          assert.equal(author, agent.agent.author, "the row is left as it stood");
        }
      }),
  );

  it.effect(
    "GitHub refusing the pull request itself opens nothing and moves nothing, the agent's branch among it, and a call without a title is refused before GitHub hears of it",
    () =>
      Effect.gen(function* () {
        const agent = yield* openAgent(26, AGENT_AUTHOR.DEVELOPER);
        // The agent already stands on a branch of its own, with its pull request from it.
        yield* updateAgentBranch(agent.target.userId, agent.agent.id, "luke/ready");

        const exists = () =>
          Response.json(
            {
              message: "Validation Failed",
              errors: [
                { message: "A pull request already exists for Acme:luke/teammate-invitations." },
              ],
            },
            { status: 422 },
          );

        const refused = yield* open(agent, agent.target, exists);
        const untitled = yield* open(agent, agent.target, opened, { head: INPUT.head, body: "" });

        assert.deepEqual(refused.result, {
          status: ACTION_RESULT_STATUS.REJECTED,
          reason:
            "Not opened: GitHub said: Validation Failed A pull request already exists for Acme:luke/teammate-invitations.",
        });
        assert.equal(refused.openings.length, 1, "the App does not try in the developer's place");
        assert.equal(refused.author, AGENT_AUTHOR.DEVELOPER);
        assert.equal(
          refused.branch,
          "luke/ready",
          "a refused call leaves the agent's branch as it stood",
        );
        assert.equal(untitled.result.status, ACTION_RESULT_STATUS.REJECTED);
        assert.deepEqual(untitled.openings, []);
      }),
  );

  it.effect(
    "a base the agent names is the branch GitHub is asked to merge into, a call naming none is refused naming base before GitHub hears of it, and a base GitHub does not know opens nothing and answers why",
    () =>
      Effect.gen(function* () {
        const agent = yield* openAgent(31, AGENT_AUTHOR.DEVELOPER);
        const stacked = { ...INPUT, base: "luke/teammate-invitations-store" };

        // GitHub's own answer to a base it has no branch for: an error with a field and a code, and no message.
        const unknownBase = () =>
          Response.json(
            {
              message: "Validation Failed",
              errors: [{ resource: "PullRequest", field: "base", code: "invalid" }],
            },
            { status: 422 },
          );

        const accepted = yield* open(agent, agent.target, opened, stacked);
        const { base: _base, ...unbased } = INPUT;
        const baseless = yield* open(agent, agent.target, opened, unbased);
        const { draft: _draft, ...undrafted } = INPUT;
        const draftless = yield* open(agent, agent.target, opened, undrafted);

        const refused = yield* open(agent, agent.target, unknownBase, {
          ...INPUT,
          base: "luke/gone",
        });

        assert.equal(accepted.result.status, ACTION_RESULT_STATUS.ACCEPTED);
        assert.equal(JSON.parse(accepted.openings[0]?.body ?? "{}").base, stacked.base);
        assert.ok(baseless.result.status === ACTION_RESULT_STATUS.REJECTED);
        assert.match(
          baseless.result.reason,
          /needs head, title, body, repository, base, and draft/u,
        );
        assert.deepEqual(baseless.openings, []);
        assert.ok(draftless.result.status === ACTION_RESULT_STATUS.REJECTED);
        assert.match(draftless.result.reason, /and draft false to open it ready for review/u);
        assert.deepEqual(draftless.openings, []);
        assert.deepEqual(refused.result, {
          status: ACTION_RESULT_STATUS.REJECTED,
          reason: "Not opened: GitHub said: Validation Failed base invalid",
        });
        assert.ok(
          refused.openings.every(
            (sent) => sent.headers.get("authorization") === `Bearer ${DEVELOPER_TOKEN}`,
          ),
          "the App does not try in the developer's place",
        );
      }),
  );

  it.effect(
    "a rate limit on the developer's request, or their token not refreshing while GitHub is down, opens nothing and leaves the agent theirs, for the call to be made again",
    () =>
      Effect.gen(function* () {
        const limited = yield* openAgent(27, AGENT_AUTHOR.DEVELOPER);
        const now = yield* Clock.currentTimeMillis;

        const expired = yield* openAgent(28, AGENT_AUTHOR.DEVELOPER, {
          accessToken: "ghu_expired",
          refreshToken: "ghr_standing",
          accessTokenExpiresAt: new Date(now - GITHUB_FIXTURE.HOUR_MS),
          refreshTokenExpiresAt: new Date(now + 170 * 24 * GITHUB_FIXTURE.HOUR_MS),
        });

        const rateLimit = (bearer: string) =>
          bearer === `Bearer ${DEVELOPER_TOKEN}`
            ? Response.json(
                { message: "You have exceeded a secondary rate limit." },
                { status: 403, headers: { "retry-after": "60" } },
              )
            : opened();

        const throttled = yield* open(limited, limited.target, rateLimit);
        const outage = yield* open(expired, expired.target, opened);

        assert.deepEqual(throttled.result, {
          status: ACTION_RESULT_STATUS.REJECTED,
          reason:
            "Not opened: GitHub is limiting how fast requests may come. Make the call again in a minute.",
        });
        assert.equal(throttled.openings.length, 1, "the App does not open it in their place");
        assert.deepEqual(outage.result, {
          status: ACTION_RESULT_STATUS.REJECTED,
          reason: "Not opened: GitHub could not be reached. The call may be made again.",
        });
        assert.deepEqual(outage.openings, []);
        assert.deepEqual(
          [throttled.author, outage.author],
          [AGENT_AUTHOR.DEVELOPER, AGENT_AUTHOR.DEVELOPER],
        );
      }),
  );
});
