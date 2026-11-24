/**
 * fixture-agent-transcript.ts -- the transcripts the Inbox fixture's agents hold: the invitations agent's, long enough to scroll, with its words, its thinking, its calls, a teammate's review GitHub steered in, a file the account sent, the pictures and the recording it showed, the page it showed, and the pull request it opened, still at work on its last turn; the rounding agent's, ten finished turns with wide words; the digest agent's short run, which reads its draft in an app on the reader's Mac, still at work; and the release Manager's short chat.
 *
 * The Inbox fixture lays it on the document where the host holds an
 * agent's transcript (`LIVE_READ.TRANSCRIPT`), so the panel's agent page
 * and the iPhone's draw it as they draw a live one, and answers the
 * pictures it names by their ids (`fixtureAgentPicture`). Its page is the
 * one the fixture stages for the task (`FIXTURE_PAGE`), which the host
 * answers in a fixture run. Every word, path, and number here is invented.
 */

import { AGENT_TOOL } from "@repo/features/agent-tools";
import { AGENT_CALL_FAILURE, type AgentInboxAttachmentView } from "@repo/features/agent-view";
import {
  AGENT_ATTACHMENT_TYPE,
  AGENT_MESSAGE_LEAD,
  AGENT_SENDER,
  AGENT_STATUS,
  type AgentTranscriptMessage,
  agentMessageReplyLine,
} from "@repo/features/agent-wire";
import { CONVERSATION_MEDIA_TYPE } from "@repo/features/conversation-picture-wire";
import { MP4_TYPE } from "@repo/features/video-signature";
import { MESSAGE_CHANNEL, MESSAGE_ROLE, type WireRecord } from "@repo/wire";
import type { AppTranscript } from "./app-state.js";
import {
  FIXTURE_APP_ICON_PNG,
  FIXTURE_PICTURE_PNG,
  FIXTURE_VIDEO_MP4,
  FIXTURE_VIDEO_WEBM,
} from "./fixture-inbox-media.js";
import { FIXTURE_PAGE } from "./fixture-stage.js";

const MINUTE = 60_000;

/** The teammate whose line reaches the invitations agent, one of the fixture's workspace members. */
const TEAMMATE = { userId: "user-grace", name: "Grace Hopper" } as const;

/** The agent that sends the invitations agent a message: the fixture's digest agent, by the id `fixture-inbox.ts` gives it (`AGENT.DIGEST`), which this file cannot import, since that one imports it. */
const MESSAGING_AGENT = { id: "6fc08203-4b7d-4e95-90bd-7c8d9eafb0c6", name: "Weekly digest email" };
const DAY = 24 * 60 * MINUTE;

/** The pictures and the recording the agent showed, by the ids the service kept them under. */
const KEPT = {
  DIALOG: "fixture-picture-invite-dialog",
  EMAIL: "fixture-picture-invite-email",
  RECORDING: "fixture-recording-accept",
  MAIL_WINDOW: "fixture-picture-mail-window",
  MAIL_ICON: "fixture-picture-mail-icon",
} as const;

/** The mail app the digest agent reads its draft in on the reader's Mac, as the Mac names it. */
const MAIL_APP = { name: "Mail", bundleId: "com.apple.mail" } as const;

/** The file the account sent with its ask to resend an expired invite: the invites that expired, as a short CSV sent as plain text as every text file is, so a sent line's file chip has a text file to count the lines of. */
const EXPIRED_INVITES = {
  type: "file",
  mediaType: AGENT_ATTACHMENT_TYPE.TEXT,
  filename: "expired-invites.csv",
  url: "data:text/plain;base64,ZW1haWwsZXhwaXJlZAprYXRoZXJpbmVAZXhhbXBsZS5jb20sMjAyNi0xMS0wMgptYXJjb0BleGFtcGxlLmNvbSwyMDI2LTExLTA1Cg==",
} as const;

/** The picture the account sent with its ask for the funnel, named by its marker in the words, so a sent line's picture chip has a picture to draw. */
const INVITE_PAGE = {
  type: "file",
  mediaType: AGENT_ATTACHMENT_TYPE.PNG,
  filename: "Picture 1",
  url: `data:image/png;base64,${FIXTURE_PICTURE_PNG}`,
} as const;

/** The fixture's picture as the service keeps one: a screenshot-sized PNG. */
function keptPicture(id: string): WireRecord {
  return { id, mediaType: AGENT_ATTACHMENT_TYPE.PNG, width: 320, height: 180, byteCount: 7549 };
}

/** The app's icon as the service keeps one: a 64 by 64 PNG. */
function keptIcon(id: string): WireRecord {
  return { id, mediaType: AGENT_ATTACHMENT_TYPE.PNG, width: 64, height: 64, byteCount: 695 };
}

/** The reader's Mac, as a computer call's answer names the machine it ran on. */
function readerMac(reader: { readonly userId: string; readonly name: string }): WireRecord {
  return { id: "fixture-machine-mac", name: "MacBook Pro", owner: { ...reader } };
}

/** A tool's call as the transcript stores it, answered. */
function toolPart(tool: string, callId: string, input: WireRecord, output: WireRecord): WireRecord {
  return { type: `tool-${tool}`, toolCallId: callId, state: "output-available", input, output };
}

/** A tool's call as the transcript stores it while it still runs. */
function runningPart(tool: string, callId: string, input: WireRecord): WireRecord {
  return { type: `tool-${tool}`, toolCallId: callId, state: "input-available", input };
}

/** The account's line asking for a turn, `at` milliseconds into the run, with the files it sent after its words. */
function asked(
  id: string,
  at: number,
  text: string,
  sender: { readonly userId: string; readonly name: string },
  files: readonly WireRecord[] = [],
): AgentTranscriptMessage {
  return {
    id,
    role: MESSAGE_ROLE.USER,
    parts: [{ type: "text", text }, ...files],
    sentAt: at,
    sentBy: { kind: AGENT_SENDER.MEMBER, userId: sender.userId, name: sender.name },
  };
}

/** Another agent's message to this one, `at` milliseconds into the run, as `message_agent` writes it: its head naming who sent it, its words, and the line telling the agent how to answer. */
function agentMessage(id: string, at: number, words: string): AgentTranscriptMessage {
  return {
    id,
    role: MESSAGE_ROLE.USER,
    parts: [
      {
        type: "text",
        text: [
          `${AGENT_MESSAGE_LEAD} · ${MESSAGING_AGENT.name} to you:`,
          words,
          agentMessageReplyLine(MESSAGING_AGENT.id),
        ].join("\n\n"),
      },
    ],
    metadata: { channel: MESSAGE_CHANNEL.AGENT_MESSAGE },
    sentAt: at,
    sentBy: { name: MESSAGING_AGENT.name, agent: true, agentId: MESSAGING_AGENT.id },
  };
}

/** The review a teammate left on the agent's pull request, as GitHub's line steers it into the agent: their words and two inline comments, which the transcript folds under the card's head. */
const REVIEW = {
  login: "gracehopper",
  url: "https://github.com/ada/relay/pull/128#pullrequestreview-2041",
  words:
    "Close, but an invite to an address that's already a member should say so rather than mint a second link.",
  comments: [
    {
      path: "src/members/invite.ts",
      line: 18,
      url: "https://github.com/ada/relay/pull/128#discussion_r3101",
      body: "Check `members.byEmail` before `pending(…)`, and answer *Already a member*.",
    },
    {
      path: "src/pages/invite.tsx",
      line: 42,
      url: "https://github.com/ada/relay/pull/128#discussion_r3102",
      body: "This copy should read **Invite sent** once it lands.",
    },
  ],
} as const;

/** The review as the agent read it, `at` milliseconds into the run: what GitHub said, fenced, under the line that names it, as the service words a wake. */
function reviewed(at: number): AgentTranscriptMessage {
  return {
    id: "fixture-invites-review",
    role: MESSAGE_ROLE.USER,
    parts: [
      {
        type: "text",
        text: [
          `@${REVIEW.login} requested changes on your pull request [@#128](${REVIEW.url}).`,
          `<github-review>\n${REVIEW.words}\n</github-review>`,
          "Act on it as you judge best.",
        ].join("\n\n"),
      },
    ],
    metadata: {
      channel: MESSAGE_CHANNEL.GITHUB,
      event: "review",
      repository: "ada/relay",
      number: 128,
      url: REVIEW.url,
      by: REVIEW.login,
      verdict: "changes_requested",
      words: REVIEW.words,
      comments: REVIEW.comments,
    },
    sentAt: at,
    sentBy: { kind: AGENT_SENDER.GITHUB, name: REVIEW.login },
  };
}

/**
 * The transcript, its instants counted from `startedAt`, its turns written
 * by `reader`, the account the fixture signs in as: the ask that began the
 * run and the agent's work on it, the dialog and its email shown and its
 * pull request opened; a teammate's review of it, which GitHub's line
 * steers in, and the agent's answer; a second
 * ask, answered with the funnel's page and a recording of an invite
 * accepted; a teammate's line and another agent's message, which a
 * transcript stands at its leading edge under their senders, the reader's
 * own alone trailing; and a third ask, sent as two lines a minute apart,
 * the agent is still working on, its last call running.
 */
function transcriptMessages(
  startedAt: number,
  reader: { readonly userId: string; readonly name: string },
): readonly AgentTranscriptMessage[] {
  return [
    asked(
      "fixture-invites-ask",
      startedAt,
      "Build teammate invitations from the description: a member invites by email, and the link joins the workspace.",
      reader,
    ),
    {
      id: "fixture-invites-work",
      role: MESSAGE_ROLE.ASSISTANT,
      parts: [
        { type: "step-start" },
        {
          type: "reasoning",
          text: "The description settles an invite as a pending membership, so removing a member already covers withdrawing one.",
        },
        {
          type: "text",
          text: "I'll model an invite as a **pending membership**, as the description settled, so removal covers both.",
        },
        toolPart(
          AGENT_TOOL.GREP,
          "fixture-invites-grep",
          { pattern: "memberships", path: "src" },
          { output: "src/db/schema/memberships.ts\nsrc/members/remove.ts\nsrc/members/list.ts" },
        ),
        toolPart(
          AGENT_TOOL.READ_FILE,
          "fixture-invites-read",
          { filePath: "src/db/schema/memberships.ts" },
          { content: 'export const memberships = pgTable("memberships", {…})' },
        ),
        toolPart(
          AGENT_TOOL.APPLY_PATCH,
          "fixture-invites-patch",
          {
            patchText:
              "*** Begin Patch\n*** Add File: src/members/invite.ts\n*** Add File: src/members/invite.test.ts\n*** End Patch",
          },
          { output: "Done." },
        ),
        toolPart(
          AGENT_TOOL.BASH,
          "fixture-invites-test",
          { command: "pnpm test src/members", description: "Run the members tests" },
          {
            stdout: " ✓ src/members/invite.test.ts (4 tests)\n\n Tests  4 passed",
            stderr: "",
            exitCode: 0,
          },
        ),
        { type: "step-start" },
        toolPart(
          AGENT_TOOL.SHOW_MEDIA,
          "fixture-invites-shots",
          {
            images: [
              {
                path: "/vercel/sandbox/relay/shots/invite-dialog.png",
                caption: "The invite dialog",
              },
              {
                path: "/vercel/sandbox/relay/shots/invite-email.png",
                caption: "The email it sends",
              },
            ],
          },
          { status: "accepted", pictures: [keptPicture(KEPT.DIALOG), keptPicture(KEPT.EMAIL)] },
        ),
        {
          type: "text",
          text: "The dialog takes an address and a role, and the email links back to the workspace.\n\n- An invite expires after **seven days**.\n- A used or withdrawn link reads *This invite is no longer valid*.",
        },
        // Note that the pull request is the one the fixture's task list holds for this agent (`fixture-inbox.ts`'s `INVITES_PULL_REQUEST`).
        toolPart(
          AGENT_TOOL.OPEN_PULL_REQUEST,
          "fixture-invites-pull-request",
          { head: "agent/invites", title: "Invite a teammate by email", body: "Invites by email." },
          { url: "https://github.com/ada/relay/pull/128", number: 128 },
        ),
      ],
      startedAt,
      finishedAt: startedAt + 9 * MINUTE,
    },
    reviewed(startedAt + 20 * MINUTE),
    {
      id: "fixture-invites-review-answer",
      role: MESSAGE_ROLE.ASSISTANT,
      parts: [
        { type: "step-start" },
        toolPart(
          AGENT_TOOL.APPLY_PATCH,
          "fixture-invites-review-patch",
          {
            patchText:
              "*** Begin Patch\n*** Update File: src/members/invite.ts\n*** Update File: src/pages/invite.tsx\n*** End Patch",
          },
          { output: "Done." },
        ),
        {
          type: "text",
          text: "An invite to someone already in the workspace now answers *Already a member* and mints no link, and the dialog reads **Invite sent** once it lands.",
        },
      ],
      startedAt: startedAt + 20 * MINUTE,
      finishedAt: startedAt + 24 * MINUTE,
    },
    asked(
      "fixture-invites-funnel-ask",
      startedAt + 40 * MINUTE,
      "How many invites are accepted? Show me the funnel from [Picture 1], and record accepting one.",
      reader,
      [INVITE_PAGE],
    ),
    {
      id: "fixture-invites-funnel",
      role: MESSAGE_ROLE.ASSISTANT,
      parts: [
        { type: "step-start" },
        toolPart(
          AGENT_TOOL.BASH,
          "fixture-invites-count",
          {
            command: "psql -c 'select status, count(*) from invites group by status'",
            description: "Count the invites by status",
          },
          {
            stdout:
              " status   | count\n----------+------\n sent     |   120\n accepted |    71\n expired  |     9",
            stderr: "",
            exitCode: 0,
          },
        ),
        toolPart(
          AGENT_TOOL.SHOW_PAGE,
          "fixture-invites-page",
          { title: FIXTURE_PAGE.title, path: "/vercel/sandbox/relay/funnel.html" },
          {
            status: "accepted",
            page: { id: FIXTURE_PAGE.id, version: FIXTURE_PAGE.version, title: FIXTURE_PAGE.title },
          },
        ),
        toolPart(
          AGENT_TOOL.BROWSER,
          "fixture-invites-browser",
          {
            steps: [
              { action: "record" },
              { action: "click", target: "Accept invite" },
              { action: "stop_recording", caption: "Accepting an invite" },
            ],
          },
          {
            steps: [
              { action: "record" },
              { action: "click" },
              {
                action: "stop_recording",
                caption: "Accepting an invite",
                picture: {
                  id: KEPT.RECORDING,
                  mediaType: CONVERSATION_MEDIA_TYPE.WEBM,
                  width: 320,
                  height: 180,
                  byteCount: 5120,
                },
              },
            ],
          },
        ),
        {
          type: "text",
          text: "71 of the 120 invites sent were accepted, and 9 expired. The funnel above has the rest, and the recording shows an invite accepted from its email.",
        },
      ],
      startedAt: startedAt + 40 * MINUTE,
      finishedAt: startedAt + 46 * MINUTE,
    },
    asked(
      "fixture-invites-teammate",
      startedAt + 60 * MINUTE,
      "The digest should count pending invites separately from members.",
      TEAMMATE,
    ),
    agentMessage(
      "fixture-invites-digest-message",
      startedAt + 62 * MINUTE,
      "I'm adding pending invites to the weekly digest. Does an invite keep its id when it's resent?",
    ),
    asked(
      "fixture-invites-resend-ask",
      startedAt + 70 * MINUTE,
      "Add a way to resend an invite that expired.",
      reader,
      [EXPIRED_INVITES],
    ),
    asked(
      "fixture-invites-resend-keep",
      startedAt + 71 * MINUTE,
      "Keep the old link working until the new one is sent.",
      reader,
    ),
    {
      id: "fixture-invites-resend",
      role: MESSAGE_ROLE.ASSISTANT,
      parts: [
        { type: "step-start" },
        {
          type: "text",
          // Note that a person's chip leads the reply's last line, so `person.yaml` holds it inside a message the agent page wraps in its own long-press menu.
          text: "A resend mints a fresh link and keeps the pending membership, so the member list doesn't change.\n\n[@Grace Hopper](https://vespin.dev/personal/person/user-grace) asked for it.",
        },
        toolPart(
          AGENT_TOOL.READ_FILE,
          "fixture-invites-resend-read",
          { filePath: "src/members/invite.ts" },
          { content: "export async function invite(…)" },
        ),
        toolPart(
          AGENT_TOOL.APPLY_PATCH,
          "fixture-invites-resend-patch",
          {
            patchText: "*** Begin Patch\n*** Update File: src/members/invite.ts\n*** End Patch",
          },
          { output: "Done." },
        ),
        runningPart(AGENT_TOOL.BASH, "fixture-invites-resend-test", {
          command: "pnpm test src/members",
          description: "Run the members tests",
        }),
      ],
      startedAt: startedAt + 70 * MINUTE,
    },
  ];
}

/**
 * The page older than the transcript's first, as a read below it answers:
 * the account's ask that came before the run, a day earlier, and the agent's
 * answer, which settled what an invite is before the work began.
 */
export function fixtureAgentOlderMessages(
  startedAt: number,
  reader: { readonly userId: string; readonly name: string },
): readonly AgentTranscriptMessage[] {
  const asking = startedAt - DAY;

  return [
    asked(
      "fixture-invites-plan-ask",
      asking,
      "Before you build anything: what does the description already settle about invites?",
      reader,
    ),
    {
      id: "fixture-invites-plan",
      role: MESSAGE_ROLE.ASSISTANT,
      parts: [
        { type: "step-start" },
        toolPart(
          AGENT_TOOL.READ_FILE,
          "fixture-invites-plan-read",
          { filePath: "docs/invites.md" },
          { content: "# Invites\n\nA member invites a teammate by email…" },
        ),
        {
          type: "text",
          text: "It settles three things: an invite is a **pending membership**, its link expires after seven days, and only an owner may invite.",
        },
      ],
      startedAt: asking,
      finishedAt: asking + 2 * MINUTE,
    },
  ];
}

/** The transcript as the host holds it once read, every turn caught up, the last still running. */
export function fixtureAgentTranscript(
  startedAt: number,
  reader: { readonly userId: string; readonly name: string },
  title: string,
): AppTranscript {
  return {
    messages: transcriptMessages(startedAt, reader),
    cursor: "3:0",
    word: { status: AGENT_STATUS.RUNNING, runStartedAt: startedAt, title, caughtUp: true },
    pages: 1,
  };
}

/**
 * The digest agent's transcript, its instants counted from `startedAt`: the
 * weekly digest automation's prompt, which began the run, and the agent's
 * turn on it, which reads its draft in Mail on the reader's Mac, still at
 * work on its last call there, so the page an automation's run opens draws
 * a transcript, and a computer call's row, icon, and window stand drawn.
 */
export function fixtureDigestTranscript(
  startedAt: number,
  reader: { readonly userId: string; readonly name: string },
  title: string,
): AppTranscript {
  const messages: readonly AgentTranscriptMessage[] = [
    asked(
      "fixture-digest-ask",
      startedAt,
      "Summarize what merged and what is still open this week, and post it to the team's digest.",
      reader,
    ),
    {
      id: "fixture-digest-work",
      role: MESSAGE_ROLE.ASSISTANT,
      parts: [
        { type: "step-start" },
        {
          type: "text",
          text: "Reading this week's merged pull requests before I write the digest.",
        },
        toolPart(
          AGENT_TOOL.BASH,
          "fixture-digest-merged",
          {
            command: "gh pr list --state merged --limit 50",
            description: "List this week's merged pull requests",
          },
          {
            stdout: "#131 Resend an expired invite\n#128 Invite a teammate by email",
            stderr: "",
            exitCode: 0,
          },
        ),
        { type: "text", text: "Checking the draft reads well in Mail before it goes out." },
        // Note that the read keeps the app's icon and its window, which a computer call's row wears and its body holds, and the click after it, still running, kept none, so its row wears the icon the read kept.
        toolPart(
          AGENT_TOOL.COMPUTER,
          "fixture-digest-mail-read",
          { action: "get_app_state", app: MAIL_APP.name },
          {
            status: "ran",
            app: { ...MAIL_APP, icon: { picture: keptIcon(KEPT.MAIL_ICON) } },
            window: { title: "Weekly digest — Draft" },
            elements: "1 button Send\n2 text field Subject: Weekly digest\n3 text area",
            truncated: false,
            kept: { picture: keptPicture(KEPT.MAIL_WINDOW) },
            machine: readerMac(reader),
          },
        ),
        runningPart(AGENT_TOOL.COMPUTER, "fixture-digest-mail-click", {
          action: "click",
          app: MAIL_APP.name,
          target: { element_index: 2 },
        }),
      ],
      startedAt: startedAt + MINUTE,
    },
  ];

  return {
    messages,
    cursor: "1:0",
    word: { status: AGENT_STATUS.RUNNING, runStartedAt: startedAt, title, caughtUp: true },
    pages: 1,
  };
}

/**
 * The release Manager's transcript, its instants counted from `startedAt`:
 * the account's ask, then a turn that thought, read a task, wrote words of
 * its own, and sent the account two messages (`send_to_user`), which its
 * page draws as its chat, the rest a press away under each message
 * (`@repo/features/manager-chat`).
 */
export function fixtureManagerTranscript(
  startedAt: number,
  reader: { readonly userId: string; readonly name: string },
  title: string,
): AppTranscript {
  const messages: readonly AgentTranscriptMessage[] = [
    asked(
      "fixture-manager-ask",
      startedAt,
      "Get the invitations work ready to ship this week, and tell me what's left.",
      reader,
    ),
    {
      id: "fixture-manager-turn",
      role: MESSAGE_ROLE.ASSISTANT,
      parts: [
        { type: "step-start" },
        {
          type: "reasoning",
          text: "Ada wants to know what stands between the invitations work and a release this week. The invitations agent opened its pull request an hour ago, so I'll check its checks and what the task still lists before I answer.",
        },
        { type: "text", text: "Reading the invitations task before I answer." },
        toolPart(
          AGENT_TOOL.READ_TASK,
          "fixture-manager-read-task",
          { taskId: "Teammate invitations" },
          { status: "accepted" },
        ),
        toolPart(
          AGENT_TOOL.SEND_TO_USER,
          "fixture-manager-said-plan",
          { text: "On it. The invitations agent has its pull request open and its tests pass." },
          { status: "accepted" },
        ),
        toolPart(
          AGENT_TOOL.SEND_TO_USER,
          "fixture-manager-said-left",
          {
            text: "Left before it ships: a Resend button on pending invites, and the audit log line. I'll tell you once both land.",
          },
          { status: "accepted" },
        ),
        {
          type: "reasoning",
          text: "Both items are small. I'll ask the invitations agent to take them on its branch and wake when its checks finish.",
        },
      ],
      startedAt: startedAt + MINUTE,
      finishedAt: startedAt + 4 * MINUTE,
    },
  ];

  return {
    messages,
    cursor: "1:0",
    word: { status: AGENT_STATUS.COMPLETED, runStartedAt: startedAt, title, caughtUp: true },
    pages: 1,
  };
}

/** The rounding agent's last words, which its page opens on. */
const FIXTURE_LONG_LATEST =
  "Rounding is settled: every total now rounds half-cents to even, as the bank's statements do.";

/** What the account asked the rounding agent, turn by turn, before its last turn: words long enough to wrap, a link no line holds, and a name with no break in it. */
const LONG_ASKS = [
  "Where do totals round today?",
  "Compare with https://ledger.example.com/statements/2026/11/reconciliation?account=operating-usd&view=line-items&rounding=half-even&include=adjustments,fees,refunds",
  "Does ROUNDING_MODE_HALF_EVEN_FOR_EVERY_LEDGER_TOTAL_AND_EVERY_INVOICE_LINE need a flag of its own?",
  "Show me the cases the tests cover, side by side.",
  "What does the invoice's tax line do with a half cent?",
  "Which reports read the rounded totals?",
  "Can the old totals be recomputed without a migration?",
  "Write down what changes for a customer reading their statement.",
  "Run the whole ledger suite once more.",
  "Anything left before this is settled?",
] as const;

/** What the rounding agent answered each ask, in Markdown as an agent writes: some of it a code block whose lines run long, and a table wider than a phone. */
const LONG_ANSWERS = [
  "Totals round in `src/ledger/total.ts`, half-cents **up**, through one helper every report shares. Invoices call the same helper per line, then sum, so an invoice can come out a cent off the ledger's own total.",
  "That statement rounds half-cents to even. Here is the helper as it stands:\n\n```ts\nexport function roundCents(amountInMillicents: number, mode: RoundingMode = ROUNDING_MODE.HALF_UP): number { return mode === ROUNDING_MODE.HALF_UP ? Math.floor(amountInMillicents / 10 + 0.5) : roundHalfEven(amountInMillicents / 10); }\n```\n\nSwitching the default to half-even matches the bank.",
  "No flag: the ledger has one rounding rule, and a flag would let two reports disagree again. The mode stays a parameter for the tests alone.",
  "| Amount | Half up | Half even | Bank | Invoice line | Ledger total |\n| --- | --- | --- | --- | --- | --- |\n| 0.125 | 0.13 | 0.12 | 0.12 | 0.13 | 0.12 |\n| 0.135 | 0.14 | 0.14 | 0.14 | 0.14 | 0.14 |\n| 2.675 | 2.68 | 2.68 | 2.68 | 2.68 | 2.68 |\n| 1.005 | 1.01 | 1.00 | 1.00 | 1.01 | 1.00 |",
  "It rounds per line, then sums, so three lines can come to a cent more than the tax on the total. Once tax rounds once on the total, the two agree.",
  "The monthly statement, the revenue report, and the customer export. All three read `total.ts`, so they move together.",
  "Yes. Totals are computed on read from the stored millicents, so nothing stored changes; only what a report shows does.",
  "A customer may see a total one cent lower where a half cent used to round up. No balance changes, since balances are kept unrounded.",
  "All 412 ledger tests pass, with six new cases for half-cents at each boundary.",
] as const;

/** The rounding agent's run, ten turns long and finished, its last words its last row: a transcript long enough that its page opens far below its first row, with long links, a wide code block, and a wide table among its words. */
export function fixtureLongTranscript(
  startedAt: number,
  reader: { readonly userId: string; readonly name: string },
  title: string,
): AppTranscript {
  const turns = LONG_ASKS.flatMap((ask, turn): readonly AgentTranscriptMessage[] => {
    const at = startedAt + turn * 6 * MINUTE;
    const answer = LONG_ANSWERS[turn] ?? FIXTURE_LONG_LATEST;

    return [
      asked(`fixture-rounding-ask-${turn}`, at, ask, reader),
      {
        id: `fixture-rounding-answer-${turn}`,
        role: MESSAGE_ROLE.ASSISTANT,
        parts: [{ type: "step-start" }, { type: "text", text: answer }],
        startedAt: at + MINUTE,
        finishedAt: at + 2 * MINUTE,
      },
    ];
  });

  return {
    messages: turns,
    cursor: `${turns.length}:0`,
    word: { status: AGENT_STATUS.COMPLETED, runStartedAt: startedAt, title, caughtUp: true },
    pages: 1,
  };
}

/** A picture or the recording the transcript names, by its id, as the host answers one read, the recording as its MP4 copy to a reader that plays MP4, as the service answers one it keeps a copy of; that it is not found for any other. */
export function fixtureAgentPicture(
  pictureId: string,
  playable: string | undefined,
): AgentInboxAttachmentView {
  if (pictureId === KEPT.DIALOG || pictureId === KEPT.EMAIL || pictureId === KEPT.MAIL_WINDOW) {
    return { contentType: AGENT_ATTACHMENT_TYPE.PNG, base64: FIXTURE_PICTURE_PNG };
  }

  if (pictureId === KEPT.MAIL_ICON) {
    return { contentType: AGENT_ATTACHMENT_TYPE.PNG, base64: FIXTURE_APP_ICON_PNG };
  }

  if (pictureId === KEPT.RECORDING) {
    return playable === MP4_TYPE
      ? { contentType: MP4_TYPE, base64: FIXTURE_VIDEO_MP4 }
      : { contentType: CONVERSATION_MEDIA_TYPE.WEBM, base64: FIXTURE_VIDEO_WEBM };
  }

  return { failure: AGENT_CALL_FAILURE.NOT_FOUND };
}
