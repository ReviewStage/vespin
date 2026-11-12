/**
 * fixture-agent-transcript.ts -- the transcript the Inbox fixture's invitations agent holds, long enough to scroll: its words, its thinking, its calls, the pictures and the recording it showed, the page it showed, and the pull request it opened, still at work on its last turn.
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
  AGENT_SENDER,
  AGENT_STATUS,
  type AgentTranscriptMessage,
} from "@repo/features/agent-wire";
import { CONVERSATION_MEDIA_TYPE } from "@repo/features/conversation-picture-wire";
import { MP4_TYPE } from "@repo/features/video-signature";
import { MESSAGE_ROLE, type WireRecord } from "@repo/wire";
import type { AppTranscript } from "./app-state.js";
import {
  FIXTURE_PICTURE_PNG,
  FIXTURE_VIDEO_MP4,
  FIXTURE_VIDEO_WEBM,
} from "./fixture-inbox-media.js";
import { FIXTURE_PAGE } from "./fixture-stage.js";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/** The pictures and the recording the agent showed, by the ids the service kept them under. */
const KEPT = {
  DIALOG: "fixture-picture-invite-dialog",
  EMAIL: "fixture-picture-invite-email",
  RECORDING: "fixture-recording-accept",
} as const;

/** The fixture's picture as the service keeps one: a screenshot-sized PNG. */
function keptPicture(id: string): WireRecord {
  return { id, mediaType: AGENT_ATTACHMENT_TYPE.PNG, width: 320, height: 180, byteCount: 7549 };
}

/** A tool's call as the transcript stores it, answered. */
function toolPart(tool: string, callId: string, input: WireRecord, output: WireRecord): WireRecord {
  return { type: `tool-${tool}`, toolCallId: callId, state: "output-available", input, output };
}

/** A tool's call as the transcript stores it while it still runs. */
function runningPart(tool: string, callId: string, input: WireRecord): WireRecord {
  return { type: `tool-${tool}`, toolCallId: callId, state: "input-available", input };
}

/** The account's line asking for a turn, `at` milliseconds into the run. */
function asked(
  id: string,
  at: number,
  text: string,
  sender: { readonly userId: string; readonly name: string },
): AgentTranscriptMessage {
  return {
    id,
    role: MESSAGE_ROLE.USER,
    parts: [{ type: "text", text }],
    sentAt: at,
    sentBy: { kind: AGENT_SENDER.MEMBER, userId: sender.userId, name: sender.name },
  };
}

/**
 * The transcript, its instants counted from `startedAt`, its turns written
 * by `reader`, the account the fixture signs in as: the ask that began the
 * run and the agent's work on it, the dialog and its email shown and its
 * pull request opened; a second
 * ask, answered with the funnel's page and a recording of an invite
 * accepted; and a third the agent is still working on, its last call
 * running.
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
          AGENT_TOOL.SHOW_IMAGE,
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
    asked(
      "fixture-invites-funnel-ask",
      startedAt + 40 * MINUTE,
      "How many invites are accepted? Show me the funnel, and record accepting one.",
      reader,
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
      "fixture-invites-resend-ask",
      startedAt + 70 * MINUTE,
      "Add a way to resend an invite that expired.",
      reader,
    ),
    {
      id: "fixture-invites-resend",
      role: MESSAGE_ROLE.ASSISTANT,
      parts: [
        { type: "step-start" },
        {
          type: "text",
          text: "A resend mints a fresh link and keeps the pending membership, so the member list doesn't change.",
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

/** A picture or the recording the transcript names, by its id, as the host answers one read, the recording as its MP4 copy to a reader that plays MP4, as the service answers one it keeps a copy of; that it is not found for any other. */
export function fixtureAgentPicture(
  pictureId: string,
  playable: string | undefined,
): AgentInboxAttachmentView {
  if (pictureId === KEPT.DIALOG || pictureId === KEPT.EMAIL) {
    return { contentType: AGENT_ATTACHMENT_TYPE.PNG, base64: FIXTURE_PICTURE_PNG };
  }

  if (pictureId === KEPT.RECORDING) {
    return playable === MP4_TYPE
      ? { contentType: MP4_TYPE, base64: FIXTURE_VIDEO_MP4 }
      : { contentType: CONVERSATION_MEDIA_TYPE.WEBM, base64: FIXTURE_VIDEO_WEBM };
  }

  return { failure: AGENT_CALL_FAILURE.NOT_FOUND };
}
