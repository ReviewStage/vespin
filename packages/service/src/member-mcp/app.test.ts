import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { it } from "@effect/vitest";
import type { Client } from "@modelcontextprotocol/client";
import { Database } from "@repo/database/core/query";
import { queueAgentMessage } from "@repo/database/models/agent-queue-store";
import { createAgent, readAgent } from "@repo/database/models/agent-store";
import {
  createAutomation,
  listAutomationRuns,
  readAutomation,
} from "@repo/database/models/automation-store";
import {
  DESCRIPTION_COMMENT_OUTCOME,
  readDescriptionCommentThreads,
  startDescriptionCommentThread,
} from "@repo/database/models/description-comments";
import { listRevisions } from "@repo/database/models/description-revisions";
import { listMemories, rememberMemory } from "@repo/database/models/memory-store";
import { parseKeyRing } from "@repo/database/models/provider-key-seal";
import { claimRuntimeSession } from "@repo/database/models/recorded-session";
import { listTaskSections, writeTaskSections } from "@repo/database/models/task-section-store";
import { createTask, readTask } from "@repo/database/models/task-store";
import { openWorkspaceEnvironment } from "@repo/database/models/workspace-environment-store";
import { setWorkspaceExperiment } from "@repo/database/models/workspace-experiment-store";
import { storeWriter } from "@repo/database/models/writer";
import { agentTable } from "@repo/database/schemas/agent";
import { messages } from "@repo/database/schemas/storage";
import { CONVERSATION_RUNTIME, MESSAGE_SENDER } from "@repo/database/storage-vocabulary";
import {
  getTestDB,
  joinWorkspace,
  openAgentOnOwnTask,
  openInboxItem,
  openTaskAgent,
  openWorkspace,
} from "@repo/database/testing";
import { AGENT_ARCHIVER, AGENT_PAYER, QUEUE_CHANGE } from "@repo/features/agent-wire";
import {
  AUTOMATION_ACTION,
  AUTOMATION_DEFAULT_GUARDS,
  AUTOMATION_FIRING,
  AUTOMATION_TRIGGER,
} from "@repo/features/automation-wire";
import {
  DESCRIPTION_COMMENT_ACTOR,
  DESCRIPTION_COMMENT_ENTRY,
  DESCRIPTION_COMMENT_SCOPE,
  DESCRIPTION_COMMENT_STATUS,
} from "@repo/features/description-comment-wire";
import { NOTE_KIND } from "@repo/features/description-notes";
import { INBOX_ANSWER_LEAD, INBOX_ASK, INBOX_REPLY, INBOX_STATUS } from "@repo/features/inbox-wire";
import { INSTALLED_SKILL_SCOPE } from "@repo/features/installed-skill-wire";
import { INTEGRATION_PROVIDER } from "@repo/features/integration-wire";
import { PULL_REQUEST_ACTION } from "@repo/features/pull-request-write-wire";
import { TASK_SECTION_WRITE } from "@repo/features/task-section-wire";
import {
  DESCRIPTION_ACTOR,
  TASK_RELATION_KIND,
  TASK_STATUS,
  UNTITLED_TASK_NAME,
} from "@repo/features/task-wire";
import { WORKSPACE_ROLE } from "@repo/features/workspace-wire";
import { EXPERIMENT, WORKSPACE_EXPERIMENT_LIST } from "@repo/settings";
import { settleJsonSchemaGolden } from "@repo/wire/testing";
import { eq, sql } from "drizzle-orm";
import { Clock, DateTime, Effect, Option, Result, Schema } from "effect";
import { TestClock } from "effect/testing";
import { afterEach, vi } from "vitest";
import { readWorkspaceMemories, WORKSPACE_MEMORY } from "../accounts/workspace-memories.js";
import { START_AGENT_REFUSAL } from "../agents/agent-tools.js";
import { recordMemberDescriptionNotes } from "../agents/coder-host/description-edit.js";
import { CODER_TOOL_SET } from "../agents/coder-host/tool-set.js";
import { EXPERIMENT_OFF_REFUSAL } from "../agents/workspace-experiment-on.js";
import { DESKTOP_OAUTH_CLIENT } from "../auth/oauth-clients.js";
import { ACTION_RESULT_STATUS } from "../core.js";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import { postInboxThread, readInboxItem } from "../inbox/inbox-store.js";
import { AGENT_KEY_RING, connectAgentApiKeys } from "../testing/agent-credentials.js";
import {
  fakeAgentSessions,
  freshInstallation,
  type GraphqlCall,
  graphqlAnswering,
  mutationOf,
  openAskOf,
  openTask,
  PUBLISHED,
  PULL_REQUEST_NODE_ID,
  publishedPullRequest,
  publishedPullRequestDrafted,
  RELAY_FULL_NAME,
  startedAgent,
} from "../testing/agents-app-support.js";
import { experimentWordsIn } from "../testing/experiment-words.js";
import {
  connectWorkspaceGitHub,
  githubReaching,
  signInWithGitHub,
  standingGithubRow,
} from "../testing/github-app-fake.js";
import {
  CONNECTOR_ASKED_NOTHING,
  GRANTING_SIGN_IN_URL,
  integrationConnectOf,
} from "../testing/integration-connect.js";
import {
  connected,
  MCP_CLIENT,
  MEMBER_MCP_TEST,
  memberMcpStanding,
  mintedToken,
  OTHER_RESOURCE,
  post,
  RESOURCE,
  REVISION,
  signUp,
} from "../testing/member-mcp-auth.js";
import { harnessFor } from "../testing/native-harness-fake.js";
import { MEMBER_MCP_METADATA_ROUTE, memberMcpIssuer } from "./app.js";
import { MEMBER_MCP_PATH, MEMBER_MCP_SCOPE } from "./resource.js";
import {
  LIST_WORKSPACES_TOOL,
  MEMBER_MCP_TOOL,
  MEMBER_MCP_TOOLS,
  type MemberMcpTool,
} from "./tools.js";

/**
 * The member MCP server, answered by its group the way a function answers
 * it, over the auth service and the migrated PGlite the tools read too. The tokens are the
 * provider's own, minted through a seeded test client linked to the
 * resource: a signed-up account authorizes it, as a client's sign-in will,
 * and the client exchanges its code (`../testing/member-mcp-auth.ts`, the
 * harness the sign-in test shares). The SDK's own client
 * drives the server at both revisions it serves. GitHub is reached by no
 * call here but a change to a pull request's, which answers from a script
 * as the Pull request tab's own tests script it, an agent's harness is a
 * recording one that takes every message, and the model catalog offers
 * nothing. An answer's hand-off to the agent that asked is driven apart,
 * over the agents' own test world (`../testing/agents-app-support.ts`): a
 * started agent on a fake harness, its server admitted on the world's bearers.
 * Synthetic accounts and tokens.
 */

/** The member's own GitHub token, as their sign-in through the App left it. */
const MEMBER_GITHUB_TOKEN = "ghu_member";

const decodeMetadata = Schema.decodeUnknownSync(
  Schema.Struct({
    resource: Schema.String,
    authorization_servers: Schema.Array(Schema.String),
    scopes_supported: Schema.Array(Schema.String),
    bearer_methods_supported: Schema.Array(Schema.String),
  }),
);
/** The rows of a list read by their ids alone. */
const IdsSchema = Schema.Array(Schema.Struct({ id: Schema.String }));
const decodeTasks = Schema.decodeUnknownSync(Schema.Struct({ tasks: IdsSchema }));
/** The inbox read, each thread by its id, the ask it holds open, and its messages' asks by their options. */
const decodeInbox = Schema.decodeUnknownSync(
  Schema.Struct({
    threads: Schema.Array(
      Schema.Struct({
        id: Schema.String,
        status: Schema.String,
        askId: Schema.optionalKey(Schema.String),
        waitsOnMember: Schema.Boolean,
        thread: Schema.Array(
          Schema.Struct({
            from: Schema.String,
            ask: Schema.optionalKey(
              Schema.Struct({
                options: Schema.optionalKey(Schema.Array(Schema.Struct({ label: Schema.String }))),
              }),
            ),
          }),
        ),
      }),
    ),
  }),
);
/** A write's answer: the thread as it then stands. */
/** A read_agent's page, each entry by its words and the lineId a line sent to the agent names. */
const decodeTranscript = Schema.decodeUnknownSync(
  Schema.Struct({
    transcript: Schema.Array(
      Schema.Struct({ lineId: Schema.optionalKey(Schema.String), text: Schema.String }),
    ),
  }),
);
const decodeWritten = Schema.decodeUnknownSync(
  Schema.Struct({ thread: Schema.Struct({ status: Schema.String }) }),
);
const decodeStarted = Schema.decodeUnknownSync(
  Schema.Struct({ thread: Schema.Struct({ id: Schema.String, title: Schema.String }) }),
);
const decodeAgents = Schema.decodeUnknownSync(Schema.Struct({ agents: IdsSchema }));
/** An agent's queue as read_agent and change_agent_queue answer it, each message by its id and words. */
const decodeQueue = Schema.decodeUnknownSync(
  Schema.Struct({
    queue: Schema.Struct({
      messages: Schema.Array(Schema.Struct({ id: Schema.String, text: Schema.String })),
    }),
  }),
);
/** A workspace `create_workspace` answers it made. */
const decodeCreated = Schema.decodeUnknownSync(
  Schema.Struct({
    status: Schema.Literal("accepted"),
    workspace: Schema.Struct({
      id: Schema.String,
      slug: Schema.String,
      name: Schema.String,
      role: Schema.String,
    }),
  }),
);

const decodeListed = Schema.decodeUnknownSync(
  Schema.Struct({
    workspaces: Schema.Array(
      Schema.Struct({
        id: Schema.String,
        slug: Schema.String,
        name: Schema.String,
        role: Schema.String,
      }),
    ),
  }),
);

const decodeMade = Schema.decodeUnknownSync(
  Schema.Struct({ task: Schema.Struct({ id: Schema.String, key: Schema.String }) }),
);
const decodeRelated = Schema.decodeUnknownSync(
  Schema.Struct({ task: Schema.Struct({ blockedBy: Schema.Array(Schema.Unknown) }) }),
);
const decodeAutomation = Schema.decodeUnknownSync(
  Schema.Struct({ automation: Schema.Struct({ id: Schema.String }) }),
);

/** A weekly schedule, as an automation's trigger. */
const WEEKLY = {
  kind: AUTOMATION_TRIGGER.SCHEDULE,
  cron: "0 9 * * 1",
  timezone: "Europe/London",
} as const;

const decodeThread = Schema.decodeUnknownSync(
  Schema.Struct({ thread: Schema.String, state: Schema.String }),
);
const decodeThreads = Schema.decodeUnknownSync(
  Schema.Struct({
    threads: Schema.Array(
      Schema.Struct({
        thread: Schema.String,
        on: Schema.String,
        comments: Schema.Array(Schema.Struct({ words: Schema.String })),
      }),
    ),
  }),
);
const decodeKept = Schema.decodeUnknownSync(
  Schema.Struct({ memory: Schema.Struct({ id: Schema.String }) }),
);
const decodeFound = Schema.decodeUnknownSync(
  Schema.Struct({ memories: Schema.Array(Schema.Struct({ id: Schema.String })) }),
);

/** The description a stranger's task and a member's both hold, and the words a thread stands on in it. */
const DESCRIPTION_NOTE = { kind: NOTE_KIND.ADD, section: "Problem", text: "Seats drift." } as const;

/** Task descriptions turned on or off for everyone in the workspace by the admin named, as Settings › Experimental turns it. */
const descriptionsIn = (organizationId: string, by: string, on: boolean) =>
  setWorkspaceExperiment({ organizationId, experiment: EXPERIMENT.DESCRIPTIONS, on, by });

/** Memory turned on for everyone in the workspace by the admin named, as Settings › Experimental turns it on. */
const memoryIn = (organizationId: string, by: string) =>
  setWorkspaceExperiment({ organizationId, experiment: EXPERIMENT.MEMORY, on: true, by });

/** An agent on the task, on Claude Code, its session standing, so a comment handed to it is taken by the recording harness. */
const standingAgent = (userId: string, taskId: string) =>
  Effect.gen(function* () {
    const { agent } = Option.getOrThrow(
      yield* createAgent(userId, {
        taskId,
        idempotencyKey: randomUUID(),
        model: "anthropic/claude-opus-5.5",
        effort: "high",
        repository: null,
        descriptionSnapshot: null,
        prompt: "Size the seats.",
        runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
        payer: AGENT_PAYER.API_KEY,
      }),
    );
    const claimed = yield* claimRuntimeSession(
      { userId, conversationId: agent.conversationId },
      `wrun_${randomUUID()}`,
      yield* DateTime.nowAsDate,
    );
    assert.ok(claimed, "the agent's session stands");
    return agent.id;
  });

/** The JSON Schema goldens of the server's tools, where a tool's input a model is shown is recorded. */
const GOLDEN_ROOT = path.join(
  fileURLToPath(import.meta.url),
  "../../../fixtures/json-schema/member-mcp",
);

/** The golden a tool's input is recorded under: its name, hyphenated, as the package's goldens are named. */
function goldenOf(toolName: string): string {
  return `${toolName.replaceAll("_", "-")}-input`;
}

/** The golden a tool's input is recorded under where no workspace of the member's has Task descriptions on: its off twin's, where its input there differs, its own otherwise. */
function offGoldenOf(tool: MemberMcpTool): string {
  const off = tool.descriptionsOff;
  return off === undefined || off.input === tool.input
    ? goldenOf(tool.name)
    : `${goldenOf(tool.name)}-off`;
}

/** The head commit a changes read answers its pull request at. */
const decodeHead = Schema.decodeUnknownSync(
  Schema.Struct({ pullRequest: Schema.Struct({ headSha: Schema.String }) }),
);

/** A tool's answer as the agent reads it: whether it is the tool's error, and its JSON text read. */
/** The member's default as list_models answers it. */
const decodeDefault = Schema.decodeUnknownSync(
  Schema.Struct({ default: Schema.Struct({ model: Schema.String, effort: Schema.String }) }),
);

const decodeAnswer = Schema.decodeUnknownSync(
  Schema.Struct({
    isError: Schema.optionalKey(Schema.Boolean),
    content: Schema.Tuple([Schema.Struct({ type: Schema.Literal("text"), text: Schema.String })]),
  }),
);

afterEach(() => {
  vi.restoreAllMocks();
});

const ORIGIN = MEMBER_MCP_TEST.ORIGIN;

/** The server over its seeded rows and a GitHub nobody reaches, as most tests here stand it up. */
const standing = memberMcpStanding();

/** The metadata document's address a challenge must name for the resource (RFC 9728). */
const METADATA_URL = `${ORIGIN}/.well-known/oauth-protected-resource${MEMBER_MCP_PATH}`;

it.effect(
  "no token, the desktop's opaque token, and a token for another resource are each refused with the challenge naming the metadata; a token without the scope is refused for its scope; a browser's origin is refused",
  () =>
    Effect.gen(function* () {
      const { auth, fetch } = yield* standing;
      const { cookie } = yield* Effect.promise(() => signUp(auth));
      const desktop = yield* Effect.promise(() =>
        mintedToken(auth, cookie, {
          clientId: DESKTOP_OAUTH_CLIENT.id,
          scope: DESKTOP_OAUTH_CLIENT.scopes,
        }),
      );
      const elsewhere = yield* Effect.promise(() =>
        mintedToken(auth, cookie, {
          clientId: MCP_CLIENT.id,
          scope: [MEMBER_MCP_SCOPE.MCP],
          resource: OTHER_RESOURCE,
        }),
      );
      const unscoped = yield* Effect.promise(() =>
        mintedToken(auth, cookie, {
          clientId: MCP_CLIENT.id,
          scope: [MEMBER_MCP_SCOPE.OFFLINE_ACCESS],
          resource: RESOURCE,
        }),
      );

      for (const bearer of [undefined, desktop, elsewhere]) {
        const refused = yield* post(fetch, bearer);
        assert.equal(refused.status, HOSTED_HTTP_STATUS.UNAUTHORIZED);
        assert.equal(refused.challenge, `Bearer resource_metadata="${METADATA_URL}"`);
      }
      const forbidden = yield* post(fetch, unscoped);
      assert.equal(forbidden.status, HOSTED_HTTP_STATUS.FORBIDDEN);
      assert.match(
        forbidden.challenge ?? "",
        /^Bearer error="insufficient_scope", scope="vespin:mcp"/u,
      );
      const page = yield* post(fetch, undefined, "https://page.test");
      assert.equal(page.status, HOSTED_HTTP_STATUS.FORBIDDEN);
    }),
);

it.effect.each(Object.values(REVISION))(
  "an SDK client at %s lists every tool as its golden shows it, with its annotations, a workspace experiment's only once one of the member's workspaces has it on, and runs list_workspaces as the member",
  (revision) =>
    Effect.gen(function* () {
      const { auth, fetch, services } = yield* standing;
      const { userId, cookie } = yield* Effect.promise(() => signUp(auth));
      const workspaceId = yield* openWorkspace(userId).pipe(Effect.provide(services));
      const token = yield* Effect.promise(() =>
        mintedToken(auth, cookie, {
          clientId: MCP_CLIENT.id,
          scope: [MEMBER_MCP_SCOPE.MCP, MEMBER_MCP_SCOPE.OFFLINE_ACCESS],
          resource: RESOURCE,
        }),
      );
      const { client, transport } = yield* connected(fetch, token, revision);

      const unlisted = yield* Effect.promise(() => client.listTools());
      yield* Effect.forEach(WORKSPACE_EXPERIMENT_LIST, (experiment) =>
        setWorkspaceExperiment({ organizationId: workspaceId, experiment, on: true, by: userId }),
      ).pipe(Effect.provide(services));
      const listed = yield* Effect.promise(() => client.listTools());
      const called = yield* Effect.promise(() =>
        client.callTool({ name: LIST_WORKSPACES_TOOL.name, arguments: {} }),
      );
      yield* Effect.promise(() => client.close());

      assert.equal(transport.protocolVersion, revision);
      const goldenInput = (golden: string) =>
        Effect.promise(async () =>
          JSON.parse(await fs.readFile(path.join(GOLDEN_ROOT, `${golden}.json`), "utf8")),
        );
      // With no experiment on, a tool is listed in the words that name none, its input its off twin's golden where it has one.
      const offGoldens = yield* Effect.forEach(
        MEMBER_MCP_TOOLS.filter(({ experiment }) => experiment === undefined),
        (tool) =>
          Effect.map(goldenInput(offGoldenOf(tool)), (inputSchema) => ({
            name: tool.name,
            inputSchema,
          })),
      );
      assert.deepEqual(
        unlisted.tools.map(({ name, inputSchema }) => ({ name, inputSchema })),
        offGoldens,
      );
      assert.deepEqual(experimentWordsIn(unlisted.tools), []);
      const goldens = yield* Effect.forEach(MEMBER_MCP_TOOLS, ({ name, annotations }) =>
        Effect.map(goldenInput(goldenOf(name)), (inputSchema) => ({
          name,
          inputSchema,
          annotations,
        })),
      );
      assert.deepEqual(
        listed.tools.map(({ name, inputSchema, annotations }) => ({
          name,
          inputSchema,
          annotations,
        })),
        goldens,
      );
      assert.notEqual(called.isError, true, JSON.stringify(called));
      const [content] = called.content;
      assert.ok(content?.type === "text");
      assert.deepEqual(decodeListed(JSON.parse(content.text)), {
        workspaces: [
          {
            id: workspaceId,
            slug: `workspace-${workspaceId}`,
            name: "Test Workspace",
            role: WORKSPACE_ROLE.OWNER,
          },
        ],
      });
    }),
);

it.effect(
  "the member reads their agent's queue with read_agent and changes it with change_agent_queue, a reorder that leaves a message out refused",
  () =>
    Effect.gen(function* () {
      const { auth, fetch, services } = yield* standing;
      const member = yield* Effect.promise(() => signUp(auth));
      const rows = yield* Effect.gen(function* () {
        const workspace = yield* openWorkspace(member.userId);
        const task = yield* createTask(member.userId, {
          organizationId: workspace,
          name: "Seat billing",
        });
        const agentId = yield* openTaskAgent(member.userId, workspace, task.id);
        // Note that the messages are planted in the store, since a queue change would hand the first to the idle agent.
        const first = randomUUID();
        const second = randomUUID();
        yield* queueAgentMessage(member.userId, agentId, { id: first, text: "First" });
        yield* queueAgentMessage(member.userId, agentId, { id: second, text: "Second" });
        return { agentId, first, second };
      }).pipe(Effect.provide(services));
      const token = yield* Effect.promise(() =>
        mintedToken(auth, member.cookie, {
          clientId: MCP_CLIENT.id,
          scope: [MEMBER_MCP_SCOPE.MCP],
          resource: RESOURCE,
        }),
      );
      const { client } = yield* connected(fetch, token, REVISION.MODERN);
      const call = (name: string, args: Record<string, unknown>) =>
        Effect.promise(async () => {
          const answer = decodeAnswer(await client.callTool({ name, arguments: args }));
          return { refused: answer.isError === true, text: answer.content[0].text };
        });
      const { agentId, first, second } = rows;

      const read = yield* call(MEMBER_MCP_TOOL.READ_AGENT, { agentId });
      const reordered = yield* call(MEMBER_MCP_TOOL.CHANGE_AGENT_QUEUE, {
        agentId,
        change: { change: QUEUE_CHANGE.REORDER, order: [second] },
      });
      const deleted = yield* call(MEMBER_MCP_TOOL.CHANGE_AGENT_QUEUE, {
        agentId,
        change: { change: QUEUE_CHANGE.DELETE, messageId: first },
      });
      yield* Effect.promise(() => client.close());

      assert.deepEqual(decodeQueue(JSON.parse(read.text)).queue.messages, [
        { id: first, text: "First" },
        { id: second, text: "Second" },
      ]);
      assert.equal(deleted.refused, false, deleted.text);
      assert.deepEqual(decodeQueue(JSON.parse(deleted.text)).queue.messages, [
        { id: second, text: "Second" },
      ]);
      assert.equal(reordered.refused, true, reordered.text);
    }),
);

it.effect(
  "create_workspace makes a workspace the member owns, which list_workspaces then names",
  () =>
    Effect.gen(function* () {
      const { auth, fetch } = yield* standing;
      const { cookie } = yield* Effect.promise(() => signUp(auth));
      const token = yield* Effect.promise(() =>
        mintedToken(auth, cookie, {
          clientId: MCP_CLIENT.id,
          scope: [MEMBER_MCP_SCOPE.MCP],
          resource: RESOURCE,
        }),
      );
      const { client } = yield* connected(fetch, token, REVISION.MODERN);
      const call = (name: string, args: Record<string, unknown>) =>
        Effect.promise(async () => decodeAnswer(await client.callTool({ name, arguments: args })));

      const created = yield* call(MEMBER_MCP_TOOL.CREATE_WORKSPACE, { name: "  Research  " });
      const listed = yield* call(MEMBER_MCP_TOOL.LIST_WORKSPACES, {});
      yield* Effect.promise(() => client.close());

      assert.notEqual(created.isError, true, created.content[0].text);
      const { workspace } = decodeCreated(JSON.parse(created.content[0].text));
      assert.deepEqual(
        { slug: workspace.slug, name: workspace.name, role: workspace.role },
        { slug: "research", name: "Research", role: WORKSPACE_ROLE.OWNER },
      );
      const ownedIds = decodeListed(JSON.parse(listed.content[0].text)).workspaces.map(
        ({ id }) => id,
      );
      assert.ok(ownedIds.includes(workspace.id));
    }),
);

it.effect(
  "a member with several workspaces lists the one a list names, reads their own tasks, agents, and inbox, and reads, answers, or changes nothing of a workspace they are not in, an agent's pull request among it",
  () =>
    Effect.gen(function* () {
      const { auth, fetch, services } = yield* standing;
      const member = yield* Effect.promise(() => signUp(auth));
      const stranger = yield* Effect.promise(() => signUp(auth));
      const rows = yield* Effect.gen(function* () {
        const own = yield* openWorkspace(member.userId);
        const second = yield* openWorkspace(member.userId);
        const elsewhere = yield* openWorkspace(stranger.userId);
        const ownTask = yield* createTask(member.userId, {
          organizationId: own,
          name: "Seat billing",
        });
        const strangerTask = yield* createTask(stranger.userId, {
          organizationId: elsewhere,
          name: "A stranger's task",
        });
        const ownAgent = yield* openTaskAgent(member.userId, own, ownTask.id);
        const strangerAgent = yield* openTaskAgent(stranger.userId, elsewhere, strangerTask.id);
        return {
          own,
          second,
          elsewhere,
          ownTask: ownTask.id,
          strangerTask: strangerTask.id,
          ownAgent,
          strangerAgent,
          ownItem: yield* openInboxItem(member.userId, own, ownTask.id, ownAgent, true),
          strangerItem: yield* openInboxItem(
            stranger.userId,
            elsewhere,
            strangerTask.id,
            strangerAgent,
            true,
          ),
        };
      }).pipe(Effect.provide(services));
      const strangerAsk = yield* readInboxItem(stranger.userId, rows.strangerItem).pipe(
        Effect.map((stored) => Option.getOrThrow(stored).item),
        Effect.provide(services),
      );
      const token = yield* Effect.promise(() =>
        mintedToken(auth, member.cookie, {
          clientId: MCP_CLIENT.id,
          scope: [MEMBER_MCP_SCOPE.MCP],
          resource: RESOURCE,
        }),
      );
      const { client } = yield* connected(fetch, token, REVISION.MODERN);
      const call = (name: string, args: Record<string, unknown>) =>
        Effect.promise(async () => {
          const answer = decodeAnswer(await client.callTool({ name, arguments: args }));
          return { refused: answer.isError === true, text: answer.content[0].text };
        });
      const slugOf = (workspaceId: string) => `workspace-${workspaceId}`;

      const unnamed = yield* call(MEMBER_MCP_TOOL.LIST_TASKS, {});
      const tasks = yield* call(MEMBER_MCP_TOOL.LIST_TASKS, { workspace: slugOf(rows.own) });
      const agents = yield* call(MEMBER_MCP_TOOL.LIST_AGENTS, { workspace: slugOf(rows.own) });
      const inbox = yield* call(MEMBER_MCP_TOOL.READ_INBOX, { workspace: slugOf(rows.own) });
      const strangers = yield* Effect.forEach(
        [
          [MEMBER_MCP_TOOL.LIST_TASKS, { workspace: slugOf(rows.elsewhere) }],
          [MEMBER_MCP_TOOL.LIST_AGENTS, { workspace: slugOf(rows.elsewhere) }],
          [MEMBER_MCP_TOOL.READ_TASK, { taskId: rows.strangerTask }],
          [MEMBER_MCP_TOOL.READ_AGENT, { agentId: rows.strangerAgent }],
          [MEMBER_MCP_TOOL.READ_AGENT_CHANGES, { agentId: rows.strangerAgent }],
          [MEMBER_MCP_TOOL.READ_AGENT_TRANSCRIPT, { agentId: rows.strangerAgent }],
          [MEMBER_MCP_TOOL.READ_INBOX, { workspace: slugOf(rows.elsewhere) }],
          [
            MEMBER_MCP_TOOL.ANSWER_ASK,
            {
              threadId: rows.strangerItem,
              askId: openAskOf(strangerAsk),
              reply: INBOX_REPLY.CHOSE,
              choices: ["Approve"],
            },
          ],
          [MEMBER_MCP_TOOL.REPLY_TO_THREAD, { threadId: rows.strangerItem, text: "Approve it." }],
          [
            MEMBER_MCP_TOOL.ACKNOWLEDGE_THREAD,
            { threadId: rows.strangerItem, revision: strangerAsk.revision },
          ],
          [
            MEMBER_MCP_TOOL.CLOSE_THREAD,
            { threadId: rows.strangerItem, revision: strangerAsk.revision },
          ],
          [MEMBER_MCP_TOOL.MARK_THREAD_READ, { threadId: rows.strangerItem, read: false }],
          [MEMBER_MCP_TOOL.MARK_INBOX_READ, { workspace: slugOf(rows.elsewhere) }],
          [
            MEMBER_MCP_TOOL.REMIND_THREAD,
            { threadId: rows.strangerItem, at: "2030-01-07T09:00-08:00" },
          ],
          [MEMBER_MCP_TOOL.START_THREAD, { agentId: rows.strangerAgent, text: "Approve it." }],
          [
            MEMBER_MCP_TOOL.AGENT_PULL_REQUEST_ACTION,
            {
              agentId: rows.strangerAgent,
              change: { action: PULL_REQUEST_ACTION.READY_FOR_REVIEW },
            },
          ],
        ] as const,
        ([name, args]) => call(name, args),
      );
      const owns = yield* Effect.forEach(
        [
          [MEMBER_MCP_TOOL.READ_TASK, { taskId: rows.ownTask }],
          [MEMBER_MCP_TOOL.READ_AGENT, { agentId: rows.ownAgent }],
          [MEMBER_MCP_TOOL.READ_AGENT_CHANGES, { agentId: rows.ownAgent }],
          [MEMBER_MCP_TOOL.READ_AGENT_TRANSCRIPT, { agentId: rows.ownAgent }],
        ] as const,
        ([name, args]) => call(name, args),
      );
      yield* Effect.promise(() => client.close());

      // A list that names no workspace is refused where the member has two, naming both and no other.
      assert.equal(unnamed.refused, true);
      assert.ok(
        unnamed.text.includes(slugOf(rows.own)) && unnamed.text.includes(slugOf(rows.second)),
      );
      assert.ok(!unnamed.text.includes(slugOf(rows.elsewhere)));
      assert.deepEqual(
        decodeTasks(JSON.parse(tasks.text)).tasks.map(({ id }) => id),
        [rows.ownTask],
      );
      assert.deepEqual(
        decodeAgents(JSON.parse(agents.text)).agents.map(({ id }) => id),
        [rows.ownAgent],
      );
      assert.deepEqual(
        decodeInbox(JSON.parse(inbox.text)).threads.map(({ id }) => id),
        [rows.ownItem],
      );
      for (const refused of strangers) {
        assert.equal(refused.refused, true, refused.text);
        assert.ok(
          !refused.text.includes(rows.strangerTask) && !refused.text.includes(rows.elsewhere),
        );
      }
      for (const read of owns) assert.equal(read.refused, false, read.text);
      // The stranger's thread stands as it was, its ask open and its thread its agent's alone.
      const after = yield* readInboxItem(stranger.userId, rows.strangerItem).pipe(
        Effect.map((stored) => Option.getOrThrow(stored).item),
        Effect.provide(services),
      );
      assert.deepEqual(after, strangerAsk);
    }),
);

it.effect(
  "a member makes, starts, messages, stops, changes, shares a port of, drives a browser of, plans, comments, remembers, runs, and reads or disconnects the Sentry of nothing in a workspace they are not in",
  () =>
    Effect.gen(function* () {
      const { auth, fetch, services } = yield* standing;
      const member = yield* Effect.promise(() => signUp(auth));
      const stranger = yield* Effect.promise(() => signUp(auth));
      const rows = yield* Effect.gen(function* () {
        const own = yield* openWorkspace(member.userId);
        // The member's own workspace has its experiments on, so their tools are listed to be refused elsewhere.
        yield* memoryIn(own, member.userId);
        yield* descriptionsIn(own, member.userId, true);
        const elsewhere = yield* openWorkspace(stranger.userId);
        const task = yield* createTask(stranger.userId, {
          organizationId: elsewhere,
          name: "A stranger's task",
        });
        const sectionId = randomUUID();
        yield* writeTaskSections(stranger.userId, {
          kind: TASK_SECTION_WRITE.CREATE,
          id: sectionId,
          workspaceId: elsewhere,
          title: "A stranger's section",
        });
        const automation = yield* createAutomation(stranger.userId, {
          organizationId: elsewhere,
          name: "A stranger's automation",
          trigger: WEEKLY,
          action: { kind: AUTOMATION_ACTION.AGENT, prompt: "Sweep." },
          guards: AUTOMATION_DEFAULT_GUARDS,
          nextRunAt: null,
          webhookSecretHash: null,
        });
        yield* recordMemberDescriptionNotes(
          { userId: stranger.userId, taskId: task.id },
          { notes: [DESCRIPTION_NOTE] },
        );
        // A later save, past the window that joins it to the first, so revision 1 holds text the description no longer does.
        yield* TestClock.adjust("11 minutes");
        yield* recordMemberDescriptionNotes(
          { userId: stranger.userId, taskId: task.id },
          { notes: [{ ...DESCRIPTION_NOTE, text: "Invoices lag." }] },
        );
        const { text } = Option.getOrThrow(yield* readTask(stranger.userId, task.id));
        const from = text.indexOf(DESCRIPTION_NOTE.text);
        const started = yield* startDescriptionCommentThread(
          { actor: DESCRIPTION_COMMENT_ACTOR.MEMBER, userId: stranger.userId },
          task.id,
          {
            clientKey: randomUUID(),
            scope: DESCRIPTION_COMMENT_SCOPE.WORDS,
            quote: DESCRIPTION_NOTE.text,
            anchor: { from, to: from + DESCRIPTION_NOTE.text.length },
            text,
            words: "A stranger's comment.",
          },
        );
        assert.ok(
          started.status === DESCRIPTION_COMMENT_OUTCOME.DONE && "thread" in started.answer,
        );
        const kept = yield* rememberMemory(
          elsewhere,
          stranger.userId,
          "A stranger's convention.",
          undefined,
        );
        assert.ok("memory" in kept);
        return {
          own,
          elsewhere,
          text,
          taskId: task.id,
          sectionId,
          threadId: started.answer.thread.id,
          memoryId: kept.memory.id,
          automationId: Option.getOrThrow(automation).id,
          agentId: yield* openTaskAgent(stranger.userId, elsewhere, task.id),
          revisions: yield* listRevisions(stranger.userId, task.id),
        };
      }).pipe(Effect.provide(services));
      const token = yield* Effect.promise(() =>
        mintedToken(auth, member.cookie, {
          clientId: MCP_CLIENT.id,
          scope: [MEMBER_MCP_SCOPE.MCP],
          resource: RESOURCE,
        }),
      );
      const { client } = yield* connected(fetch, token, REVISION.MODERN);
      const workspace = `workspace-${rows.elsewhere}`;
      const { taskId, agentId, threadId, memoryId, automationId } = rows;

      const answers = yield* Effect.forEach(
        [
          [MEMBER_MCP_TOOL.CREATE_TASK, { workspace, name: "Planted" }],
          [MEMBER_MCP_TOOL.UPDATE_TASK, { taskId, name: "Renamed" }],
          [MEMBER_MCP_TOOL.DELETE_TASK, { taskId }],
          [
            MEMBER_MCP_TOOL.EDIT_DESCRIPTION,
            { taskId, notes: [{ kind: NOTE_KIND.ADD, section: "Problem", text: "Planted." }] },
          ],
          [MEMBER_MCP_TOOL.LIST_DESCRIPTION_REVISIONS, { taskId }],
          [MEMBER_MCP_TOOL.READ_DESCRIPTION_REVISION, { taskId, seq: 1 }],
          [MEMBER_MCP_TOOL.RESTORE_DESCRIPTION_REVISION, { taskId, seq: 1 }],
          [MEMBER_MCP_TOOL.CREATE_SECTION, { workspace, title: "Planted" }],
          [MEMBER_MCP_TOOL.DELETE_SECTION, { sectionId: rows.sectionId }],
          [MEMBER_MCP_TOOL.START_AGENT, { taskId }],
          [MEMBER_MCP_TOOL.START_AGENT, { workspace, prompt: "Go." }],
          [MEMBER_MCP_TOOL.START_AGENT, { from: { agentId } }],
          [MEMBER_MCP_TOOL.MESSAGE_AGENT, { agentId, text: "Hello." }],
          [MEMBER_MCP_TOOL.MESSAGE_AGENT, { agentId, text: "Hello.", queue: true }],
          [
            MEMBER_MCP_TOOL.CHANGE_AGENT_QUEUE,
            { agentId, change: { change: QUEUE_CHANGE.RESUME } },
          ],
          [MEMBER_MCP_TOOL.STOP_AGENT, { agentId }],
          [MEMBER_MCP_TOOL.UPDATE_AGENT, { agentId, archived: true }],
          [MEMBER_MCP_TOOL.LIST_AGENT_PORTS, { agentId }],
          [MEMBER_MCP_TOOL.SHARE_AGENT_PORT, { agentId, port: 3000 }],
          [MEMBER_MCP_TOOL.LIST_AGENT_BROWSER_TABS, { agentId }],
          [MEMBER_MCP_TOOL.OPEN_AGENT_BROWSER_TAB, { agentId, address: "https://example.com/" }],
          [MEMBER_MCP_TOOL.TAKE_OVER_AGENT_BROWSER_TAB, { agentId, tabId: randomUUID() }],
          [MEMBER_MCP_TOOL.HAND_BACK_AGENT_BROWSER_TAB, { agentId, tabId: randomUUID() }],
          [MEMBER_MCP_TOOL.READ_COMMENTS, { taskId }],
          [
            MEMBER_MCP_TOOL.COMMENT_ON_DESCRIPTION,
            { taskId, quote: DESCRIPTION_NOTE.text, words: "Planted." },
          ],
          [MEMBER_MCP_TOOL.REPLY_TO_COMMENT, { taskId, thread: threadId, words: "Planted." }],
          [MEMBER_MCP_TOOL.UPDATE_COMMENT, { taskId, thread: threadId, resolved: true }],
          [MEMBER_MCP_TOOL.SEARCH_MEMORY, { workspace }],
          [MEMBER_MCP_TOOL.SAVE_MEMORY, { workspace, text: "Planted." }],
          // Note that the member's own workspace holds no memory of that id, so a correction of it is refused.
          [
            MEMBER_MCP_TOOL.SAVE_MEMORY,
            { workspace: `workspace-${rows.own}`, text: "Planted.", replaces: memoryId },
          ],
          [MEMBER_MCP_TOOL.LIST_MEMORIES, { workspace }],
          [MEMBER_MCP_TOOL.FORGET_MEMORY, { workspace, memoryId }],
          [MEMBER_MCP_TOOL.LIST_AUTOMATIONS, { workspace }],
          [MEMBER_MCP_TOOL.LIST_AUTOMATIONS, { automationId }],
          [
            MEMBER_MCP_TOOL.CREATE_AUTOMATION,
            { workspace, name: "Planted", prompt: "Go.", trigger: WEEKLY },
          ],
          [MEMBER_MCP_TOOL.UPDATE_AUTOMATION, { automationId, name: "Renamed" }],
          [MEMBER_MCP_TOOL.RUN_AUTOMATION, { automationId }],
          [MEMBER_MCP_TOOL.DELETE_AUTOMATION, { automationId }],
          [MEMBER_MCP_TOOL.READ_SANDBOX_SETUP, { workspace }],
          [MEMBER_MCP_TOOL.EDIT_SANDBOX_SETUP, { workspace, script: "Planted." }],
          [MEMBER_MCP_TOOL.LIST_SENTRY_INSTALLATIONS, { workspace }],
          [MEMBER_MCP_TOOL.DISCONNECT_SENTRY, { workspace, installationId: randomUUID() }],
        ] as const,
        ([name, args]) =>
          Effect.promise(async () => {
            const answer = decodeAnswer(await client.callTool({ name, arguments: args }));
            return { name, refused: answer.isError === true, text: answer.content[0].text };
          }),
      );
      // A forget in the member's own workspace of a memory of another's forgets nothing there.
      yield* Effect.promise(() =>
        client.callTool({
          name: MEMBER_MCP_TOOL.FORGET_MEMORY,
          arguments: { workspace: `workspace-${rows.own}`, memoryId },
        }),
      );
      yield* Effect.promise(() => client.close());
      const after = yield* Effect.gen(function* () {
        return {
          task: yield* readTask(stranger.userId, taskId),
          revisions: yield* listRevisions(stranger.userId, taskId),
          sections: yield* listTaskSections(stranger.userId),
          agent: yield* readAgent(stranger.userId, agentId),
          threads: yield* readDescriptionCommentThreads(stranger.userId, taskId),
          memories: yield* listMemories(rows.elsewhere),
          ownMemories: yield* listMemories(rows.own),
          automation: yield* readAutomation(stranger.userId, automationId),
          runs: yield* listAutomationRuns(stranger.userId, automationId),
        };
      }).pipe(Effect.provide(services));

      // A delete of a section the member keeps none of is deleted as nothing, as the sidebar's is.
      for (const answer of answers) {
        const deletes = answer.name === MEMBER_MCP_TOOL.DELETE_SECTION;
        assert.equal(answer.refused, !deletes, `${answer.name}: ${answer.text}`);
        assert.ok(
          !answer.text.includes(taskId) &&
            !answer.text.includes(rows.elsewhere) &&
            !answer.text.includes("A stranger's") &&
            !answer.text.includes("Invoices lag."),
        );
      }
      const task = Option.getOrThrow(after.task);
      assert.equal(task.task.name, "A stranger's task");
      // Revision 1 is the first save alone, so a restore of it would have changed the description and added a revision.
      assert.deepEqual(
        rows.revisions.revisions.map(({ seq }) => seq),
        [2, 1],
      );
      assert.equal(task.text, rows.text);
      assert.deepEqual(after.revisions, rows.revisions);
      assert.deepEqual(
        Option.getOrThrow(after.threads).map((thread) => ({
          status: thread.status,
          comments: thread.entries.map(({ words }) => words),
        })),
        [{ status: DESCRIPTION_COMMENT_STATUS.OPEN, comments: ["A stranger's comment."] }],
      );
      assert.deepEqual(
        after.memories.map(({ text }) => text),
        ["A stranger's convention."],
      );
      assert.deepEqual(after.ownMemories, []);
      assert.deepEqual(
        after.sections.sections.map(({ id }) => id),
        [rows.sectionId],
      );
      assert.equal(Option.getOrThrow(after.agent).archivedAt, null);
      assert.equal(Option.getOrThrow(after.automation).name, "A stranger's automation");
      assert.deepEqual(after.runs, []);
    }),
);

it.effect(
  "a task a member makes, its description's notes, an agent they archive, and an automation they make, change, run, and delete are the member's own, as the desktop shows them",
  () =>
    Effect.gen(function* () {
      const { auth, fetch, services } = yield* standing;
      const member = yield* Effect.promise(() => signUp(auth));
      const agentId = yield* Effect.gen(function* () {
        const own = yield* openWorkspace(member.userId);
        yield* descriptionsIn(own, member.userId, true);
        return yield* openAgentOnOwnTask(member.userId, own);
      }).pipe(Effect.provide(services));
      const token = yield* Effect.promise(() =>
        mintedToken(auth, member.cookie, {
          clientId: MCP_CLIENT.id,
          scope: [MEMBER_MCP_SCOPE.MCP],
          resource: RESOURCE,
        }),
      );
      const { client } = yield* connected(fetch, token, REVISION.MODERN);
      const call = (name: string, args: Record<string, unknown>) =>
        Effect.promise(async () => {
          const answer = decodeAnswer(await client.callTool({ name, arguments: args }));
          assert.notEqual(answer.isError, true, `${name}: ${answer.content[0].text}`);
          return JSON.parse(answer.content[0].text);
        });

      const made = decodeMade(
        yield* call(MEMBER_MCP_TOOL.CREATE_TASK, {
          name: "Seat billing",
          description: "## Problem\n\nSeats drift.",
        }),
      );
      const taskId = made.task.id;
      const refused = (name: string, args: Record<string, unknown>) =>
        Effect.promise(async () => {
          const answer = decodeAnswer(await client.callTool({ name, arguments: args }));
          assert.equal(answer.isError, true, name);
          return answer.content[0].text;
        });
      // A client that listed the tools before the rename is told what each is called now, and nothing is written.
      assert.match(
        yield* refused("edit_plan", {
          taskId,
          notes: [{ kind: NOTE_KIND.ADD, section: "Problem", text: "Written by the old name." }],
        }),
        /`edit_description`/u,
      );
      assert.match(
        yield* refused("comment_on_plan", { taskId, quote: "Seats drift.", words: "Why?" }),
        /`comment_on_description`/u,
      );
      assert.match(
        yield* refused(MEMBER_MCP_TOOL.CREATE_TASK, { name: "Seat billing", plan: "## Problem" }),
        /named description, not plan/u,
      );
      assert.match(
        yield* refused(MEMBER_MCP_TOOL.CREATE_TASK, {
          name: "Seat billing",
          relation: { kind: "blocks", taskId },
        }),
        /takes no relation now/u,
      );
      yield* call(MEMBER_MCP_TOOL.EDIT_DESCRIPTION, {
        taskId,
        notes: [{ kind: NOTE_KIND.ADD, section: "Problem", text: "Invoices lag too." }],
      });
      yield* call(MEMBER_MCP_TOOL.UPDATE_TASK, { taskId, status: TASK_STATUS.IN_PROGRESS });
      // A task found by its key is the one made; a blocker of it moved to its sub-task in one call.
      const found = decodeMade(yield* call(MEMBER_MCP_TOOL.FIND_TASK, { task: made.task.key }));
      const blockerId = decodeMade(
        yield* call(MEMBER_MCP_TOOL.CREATE_TASK, { name: "Invoice lag" }),
      ).task.id;
      yield* call(MEMBER_MCP_TOOL.UPDATE_TASK, { taskId, blockedBy: { add: [blockerId] } });
      yield* call(MEMBER_MCP_TOOL.CHANGE_TASK_RELATION, {
        taskId,
        otherTaskId: blockerId,
        from: TASK_RELATION_KIND.BLOCKED_BY,
        to: TASK_RELATION_KIND.SUB_TASK,
      });
      const related = decodeRelated(yield* call(MEMBER_MCP_TOOL.READ_TASK, { taskId }));
      yield* call(MEMBER_MCP_TOOL.UPDATE_AGENT, { agentId, archived: true, reason: "Done." });
      const automationId = decodeAutomation(
        yield* call(MEMBER_MCP_TOOL.CREATE_AUTOMATION, {
          name: "Weekly sweep",
          prompt: "Sweep.",
          trigger: WEEKLY,
        }),
      ).automation.id;
      yield* call(MEMBER_MCP_TOOL.UPDATE_AUTOMATION, { automationId, name: "Monday sweep" });
      yield* call(MEMBER_MCP_TOOL.RUN_AUTOMATION, { automationId });
      const automations = yield* Effect.gen(function* () {
        return {
          made: Option.getOrThrow(yield* readAutomation(member.userId, automationId)),
          runs: yield* listAutomationRuns(member.userId, automationId),
        };
      }).pipe(Effect.provide(services));
      yield* call(MEMBER_MCP_TOOL.DELETE_AUTOMATION, { automationId });
      yield* Effect.promise(() => client.close());
      const after = yield* Effect.gen(function* () {
        return {
          task: Option.getOrThrow(yield* readTask(member.userId, taskId)),
          blocker: Option.getOrThrow(yield* readTask(member.userId, blockerId)),
          revisions: yield* listRevisions(member.userId, taskId),
          agent: Option.getOrThrow(yield* readAgent(member.userId, agentId)),
          automation: yield* readAutomation(member.userId, automationId),
        };
      }).pipe(Effect.provide(services));

      assert.equal(after.task.ownerId, member.userId);
      assert.equal(after.task.task.status, TASK_STATUS.IN_PROGRESS);
      assert.equal(found.task.id, taskId);
      assert.deepEqual(related.task.blockedBy, []);
      assert.equal(after.blocker.task.parentTaskId, taskId);
      assert.equal(after.task.text, "## Problem\n\nSeats drift.\n\nInvoices lag too.");
      // The description's first text and the note are the member's own, as their window writes it, and no agent's.
      assert.deepEqual(
        [...new Set(after.revisions.revisions.map(({ lastEdit }) => lastEdit.actor))],
        [DESCRIPTION_ACTOR.DEVELOPER],
      );
      assert.deepEqual(after.agent.archivedBy, {
        by: AGENT_ARCHIVER.MEMBER,
        userId: member.userId,
        reason: "Done.",
      });
      // The automation is the member's, in no repository since they work in none, and its run is their Run now.
      assert.deepEqual(
        [automations.made.userId, automations.made.name, automations.made.repositories],
        [member.userId, "Monday sweep", []],
      );
      assert.deepEqual(
        automations.runs.map(({ firing }) => firing),
        [{ kind: AUTOMATION_FIRING.MANUAL, userId: member.userId }],
      );
      assert.ok(Option.isNone(after.automation));
    }),
);

it.effect(
  "an outside agent marks the member's agent's draft ready and merges it against the head read_agent_changes answered, on the member's own GitHub sign-in as the Pull request tab does, and a teammate with no GitHub sign-in is told to sign in, with nothing made",
  () =>
    Effect.gen(function* () {
      const calls: GraphqlCall[] = [];
      const drafted = publishedPullRequestDrafted(() => true);
      const installation = freshInstallation();
      const github = githubReaching(
        [installation],
        undefined,
        undefined,
        graphqlAnswering(calls, undefined, (sent) =>
          new URL(sent.url).pathname === `/repos/${RELAY_FULL_NAME}/pulls/${PUBLISHED.number}/files`
            ? Response.json([])
            : drafted(sent),
        ),
      );
      const { auth, fetch, services } = yield* memberMcpStanding({ github: github.layer });
      const member = yield* Effect.promise(() => signUp(auth));
      const teammate = yield* Effect.promise(() => signUp(auth));
      const agentId = yield* Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        yield* signInWithGitHub(member.userId, {
          ...standingGithubRow(now),
          accessToken: MEMBER_GITHUB_TOKEN,
        });
        const workspaceId = yield* openWorkspace(member.userId);
        yield* joinWorkspace(workspaceId, teammate.userId);
        yield* connectWorkspaceGitHub(workspaceId, installation);
        const task = yield* createTask(member.userId, {
          organizationId: workspaceId,
          name: "Teammate invitations",
        });
        const id = yield* openTaskAgent(member.userId, workspaceId, task.id);
        // The agent pushed its branch to the repository the installation reaches, from which its draft stands open.
        yield* Database.use((db) =>
          db
            .update(agentTable)
            .set({
              repository: RELAY_FULL_NAME,
              branch: PUBLISHED.branch,
            })
            .where(eq(agentTable.id, id)),
        );
        return id;
      }).pipe(Effect.provide(services));
      const clientOf = (cookie: string) =>
        Effect.flatMap(
          Effect.promise(() =>
            mintedToken(auth, cookie, {
              clientId: MCP_CLIENT.id,
              scope: [MEMBER_MCP_SCOPE.MCP],
              resource: RESOURCE,
            }),
          ),
          (token) => Effect.map(connected(fetch, token, REVISION.MODERN), ({ client }) => client),
        );
      const memberClient = yield* clientOf(member.cookie);
      const teammateClient = yield* clientOf(teammate.cookie);
      const act = (client: Client, change: Record<string, string>) =>
        Effect.promise(async () =>
          decodeAnswer(
            await client.callTool({
              name: MEMBER_MCP_TOOL.AGENT_PULL_REQUEST_ACTION,
              arguments: { agentId, change },
            }),
          ),
        );

      const unsigned = yield* act(teammateClient, { action: PULL_REQUEST_ACTION.READY_FOR_REVIEW });
      const ready = yield* act(memberClient, { action: PULL_REQUEST_ACTION.READY_FOR_REVIEW });
      const changes = yield* Effect.promise(async () =>
        decodeAnswer(
          await memberClient.callTool({
            name: MEMBER_MCP_TOOL.READ_AGENT_CHANGES,
            arguments: { agentId },
          }),
        ),
      );
      const { headSha } = decodeHead(JSON.parse(changes.content[0].text)).pullRequest;
      const merged = yield* act(memberClient, {
        action: PULL_REQUEST_ACTION.MERGE,
        method: "squash",
        headSha,
      });
      yield* Effect.promise(() => Promise.all([memberClient.close(), teammateClient.close()]));

      assert.equal(unsigned.isError, true);
      assert.match(unsigned.content[0].text, /sign in with GitHub/u);
      for (const answer of [ready, merged]) {
        assert.notEqual(answer.isError, true, answer.content[0].text);
        assert.deepEqual(JSON.parse(answer.content[0].text), { status: "accepted" });
      }
      assert.equal(headSha, PUBLISHED.headSha);
      const id = PULL_REQUEST_NODE_ID;
      assert.deepEqual(
        calls.flatMap((call) => {
          const mutation = mutationOf(call);
          return mutation === undefined ? [] : [[mutation, call.variables, call.authorization]];
        }),
        [
          ["markPullRequestReadyForReview", { id }, `Bearer ${MEMBER_GITHUB_TOKEN}`],
          [
            "mergePullRequest",
            { id, method: "SQUASH", head: PUBLISHED.headSha },
            `Bearer ${MEMBER_GITHUB_TOKEN}`,
          ],
        ],
      );
    }),
);

it.effect(
  "an outside agent reads a pull request by its repository and number or by the agent that opened it, its files with the member's viewed marks, and marks them on the member's own GitHub sign-in",
  () =>
    Effect.gen(function* () {
      const calls: GraphqlCall[] = [];
      const installation = freshInstallation();
      const files = [
        {
          filename: "src/invite.ts",
          status: "modified",
          additions: 3,
          deletions: 1,
          changes: 4,
          patch: "@@ -1 +1 @@",
        },
        {
          filename: "src/expire.ts",
          status: "added",
          additions: 1,
          deletions: 0,
          changes: 1,
          patch: "@@ -0,0 +1 @@",
        },
      ];
      const github = githubReaching(
        [installation],
        undefined,
        undefined,
        graphqlAnswering(
          calls,
          (call) =>
            Response.json({
              data: call.query.includes("mutation")
                ? {}
                : call.query.includes("viewerViewedState")
                  ? {
                      repository: {
                        pullRequest: {
                          files: {
                            nodes: [{ path: "src/invite.ts", viewerViewedState: "VIEWED" }],
                            pageInfo: { hasNextPage: false, endCursor: null },
                          },
                        },
                      },
                    }
                  : { repository: { pullRequest: { id: PULL_REQUEST_NODE_ID } } },
            }),
          (sent) =>
            new URL(sent.url).pathname ===
            `/repos/${RELAY_FULL_NAME}/pulls/${PUBLISHED.number}/files`
              ? Response.json(files)
              : publishedPullRequest(sent),
        ),
      );
      const { auth, fetch, services } = yield* memberMcpStanding({ github: github.layer });
      const member = yield* Effect.promise(() => signUp(auth));
      const agents = yield* Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        yield* signInWithGitHub(member.userId, {
          ...standingGithubRow(now),
          accessToken: MEMBER_GITHUB_TOKEN,
        });
        const workspaceId = yield* openWorkspace(member.userId);
        yield* connectWorkspaceGitHub(workspaceId, installation);
        const task = yield* createTask(member.userId, {
          organizationId: workspaceId,
          name: "Teammate invitations",
        });
        const published = yield* openTaskAgent(member.userId, workspaceId, task.id);
        // One agent pushed the branch its pull request stands open from; the other has opened none yet.
        yield* Database.use((db) =>
          db
            .update(agentTable)
            .set({ repository: RELAY_FULL_NAME, branch: PUBLISHED.branch })
            .where(eq(agentTable.id, published)),
        );
        return {
          published,
          unpublished: yield* openTaskAgent(member.userId, workspaceId, task.id),
        };
      }).pipe(Effect.provide(services));
      const token = yield* Effect.promise(() =>
        mintedToken(auth, member.cookie, {
          clientId: MCP_CLIENT.id,
          scope: [MEMBER_MCP_SCOPE.MCP],
          resource: RESOURCE,
        }),
      );
      const { client } = yield* connected(fetch, token, REVISION.MODERN);
      const named = { repository: RELAY_FULL_NAME, number: PUBLISHED.number };
      const call = (name: string, args: Record<string, unknown>) =>
        Effect.promise(async () => decodeAnswer(await client.callTool({ name, arguments: args })));

      const changes = yield* call(MEMBER_MCP_TOOL.READ_PULL_REQUEST, { ...named, part: "changes" });
      const missing = yield* call(MEMBER_MCP_TOOL.READ_PULL_REQUEST, { ...named, number: 13 });
      const marked = yield* call(MEMBER_MCP_TOOL.MARK_PULL_REQUEST_FILES_VIEWED, {
        ...named,
        paths: ["src/expire.ts"],
        viewed: true,
      });
      const agentChanges = yield* call(MEMBER_MCP_TOOL.READ_PULL_REQUEST, {
        agentId: agents.published,
        part: "changes",
      });
      const agentMarked = yield* call(MEMBER_MCP_TOOL.MARK_PULL_REQUEST_FILES_VIEWED, {
        agentId: agents.published,
        paths: ["src/invite.ts"],
        viewed: false,
      });
      const unopened = yield* call(MEMBER_MCP_TOOL.READ_PULL_REQUEST, {
        agentId: agents.unpublished,
      });
      yield* Effect.promise(() => client.close());

      // The agent's own pull request is the same pull request, read through the agent.
      for (const read of [changes, agentChanges]) {
        assert.notEqual(read.isError, true, read.content[0].text);
        assert.deepEqual(
          JSON.parse(read.content[0].text).files.map(
            ({ path, viewed }: { path: string; viewed: string }) => [path, viewed],
          ),
          [
            ["src/invite.ts", "viewed"],
            ["src/expire.ts", "unviewed"],
          ],
        );
      }
      assert.equal(unopened.isError, true);
      assert.match(unopened.content[0].text, /opened no pull request yet/u);
      // A number the repository holds no pull request under is refused as the hosted read refuses it.
      assert.equal(missing.isError, true);
      assert.match(missing.content[0].text, /no pull request of that number/u);
      assert.notEqual(marked.isError, true, marked.content[0].text);
      assert.notEqual(agentMarked.isError, true, agentMarked.content[0].text);
      assert.deepEqual(
        calls.flatMap((one) => {
          const mutation = mutationOf(one);
          return mutation === undefined ? [] : [[mutation, one.variables, one.authorization]];
        }),
        [
          [
            "markFileAsViewed",
            { id: PULL_REQUEST_NODE_ID, path: "src/expire.ts" },
            `Bearer ${MEMBER_GITHUB_TOKEN}`,
          ],
          [
            "unmarkFileAsViewed",
            { id: PULL_REQUEST_NODE_ID, path: "src/invite.ts" },
            `Bearer ${MEMBER_GITHUB_TOKEN}`,
          ],
        ],
      );
    }),
);
it.layer(getTestDB())("a member's start_agent on no task", (it) => {
  it.effect(
    "starts the agent on a task made for it, untitled for the agent's title to name, assigned to the member, in progress with a blank description, in the repository named, and refuses a branch with no repository",
    () =>
      Effect.gen(function* () {
        const agentSessions = fakeAgentSessions();
        const { owner, mcpFetch } = yield* openTask({ agentSessions });
        const { client } = yield* connected(mcpFetch, owner, REVISION.MODERN);
        const call = (args: Record<string, unknown>) =>
          Effect.promise(async () =>
            decodeAnswer(
              await client.callTool({ name: MEMBER_MCP_TOOL.START_AGENT, arguments: args }),
            ),
          );
        const prompt = "Sweep the stale invitations.";
        const started = yield* call({ prompt, repository: RELAY_FULL_NAME });
        const bare = yield* call({ prompt, repository: null, branch: "release" });
        yield* Effect.promise(() => client.close());

        assert.notEqual(started.isError, true, started.content[0].text);
        const agentId: unknown = JSON.parse(started.content[0].text).agent?.id;
        assert.ok(typeof agentId === "string", started.content[0].text);
        const agent = Option.getOrThrow(yield* readAgent(owner, agentId));
        assert.ok(agent.prompt?.includes(prompt), "the prompt is handed to the agent");
        const made = Option.getOrThrow(yield* readTask(owner, agent.taskId));
        assert.deepEqual(
          [
            made.task.name,
            made.task.assignee?.userId,
            made.task.status,
            made.task.repository,
            made.text,
          ],
          [UNTITLED_TASK_NAME, owner, TASK_STATUS.IN_PROGRESS, RELAY_FULL_NAME, ""],
        );
        assert.ok(
          bare.content[0].text.includes(START_AGENT_REFUSAL.BRANCH_NO_REPOSITORY),
          bare.content[0].text,
        );
      }),
  );
});

it.layer(getTestDB())("the member's inbox over a started agent", (it) => {
  it.effect(
    "an outside agent reads the decide ask waiting on the member, answers it, and the agent that asked takes the answer up as the member's",
    () =>
      Effect.gen(function* () {
        const agentSessions = fakeAgentSessions();
        const { owner, task, ask, mcpFetch } = yield* openTask({ agentSessions });
        const { agent, target } = yield* startedAgent(owner, task.id, ask);
        const sessionId = agentSessions.opened[0]?.sessionId ?? "";
        assert.equal(
          yield* claimRuntimeSession(target, sessionId, yield* DateTime.nowAsDate),
          true,
        );
        const posted = yield* postInboxThread(
          { userId: owner, taskId: task.id, agentId: agent.id },
          {
            key: "invite-expiry",
            title: "How long should an invitation stand?",
            body: "An invitation nobody accepts expires after this.",
            ask: { type: INBOX_ASK.DECIDE, options: [{ label: "7 days" }, { label: "30 days" }] },
          },
        );
        assert.ok(Result.isSuccess(posted));
        const askId = openAskOf(posted.success);
        const before = agentSessions.sent.length;
        const { client } = yield* connected(mcpFetch, owner, REVISION.MODERN);
        const call = (name: string, args: Record<string, unknown>) =>
          Effect.promise(async () =>
            decodeAnswer(await client.callTool({ name, arguments: args })),
          );

        const read = yield* call(MEMBER_MCP_TOOL.READ_INBOX, {});
        const answered = yield* call(MEMBER_MCP_TOOL.ANSWER_ASK, {
          threadId: posted.success.id,
          askId,
          reply: INBOX_REPLY.CHOSE,
          choices: ["30 days"],
        });
        yield* Effect.promise(() => client.close());

        assert.notEqual(read.isError, true, read.content[0].text);
        const [waiting] = decodeInbox(JSON.parse(read.content[0].text)).threads;
        assert.deepEqual(
          [
            waiting?.id,
            waiting?.askId,
            waiting?.waitsOnMember,
            waiting?.thread.at(-1)?.ask?.options?.map(({ label }) => label),
          ],
          [posted.success.id, askId, true, ["7 days", "30 days"]],
        );
        assert.notEqual(answered.isError, true, answered.content[0].text);
        assert.equal(
          decodeWritten(JSON.parse(answered.content[0].text)).thread.status,
          INBOX_STATUS.ANSWERED,
        );
        // The answer is handed to the session the agent runs in, as the member's message its next turn opens on.
        assert.deepEqual(
          agentSessions.sent.slice(before).map((each) => [each.authorization, each.sessionId]),
          [[harnessFor(owner), sessionId]],
        );
        const handed = JSON.stringify(agentSessions.sent.at(-1)?.message.message);
        assert.ok(handed.includes(INBOX_ANSWER_LEAD) && handed.includes("30 days"), handed);
      }),
  );

  it.effect(
    "an outside agent acknowledges a notice the member saw, and is refused one that holds an ask, which only an answer settles",
    () =>
      Effect.gen(function* () {
        const { owner, task, ask, mcpFetch } = yield* openTask({});
        const { agent } = yield* startedAgent(owner, task.id, ask);
        const where = { userId: owner, taskId: task.id, agentId: agent.id };
        const notice = yield* postInboxThread(where, {
          key: "deploy-done",
          title: "Deployed to staging",
          body: "Staging runs the new build.",
        });
        const asking = yield* postInboxThread(where, {
          key: "invite-expiry",
          title: "How long should an invitation stand?",
          body: "An invitation nobody accepts expires after this.",
          ask: { type: INBOX_ASK.DECIDE, options: [{ label: "7 days" }, { label: "30 days" }] },
        });
        assert.ok(Result.isSuccess(notice) && Result.isSuccess(asking));
        const { client } = yield* connected(mcpFetch, owner, REVISION.MODERN);
        const call = (name: string, args: Record<string, unknown>) =>
          Effect.promise(async () =>
            decodeAnswer(await client.callTool({ name, arguments: args })),
          );

        const nodded = yield* call(MEMBER_MCP_TOOL.ACKNOWLEDGE_THREAD, {
          threadId: notice.success.id,
          revision: notice.success.revision,
        });
        const refused = yield* call(MEMBER_MCP_TOOL.ACKNOWLEDGE_THREAD, {
          threadId: asking.success.id,
          revision: asking.success.revision,
        });
        yield* Effect.promise(() => client.close());

        assert.notEqual(nodded.isError, true, nodded.content[0].text);
        assert.equal(
          decodeWritten(JSON.parse(nodded.content[0].text)).thread.status,
          INBOX_STATUS.ANSWERED,
        );
        assert.equal(refused.isError, true);
        assert.ok(refused.content[0].text.includes(MEMBER_MCP_TOOL.ANSWER_ASK));
      }),
  );

  it.effect(
    "an outside agent rewinds the member's agent to just before a line by the lineId read_agent names, dropping it, then deletes the agent for good",
    () =>
      Effect.gen(function* () {
        const { owner, task, ask, mcpFetch } = yield* openTask({});
        const { agent, target } = yield* startedAgent(owner, task.id, ask);
        const writer = yield* storeWriter({ tools: CODER_TOOL_SET });
        yield* writer.writeAwaitingLine(
          target,
          {
            text: "Why does it stall?",
            clientKey: randomUUID(),
            sender: { kind: MESSAGE_SENDER.MEMBER, userId: owner },
          },
          Effect.succeed(true),
        );
        const { client } = yield* connected(mcpFetch, owner, REVISION.MODERN);
        const call = (name: string, args: Record<string, unknown>) =>
          Effect.promise(async () =>
            decodeAnswer(await client.callTool({ name, arguments: args })),
          );
        const transcript = (read: ReturnType<typeof decodeAnswer>) =>
          decodeTranscript(JSON.parse(read.content[0].text)).transcript;

        const before = transcript(
          yield* call(MEMBER_MCP_TOOL.READ_AGENT, { agentId: agent.id, from: "start" }),
        );
        const line = before.at(-1);
        assert.ok(line?.lineId !== undefined, "a line sent to the agent names its lineId");
        assert.match(line.text, /Why does it stall\?/u);
        const rewound = yield* call(MEMBER_MCP_TOOL.REWIND_AGENT, {
          agentId: agent.id,
          lineId: line.lineId,
        });
        assert.notEqual(rewound.isError, true, rewound.content[0].text);
        const after = transcript(
          yield* call(MEMBER_MCP_TOOL.READ_AGENT, { agentId: agent.id, from: "start" }),
        );
        const deleted = yield* call(MEMBER_MCP_TOOL.DELETE_AGENT, { agentId: agent.id });
        const gone = yield* call(MEMBER_MCP_TOOL.READ_AGENT, { agentId: agent.id });
        yield* Effect.promise(() => client.close());

        assert.deepEqual(after, before.slice(0, -1), "the line is dropped, and nothing before it");
        assert.notEqual(deleted.isError, true, deleted.content[0].text);
        assert.ok(Option.isNone(yield* readAgent(owner, agent.id)), "the agent is deleted");
        assert.match(gone.content[0].text, /rejected/u);
      }),
  );

  it.effect(
    "an outside agent starts a thread with the member's agent, which takes it up as the member's message, and marks it unread and sets its reminder for the member, refusing a time already past",
    () =>
      Effect.gen(function* () {
        const agentSessions = fakeAgentSessions();
        const { owner, task, ask, mcpFetch } = yield* openTask({ agentSessions });
        const { agent, target } = yield* startedAgent(owner, task.id, ask);
        const sessionId = agentSessions.opened[0]?.sessionId ?? "";
        assert.equal(
          yield* claimRuntimeSession(target, sessionId, yield* DateTime.nowAsDate),
          true,
        );
        const before = agentSessions.sent.length;
        const { client } = yield* connected(mcpFetch, owner, REVISION.MODERN);
        const call = (name: string, args: Record<string, unknown>) =>
          Effect.promise(async () => {
            const answer = decodeAnswer(await client.callTool({ name, arguments: args }));
            assert.notEqual(answer.isError, true, `${name}: ${answer.content[0].text}`);
            return JSON.parse(answer.content[0].text);
          });

        const started = decodeStarted(
          yield* call(MEMBER_MCP_TOOL.START_THREAD, {
            agentId: agent.id,
            title: "Flaky checkout test",
            text: "Can you look at the flaky checkout test?",
          }),
        );
        const unread = yield* call(MEMBER_MCP_TOOL.MARK_THREAD_READ, {
          threadId: started.thread.id,
          read: false,
        });
        const reminded = yield* call(MEMBER_MCP_TOOL.REMIND_THREAD, {
          threadId: started.thread.id,
          at: "2030-01-07T09:00-08:00",
        });
        yield* TestClock.setTime(Date.parse("2026-11-10T00:00Z"));
        const past = yield* Effect.promise(async () =>
          decodeAnswer(
            await client.callTool({
              name: MEMBER_MCP_TOOL.REMIND_THREAD,
              arguments: { threadId: started.thread.id, at: "2020-01-07T09:00-08:00" },
            }),
          ),
        );
        yield* Effect.promise(() => client.close());

        assert.equal(started.thread.title, "Flaky checkout test");
        assert.deepEqual(
          agentSessions.sent.slice(before).map((each) => [each.authorization, each.sessionId]),
          [[harnessFor(owner), sessionId]],
        );
        const handed = JSON.stringify(agentSessions.sent.at(-1)?.message.message);
        assert.ok(handed.includes("flaky checkout test"), handed);
        assert.equal(unread.unread, true);
        assert.deepEqual([reminded.remindAt, reminded.unread], ["2030-01-07T17:00:00.000Z", true]);
        // A time already past is refused, so the reminder set before it stands.
        assert.equal(past.isError, true, past.content[0].text);
      }),
  );
});

it.effect(
  "a member's thread and reply are their own and reach the agent in the thread as the window's do, and resolving settles it; in a workspace with Task descriptions off no thread is started on the description, while another of theirs has it on",
  () =>
    Effect.gen(function* () {
      const { auth, fetch, services, heard } = yield* standing;
      const member = yield* Effect.promise(() => signUp(auth));
      const { own, taskId, agentId } = yield* Effect.gen(function* () {
        const own = yield* openWorkspace(member.userId);
        // A second workspace keeps Task descriptions on, so the tool stays listed once the first turns it off.
        for (const workspace of [own, yield* openWorkspace(member.userId)]) {
          yield* descriptionsIn(workspace, member.userId, true);
        }
        yield* connectAgentApiKeys(member.userId);
        const task = yield* createTask(member.userId, { organizationId: own, name: "Seats" });
        yield* recordMemberDescriptionNotes(
          { userId: member.userId, taskId: task.id },
          { notes: [DESCRIPTION_NOTE] },
        );
        return { own, taskId: task.id, agentId: yield* standingAgent(member.userId, task.id) };
      }).pipe(Effect.provide(services));
      const token = yield* Effect.promise(() =>
        mintedToken(auth, member.cookie, {
          clientId: MCP_CLIENT.id,
          scope: [MEMBER_MCP_SCOPE.MCP],
          resource: RESOURCE,
        }),
      );
      const { client } = yield* connected(fetch, token, REVISION.MODERN);
      const call = (name: string, args: Record<string, unknown>) =>
        Effect.promise(async () => {
          const answer = decodeAnswer(await client.callTool({ name, arguments: args }));
          assert.notEqual(answer.isError, true, `${name}: ${answer.content[0].text}`);
          return JSON.parse(answer.content[0].text);
        });
      const mention = `[@Seats](https://vespin.dev/acme/plan/${taskId}/agent/${agentId})`;

      const { thread } = decodeThread(
        yield* call(MEMBER_MCP_TOOL.COMMENT_ON_DESCRIPTION, {
          taskId,
          quote: DESCRIPTION_NOTE.text,
          words: `${mention} do seats still drift?`,
        }),
      );
      yield* call(MEMBER_MCP_TOOL.REPLY_TO_COMMENT, { taskId, thread, words: "Invoices too." });
      const open = decodeThreads(yield* call(MEMBER_MCP_TOOL.READ_COMMENTS, { taskId }));
      const resolved = decodeThread(
        yield* call(MEMBER_MCP_TOOL.UPDATE_COMMENT, { taskId, thread, resolved: true }),
      );
      yield* descriptionsIn(own, member.userId, false).pipe(Effect.provide(services));
      const planless = decodeAnswer(
        yield* Effect.promise(() =>
          client.callTool({
            name: MEMBER_MCP_TOOL.COMMENT_ON_DESCRIPTION,
            arguments: { taskId, quote: DESCRIPTION_NOTE.text, words: "Still drifting?" },
          }),
        ),
      );
      yield* Effect.promise(() => client.close());
      const lines = yield* Effect.gen(function* () {
        const db = yield* Database;
        return yield* db
          .select({ words: sql<string>`${messages.metadata} ->> 'words'` })
          .from(messages)
          .where(sql`${messages.metadata} ->> 'thread_id' = ${thread}`);
      }).pipe(Effect.provide(services));
      const stored = yield* readDescriptionCommentThreads(member.userId, taskId).pipe(
        Effect.provide(services),
      );

      assert.deepEqual(
        open.threads.map((read) => ({
          thread: read.thread,
          on: read.on,
          comments: read.comments.map(({ words }) => words),
        })),
        [
          {
            thread,
            on: DESCRIPTION_NOTE.text,
            comments: [`${mention} do seats still drift?`, "Invoices too."],
          },
        ],
      );
      assert.equal(resolved.state, DESCRIPTION_COMMENT_STATUS.RESOLVED);
      assert.equal(planless.isError, true);
      assert.ok(
        planless.content[0].text.includes(EXPERIMENT_OFF_REFUSAL),
        planless.content[0].text,
      );
      // The thread was handed to the agent once for each comment, as the member's words, as a reply in the window hands it.
      assert.deepEqual(
        lines.map(({ words }) => words),
        [`${mention} do seats still drift?`, "Invoices too."],
      );
      assert.deepEqual(
        heard.map(({ account }) => account),
        [member.userId, member.userId],
      );
      const entries = Option.getOrThrow(stored)[0]?.entries ?? [];
      assert.deepEqual(
        entries
          .filter((entry) => entry.kind === DESCRIPTION_COMMENT_ENTRY.COMMENT)
          .map((entry) => [entry.writer.actor, entry.writer.by?.userId]),
        [
          [DESCRIPTION_COMMENT_ACTOR.MEMBER, member.userId],
          [DESCRIPTION_COMMENT_ACTOR.MEMBER, member.userId],
        ],
      );
    }),
);

it.effect(
  "a member keeps a memory in a workspace with Memory on that Settings › Memory lists as theirs, finds it, corrects it, and forgets it; in one with Memory off nothing runs, while another of theirs has it on",
  () =>
    Effect.gen(function* () {
      const { auth, fetch, services } = yield* standing;
      const member = yield* Effect.promise(() => signUp(auth));
      const workspaceId = yield* Effect.gen(function* () {
        const own = yield* openWorkspace(member.userId);
        yield* memoryIn(yield* openWorkspace(member.userId), member.userId);
        return own;
      }).pipe(Effect.provide(services));
      const workspace = `workspace-${workspaceId}`;
      const token = yield* Effect.promise(() =>
        mintedToken(auth, member.cookie, {
          clientId: MCP_CLIENT.id,
          scope: [MEMBER_MCP_SCOPE.MCP],
          resource: RESOURCE,
        }),
      );
      const { client } = yield* connected(fetch, token, REVISION.MODERN);
      const call = (name: string, args: Record<string, unknown>) =>
        Effect.promise(async () => {
          const answer = decodeAnswer(await client.callTool({ name, arguments: args }));
          return { refused: answer.isError === true, read: JSON.parse(answer.content[0].text) };
        });
      const settings = readWorkspaceMemories(member.userId, workspaceId).pipe(
        Effect.provide(services),
      );

      const off = yield* call(MEMBER_MCP_TOOL.SAVE_MEMORY, {
        workspace,
        text: "Tests run on PGlite.",
      });
      yield* memoryIn(workspaceId, member.userId).pipe(Effect.provide(services));
      const kept = decodeKept(
        (yield* call(MEMBER_MCP_TOOL.SAVE_MEMORY, { workspace, text: "Tests run on PGlite." }))
          .read,
      );
      const listed = yield* settings;
      const found = decodeFound(
        (yield* call(MEMBER_MCP_TOOL.SEARCH_MEMORY, { workspace, query: "pglite" })).read,
      );
      yield* call(MEMBER_MCP_TOOL.SAVE_MEMORY, {
        workspace,
        text: "Tests run on PGlite through test:store.",
        replaces: kept.memory.id,
      });
      const corrected = yield* settings;
      const forgot = yield* call(MEMBER_MCP_TOOL.FORGET_MEMORY, {
        workspace,
        memoryId: kept.memory.id,
      });
      const forgotten = yield* settings;
      yield* Effect.promise(() => client.close());

      assert.equal(off.refused, true);
      assert.ok(listed.kind === WORKSPACE_MEMORY.READ);
      assert.deepEqual(
        listed.memories.map(({ id, text, keptBy }) => ({ id, text, keptBy: keptBy?.userId })),
        [{ id: kept.memory.id, text: "Tests run on PGlite.", keptBy: member.userId }],
      );
      assert.deepEqual(
        found.memories.map(({ id }) => id),
        [kept.memory.id],
      );
      assert.ok(corrected.kind === WORKSPACE_MEMORY.READ);
      assert.deepEqual(
        corrected.memories.map(({ id, text }) => ({ id, text })),
        [{ id: kept.memory.id, text: "Tests run on PGlite through test:store." }],
      );
      assert.equal(forgot.refused, false);
      assert.ok(forgotten.kind === WORKSPACE_MEMORY.READ);
      assert.deepEqual(forgotten.memories, []);
    }),
);

it.effect(
  "a member's default model is changed only to a choice they are offered, as Settings changes it, and list_models reads it back",
  () =>
    Effect.gen(function* () {
      const { auth, fetch } = yield* standing;
      const member = yield* Effect.promise(() => signUp(auth));
      const token = yield* Effect.promise(() =>
        mintedToken(auth, member.cookie, {
          clientId: MCP_CLIENT.id,
          scope: [MEMBER_MCP_SCOPE.MCP],
          resource: RESOURCE,
        }),
      );
      const { client } = yield* connected(fetch, token, REVISION.MODERN);
      const call = (name: string, args: Record<string, unknown>) =>
        Effect.promise(async () => {
          const answer = decodeAnswer(await client.callTool({ name, arguments: args }));
          return { refused: answer.isError === true, text: answer.content[0].text };
        });

      const before = yield* call(MEMBER_MCP_TOOL.LIST_MODELS, {});
      const unoffered = yield* call(MEMBER_MCP_TOOL.UPDATE_PREFERENCES, {
        model: "anthropic/claude-opus-5.5",
        effort: "high",
      });
      const after = yield* call(MEMBER_MCP_TOOL.LIST_MODELS, {});
      yield* Effect.promise(() => client.close());

      // The catalog here offers nothing, so no choice is one the member may move their default to.
      assert.equal(unoffered.refused, true);
      assert.match(unoffered.text, /not offered that model/u);
      assert.deepEqual(
        decodeDefault(JSON.parse(after.text)),
        decodeDefault(JSON.parse(before.text)),
      );
    }),
);

it.effect(
  "an admin acting through the server reads the workspace's members and sets its photo but is refused its slug, which the owner changes",
  () =>
    Effect.gen(function* () {
      const { auth, fetch, services } = yield* standing;
      const owner = yield* Effect.promise(() => signUp(auth));
      const admin = yield* Effect.promise(() => signUp(auth));
      const workspaceId = yield* Effect.gen(function* () {
        const workspaceId = yield* openWorkspace(owner.userId);
        yield* joinWorkspace(workspaceId, admin.userId, WORKSPACE_ROLE.ADMIN);
        return workspaceId;
      }).pipe(Effect.provide(services));
      const callAs = (cookie: string, name: string, args: Record<string, unknown>) =>
        Effect.gen(function* () {
          const token = yield* Effect.promise(() =>
            mintedToken(auth, cookie, {
              clientId: MCP_CLIENT.id,
              scope: [MEMBER_MCP_SCOPE.MCP],
              resource: RESOURCE,
            }),
          );
          const { client } = yield* connected(fetch, token, REVISION.MODERN);
          const answer = decodeAnswer(
            yield* Effect.promise(() => client.callTool({ name, arguments: args })),
          );
          yield* Effect.promise(() => client.close());
          return answer;
        });

      const members = yield* callAs(admin.cookie, MEMBER_MCP_TOOL.LIST_WORKSPACE_MEMBERS, {});
      const refused = yield* callAs(admin.cookie, MEMBER_MCP_TOOL.SET_WORKSPACE_SLUG, {
        slug: "seats",
      });
      const changed = yield* callAs(owner.cookie, MEMBER_MCP_TOOL.SET_WORKSPACE_SLUG, {
        slug: "seats",
      });
      const photo = yield* callAs(admin.cookie, MEMBER_MCP_TOOL.SET_WORKSPACE_PHOTO, {
        photo: "data:image/png;base64,iVBORw0KGgo=",
      });

      assert.notEqual(members.isError, true, members.content[0].text);
      assert.deepEqual(
        JSON.parse(members.content[0].text).members.map(
          ({ userId, role }: { userId: string; role: string }) => [userId, role],
        ),
        [
          [owner.userId, WORKSPACE_ROLE.OWNER],
          [admin.userId, WORKSPACE_ROLE.ADMIN],
        ],
      );
      assert.equal(refused.isError, true);
      assert.notEqual(changed.isError, true, changed.content[0].text);
      assert.deepEqual(JSON.parse(changed.content[0].text).workspace, {
        id: workspaceId,
        slug: "seats",
        name: "Test Workspace",
      });
      assert.notEqual(photo.isError, true, photo.content[0].text);
      assert.equal(typeof JSON.parse(photo.content[0].text).workspace.photoVersion, "string");
    }),
);

it.effect(
  "an admin acting through the server invites on the deployment's own origin and cancels, but gives no role, which the owner gives before removing them",
  () =>
    Effect.gen(function* () {
      const { auth, fetch, services } = yield* standing;
      const owner = yield* Effect.promise(() => signUp(auth));
      const admin = yield* Effect.promise(() => signUp(auth));
      yield* Effect.gen(function* () {
        const workspaceId = yield* openWorkspace(owner.userId);
        yield* joinWorkspace(workspaceId, admin.userId, WORKSPACE_ROLE.ADMIN);
      }).pipe(Effect.provide(services));
      const callAs = (cookie: string, name: string, args: Record<string, unknown>) =>
        Effect.gen(function* () {
          const token = yield* Effect.promise(() =>
            mintedToken(auth, cookie, {
              clientId: MCP_CLIENT.id,
              scope: [MEMBER_MCP_SCOPE.MCP],
              resource: RESOURCE,
            }),
          );
          const { client } = yield* connected(fetch, token, REVISION.MODERN);
          const answer = decodeAnswer(
            yield* Effect.promise(() => client.callTool({ name, arguments: args })),
          );
          yield* Effect.promise(() => client.close());
          return answer;
        });
      const rolesOf = (text: string) =>
        JSON.parse(text).members.map(({ userId, role }: { userId: string; role: string }) => [
          userId,
          role,
        ]);

      const invited = yield* callAs(admin.cookie, MEMBER_MCP_TOOL.INVITE_TO_WORKSPACE, {
        email: "Newcomer@Example.com",
        role: WORKSPACE_ROLE.MEMBER,
      });
      const invitation = JSON.parse(invited.content[0].text).invitation;
      const listed = yield* callAs(admin.cookie, MEMBER_MCP_TOOL.LIST_WORKSPACE_INVITATIONS, {});
      const canceled = yield* callAs(admin.cookie, MEMBER_MCP_TOOL.CANCEL_WORKSPACE_INVITATION, {
        invitationId: invitation.id,
      });
      const unranked = yield* callAs(admin.cookie, MEMBER_MCP_TOOL.CHANGE_WORKSPACE_MEMBER_ROLE, {
        userId: owner.userId,
        role: WORKSPACE_ROLE.MEMBER,
      });
      const demoted = yield* callAs(owner.cookie, MEMBER_MCP_TOOL.CHANGE_WORKSPACE_MEMBER_ROLE, {
        userId: admin.userId,
        role: WORKSPACE_ROLE.MEMBER,
      });
      const removed = yield* callAs(owner.cookie, MEMBER_MCP_TOOL.REMOVE_WORKSPACE_MEMBER, {
        userId: admin.userId,
      });

      assert.notEqual(invited.isError, true, invited.content[0].text);
      assert.equal(invitation.email, "newcomer@example.com");
      assert.ok(invitation.acceptUrl.startsWith(`${MEMBER_MCP_TEST.ORIGIN}/`));
      assert.deepEqual(
        JSON.parse(listed.content[0].text).invitations.map(({ id }: { id: string }) => id),
        [invitation.id],
      );
      assert.deepEqual(JSON.parse(canceled.content[0].text).invitations, []);
      assert.equal(unranked.isError, true);
      assert.deepEqual(rolesOf(demoted.content[0].text), [
        [owner.userId, WORKSPACE_ROLE.OWNER],
        [admin.userId, WORKSPACE_ROLE.MEMBER],
      ]);
      assert.deepEqual(rolesOf(removed.content[0].text), [[owner.userId, WORKSPACE_ROLE.OWNER]]);
    }),
);

it.effect(
  "a member's connect_integration answers the sign-in link alone, and the sign-in returns to this deployment's own address",
  () =>
    Effect.gen(function* () {
      const returns: string[] = [];
      const signingIn = integrationConnectOf(() => ({
        ...CONNECTOR_ASKED_NOTHING,
        authorize: (_subject, callbackUrl) => {
          returns.push(callbackUrl);
          return Effect.succeed({ url: GRANTING_SIGN_IN_URL });
        },
      }));
      const { auth, fetch } = yield* memberMcpStanding({ integrations: signingIn });
      const member = yield* Effect.promise(() => signUp(auth));
      const token = yield* Effect.promise(() =>
        mintedToken(auth, member.cookie, {
          clientId: MCP_CLIENT.id,
          scope: [MEMBER_MCP_SCOPE.MCP],
          resource: RESOURCE,
        }),
      );
      const { client } = yield* connected(fetch, token, REVISION.MODERN);
      const answer = decodeAnswer(
        yield* Effect.promise(() =>
          client.callTool({
            name: MEMBER_MCP_TOOL.CONNECT_INTEGRATION,
            arguments: { provider: INTEGRATION_PROVIDER.NOTION },
          }),
        ),
      );
      yield* Effect.promise(() => client.close());

      assert.equal(answer.isError, undefined);
      assert.deepEqual(JSON.parse(answer.content[0].text), {
        status: ACTION_RESULT_STATUS.ACCEPTED,
        url: GRANTING_SIGN_IN_URL,
        connection: INTEGRATION_PROVIDER.NOTION,
      });
      assert.equal(returns.length, 1);
      assert.ok(
        returns[0]?.startsWith(`${ORIGIN}/api/account/integrations/connected?state=`),
        String(returns[0]),
      );
    }),
);

it.effect(
  "install_skill refuses a GitHub install without the commit its preview pinned, before reading the source",
  () =>
    Effect.gen(function* () {
      const { auth, fetch } = yield* standing;
      const member = yield* Effect.promise(() => signUp(auth));
      const token = yield* Effect.promise(() =>
        mintedToken(auth, member.cookie, {
          clientId: MCP_CLIENT.id,
          scope: [MEMBER_MCP_SCOPE.MCP],
          resource: RESOURCE,
        }),
      );
      const { client } = yield* connected(fetch, token, REVISION.MODERN);
      const answer = decodeAnswer(
        yield* Effect.promise(() =>
          client.callTool({
            name: MEMBER_MCP_TOOL.INSTALL_SKILL,
            arguments: {
              source: "anthropics/skills",
              scope: INSTALLED_SKILL_SCOPE.PERSONAL,
              skills: ["pdf"],
            },
          }),
        ),
      );
      yield* Effect.promise(() => client.close());

      assert.equal(answer.isError, true);
      assert.match(answer.content[0].text, /call it first/u);
    }),
);

/** The names a workspace environment tool answers, never a value. */
const decodeVariableNames = Schema.decodeUnknownSync(
  Schema.Struct({ variables: Schema.Array(Schema.Struct({ name: Schema.String })) }),
);

/** The server standing with a ring a set variable is sealed under, as a deployment's. */
const keyedStanding = memberMcpStanding({ keyRing: AGENT_KEY_RING });

it.effect(
  "an owner sets and deletes a workspace environment variable its agents are handed, no answer carrying its value; a plain member reads its name and is refused a set",
  () =>
    Effect.gen(function* () {
      const { auth, fetch, services } = yield* keyedStanding;
      const owner = yield* Effect.promise(() => signUp(auth));
      const plain = yield* Effect.promise(() => signUp(auth));
      const workspaceId = yield* Effect.gen(function* () {
        const id = yield* openWorkspace(owner.userId);
        yield* joinWorkspace(id, plain.userId);
        return id;
      }).pipe(Effect.provide(services));
      const workspace = `workspace-${workspaceId}`;
      const value = "postgres://owner:s3cret@db.test/app";
      const callerAs = (cookie: string) =>
        Effect.gen(function* () {
          const token = yield* Effect.promise(() =>
            mintedToken(auth, cookie, {
              clientId: MCP_CLIENT.id,
              scope: [MEMBER_MCP_SCOPE.MCP],
              resource: RESOURCE,
            }),
          );
          const { client } = yield* connected(fetch, token, REVISION.MODERN);
          const call = (name: string, args: Record<string, unknown>) =>
            Effect.promise(async () => {
              const answer = decodeAnswer(await client.callTool({ name, arguments: args }));
              const { text } = answer.content[0];
              return { refused: answer.isError === true, text, read: JSON.parse(text) };
            });
          return { client, call };
        });
      const ring = Result.getOrThrow(parseKeyRing(AGENT_KEY_RING));
      const handed = openWorkspaceEnvironment(ring, workspaceId).pipe(Effect.provide(services));

      const asOwner = yield* callerAs(owner.cookie);
      const asPlain = yield* callerAs(plain.cookie);
      const set = yield* asOwner.call(MEMBER_MCP_TOOL.SET_ENVIRONMENT_VARIABLE, {
        workspace,
        name: "DATABASE_URL",
        value,
      });
      const afterSet = yield* handed;
      const listed = yield* asPlain.call(MEMBER_MCP_TOOL.LIST_ENVIRONMENT_VARIABLES, {
        workspace,
      });
      const refused = yield* asPlain.call(MEMBER_MCP_TOOL.SET_ENVIRONMENT_VARIABLE, {
        workspace,
        name: "DATABASE_URL",
        value: "postgres://plain@db.test/app",
      });
      const deleted = yield* asOwner.call(MEMBER_MCP_TOOL.DELETE_ENVIRONMENT_VARIABLE, {
        workspace,
        name: "DATABASE_URL",
      });
      const afterDelete = yield* handed;
      yield* Effect.promise(() => Promise.all([asOwner.client.close(), asPlain.client.close()]));

      assert.equal(set.refused, false);
      assert.deepEqual(afterSet, { DATABASE_URL: value });
      assert.equal(listed.refused, false);
      assert.deepEqual(
        decodeVariableNames(listed.read).variables.map(({ name }) => name),
        ["DATABASE_URL"],
      );
      assert.equal(refused.refused, true);
      assert.deepEqual(decodeVariableNames(deleted.read).variables, []);
      assert.deepEqual(afterDelete, {});
      for (const answered of [set, listed, refused, deleted]) {
        assert.ok(!answered.text.includes("s3cret"));
      }
    }),
);

it.effect(
  "an owner's set on a deployment holding no key ring is refused in words that say a retry will not help, and nothing is stored",
  () =>
    Effect.gen(function* () {
      const { auth, fetch, services } = yield* standing;
      const owner = yield* Effect.promise(() => signUp(auth));
      const workspaceId = yield* openWorkspace(owner.userId).pipe(Effect.provide(services));
      const token = yield* Effect.promise(() =>
        mintedToken(auth, owner.cookie, {
          clientId: MCP_CLIENT.id,
          scope: [MEMBER_MCP_SCOPE.MCP],
          resource: RESOURCE,
        }),
      );
      const { client } = yield* connected(fetch, token, REVISION.MODERN);
      const answer = decodeAnswer(
        yield* Effect.promise(() =>
          client.callTool({
            name: MEMBER_MCP_TOOL.SET_ENVIRONMENT_VARIABLE,
            arguments: { workspace: `workspace-${workspaceId}`, name: "DATABASE_URL", value: "x" },
          }),
        ),
      );
      yield* Effect.promise(() => client.close());
      const ring = Result.getOrThrow(parseKeyRing(AGENT_KEY_RING));
      const stored = yield* openWorkspaceEnvironment(ring, workspaceId).pipe(
        Effect.provide(services),
      );

      assert.equal(answer.isError, true);
      assert.match(answer.content[0].text, /Calling again will not help/u);
      assert.deepEqual(stored, {});
    }),
);

it.effect("the metadata names the resource, the auth service, the scopes, and the header", () =>
  Effect.gen(function* () {
    const { fetch } = yield* standing;
    const answered = yield* Effect.promise(() => fetch(`${ORIGIN}${MEMBER_MCP_METADATA_ROUTE}`));
    assert.equal(answered.status, HOSTED_HTTP_STATUS.OK);
    const metadata = decodeMetadata(yield* Effect.promise(() => answered.json()));
    assert.equal(metadata.resource, RESOURCE);
    assert.deepEqual(metadata.authorization_servers, [memberMcpIssuer(ORIGIN)]);
    assert.deepEqual(metadata.scopes_supported, Object.values(MEMBER_MCP_SCOPE));
    assert.deepEqual(metadata.bearer_methods_supported, ["header"]);
  }),
);

it.each(MEMBER_MCP_TOOLS.map((tool) => [tool.name, tool] as const))(
  "%s shows the model the recorded input",
  async (name, tool) => {
    await settleJsonSchemaGolden(GOLDEN_ROOT, goldenOf(name), tool.input);
  },
);

it.each(
  MEMBER_MCP_TOOLS.flatMap((tool) =>
    tool.descriptionsOff === undefined || tool.descriptionsOff.input === tool.input
      ? []
      : [[tool.name, tool, tool.descriptionsOff.input] as const],
  ),
)(
  "%s shows the model the recorded input that names no description where no workspace of the member's has Task descriptions on",
  async (_name, tool, input) => {
    await settleJsonSchemaGolden(GOLDEN_ROOT, offGoldenOf(tool), input);
  },
);
