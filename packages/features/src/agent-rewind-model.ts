/**
 * agent-rewind-model.ts -- where a coding agent's transcript may be taken back to, and what each rewind says: a line of a person's Edit, a reply's Rewind conversation to here, and the question each asks before it drops anything.
 *
 * Edit writes one of a person's lines again in its place: the send of the
 * new words takes the agent back to just before the line
 * (`AGENTS_MESSAGE`'s `rewinds`). Rewind conversation to here takes it back to
 * just after a reply (`AGENTS_REWIND`), dropping the next line that opened
 * a turn and everything after it. Each asks first where it drops anything,
 * naming another member's messages among what goes, and where the agent's
 * runner recorded the checkout before the turn, may put its files back too.
 * The panel's tab and the iOS app's agent page draw both from here.
 */

import { MESSAGE_ROLE } from "@repo/wire";
import { AGENT_SENDER, type AgentTranscriptMessage } from "./agent-wire.js";
import { commentLineOf, slackLineOf } from "./transcript-lines.js";
import { opensTurn, spokenLineOf } from "./voice-call-lines.js";
import { andList, countWords, type Noun } from "./words.js";

/** Which rewind a message offers: a line of the developer's its Edit, a reply its Rewind conversation to here. */
export const REWIND_ACTION = {
  EDIT: "edit",
  REVERT: "revert",
} as const;

export type RewindAction = (typeof REWIND_ACTION)[keyof typeof REWIND_ACTION];

/** What the actions say. */
export const REWIND_WORDS = {
  EDIT: "Edit",
  REVERT: "Rewind conversation to here",
} as const;

/** What a rewind counts the dropped messages of another member's in. */
const MESSAGE: Noun = { one: "message", many: "messages" };

/** What the choice to put the files back too says, on either rewind. */
export const RESTORE_FILES_WORDS = "Also restore the agent's files to this point";

/** The same choice where the box is too narrow for its words, at the Edit box's foot. */
export const RESTORE_FILES_SHORT_WORDS = "Restore the files too";

/** What a rewind says of the files where it puts them back too, after what it drops. */
const FILES_RESTORED_WORDS =
  "The agent's files also go back to how they were here; its commits, and anything pushed, stay as they are.";

/** What a rewind asks before it goes, in the words of its question: its title, what goes, its act, and its act while it runs. */
interface RewindAsk {
  readonly title: string;
  readonly body: string;
  readonly verb: string;
  readonly running: string;
}

/**
 * What Rewind conversation to here asks before it drops anything. Where `takes` names
 * another member's messages among those dropped, the body says so, and
 * where `restoring` the files go back too, it says that in place of their staying.
 */
export function revertAsk(takes: string | undefined, restoring: boolean): RewindAsk {
  const dropped = `Everything after it${takes === undefined ? "" : `, including ${takes},`} will be removed from the transcript, and the agent stopped if it is working.`;

  return {
    title: "Rewind conversation to this message?",
    body: restoring
      ? `${dropped} ${FILES_RESTORED_WORDS}`
      : `${dropped} Only the conversation goes back: changes the agent made to its files stay as they are.`,
    verb: restoring ? "Rewind conversation and files" : "Rewind conversation",
    running: "Rewinding",
  };
}

/** What the send of a line written again asks before it drops the messages after the line (`cuts`), or puts the files back. */
export function editSendAsk(
  takes: string | undefined,
  restoring: boolean,
  cuts: boolean,
): RewindAsk {
  const dropped = `Everything after it${takes === undefined ? "" : `, including ${takes},`} will be removed from the conversation, and the agent stopped if it is working.`;

  return {
    title: "Send the edited message?",
    body: !cuts
      ? `The agent is stopped if it is working. ${FILES_RESTORED_WORDS}`
      : restoring
        ? `${dropped} ${FILES_RESTORED_WORDS}`
        : `${dropped} Changes the agent made to its files stay as they are.`,
    verb: "Send message",
    running: "Sending",
  };
}

/** The kinds of sender whose lines are a person's: a member, and a member who has since left. */
const PERSON_SENDERS: ReadonlySet<string> = new Set([AGENT_SENDER.MEMBER, AGENT_SENDER.FORMER]);

/**
 * Whether a person wrote the line, the reader or a teammate, which Edit
 * writes again: no sender kept, as on a line from before senders were, or a
 * member's. The app from a call, an automation, GitHub, and another agent write
 * lines no person said, which Rewind conversation to here still drops.
 */
function writtenByPerson(message: AgentTranscriptMessage): boolean {
  const sender = message.sentBy;

  if (sender === undefined) return true;

  return sender.agent !== true && (sender.kind === undefined || PERSON_SENDERS.has(sender.kind));
}

/** Another member's messages among those a rewind drops, counted by who sent them. */
type Takes = { userId: string | undefined; name: string; count: number }[];

/**
 * Whether another member than the reader wrote the line: a person's, with
 * the reader's own account left out as `lineSender` leaves it out. A member
 * with no account id still stands by their name.
 */
function writtenByOther(message: AgentTranscriptMessage, readerId: string | undefined): boolean {
  const sender = message.sentBy;

  if (sender === undefined || !writtenByPerson(message)) return false;

  return sender.userId === undefined || (readerId !== undefined && sender.userId !== readerId);
}

/** Counts one more of a member's messages in `takes`, a sender met later standing first because the transcript is read from its end. */
function tally(takes: Takes, sender: NonNullable<AgentTranscriptMessage["sentBy"]>): void {
  const found = takes.find((each) => each.userId === sender.userId && each.name === sender.name);

  if (found === undefined) takes.unshift({ userId: sender.userId, name: sender.name, count: 1 });
  else found.count += 1;
}

/** What `takes` says of whose messages go: "2 messages from Sam", or none where none are another member's. */
function takesWords(takes: Takes): string | undefined {
  if (takes.length === 0) return undefined;

  return andList(takes.map((each) => `${countWords(each.count, MESSAGE)} from ${each.name}`));
}

type RewindPoints = {
  readonly editable: ReadonlySet<string>;
  readonly revertsAt: ReadonlyMap<string, string>;
  readonly followed: ReadonlySet<string>;
  readonly revertTakes: ReadonlyMap<string, string>;
  readonly editTakes: ReadonlyMap<string, string>;
  readonly restorable: ReadonlySet<string>;
};

/**
 * Where a transcript's rewinds land: the lines a person wrote that opened a
 * turn, the first included, each one Edit may write again, and, for each
 * reply, the next line that opened a turn, whoever sent it, which its Revert
 * to here drops from. Note that a description the agent was handed is drawn as its
 * card, which offers no Edit, so only a first line drawn as a bubble is
 * written again. Every message but the last is followed by one, which a
 * rewind to just before it drops, and so is the last while lines sent and not
 * yet read back (`pending`) stand after it, since the rewind drops those too.
 * A line whose send has not answered yet (`going`, by the id it was written
 * under) is neither written again nor reverted to, because the service may
 * still withdraw its row, and a rewind waiting behind that send would then
 * find no line. Where a rewind drops messages another member than the reader
 * (`readerId`) wrote, the points say whose and how many, for the confirm to
 * name. A line that opened a turn whose checkout its runner recorded
 * (`filesRestorable`) is one the files can go back at, where the files go
 * back at all (`restores`): the agent's workspace has the experiment on.
 */
export function rewindPoints(
  messages: readonly AgentTranscriptMessage[],
  pending: boolean,
  readerId: string | undefined,
  going: ReadonlySet<string> = new Set(),
  restores = false,
): RewindPoints {
  const editable = new Set<string>();
  const revertsAt = new Map<string, string>();
  const revertTakes = new Map<string, string>();
  const editTakes = new Map<string, string>();
  const restorable = new Set<string>();

  const followed = new Set(
    (pending ? messages : messages.slice(0, -1)).map((message) => message.id),
  );

  // What a rewind to just before each line that opened a turn drops of other members' messages.
  const takenFrom = new Map<string, string>();
  const takes: Takes = [];
  let next: string | undefined;

  // Read from the end, so each reply finds the opening line nearest after it.
  for (let at = messages.length - 1; at >= 0; at -= 1) {
    const message = messages[at];

    if (message === undefined) continue;

    if (message.role !== MESSAGE_ROLE.USER) {
      if (next === undefined) continue;
      revertsAt.set(message.id, next);
      const dropped = takenFrom.get(next);

      if (dropped !== undefined) revertTakes.set(message.id, dropped);
      continue;
    }

    // Note that a line said on a call opens a turn only where a delegation handed it on, so small talk is no place to cut at.
    const opens = message.arrivedIn === undefined && opensTurn(message);
    const answered = message.clientId === undefined || !going.has(message.clientId);

    // Note that an edit drops what follows the line, so its words are read before the line itself is counted.
    if (opens && answered && writtenByPerson(message)) {
      editable.add(message.id);
      const after = takesWords(takes);

      if (after !== undefined) editTakes.set(message.id, after);
    }

    if (message.sentBy !== undefined && writtenByOther(message, readerId)) {
      tally(takes, message.sentBy);
    }

    if (!opens) continue;

    if (restores && answered && message.filesRestorable === true) restorable.add(message.id);
    const from = takesWords(takes);

    if (from !== undefined) takenFrom.set(message.id, from);
    next = answered ? message.id : undefined;
  }

  return { editable, revertsAt, followed, revertTakes, editTakes, restorable };
}

/**
 * Whether a person's line offers Edit by what it is, beside where it stands
 * (`rewindPoints`' `editable`): never on a comment's or a Slack message's
 * line, drawn from what it carries rather than its words, as GitHub's is
 * not; never on a line said aloud on a call, which stands as it was said;
 * and never on files alone, the line's words as drawn (`shown`) empty.
 */
export function editsInPlace(message: AgentTranscriptMessage, shown: string): boolean {
  return (
    shown !== "" &&
    commentLineOf(message) === undefined &&
    slackLineOf(message) === undefined &&
    spokenLineOf(message) === undefined
  );
}

/** Whether two sets hold the same members. */
function sameMembers(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return a.size === b.size && [...a].every((member) => b.has(member));
}

/** Whether two maps hold the same entries. */
function sameEntries(a: ReadonlyMap<string, string>, b: ReadonlyMap<string, string>): boolean {
  return a.size === b.size && [...a].every(([key, value]) => b.get(key) === value);
}

/** Whether two readings of a transcript's rewinds land in the same places, so a reader built on one stands for the other, as a turn that moves without a line or a reply landing leaves them. */
export function sameRewindPoints(a: RewindPoints, b: RewindPoints): boolean {
  return (
    sameMembers(a.editable, b.editable) &&
    sameEntries(a.revertsAt, b.revertsAt) &&
    sameMembers(a.followed, b.followed) &&
    sameEntries(a.revertTakes, b.revertTakes) &&
    sameEntries(a.editTakes, b.editTakes) &&
    sameMembers(a.restorable, b.restorable)
  );
}
