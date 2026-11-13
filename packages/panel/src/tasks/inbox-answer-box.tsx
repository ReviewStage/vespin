import type { AgentAttachment, AgentSummary } from "@repo/features/agent-wire";
import { INBOX_BOX_WORDS, type InboxMissing, missingWords } from "@repo/features/inbox-ask-words";
import { type InboxDraft, inboxMissing, inboxThreadSend } from "@repo/features/inbox-draft";
import { acknowledgedOnOpen, awaitsNod } from "@repo/features/inbox-list-model";
import { INBOX_BOUNDS, type InboxItem, type InboxMessage } from "@repo/features/inbox-wire";
import { FAILURE_CONDITION, FAILURE_SURFACE } from "@repo/features/shown-failure";
import { Checkbox, type ComposerNote, STATUS_TONE } from "@repo/ui";
import { ACTION_RESULT_STATUS, type ActionResult } from "@repo/wire";
import { type ReactNode, type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { useConnected } from "../connection.js";
import { failureShown } from "../failure-report.js";
import { useToast } from "../toast.js";
import { useAgentBox } from "./agent-box.js";
import { AgentComposer } from "./agent-composer.js";
import { useInboxAcknowledger } from "./inbox-acknowledge.js";
import { focusMissing } from "./inbox-ask-controls.js";
import { inboxNoteReading } from "./inbox-model.js";
import { ReplyToSelection } from "./reply-to-selection.js";
import type { SkillSource } from "./skill-picker.js";
import type { AgentComposerControl } from "./use-agent-composer.js";
import type { AgentsControl } from "./use-agents.js";
import type { TaskInboxControl } from "./use-task-inbox.js";

/**
 * inbox-answer-box.tsx -- the box at the end of every Inbox item's thread, the reader's draft reply: the agent's own message box, writing to the item's agent, with the open question's controls as its body while one waits.
 *
 * The box is the agent composer (`agent-composer.tsx`), drawn as an agent's
 * tab draws it under the transcript, for the agent that wrote the thread,
 * and handed what it reads off that agent by the same hook the tab reads it
 * through (`agent-box.tsx`'s `useAgentBox`): its + menu attaches files and
 * switches that agent's MCP servers, its model chip changes what the agent
 * runs on and its permission mode for its next step, the chips after the +
 * say where it runs and what it forwards, the line over the field says a
 * send denies a tool call waiting, and its microphone, `@` and `/` lists,
 * and the ⋯ a narrow card folds them into are the agent box's, so the two
 * boxes read and fold alike. What the tab reads off the agent's transcript,
 * its context ring, cost, and payer, does not stand here, since a thread
 * reads no transcript; nor Queue and Steer, since an item's replies go one
 * at a time in their own order (`use-task-inbox.ts`) rather than on the
 * agent's queue; nor the `/` list's session commands (`/clear`,
 * `/compact`), since a reply reaches the agent wrapped as a thread's
 * message, which the harness reads as words rather than a command, though
 * `/model` opens the model chip's menu as it does in the agent's box. What stands docked over an
 * agent's box, its to-do list, its pull request, its threads, and its queue,
 * does not stand here, because a thread is no transcript and need be about no
 * pull request, and the thread's crumbs already name the agent and its task.
 * Nor does Stop: a send while the agent works steers it, as the agent's box
 * does, but an empty box's Send stays Send.
 *
 * While a question waits, its controls (`inbox-pane.tsx`) are the card's
 * body over the field, with no card, border, or head of their own, since
 * the agent's message says what it asks: an ask's options, steps and
 * presses, or fields, each numbered and pressed as before. The field then
 * asks to "Add a note"; where no controls stand, an ask of words alone, a
 * notice, or a settled item, it asks for a "Reply", the words of which
 * answer an ask of words alone (`inbox-model.ts`'s `attachedAnswers`). The
 * note goes to the agent as it was written, links and all.
 *
 * Send lights once the box holds something to send, a pick, a tick, a field
 * filled, words, or files. While a question's answer is unfinished, Send
 * still stands held but takes a press (`aria-disabled`), and a press or
 * Enter takes the keyboard to what the answer lacks, the option, the field,
 * or the line, and says what that is under the foot's bar ("Fill in
 * Host."), until it is filled. A notice waiting on the reader's nod reads
 * Got it on Send while the box is empty, which settles it without messaging
 * the agent, held behind a toast whose Undo has it wait again
 * (`inbox-acknowledge.tsx`), and is the round Send
 * again once a word or a file is in. A notice opening acknowledges
 * (`inbox-model.ts`'s `acknowledgedOnOpen`, `use-inbox-read-marks.ts`'s
 * `useNodOnOpen`) offers no Got it, since opening it was the nod. Unlike
 * the agent's box, the field never takes the caret as an item opens,
 * because K and J step the list and the number keys pick while the caret
 * is elsewhere.
 *
 * Words selected in the thread over the box and answered with Reply are
 * laid into the box as a quote block where the caret stands, as the agent's
 * tab lays them into its box (`reply-to-selection.tsx`), and the thread is
 * told (`onQuoted`), which scrolls to its end so the whole box stands in
 * view; the pages the thread draws lay their quotes in through the same door.
 *
 * A reply leaves the box the moment it is sent and never holds it, as a
 * message leaves the agent's box: an item's replies go one at a time in the
 * order sent (`use-task-inbox.ts`), each standing on the thread meanwhile.
 * Only Got it and Start thread hold the box, Send busy, until they go,
 * since each settles or opens something: Got it waits behind the item's
 * replies on their way, then draws the notice settled, its Undo on a toast. A
 * reply that did not go never comes back into the box: it stands on the
 * thread marked Not delivered (`use-task-inbox.ts`), and why a refused one
 * did not go is said under the foot's bar over the box's own notes; one
 * refused because the agent is archived says so, with Unarchive after it,
 * which brings the agent back and lets the note go.
 * Once the item is settled, answered or taken back, the same box writes a
 * message on its thread, which reaches the agent and leaves the item where
 * it stands.
 *
 * Where the page offers it, a checkbox under the card turns the next send
 * into a new thread rather than a reply: "Send as a new thread to" and the
 * item's agent's chip. Ticked, the line asks to start a thread and Send
 * reads "Start thread"; the words and files go as the thread's first
 * message, its first line standing for its title, and the box unticks once
 * the start answers, so the next send is a reply again. A start that did not
 * go never comes back into the box: it stands on the thread marked Not
 * delivered, as a reply that did not go does. Ticked under an
 * open question, the question's controls step aside, since nothing picked
 * there goes with the thread, and come back as they were once it is
 * unticked or the thread is started.
 */

/** Whether the box holds neither words nor files. */
function emptyBox(draft: InboxDraft): boolean {
  return draft.note.trim() === "" && draft.attachments.length === 0;
}

/** What the press after an archived agent's note says. */
const UNARCHIVE = "Unarchive";

/** The checkbox under the card that turns the next send into a new thread, to the agent's chip. */
function NewThreadChoice({
  offer,
  checked,
  held,
  onChange,
}: {
  offer: AnswerNewThread;
  checked: boolean;
  /** Whether a nod or a thread start is out, which nothing changes until it lands; a reply on its way holds nothing. */
  held: boolean;
  onChange: (checked: boolean) => void;
}): React.JSX.Element {
  return (
    <div className="inbox-new-thread flex min-w-0 pt-ui-8 pl-ui-4 text-muted-foreground">
      <Checkbox checked={checked} disabled={held} onChange={onChange}>
        {INBOX_BOX_WORDS.SEND_AS_NEW} {offer.agent}
      </Checkbox>
    </div>
  );
}

/** An Inbox box's Stop, which it never offers. */
function neverStops(): Promise<boolean> {
  return Promise.resolve(false);
}

/** An Inbox box's Retry, which its own notes never offer. */
function noRetry(): void {}

/** What an item's box is drawn with. */
interface AnswerBoxProps {
  item: InboxItem;
  /** The account reading the Inbox, whose own notice opening acknowledges; none before it is known. */
  readerId: string | undefined;
  control: TaskInboxControl;
  /** The item's agent as its holder's read lists it, whose model and servers the box's chips draw; none before the read lands. */
  agent: AgentSummary | undefined;
  /** The agents' doors the box's model chip and servers change the item's agent through. */
  agents: AgentsControl;
  /** The item's thread, which the box replies to. */
  thread: readonly InboxMessage[];
  /** The open ask's controls, the card's body over its foot; nothing where none waits, or the ask is of words alone. */
  controls: React.ReactNode;
  /** Where the item's repository's skills are read from; nothing where none can be. */
  skills: SkillSource | undefined;
  /** The words a dictation into the box is likely to say (`dictation-keywords.ts`). */
  keywords: readonly string[];
  /** The thread whose agent's words the box stands Reply over, quoting them in. */
  replyScope: RefObject<HTMLElement | null>;
  /** Hears the door a quote is laid into the box through while the box takes one, and none once it does not, for the pages the thread draws (`shown-page.tsx`). */
  onQuoteDoor?: ((door: ((words: string) => void) | undefined) => void) | undefined;
  /** Hears a quote laid into the box, by Reply over the thread or a page it draws, so the thread can bring the whole box into view. */
  onQuoted?: (() => void) | undefined;
  /** Brings the item's agent back from the archive, offered after a send it refused for being archived. */
  onUnarchiveAgent: () => Promise<ActionResult>;
  /** The new thread the checkbox under the card starts instead of a reply; none where the page offers none. */
  newThread?: AnswerNewThread | undefined;
}

/** A new thread's first message, as the box hands it: its words and files, and the key the start goes under. */
export interface NewThreadStart {
  readonly text: string;
  readonly attachments: readonly AgentAttachment[];
  readonly clientKey: string;
}

/** A new thread the box can start instead of a reply: who it goes to, as a chip, and the start itself. */
export interface AnswerNewThread {
  /** The item's agent's chip, whom the thread goes to. */
  readonly agent: ReactNode;
  /** Starts the thread, answering why a refused start did not go, which the box says, or nothing once it started or stands Not delivered without a refusal to say. */
  readonly onStart: (start: NewThreadStart) => Promise<string | undefined>;
}

/** One item's box, its editor, its lists, its dictation, and what its note says all its own. */
function AnswerCard({
  item,
  readerId,
  control,
  agent,
  agents,
  thread,
  controls,
  skills,
  keywords,
  replyScope,
  onQuoteDoor,
  onQuoted,
  onUnarchiveAgent,
  newThread,
}: AnswerBoxProps): React.JSX.Element {
  const connected = useConnected();
  const toast = useToast();
  // Why the last thread start did not go, until the next send.
  const [refusal, setRefusal] = useState<string | undefined>(undefined);
  const draft = control.draftOf(item);
  const [asNew, setAsNew] = useState(false);
  const [starting, setStarting] = useState(false);
  const starts = newThread !== undefined && asNew;
  const asks = controls !== undefined && !starts;
  // Note that only a nod and a thread start hold the box; a reply leaves it at once and the next may follow.
  const sending = control.sending.has(item.id) || starting;
  const acknowledgeHeld = useInboxAcknowledger();
  // Note that a failed held read still offers Got it, since opening then acknowledges nothing.
  const nodded = acknowledgedOnOpen(item, readerId) && !control.failed;
  const nod = awaitsNod(item) && emptyBox(draft) && !nodded && !starts;

  // Note that Send lights only where the box holds a reply the service takes: an answer to the open ask attached, or words or files, a notice's nod being Got it's.
  const sendable = starts
    ? !emptyBox(draft) && draft.note.trim().length <= INBOX_BOUNDS.MAX_MESSAGE_CHARS
    : nod || inboxThreadSend(thread, draft) !== undefined;

  // Note that what an unfinished answer lacks is said only once a send was refused, and goes once it is filled.
  const missing = starts || nod ? undefined : inboxMissing(thread, draft);
  const [wanting, setWanting] = useState(false);

  if (wanting && missing === undefined) setWanting(false);
  const box = useRef<HTMLDivElement>(null);

  const refuse = (lacks: InboxMissing) => {
    setWanting(true);
    focusMissing(box.current, lacks);
  };

  const placeholder = starts
    ? INBOX_BOX_WORDS.NEW_THREAD_PLACEHOLDER
    : asks
      ? INBOX_BOX_WORDS.NOTE_PLACEHOLDER
      : INBOX_BOX_WORDS.REPLY_PLACEHOLDER;

  // What the box reads off the item's agent, read as the agent's own tab reads it, so the two boxes stand alike.
  const agentBox = useAgentBox({ agentId: item.agentId, agent, agents });
  const kept = control.notes.get(item.id);
  const noted = kept === undefined ? undefined : inboxNoteReading(kept, agent, connected);

  // Note that the note is let go once the agent is back, since what it said no longer stands, and only that note, never one a later send left meanwhile.
  const unarchive = () =>
    void onUnarchiveAgent().then((result) => {
      if (result.status !== ACTION_RESULT_STATUS.ACCEPTED) {
        toast({
          replayUnmasked: true,
          words: result.reason,
          tone: STATUS_TONE.DANGER,
          failure: {
            surface: FAILURE_SURFACE.AGENT_ARCHIVE,
            cause: result,
            about: { inboxItemId: item.id, agentId: item.agentId },
          },
        });
      } else if (kept !== undefined) control.onDropNote(item.id, kept);
    });

  const words = noted?.words ?? refusal;

  const note: ComposerNote | undefined =
    words === undefined
      ? undefined
      : {
          words,
          failure: failureShown({
            surface: FAILURE_SURFACE.INBOX_ANSWER,
            cause: FAILURE_CONDITION.REFUSED,
            about: { inboxItemId: item.id },
            refused: true,
          }),
          remedy: noted?.unarchive === true ? { label: UNARCHIVE, onClick: unarchive } : undefined,
        };

  const message = () => {
    setRefusal(undefined);
    control.onMessage(item, draft);
  };

  const acknowledge = () => {
    setRefusal(undefined);
    control.onAcknowledge(item, acknowledgeHeld);
  };

  // Note that the box lets go of what it sends at once, as a reply does, and never takes it back: a start that
  // did not go stands on the thread marked Not delivered (`inbox-pane.tsx`), whose Retry starts it again under its key.
  const start = (offer: AnswerNewThread) => {
    const text = draft.note.trim();
    const { attachments } = draft;
    setRefusal(undefined);
    setStarting(true);
    control.onDraft(item, { ...draft, note: "", attachments: [] });
    void offer.onStart({ text, attachments, clientKey: crypto.randomUUID() }).then((refused) => {
      setStarting(false);
      setAsNew(false);

      if (refused !== undefined) setRefusal(refused);
    });
  };

  const composer: AgentComposerControl = {
    draft: draft.note,
    // Note that each change moves the card on from what it holds as the write lands, since a file's chip goes into the words the moment the file is held, before the box draws again.
    setDraft: (text) => control.onHeld(item, (now) => ({ ...now, text })),
    attachments: draft.attachments,
    setAttachments: (next) => control.onAttachments(item, next),
    sending,
    note: undefined,
    closed: undefined,
    send: () => {
      if (starts) start(newThread);
      else if (nod) acknowledge();
      else if (missing !== undefined) refuse(missing);
      else message();
    },
    retry: noRetry,
    sent: [],
  };

  // The door the box lays a quote in through, which Reply over the thread and the pages it draws use.
  const replyDoor = useRef<((words: string) => void) | undefined>(undefined);
  // Note that Reply stands only while no nod or start is out, since a press lets the selection go.
  const quotes = !sending;
  const quoted = useRef(onQuoted);
  quoted.current = onQuoted;

  const layQuote = useCallback((quote: string) => {
    replyDoor.current?.(quote);
    quoted.current?.();
  }, []);

  useEffect(() => {
    if (onQuoteDoor === undefined || !quotes) return undefined;
    onQuoteDoor(layQuote);

    return () => onQuoteDoor(undefined);
  }, [onQuoteDoor, quotes, layQuote]);

  return (
    <div ref={box}>
      <AgentComposer
        {...agentBox}
        // Note that an empty box's Send stays Send, or reads Got it, and never Stop, because an empty Send here settles a notice or says what an answer lacks.
        stoppable={false}
        // Note that the box runs none of the `/` list's session commands, `/model` alone, because a reply reaches the agent wrapped as a thread's message (`inboxThreadMessage`), so `/compact` would go as words, and a `/clear` would take Send from a new thread.
        onClear={undefined}
        composer={composer}
        usage={undefined}
        onStop={neverStops}
        followsUp
        keywords={keywords}
        skills={skills}
        replyDoor={replyDoor}
        wording={{
          placeholder,
          label: placeholder,
          send: nod
            ? INBOX_BOX_WORDS.GOT_IT
            : starts
              ? INBOX_BOX_WORDS.START_THREAD
              : INBOX_BOX_WORDS.SEND,
        }}
        maxLength={INBOX_BOUNDS.MAX_MESSAGE_CHARS}
        takesFocus={false}
        answer={{
          question: asks ? controls : undefined,
          under:
            newThread === undefined ? undefined : (
              <NewThreadChoice
                offer={newThread}
                checked={asNew}
                held={sending}
                onChange={setAsNew}
              />
            ),
          sendable,
          inWords: nod || starts,
          refuses:
            missing === undefined
              ? undefined
              : {
                  onRefused: () => refuse(missing),
                  words: wanting ? missingWords(missing) : undefined,
                },
          note,
        }}
      />
      {quotes ? <ReplyToSelection scope={replyScope} onReply={layQuote} /> : null}
    </div>
  );
}

/**
 * The box under every item, replying on its thread, open or settled, as
 * above. Each item gets a card of its own, so a dictation, its note, and the
 * editor's undo never follow the developer to another item.
 */
export function InboxAnswerBox(props: AnswerBoxProps): React.JSX.Element {
  return <AnswerCard key={props.item.id} {...props} />;
}
