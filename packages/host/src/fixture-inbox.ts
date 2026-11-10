/**
 * fixture-inbox.ts -- the synthetic Inbox a fixture run's Inbox and person profiles draw, and the answers its items and agents are read by in place of the service's.
 *
 * A fixture run signs in to nothing and holds no inbox, so the window's
 * Inbox says only that nothing needs you, an item never opens, and a
 * person's page has no tasks to list. Under these profiles the window's
 * document holds a synthetic account signed in, the owner of the fixture's
 * first workspace, and main's read of the account names the tasks holding
 * items; the account's feed of every item holds each of those tasks'
 * items whole, which every surface draws from; and the list holds the
 * account's tasks assigned to it, created by it, and worked on by its
 * agents, which its own page lists, filled out as the Tasks list stands one:
 * a task pinned, one in a section of the account's, a sub-task, two
 * repositories, and the reference journey's task with its agent's pull
 * request, its pages, its description, and a task it waits on. The items
 * are an ask of each kind (a decision, an approval, steps to do, an answer
 * in words, and a form), a notice whose message carries code, a long
 * thread, one answered, and one closed. Every
 * name, address, and repository here is invented; nothing is read from an
 * account. The panel's fixture loader lays it over the window's document
 * (`@repo/panel`'s `tasks-fixture-loader.ts`), and the Expo app's fixture
 * host lays it into the host's own (`apps/mobile/src/host/fixture-host.ts`).
 */

import { ACCOUNT_PROVIDER, ACCOUNT_STATUS, type AccountSnapshot } from "@repo/credentials/snapshot";
import { AGENT_CALL_FAILURE, INBOX_SCOPE_KIND } from "@repo/features/agent-view";
import {
  AGENT_ATTACHMENT_TYPE,
  AGENT_RUNTIME,
  AGENT_STATUS,
  type AgentSummary,
  CHECK_SUMMARY,
  PULL_REQUEST_STATE,
} from "@repo/features/agent-wire";
import { CONVERSATION_MEDIA_TYPE } from "@repo/features/conversation-picture-wire";
import type { GitHubRepositoriesAnswer } from "@repo/features/github-repositories-wire";
import { inboxAttachmentAddress } from "@repo/features/inbox-attachment-link";
import {
  INBOX_APPROVAL_OPTION,
  INBOX_ASK,
  INBOX_ASK_STATUS,
  INBOX_FIELD,
  INBOX_MESSAGE_AUTHOR,
  INBOX_REPLY,
  INBOX_STATUS,
  INBOX_WIRE_VERSION,
  type InboxItem,
  type InboxMessage,
} from "@repo/features/inbox-wire";
import { closedNow, INBOX_SENDING, inboxSendingDrawn } from "@repo/features/inbox-writes";
import { LINK_DESTINATION } from "@repo/features/link-grammar";
import { LIVE_READ } from "@repo/features/live-wire";
import { MODEL_PROVIDER, type ModelsAnswer } from "@repo/features/models-wire";
import { PAGE_OWNER, PAGE_SHOWER, type PageLine } from "@repo/features/page-wire";
import { PULL_REQUEST_WRITE_OUTCOME } from "@repo/features/pull-request-write-wire";
import { PUSH_NOTIFY } from "@repo/features/push-device-wire";
import { TASK_PRIORITY, TASK_STATUS, type Task, type TaskSummary } from "@repo/features/task-wire";
import type { TasksView } from "@repo/features/tasks-view";
import { MP4_TYPE } from "@repo/features/video-signature";
import { WORKSPACE_ROLE, type Workspace } from "@repo/features/workspace-wire";
import { EXPERIMENT } from "@repo/settings";
import { ACT_KIND } from "./acts.js";
import {
  type AppHeldById,
  type AppInboxTask,
  type AppInboxTaskHolding,
  type AppStateSnapshot,
  type AppTranscript,
  OWN_TRANSCRIPT,
  RUN_PROFILE,
} from "./app-state.js";
import type { PortActKind, PortActPayload, PortActResult } from "./contract/index.js";
import { fixtureAgentPicture, fixtureAgentTranscript } from "./fixture-agent-transcript.js";
import {
  FIXTURE_PICTURE_PNG,
  FIXTURE_VIDEO_MP4,
  FIXTURE_VIDEO_WEBM,
} from "./fixture-inbox-media.js";
import { FIXTURE_IDS, FIXTURE_PAGE, FIXTURE_TASK_NAME } from "./fixture-stage.js";

export {
  FIXTURE_PULL_REQUEST,
  PULL_REQUEST_MOVE,
  type PullRequestMove,
  type PullRequestMoves,
  pullRequestMoveOf,
  pullRequestPartsAppState,
} from "./fixture-pull-requests.js";

/**
 * When the fixture landed, from which every instant here is counted back.
 * Note that it is read once, as the fixture's chunk lands, rather than fixed,
 * because the Inbox says each item's age against the clock, and a capture
 * taken any later day should still say "2h", not a month.
 */
const LANDED = Date.now();
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** The profiles this fixture stages. */
const STAGED_PROFILES: ReadonlySet<string> = new Set<string>([
  RUN_PROFILE.INBOX,
  RUN_PROFILE.PERSON,
]);

/** The account signed in: the owner of the fixture's first workspace, which is named for it. */
const ADA = { userId: "user-ada", name: "Ada Lovelace" } as const;
const ACCOUNT: AccountSnapshot = {
  status: ACCOUNT_STATUS.SIGNED_IN,
  id: ADA.userId,
  email: "ada@example.com",
  name: ADA.name,
  provider: ACCOUNT_PROVIDER.GITHUB,
};

/** The tasks holding items: the reference journey's, and two of the account's own beside it. */
const TASK = {
  INVITES: FIXTURE_IDS.TASK,
  DIGEST: "3c9d5f7b-1e4a-4b62-8d8a-4f5a6b7c8d93",
  ROUNDING: "4dae6081-2f5b-4c73-9e9b-5a6b7c8d9ea4",
} as const;

/** The account's tasks that hold no item, which fill out its Tasks list: a sub-task of the reference journey's, one in a second repository, and one in a section of its own. */
const LISTED = {
  COPY: "81e2a425-6d9f-4ab7-92df-9eafb0c1d2e8",
  ALERTS: "92f3b536-7eaf-4bc8-a3ea-afb0c1d2e3f9",
  LAUNCH: "a304c647-8fb0-4cd9-b4fb-b0c1d2e3f40a",
  SECTION: "b415d758-90c1-4dea-85ac-c1d2e3f4051b",
} as const;

/** The agents that posted the items, one at work on each task. */
const AGENT = {
  INVITES: "5ebf7192-3a6c-4d84-8fac-6b7c8d9eafb5",
  DIGEST: "6fc08203-4b7d-4e95-90bd-7c8d9eafb0c6",
  ROUNDING: "70d19314-5c8e-4fa6-81ce-8d9eafb0c1d7",
} as const;

const MODEL = "anthropic/claude-opus-5.5";

/** The fixture's workspace by the name its addresses spell it with, as the panel's tasks fixture names it. */
const FIXTURE_WORKSPACE_SLUG = "personal";

/* ----- The items ----- */

/** A uuid of the fixture's, numbered, for the ids of items and messages nothing else names. */
function fixtureId(n: number): string {
  return `81e2a425-6d9f-4ab7-92df-${n.toString(16).padStart(12, "0")}`;
}

/** The agent's message on an item's thread, `ago` before the fixture landed. */
function agentSaid(n: number, ago: number, text: string, ask?: InboxMessage["ask"]): InboxMessage {
  return {
    id: fixtureId(n),
    author: INBOX_MESSAGE_AUTHOR.AGENT,
    text,
    ...(ask === undefined ? undefined : { ask }),
    createdAt: LANDED - ago,
  };
}

/** The account's message on an item's thread, `ago` before the fixture landed, carrying its answer where it answers. */
function adaSaid(
  n: number,
  ago: number,
  text: string,
  answers?: InboxMessage["answers"],
): InboxMessage {
  return {
    id: fixtureId(n),
    author: INBOX_MESSAGE_AUTHOR.MEMBER,
    member: ADA,
    text,
    ...(answers === undefined ? undefined : { answers }),
    createdAt: LANDED - ago,
  };
}

/** An item of the account's, posted with the first message of its thread and changed with its last. */
function item(
  n: number,
  agentId: string,
  key: string,
  title: string,
  thread: readonly InboxMessage[],
  standing: Partial<InboxItem> = {},
): InboxItem {
  const first = thread[0]?.createdAt ?? LANDED;
  const last = thread.at(-1)?.createdAt ?? first;
  // Note that the agent hears the answer to every ask and never a notice's nod, as the service stores its latest post.
  const latestPost = thread.findLast((message) => message.author === INBOX_MESSAGE_AUTHOR.AGENT);
  return {
    id: fixtureId(n),
    agentId,
    key,
    revision: thread.length,
    version: INBOX_WIRE_VERSION,
    title,
    needsReply: latestPost?.ask !== undefined,
    status: INBOX_STATUS.OPEN,
    startedBy: ADA,
    waitsOn: ADA,
    thread,
    postedAt: first,
    updatedAt: last,
    ...standing,
  };
}

const OPEN = { status: INBOX_ASK_STATUS.OPEN } as const;

/** The recorded thread's files: a still its words draw, and the recording sent after them, by the attachment each is read by. */
const RECORDED = {
  ITEM: fixtureId(10),
  PICTURE: "92f3b536-7eaf-4bc8-a3e0-1a2b3c4d5e6f",
  VIDEO: "a3f4c647-8fb0-4cd9-b4f1-2b3c4d5e6f70",
} as const;

/**
 * The thread whose answer the fixture refuses, as a send no answer came back
 * for: the migration's approval, so a flow sees an answer drawn at once and
 * taken back.
 */
const REFUSED_ITEM = fixtureId(2);
/** The words a New task's agent is refused on, its task still made, so a flow sees the note a refused agent leaves. */
const FIXTURE_REFUSED_START_PROMPT = "Start this agent on a retired model.";

/** Where the recorded thread's words draw its still from: the still's address on the thread, as an agent's post names a picture it attached. */
const RECORDED_PICTURE_ADDRESS = inboxAttachmentAddress(
  { kind: LINK_DESTINATION.INBOX_ITEM, planId: TASK.INVITES, itemId: RECORDED.ITEM },
  RECORDED.PICTURE,
  FIXTURE_WORKSPACE_SLUG,
);

/** The reference journey's task's items: a decision, an approval, a form, a notice with code, a long thread, and a notice with a picture and a recording. */
const INVITES_ITEMS: readonly InboxItem[] = [
  item(
    1,
    AGENT.INVITES,
    "withdraw-invite",
    "Who can withdraw an invite?",
    [
      agentSaid(
        101,
        12 * MINUTE,
        "An invite is a pending `memberships` row, so withdrawing one deletes it. The description leaves open who may.",
        {
          type: INBOX_ASK.DECIDE,
          options: [
            {
              label: "The member who sent it",
              detail: "Admins can't touch someone else's invite.",
            },
            { label: "Any admin", detail: "Senders wait on an admin to take one back." },
            { label: "Both", detail: "The sender, or any admin of the workspace." },
          ],
          recommended: "Both",
          ...OPEN,
        },
      ),
    ],
    { unread: true },
  ),
  item(2, AGENT.INVITES, "preview-migration", "Run the memberships migration on preview?", [
    agentSaid(
      102,
      40 * MINUTE,
      "The migration adds `state` to `memberships`, defaulting every row to `active`. It's safe to rerun, and preview holds no real members.",
      {
        type: INBOX_ASK.DECIDE,
        options: [
          { label: INBOX_APPROVAL_OPTION.APPROVE },
          { label: INBOX_APPROVAL_OPTION.DECLINE },
        ],
        recommended: INBOX_APPROVAL_OPTION.APPROVE,
        ...OPEN,
      },
    ),
  ]),
  item(3, AGENT.INVITES, "invite-limits", "Invite limits", [
    agentSaid(
      103,
      2 * HOUR,
      "A few values the invite flow needs before I wire the rate limit and the emails.",
      {
        type: INBOX_ASK.ANSWER,
        fields: [
          { type: INBOX_FIELD.NUMBER, label: "Invites a member may send a day", required: true },
          {
            type: INBOX_FIELD.SELECT,
            label: "Who sees pending invites",
            options: ["Admins", "Every member"],
            recommended: "Every member",
          },
          { type: INBOX_FIELD.BOOLEAN, label: "Email the sender when an invite is accepted" },
          { type: INBOX_FIELD.TEXT, label: "Reply-to address" },
        ],
        ...OPEN,
      },
    ),
  ]),
  item(
    4,
    AGENT.INVITES,
    "accept-race",
    "acceptInvite can add a member twice",
    [
      agentSaid(
        104,
        3 * HOUR,
        [
          "The member is added before the invite is marked accepted, so a link opened twice at once adds them twice:",
          "",
          "```ts",
          "export async function acceptInvite(token: string) {",
          "  const invite = await db.invites.find(token);",
          '  if (!invite || invite.acceptedAt) throw new InviteError("no-longer-valid");',
          "  await db.members.add(invite.workspaceId, invite.email);",
          "  await db.invites.accept(invite.id);",
          "}",
          "```",
          "",
          "I'm moving both writes into one transaction that claims the invite first.",
        ].join("\n"),
      ),
    ],
    { unread: true },
  ),
  item(5, AGENT.INVITES, "expired-copy", "What the expired invite page says", [
    agentSaid(
      105,
      2 * DAY,
      "The expired-invite page needs words. Should it name who sent the invite?",
      { type: INBOX_ASK.DECIDE, options: [{ label: "Name them" }, { label: "Don't" }], ...OPEN },
    ),
    adaSaid(106, 2 * DAY - 20 * MINUTE, "", {
      ask: fixtureId(105),
      reply: INBOX_REPLY.CHOSE,
      choices: ["Name them"],
    }),
    agentSaid(
      107,
      2 * DAY - 30 * MINUTE,
      'Done: "Maya\'s invite to Acme has expired." Should it offer to ask Maya for a new one?',
    ),
    adaSaid(
      108,
      DAY + 6 * HOUR,
      "Yes, but only while Maya is still a member. Otherwise just say it expired.",
    ),
    agentSaid(
      109,
      DAY + 5 * HOUR,
      'Makes sense. A removed sender reads as "This invite has expired" with no button.',
    ),
    adaSaid(110, DAY + 2 * HOUR, "And a withdrawn invite?"),
    agentSaid(
      111,
      DAY + HOUR,
      'Withdrawn reads the same as used: "This invite is no longer valid." Nothing names who withdrew it.',
    ),
    adaSaid(112, 5 * HOUR, "Good. Ship it like that."),
    agentSaid(
      113,
      4 * HOUR,
      "Last one: the button's label. I have **Ask Maya for a new invite**, which runs long on a phone.",
      { type: INBOX_ASK.ANSWER, ...OPEN },
    ),
  ]),
  item(
    10,
    AGENT.INVITES,
    "invite-recording",
    "Recorded the invite flow",
    [
      {
        ...agentSaid(
          114,
          25 * MINUTE,
          [
            "I walked the invite flow in the preview, from [@Teammate invitations](https://vespin.dev/personal/task/0f6a2c4e-8b1d-4e3f-9a57-1c2b3d4e5f60) to the accepted page:",
            "",
            `![The invite page](${RECORDED_PICTURE_ADDRESS})`,
            "",
            "The recording is under this. The expired page is still the placeholder.",
          ].join("\n"),
        ),
        files: [
          {
            attachmentId: RECORDED.PICTURE,
            name: "invite-page.png",
            mediaType: AGENT_ATTACHMENT_TYPE.PNG,
          },
        ],
      },
      {
        ...agentSaid(115, 24 * MINUTE, "And the whole flow, sent to accepted:"),
        files: [
          {
            attachmentId: RECORDED.VIDEO,
            name: "invite-flow.webm",
            mediaType: CONVERSATION_MEDIA_TYPE.WEBM,
          },
        ],
      },
    ],
    { unread: true },
  ),
];

/** The digest task's items: steps to do, an answer in words, and one answered. */
const DIGEST_ITEMS: readonly InboxItem[] = [
  item(11, AGENT.DIGEST, "sender-domain", "Verify the digest's sender domain", [
    agentSaid(
      201,
      25 * MINUTE,
      "The digest sends from `digest@relay.example.com`, which the mail provider won't send from until the domain is verified.",
      {
        type: INBOX_ASK.DO,
        steps: [
          "Open the mail provider's **Domains** page and add `relay.example.com`.",
          "Add the three DNS records it shows at your registrar.",
          "Press **Verify** once they've spread, which can take an hour.",
        ],
        ...OPEN,
      },
    ),
  ]),
  item(12, AGENT.DIGEST, "digest-subject", "The digest's subject line", [
    agentSaid(
      202,
      90 * MINUTE,
      "Right now it's \"Your week in Relay\". Something that says what's inside would get opened more.",
      { type: INBOX_ASK.ANSWER, ...OPEN },
    ),
  ]),
  item(
    13,
    AGENT.DIGEST,
    "digest-day",
    "Which day the digest goes out",
    [
      agentSaid(203, 3 * DAY, "Which morning should it land?", {
        type: INBOX_ASK.DECIDE,
        options: [{ label: "Monday" }, { label: "Friday" }],
        status: INBOX_ASK_STATUS.ANSWERED,
      }),
      adaSaid(204, 3 * DAY - 2 * HOUR, "Monday, before standup.", {
        ask: fixtureId(203),
        reply: INBOX_REPLY.CHOSE,
        choices: ["Monday"],
      }),
    ],
    {
      status: INBOX_STATUS.ANSWERED,
      answeredBy: ADA,
      settledAt: LANDED - 3 * DAY + 2 * HOUR,
    },
  ),
];

/** The rounding task's one item, closed by its agent once the question no longer stood. */
const ROUNDING_ITEMS: readonly InboxItem[] = [
  item(
    21,
    AGENT.ROUNDING,
    "rounding-mode",
    "Round half-cents up or to even?",
    [
      agentSaid(
        301,
        4 * DAY,
        "Totals round half-cents up today. Banker's rounding would match the bank's statements.",
        {
          type: INBOX_ASK.DECIDE,
          options: [{ label: "Up" }, { label: "To even" }],
          status: INBOX_ASK_STATUS.WITHDRAWN,
          withdrawnReason: "The ledger's spec already says to even.",
        },
      ),
    ],
    {
      status: INBOX_STATUS.CLOSED,
      closedReason: "The ledger's spec already says to even.",
      settledAt: LANDED - 4 * DAY + HOUR,
    },
  ),
];

/** Each task's inbox, by the task's id. */
const INBOXES: ReadonlyMap<string, readonly InboxItem[]> = new Map([
  [TASK.INVITES, INVITES_ITEMS],
  [TASK.DIGEST, DIGEST_ITEMS],
  [TASK.ROUNDING, ROUNDING_ITEMS],
]);

/** When an inbox last changed: its newest item's change. */
function newest(items: readonly InboxItem[]): number {
  return Math.max(...items.map((each) => each.updatedAt));
}

/** Whether the item is a question: open, its thread holding an ask still open; a notice is not. */
function asking(item: InboxItem): boolean {
  return (
    item.status === INBOX_STATUS.OPEN &&
    (item.thread ?? []).some((message) => message.ask?.status === INBOX_ASK_STATUS.OPEN)
  );
}

/** Every task holding items as main's read of the account names it, the latest changed first. */
const HOLDINGS: readonly AppInboxTaskHolding[] = [...INBOXES]
  .map(([taskId, items]) => ({
    taskId,
    items: items.length,
    toDo: items.filter((each) => each.status === INBOX_STATUS.OPEN).length,
    updatedAt: newest(items),
  }))
  .toSorted((a, b) => b.updatedAt - a.updatedAt);

/** What waits on the account, as main counts it: each task's open items. */
const WAITING: readonly AppInboxTask[] = HOLDINGS.flatMap(({ taskId }) => {
  const open = (INBOXES.get(taskId) ?? []).filter((each) => each.status === INBOX_STATUS.OPEN);
  return open.length === 0
    ? []
    : [
        {
          taskId,
          items: open.map((each) => {
            const { id, agentId, title, postedAt } = each;
            return { id, agentId, title, postedAt, asking: asking(each) };
          }),
        },
      ];
});

/* ----- The tasks and their agents ----- */

/** An agent on a task, as the task's list and its agents read name it, started by the account. */
function agentOn(
  id: string,
  taskId: string,
  title: string,
  status: AgentSummary["status"],
  startedAgo: number,
): AgentSummary {
  return {
    id,
    planId: taskId,
    model: MODEL,
    effort: "high",
    title,
    createdAt: LANDED - startedAgo,
    status,
    turnId: null,
    runStartedAt: LANDED - startedAgo,
    startedBy: ADA,
    runtime: AGENT_RUNTIME.CLAUDE_CODE,
  };
}

const AGENTS: ReadonlyMap<string, AgentSummary> = new Map([
  [
    TASK.INVITES,
    agentOn(
      AGENT.INVITES,
      TASK.INVITES,
      "Build teammate invitations",
      AGENT_STATUS.RUNNING,
      3 * DAY,
    ),
  ],
  [
    TASK.DIGEST,
    agentOn(AGENT.DIGEST, TASK.DIGEST, "Send the weekly digest", AGENT_STATUS.RUNNING, 4 * HOUR),
  ],
  [
    TASK.ROUNDING,
    agentOn(AGENT.ROUNDING, TASK.ROUNDING, "Fix ledger rounding", AGENT_STATUS.COMPLETED, 5 * DAY),
  ],
]);

/** A task's agents as its row in the list counts them. */
function agentsLine(taskId: string): Pick<TaskSummary, "agents"> {
  const agent = AGENTS.get(taskId);
  if (agent === undefined) return {};
  const working = agent.status === AGENT_STATUS.RUNNING ? 1 : 0;
  return {
    agents: {
      total: 1,
      working,
      activityAt: newest(INBOXES.get(taskId) ?? []),
      pullRequestTotal: taskId === TASK.INVITES ? 1 : 0,
    },
  };
}

/** The account's own tasks beside the reference journey's: one in progress assigned to it, and one done it created. */
const OWN_TASKS: readonly TaskSummary[] = [
  {
    id: TASK.DIGEST,
    workspaceId: FIXTURE_IDS.WORKSPACE,
    name: "Weekly digest email",
    createdAt: LANDED - 2 * DAY,
    updatedAt: LANDED - 25 * MINUTE,
    repository: "ada/relay",
    status: TASK_STATUS.IN_PROGRESS,
    priority: TASK_PRIORITY.MEDIUM,
    number: 43,
    ownerId: ADA.userId,
    createdBy: ADA,
    assignee: ADA,
    pinnedAt: LANDED - 9 * DAY,
    ...agentsLine(TASK.DIGEST),
  },
  {
    id: TASK.ROUNDING,
    workspaceId: FIXTURE_IDS.WORKSPACE,
    name: "Ledger rounding",
    createdAt: LANDED - 6 * DAY,
    updatedAt: LANDED - 4 * DAY,
    repository: "ada/ledger",
    status: TASK_STATUS.DONE,
    completedAt: LANDED - 4 * DAY,
    priority: TASK_PRIORITY.LOW,
    number: 41,
    ownerId: ADA.userId,
    createdBy: ADA,
    ...agentsLine(TASK.ROUNDING),
  },
];

/** One of the account's tasks no item stands in, assigned to it, as its Tasks list lists it. */
function listedTask(
  id: string,
  name: string,
  more: Pick<TaskSummary, "repository" | "status" | "number" | "updatedAt"> & Partial<TaskSummary>,
): TaskSummary {
  return {
    id,
    workspaceId: FIXTURE_IDS.WORKSPACE,
    name,
    createdAt: LANDED - 3 * DAY,
    priority: TASK_PRIORITY.MEDIUM,
    ownerId: ADA.userId,
    createdBy: ADA,
    assignee: ADA,
    ...more,
  };
}

/**
 * The account's tasks that hold no item, which fill out its Tasks list as
 * the sidebar stands it: a sub-task under the reference journey's, a task
 * in a second repository, so the list draws its repositories' headings, and
 * one the account keeps in a section of its own.
 */
const LISTED_TASKS: readonly TaskSummary[] = [
  listedTask(LISTED.COPY, "Invite email copy", {
    repository: "ada/relay",
    status: TASK_STATUS.TODO,
    number: 44,
    updatedAt: LANDED - 3 * HOUR,
    parentTaskId: TASK.INVITES,
  }),
  listedTask(LISTED.ALERTS, "Usage alerts", {
    repository: "ada/ledger",
    status: TASK_STATUS.TODO,
    number: 45,
    updatedAt: LANDED - 5 * HOUR,
    priority: TASK_PRIORITY.LOW,
  }),
  listedTask(LISTED.LAUNCH, "Launch checklist", {
    repository: "ada/relay",
    status: TASK_STATUS.IN_PROGRESS,
    number: 46,
    updatedAt: LANDED - 7 * HOUR,
  }),
];

/** The tasks the fixture lays after the list's own, by id. */
const STAGED_TASK_IDS: ReadonlySet<string> = new Set(
  [...OWN_TASKS, ...LISTED_TASKS].map((task) => task.id),
);

/** The account's one section, holding the launch's checklist. */
const LISTED_SECTIONS: NonNullable<TasksView["taskSections"]> = {
  sections: [
    {
      id: LISTED.SECTION,
      workspaceId: FIXTURE_IDS.WORKSPACE,
      title: "Launch",
      createdAt: LANDED - 8 * DAY,
    },
  ],
  entries: [{ taskId: LISTED.LAUNCH, sectionId: LISTED.SECTION, addedAt: LANDED - 8 * DAY }],
  agentEntries: [],
};

/** The pull request the reference journey's agent opened, open with its checks passing. */
const INVITES_PULL_REQUEST = {
  number: 128,
  title: "Invite a teammate by email",
  url: "https://github.com/ada/relay/pull/128",
  state: PULL_REQUEST_STATE.OPEN,
  checks: CHECK_SUMMARY.PASSING,
  additions: 412,
  deletions: 37,
} as const;

/** The fixture's workspace where a list names none, as the panel's tasks fixture names it, with Task descriptions on. */
const FIXTURE_WORKSPACE: Workspace = {
  id: FIXTURE_IDS.WORKSPACE,
  name: ADA.name,
  slug: FIXTURE_WORKSPACE_SLUG,
  role: WORKSPACE_ROLE.OWNER,
  github: { login: "ada", active: true },
  personal: true,
  experiments: [
    {
      experiment: EXPERIMENT.DESCRIPTIONS,
      on: true,
      changedBy: { id: ADA.userId, name: ADA.name },
      changedAt: LANDED - 30 * DAY,
    },
  ],
};

/**
 * The reference journey's task as a list with no tasks fixture lists it, the
 * iOS app's: the panel's tasks fixture lists it whole, and this stands for
 * it only where that one does not.
 */
const INVITES_TASK: TaskSummary = {
  id: TASK.INVITES,
  workspaceId: FIXTURE_IDS.WORKSPACE,
  name: FIXTURE_TASK_NAME,
  createdAt: LANDED - 2 * DAY,
  updatedAt: LANDED - 4 * MINUTE,
  repository: "ada/relay",
  status: TASK_STATUS.IN_PROGRESS,
  priority: TASK_PRIORITY.HIGH,
  number: 42,
  ownerId: ADA.userId,
  createdBy: ADA,
};

/** The reference journey's task as the account's own: created by it, assigned to it, and its agent at work. */
function ownInvites(task: TaskSummary): TaskSummary {
  return { ...task, ownerId: ADA.userId, createdBy: ADA, assignee: ADA, ...agentsLine(task.id) };
}

/**
 * The list as these profiles draw it, from the list the tasks fixture draws:
 * the reference journey's task assigned to the account and its agent at
 * work, standing in where the list holds none, and the account's own two
 * tasks after it, so every task holding an item is listed. The same list
 * under any other profile.
 */
export function inboxTasksView(profile: string, list: TasksView): TasksView {
  if (!STAGED_PROFILES.has(profile)) return list;
  const listed = list.tasks.some((task) => task.id === TASK.INVITES)
    ? list.tasks
    : [INVITES_TASK, ...list.tasks];
  // Note that a list staged already, which the host wrote again, holds the staged tasks once, so they are laid over it rather than added twice.
  const tasks = [
    ...listed
      .filter((task) => !STAGED_TASK_IDS.has(task.id))
      .map((task) => (task.id === TASK.INVITES ? ownInvites(task) : task)),
    ...OWN_TASKS,
    ...LISTED_TASKS,
  ];
  // Note that the list follows each task's agent live too, which its row, its Inbox items, and a person's page read.
  const followed = tasks.flatMap((task) => {
    const agent = AGENTS.get(task.id);
    return agent === undefined
      ? []
      : [
          {
            ...agent,
            workspaceId: task.workspaceId,
            repository: task.repository,
            ...(agent.status === AGENT_STATUS.RUNNING ? undefined : { settledAt: agent.createdAt }),
          },
        ];
  });
  const invitesAgent = AGENTS.get(TASK.INVITES);
  return {
    ...list,
    tasks,
    taskAgents: [
      ...(list.taskAgents ?? []).filter((agent) => !followed.some(({ id }) => id === agent.id)),
      ...followed,
    ],
    taskSections: LISTED_SECTIONS,
    workspaces: list.workspaces.some((workspace) => workspace.id === FIXTURE_IDS.WORKSPACE)
      ? list.workspaces
      : [FIXTURE_WORKSPACE, ...list.workspaces],
    taskPullRequests: [
      ...(list.taskPullRequests ?? []).filter((each) => each.taskId !== TASK.INVITES),
      { taskId: TASK.INVITES, pullRequests: [{ ...INVITES_PULL_REQUEST, agentId: AGENT.INVITES }] },
    ],
    agentPullRequests: [
      ...(list.agentPullRequests ?? []).filter((each) => each.taskId !== TASK.INVITES),
      ...(invitesAgent === undefined
        ? []
        : [
            {
              agentId: invitesAgent.id,
              taskId: TASK.INVITES,
              pullRequest: { ...INVITES_PULL_REQUEST, changedFiles: 14 },
            },
          ]),
    ],
  };
}

/* ----- The reference journey's description and pages ----- */

/**
 * The reference journey's description, as its page draws it under Task
 * descriptions: headings, words marked up, lists and a task list, a quote, a
 * table wider than a phone, code, a mention chip of each kind, and a
 * picture, so a capture of it shows every piece the description draws.
 */
const INVITES_DESCRIPTION = [
  "## Context",
  "",
  "Only an admin can add someone to a workspace, so members wait on an admin to bring a " +
    "teammate in. **Invites** let any member do it, and *expire* after a week.",
  "",
  "## Goal",
  "",
  "- A member invites a teammate by email.",
  "- The teammate joins the workspace by opening the link.",
  "",
  "> A withdrawn or accepted link grants nothing when it is opened again.",
  "",
  "## Approach",
  "",
  "Model an invite as a `memberships` row with `state = pending`, so removal covers invites " +
    "and members alike.",
  "",
  "```ts",
  "export function inviteMember(workspaceId: string, email: string): Promise<Membership>;",
  "```",
  "",
  "| Step | Owner | Where | Done |",
  "| :-- | :-- | :-- | :-: |",
  "| Send the invite | Agent | src/members/invite.ts | yes |",
  "| Accept the link | Agent | src/members/accept.ts | no |",
  "",
  "## Links",
  "",
  "- Task: [@Usage alerts](https://vespin.dev/personal/task/45)",
  "- Pull request: [@#128 Invite a teammate by email](https://github.com/ada/relay/pull/128)",
  "- File: [@invite.ts](https://github.com/ada/relay/blob/HEAD/src/members/invite.ts)",
  "- Date: [@Nov 16, 2026](mention://date/2026-11-16)",
  "",
  "## Checks",
  "",
  "- [x] An invite is sent once per address",
  "- [ ] A withdrawn link grants nothing",
  "",
  `![The invite page](data:image/png;base64,${FIXTURE_PICTURE_PNG})`,
  "",
].join("\n");

/** The reference journey's task as its page reads it: its row's fields, its description, and the task it waits on. */
function invitesDocument(listed: TaskSummary): Task {
  const { agents: _agents, ...task } = listed;
  return {
    ...task,
    document: { body: INVITES_DESCRIPTION, assumptions: [] },
    blockedBy: [LISTED.ALERTS],
    blocks: [],
  };
}

/** The pages the reference journey's agent showed, as its task's page lists them. */
const INVITES_PAGES: readonly PageLine[] = [
  {
    id: FIXTURE_PAGE.id,
    title: FIXTURE_PAGE.title,
    version: FIXTURE_PAGE.version,
    at: LANDED - 2 * HOUR,
    shownBy: { kind: PAGE_SHOWER.AGENT, agentId: AGENT.INVITES },
  },
];

/** A descriptions slice with the reference journey's laid over it, and the listed task it was laid from. */
interface StagedDocuments {
  readonly from: TaskSummary;
  readonly laid: AppStateSnapshot[typeof LIVE_READ.DESCRIPTION_DOCUMENT];
}

/**
 * Each held descriptions slice with the reference journey's laid over it, by
 * the slice, so a slice staged is never staged anew while the task it was
 * laid from stands as it was.
 */
const STAGED_DOCUMENTS = new WeakMap<
  AppStateSnapshot[typeof LIVE_READ.DESCRIPTION_DOCUMENT],
  StagedDocuments
>();

/**
 * The descriptions slice with the reference journey's laid over it, its
 * fields the task's as the list stands it (`ownInvites`), so its page and its
 * row say the same; the stand-in where the document lists none of it, as the
 * panel's fixture run, which lists its own on the window's side, does.
 */
function stagedDocuments(
  state: AppStateSnapshot,
): AppStateSnapshot[typeof LIVE_READ.DESCRIPTION_DOCUMENT] {
  const held = state[LIVE_READ.DESCRIPTION_DOCUMENT];
  const from = state.tasks.tasks.find((task) => task.id === TASK.INVITES) ?? INVITES_TASK;
  const staged = STAGED_DOCUMENTS.get(held);
  if (staged !== undefined && staged.from === from) return staged.laid;
  const laid = { ...held, [TASK.INVITES]: { rows: { task: invitesDocument(ownInvites(from)) } } };
  STAGED_DOCUMENTS.set(held, { from, laid });
  STAGED_DOCUMENTS.set(laid, { from, laid });
  return laid;
}

/** Each held pages slice with the reference journey's laid over it, one object for each. */
const STAGED_PAGES = new WeakMap<
  AppStateSnapshot[typeof LIVE_READ.PAGES],
  AppStateSnapshot[typeof LIVE_READ.PAGES]
>();

function stagedPages(state: AppStateSnapshot): AppStateSnapshot[typeof LIVE_READ.PAGES] {
  const held = state[LIVE_READ.PAGES];
  const staged = STAGED_PAGES.get(held);
  if (staged !== undefined) return staged;
  const laid = {
    ...held,
    [PAGE_OWNER.TASK]: { ...held[PAGE_OWNER.TASK], [TASK.INVITES]: { rows: INVITES_PAGES } },
  };
  STAGED_PAGES.set(held, laid);
  STAGED_PAGES.set(laid, laid);
  return laid;
}

/* ----- The window's document ----- */

/**
 * The account these profiles sign in as, which reads the fixture's tasks as
 * its own, so its page and its items say "you"; none under any other
 * profile, whose invented tasks are nobody's.
 */
export function inboxReader(profile: string): string | undefined {
  return STAGED_PROFILES.has(profile) ? ADA.userId : undefined;
}

/** Main's inbox slice with the staged tasks laid over it, one object for each of main's. */
const STAGED_INBOX = new WeakMap<AppStateSnapshot["inbox"], AppStateSnapshot["inbox"]>();

function stagedInbox(inbox: AppStateSnapshot["inbox"]): AppStateSnapshot["inbox"] {
  const held = STAGED_INBOX.get(inbox);
  if (held !== undefined) return held;
  const staged = { ...inbox, waiting: WAITING, tasks: HOLDINGS };
  STAGED_INBOX.set(inbox, staged);
  return staged;
}

/** Each of `workspaceIds` held with no automation, nor any run of one, as a read of them holds them once read. */
function noneHeldIn(workspaceIds: readonly string[]): AppHeldById<readonly never[]> {
  return Object.fromEntries(workspaceIds.map((id) => [id, { rows: [] }]));
}

/** The invitations agent's transcript as the host holds one read, its run begun as its agent was started. */
const INVITES_TRANSCRIPT = withQueued(
  fixtureAgentTranscript(LANDED - 3 * DAY, ADA, "Build teammate invitations"),
);

/** A transcript with one message of the account's queued behind its turn, which the agent's composer lists over its field with Steer and Delete. */
function withQueued(transcript: AppTranscript): AppTranscript {
  const queued = {
    id: fixtureId(90),
    text: "Then add a Resend button beside each pending invite.",
    queuedBy: ADA.userId,
  };
  const { word } = transcript;
  if (word === undefined) return transcript;
  return { ...transcript, word: { ...word, queue: { messages: [queued], revision: 1 } } };
}

/** The transcripts main holds with the invitations agent's laid over them, one object for each of main's. */
const STAGED_TRANSCRIPTS = new WeakMap<
  AppStateSnapshot[typeof LIVE_READ.TRANSCRIPT],
  AppStateSnapshot[typeof LIVE_READ.TRANSCRIPT]
>();

function stagedTranscripts(
  held: AppStateSnapshot[typeof LIVE_READ.TRANSCRIPT],
): AppStateSnapshot[typeof LIVE_READ.TRANSCRIPT] {
  const kept = STAGED_TRANSCRIPTS.get(held);
  if (kept !== undefined) return kept;
  const staged = {
    ...held,
    [AGENT.INVITES]: { ...held[AGENT.INVITES], [OWN_TRANSCRIPT]: { rows: INVITES_TRANSCRIPT } },
  };
  STAGED_TRANSCRIPTS.set(held, staged);
  return staged;
}

/** The models the account may start an agent on, as the service's catalog lists them, and no device of its own. */
const MODELS: ModelsAnswer = {
  models: [
    {
      id: MODEL,
      name: "Anthropic Claude Opus 5.5",
      provider: MODEL_PROVIDER.ANTHROPIC,
      efforts: ["low", "medium", "high", "xhigh", "max"],
    },
    {
      id: "anthropic/claude-sonnet-5.5",
      name: "Anthropic Claude Sonnet 5.5",
      provider: MODEL_PROVIDER.ANTHROPIC,
      efforts: ["low", "medium", "high"],
    },
    {
      id: "openai/gpt-6.1-sol",
      name: "OpenAI GPT-6.1 Sol",
      provider: MODEL_PROVIDER.OPENAI,
      efforts: ["low", "medium", "high", "xhigh"],
    },
  ],
};

/** A repository of the fixture's workspace, as GitHub lists it. */
function listedRepository(fullName: string, name: string) {
  return {
    owner: "ada",
    name,
    fullName,
    defaultBranch: "main",
    private: true,
    updatedAt: LANDED - DAY,
  };
}

/** The repositories the fixture's workspace reaches, the two its tasks are about. */
const REPOSITORIES: GitHubRepositoriesAnswer = {
  installed: true,
  repositories: [listedRepository("ada/relay", "relay"), listedRepository("ada/ledger", "ledger")],
  installationUrl: "https://github.com/apps/vespin/installations/new",
};

/**
 * Main's document as these profiles draw it: the account signed in, its
 * read of what waits naming the tasks holding items, and each of
 * `workspaceIds` held with no automation, so the person page and the
 * sidebar list none rather than reading for good. The same document, the
 * very object, under any other profile.
 */
export function inboxAppState(
  state: AppStateSnapshot,
  workspaceIds: readonly string[],
): AppStateSnapshot {
  if (!STAGED_PROFILES.has(state.run.profile)) return state;
  // Note that the account's feed of every item, which the window's Inbox draws from, holds each staged task's items whole.
  const fed = Object.fromEntries([...INBOXES].filter(([, items]) => items.length > 0));
  return {
    ...state,
    account: ACCOUNT,
    inbox: stagedInbox(state.inbox),
    [LIVE_READ.INBOX_ITEMS]: {
      rows: { [INBOX_SCOPE_KIND.PLAN]: fed },
    },
    [LIVE_READ.DESCRIPTION_DOCUMENT]: stagedDocuments(state),
    [LIVE_READ.PAGES]: stagedPages(state),
    [LIVE_READ.AUTOMATIONS]: noneHeldIn(workspaceIds),
    [LIVE_READ.AUTOMATION_WORKSPACE_RUNS]: noneHeldIn(workspaceIds),
    [LIVE_READ.TRANSCRIPT]: stagedTranscripts(state[LIVE_READ.TRANSCRIPT]),
    [LIVE_READ.MODELS]: { [ADA.userId]: { rows: MODELS } },
    [LIVE_READ.REPOSITORY_LISTS]: Object.fromEntries(
      workspaceIds.map((id) => [id, { rows: REPOSITORIES }]),
    ),
  };
}

/* ----- The act door ----- */

/** One staged item by its id, in whichever task's inbox holds it. */
function stagedItem(itemId: string): InboxItem | undefined {
  return [...INBOXES.values()].flat().find((each) => each.id === itemId);
}

/** One staged agent by its id, on whichever task it works. */
function stagedAgent(agentId: string): AgentSummary | undefined {
  return [...AGENTS.values()].find((each) => each.id === agentId);
}

/** One kind's staged answer: its result. */
type StagedAnswer<Kind extends PortActKind> = (
  payload: PortActPayload<Kind>,
) => PortActResult<Kind>;

/**
 * Every read the Inbox, its items, and the person page ask, answered as the
 * service would answer it for this account. Note that the workspace's members
 * are not among them, because the tasks fixture's own answer names them
 * (`settings-fixture.ts`), and the page names the account by its tasks meanwhile.
 */
const ANSWERS: { readonly [Kind in PortActKind]?: StagedAnswer<Kind> } = {
  [ACT_KIND.AGENTS_LIST]: ({ taskId }) => {
    const agent = AGENTS.get(taskId);
    return { agents: agent === undefined ? [] : [agent] };
  },
  // Note that a mark is taken as the service takes one, the item's state echoed, though nothing here moves, so its dot stays as staged: the host draws a mark, and none stands behind a fixture run's act door.
  [ACT_KIND.AGENTS_INBOX_READ_STATE]: ({ itemId, unread }) => ({ id: itemId, unread }),
  // Note that the recording is answered as its MP4 copy to a reader that plays MP4, as the service answers one it keeps a copy of.
  [ACT_KIND.AGENTS_INBOX_ATTACHMENT]: ({ itemId, attachmentId, playable }) => {
    if (itemId !== RECORDED.ITEM) return { failure: AGENT_CALL_FAILURE.NOT_FOUND };
    if (attachmentId === RECORDED.PICTURE) {
      return { contentType: AGENT_ATTACHMENT_TYPE.PNG, base64: FIXTURE_PICTURE_PNG };
    }
    if (attachmentId === RECORDED.VIDEO) {
      return playable === MP4_TYPE
        ? { contentType: MP4_TYPE, base64: FIXTURE_VIDEO_MP4 }
        : { contentType: CONVERSATION_MEDIA_TYPE.WEBM, base64: FIXTURE_VIDEO_WEBM };
    }
    return { failure: AGENT_CALL_FAILURE.NOT_FOUND };
  },
  // Note that a status is taken as the service takes one, though nothing here moves, so the window draws the change it asked for itself.
  [ACT_KIND.TASKS_SET_STANDING]: () => true,
  // The invitations agent's pictures and recording, by the ids its transcript names them by; an older page of it stands nowhere.
  [ACT_KIND.AGENTS_PICTURE]: ({ pictureId }) => fixtureAgentPicture(pictureId),
  [ACT_KIND.AGENTS_TRANSCRIPT_OLDER]: () => ({ failure: AGENT_CALL_FAILURE.NOT_FOUND }),
  // Note that a reply and a resolve are taken as the service takes them, answered with the item as it then stands, though nothing here moves, so the window draws its own send; the migration's approval is refused.
  [ACT_KIND.AGENTS_INBOX_MESSAGE]: ({ itemId, clientKey, text, answers }) => {
    const held = stagedItem(itemId);
    if (held === undefined) return { failure: AGENT_CALL_FAILURE.NOT_FOUND };
    if (itemId === REFUSED_ITEM) return { failure: AGENT_CALL_FAILURE.UNANSWERED };
    const sent = { kind: INBOX_SENDING.REPLY, key: clientKey, text, answers, at: Date.now() };
    return { item: inboxSendingDrawn(held, [sent], ADA) };
  },
  [ACT_KIND.AGENTS_INBOX_CLOSE]: ({ itemId }) => {
    const held = stagedItem(itemId);
    if (held === undefined) return { failure: AGENT_CALL_FAILURE.NOT_FOUND };
    return { item: closedNow(held, ADA, Date.now()), taken: true };
  },
  // Note that a change to one of the invitations agent's pull requests is taken as GitHub takes one, and the run lays how it moved it over the parts (`pullRequestPartsAppState`).
  [ACT_KIND.AGENTS_PULL_REQUEST_ACTION]: () => ({ outcome: PULL_REQUEST_WRITE_OUTCOME.DONE }),
  // Note that a message, a queue change, and a Stop are taken as the service takes them, answered with the agent or the queue as it then stands, though nothing here moves, so the transcript reads as staged.
  [ACT_KIND.AGENTS_MESSAGE]: ({ agentId }) => {
    const held = stagedAgent(agentId);
    if (held === undefined) return { failure: AGENT_CALL_FAILURE.NOT_FOUND };
    return { agent: { ...held, status: AGENT_STATUS.RUNNING } };
  },
  [ACT_KIND.AGENTS_QUEUE]: ({ agentId }) => {
    if (stagedAgent(agentId) === undefined) return { failure: AGENT_CALL_FAILURE.NOT_FOUND };
    return { queue: { messages: [], revision: 2 } };
  },
  [ACT_KIND.AGENTS_STOP]: ({ agentId }) => {
    const held = stagedAgent(agentId);
    if (held === undefined) return { failure: AGENT_CALL_FAILURE.NOT_FOUND };
    return { agent: { ...held, status: AGENT_STATUS.CANCELED } };
  },
  // A Start, and a task's start with its agent, answered with a new agent starting on the words, as the service answers one; a task's start on the refused words is made with its agent refused.
  [ACT_KIND.AGENTS_START]: ({ taskId, prompt }) => ({
    agent: agentOn(fixtureId(91), taskId ?? TASK.INVITES, prompt ?? "", AGENT_STATUS.STARTING, 0),
  }),
  [ACT_KIND.TASKS_START]: ({ agent }) => ({
    planId: fixtureId(92),
    agentStart:
      agent?.prompt === FIXTURE_REFUSED_START_PROMPT
        ? { failure: AGENT_CALL_FAILURE.INVALID_CHOICE }
        : {
            agent: agentOn(
              fixtureId(93),
              fixtureId(92),
              agent?.prompt ?? "",
              AGENT_STATUS.STARTING,
              0,
            ),
          },
  }),
  [ACT_KIND.AGENTS_INBOX_READ_ALL]: () => ({
    marked: [...INBOXES.values()].flat().filter(({ unread }) => unread === true).length,
  }),
  // The phone's registration is taken, and its pushes stand working, the last reaching Apple a few minutes before the run landed; a "Notify me" set is taken though nothing here moves, so the screen draws the choice it made itself.
  [ACT_KIND.PUSH_DEVICE_REGISTER]: () => ({ done: true }),
  [ACT_KIND.PUSH_DEVICE_UNREGISTER]: () => ({ done: true }),
  [ACT_KIND.PUSH_DEVICE_STATUS]: () => ({
    notify: PUSH_NOTIFY.AWAY,
    lastDeliveredAt: LANDED - 4 * MINUTE,
    failingSince: null,
    failureReason: null,
  }),
  [ACT_KIND.PUSH_DEVICE_NOTIFY]: () => ({ done: true }),
};

/**
 * What these profiles answer an act with, in place of main, held in a box so
 * an act that answers nothing is told from one left to main; none for a kind
 * the Inbox and the person page do not read, and under any other profile.
 */
export function inboxActAnswer(
  profile: string,
  kind: PortActKind,
  payload: PortActPayload<PortActKind>,
): { readonly answer: PortActResult<PortActKind> } | undefined {
  if (!STAGED_PROFILES.has(profile)) return undefined;
  // SAFETY: the table is keyed by kind, each answer taking that kind's payload and answering its result.
  const answer = ANSWERS[kind] as StagedAnswer<PortActKind> | undefined;
  return answer === undefined ? undefined : { answer: answer(payload) };
}
