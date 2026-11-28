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
 * request, a call the agent holds for the account's answer, its pages, its description, and a task it waits on. The items
 * are an ask of each kind (a decision, an approval, steps to do, an answer
 * in words, and a form), a notice whose message carries code, a long
 * thread, one answered, and one closed. Every
 * name, address, and repository here is invented; nothing is read from an
 * account. The panel's fixture loader lays it over the window's document
 * (`@repo/panel`'s `tasks-fixture-loader.ts`), and the Expo app's fixture
 * host lays it into the host's own (`apps/mobile/src/host/fixture-host.ts`).
 */

import { ACCOUNT_PROVIDER, ACCOUNT_STATUS, type AccountSnapshot } from "@repo/credentials/snapshot";
import {
  AGENT_PERMISSION_MODE,
  type AgentPendingApproval,
  type AgentPermissionMode,
  APPROVAL_STATUS_OF_ANSWER,
} from "@repo/features/agent-approval-wire";
import {
  AGENT_FOLLOWER_FAILURE,
  type AgentFollowersAnswerView,
} from "@repo/features/agent-followers-view";
import type { AgentFollowerWire } from "@repo/features/agent-followers-wire";
import { type AgentQueue, QUEUE_PAUSE, type QueuedMessage } from "@repo/features/agent-queue-wire";
import {
  AGENT_CALL_FAILURE,
  type AgentTranscriptOlderAnswer,
  type AgentTranscriptOlderParams,
  INBOX_SCOPE_KIND,
  MEMORY_SAVE_FAILURE,
} from "@repo/features/agent-view";
import {
  AGENT_ATTACHMENT_TYPE,
  AGENT_KIND,
  AGENT_MACHINE,
  AGENT_RUNTIME,
  AGENT_STATUS,
  type AgentQueueChange,
  type AgentSummary,
  CHECK_SUMMARY,
  PULL_REQUEST_STATE,
  QUEUE_CHANGE,
} from "@repo/features/agent-wire";
import { nextScheduledRun } from "@repo/features/automation-schedule";
import { AUTOMATION_CALL_FAILURE } from "@repo/features/automation-view";
import {
  AUTOMATION_ACTION,
  AUTOMATION_FIRING,
  AUTOMATION_RUN_REASON,
  AUTOMATION_RUN_STATUS,
  AUTOMATION_SCOPE,
  AUTOMATION_TARGET,
  AUTOMATION_TRIGGER,
  type AutomationRunSummary,
  type AutomationSummary,
  GITHUB_TRIGGER_EVENT,
} from "@repo/features/automation-wire";
import { CONVERSATION_MEDIA_TYPE } from "@repo/features/conversation-picture-wire";
import {
  DESCRIPTION_COMMENT_ACTION,
  DESCRIPTION_COMMENT_ACTOR,
  DESCRIPTION_COMMENT_ENTRY,
  DESCRIPTION_COMMENT_SCOPE,
  DESCRIPTION_COMMENT_STATUS,
  type DescriptionCommentThread,
} from "@repo/features/description-comment-wire";
import { DEVICE_ARCH, DEVICE_PLATFORM } from "@repo/features/device-agent-wire";
import type { GitHubRepositoriesAnswer } from "@repo/features/github-repositories-wire";
import type { HostLine } from "@repo/features/host-live";
import { HOST_PAIRING_CALL_FAILURE } from "@repo/features/host-pairing-view";
import type { HostPairingAnswer } from "@repo/features/host-wire";
import { inboxAttachmentAddress } from "@repo/features/inbox-attachment-link";
import type { InboxSearchPlace } from "@repo/features/inbox-service-search";
import {
  INBOX_APPROVAL_OPTION,
  INBOX_ASK,
  INBOX_ASK_STATUS,
  INBOX_FIELD,
  INBOX_MESSAGE_AUTHOR,
  INBOX_OPTION_MEDIA,
  INBOX_REPLY,
  INBOX_STATUS,
  INBOX_TAKE_BACK,
  INBOX_WIRE_VERSION,
  type InboxItem,
  type InboxMessage,
} from "@repo/features/inbox-wire";
import {
  acknowledgedNow,
  closedNow,
  INBOX_SENDING,
  inboxSendingDrawn,
  takenBackNow,
} from "@repo/features/inbox-writes";
import {
  type InstalledSkillCandidate,
  type InstalledSkillPreview,
  type InstalledSkillSummary,
  SKILL_PASTE_KIND,
  UNSUPPORTED_PREVIEW,
} from "@repo/features/installed-skill-route-wire";
import { INSTALLED_SKILL_CALL_FAILURE } from "@repo/features/installed-skill-view";
import { INSTALLED_SKILL_SCOPE, INSTALLED_SKILL_SOURCE } from "@repo/features/installed-skill-wire";
import type { IntegrationStatusesAnswer } from "@repo/features/integration-live";
import {
  INTEGRATION_PROVIDER,
  INTEGRATION_PROVIDER_LIST,
  INTEGRATION_STATUS,
} from "@repo/features/integration-wire";
import { LINK_DESTINATION } from "@repo/features/link-grammar";
import { LIVE_READ } from "@repo/features/live-wire";
import type { MachineAskLine } from "@repo/features/machine-ask-live";
import type { MachineLine } from "@repo/features/machine-live";
import {
  MANAGER_CHAT_AUTHOR,
  MANAGER_CHAT_REACTION,
  type ManagerChatEditPress,
  type ManagerChatReactionPress,
  withEditPress,
  withReactionPress,
} from "@repo/features/manager-chat-live";
import {
  MANAGER_FACE_CHARACTER,
  MANAGER_FACE_COLOR,
  type ManagerFace,
  sameManagerFace,
} from "@repo/features/manager-face";
import type { McpClient } from "@repo/features/mcp-client-wire";
import { MEMORY_SAVED, type MemorySummary } from "@repo/features/memory-wire";
import {
  MERGE_QUEUE_ENTRY_STATE,
  type MergeQueueAnswer,
  type MergeQueueEntry,
} from "@repo/features/merge-queue-wire";
import {
  MODEL_PROVIDER,
  MODEL_SPEED,
  MODEL_SPEED_SUFFIX,
  type ModelsAnswer,
} from "@repo/features/models-wire";
import { PAGE_OWNER, PAGE_SHOWER, type PageLine } from "@repo/features/page-wire";
import {
  PICTURE_OWNER,
  PICTURE_SOURCE_FAILURE,
  type PictureSourceParams,
  type PictureSourceView,
} from "@repo/features/picture-source-wire";
import { PULL_REQUEST_WRITE_OUTCOME } from "@repo/features/pull-request-write-wire";
import { PUSH_NOTIFY } from "@repo/features/push-device-wire";
import { matchesTokens, searchTokens } from "@repo/features/search-tokens";
import { TASK_SECTION_GLYPH, TASK_SECTION_ICON_KIND } from "@repo/features/task-section-wire";
import {
  DESCRIPTION_ACTOR,
  type DescriptionRevisionsAnswer,
  TASK_PRIORITY,
  TASK_SKILL_SOURCE,
  TASK_STATUS,
  TASK_TREE_ENTRY,
  type Task,
  type TaskSummary,
} from "@repo/features/task-wire";
import {
  COMMENT_SUBJECT,
  DESCRIPTION_COMMENT_CALL_FAILURE,
  type ListedTasksView,
  TASK_CALL_FAILURE,
  TASKS_READ,
  type TaskListParts,
  type TasksView,
} from "@repo/features/tasks-view";
import { MP4_TYPE } from "@repo/features/video-signature";
import {
  INVITATION_ROLE,
  type WorkspaceInvitation,
} from "@repo/features/workspace-invitation-wire";
import {
  WORKSPACE_ROLE,
  type Workspace,
  type WorkspaceMembersAnswer,
} from "@repo/features/workspace-wire";
import { EXPERIMENT } from "@repo/settings";
import { ACT_KIND } from "./acts.js";
import {
  type AppHeldById,
  type AppInboxFound,
  type AppInboxItems,
  type AppInboxTask,
  type AppInboxTaskHolding,
  type AppManagerChat,
  type AppStateSnapshot,
  type AppTranscript,
  OWN_TRANSCRIPT,
  RUN_PROFILE,
  WORKSPACE_OWN_MEMORIES,
} from "./app-state.js";
import type { PortActKind, PortActPayload, PortActResult } from "./contract/index.js";
import {
  fixtureAgentOlderMessages,
  fixtureAgentPicture,
  fixtureAgentTranscript,
  fixtureDigestTranscript,
  fixtureLongTranscript,
  fixtureManagerTranscript,
} from "./fixture-agent-transcript.js";
import {
  FIXTURE_PICTURE_PNG,
  FIXTURE_PLAN_PDF,
  FIXTURE_VIDEO_MP4,
  FIXTURE_VIDEO_WEBM,
} from "./fixture-inbox-media.js";
import {
  FIXTURE_PULL_REQUEST,
  fixtureChanges,
  fixtureGeneratedChapters,
} from "./fixture-pull-requests.js";
import { FIXTURE_IDS, FIXTURE_PAGE, FIXTURE_TASK_NAME } from "./fixture-stage.js";

export { FIXTURE_RECORDING_ID } from "./fixture-agent-transcript.js";

export {
  FIXTURE_PULL_REQUEST,
  PULL_REQUEST_MOVE,
  type PullRequestMove,
  type PullRequestMoved,
  type PullRequestMoves,
  pullRequestMovedBy,
  pullRequestPartsAppState,
  type ThreadResolves,
  threadResolveOf,
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
  RUN_PROFILE.INBOX_LARGE,
  RUN_PROFILE.PERSON,
  RUN_PROFILE.TASKS_OPEN,
]);

/** The account signed in: the owner of the fixture's first workspace, which is named for it. */
const ADA = { userId: "user-ada", name: "Ada Lovelace" } as const;

/** A teammate, the workspace's admin, who is assigned a task the account follows. */
const GRACE = { userId: "user-grace", name: "Grace Hopper" } as const;

/**
 * The sign-in pictures the fixture's people stand in with: organizations'
 * logos on GitHub's avatar host, which the apps may load pictures from,
 * rather than anyone's face; Alan Turing is left with none, so his letters
 * stand in, as anyone's do without one.
 */
const PICTURE = {
  ADA: "https://avatars.githubusercontent.com/u/9919?v=4",
  GRACE: "https://avatars.githubusercontent.com/u/1342004?v=4",
} as const;

const ACCOUNT: AccountSnapshot = {
  status: ACCOUNT_STATUS.SIGNED_IN,
  id: ADA.userId,
  email: "ada@example.com",
  name: ADA.name,
  pictureUrl: PICTURE.ADA,
  provider: ACCOUNT_PROVIDER.GITHUB,
};

/** The account's own experiments its screens stand behind: Skills', which a `/` typed in a composer offers skills by, Move agents', which an agent's Move to › stands behind, and Merge queue's, whose page reads the fixture's queues ({@link MERGE_QUEUES}). Task descriptions' is its workspace's ({@link FIXTURE_WORKSPACE}). */
const STAGED_EXPERIMENTS = {
  [EXPERIMENT.SKILLS]: true,
  [EXPERIMENT.MOVE_AGENTS]: true,
  [EXPERIMENT.MERGE_QUEUE]: true,
} as const;

/** Main's settings with the staged experiments on, one object for each of main's, so a staging that moves nothing of them hands nothing new. */
const STAGED_SETTINGS = new WeakMap<
  NonNullable<AppStateSnapshot["settings"]>,
  NonNullable<AppStateSnapshot["settings"]>
>();

/** The tasks holding items: the reference journey's, and two of the account's own beside it. */
const TASK = {
  INVITES: FIXTURE_IDS.TASK,
  DIGEST: "3c9d5f7b-1e4a-4b62-8d8a-4f5a6b7c8d93",
  ROUNDING: "4dae6081-2f5b-4c73-9e9b-5a6b7c8d9ea4",
} as const;

/** The account's tasks that hold no item, which fill out its Tasks list: a sub-task of the reference journey's, one in a second repository, one in a section of its own, a teammate's it follows, and one filed for later and one canceled, so every status's mark is drawn. */
const LISTED = {
  COPY: "81e2a425-6d9f-4ab7-92df-9eafb0c1d2e8",
  ALERTS: "92f3b536-7eaf-4bc8-a3ea-afb0c1d2e3f9",
  LAUNCH: "a304c647-8fb0-4cd9-b4fb-b0c1d2e3f40a",
  SECTION: "b415d758-90c1-4dea-85ac-c1d2e3f4051b",
  SECTION_GLYPH: "4bc0607b-116b-47ec-9673-db097d8ed0c9",
  SECTION_EMOJI: "8e8769a9-694d-44b3-abaf-2b0a13bb8804",
  BILLING: "c526e869-a1d2-4efb-96bd-d2e3f405162c",
  EXPORT: "d637f97a-b2e3-4f0c-87ce-e3f405162737",
  DIGEST_V1: "e748a08b-c3f4-4a1d-98df-f405162738f4",
  LANDING: "f859b19c-d405-4b2e-a9e0-0516273849a5",
} as const;

/** The agents that posted the items, one at work on each task. */
const AGENT = {
  INVITES: "5ebf7192-3a6c-4d84-8fac-6b7c8d9eafb5",
  DIGEST: "6fc08203-4b7d-4e95-90bd-7c8d9eafb0c6",
  ROUNDING: "70d19314-5c8e-4fa6-81ce-8d9eafb0c1d7",
  MANAGER: "81e2a425-6d3f-4a07-92df-9eafb0c1d2e8",
} as const;

const MODEL = "anthropic/claude-opus-5.5";

/** The model the digest's agent runs on, Codex's, from the fixture's catalog. */
const CODEX_MODEL = "openai/gpt-6.1-sol";

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

/** The PDF the reference task's description keeps as it keeps a picture, by the id the service keeps it under, so a description's file chip has one to draw. */
const DESCRIPTION_PDF = "e738b0a4-c3f5-4a1d-b8d5-6f7182930b45";

/** The recorded thread's files: a still its words draw, the recording sent after them, and the test plan as a PDF, by the attachment each is read by. */
const RECORDED = {
  ITEM: fixtureId(10),
  PICTURE: "92f3b536-7eaf-4bc8-a3e0-1a2b3c4d5e6f",
  VIDEO: "a3f4c647-8fb0-4cd9-b4f1-2b3c4d5e6f70",
  PLAN: "b4058d71-90c2-4dea-85a2-3c4d5e6f7182",
} as const;

/** The turn-end thread's option files, by the attachment each is read by: a still of the card, one of the dock, and a recording of it. */
const TURN_END = {
  ITEM: fixtureId(6),
  CARD: "b4a5d758-90c1-4dea-85a2-3c4d5e6f7081",
  DOCK: "d6c7f97a-b2e3-4f0c-a7c4-5e6f708192a3",
  RECORDING: "e7d80a8b-c3f4-401d-b8d5-6f708192a3b4",
} as const;

/** One of the turn-end thread's option files as its option names it. */
function turnEndMedia(attachmentId: string, caption: string, recording = false) {
  const mediaType = recording ? CONVERSATION_MEDIA_TYPE.WEBM : AGENT_ATTACHMENT_TYPE.PNG;

  return { type: INBOX_OPTION_MEDIA.FILE, attachmentId, mediaType, caption } as const;
}

/** The turn-end thread's options: a card with its still and a page, the dock with a still, a recording, and a link, and one with none. */
const TURN_END_OPTIONS = [
  {
    label: "A done card",
    detail: "Archive, plus the follow-ups the agent mentioned.",
    media: [
      turnEndMedia(TURN_END.CARD, "On a desktop"),
      {
        type: INBOX_OPTION_MEDIA.PAGE,
        pageId: FIXTURE_PAGE.id,
        version: FIXTURE_PAGE.version,
        title: FIXTURE_PAGE.title,
        place: { taskId: TASK.INVITES },
      },
    ],
  },
  {
    label: "Two states of the dock",
    detail: "Needs you, then Done.",
    media: [
      turnEndMedia(TURN_END.DOCK, "The dock at rest"),
      turnEndMedia(TURN_END.RECORDING, "Ticking two follow-ups", true),
      {
        type: INBOX_OPTION_MEDIA.LINK,
        url: "https://preview.example.com/dock",
        label: "The dock on the preview",
      },
    ],
  },
  { label: "Leave it as it is", detail: "The transcript ends on Worked for." },
] as const;

/** A turn-end option's file as the service answers it: each still the fixture's picture, and the recording its video, as an MP4 to a reader that plays one. */
function turnEndFile(
  attachmentId: string,
  playable: string | undefined,
): PortActResult<typeof ACT_KIND.AGENTS_INBOX_ATTACHMENT> {
  if (attachmentId === TURN_END.RECORDING) {
    return playable === MP4_TYPE
      ? { contentType: MP4_TYPE, base64: FIXTURE_VIDEO_MP4 }
      : { contentType: CONVERSATION_MEDIA_TYPE.WEBM, base64: FIXTURE_VIDEO_WEBM };
  }

  const stills: readonly string[] = [TURN_END.CARD, TURN_END.DOCK];

  return stills.includes(attachmentId)
    ? { contentType: AGENT_ATTACHMENT_TYPE.PNG, base64: FIXTURE_PICTURE_PNG }
    : { failure: AGENT_CALL_FAILURE.NOT_FOUND };
}

/**
 * The thread whose answer the fixture refuses, as a send no answer came back
 * for: the migration's approval, so a flow sees an answer drawn at once and
 * taken back.
 */
const REFUSED_ITEM = fixtureId(2);

/** Where the recorded thread's words draw its still from: the still's address on the thread, as an agent's post names a picture it attached. */
const RECORDED_PICTURE_ADDRESS = inboxAttachmentAddress(
  { kind: LINK_DESTINATION.INBOX_ITEM, taskId: TASK.INVITES, itemId: RECORDED.ITEM },
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
  item(6, AGENT.INVITES, "turn-end", "How should a finished turn end?", [
    {
      ...agentSaid(
        116,
        90 * MINUTE,
        "Three directions for what a turn shows once the agent is done. Each card holds its shots; press one to look closer.",
        {
          type: INBOX_ASK.DECIDE,
          options: TURN_END_OPTIONS,
          multiple: true,
          recommended: "A done card",
          ...OPEN,
        },
      ),
      // Note that the options' files are the message's own, as the service keeps them.
      files: TURN_END_OPTIONS.flatMap((option) =>
        ("media" in option ? option.media : []).flatMap((media) =>
          media.type === INBOX_OPTION_MEDIA.FILE
            ? [
                {
                  attachmentId: media.attachmentId,
                  name: media.caption,
                  mediaType: media.mediaType,
                },
              ]
            : [],
        ),
      ),
    },
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
            // Note that the task's chip leads the message's first line, so `keep.yaml` holds it a little in from the line's start, and a hold on the message's other lines lands on no chip; the line is as long as it stood, so the thread opens as it did. It is still a view laid inline in the line's words inside a held message, so its menu is held as a chip mid-line is.
            // A chip mid-line has no element of its own until React Native's paragraph lists its inline views as accessibility elements, the follow-up to #10919, which moves it back mid-line and holds it by its element.
            "[@Teammate invitations](https://vespin.dev/personal/task/0f6a2c4e-8b1d-4e3f-9a57-1c2b3d4e5f60): I walked the invite flow in the preview, through to the accepted page:",
            "",
            `![The invite page](${RECORDED_PICTURE_ADDRESS})`,
            "",
            "The recording is under this. The expired page is still the placeholder.",
            "",
            // Note that each person's chip leads its own line, so `person.yaml` taps it near the line's start, since a chip mid-line has no element of its own.
            "[@Grace Hopper](https://vespin.dev/personal/person/user-grace) reviewed the flow.",
            "",
            // Note that this names someone no member is, whose page says so.
            "[@Nobody Known](https://vespin.dev/personal/person/user-nobody) was asked too.",
            "",
            // Note that this names the account itself, whose page leads with the Manager it started.
            "[@Ada Lovelace](https://vespin.dev/personal/person/user-ada) signed off on it.",
            "",
            // Note that this links a settled thread, outside the Open list, so a flow can push it over this one and come back to step on from here.
            "It goes out with the digest, on the day [@Which day the digest goes out](https://vespin.dev/personal/inbox/81e2a425-6d9f-4ab7-92df-00000000000d) settled.",
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
      {
        ...agentSaid(117, 23 * MINUTE, "The test plan I followed:"),
        files: [
          {
            attachmentId: RECORDED.PLAN,
            name: "invite-test-plan.pdf",
            mediaType: AGENT_ATTACHMENT_TYPE.PDF,
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

/** The rounding task's items: one closed by its agent once the question no longer stood, and one whose ask the agent withdrew before posting on, so the line saying so stands between its messages. */
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
  // Note that the agent's three messages stand within a few minutes, so only the withdrawn ask's line between them splits them into two runs.
  item(22, AGENT.ROUNDING, "tax-rounding", "Where the invoice's tax rounds", [
    agentSaid(
      320,
      3 * DAY,
      "Tax rounds per line today, so a three-line invoice can come out a cent off the tax on its total. Should it round once, on the total?",
      {
        type: INBOX_ASK.DECIDE,
        options: [{ label: "Per line" }, { label: "On the total" }],
        status: INBOX_ASK_STATUS.WITHDRAWN,
        withdrawnReason: "The tax spec says to round once, on the total.",
        withdrawnAt: LANDED - 3 * DAY + MINUTE,
      },
    ),
    agentSaid(321, 3 * DAY - 2 * MINUTE, "Tax now rounds once, on the invoice's total."),
    agentSaid(
      322,
      3 * DAY - 3 * MINUTE,
      "Added a test with three lines whose per-line tax comes to a cent more than the total's.",
    ),
  ]),
];

/** Each task's inbox, by the task's id. */
const INBOXES: ReadonlyMap<string, readonly InboxItem[]> = new Map([
  [TASK.INVITES, INVITES_ITEMS],
  [TASK.DIGEST, DIGEST_ITEMS],
  [TASK.ROUNDING, ROUNDING_ITEMS],
]);

/**
 * Each agent on no task's inbox, by the agent's id: the release Manager's one
 * question, which the Inbox lists under the Manager rather than a task, as
 * the account's feed carries it (`AppInboxItems`' `agents`).
 */
const AGENT_INBOXES = {
  [AGENT.MANAGER]: [
    item(60, AGENT.MANAGER, "cut-the-release", "Cut the release?", [
      agentSaid(
        600,
        30 * MINUTE,
        "Invites and the digest are merged and CI is green on main. Should I cut 0.25.0 now, or wait for the rounding fix?",
        {
          type: INBOX_ASK.DECIDE,
          options: [{ label: "Cut it now" }, { label: "Wait for rounding" }],
          ...OPEN,
        },
      ),
    ]),
  ],
} satisfies Readonly<Record<string, readonly InboxItem[]>>;

/** How many threads the large Inbox adds beside the staged ones, about as many as a busy real account holds (639 on the one that was timed). */
const LARGE_THREADS = 600;

/** The staged tasks the large Inbox's threads are spread over, each with its agent, so every thread stands on a plan the feed holds. */
const LARGE_HOLDERS = [
  { taskId: TASK.INVITES, agentId: AGENT.INVITES },
  { taskId: TASK.DIGEST, agentId: AGENT.DIGEST },
  { taskId: TASK.ROUNDING, agentId: AGENT.ROUNDING },
] as const;

/** A paragraph of a thread's words, as long as a real agent's post runs, with the Markdown a preview turns into plain words. */
const LARGE_WORDS =
  "I read through `src/billing/invoice.ts` and the **rounding** rules the description settles. Two of the cases disagree with what the tests expect, so I'd like a decision before I change either: should a partial cent round half up, as the invoice does today, or to even, as the ledger does? Either way I'll add a test for each case and note it in the description.";

/** The `n`th thread of the large Inbox: an agent's ask and the account's reply, then the agent's next ask, `n` hours back so they stand in order, every third answered. */
function largeThread(n: number): InboxItem {
  const holder = LARGE_HOLDERS[n % LARGE_HOLDERS.length] ?? LARGE_HOLDERS[0];
  const ago = (n + 1) * HOUR;
  const at = 10_000 + n * 4;

  return item(
    1000 + n,
    holder.agentId,
    `bulk-${n}`,
    `Thread ${n + 1}: decide how a partial cent rounds`,
    [
      agentSaid(at, ago, LARGE_WORDS),
      adaSaid(at + 1, ago - 10 * MINUTE, "Round to even, as the ledger does. Say why in the PR."),
      agentSaid(at + 2, ago - 20 * MINUTE, LARGE_WORDS, { type: INBOX_ASK.ANSWER, ...OPEN }),
    ],
    n % 3 === 0 ? { status: INBOX_STATUS.ANSWERED } : {},
  );
}

/** How many items each page of the older Inbox items stands, fewer than the service's, so a run reads every page in a short list; the last page short, as a service's last is. */
const OLDER_PAGE_ITEMS = [6, 3] as const;

/** How many pages of older items the staged account holds past its feed. */
const OLDER_PAGES = OLDER_PAGE_ITEMS.length;

/** The cursor the `page`th page of older items reads past, as the service's own word stands for it. */
function olderCursor(page: number): string {
  return `older-${page}`;
}

/** The `n`th older item: a closed thread of a staged task more than a month back, the latest first, so All lists it past the feed. */
function olderThread(n: number): InboxItem {
  const holder = LARGE_HOLDERS[n % LARGE_HOLDERS.length] ?? LARGE_HOLDERS[0];
  const ago = 35 * DAY + n * 9 * HOUR;
  const at = 20_000 + n * 2;

  return item(
    2000 + n,
    holder.agentId,
    `older-${n}`,
    `Older thread ${n + 1}: how a partial cent rounds`,
    [
      agentSaid(at, ago, LARGE_WORDS),
      adaSaid(at + 1, ago - 10 * MINUTE, "Round half up, as the invoice does."),
    ],
    { status: INBOX_STATUS.CLOSED, settledAt: LANDED - ago + 10 * MINUTE },
  );
}

/** The item only a search finds: a closed thread of the rounding task three months back, past every page of older items. */
function foundOnlyThread(): InboxItem {
  const ago = 92 * DAY;
  const at = 21_000;

  return item(
    2100,
    AGENT.ROUNDING,
    "found-0",
    "Quarter close: why the ledger rounds to even",
    [
      agentSaid(at, ago, LARGE_WORDS),
      adaSaid(at + 1, ago - 10 * MINUTE, "To even, as the ledger does; the invoice follows it."),
    ],
    { status: INBOX_STATUS.CLOSED, settledAt: LANDED - ago + 10 * MINUTE },
  );
}

/** Every staged item past the feed a search may find, by the task each stands on: the older threads, read or not, and the one only a search finds. */
function searchableItems(): readonly { readonly taskId: string; readonly item: InboxItem }[] {
  const total = OLDER_PAGE_ITEMS.reduce((sum, each) => sum + each, 0);

  const older = Array.from({ length: total }, (_, n) => ({
    taskId: (LARGE_HOLDERS[n % LARGE_HOLDERS.length] ?? LARGE_HOLDERS[0]).taskId,
    item: olderThread(n),
  }));

  return [...older, { taskId: TASK.ROUNDING, item: foundOnlyThread() }];
}

/** The staged items past the feed whose title holds every word of `query`, by the task each stands on, as the service's search answers them into the host. */
function stagedFound(query: string): AppInboxItems {
  const tokens = searchTokens(query);
  const onTasks = new Map<string, InboxItem[]>();

  for (const { taskId, item: found } of searchableItems()) {
    if (!matchesTokens([found.title], tokens)) continue;
    onTasks.set(taskId, [...(onTasks.get(taskId) ?? []), found]);
  }

  return { [INBOX_SCOPE_KIND.TASK]: Object.fromEntries(onTasks) };
}

/** What each place's search found in the run, by the place, as the host holds it (`LIVE_READ.INBOX_FOUND`). */
const foundAt = new Map<InboxSearchPlace, AppInboxFound>();

/** How many pages of older items the run has read, which All lists past the feed. */
let olderPagesRead = 0;

/** The older items the run has read, by the task each stands on, as the host holds them (`LIVE_READ.INBOX_OLDER`). */
function olderItemsRead(): AppInboxItems {
  const onTasks = new Map<string, InboxItem[]>();

  const read = OLDER_PAGE_ITEMS.slice(0, olderPagesRead).reduce((sum, each) => sum + each, 0);

  for (let n = 0; n < read; n += 1) {
    const holder = LARGE_HOLDERS[n % LARGE_HOLDERS.length] ?? LARGE_HOLDERS[0];
    onTasks.set(holder.taskId, [...(onTasks.get(holder.taskId) ?? []), olderThread(n)]);
  }

  return { [INBOX_SCOPE_KIND.TASK]: Object.fromEntries(onTasks) };
}

/** The staged items with the large Inbox's threads laid beside them, by the task each stands on. */
const LARGE_INBOXES: ReadonlyMap<string, readonly InboxItem[]> = new Map(
  [...INBOXES].map(([taskId, items]) => [
    taskId,
    [
      ...items,
      ...Array.from({ length: LARGE_THREADS }, (_, n) => n)
        .filter((n) => LARGE_HOLDERS[n % LARGE_HOLDERS.length]?.taskId === taskId)
        .map(largeThread),
    ],
  ]),
);

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
    taskId: taskId,
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

/** When the invitations agent's run began, which its transcript counts from. */
const INVITES_STARTED = LANDED - 3 * DAY;

/** How long before the fixture landed the digest agent's run began, which its transcript counts from. */
const DIGEST_AGO = 4 * HOUR;
const DIGEST_STARTED = LANDED - DIGEST_AGO;

/**
 * The call the invitations agent holds for the account's answer, as it asks
 * before a shell command in Ask mode: its last turn's test run, which its
 * transcript draws still under way.
 */
const INVITES_HELD: AgentPendingApproval = {
  id: fixtureId(94),
  toolUseId: "fixture-invites-resend-test",
  toolName: "Bash",
  title: "Run pnpm test src/members",
  description: "Run the members tests",
  input: { command: "pnpm test src/members", description: "Run the members tests" },
  askedAt: INVITES_STARTED + 72 * MINUTE,
  // Note that the harness proposed the command's first words, so Always allow names them and keeps them for every agent.
  commandPrefix: ["pnpm", "test"],
};

const AGENTS: ReadonlyMap<string, AgentSummary> = new Map([
  [
    TASK.INVITES,
    {
      ...agentOn(
        AGENT.INVITES,
        TASK.INVITES,
        "Build teammate invitations",
        AGENT_STATUS.RUNNING,
        3 * DAY,
      ),
      permissionMode: AGENT_PERMISSION_MODE.ASK,
      pendingApprovals: [INVITES_HELD],
      startedByAgentId: AGENT.MANAGER,
    },
  ],
  // Note that the digest's agent runs on Codex, so the agents' marks show both harnesses.
  [
    TASK.DIGEST,
    {
      ...agentOn(
        AGENT.DIGEST,
        TASK.DIGEST,
        "Send the weekly digest",
        AGENT_STATUS.RUNNING,
        DIGEST_AGO,
      ),
      model: CODEX_MODEL,
      runtime: AGENT_RUNTIME.CODEX,
      startedByAgentId: AGENT.MANAGER,
    },
  ],
  [
    TASK.ROUNDING,
    agentOn(AGENT.ROUNDING, TASK.ROUNDING, "Fix ledger rounding", AGENT_STATUS.COMPLETED, 5 * DAY),
  ],
]);

/** When the release Manager was started, which its chat counts from. */
const MANAGER_STARTED = LANDED - 2 * HOUR;

/**
 * The workspace's one Manager, an agent on no task, which the Tasks list
 * stands above Pinned and Search finds: at rest, its chat having said
 * something since the account last read it, so its row stands unread. It
 * started the invitations and digest agents, which its overview lists with
 * the invitations agent's pull request.
 */
/** The repositories the Manager works in, its checkout first, so its Settings name more than one. */
const MANAGER_REPOSITORIES = ["ada/relay", "ada/ledger"] as const;

const MANAGER: AgentSummary = {
  ...agentOn(AGENT.MANAGER, "", "Release manager", AGENT_STATUS.COMPLETED, 2 * HOUR),
  taskId: null,
  kind: AGENT_KIND.MANAGER,
  face: { character: MANAGER_FACE_CHARACTER.PLANET, color: MANAGER_FACE_COLOR.BLUE },
  readThrough: MANAGER_STARTED,
  saidAt: MANAGER_STARTED + 4 * MINUTE,
};

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

/**
 * The account's own tasks beside the reference journey's: one in progress
 * assigned to it, and one done it created. Note that each row carries both
 * lists of blocks whole, as a service's rows do, so a block is judged by
 * the row and never waits on a description the fixture does not hold.
 */
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
    blockedBy: [],
    blocks: [],
    // Note that its followers are the account, its assignee, letting its agents use her machines, and both teammates, one letting them.
    followers: [
      { userId: ADA.userId, assignee: true, machines: true },
      { userId: GRACE.userId, assignee: false, machines: true },
      { userId: "user-alan", assignee: false, machines: false },
    ],
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
    blockedBy: [],
    blocks: [],
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
    blockedBy: [],
    blocks: [],
    ...more,
  };
}

/**
 * The account's tasks that hold no item, which fill out its Tasks list as
 * the sidebar stands it: a sub-task under the reference journey's, which
 * the launch's checklist waits on, and a done one, which the journey waited
 * on, so its page draws a finished related task beside open ones, a task
 * in a second repository, so the list draws its repositories' headings,
 * one the account keeps in a section of its own, a teammate's it
 * follows, which the list draws under Following, and one filed for later
 * and one canceled, so the list draws every status's mark. Note that those
 * last two are named with Markdown's marks, and with letters beyond Latin
 * and an emoji, so a search's bold title shows every mark as typed and
 * lands on the right letters. With the reference journey's high, its tasks
 * stand at every priority, an urgent launch and a sub-task weighed by no one
 * among them, so the list draws every priority's mark too.
 */
const LISTED_TASKS: readonly TaskSummary[] = [
  listedTask(LISTED.COPY, "Invite email copy", {
    repository: "ada/relay",
    status: TASK_STATUS.TODO,
    number: 44,
    updatedAt: LANDED - 3 * HOUR,
    parentTaskId: TASK.INVITES,
    blocks: [LISTED.LAUNCH],
    priority: TASK_PRIORITY.NONE,
  }),
  listedTask(LISTED.LANDING, "Invite landing page", {
    repository: "ada/relay",
    status: TASK_STATUS.DONE,
    number: 50,
    updatedAt: LANDED - 1 * DAY,
    completedAt: LANDED - 1 * DAY,
    parentTaskId: TASK.INVITES,
    blocks: [TASK.INVITES],
  }),
  listedTask(LISTED.ALERTS, "Usage alerts", {
    repository: "ada/ledger",
    status: TASK_STATUS.TODO,
    number: 45,
    updatedAt: LANDED - 5 * HOUR,
    priority: TASK_PRIORITY.LOW,
    blocks: [TASK.INVITES],
  }),
  listedTask(LISTED.LAUNCH, "Launch checklist", {
    repository: "ada/relay",
    status: TASK_STATUS.IN_PROGRESS,
    number: 46,
    updatedAt: LANDED - 7 * HOUR,
    blocked: true,
    blockedBy: [LISTED.COPY],
    priority: TASK_PRIORITY.URGENT,
  }),
  // Note that the account follows a teammate's task, which the Tasks list draws under Following.
  listedTask(LISTED.BILLING, "Billing export", {
    repository: "ada/relay",
    status: TASK_STATUS.IN_PROGRESS,
    number: 47,
    updatedAt: LANDED - 9 * HOUR,
    ownerId: GRACE.userId,
    createdBy: GRACE,
    assignee: GRACE,
    followers: [
      { userId: GRACE.userId, assignee: true, machines: true },
      { userId: ADA.userId, assignee: false, machines: false },
    ],
  }),
  listedTask(LISTED.EXPORT, "Ledger *CSV* export (v2_final)", {
    repository: "ada/ledger",
    status: TASK_STATUS.BACKLOG,
    number: 48,
    updatedAt: LANDED - 2 * DAY,
    priority: TASK_PRIORITY.LOW,
  }),
  listedTask(LISTED.DIGEST_V1, "Daily digest 日報 for Zoë 📬", {
    repository: "ada/relay",
    status: TASK_STATUS.CANCELED,
    number: 49,
    createdAt: LANDED - 8 * DAY,
    updatedAt: LANDED - 5 * DAY,
    completedAt: LANDED - 5 * DAY,
  }),
];

/** The tasks the fixture lays after the list's own, by id. */
const STAGED_TASK_IDS: ReadonlySet<string> = new Set(
  [...OWN_TASKS, ...LISTED_TASKS].map((task) => task.id),
);

/**
 * The account's sections: Launch, with no icon, holding the launch's
 * checklist, then two empty ones wearing an icon from the panel's picker,
 * one of its suggested glyphs and one emoji, so a sidebar draws each kind.
 */
const LISTED_SECTIONS: NonNullable<TasksView["taskSections"]> = {
  sections: [
    {
      id: LISTED.SECTION,
      workspaceId: FIXTURE_IDS.WORKSPACE,
      title: "Launch",
      createdAt: LANDED - 8 * DAY,
    },
    {
      id: LISTED.SECTION_GLYPH,
      workspaceId: FIXTURE_IDS.WORKSPACE,
      title: "Experiments",
      icon: { kind: TASK_SECTION_ICON_KIND.GLYPH, glyph: TASK_SECTION_GLYPH.ROCKET },
      createdAt: LANDED - 7 * DAY,
    },
    {
      id: LISTED.SECTION_EMOJI,
      workspaceId: FIXTURE_IDS.WORKSPACE,
      title: "Ideas",
      icon: { kind: TASK_SECTION_ICON_KIND.EMOJI, emoji: "💡" },
      createdAt: LANDED - 6 * DAY,
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

/** The fixture's workspace where a list names none, as the panel's tasks fixture names it, with Task descriptions and Managers on. */
const FIXTURE_WORKSPACE: Workspace = {
  id: FIXTURE_IDS.WORKSPACE,
  name: ADA.name,
  slug: FIXTURE_WORKSPACE_SLUG,
  role: WORKSPACE_ROLE.OWNER,
  github: { login: "ada", active: true },
  personal: true,
  memberCount: 1,
  pictureUrl: PICTURE.ADA,
  experiments: [
    {
      experiment: EXPERIMENT.DESCRIPTIONS,
      on: true,
      changedBy: { id: ADA.userId, name: ADA.name },
      changedAt: LANDED - 30 * DAY,
    },
    {
      experiment: EXPERIMENT.MANAGERS,
      on: true,
      changedBy: { id: ADA.userId, name: ADA.name },
      changedAt: LANDED - 30 * DAY,
    },
  ],
};

/** The fixture workspace's people, as Settings › Workspace lists them: the account, its owner, an admin, and a member. */
const MEMBERS: WorkspaceMembersAnswer = {
  members: [
    {
      userId: ADA.userId,
      name: ADA.name,
      email: "ada@example.com",
      role: WORKSPACE_ROLE.OWNER,
      pictureUrl: PICTURE.ADA,
    },
    {
      userId: "user-grace",
      name: "Grace Hopper",
      email: "grace@example.com",
      role: WORKSPACE_ROLE.ADMIN,
      pictureUrl: PICTURE.GRACE,
    },
    {
      userId: "user-alan",
      name: "Alan Turing",
      email: "alan@example.com",
      role: WORKSPACE_ROLE.MEMBER,
    },
  ],
};

/** What a memory's save answers in a run that refuses writes, as the service answers one it refused: the workspace holds all it may. */
export const MEMORY_SAVE_REFUSED = { failure: MEMORY_SAVE_FAILURE.MEMORY_FULL } as const;

/** The id a memory the fixture is asked to keep anew is kept under. */
export const NEW_MEMORY_ID = "5b0c4c1e-3f7a-4d8e-9a51-1c2d3e4f5a64";

/** A memory as the fixture keeps one: by Ada, a correction keeping its memory's id, its time and its recalls, and a new one under its own id. */
function savedMemory(text: string, corrected: MemorySummary | undefined): MemorySummary {
  return {
    id: corrected?.id ?? NEW_MEMORY_ID,
    text,
    keptBy: { userId: ADA.userId, name: ADA.name },
    forgettable: true,
    createdAt: corrected?.createdAt ?? LANDED,
    updatedAt: LANDED,
    source: null,
    recalls30d: corrected?.recalls30d ?? 0,
    lastRecalledAt: corrected?.lastRecalledAt ?? null,
  };
}

/**
 * The fixture workspace's memories, as Settings › Memory lists them: one an
 * agent of the account kept and agents recall often, one Grace kept this
 * week, which reads as New and the account may delete as its owner, and one
 * no agent was handed in the recall window.
 */
const MEMORIES: readonly MemorySummary[] = [
  {
    id: "5b0c4c1e-3f7a-4d8e-9a51-1c2d3e4f5a61",
    text: "The web server's tests run on PGlite through `test:store`.",
    keptBy: { userId: ADA.userId, name: ADA.name },
    forgettable: true,
    createdAt: LANDED - 20 * DAY,
    updatedAt: LANDED - 20 * DAY,
    source: null,
    recalls30d: 14,
    lastRecalledAt: LANDED - 2 * HOUR,
  },
  {
    id: "5b0c4c1e-3f7a-4d8e-9a51-1c2d3e4f5a62",
    text: "Release dates are written in Eastern time, never UTC.",
    keptBy: { userId: "user-grace", name: "Grace Hopper" },
    forgettable: true,
    createdAt: LANDED - 2 * DAY,
    updatedAt: LANDED - 2 * DAY,
    source: null,
    recalls30d: 3,
    lastRecalledAt: LANDED - DAY,
  },
  {
    id: "5b0c4c1e-3f7a-4d8e-9a51-1c2d3e4f5a63",
    text: "The staging database is reset every Sunday night.",
    keptBy: { userId: "user-alan", name: "Alan Turing" },
    forgettable: true,
    createdAt: LANDED - 60 * DAY,
    updatedAt: LANDED - 60 * DAY,
    source: null,
    recalls30d: 0,
    lastRecalledAt: null,
  },
];

/** The Manager's own memories, kept for it alone: one Ada added in its Settings, one it kept itself as it worked for her. */
const MANAGER_MEMORIES: readonly MemorySummary[] = [
  {
    id: "5b0c4c1e-3f7a-4d8e-9a51-1c2d3e4f5a71",
    text: "Ada wants a coder's pull request left unarmed until she reads it.",
    keptBy: { userId: ADA.userId, name: ADA.name },
    forgettable: true,
    createdAt: LANDED - 3 * DAY,
    updatedAt: LANDED - 3 * DAY,
    source: null,
    recalls30d: 6,
    lastRecalledAt: LANDED - 3 * HOUR,
  },
  {
    id: "5b0c4c1e-3f7a-4d8e-9a51-1c2d3e4f5a72",
    text: "Screenshots for a UI change are taken light and dark, on desktop and on a phone.",
    keptBy: { userId: ADA.userId, name: ADA.name },
    forgettable: true,
    createdAt: LANDED - 9 * DAY,
    updatedAt: LANDED - 9 * DAY,
    source: null,
    managerSource: { agentId: AGENT.MANAGER, messageId: null, name: "Release manager" },
    recalls30d: 2,
    lastRecalledAt: LANDED - 2 * DAY,
  },
];

/** The code of the one pairing waiting on the account, as a machine's link names it (`maestro/settings-machine-connect.yaml`). */
const PENDING_PAIRING_CODE = "BCDFGHJK";

/** The machine waiting on that code, as it named itself, and when its code lapses: ten minutes after the fixture landed. */
const PENDING_PAIRING: HostPairingAnswer = {
  name: "Ada's Mac mini",
  platform: DEVICE_PLATFORM.DARWIN,
  arch: DEVICE_ARCH.ARM64,
  ip: "203.0.113.7",
  expiresAt: LANDED + 10 * 60_000,
};

/** A pairing's read, approve, or deny, as the service answers it: the waiting machine for its code, and no pending pairing for any other. */
function pairingAnswer<Answer>(code: string, answer: Answer) {
  return code === PENDING_PAIRING_CODE ? answer : { failure: HOST_PAIRING_CALL_FAILURE.NOT_FOUND };
}

/** The account's machines, as Settings › Machines lists them: a Mac online and a Linux server the sweep marks away. */
const HOSTS: readonly HostLine[] = [
  {
    id: "7a1c9e3b-2f4d-4c6a-8b0e-5d7f9a1c3e52",
    name: "Ada's MacBook Pro",
    platform: DEVICE_PLATFORM.DARWIN,
    model: "MacBook Pro (M4 Pro, 2024)",
    calledIn: true,
  },
  {
    id: "3f6b0c2e-8d1a-4b5e-9c7d-2a4e6f8b0d14",
    name: "build-box",
    platform: DEVICE_PLATFORM.LINUX,
    calledIn: true,
    away: true,
  },
];

/** Ada's machines as the account's machines read names them, her MacBook first, which the ask below is held by. */
const MACHINES: readonly MachineLine[] = HOSTS.map((host, index) => ({
  id: host.id,
  name: host.name,
  ...(host.platform === undefined ? undefined : { platform: host.platform }),
  host: true,
  listening: host.away !== true,
  isDefault: index === 0,
}));

/** What the invitations agent's run on Ada's MacBook waits on her for: a command its Mac asks before it runs, about four minutes left in its window. */
const MACHINE_ASKS: readonly MachineAskLine[] = [
  {
    id: "c41d7a2e-9b3f-4e15-8a6c-0d2f4b6e8a91",
    deviceId: HOSTS[0]?.id ?? "",
    agentId: AGENT.INVITES,
    subject: { command: "pnpm --filter @app/members test -- invite.test.ts" },
    askedAt: LANDED - 52_000,
    expiresAt: LANDED + 248_000,
    lapsed: false,
  },
];

/** The skills a fixture run's Add skill finds in its repository, the one the paste named ticked. */
const SOURCE_SKILLS: readonly InstalledSkillCandidate[] = [
  {
    name: "frontend-design",
    description: "Lay out a screen from the team's design tokens.",
    path: "skills/frontend-design",
    bytes: 2_048,
    selected: true,
    fileCount: 2,
    problems: [],
  },
  {
    name: "changelog",
    description: "Write a changelog entry from the commits since the last tag.",
    path: "skills/changelog",
    bytes: 1_536,
    selected: false,
    fileCount: 1,
    problems: [],
  },
];

/** The repository a fixture run's Add skill reads. */
const SKILL_SOURCE_PREVIEW: InstalledSkillPreview = {
  kind: SKILL_PASTE_KIND.SOURCE,
  owner: "acme",
  repo: "agent-skills",
  ref: "main",
  sha: "7a1b2c3d4e5f60718293a4b5c6d7e8f901a2b3c4",
  skills: SOURCE_SKILLS,
  missing: [],
};

/** A frontmatter line's value, such as a pasted skill's `name:`. */
function frontmatterValue(text: string, key: string): string | undefined {
  const line = text.split("\n").find((each) => each.startsWith(`${key}:`));

  return line?.slice(key.length + 1).trim();
}

/** What a fixture run's Add skill reads a paste as: a skill's text where it opens on frontmatter, a GitHub source where it names one, and nothing we install from otherwise. */
function skillPreviewOf(text: string): InstalledSkillPreview {
  const pasted = text.trim();

  if (!pasted.startsWith("---")) {
    return /github\.com|^npx skills add |^[\w.-]+\/[\w.-]+$/.test(pasted)
      ? SKILL_SOURCE_PREVIEW
      : UNSUPPORTED_PREVIEW;
  }

  // Note that a key the frontmatter leaves out reads as empty, as the page fills an absent one.
  return {
    kind: SKILL_PASTE_KIND.TEXT,
    name: frontmatterValue(pasted, "name") ?? "",
    description: frontmatterValue(pasted, "description") ?? "",
    bytes: pasted.length,
    problems: [],
  };
}

/** A skill a fixture run's Add skill installed, as the service answers it: the account's own, by Ada. */
function installedSkill(name: string, description: string): InstalledSkillSummary {
  return {
    id: "9c1e2d3f-4a5b-4c6d-8e7f-0a1b2c3d4e59",
    scope: INSTALLED_SKILL_SCOPE.PERSONAL,
    name,
    description,
    userInvocable: true,
    source: { type: INSTALLED_SKILL_SOURCE.TEXT },
    enabled: true,
    installedBy: ADA.userId,
    manageable: true,
    createdAt: LANDED,
    updatedAt: LANDED,
  };
}

/** The account's own skills, as Settings › Skills lists them: one read from GitHub at a commit, and one pasted. */
const INSTALLED_SKILLS: readonly InstalledSkillSummary[] = [
  {
    id: "9c1e2d3f-4a5b-4c6d-8e7f-0a1b2c3d4e51",
    scope: INSTALLED_SKILL_SCOPE.PERSONAL,
    name: "release-notes",
    description: "Write a release's notes from the pull requests merged since the last tag.",
    userInvocable: true,
    source: {
      type: INSTALLED_SKILL_SOURCE.GITHUB,
      owner: "ada",
      repo: "skills",
      path: "release-notes",
      ref: "main",
      sha: "3f9c2e1a7b4d6e8f0a1b2c3d4e5f6a7b8c9d0e1f",
    },
    enabled: true,
    installedBy: ADA.userId,
    manageable: true,
    createdAt: LANDED - 9 * DAY,
    updatedAt: LANDED - 9 * DAY,
  },
  {
    id: "9c1e2d3f-4a5b-4c6d-8e7f-0a1b2c3d4e52",
    scope: INSTALLED_SKILL_SCOPE.PERSONAL,
    name: "pr-style",
    description: "Title and describe a pull request the way this team does.",
    userInvocable: false,
    source: { type: INSTALLED_SKILL_SOURCE.TEXT },
    enabled: true,
    installedBy: ADA.userId,
    manageable: true,
    createdAt: LANDED - 3 * DAY,
    updatedAt: LANDED - 3 * DAY,
  },
];

/** What Open reads of each fixture skill, by its id: its SKILL.md, and the files beside it. */
const INSTALLED_SKILL_FILES: ReadonlyMap<
  string,
  {
    readonly skillFile: string;
    readonly files: readonly { readonly path: string; readonly bytes: number }[];
  }
> = new Map([
  [
    "9c1e2d3f-4a5b-4c6d-8e7f-0a1b2c3d4e51",
    {
      skillFile:
        "---\nname: release-notes\ndescription: Write a release's notes from the pull requests merged since the last tag.\n---\n\n# Release notes\n\nList each merged pull request under its kind.\n\n[@Teammate invitations](https://vespin.dev/personal/task/0f6a2c4e-8b1d-4e3f-9a57-1c2b3d4e5f60) holds this release's checklist.\n",
      files: [
        { path: "SKILL.md", bytes: 214 },
        { path: "template.md", bytes: 1_204 },
      ],
    },
  ],
  [
    "9c1e2d3f-4a5b-4c6d-8e7f-0a1b2c3d4e52",
    {
      skillFile:
        "---\nname: pr-style\ndescription: Title and describe a pull request the way this team does.\n---\n\n# Pull request style\n\nTitle it as a Conventional Commit, and say what changed and why.\n",
      files: [{ path: "SKILL.md", bytes: 196 }],
    },
  ],
]);

/** The apps the account allowed to use it over MCP, as Settings › MCP lists them: one signing in on this computer, active today, and one on the web. */
const MCP_CLIENTS: readonly McpClient[] = [
  {
    clientId: "mcp-client-terminal",
    name: "Claude Code",
    redirectUris: ["http://localhost:53682/callback"],
    allowedAt: LANDED - 12 * DAY,
    lastRefreshedAt: LANDED - 3 * HOUR,
  },
  {
    clientId: "mcp-client-web",
    name: "ChatGPT",
    redirectUris: ["https://chatgpt.com/connector_platform_oauth_redirect"],
    allowedAt: LANDED - 30 * DAY,
    lastRefreshedAt: null,
  },
];

/**
 * The fixture workspace's cloud environment, as Settings › Cloud environment
 * reads it: a size above the default, two secrets and a config (whose
 * value, a plain word, is the one a member may read), the install script,
 * which last ran in the invitations agent's sandbox, and one repository's
 * setup script. Nothing here is a credential: a secret's value is never
 * answered.
 */
const CLOUD_ENVIRONMENT = {
  SIZE: { vcpus: 4 },
  VARIABLES: {
    variables: [
      {
        name: "DATABASE_URL",
        secret: true,
        createdAt: LANDED - 20 * DAY,
        updatedAt: LANDED - 2 * DAY,
        createdBy: GRACE,
        updatedBy: ADA,
      },
      {
        name: "NODE_ENV",
        secret: false,
        value: "development",
        createdAt: LANDED - 20 * DAY,
        updatedAt: LANDED - 20 * DAY,
        createdBy: GRACE,
      },
      {
        name: "STRIPE_SECRET_KEY",
        secret: true,
        createdAt: LANDED - 6 * HOUR,
        updatedAt: LANDED - 6 * HOUR,
        createdBy: ADA,
      },
    ],
  },
  SETUP: {
    install: {
      script: "sudo apt-get update\nsudo apt-get install -y postgresql-client",
      updatedAt: LANDED - 9 * DAY,
      lastRun: {
        ranAt: LANDED - 3 * HOUR,
        exitCode: 0,
        agent: { id: AGENT.INVITES, taskId: TASK.INVITES, name: "Build teammate invitations" },
      },
    },
    setups: [
      {
        repository: "ada/relay",
        script: "pnpm install\npnpm db:migrate",
        updatedAt: LANDED - 4 * DAY,
      },
    ],
    archives: [],
    runActions: [],
  },
} as const;

/** The fixture workspace's one pending invitation, a week from running out. */
const INVITATIONS: readonly WorkspaceInvitation[] = [
  {
    id: "invitation-katherine",
    email: "katherine@example.com",
    role: INVITATION_ROLE.MEMBER,
    expiresAt: new Date(LANDED + 7 * DAY).toISOString(),
    acceptUrl: "https://vespin.dev/accept-invitation/invitation-katherine",
  },
];

/** Relay's photo, as the host holds a workspace's photo once fetched: a teal disc with a band across it on transparent pixels, so a drawn photo reads apart from a letter on its hue, and a tile that drew its letter under the photo would show it in the corners. */
const TEAM_PHOTO = {
  version: "relay-photo-2",
  url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAAiUlEQVR42u3ZyQ2AMBBD0RRBxZzpOXSAFGa3viXuficUz1qEENdcz72/vnGF24KsxUsh3uXTEFHFUyBZ5UMQ2eVdEVXl3RCjAdXlTYgu5X8jRgO6lT9GAABgAOzmAQAAAAAAsQD+xAAA8CLjXSy1TDBsjZ8WJcZdiXld4sAhc2KSOPLJnFkJGZ4XDifVZR4EdxUAAAAASUVORK5CYII=",
} as const;

/**
 * A team the fixture's account is a member of beside its own, where a list
 * names none, so the iOS app's workspace switcher has another to list and
 * a flow has one to switch to; it holds no tasks and no threads.
 */
const TEAM_WORKSPACE: Workspace = {
  id: "workspace-relay",
  name: "Relay",
  slug: "relay",
  role: WORKSPACE_ROLE.MEMBER,
  github: { login: "relay-dev", active: true },
  memberCount: 6,
  photoVersion: TEAM_PHOTO.version,
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
export function inboxTasksView(profile: string, list: ListedTasksView): ListedTasksView {
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

  // Note that the Manager works on no task, so it stands in the fixture's workspace by itself.
  const manager = {
    ...MANAGER,
    workspaceId: FIXTURE_IDS.WORKSPACE,
    repository: MANAGER_REPOSITORIES[0],
    settledAt: MANAGER.createdAt,
  };

  const invitesAgent = AGENTS.get(TASK.INVITES);

  // Note that the staged list is the whole answer, so it stands read, because Search waits on a list still being read before it says nothing matched.
  return {
    ...list,
    tasks,
    listed: true,
    listStatus: TASKS_READ.READY,
    taskAgents: [
      ...(list.taskAgents ?? []).filter(
        (agent) => agent.id !== manager.id && !followed.some(({ id }) => id === agent.id),
      ),
      ...followed,
      manager,
    ],
    taskSections: LISTED_SECTIONS,
    workspaces: list.workspaces.some((workspace) => workspace.id === FIXTURE_IDS.WORKSPACE)
      ? list.workspaces
      : [FIXTURE_WORKSPACE, TEAM_WORKSPACE, ...list.workspaces],
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
  "- Follow-up: [@#131 Let an owner resend an invite that expired from the members page, with a fresh link](https://github.com/ada/relay/pull/131)",
  "- File: [@invite.ts](https://github.com/ada/relay/blob/HEAD/src/members/invite.ts)",
  "- Date: [@Nov 16, 2026](mention://date/2026-11-16)",
  "",
  `![Invite flow spec](https://vespin.dev/personal/task/${FIXTURE_IDS.TASK}/files/${DESCRIPTION_PDF})`,
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
    description: { body: INVITES_DESCRIPTION, assumptions: [] },
    blockedBy: [LISTED.ALERTS, LISTED.LANDING],
    blocks: [],
  };
}

/**
 * The reference journey's description history, newest first, as its
 * version history lists it: its agent's last revision, which is the
 * description as it stands, Ada's before it, and the description before
 * its history began.
 */
const INVITES_HISTORY: DescriptionRevisionsAnswer = {
  revisions: [
    {
      seq: 3,
      lastEdit: {
        actor: DESCRIPTION_ACTOR.AGENT,
        label: "Build the invite flow",
        agentId: AGENT.INVITES,
        at: LANDED - HOUR,
        duringCall: false,
      },
      agentId: AGENT.INVITES,
      startedAt: LANDED - 2 * HOUR,
      changes: 4,
    },
    {
      seq: 2,
      lastEdit: {
        actor: DESCRIPTION_ACTOR.DEVELOPER,
        by: { userId: ADA.userId, name: ADA.name },
        at: LANDED - DAY,
        duringCall: false,
      },
      startedAt: LANDED - DAY - HOUR,
      changes: 2,
    },
    {
      seq: 1,
      lastEdit: { actor: DESCRIPTION_ACTOR.EARLIER, at: LANDED - 3 * DAY, duringCall: false },
      startedAt: LANDED - 3 * DAY,
      changes: 0,
    },
  ],
};

/**
 * Ada's draft of the reference journey's description, before its agent took
 * it on: a goal of one line, and a question the agent's version answered and
 * struck, so the newest version reads against it as sections written in,
 * changed and struck.
 */
const INVITES_DRAFT = [
  "## Context",
  "",
  "Only an admin can add someone to a workspace.",
  "",
  "## Open questions",
  "",
  "- Should an invite expire?",
  "",
  "## Goal",
  "",
  "- A member invites a teammate by email.",
  "",
].join("\n");

/** The reference journey's description as one of its versions left it: whole at the newest, Ada's draft before it, and the draft's opening first. */
function invitesVersionBody(seq: number): string {
  const newest = INVITES_HISTORY.revisions[0]?.seq;

  if (seq === newest) return INVITES_DESCRIPTION;

  return seq === 1 ? (INVITES_DRAFT.split("\n\n## Open questions")[0] ?? "") : INVITES_DRAFT;
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

/**
 * Each held descriptions slice with the reference journey's laid over it, by
 * the slice, so a slice staged is never staged anew.
 */
const STAGED_DOCUMENTS = new WeakMap<
  AppStateSnapshot[typeof LIVE_READ.HELD_TASK],
  AppStateSnapshot[typeof LIVE_READ.HELD_TASK]
>();

/**
 * The descriptions slice with the reference journey's laid over it, its
 * fields the task's as these profiles list it (`ownInvites` of the
 * stand-in, `inboxTasksView`), so its page and its row say the same.
 */
function stagedDocuments(state: AppStateSnapshot): AppStateSnapshot[typeof LIVE_READ.HELD_TASK] {
  const held = state[LIVE_READ.HELD_TASK];
  const staged = STAGED_DOCUMENTS.get(held);

  if (staged !== undefined) return staged;

  const laid = {
    ...held,
    [TASK.INVITES]: { rows: { task: invitesDocument(ownInvites(INVITES_TASK)) } },
  };

  STAGED_DOCUMENTS.set(held, laid);
  STAGED_DOCUMENTS.set(laid, laid);

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

/** The files Ada's question on the description carries, by the ids the service keeps them under: a screenshot and a PDF, so a comment's pictures and its file chips both stand on its thread. */
const COMMENT_FILES = {
  PICTURE: "c5169e82-a1d3-4efb-96b3-4d5e6f718293",
  PLAN: "d627af93-b2e4-4f0c-a7c4-5e6f718293a4",
} as const;

/** The threads on the reference journey's description: one open, Ada's question with its files and its agent's answer, and one resolved, which its page leaves out. */
const INVITES_THREADS: readonly DescriptionCommentThread[] = [
  {
    id: fixtureId(301),
    scope: DESCRIPTION_COMMENT_SCOPE.WORDS,
    quote: "Invites expire after seven days",
    anchor: { from: 0, to: 31 },
    section: "Goal",
    status: DESCRIPTION_COMMENT_STATUS.OPEN,
    entries: [
      {
        id: fixtureId(302),
        kind: DESCRIPTION_COMMENT_ENTRY.COMMENT,
        writer: { actor: DESCRIPTION_COMMENT_ACTOR.MEMBER, by: ADA },
        words: "Should an owner be able to resend an expired invite from this page?",
        files: [
          {
            attachmentId: COMMENT_FILES.PICTURE,
            name: "expired-invite.png",
            mediaType: AGENT_ATTACHMENT_TYPE.PNG,
          },
          {
            attachmentId: COMMENT_FILES.PLAN,
            name: "resend-flow.pdf",
            mediaType: AGENT_ATTACHMENT_TYPE.PDF,
          },
        ],
        at: LANDED - 3 * HOUR,
      },
      {
        id: fixtureId(303),
        kind: DESCRIPTION_COMMENT_ENTRY.COMMENT,
        writer: { actor: DESCRIPTION_COMMENT_ACTOR.AGENT, agentId: AGENT.INVITES },
        words: "Yes: Resend stands beside each expired invite, and it mints a new link.",
        at: LANDED - 2 * HOUR,
      },
    ],
    createdAt: LANDED - 3 * HOUR,
    updatedAt: LANDED - 2 * HOUR,
    revision: 2,
  },
  {
    id: fixtureId(304),
    scope: DESCRIPTION_COMMENT_SCOPE.BLOCK,
    quote: "Send the invite email from the workspace's own domain",
    section: "Goal",
    status: DESCRIPTION_COMMENT_STATUS.RESOLVED,
    entries: [
      {
        id: fixtureId(305),
        kind: DESCRIPTION_COMMENT_ENTRY.COMMENT,
        writer: { actor: DESCRIPTION_COMMENT_ACTOR.MEMBER, by: ADA },
        words: "Done in the email template.",
        at: LANDED - 5 * HOUR,
      },
    ],
    createdAt: LANDED - 5 * HOUR,
    updatedAt: LANDED - 4 * HOUR,
    revision: 3,
  },
];

/**
 * The threads a fixture run wrote on the invites task's description, by id,
 * each as the run last left it: one it started, or a staged one it replied
 * to, resolved, or reopened. Note that the run's answers are given before
 * the act reaches the host, so no declared write draws them; the comments
 * slice lays them over the staged threads instead (`stagedComments`).
 */
const RUN_THREADS = new Map<string, DescriptionCommentThread>();

/** How many times the run has written a thread, so a comments slice laid before the latest write is laid again rather than read from the cache. */
let runThreadWrites = 0;

/** The number the next entry the run writes is given its id by, a kept reply or a resolve's or reopen's line, past every id the fixture stages, so each is keyed apart. */
let nextReplyId = 1000;

/** Keeps a thread the run wrote as it now stands, and answers it. */
function keepRunThread(thread: DescriptionCommentThread): DescriptionCommentThread {
  RUN_THREADS.set(thread.id, thread);
  runThreadWrites += 1;

  return thread;
}

/** Keeps a thread the run changed, moved on a revision, and answers it. */
function keepChanged(thread: DescriptionCommentThread): DescriptionCommentThread {
  return keepRunThread({ ...thread, revision: thread.revision + 1, updatedAt: Date.now() });
}

/** Each held comments slice with the reference journey's description threads laid over it, and how many thread writes of the run it holds, so a write since lays it again. */
const STAGED_COMMENTS = new WeakMap<
  AppStateSnapshot[typeof LIVE_READ.DESCRIPTION_COMMENTS],
  {
    readonly writes: number;
    readonly laid: AppStateSnapshot[typeof LIVE_READ.DESCRIPTION_COMMENTS];
  }
>();

function stagedComments(
  state: AppStateSnapshot,
): AppStateSnapshot[typeof LIVE_READ.DESCRIPTION_COMMENTS] {
  const held = state[LIVE_READ.DESCRIPTION_COMMENTS];
  const staged = STAGED_COMMENTS.get(held);

  if (staged?.writes === runThreadWrites) return staged.laid;

  // Note that each staged thread stands as the run last left it, then each thread the run started, in the order it started them, then any other the host drew.
  const standing = INVITES_THREADS.map((thread) => RUN_THREADS.get(thread.id) ?? thread);

  const started = [...RUN_THREADS.values()].filter(
    (thread) => !INVITES_THREADS.some((each) => each.id === thread.id),
  );

  const drawn = (held[COMMENT_SUBJECT.DESCRIPTION][TASK.INVITES]?.rows ?? []).filter(
    (thread) =>
      !RUN_THREADS.has(thread.id) && !INVITES_THREADS.some((each) => each.id === thread.id),
  );

  const laid = {
    ...held,
    [COMMENT_SUBJECT.DESCRIPTION]: {
      ...held[COMMENT_SUBJECT.DESCRIPTION],
      [TASK.INVITES]: { rows: [...standing, ...started, ...drawn] },
    },
  };

  const entry = { writes: runThreadWrites, laid };
  STAGED_COMMENTS.set(held, entry);
  STAGED_COMMENTS.set(laid, entry);

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
  fixtureAgentTranscript(INVITES_STARTED, ADA, "Build teammate invitations"),
);

/** The rounding agent's finished run, long enough that its page opens far below its first row, its words wide in places: a link, a code block, and a table. */
const ROUNDING_TRANSCRIPT = fixtureLongTranscript(LANDED - 5 * DAY, ADA, "Fix ledger rounding");

/** The digest agent's run, which the weekly digest automation's newest run opens. */
const DIGEST_TRANSCRIPT = fixtureDigestTranscript(DIGEST_STARTED, ADA, "Send the weekly digest");

/** The release Manager's run, whose turns' work its chat keeps a press away. */
const MANAGER_TRANSCRIPT = fixtureManagerTranscript(MANAGER_STARTED, ADA, "Release manager");

/** The release Manager's turn, which its two messages were sent in (`fixtureManagerTranscript`). */
const MANAGER_TURN = "fixture-manager-turn";

/** The release Manager's message the account answered in its thread, which the chat's thread opens on. */
const MANAGER_THREAD_ROOT = "7b2d40e8";

/**
 * The release Manager's chat as its rows stand, newest first as the host
 * holds them: the account's ask, then the two messages its turn sent the
 * account, a minute apart, so they stand in one run under the ask; in
 * the thread of the first of them, the account's question and the
 * Manager's answer, which the chat sums as "2 replies" under it. First
 * of all stands a picture the account sent with no words with its ask,
 * whose own long press opens its thread. The Manager gave the account's
 * ask its 👍, the account and Grace gave its first answer theirs, and the
 * account gave its 👍 to the answer in the thread. The account edited its
 * ask a minute after sending it, which it says after its words.
 */
const MANAGER_CHAT: AppManagerChat = {
  messages: [
    {
      id: "c81f0b37",
      clientKey: "fixture-manager-chat-c81f0b37",
      seq: 5,
      authorKind: MANAGER_CHAT_AUTHOR.AGENT,
      authorUserId: null,
      authorName: "Release manager",
      text: "#128, Invite a teammate by email. Its checks pass, and it waits on your review.",
      attachments: [],
      threadRoot: MANAGER_THREAD_ROOT,
      broadcast: false,
      turnId: MANAGER_TURN,
      lineId: null,
      createdAt: MANAGER_STARTED + 5 * MINUTE,
      editedAt: null,
      reactions: [{ kind: MANAGER_CHAT_REACTION.THUMBS_UP, count: 1, reacted: true }],
    },
    {
      id: "5d9e2a70",
      clientKey: "fixture-manager-chat-5d9e2a70",
      seq: 4,
      authorKind: MANAGER_CHAT_AUTHOR.PERSON,
      authorUserId: ADA.userId,
      authorName: ADA.name,
      text: "Which pull request is it?",
      attachments: [],
      threadRoot: MANAGER_THREAD_ROOT,
      broadcast: false,
      turnId: null,
      lineId: null,
      createdAt: MANAGER_STARTED + 4 * MINUTE,
      editedAt: null,
    },
    {
      id: "a3c9e1f4",
      clientKey: "fixture-manager-chat-a3c9e1f4",
      seq: 3,
      authorKind: MANAGER_CHAT_AUTHOR.AGENT,
      authorUserId: null,
      authorName: "Release manager",
      text: "Left before it ships: a Resend button on pending invites, and the audit log line. I'll tell you once both land.",
      attachments: [],
      threadRoot: null,
      broadcast: false,
      turnId: MANAGER_TURN,
      lineId: null,
      createdAt: MANAGER_STARTED + 3 * MINUTE,
      editedAt: null,
    },
    {
      id: MANAGER_THREAD_ROOT,
      clientKey: "fixture-manager-chat-7b2d40e8",
      seq: 2,
      authorKind: MANAGER_CHAT_AUTHOR.AGENT,
      authorUserId: null,
      authorName: "Release manager",
      text: "On it. The invitations agent has its pull request open and its tests pass.",
      attachments: [],
      threadRoot: null,
      broadcast: false,
      turnId: MANAGER_TURN,
      lineId: null,
      createdAt: MANAGER_STARTED + 2 * MINUTE,
      editedAt: null,
      reactions: [{ kind: MANAGER_CHAT_REACTION.THUMBS_UP, count: 2, reacted: true }],
    },
    {
      id: "e0f5a612",
      clientKey: "fixture-manager-chat-e0f5a612",
      seq: 1,
      authorKind: MANAGER_CHAT_AUTHOR.PERSON,
      authorUserId: ADA.userId,
      authorName: ADA.name,
      text: "Get the invitations work ready to ship this week, and tell me what's left.",
      attachments: [],
      threadRoot: null,
      broadcast: false,
      turnId: MANAGER_TURN,
      lineId: "fixture-manager-ask",
      createdAt: MANAGER_STARTED,
      editedAt: MANAGER_STARTED + MINUTE,
      reactions: [{ kind: MANAGER_CHAT_REACTION.THUMBS_UP, count: 1, reacted: false }],
    },
    {
      id: "9a41c6d2",
      clientKey: "fixture-manager-chat-9a41c6d2",
      seq: 0,
      authorKind: MANAGER_CHAT_AUTHOR.PERSON,
      authorUserId: ADA.userId,
      authorName: ADA.name,
      text: "",
      attachments: [
        {
          name: "invite-preview.png",
          mediaType: AGENT_ATTACHMENT_TYPE.PNG,
          url: `data:image/png;base64,${FIXTURE_PICTURE_PNG}`,
        },
      ],
      threadRoot: null,
      broadcast: false,
      turnId: null,
      lineId: null,
      createdAt: MANAGER_STARTED,
      editedAt: null,
    },
  ],
};

/** The account's reactions given the release Manager's chat or taken off it in this run, oldest pressed first, which the chat stands with, as the service would. */
let managerChatPresses: readonly ManagerChatReactionPress[] = [];

/** The account's edits of its own messages of the release Manager's chat in this run, oldest saved first, which the chat stands with, as the service would. */
let managerChatEdits: readonly ManagerChatEditPress[] = [];

/** The release Manager's chat with the account's edits and reactions in this run drawn on it. */
function reactedManagerChat(): AppManagerChat {
  const edited = managerChatEdits.reduce(withEditPress, MANAGER_CHAT.messages);

  return { messages: managerChatPresses.reduce(withReactionPress, edited) };
}

/** A transcript with two messages of the account's queued behind its turn, which the agent's page lists over its composer with Steer and Delete, two so a flow may put one in the other's place. */
function withQueued(transcript: AppTranscript): AppTranscript {
  const queued = [
    {
      id: fixtureId(90),
      text: "Then add a Resend button beside each pending invite.",
      queuedBy: ADA.userId,
    },
    { id: fixtureId(95), text: "Also log each resend to the audit trail.", queuedBy: ADA.userId },
  ];

  const { word } = transcript;

  if (word === undefined) return transcript;

  return { ...transcript, word: { ...word, queue: { messages: queued, revision: 1 } } };
}

/** The transcripts main holds with the invitations, rounding, and digest agents' and the Manager's laid over them, one object for each of main's. */
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
    [AGENT.ROUNDING]: { ...held[AGENT.ROUNDING], [OWN_TRANSCRIPT]: { rows: ROUNDING_TRANSCRIPT } },
    [AGENT.DIGEST]: { ...held[AGENT.DIGEST], [OWN_TRANSCRIPT]: { rows: DIGEST_TRANSCRIPT } },
    [AGENT.MANAGER]: { ...held[AGENT.MANAGER], [OWN_TRANSCRIPT]: { rows: MANAGER_TRANSCRIPT } },
  };

  STAGED_TRANSCRIPTS.set(held, staged);

  return staged;
}

/** Where the page older than the invitations agent's transcript is read below, which a phone's fixture run offers. */
const INVITES_OLDER_CURSOR = "0:0";

/** The read of the older page that lands it: the first is not heard back, so a run shows Try again before the page. */
const OLDER_LANDS_ON = 2;

/** The invitations agent's transcript as the older page leaves it: offered, or read and laid before its first. */
const INVITES_OLDER = {
  OFFERED: { ...INVITES_TRANSCRIPT, before: INVITES_OLDER_CURSOR },
  READ: {
    ...INVITES_TRANSCRIPT,
    messages: [...fixtureAgentOlderMessages(INVITES_STARTED, ADA), ...INVITES_TRANSCRIPT.messages],
  },
} as const satisfies Record<string, AppTranscript>;

/**
 * The document with the invitations agent's transcript as `asks` reads of
 * its older page leave it: the page offered below its first message until
 * a read lands it, then laid before them with nothing older offered. The
 * same document under any other profile. Note that only the phone's fixture
 * host lays it, since a desktop's fixture run answers no older read.
 */
export function olderPageAppState(state: AppStateSnapshot, asks: number): AppStateSnapshot {
  if (!STAGED_PROFILES.has(state.run.profile)) return state;
  const held = state[LIVE_READ.TRANSCRIPT];
  const rows = asks >= OLDER_LANDS_ON ? INVITES_OLDER.READ : INVITES_OLDER.OFFERED;

  if (held[AGENT.INVITES]?.[OWN_TRANSCRIPT]?.rows === rows) return state;

  return {
    ...state,
    [LIVE_READ.TRANSCRIPT]: {
      ...held,
      [AGENT.INVITES]: { ...held[AGENT.INVITES], [OWN_TRANSCRIPT]: { rows } },
    },
  };
}

/** What the `asks`th read of the invitations agent's older page answers: not heard back the first time, and landed after; none for any other transcript or profile. */
export function olderPageAnswer(
  profile: string,
  params: AgentTranscriptOlderParams,
  asks: number,
): AgentTranscriptOlderAnswer | undefined {
  if (!STAGED_PROFILES.has(profile) || params.agentId !== AGENT.INVITES) return undefined;

  return asks >= OLDER_LANDS_ON ? { landed: true } : { failure: AGENT_CALL_FAILURE.UNANSWERED };
}

/** The queues a fixture run changed, by agent. */
export type KeptQueues = ReadonlyMap<string, AgentQueue>;

/** A queued message with no edit holding it. */
function unheld({ editing: _editing, ...message }: QueuedMessage): QueuedMessage {
  return message;
}

/** The messages of `queue` with the one under `id` as `change` leaves it. */
function messageChanged(
  queue: AgentQueue,
  id: string,
  change: (message: QueuedMessage) => QueuedMessage,
): readonly QueuedMessage[] {
  return queue.messages.map((message) => (message.id === id ? change(message) : message));
}

/** The messages of `queue` as `change` leaves them, as the service takes a change, though a steered message goes nowhere and an edit's files are left as they were. */
function changedMessages(queue: AgentQueue, change: AgentQueueChange): readonly QueuedMessage[] {
  switch (change.change) {
    case QUEUE_CHANGE.ADD: {
      const files = (change.attachments ?? []).map(({ name, mediaType }) => ({ name, mediaType }));
      const added = { id: change.id, text: change.text, queuedBy: ADA.userId };

      return [...queue.messages, files.length === 0 ? added : { ...added, files }];
    }

    case QUEUE_CHANGE.EDIT:
      return messageChanged(queue, change.messageId, (message) => ({
        ...unheld(message),
        text: change.text,
      }));
    case QUEUE_CHANGE.HOLD:
      return messageChanged(queue, change.messageId, (message) =>
        change.held ? { ...message, editing: true } : unheld(message),
      );
    case QUEUE_CHANGE.DELETE:
    case QUEUE_CHANGE.STEER:
      return queue.messages.filter((message) => message.id !== change.messageId);
    case QUEUE_CHANGE.REORDER: {
      const at = (message: QueuedMessage) => {
        const place = change.order.indexOf(message.id);

        return place === -1 ? change.order.length : place;
      };

      return queue.messages.toSorted((one, other) => at(one) - at(other));
    }

    case QUEUE_CHANGE.RESUME:
      return queue.messages;
  }
}

/**
 * The queue `agentId` stands at once the act is taken, as the service takes
 * it: a change to the queue made, Resume dropping its pause, and a Stop
 * pausing it; none for any other act, or an agent staged with no queue.
 * `queues` holds what the run changed so far, over the queues as staged.
 */
export function queueAfter(
  queues: KeptQueues,
  kind: PortActKind,
  payload: PortActPayload<PortActKind>,
): { readonly agentId: string; readonly queue: AgentQueue } | undefined {
  if (kind !== ACT_KIND.AGENTS_QUEUE && kind !== ACT_KIND.AGENTS_STOP) return undefined;
  // SAFETY: both kinds' payloads name the agent.
  const { agentId } = payload as PortActPayload<typeof ACT_KIND.AGENTS_STOP>;

  const held =
    queues.get(agentId) ?? (agentId === AGENT.INVITES ? INVITES_TRANSCRIPT.word?.queue : undefined);

  if (held === undefined) return undefined;
  const revision = held.revision + 1;

  if (kind === ACT_KIND.AGENTS_STOP) {
    return { agentId, queue: { ...held, paused: { because: QUEUE_PAUSE.STOPPED }, revision } };
  }

  // SAFETY: the payload is the one its kind declares.
  const { change } = payload as PortActPayload<typeof ACT_KIND.AGENTS_QUEUE>;
  const { paused: _paused, ...resumed } = held;
  const messages = changedMessages(held, change);
  const queue = change.change === QUEUE_CHANGE.RESUME ? resumed : held;

  return { agentId, queue: { ...queue, messages, revision } };
}

/** Each agent's own transcript as staged with the queue the run left it, by the transcript and then the queue, so laying one again hands the store the same object. */
const QUEUED_TRANSCRIPTS = new WeakMap<AppTranscript, WeakMap<AgentQueue, AppTranscript>>();

/** The transcript with its queue standing as `queue`. */
function queuedTranscript(rows: AppTranscript, queue: AgentQueue): AppTranscript {
  const byQueue = QUEUED_TRANSCRIPTS.get(rows) ?? new WeakMap<AgentQueue, AppTranscript>();
  const kept = byQueue.get(queue);

  if (kept !== undefined) return kept;
  const { word } = rows;
  const queued = word === undefined ? rows : { ...rows, word: { ...word, queue } };
  QUEUED_TRANSCRIPTS.set(rows, byQueue.set(queue, queued));

  return queued;
}

/**
 * The document with each queue the run changed standing on its agent's own
 * transcript, as the host draws a change the moment it is asked; the
 * document handed in where the run changed none. Note that only the phone's
 * fixture host lays it, since a desktop's fixture run lays its queue
 * through the host's own outbox.
 */
export function queuedAppState(state: AppStateSnapshot, queues: KeptQueues): AppStateSnapshot {
  if (!STAGED_PROFILES.has(state.run.profile) || queues.size === 0) return state;
  const held = state[LIVE_READ.TRANSCRIPT];
  const laid = { ...held };

  for (const [agentId, queue] of queues) {
    const rows = held[agentId]?.[OWN_TRANSCRIPT]?.rows;

    if (rows !== undefined) {
      laid[agentId] = {
        ...held[agentId],
        [OWN_TRANSCRIPT]: { rows: queuedTranscript(rows, queue) },
      };
    }
  }

  return { ...state, [LIVE_READ.TRANSCRIPT]: laid };
}

/** The models the account may start an agent on, as the service's catalog lists them, and the account's machines an agent may run or be moved to, as Settings › Machines lists them. */
const MODELS: ModelsAnswer = {
  macs: HOSTS.map((host) => ({
    deviceId: host.id,
    name: host.name,
    providers: [MODEL_PROVIDER.ANTHROPIC, MODEL_PROVIDER.OPENAI],
    ...(host.platform === undefined ? undefined : { platform: host.platform }),
    ...(host.model === undefined ? undefined : { model: host.model }),
  })),
  models: [
    {
      id: MODEL,
      name: "Claude Opus 5.5",
      provider: MODEL_PROVIDER.ANTHROPIC,
      efforts: ["low", "medium", "high", "xhigh", "max"],
    },
    {
      id: `${MODEL}${MODEL_SPEED_SUFFIX[MODEL_SPEED.FAST]}`,
      name: "Claude Opus 5.5 Fast",
      provider: MODEL_PROVIDER.ANTHROPIC,
      efforts: ["low", "medium", "high", "xhigh", "max"],
    },
    {
      id: "anthropic/claude-sonnet-5.5",
      name: "Claude Sonnet 5.5",
      provider: MODEL_PROVIDER.ANTHROPIC,
      efforts: ["low", "medium", "high"],
    },
    {
      id: CODEX_MODEL,
      name: "GPT-6.1 Sol",
      provider: MODEL_PROVIDER.OPENAI,
      efforts: ["low", "medium", "high", "xhigh"],
    },
  ],
};

/** The account's integrations: GitHub, Linear, and two Notion accounts connected, Sentry's sign-in lapsed, and every other one offered and not connected. */
const INTEGRATIONS: IntegrationStatusesAnswer = {
  // SAFETY: every provider is listed, each standing disconnected but the four named after.
  integrations: {
    ...Object.fromEntries(
      INTEGRATION_PROVIDER_LIST.map((provider) => [provider, INTEGRATION_STATUS.DISCONNECTED]),
    ),
    [INTEGRATION_PROVIDER.GITHUB]: INTEGRATION_STATUS.CONNECTED,
    [INTEGRATION_PROVIDER.LINEAR]: INTEGRATION_STATUS.CONNECTED,
    [INTEGRATION_PROVIDER.NOTION]: INTEGRATION_STATUS.CONNECTED,
    [INTEGRATION_PROVIDER.SENTRY]: INTEGRATION_STATUS.EXPIRED,
  } as IntegrationStatusesAnswer["integrations"],
  accounts: [
    {
      provider: INTEGRATION_PROVIDER.LINEAR,
      connection: "linear",
      status: INTEGRATION_STATUS.CONNECTED,
    },
    {
      provider: INTEGRATION_PROVIDER.NOTION,
      connection: "notion",
      label: "Relay",
      status: INTEGRATION_STATUS.CONNECTED,
    },
    {
      provider: INTEGRATION_PROVIDER.NOTION,
      connection: "notion-2",
      label: "Personal",
      status: INTEGRATION_STATUS.CONNECTED,
    },
    {
      provider: INTEGRATION_PROVIDER.SENTRY,
      connection: "sentry",
      status: INTEGRATION_STATUS.EXPIRED,
    },
  ],
};

/**
 * What each connected server answered when asked for its tools: GitHub's,
 * Linear's, and Relay's Notion list theirs, and the Personal Notion's read
 * couldn't be answered, so Settings › Integrations says so with Try again.
 */
const INTEGRATION_TOOLS: AppStateSnapshot[typeof LIVE_READ.INTEGRATION_TOOLS] = {
  github: {
    rows: { tools: [{ name: "search_code", description: "Search code across repositories" }] },
  },
  linear: { rows: { tools: [{ name: "list_issues", description: "List the team's issues" }] } },
  notion: { rows: { tools: [{ name: "search", description: "Search the workspace's pages" }] } },
  "notion-2": { failed: true },
};

/** The skills the invitations task's repository keeps, as the service finds them. */
/** The invitations task's repository at its default branch, as one recursive read lists it. */
const INVITES_TREE = {
  path: "",
  repository: "ada/relay",
  branch: "main",
  entries: [
    { name: "README.md", kind: TASK_TREE_ENTRY.FILE },
    { name: "src", kind: TASK_TREE_ENTRY.FOLDER },
    { name: "src/invites", kind: TASK_TREE_ENTRY.FOLDER },
    { name: "src/invites/expiry.ts", kind: TASK_TREE_ENTRY.FILE },
    { name: "src/invites/resend-link.ts", kind: TASK_TREE_ENTRY.FILE },
  ],
  truncated: false,
} as const;

const SKILLS = {
  repository: "ada/relay",
  branch: "main",
  skills: [
    {
      name: "release-notes",
      description: "Write the release's notes from the merged pull requests",
      source: TASK_SKILL_SOURCE.REPOSITORY,
      path: ".agents/skills/release-notes/SKILL.md",
    },
    {
      name: "migrate",
      description: "Add a Drizzle migration and its test",
      source: TASK_SKILL_SOURCE.REPOSITORY,
      path: ".agents/skills/migrate/SKILL.md",
    },
    {
      name: "review",
      description: "Review the branch's changes before a pull request",
      source: TASK_SKILL_SOURCE.REPOSITORY,
      path: ".agents/skills/review/SKILL.md",
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

/** One pull request of the fixture's merge queues, at `position`, joined `ago` before the run landed. */
function queuedEntry(
  position: number,
  repository: string,
  pullRequest: { readonly number: number; readonly title: string; readonly author: string | null },
  standing: Pick<MergeQueueEntry, "state" | "checks" | "estimatedMergeAt">,
  ago: number,
): MergeQueueEntry {
  return {
    position,
    ...standing,
    enqueuedAt: LANDED - ago,
    pullRequest: {
      number: pullRequest.number,
      title: pullRequest.title,
      url: `https://github.com/${repository}/pull/${pullRequest.number}`,
      // Note that an author's picture is left empty, so a run reads nothing from GitHub and draws their letter.
      author: pullRequest.author === null ? null : { login: pullRequest.author, avatarUrl: "" },
    },
    task: null,
  };
}

/** The fixture workspace's merge queues, as the Merge queue page reads them: relay's front merging, one checking, one failing, one waiting its turn by a deleted account, and ledger's one checking. */
const MERGE_QUEUES: MergeQueueAnswer = {
  repositories: [
    {
      repository: "ada/relay",
      url: "https://github.com/ada/relay/queue/main",
      entries: [
        queuedEntry(
          1,
          "ada/relay",
          { number: INVITES_PULL_REQUEST.number, title: INVITES_PULL_REQUEST.title, author: "ada" },
          {
            state: MERGE_QUEUE_ENTRY_STATE.MERGEABLE,
            checks: { total: 12, passed: 12, failedCount: 0, failed: [] },
            estimatedMergeAt: LANDED + 4 * MINUTE,
          },
          40 * MINUTE,
        ),
        // Note that second in the queue is the pull request whose own page says Queued #2 (`fixture-pull-requests.ts`), so its state chip's View merge queue opens on its row.
        queuedEntry(
          2,
          "ada/relay",
          {
            number: FIXTURE_PULL_REQUEST.QUEUED,
            title: "Send the invite email from the workspace",
            author: "ada",
          },
          {
            state: MERGE_QUEUE_ENTRY_STATE.AWAITING_CHECKS,
            checks: { total: 12, passed: 7, failedCount: 0, failed: [] },
            estimatedMergeAt: LANDED + 18 * MINUTE,
          },
          25 * MINUTE,
        ),
        queuedEntry(
          3,
          "ada/relay",
          { number: 133, title: "Retry the billing webhook on a 502", author: "linus-t" },
          {
            state: MERGE_QUEUE_ENTRY_STATE.UNMERGEABLE,
            checks: { total: 12, passed: 10, failedCount: 2, failed: ["End-to-end"] },
            estimatedMergeAt: null,
          },
          20 * MINUTE,
        ),
        queuedEntry(
          4,
          "ada/relay",
          { number: 134, title: "Rename the audit job", author: null },
          {
            state: MERGE_QUEUE_ENTRY_STATE.QUEUED,
            checks: null,
            estimatedMergeAt: LANDED + 40 * MINUTE,
          },
          5 * MINUTE,
        ),
      ],
    },
    {
      repository: "ada/ledger",
      url: "https://github.com/ada/ledger/queue/main",
      entries: [
        queuedEntry(
          1,
          "ada/ledger",
          { number: 57, title: "Close the books at month end", author: "ada" },
          {
            state: MERGE_QUEUE_ENTRY_STATE.AWAITING_CHECKS,
            checks: null,
            estimatedMergeAt: LANDED + 9 * MINUTE,
          },
          12 * MINUTE,
        ),
      ],
    },
  ],
};

/** Main's settings with the account's staged experiments on, the same object for the same settings. */
function stagedSettings(
  settings: NonNullable<AppStateSnapshot["settings"]>,
): NonNullable<AppStateSnapshot["settings"]> {
  const held = STAGED_SETTINGS.get(settings);

  if (held !== undefined) return held;
  const staged = { ...settings, experiments: { ...settings.experiments, ...STAGED_EXPERIMENTS } };
  STAGED_SETTINGS.set(settings, staged);

  return staged;
}

/**
 * Main's document as these profiles draw it: the account signed in with
 * its staged experiments on, its read of what waits naming the tasks
 * holding items, and each of
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
  const inboxes = state.run.profile === RUN_PROFILE.INBOX_LARGE ? LARGE_INBOXES : INBOXES;
  const fed = Object.fromEntries([...inboxes].filter(([, items]) => items.length > 0));

  return {
    ...state,
    account: ACCOUNT,
    ...(state.settings === undefined ? undefined : { settings: stagedSettings(state.settings) }),
    inbox: stagedInbox(state.inbox),
    [LIVE_READ.INBOX_ITEMS]: {
      rows: { [INBOX_SCOPE_KIND.TASK]: fed, agents: AGENT_INBOXES },
    },
    ...(olderPagesRead === 0 ? undefined : { [LIVE_READ.INBOX_OLDER]: { rows: olderItemsRead() } }),
    [LIVE_READ.INBOX_FOUND]: Object.fromEntries(
      [...foundAt].map(([place, found]) => [place, { rows: found }]),
    ),
    [LIVE_READ.HELD_TASK]: stagedDocuments(state),
    [LIVE_READ.PAGES]: stagedPages(state),
    [LIVE_READ.DESCRIPTION_COMMENTS]: stagedComments(state),
    [LIVE_READ.AUTOMATIONS]: noneHeldIn(workspaceIds),
    [LIVE_READ.AUTOMATION_WORKSPACE_RUNS]: noneHeldIn(workspaceIds),
    [LIVE_READ.TRANSCRIPT]: stagedTranscripts(state[LIVE_READ.TRANSCRIPT]),
    [LIVE_READ.MANAGER_CHAT]: {
      ...state[LIVE_READ.MANAGER_CHAT],
      [AGENT.MANAGER]: { rows: reactedManagerChat() },
    },
    [LIVE_READ.MODELS]: { [ADA.userId]: { rows: MODELS } },
    [LIVE_READ.INTEGRATIONS]: { [ADA.userId]: { rows: INTEGRATIONS } },
    [LIVE_READ.INTEGRATION_TOOLS]: INTEGRATION_TOOLS,
    [LIVE_READ.WORKSPACE_MEMBERS]: { [FIXTURE_IDS.WORKSPACE]: { rows: MEMBERS } },
    // Note that Relay, the team a flow switches to, holds no memories and none of its own skills, so its pages draw their empty states rather than reading for good; the account's own skills stand in every workspace.
    [LIVE_READ.MEMORIES]: {
      [FIXTURE_IDS.WORKSPACE]: {
        [WORKSPACE_OWN_MEMORIES]: { rows: MEMORIES },
        [AGENT.MANAGER]: { rows: MANAGER_MEMORIES },
      },
      [TEAM_WORKSPACE.id]: { [WORKSPACE_OWN_MEMORIES]: { rows: [] } },
    },
    [LIVE_READ.MCP_CLIENTS]: {
      [ADA.userId]: { rows: { serverUrl: "https://vespin.dev/api/mcp", clients: MCP_CLIENTS } },
    },
    [LIVE_READ.INSTALLED_SKILLS]: {
      [FIXTURE_IDS.WORKSPACE]: { rows: INSTALLED_SKILLS },
      [TEAM_WORKSPACE.id]: { rows: INSTALLED_SKILLS },
    },
    [LIVE_READ.HOSTS]: {
      [ADA.userId]: {
        rows: { hosts: HOSTS, installScriptUrl: "https://vespin.dev/install-host.sh" },
      },
    },
    [LIVE_READ.HISTORY]: { ...state[LIVE_READ.HISTORY], [TASK.INVITES]: { rows: INVITES_HISTORY } },
    [LIVE_READ.WORKSPACE_PHOTOS]: {
      ...state[LIVE_READ.WORKSPACE_PHOTOS],
      [TEAM_WORKSPACE.id]: { rows: TEAM_PHOTO },
    },
    [LIVE_READ.WORKSPACE_INVITATIONS]: { [FIXTURE_IDS.WORKSPACE]: { rows: INVITATIONS } },
    [LIVE_READ.REPOSITORY_LISTS]: Object.fromEntries(
      workspaceIds.map((id) => [id, { rows: REPOSITORIES }]),
    ),
  };
}

/** The reminders a fixture run set, by item: an instant, or null where one was cleared. */
export type InboxReminders = ReadonlyMap<string, number | null>;

/** An item with the reminder set on it, or cleared, as `reminders` holds; the item handed in where they name it not. */
function remindedItem(item: InboxItem, reminders: InboxReminders): InboxItem {
  const until = reminders.get(item.id);

  if (until === undefined) return item;
  const { remindAt: _held, ...rest } = item;

  return until === null ? rest : { ...rest, remindAt: until };
}

/**
 * The document with the reminders a fixture run set laid over the staged
 * feed's items, as the host draws one the moment it is asked, so a fixture
 * run's Inbox puts the item away under Reminders. The very document where
 * none was set.
 */
export function inboxRemindersAppState(
  state: AppStateSnapshot,
  reminders: InboxReminders,
): AppStateSnapshot {
  const fed = state[LIVE_READ.INBOX_ITEMS].rows?.[INBOX_SCOPE_KIND.TASK];

  if (reminders.size === 0 || fed === undefined) return state;

  const reminded = Object.fromEntries(
    Object.entries(fed).map(([taskId, items]) => [
      taskId,
      items.map((item) => remindedItem(item, reminders)),
    ]),
  );

  return {
    ...state,
    [LIVE_READ.INBOX_ITEMS]: { rows: { [INBOX_SCOPE_KIND.TASK]: reminded } },
  };
}

/** A reply with pictures a fixture run sent, as a read carries it, and each picture's bytes by the attachment it is read by. */
export interface InboxSentReply {
  readonly itemId: string;
  readonly message: InboxMessage;
  readonly files: ReadonlyMap<string, PortActResult<typeof ACT_KIND.AGENTS_INBOX_ATTACHMENT>>;
}

/** The replies with pictures a fixture run sent, by the item each was sent on, oldest first. */
export type InboxSentReplies = ReadonlyMap<string, readonly InboxSentReply[]>;

/**
 * A reply a fixture run sent as a read would carry it back: the account's
 * message under the send's key, its pictures named and kept so they read
 * back by their attachments, written `at`. None for a reply carrying no
 * pictures, or one answering an ask, which the window draws as its own
 * until a read moves the ask, as nothing here does. Note that each
 * picture's attachment is the send's key with its place in the last
 * group, so a reply's pictures never share one.
 */
export function inboxSentReply(
  payload: PortActPayload<typeof ACT_KIND.AGENTS_INBOX_MESSAGE>,
  at: number,
): InboxSentReply | undefined {
  const { itemId, clientKey, text, attachments = [], answers } = payload;

  if (clientKey === undefined || attachments.length === 0 || answers !== undefined)
    return undefined;

  const kept = attachments.map((attachment, place) => ({
    attachmentId: `${clientKey.slice(0, 24)}${place.toString(16).padStart(12, "0")}`,
    attachment,
  }));

  return {
    itemId,
    message: {
      id: clientKey,
      author: INBOX_MESSAGE_AUTHOR.MEMBER,
      member: ADA,
      text,
      files: kept.map(({ attachmentId, attachment }) => ({
        attachmentId,
        name: attachment.name,
        mediaType: attachment.mediaType,
      })),
      clientKey,
      createdAt: at,
    },
    files: new Map(
      kept.map(({ attachmentId, attachment }) => [
        attachmentId,
        { contentType: attachment.mediaType, base64: attachment.data },
      ]),
    ),
  };
}

/**
 * The document with the replies a fixture run sent laid at the foot of
 * their items' threads, as the service's next read carries a reply, so the
 * window lets its own drawing of the send go and draws the read's, its
 * pictures with it. The very document where none was sent.
 */
export function inboxSentRepliesAppState(
  state: AppStateSnapshot,
  sent: InboxSentReplies,
): AppStateSnapshot {
  const fed = state[LIVE_READ.INBOX_ITEMS].rows?.[INBOX_SCOPE_KIND.TASK];

  if (sent.size === 0 || fed === undefined) return state;

  const replied = Object.fromEntries(
    Object.entries(fed).map(([taskId, items]) => [
      taskId,
      items.map((item) => {
        const replies = sent.get(item.id);

        if (replies === undefined) return item;

        const thread = [...(item.thread ?? []), ...replies.map(({ message }) => message)];

        return { ...item, thread, updatedAt: replies.at(-1)?.message.createdAt ?? item.updatedAt };
      }),
    ]),
  );

  return {
    ...state,
    [LIVE_READ.INBOX_ITEMS]: { rows: { [INBOX_SCOPE_KIND.TASK]: replied } },
  };
}

/** A picture a fixture run's reply carried, as the service answers its read; none for any other attachment. */
export function inboxSentFile(
  sent: InboxSentReplies,
  attachmentId: string,
): PortActResult<typeof ACT_KIND.AGENTS_INBOX_ATTACHMENT> | undefined {
  for (const replies of sent.values()) {
    for (const reply of replies) {
      const file = reply.files.get(attachmentId);

      if (file !== undefined) return file;
    }
  }

  return undefined;
}

/** The read marks a fixture run made, by the item's id: whether each stands unread. */
export type InboxReadMarks = ReadonlyMap<string, boolean>;

/**
 * The document with the read marks a fixture run made laid over the staged
 * feed's items, as the host draws one the moment it is asked, so a fixture
 * run's Inbox row turns read or unread under a flow's swipe. The very
 * document where none was made, and every unmarked item kept as it was.
 */
export function inboxReadMarksAppState(
  state: AppStateSnapshot,
  marks: InboxReadMarks,
): AppStateSnapshot {
  const fed = state[LIVE_READ.INBOX_ITEMS].rows?.[INBOX_SCOPE_KIND.TASK];

  if (marks.size === 0 || fed === undefined) return state;

  const marked = Object.fromEntries(
    Object.entries(fed).map(([taskId, items]) => [
      taskId,
      items.map((item) => {
        const unread = marks.get(item.id);

        return unread === undefined || (item.unread === true) === unread
          ? item
          : { ...item, unread };
      }),
    ]),
  );

  return {
    ...state,
    [LIVE_READ.INBOX_ITEMS]: { rows: { [INBOX_SCOPE_KIND.TASK]: marked } },
  };
}

/** The words a fixture run saved, by the memory's id: one of its own corrected, or a new one under the id the save answered. */
export type SavedMemoryWords = ReadonlyMap<string, string>;

/**
 * The document with Ada's MacBook asking before the invitations agent's test
 * command runs, and her machines that name it, those of the asks a fixture
 * run answered taken off, as the service's read drops an ask once answered.
 * Only a run that asks for it lays this over (the mobile app's
 * `-machineAsk true`), since the ask's card opens over every screen.
 */
export function machineAskAppState(
  state: AppStateSnapshot,
  answered: ReadonlySet<string>,
): AppStateSnapshot {
  return {
    ...state,
    [LIVE_READ.MACHINES]: { ...state[LIVE_READ.MACHINES], [ADA.userId]: { rows: MACHINES } },
    [LIVE_READ.MACHINE_ASKS]: {
      ...state[LIVE_READ.MACHINE_ASKS],
      [ADA.userId]: { rows: MACHINE_ASKS.filter((ask) => !answered.has(ask.id)) },
    },
  };
}

/**
 * The fixture workspace's memories with the words a run saved: a
 * correction over its own row, as the host draws one the moment it is sent,
 * and a new memory at the head, as the memories' live read carries one in
 * soon after it is kept. The document handed in where none was saved. Note
 * that a run keeps one new memory, since every new one is answered under the
 * same id.
 */
export function savedMemoriesAppState(
  state: AppStateSnapshot,
  words: SavedMemoryWords,
): AppStateSnapshot {
  const workspace = state[LIVE_READ.MEMORIES][FIXTURE_IDS.WORKSPACE];
  const held = workspace?.[WORKSPACE_OWN_MEMORIES];
  const rows = held?.rows;

  if (words.size === 0 || held === undefined || rows === undefined) return state;

  const corrected = rows.map((memory) => {
    const text = words.get(memory.id);

    return text === undefined ? memory : { ...memory, text, updatedAt: LANDED };
  });

  const added = words.get(NEW_MEMORY_ID);

  const saved =
    added === undefined || rows.some((memory) => memory.id === NEW_MEMORY_ID)
      ? corrected
      : [savedMemory(added, undefined), ...corrected];

  return {
    ...state,
    [LIVE_READ.MEMORIES]: {
      ...state[LIVE_READ.MEMORIES],
      [FIXTURE_IDS.WORKSPACE]: { ...workspace, [WORKSPACE_OWN_MEMORIES]: { ...held, rows: saved } },
    },
  };
}

/**
 * What a fixture run changed of one of its agents: its model and effort, its
 * permission mode, the servers switched off, its name, the reader's pin,
 * and a Manager's face.
 */
export interface AgentChange {
  readonly model?: string;
  readonly effort?: string;
  readonly permissionMode?: AgentPermissionMode;
  readonly disabledServers?: readonly string[];
  readonly title?: string;
  readonly pinned?: boolean;
  readonly face?: ManagerFace;
  /** Whether the run archived the agent or brought it back. */
  readonly archived?: boolean;
}

/** What a fixture run changed of its agents, by agent. */
export type AgentChoices = ReadonlyMap<string, AgentChange>;

/** The change an act a fixture run takes makes to its agent, or none for an act that changes none. */
export function agentChangeOf(
  kind: PortActKind,
  payload: PortActPayload<PortActKind>,
): { readonly agentId: string; readonly change: AgentChange } | undefined {
  switch (kind) {
    case ACT_KIND.AGENTS_CHOOSE: {
      // SAFETY: the payload is the one its case's kind declares.
      const { agentId, model, effort } = payload as PortActPayload<typeof ACT_KIND.AGENTS_CHOOSE>;

      return { agentId, change: { model, effort } };
    }

    case ACT_KIND.AGENTS_PERMISSION_MODE: {
      // SAFETY: the payload is the one its case's kind declares.
      const { agentId, permissionMode } = payload as PortActPayload<
        typeof ACT_KIND.AGENTS_PERMISSION_MODE
      >;

      return { agentId, change: { permissionMode } };
    }

    case ACT_KIND.AGENTS_FACE: {
      // SAFETY: the payload is the one its case's kind declares.
      const { agentId, face } = payload as PortActPayload<typeof ACT_KIND.AGENTS_FACE>;

      return { agentId, change: { face } };
    }

    case ACT_KIND.AGENTS_SERVERS: {
      // SAFETY: the payload is the one its case's kind declares.
      const { agentId, disabledServers } = payload as PortActPayload<
        typeof ACT_KIND.AGENTS_SERVERS
      >;

      return { agentId, change: { disabledServers } };
    }

    case ACT_KIND.AGENTS_RENAME: {
      // SAFETY: the payload is the one its case's kind declares.
      const { agentId, title } = payload as PortActPayload<typeof ACT_KIND.AGENTS_RENAME>;

      return { agentId, change: { title } };
    }

    case ACT_KIND.AGENTS_PIN: {
      // SAFETY: the payload is the one its case's kind declares.
      const { agentId, pinned } = payload as PortActPayload<typeof ACT_KIND.AGENTS_PIN>;

      return { agentId, change: { pinned } };
    }

    case ACT_KIND.AGENTS_ARCHIVE: {
      // SAFETY: the payload is the one its case's kind declares.
      const { agentId, archived } = payload as PortActPayload<typeof ACT_KIND.AGENTS_ARCHIVE>;

      return { agentId, change: { archived } };
    }

    default:
      return undefined;
  }
}

/** One agent with the run's change to it laid over, the pin left to the list's pins, and archived at the fixture's moment or brought back as the run left it. */
function changedAgent<A extends AgentSummary>(agent: A, change: AgentChange): A {
  const { pinned: _pinned, archived, ...fields } = change;
  const changed = { ...agent, ...fields };

  if (archived === undefined) return changed;

  if (archived) return { ...changed, archivedAt: agent.archivedAt ?? LANDED };
  const { archivedAt: _archivedAt, ...back } = changed;

  // SAFETY: the agent less its archive mark is the agent brought back, every other field as it was.
  return back as A;
}

/** The fields of an agent a fixture run's change may set: each of `AgentChange`'s but the reader's pin. */
const CHANGED_FIELDS = [
  "model",
  "effort",
  "permissionMode",
  "disabledServers",
  "title",
] as const satisfies readonly Exclude<keyof AgentChange, "pinned" | "face" | "archived">[];

/** Whether every field of the change already stands on the agent, a face by its character, color, and emoji. */
function standsOn(agent: AgentSummary, change: AgentChange): boolean {
  const { face, archived } = change;

  if (archived !== undefined && archived !== (agent.archivedAt !== undefined)) return false;

  if (face !== undefined && !sameManagerFace(face, agent.face)) return false;

  return CHANGED_FIELDS.every((key) => {
    const value = change[key];
    const held = agent[key];

    if (value === undefined) return true;

    return Array.isArray(value) && Array.isArray(held)
      ? value.length === held.length && value.every((each, at) => each === held[at])
      : held === value;
  });
}

/** The reader's pins with each pin the run set or took off laid over, by the agent's task. */
function pinnedAgents(
  pins: NonNullable<TasksView["taskAgentPins"]>,
  agents: NonNullable<TaskListParts["taskAgents"]>,
  choices: AgentChoices,
): NonNullable<TasksView["taskAgentPins"]> {
  const kept = pins.filter(({ agentId }) => choices.get(agentId)?.pinned !== false);

  const added = agents
    .filter(({ id }) => choices.get(id)?.pinned === true && !kept.some((pin) => pin.agentId === id))
    .flatMap(({ id, taskId }) =>
      taskId === null ? [] : [{ agentId: id, taskId, pinnedAt: LANDED }],
    );

  return [...kept, ...added];
}

/** Whether the reader's pins already stand as the run left them. */
function pinsStand(pins: NonNullable<TasksView["taskAgentPins"]>, choices: AgentChoices): boolean {
  return [...choices].every(
    ([agentId, change]) =>
      change.pinned === undefined || pins.some((pin) => pin.agentId === agentId) === change.pinned,
  );
}

/**
 * The list with each agent the run changed standing as it changed it, its
 * model, its mode, its servers, its name, whether it is archived, and the reader's pin, as the host
 * draws a change the moment it is asked; the list handed in where every
 * agent already stands so, so laying it again changes nothing.
 */
export function chosenTasksView(list: ListedTasksView, choices: AgentChoices): ListedTasksView {
  const agents = list.taskAgents ?? [];
  const pins = list.taskAgentPins ?? [];

  const agentsStand = agents.every((agent) => {
    const change = choices.get(agent.id);

    return change === undefined || standsOn(agent, change);
  });

  if (agentsStand && pinsStand(pins, choices)) return list;

  return {
    ...list,
    taskAgents: agents.map((agent) => {
      const change = choices.get(agent.id);

      return change === undefined ? agent : changedAgent(agent, change);
    }),
    taskAgentPins: pinnedAgents(pins, agents, choices),
  };
}

/* ----- The act door ----- */

/** One staged item by its id, in whichever task's inbox holds it. */
function stagedItem(itemId: string): InboxItem | undefined {
  return [...INBOXES.values()].flat().find((each) => each.id === itemId);
}

/** One staged agent by its id, on whichever task it works, or the Manager, on none. */
function stagedAgent(agentId: string): AgentSummary | undefined {
  return [...AGENTS.values(), MANAGER].find((each) => each.id === agentId);
}

/* ----- The automations ----- */

/** The fixture workspace's automations, by id: a digest on a schedule, a fix on each failed check, and a deploy check its webhook calls, turned off. */
const AUTOMATION = {
  DIGEST: "9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c01",
  CHECKS: "9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c02",
  DEPLOY: "9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c03",
} as const;

/** The digest's schedule: Mondays at 9:00 AM UTC. */
const DIGEST_SCHEDULE = { cron: "0 9 * * 1", timezone: "UTC" } as const;

/** The first instant after `after` the digest's schedule is due, as the service reads a schedule. */
function digestDue(after: number): number {
  return nextScheduledRun(DIGEST_SCHEDULE, new Date(after))?.getTime() ?? after;
}

/**
 * When the digest is due, read off its own schedule from the instant the
 * fixture landed, so its next run and its runs fall on the Mondays its
 * schedule names, whichever day a capture is taken: the next one to come,
 * and the two that came last.
 */
const DIGEST_DUE = {
  NEXT: digestDue(LANDED),
  LAST: digestDue(LANDED - 7 * DAY),
  BEFORE: digestDue(LANDED - 14 * DAY),
} as const;

/** One run of an automation, fired `ago` before the fixture landed and settled a few minutes after, starting `agent` where it names one. */
function automationRun(
  n: number,
  ago: number,
  firing: AutomationRunSummary["firing"],
  agent: AutomationRunSummary["agent"],
  patch: Partial<AutomationRunSummary> = {},
): AutomationRunSummary {
  const firedAt = LANDED - ago;

  return {
    id: fixtureId(0x7000 + n),
    firing,
    status: AUTOMATION_RUN_STATUS.STARTED,
    reason: null,
    agent,
    firedAt,
    settledAt: firedAt + 4 * MINUTE,
    ...patch,
  };
}

/** Each automation's runs, newest first, each run's agent one of the fixture's own, so a run opens an agent page the fixture draws. */
const AUTOMATION_RUNS: ReadonlyMap<string, readonly AutomationRunSummary[]> = new Map([
  [
    AUTOMATION.DIGEST,
    [
      automationRun(
        1,
        LANDED - DIGEST_DUE.LAST,
        { kind: AUTOMATION_FIRING.SCHEDULE, dueAt: DIGEST_DUE.LAST },
        { id: AGENT.DIGEST, title: "Send the weekly digest", status: AGENT_STATUS.RUNNING },
      ),
      automationRun(
        2,
        LANDED - DIGEST_DUE.BEFORE,
        { kind: AUTOMATION_FIRING.SCHEDULE, dueAt: DIGEST_DUE.BEFORE },
        null,
        { status: AUTOMATION_RUN_STATUS.SKIPPED, reason: AUTOMATION_RUN_REASON.CONCURRENCY },
      ),
    ],
  ],
  [
    AUTOMATION.CHECKS,
    [
      automationRun(
        3,
        20 * MINUTE,
        { kind: AUTOMATION_FIRING.MANUAL, userId: ADA.userId },
        { id: AGENT.INVITES, title: "Build teammate invitations", status: AGENT_STATUS.RUNNING },
        { settledAt: null },
      ),
      automationRun(
        4,
        DAY,
        {
          kind: AUTOMATION_FIRING.GITHUB,
          event: GITHUB_TRIGGER_EVENT.CHECK_FAILED,
          repository: "ada/ledger",
          branch: "rounding",
        },
        { id: AGENT.ROUNDING, title: "Fix ledger rounding", status: AGENT_STATUS.COMPLETED },
      ),
    ],
  ],
  [
    AUTOMATION.DEPLOY,
    [
      automationRun(5, 3 * HOUR, { kind: AUTOMATION_FIRING.WEBHOOK, bytes: 1824 }, null, {
        status: AUTOMATION_RUN_STATUS.FAILED,
        reason: AUTOMATION_RUN_REASON.CREDENTIAL_MISSING,
      }),
    ],
  ],
]);

/** The newest run of `automationId`, as its row reads it; none for one that never ran. */
function newestRun(automationId: string): AutomationRunSummary | null {
  return AUTOMATION_RUNS.get(automationId)?.[0] ?? null;
}

/** What the fixture's automations share: made on the workspace with no task, each run a new agent. */
const AUTOMATION_COMMON = {
  taskId: null,
  taskName: null,
  workspaceId: FIXTURE_IDS.WORKSPACE,
  pausedReason: null,
  target: { kind: AUTOMATION_TARGET.NEW_AGENT },
  creatorId: ADA.userId,
  mine: true,
} as const;

/** The fixture workspace's automations, newest made first, as its list reads them: two the workspace shares, the digest handing its runs to the Release manager, and one of Ada's own, turned off. */
const AUTOMATIONS: readonly AutomationSummary[] = [
  {
    ...AUTOMATION_COMMON,
    id: AUTOMATION.DEPLOY,
    name: "Check each deploy",
    enabled: false,
    trigger: { kind: AUTOMATION_TRIGGER.WEBHOOK },
    action: {
      kind: AUTOMATION_ACTION.AGENT,
      prompt:
        "Open the release the webhook names, read its error rate for an hour, and roll it back if it doubled.",
    },
    nextRunAt: null,
    lastRun: newestRun(AUTOMATION.DEPLOY),
    createdAt: LANDED - 9 * DAY,
    scope: AUTOMATION_SCOPE.PERSONAL,
    repositories: ["ada/relay"],
  },
  {
    ...AUTOMATION_COMMON,
    id: AUTOMATION.CHECKS,
    name: "Fix failing checks",
    enabled: true,
    trigger: { kind: AUTOMATION_TRIGGER.GITHUB, event: GITHUB_TRIGGER_EVENT.CHECK_FAILED },
    action: {
      kind: AUTOMATION_ACTION.AGENT,
      prompt:
        "Read the failed check's log, fix what broke on the branch, and push the fix to its pull request.",
    },
    nextRunAt: null,
    lastRun: newestRun(AUTOMATION.CHECKS),
    createdAt: LANDED - 16 * DAY,
    scope: AUTOMATION_SCOPE.WORKSPACE,
    repositories: ["ada/relay", "ada/ledger"],
  },
  {
    ...AUTOMATION_COMMON,
    id: AUTOMATION.DIGEST,
    name: "Weekly digest",
    enabled: true,
    trigger: { kind: AUTOMATION_TRIGGER.SCHEDULE, ...DIGEST_SCHEDULE },
    action: {
      kind: AUTOMATION_ACTION.AGENT,
      prompt:
        "Summarize what merged and what is still open this week, and post it to the team's digest.",
    },
    nextRunAt: DIGEST_DUE.NEXT,
    lastRun: newestRun(AUTOMATION.DIGEST),
    // Note that the digest hands every run to the Release manager, so its row names the Manager its runs land on.
    target: { kind: AUTOMATION_TARGET.SAME_AGENT, agentId: AGENT.MANAGER },
    createdAt: LANDED - 30 * DAY,
    scope: AUTOMATION_SCOPE.WORKSPACE,
    repositories: ["ada/relay"],
  },
];

/** Each automation's switch as a run turned it, by the automation's id. */
export type AutomationSwitches = ReadonlyMap<string, boolean>;

/** The automations with the switches a run turned laid on them, one list for each map of switches, so a stage that turns none draws none again. */
const SWITCHED = new WeakMap<AutomationSwitches, AppStateSnapshot[typeof LIVE_READ.AUTOMATIONS]>();

/** The automations' runs as the host holds them once read, by the automation. */
const HELD_RUNS: AppStateSnapshot[typeof LIVE_READ.AUTOMATION_RUNS] = Object.fromEntries(
  [...AUTOMATION_RUNS].map(([id, runs]) => [id, { rows: runs }]),
);

/** Every run of the fixture workspace's automations, each naming its automation, newest fired first, as the host holds the workspace's runs once read. */
const HELD_WORKSPACE_RUNS: AppStateSnapshot[typeof LIVE_READ.AUTOMATION_WORKSPACE_RUNS] = {
  [FIXTURE_IDS.WORKSPACE]: {
    rows: AUTOMATIONS.flatMap((automation) =>
      (AUTOMATION_RUNS.get(automation.id) ?? []).map((run) => ({
        ...run,
        automation: { id: automation.id, name: automation.name },
      })),
    ).toSorted((a, b) => b.firedAt - a.firedAt),
  },
};

/**
 * The document as the phone's fixture run draws Settings › Automations: the
 * fixture workspace's automations and each one's runs held as their reads
 * hold them once read, with each switch the run turned laid on them, as the
 * host draws a switch turned (`automation-collections.ts`). The desktop's
 * fixtures stage no automation here, so their sidebar and person page stand
 * as they did.
 */
export function inboxAutomationsAppState(
  state: AppStateSnapshot,
  switches: AutomationSwitches,
): AppStateSnapshot {
  if (!STAGED_PROFILES.has(state.run.profile)) return state;
  let held = SWITCHED.get(switches);

  if (held === undefined) {
    const rows = AUTOMATIONS.map((automation) => {
      const enabled = switches.get(automation.id);

      return enabled === undefined ? automation : { ...automation, enabled };
    });

    held = { [FIXTURE_IDS.WORKSPACE]: { rows } };
    SWITCHED.set(switches, held);
  }

  return {
    ...state,
    [LIVE_READ.AUTOMATIONS]: { ...state[LIVE_READ.AUTOMATIONS], ...held },
    [LIVE_READ.AUTOMATION_RUNS]: { ...state[LIVE_READ.AUTOMATION_RUNS], ...HELD_RUNS },
    [LIVE_READ.AUTOMATION_WORKSPACE_RUNS]: {
      ...state[LIVE_READ.AUTOMATION_WORKSPACE_RUNS],
      ...HELD_WORKSPACE_RUNS,
    },
  };
}

/** The switch an automation's change turns, by the automation, where the change turns one; none for any other act. */
export function automationSwitchOf(
  kind: PortActKind,
  payload: PortActPayload<PortActKind>,
): { readonly automationId: string; readonly enabled: boolean } | undefined {
  if (kind !== ACT_KIND.AUTOMATIONS_CHANGE) return undefined;
  // SAFETY: the payload is the kind's, which the guard above names.
  const { automationId, change } = payload as PortActPayload<typeof ACT_KIND.AUTOMATIONS_CHANGE>;

  return change.enabled === undefined ? undefined : { automationId, enabled: change.enabled };
}

/**
 * The Release manager's followers as a fixture run stages them: Ada, the
 * account, its owner, and Grace, who lets it use her machines, so People
 * lists both and Alan stands to be added. A write moves them for the run,
 * as the service would, so a press is seen to land.
 */
let managerFollowers: readonly AgentFollowerWire[] = [
  { userId: ADA.userId, owner: true, machines: true },
  { userId: GRACE.userId, owner: false, machines: true },
];

/** The Manager's followers moved by `move`, answered as the service answers a follower write; a Manager the fixture does not stage answers as none. */
function followersMoved(
  agentId: string,
  move: (followers: readonly AgentFollowerWire[]) => readonly AgentFollowerWire[],
): AgentFollowersAnswerView {
  if (agentId !== AGENT.MANAGER) return { failure: AGENT_FOLLOWER_FAILURE.NOT_FOUND };
  managerFollowers = move(managerFollowers);

  return { agentId, followers: managerFollowers };
}

/** A follower added last, their machines off, where they do not follow already. */
function followerAdded(userId: string) {
  return (followers: readonly AgentFollowerWire[]) =>
    followers.some((each) => each.userId === userId)
      ? followers
      : [...followers, { userId, owner: false, machines: false }];
}

/** A follower taken away, which the owner may not be. */
function followerRemoved(userId: string) {
  return (followers: readonly AgentFollowerWire[]) =>
    followers.filter((each) => each.owner || each.userId !== userId);
}

/** One kind's staged answer: its result. */
type StagedAnswer<Kind extends PortActKind> = (
  payload: PortActPayload<Kind>,
) => PortActResult<Kind>;

type StagedAnswers = { readonly [Kind in PortActKind]?: StagedAnswer<Kind> };

/**
 * Every read the Inbox, its items, and the person page ask, answered as the
 * service would answer it for this account. Note that the workspace's members
 * are not among them, because the tasks fixture's own answer names them
 * (`settings-fixture.ts`), and the page names the account by its tasks meanwhile.
 */
/** What a dictated clip is heard as in a fixture run, whatever it held, so a flow sees the words land in the field. */
const DICTATED_WORDS = "Run the invite tests again.";

/** A picture's bytes as this fixture answers them, by whose it is: an agent's, an Inbox item's, or a description's or a comment's. */
function fixturePictureRead(picture: PictureSourceParams) {
  switch (picture.owner) {
    // Note that the phone asks for a recording's MP4 copy, as its header to the service does.
    case PICTURE_OWNER.AGENT:
      return fixtureAgentPicture(picture.pictureId, MP4_TYPE);
    case PICTURE_OWNER.INBOX:
      return ANSWERS[ACT_KIND.AGENTS_INBOX_ATTACHMENT]?.({
        itemId: picture.itemId,
        attachmentId: picture.attachmentId,
      });
    case PICTURE_OWNER.TASK:
      return ANSWERS[ACT_KIND.TASKS_PICTURE_READ]?.({
        taskId: picture.taskId,
        attachmentId: picture.attachmentId,
      });
  }
}

/** Where the loader reads a picture in a fixture run: its own `data:` address, or none where the fixture holds no such picture. */
function fixturePictureSource(picture: PictureSourceParams): PictureSourceView {
  const read = fixturePictureRead(picture);

  if (read === undefined || !("base64" in read)) {
    return { failure: PICTURE_SOURCE_FAILURE.UNOFFERED };
  }

  return { uri: `data:${read.contentType};base64,${read.base64}` };
}

const ANSWERS: StagedAnswers = {
  [ACT_KIND.WORKSPACE_MERGE_QUEUE_READ]: () => MERGE_QUEUES,
  // Note that an automation's switch is taken as the service takes one, the automation answered turned, though nothing here moves; the iOS run lays it over the list itself (`inboxAutomationsAppState`).
  [ACT_KIND.AUTOMATIONS_CHANGE]: ({ automationId, change }) => {
    const automation = AUTOMATIONS.find((each) => each.id === automationId);

    if (automation === undefined) return { failure: AUTOMATION_CALL_FAILURE.NOT_FOUND };

    return { automation: { ...automation, enabled: change.enabled ?? automation.enabled } };
  },
  // Note that a Run now is taken as the service takes one, a run queued by Ada, though nothing here starts it.
  [ACT_KIND.AUTOMATIONS_RUN]: ({ automationId }) =>
    AUTOMATIONS.some((each) => each.id === automationId)
      ? {
          run: automationRun(0, 0, { kind: AUTOMATION_FIRING.MANUAL, userId: ADA.userId }, null, {
            status: AUTOMATION_RUN_STATUS.QUEUED,
            settledAt: null,
          }),
        }
      : { failure: AUTOMATION_CALL_FAILURE.NOT_FOUND },
  // Note that a dictated clip is heard as fixed words, though no model hears it, so a simulator's silent microphone still dictates.
  [ACT_KIND.DICTATION_TRANSCRIBE]: () => ({ text: DICTATED_WORDS }),
  // Note that the workspace's cloud environment is read as the service answers it, and a size chosen is taken as the service takes one, though nothing here moves.
  [ACT_KIND.WORKSPACE_SANDBOX_SIZE_READ]: () => CLOUD_ENVIRONMENT.SIZE,
  [ACT_KIND.WORKSPACE_SANDBOX_SIZE_PUT]: ({ vcpus }) => ({ vcpus }),
  [ACT_KIND.WORKSPACE_ENVIRONMENT_LIST]: () => CLOUD_ENVIRONMENT.VARIABLES,
  [ACT_KIND.WORKSPACE_SANDBOX_SETUP_READ]: () => CLOUD_ENVIRONMENT.SETUP,
  // Note that an ask is answered as the service answers the first answer given, which stands; the mobile fixture takes the ask off the document itself (`machineAskAppState`).
  [ACT_KIND.MACHINE_ASK_ANSWER]: ({ decision, note }) =>
    note === undefined ? { decision } : { decision, note },
  // Note that a pairing is read, approved, and denied as the service would answer, though nothing here makes a machine.
  [ACT_KIND.HOSTS_PAIRING_READ]: ({ code }) => pairingAnswer(code, PENDING_PAIRING),
  [ACT_KIND.HOSTS_PAIRING_APPROVE]: ({ code }) =>
    pairingAnswer(code, { deviceId: "00000000-0000-4000-8000-0000000000a1" }),
  [ACT_KIND.HOSTS_PAIRING_DENY]: ({ code }) => pairingAnswer(code, { done: true as const }),
  // Note that an account's rename is taken as the service takes one, the account answered under the label asked, though nothing here moves.
  [ACT_KIND.INTEGRATIONS_RENAME]: ({ provider, connection, label }) => ({
    account: { provider, connection, label, status: INTEGRATION_STATUS.CONNECTED },
  }),
  // Note that Add skill's paste is read as the service reads one, though no repository is reached, and its install is taken and answered, though nothing here moves.
  [ACT_KIND.INSTALLED_SKILLS_PREVIEW]: ({ text }) => skillPreviewOf(text),
  [ACT_KIND.INSTALLED_SKILLS_INSTALL]: (request) => ({
    skills:
      request.skills === undefined
        ? [installedSkill(request.name ?? "", request.description ?? "")]
        : request.skills.map((name) =>
            installedSkill(
              name,
              SOURCE_SKILLS.find((each) => each.name === name)?.description ?? "",
            ),
          ),
  }),
  [ACT_KIND.INSTALLED_SKILLS_READ]: ({ skillId }) => {
    const read = INSTALLED_SKILL_FILES.get(skillId);

    return read === undefined
      ? { failure: INSTALLED_SKILL_CALL_FAILURE.NOT_FOUND }
      : { id: skillId, skillFile: read.skillFile, files: [...read.files] };
  },
  [ACT_KIND.AGENTS_LIST]: ({ taskId }) => {
    const agent = AGENTS.get(taskId);

    return { agents: agent === undefined ? [] : [agent] };
  },
  // Note that a mark is taken as the service takes one, the item's state echoed, though nothing here moves, so its dot stays as staged: the host draws a mark, and none stands behind a fixture run's act door.
  [ACT_KIND.AGENTS_INBOX_READ_STATE]: ({ itemId, unread }) => ({ id: itemId, unread }),
  // Note that a reminder is taken as the service takes one, the item's read state echoed; the iOS run lays it over the document itself (`inboxRemindersAppState`).
  [ACT_KIND.AGENTS_INBOX_REMIND]: ({ itemId }) => {
    const held = stagedItem(itemId);

    if (held === undefined) return { failure: AGENT_CALL_FAILURE.NOT_FOUND };

    return { id: itemId, unread: held.unread === true };
  },
  // Note that the recording is answered as its MP4 copy to a reader that plays MP4, as the service answers one it keeps a copy of.
  [ACT_KIND.AGENTS_INBOX_ATTACHMENT]: ({ itemId, attachmentId, playable }) => {
    if (itemId === TURN_END.ITEM) return turnEndFile(attachmentId, playable);

    if (itemId !== RECORDED.ITEM) return { failure: AGENT_CALL_FAILURE.NOT_FOUND };

    if (attachmentId === RECORDED.PICTURE) {
      return { contentType: AGENT_ATTACHMENT_TYPE.PNG, base64: FIXTURE_PICTURE_PNG };
    }

    if (attachmentId === RECORDED.PLAN) {
      return { contentType: AGENT_ATTACHMENT_TYPE.PDF, base64: FIXTURE_PLAN_PDF };
    }

    if (attachmentId === RECORDED.VIDEO) {
      return playable === MP4_TYPE
        ? { contentType: MP4_TYPE, base64: FIXTURE_VIDEO_MP4 }
        : { contentType: CONVERSATION_MEDIA_TYPE.WEBM, base64: FIXTURE_VIDEO_WEBM };
    }

    return { failure: AGENT_CALL_FAILURE.NOT_FOUND };
  },
  // Note that a file Ada's question carries, and the reference task's PDF, are read as the service reads a description's, and any other is not there.
  [ACT_KIND.TASKS_PICTURE_READ]: ({ taskId, attachmentId }) => {
    if (taskId !== TASK.INVITES) return { failure: TASK_CALL_FAILURE.NOT_FOUND };

    if (attachmentId === COMMENT_FILES.PICTURE) {
      return { contentType: AGENT_ATTACHMENT_TYPE.PNG, base64: FIXTURE_PICTURE_PNG };
    }

    return attachmentId === COMMENT_FILES.PLAN || attachmentId === DESCRIPTION_PDF
      ? { contentType: AGENT_ATTACHMENT_TYPE.PDF, base64: FIXTURE_PLAN_PDF }
      : { failure: TASK_CALL_FAILURE.NOT_FOUND };
  },
  // Note that a status is taken as the service takes one, though nothing here moves, so the window draws the change it asked for itself.
  [ACT_KIND.TASKS_SET_STANDING]: () => true,
  // Note that a version of the reference journey's description is read as the service reads one, and a restore is taken as the service takes one, though nothing here moves.
  [ACT_KIND.TASKS_REVISION]: ({ seq }) => ({
    revision: {
      seq,
      description: { body: invitesVersionBody(seq), assumptions: [] },
      // The version before it, which the version is drawn against; the first has none.
      previous: seq > 1 ? { body: invitesVersionBody(seq - 1), assumptions: [] } : null,
    },
  }),
  [ACT_KIND.TASKS_RESTORE]: () => true,
  // Note that a note to the people who make the app is taken as the feedback service takes one, and goes nowhere, so a run that sends one mails no one.
  [ACT_KIND.FEEDBACK_SEND]: () => ({ delivered: true }),
  // Note that a memory's words are kept as the service keeps them, by Ada, a correction keeping its memory's id, though nothing here moves; the mobile fixture lays the saved words over the list itself (`savedMemoriesAppState`).
  [ACT_KIND.MEMORIES_SAVE]: ({ text, replaces }) => {
    const corrected = MEMORIES.find((memory) => memory.id === replaces);

    return {
      outcome: corrected === undefined ? MEMORY_SAVED.KEPT : MEMORY_SAVED.CORRECTED,
      memory: savedMemory(text, corrected),
    };
  },
  // The invitations agent's pictures and recording, by the ids its transcript names them by; an older page of it stands nowhere.
  [ACT_KIND.AGENTS_PICTURE]: ({ pictureId, playable }) => fixtureAgentPicture(pictureId, playable),
  // Note that a picture's source is its own `data:` address, read as its bytes are read above, since a fixture run has no service for the loader to read.
  [ACT_KIND.ACCOUNT_PICTURE_SOURCE]: (picture) => fixturePictureSource(picture),
  [ACT_KIND.AGENTS_TRANSCRIPT_OLDER]: () => ({ failure: AGENT_CALL_FAILURE.NOT_FOUND }),
  // Note that an answer to the invitations agent's held call is taken as the service takes one, the call settled as answered, though its row still holds it, so the window draws its own answer.
  [ACT_KIND.AGENTS_ANSWER_APPROVAL]: ({ approvalId, answer }) => ({
    approval: { id: approvalId, status: APPROVAL_STATUS_OF_ANSWER[answer] },
  }),
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
  // Note that a Got it and an Undo's take-back are taken as the service takes them, though nothing here moves, so the window draws its own.
  [ACT_KIND.AGENTS_INBOX_ANSWER]: ({ itemId }) => {
    const held = stagedItem(itemId);

    if (held === undefined) return { failure: AGENT_CALL_FAILURE.NOT_FOUND };

    return { item: acknowledgedNow(held, ADA, Date.now()), taken: true };
  },
  [ACT_KIND.AGENTS_INBOX_TAKE_BACK]: ({ itemId }) => {
    const held = stagedItem(itemId);

    if (held === undefined) return { failure: AGENT_CALL_FAILURE.NOT_FOUND };

    return { item: takenBackNow(held, Date.now()), outcome: INBOX_TAKE_BACK.TAKEN };
  },
  // Note that a change to one of the invitations agent's pull requests is taken as GitHub takes one, and the run lays how it moved it over the parts (`pullRequestPartsAppState`).
  [ACT_KIND.PULL_REQUESTS_ACTION]: () => ({ outcome: PULL_REQUEST_WRITE_OUTCOME.DONE }),
  // The files the invitations agent's ready pull request changes, so Files changed lists them and opens their diffs.
  [ACT_KIND.PULL_REQUESTS_CHANGES]: ({ number }) => fixtureChanges(number),
  // A Generate of a pull request's chapters is answered with them told, as the service answers once a model told them.
  [ACT_KIND.CHAPTERS_REPOSITORY_GENERATE]: ({ number }) => fixtureGeneratedChapters(number),
  // An agent's sandbox listens on two ports, one served by Vite, and shares neither, so its Ports sheet lists them and offers Share.
  [ACT_KIND.AGENTS_PORTS]: () => ({
    running: true,
    ports: [3000, 5173],
    labels: [{ port: 5173, label: "vite" }],
  }),
  [ACT_KIND.AGENTS_PORT_SHARED]: () => ({ shared: null }),
  [ACT_KIND.AGENTS_FOLLOWERS]: ({ agentId }) => followersMoved(agentId, (followers) => followers),
  [ACT_KIND.AGENTS_FOLLOW]: ({ agentId }) => followersMoved(agentId, followerAdded(ADA.userId)),
  [ACT_KIND.AGENTS_UNFOLLOW]: ({ agentId }) => followersMoved(agentId, followerRemoved(ADA.userId)),
  [ACT_KIND.AGENTS_SET_FOLLOWER_MACHINES]: ({ agentId, machines }) =>
    followersMoved(agentId, (followers) =>
      followers.map((each) =>
        each.userId === ADA.userId && !each.owner ? { ...each, machines } : each,
      ),
    ),
  [ACT_KIND.AGENTS_ADD_FOLLOWER]: ({ agentId, userId }) =>
    followersMoved(agentId, followerAdded(userId)),
  [ACT_KIND.AGENTS_REMOVE_FOLLOWER]: ({ agentId, userId }) =>
    followersMoved(agentId, followerRemoved(userId)),
  // Note that a message, a queue change, and a Stop are taken as the service takes them, answered with the agent or the queue as it then stands, though nothing here moves, so the transcript reads as staged; the iOS run lays a queue change and a Stop's pause over the transcript itself (`queuedAppState`).
  [ACT_KIND.AGENTS_MESSAGE]: ({ agentId }) => {
    const held = stagedAgent(agentId);

    if (held === undefined) return { failure: AGENT_CALL_FAILURE.NOT_FOUND };

    return { agent: { ...held, status: AGENT_STATUS.RUNNING } };
  },
  // Note that a message to a Manager's chat, or a reply in one of its threads, is taken as the service takes one, under the key it went under; the iOS run lays it over the chat as the row it lands as (`chatSentAppState`).
  [ACT_KIND.AGENTS_CHAT_SEND]: ({ agentId, clientKey }) => {
    const held = stagedAgent(agentId);

    if (held === undefined) return { failure: AGENT_CALL_FAILURE.NOT_FOUND };

    return { agent: held, messageId: clientKey };
  },
  // Note that a reaction to a message of the release Manager's chat is kept for the run, so the chat stands with it as it would once its read carries it; the panel's run stages its document again on it (`tasks-fixture-loader.ts`).
  // A page of older items is read into the run's, the page after it answered where one stands.
  [ACT_KIND.AGENTS_INBOX_OLDER_PAGE]: ({ before }) => {
    const page = before === undefined ? 1 : Number(before.replace("older-", "")) + 1;
    olderPagesRead = Math.max(olderPagesRead, Math.min(page, OLDER_PAGES));

    return page < OLDER_PAGES ? { next: olderCursor(page) } : {};
  },
  // A place's search finds the staged items past the feed whose title holds its words, and its words cleared let them go.
  [ACT_KIND.AGENTS_INBOX_SEARCH]: ({ place, query }) => {
    if (query === undefined) foundAt.delete(place);
    else foundAt.set(place, { query, items: stagedFound(query) });

    return {};
  },
  [ACT_KIND.AGENTS_CHAT_REACT]: ({ agentId, messageId, kind, reacted }) => {
    if (agentId !== AGENT.MANAGER) return { failure: AGENT_CALL_FAILURE.NOT_FOUND };
    const message = reactedManagerChat().messages.find((each) => each.id === messageId);
    const mine = message?.reactions?.find((each) => each.kind === kind)?.reacted ?? false;

    const others = managerChatPresses.filter(
      (each) => each.messageId !== messageId || each.kind !== kind,
    );

    managerChatPresses = [...others, { messageId, kind, reacted }];

    return { changed: message !== undefined && mine !== reacted };
  },
  // Note that an edit of one of the account's own messages of the release Manager's chat is kept for the run, as a reaction is, so the chat stands with its words as edited.
  [ACT_KIND.AGENTS_CHAT_EDIT]: ({ agentId, messageId, text }) => {
    if (agentId !== AGENT.MANAGER) return { failure: AGENT_CALL_FAILURE.NOT_FOUND };
    const message = reactedManagerChat().messages.find((each) => each.id === messageId);

    if (message === undefined || message.authorUserId !== ADA.userId) {
      return { failure: AGENT_CALL_FAILURE.NOT_FOUND };
    }

    if (message.text === text) return { changed: false };
    managerChatEdits = [...managerChatEdits, { messageId, text, editedAt: MANAGER_STARTED + HOUR }];

    return { changed: true };
  },
  [ACT_KIND.AGENTS_QUEUE]: ({ agentId }) => {
    if (stagedAgent(agentId) === undefined) return { failure: AGENT_CALL_FAILURE.NOT_FOUND };

    return { queue: { messages: [], revision: 2 } };
  },
  // Note that an agent's own read is answered with the agent as the list holds it, so a fresh read, such as an Archive asked about at rest reads before it goes, finds it resting rather than failing and asking again as Stop and archive.
  [ACT_KIND.AGENTS_PAGE]: ({ agentId }) => {
    const held = stagedAgent(agentId);

    if (held === undefined) return { failure: AGENT_CALL_FAILURE.NOT_FOUND };
    const task = [...OWN_TASKS, ...LISTED_TASKS].find((each) => each.id === held.taskId);

    const repositories: readonly string[] =
      held.id === AGENT.MANAGER
        ? MANAGER_REPOSITORIES
        : task?.repository == null
          ? []
          : [task.repository];

    return {
      agent: {
        ...held,
        automationId: null,
        workspaceId: FIXTURE_IDS.WORKSPACE,
        repository: repositories[0] ?? null,
        repositories,
      },
    };
  },
  [ACT_KIND.AGENTS_STOP]: ({ agentId }) => {
    const held = stagedAgent(agentId);

    if (held === undefined) return { failure: AGENT_CALL_FAILURE.NOT_FOUND };

    return { agent: { ...held, status: AGENT_STATUS.CANCELED } };
  },
  // Note that a move is taken as the service takes one, answered with the agent where it now runs, on the device named or in the cloud.
  [ACT_KIND.AGENTS_MOVE]: ({ agentId, runsOn }) => {
    const held = stagedAgent(agentId);

    if (held === undefined) return { failure: AGENT_CALL_FAILURE.NOT_FOUND };
    const { machine: _machine, mac: _mac, ...cloud } = held;

    if (runsOn.machine === AGENT_MACHINE.VERCEL) return { agent: cloud };
    const host = HOSTS.find((each) => each.id === runsOn.deviceId);

    return {
      agent: {
        ...cloud,
        machine: AGENT_MACHINE.DEVICE,
        mac: { name: host?.name ?? "", deviceId: runsOn.deviceId },
      },
    };
  },
  // Note that a change of model, of permission mode, of servers, of name, or of pin is taken as the service takes one, answered with the agent as it then stands; the iOS run lays it over the list itself (`chosenTasksView`).
  [ACT_KIND.AGENTS_CHOOSE]: ({ agentId, model, effort }) => {
    const held = stagedAgent(agentId);

    if (held === undefined) return { failure: AGENT_CALL_FAILURE.NOT_FOUND };

    return { agent: { ...held, model, effort } };
  },
  [ACT_KIND.AGENTS_PERMISSION_MODE]: ({ agentId, permissionMode }) => {
    const held = stagedAgent(agentId);

    if (held === undefined) return { failure: AGENT_CALL_FAILURE.NOT_FOUND };

    return { agent: { ...held, permissionMode } };
  },
  [ACT_KIND.AGENTS_FACE]: ({ agentId, face }) => {
    const held = stagedAgent(agentId);

    if (held === undefined) return { failure: AGENT_CALL_FAILURE.NOT_FOUND };

    return { agent: { ...held, face } };
  },
  [ACT_KIND.AGENTS_SERVERS]: ({ agentId, disabledServers }) => {
    const held = stagedAgent(agentId);

    if (held === undefined) return { failure: AGENT_CALL_FAILURE.NOT_FOUND };

    return { agent: { ...held, disabledServers } };
  },
  [ACT_KIND.AGENTS_RENAME]: ({ agentId, title }) => {
    const held = stagedAgent(agentId);

    if (held === undefined) return { failure: AGENT_CALL_FAILURE.NOT_FOUND };

    return { agent: { ...held, title } };
  },
  [ACT_KIND.AGENTS_PIN]: ({ agentId }) => {
    const held = stagedAgent(agentId);

    if (held === undefined) return { failure: AGENT_CALL_FAILURE.NOT_FOUND };

    return { agent: held };
  },
  // Note that an archive or an unarchive is taken as the service takes one, answered with the agent archived or brought back, though nothing here moves, so the agent stays on its task's list.
  [ACT_KIND.AGENTS_ARCHIVE]: ({ agentId, archived }) => {
    const held = stagedAgent(agentId);

    if (held === undefined) return { failure: AGENT_CALL_FAILURE.NOT_FOUND };

    if (!archived) {
      const { archivedAt: _archivedAt, ...back } = held;

      return { agent: back };
    }

    return { agent: { ...held, archivedAt: LANDED } };
  },
  // The invitations task's repository's skills, as the service finds them.
  [ACT_KIND.TASKS_SKILLS]: () => ({ skills: SKILLS }),
  // The invitations task's repository's tree, read whole as an `@` reads its files and folders, through the task or, as the Manager's box reads it, through the workspace; a folder's own listing, the File tab's, stays unanswered, as it stood before the tree was staged.
  [ACT_KIND.TASKS_TREE]: (asked) =>
    asked.recursive === true &&
    asked.path === "" &&
    ("taskId" in asked
      ? asked.taskId === TASK.INVITES
      : asked.repository === INVITES_TREE.repository)
      ? { folder: INVITES_TREE }
      : { failure: TASK_CALL_FAILURE.UNANSWERED },
  // The machines of the workspace's members an `@` offers: Ada's own, the one away offline.
  [ACT_KIND.WORKSPACE_MACHINES_READ]: () => ({
    machines: HOSTS.flatMap((host) =>
      host.platform === undefined
        ? []
        : [
            {
              id: host.id,
              name: host.name,
              platform: host.platform,
              userId: ADA.userId,
              online: host.away !== true,
            },
          ],
    ),
  }),
  // Ada's machines always allow no app, so an `@` offers none of theirs.
  [ACT_KIND.HOSTS_ALLOWED_APPS]: () => ({ machines: [] }),
  [ACT_KIND.AGENTS_BOOT]: ({ agentId }) => {
    const held = stagedAgent(agentId);

    if (held === undefined) return { failure: AGENT_CALL_FAILURE.NOT_FOUND };

    return { agent: { ...held, status: AGENT_STATUS.STARTING } };
  },
  // A New Manager, answered with a Manager made on what it names, as the service answers one.
  [ACT_KIND.AGENTS_CREATE_MANAGER]: ({ name, model, effort }) => ({
    agent: {
      ...MANAGER,
      id: fixtureId(97),
      title: name,
      model,
      effort,
      createdAt: LANDED,
      status: AGENT_STATUS.STARTING,
    },
  }),
  // Note that a look at a Manager's chat is taken as the service takes one, though nothing here moves.
  [ACT_KIND.AGENTS_MARK_READ]: ({ agentId }) => {
    const held = stagedAgent(agentId);

    if (held === undefined) return { failure: AGENT_CALL_FAILURE.NOT_FOUND };

    return { agent: held };
  },
  // A Start, and a task's start with its agent, answered with a new agent starting on the words, as the service answers one.
  [ACT_KIND.AGENTS_START]: ({ taskId, prompt }) => ({
    agent: agentOn(fixtureId(91), taskId ?? TASK.INVITES, prompt ?? "", AGENT_STATUS.STARTING, 0),
  }),
  // Note that a start with no agent, File for later's, is answered with the task made alone.
  [ACT_KIND.TASKS_START]: ({ agent }) =>
    agent === undefined
      ? { taskId: fixtureId(92) }
      : {
          taskId: fixtureId(92),
          agentStart: {
            agent: agentOn(
              fixtureId(93),
              fixtureId(92),
              agent.prompt ?? "",
              AGENT_STATUS.STARTING,
              0,
            ),
          },
        },
  // Note that a rename and a delete are taken as the service takes them, though nothing here moves, so the window draws its own write.
  [ACT_KIND.TASKS_RENAME]: () => true,
  // Note that a description's edit is taken as the service takes one, though nothing here moves, so the page draws the description it held.
  [ACT_KIND.TASKS_EDIT]: () => ({ saved: true }),
  [ACT_KIND.TASKS_DELETE]: () => true,
  // Note that a new comment on the invites task's description is taken as the service takes one, answered with its thread under the id the window chose and kept on the comments slice, so a flow sees the thread open with the words as its first comment.
  [ACT_KIND.TASKS_COMMENT_START]: ({ taskId, start }) => {
    if (taskId !== TASK.INVITES || !("scope" in start)) {
      return { failure: DESCRIPTION_COMMENT_CALL_FAILURE.NOT_FOUND };
    }

    const at = Date.now();

    const thread: DescriptionCommentThread = {
      id: start.id ?? fixtureId(307),
      scope: start.scope,
      quote: start.quote,
      anchor: start.anchor,
      section: "Goal",
      status: DESCRIPTION_COMMENT_STATUS.OPEN,
      entries: [
        {
          id: fixtureId(308),
          kind: DESCRIPTION_COMMENT_ENTRY.COMMENT,
          writer: { actor: DESCRIPTION_COMMENT_ACTOR.MEMBER, by: ADA },
          words: start.words,
          at,
        },
      ],
      createdAt: at,
      updatedAt: at,
      revision: 1,
    };

    return { thread: keepRunThread(thread) };
  },
  // Note that a reply, a resolve, or a reopen is taken as the service takes one, on a staged thread or one the run started, answered with its thread as it then stands and kept on the comments slice, so the thread's page and its task's Comments draw it moved.
  [ACT_KIND.TASKS_COMMENT_ACT]: ({ taskId, threadId, action }) => {
    const thread =
      RUN_THREADS.get(threadId) ?? INVITES_THREADS.find((each) => each.id === threadId);

    if (taskId !== TASK.INVITES || thread === undefined) {
      return { failure: DESCRIPTION_COMMENT_CALL_FAILURE.NOT_FOUND };
    }

    // Note that a resolve or a reopen answers the thread at the status asked, with its line by Ada at the end, as the service answers one, so the host never draws it back as it stood.
    if (
      action.action === DESCRIPTION_COMMENT_ACTION.RESOLVE ||
      action.action === DESCRIPTION_COMMENT_ACTION.REOPEN
    ) {
      const resolving = action.action === DESCRIPTION_COMMENT_ACTION.RESOLVE;

      // Note that the line takes a fresh id from the run's count, as a kept reply does, so a thread settled twice never holds two rows of one key.
      const line = {
        id: fixtureId(nextReplyId++),
        kind: resolving ? DESCRIPTION_COMMENT_ENTRY.RESOLVED : DESCRIPTION_COMMENT_ENTRY.REOPENED,
        writer: { actor: DESCRIPTION_COMMENT_ACTOR.MEMBER, by: ADA },
        at: Date.now(),
      };

      const settled = {
        ...thread,
        status: resolving ? DESCRIPTION_COMMENT_STATUS.RESOLVED : DESCRIPTION_COMMENT_STATUS.OPEN,
        entries: [...thread.entries, line],
      };

      return { thread: keepChanged(settled) };
    }

    if (action.action !== DESCRIPTION_COMMENT_ACTION.REPLY) return { thread };

    // Note that each kept reply takes an id of its own, since the thread's rows are keyed by their entries' ids.
    const reply = {
      id: fixtureId(nextReplyId++),
      kind: DESCRIPTION_COMMENT_ENTRY.COMMENT,
      writer: { actor: DESCRIPTION_COMMENT_ACTOR.MEMBER, by: ADA },
      words: action.words,
      at: Date.now(),
    };

    const replied = { ...thread, entries: [...thread.entries, reply] };

    return { thread: keepChanged(replied) };
  },
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
  // The Live Activity's tokens and end are taken, as a phone the service holds would have them.
  [ACT_KIND.LIVE_ACTIVITY_START_TOKEN]: () => ({ done: true }),
  [ACT_KIND.LIVE_ACTIVITY_TOKEN]: () => ({ done: true }),
  [ACT_KIND.LIVE_ACTIVITY_ENDED]: () => ({ done: true }),
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
