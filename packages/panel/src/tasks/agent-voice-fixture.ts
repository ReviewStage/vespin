/**
 * agent-voice-fixture.ts -- the calls a fixture run's voice profiles stage into the agent: both speakers' lines, the turns they handed the agent, and a caller's line growing as it is said.
 *
 * The agent profiles' agent (`agent-fixture.ts`) ran one turn. Under the
 * voice profiles it was called after it, as the service stores a call
 * (`writer.ts`'s `recordVoiceLine`): the caller's lines as user rows the
 * member sent and the voice's as rows the voice model wrote, each on the
 * voice channel and naming its call, and a caller's line a delegation handed
 * the agent naming the delegation too. Every edge a call leaves in the
 * transcript stands in one of them:
 *
 * - The settled profile holds the member's call: an ask the voice handed
 *   on, the turn it opened, small talk the voice answered itself while the
 *   turn ran, and the voice retelling its reply; the voice cut off
 *   mid-sentence; a long ask said over pauses as three lines; a line typed
 *   into the turn the call opened; a line edited in the queue, whose edit
 *   was handed on while the line as said stands; and a hand-over that
 *   failed, its line standing as said. A teammate's call into the agent
 *   follows it.
 * - The live profile holds a call under way while the agent works: an ask
 *   handed on while the turn runs, awaiting it, and the caller's line
 *   growing a word at a time while the tab holds the transcript
 *   (`voiceLiveHold`).
 *
 * Every name and line here is invented.
 */

import { AsyncIteratorClass } from "@orpc/client";
import { AGENT_SENDER, AGENT_STATUS, type AgentTranscriptMessage } from "@repo/features/agent-wire";
import type { AppTranscript } from "@repo/host/app-state";
import { MESSAGE_AUTHOR, MESSAGE_CHANNEL, MESSAGE_ROLE, type WireRecord } from "@repo/wire";
import { rendererPause } from "../renderer-runtime.js";
import { fixtureMoved } from "./fixture-moves.js";

const SECOND = 1_000;
const MINUTE = 60 * SECOND;

/** The calls, by the ids their clients minted for them. */
const CALL = {
  OWN: "3f1a7c2e-5b9d-4e6f-8a0c-2d4f6b8e0a1c",
  TEAMMATE: "4a2b8d3f-6c0e-4f7a-9b1d-3e5a7c9f1b2d",
  LIVE: "5b3c9e4a-7d1f-4a8b-8c2e-4f6b8d0a2c3e",
} as const;

/** The teammate who called the agent too. */
const GRACE = { userId: "8b2d4f6a-0c3e-4a5b-9d1f-2a4c6e8b0d3f", name: "Grace Hopper" } as const;

/** How fast the live profile's caller speaks: one word every this many milliseconds. */
const WORD_MS = 450;

/** How long a line takes to say, at a speaker's pace: this many milliseconds a word. */
const SPOKEN_WORD_MS = 380;

/** When into its call a line said from `fromMs` began and ended, as the service keeps them (`from_ms`, `to_ms`). */
function spokenTimes(fromMs: number, text: string): WireRecord {
  return { from_ms: fromMs, to_ms: fromMs + text.split(" ").length * SPOKEN_WORD_MS };
}

/** What the live profile's caller is saying, a word at a time. */
const GROWING_WORDS =
  "Oh, and while it's in there, make the reminder email say who sent the invite and how many days are left on it".split(
    " ",
  );

/** A line's words as one text part. */
function said(text: string): AgentTranscriptMessage["parts"] {
  return [{ type: "text", text }];
}

/** A line the caller said on `call` at `at`, `fromMs` into it, handed to the agent where `delegation` names the hand-over. */
function callerLine(input: {
  readonly id: string;
  readonly call: string;
  readonly at: number;
  readonly fromMs: number;
  readonly text: string;
  readonly delegation?: string;
  readonly teammate?: true;
  readonly arrivedIn?: AgentTranscriptMessage["arrivedIn"];
}): AgentTranscriptMessage {
  const metadata: WireRecord = {
    author: MESSAGE_AUTHOR.DEVELOPER,
    channel: MESSAGE_CHANNEL.VOICE,
    voice_session_id: input.call,
    ...spokenTimes(input.fromMs, input.text),
    ...(input.delegation === undefined ? undefined : { delegation_id: input.delegation }),
  };

  return {
    id: input.id,
    role: MESSAGE_ROLE.USER,
    parts: said(input.text),
    metadata,
    sentAt: input.at,
    ...(input.teammate === undefined
      ? undefined
      : { sentBy: { kind: AGENT_SENDER.MEMBER, userId: GRACE.userId, name: GRACE.name } }),
    ...(input.arrivedIn === undefined ? undefined : { arrivedIn: input.arrivedIn }),
  };
}

/** A line the voice said on `call` at `at`, `fromMs` into it. */
function voiceLine(
  id: string,
  call: string,
  at: number,
  fromMs: number,
  text: string,
): AgentTranscriptMessage {
  return {
    id,
    role: MESSAGE_ROLE.ASSISTANT,
    parts: said(text),
    metadata: {
      author: MESSAGE_AUTHOR.VOICE_MODEL,
      channel: MESSAGE_CHANNEL.VOICE,
      voice_session_id: call,
      ...spokenTimes(fromMs, text),
    },
    sentAt: at,
  };
}

/** A tool's call as the transcript stores it, answered. */
function toolPart(tool: string, callId: string, input: WireRecord, output: WireRecord) {
  return { type: `tool-${tool}`, toolCallId: callId, state: "output-available", input, output };
}

/** A turn's journal from `at`, its parts each a step, finished two minutes on unless `running`. */
function journal(
  id: string,
  at: number,
  parts: AgentTranscriptMessage["parts"],
  running = false,
): AgentTranscriptMessage {
  return {
    id,
    role: MESSAGE_ROLE.ASSISTANT,
    parts: parts.flatMap((part) => [{ type: "step-start" }, part]),
    startedAt: at,
    ...(running ? undefined : { finishedAt: at + 2 * MINUTE }),
  };
}

/** A patch the agent applied to `file`. */
function patch(id: string, file: string, from: string, to: string) {
  return toolPart(
    "apply_patch",
    id,
    { patchText: `*** Begin Patch\n*** Update File: ${file}\n@@\n-${from}\n+${to}\n*** End Patch` },
    { output: "Done." },
  );
}

/** The members tests, passing. */
function tests(id: string) {
  return toolPart(
    "bash",
    id,
    { command: "pnpm test src/members", description: "Run the members tests" },
    {
      stdout: " ✓ src/members/invite.test.ts (2 tests)\n\n Tests  2 passed",
      stderr: "",
      exitCode: 0,
    },
  );
}

/**
 * The member's call into the agent from `at`, and a teammate's after it:
 * every edge a settled call leaves in the transcript, in the order said.
 */
function settledCalls(at: number): readonly AgentTranscriptMessage[] {
  const own = (id: string, offset: number, text: string, delegation?: string) =>
    callerLine({
      id,
      call: CALL.OWN,
      at: at + offset,
      fromMs: offset,
      text,
      ...(delegation === undefined ? undefined : { delegation }),
    });

  const voice = (id: string, offset: number, text: string) =>
    voiceLine(id, CALL.OWN, at + offset, offset, text);

  const expiry = journal("voice-turn-expiry", at + 12 * SECOND, [
    patch(
      "voice-expiry-patch",
      "src/members/invite.ts",
      "export const INVITE_TTL_DAYS = 7;",
      "export const INVITE_TTL_DAYS = 3;",
    ),
    tests("voice-expiry-test"),
    { type: "text", text: "An invite now expires after three days. The members tests pass." },
  ]);

  const expiredPage = journal("voice-turn-expired-page", at + 3 * MINUTE + 20 * SECOND, [
    patch(
      "voice-expired-patch",
      "src/pages/invite.tsx",
      "<Button>Back to sign in</Button>",
      "<Button onClick={askAgain}>Ask for a new invite</Button>",
    ),
    patch(
      "voice-expired-mail",
      "src/members/invite-mail.ts",
      "to: workspace.owner.email,",
      "to: invite.invitedBy.email,",
    ),
    tests("voice-expired-test"),
    {
      type: "text",
      text: "The expired page's button reads **Ask for a new invite** now, and pressing it emails whoever sent the first invite, by name.",
    },
  ]);

  const rename = journal("voice-turn-rename", at + 6 * MINUTE + 10 * SECOND, [
    patch(
      "voice-rename-patch",
      "src/members/invite.ts",
      "export const INVITE_TTL_DAYS = 3;",
      "export const inviteTtlDays = 3;",
    ),
    { type: "text", text: "Renamed the setting to `inviteTtlDays` everywhere it's read." },
  ]);

  return [
    // A plain exchange: the ask handed on, the turn it opened, folded since the voice retells it.
    own(
      "voice-ask-expiry",
      0,
      "Can you make the invite expire after three days instead of seven?",
      "delegation-expiry",
    ),
    voice("voice-ack-expiry", 4 * SECOND, "Sure, I'll ask the agent to change that."),
    expiry,
    // Small talk while the turn runs, which the voice answers itself, standing after the turn as stored.
    own("voice-small-talk", 30 * SECOND, "While it works: is the pull request still green?"),
    voice("voice-small-talk-answer", 33 * SECOND, "It is. Two approvals, and every check passed."),
    // Then the voice retelling the turn's reply.
    voice(
      "voice-retell-expiry",
      2 * MINUTE + 20 * SECOND,
      "Done. Invites now expire after three days, and the tests pass.",
    ),
    // The voice cut off mid-sentence by the caller.
    voice(
      "voice-cut-off",
      2 * MINUTE + 34 * SECOND,
      "Anything else, or should I leave it to the merge queue, which should reach it in",
    ),
    // A long ask said over pauses, as three lines, handed on together.
    own(
      "voice-monologue-1",
      2 * MINUTE + 41 * SECOND,
      "Sorry, one more thing on the expired page.",
      "delegation-page",
    ),
    own(
      "voice-monologue-2",
      2 * MINUTE + 47 * SECOND,
      "The button should say ask for a new invite,",
      "delegation-page",
    ),
    own(
      "voice-monologue-3",
      2 * MINUTE + 55 * SECOND,
      "and it should email whoever sent the first invite, not the workspace owner.",
      "delegation-page",
    ),
    voice("voice-ack-page", 3 * MINUTE + SECOND, "Got it. Passing that on."),
    expiredPage,
    // A line typed during the call, which the turn the call opened took in under way.
    {
      id: "voice-typed",
      role: MESSAGE_ROLE.USER,
      parts: said("Use the inviter's name in that email, not their address."),
      sentAt: at + 3 * MINUTE + 50 * SECOND,
      arrivedIn: { journalId: expiredPage.id, afterStep: 2 },
    },
    voice(
      "voice-retell-page",
      5 * MINUTE + 25 * SECOND,
      "That's in. The expired page asks for a new invite, and the email goes to whoever sent the first one, by name.",
    ),
    // A line edited in the queue: the line as said stands, and its edit was handed on as a line of its own.
    own("voice-edited-said", 5 * MINUTE + 40 * SECOND, "Rename the flag to invite TTL days."),
    own(
      "voice-edited-sent",
      6 * MINUTE + 5 * SECOND,
      "Rename the setting to inviteTtlDays.",
      "delegation-rename",
    ),
    rename,
    voice("voice-retell-rename", 8 * MINUTE + 15 * SECOND, "Renamed. It's inviteTtlDays now."),
    // A hand-over that failed: the line stands as said, sent to no one.
    own("voice-failed", 8 * MINUTE + 30 * SECOND, "And bump the version in the changelog."),
    voice(
      "voice-failed-said",
      8 * MINUTE + 36 * SECOND,
      "I couldn't reach the agent just now, so that didn't go through. Want me to try again?",
    ),
    own("voice-failed-leave", 8 * MINUTE + 42 * SECOND, "No, leave it. Thanks, bye."),
    voice("voice-bye", 8 * MINUTE + 45 * SECOND, "Bye!"),
    // A teammate's call into the same agent, an hour on.
    callerLine({
      id: "voice-teammate-ask",
      call: CALL.TEAMMATE,
      at: at + 70 * MINUTE,
      fromMs: 2 * SECOND,
      text: "Is the invite email actually going out yet?",
      teammate: true,
    }),
    voiceLine(
      "voice-teammate-answer",
      CALL.TEAMMATE,
      at + 70 * MINUTE + 5 * SECOND,
      7 * SECOND,
      "Not yet. The agent only writes it to the log for now; wiring it up is the first follow-up in its last reply.",
    ),
    callerLine({
      id: "voice-teammate-thanks",
      call: CALL.TEAMMATE,
      at: at + 71 * MINUTE + 2 * SECOND,
      fromMs: 64 * SECOND,
      text: "Okay, thanks.",
      teammate: true,
    }),
  ];
}

/** The settled profile's transcript: the agent's turn, then the calls into it after. */
export function voiceTranscript(base: AppTranscript, at: number): AppTranscript {
  return { ...base, messages: [...base.messages, ...settledCalls(at)] };
}

/** How many of the growing line's words the live profile's caller has said so far, which the holds on its transcript move on. */
let spoken = 1;

/** The holds open on the live transcript, the first opened first: the one that speaks on. */
const holds = new Set<object>();

/** The live transcript at the word it last reached, so a document staged again at it holds the very one. */
let staged:
  | { readonly spoken: number; readonly base: AppTranscript; readonly transcript: AppTranscript }
  | undefined;

/**
 * The live profile's transcript: the agent's turn, then a call under way
 * from `at` while a turn it opened runs, a second ask handed on to that turn
 * and awaiting it, and the caller's newest line as far as they have said it.
 */
export function voiceLiveTranscript(base: AppTranscript, at: number): AppTranscript {
  if (staged?.spoken === spoken && staged.base === base) return staged.transcript;

  const turn = journal(
    "voice-live-turn",
    at + 6 * SECOND,
    [
      toolPart(
        "read_file",
        "voice-live-read",
        { filePath: "src/members/invite.ts" },
        { content: "export const INVITE_TTL_DAYS = 7;" },
      ),
      patch(
        "voice-live-patch",
        "src/members/invite.ts",
        "export const INVITE_TTL_DAYS = 7;",
        "export const INVITE_TTL_DAYS = 3;",
      ),
    ],
    true,
  );

  const transcript: AppTranscript = {
    ...base,
    messages: [
      ...base.messages,
      callerLine({
        id: "voice-live-ask",
        call: CALL.LIVE,
        at,
        fromMs: SECOND,
        text: "Make the invite expire after three days instead of seven.",
        delegation: "delegation-live-expiry",
      }),
      voiceLine(
        "voice-live-ack",
        CALL.LIVE,
        at + 3 * SECOND,
        4 * SECOND,
        "On it. I've asked the agent.",
      ),
      turn,
      // An ask handed on while the turn runs, awaiting it, standing where it was said.
      callerLine({
        id: "voice-live-queued",
        call: CALL.LIVE,
        at: at + 40 * SECOND,
        fromMs: 41 * SECOND,
        text: "And send a reminder the day before it expires.",
        delegation: "delegation-live-reminder",
      }),
      voiceLine(
        "voice-live-queued-ack",
        CALL.LIVE,
        at + 44 * SECOND,
        45 * SECOND,
        "Added that to what it's doing.",
      ),
      callerLine({
        id: "voice-live-growing",
        call: CALL.LIVE,
        at: at + 52 * SECOND,
        fromMs: 53 * SECOND,
        text: GROWING_WORDS.slice(0, spoken).join(" "),
      }),
    ],
    word: {
      status: AGENT_STATUS.RUNNING,
      runStartedAt: at + 6 * SECOND,
      title: base.word?.title ?? "Add teammate invitations",
      caughtUp: true,
    },
  };

  staged = { spoken, base, transcript };

  return transcript;
}

/**
 * The live transcript's hold, as main holds a running agent's for its tab:
 * the caller's growing line a word longer every `WORD_MS` until it is
 * whole, the window's document staged again on each
 * (`fixture-moves.ts`), until the tab lets it go. The hold opened first
 * among those open speaks on, so two tabs holding it speak no faster than
 * one.
 */
export function voiceLiveHold(): AsyncIteratorClass<never, void> {
  const hold = {};
  let closed = false;

  return new AsyncIteratorClass<never, void>(
    async () => {
      if (!closed) holds.add(hold);

      while (!closed) {
        await rendererPause(WORD_MS);

        if (closed || holds.values().next().value !== hold || spoken >= GROWING_WORDS.length) {
          continue;
        }

        spoken += 1;
        fixtureMoved();
      }

      return { done: true, value: undefined };
    },
    async () => {
      closed = true;
      holds.delete(hold);
    },
  );
}
