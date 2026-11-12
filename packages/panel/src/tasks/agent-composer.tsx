import { DENIES_WAITING } from "@repo/features/agent-approval-model";
import { SERVER_HANDED } from "@repo/features/agent-servers-model";
import {
  AGENT_BOUNDS,
  AGENT_STATUS,
  type AgentBrief,
  type AgentContext,
  type AgentPayer,
  type AgentStatus,
  type AgentUsage,
  hasWordsOrFiles,
} from "@repo/features/agent-wire";
import { FAILURE_REASON, remedyLabel, retriesBesideRemedy } from "@repo/features/failure-remedy";
import type { CatalogModel } from "@repo/features/models-wire";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import {
  isSlashCommand,
  leadingCommand,
  SLASH_COMMAND,
  type SlashCommand,
} from "@repo/features/slash-command";
import type { ShortcutChord } from "@repo/settings/shortcuts";
import { type ComposerNote, type ComposerRefusal, NOTE_LINE_LOOK, NoteLine } from "@repo/ui";
import type { Actor } from "@repo/ui/actor-model";
import { GLYPH } from "@repo/ui/icons";
import { absurd } from "effect";
import {
  type ComponentProps,
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react";
import { useConnected } from "../connection.js";
import type { MenuEntry } from "../desktop/action-menu.js";
import { modEnterSends } from "../enter-sends.js";
import { failureShown } from "../failure-report.js";
import { useIntegrationStatuses } from "../integration-statuses.js";
import { PANEL_SPAN } from "../panel-spans.js";
import type { AgentModeControl } from "./agent-approvals.js";
import { AgentContextRing, ContextRingIcon } from "./agent-context.js";
import { contextHint } from "./agent-context-model.js";
import {
  noteWhileOffline,
  paidByOf,
  planNameOf,
  providerOf,
  type SentLine,
} from "./agent-model.js";
import { AgentModelChip } from "./agent-model-chip.js";
import { PayerValue, usePayerPlan } from "./agent-payer.js";
import { type AgentServersControl, serversMenuPanel } from "./agent-servers.js";
import { MENTION_MENU_SIDE, type MentionMenuSide } from "./mention-picker.js";
import { FOLD_WIDTH, MessageBox, OVERFLOW_PRESS, useMessageBox } from "./message-box.js";
import type { MoveCarry } from "./move-agent.js";
import { useRepositoryRemedy } from "./repository-remedy.js";
import type { SkillSource } from "./skill-picker.js";
import { useMentionBox } from "./task-mentions.js";
import type { AgentComposerControl } from "./use-agent-composer.js";
import type { AgentModelControl } from "./use-agent-model.js";
import { useModifierHeld } from "./use-modifier-held.js";

/**
 * agent-composer.tsx -- the message box pinned under an agent's transcript: one card, the model's chip at its foot, one button, and a note under it when a message or a change did not go.
 *
 * The box is the message box a description comment is written in too
 * (`message-box.tsx`): the shared composer card at its default type, its
 * field, files, dictation, `@` and `/` lists, foot, Send, and the note under
 * the bar, with this box's chips laid on it. Its foot is laid
 * out as ChatGPT's and Codex's are: at the left the "+", which raises a
 * menu of Attachment, which attaches files, and MCP servers, which opens
 * the servers popover beside the menu as its submenu, where the agent is
 * handed a switch for each server (`agent-servers.tsx`); a pushed branch
 * wears nothing here, and a pull request, once one stands, is the row
 * pinned over the card (`agent-published.tsx`, `agent-tab.tsx`), so the
 * foot holds only what the next message goes with; at the right,
 * in this order, the model chip naming what the agent runs on, which opens
 * the menu that changes it for the next step (`agent-model-chip.tsx`), and,
 * for a Claude Code agent, how its tool calls are answered from its next
 * turn, the chip wearing the mode's glyph off Full access
 * (`agent-approvals.tsx`),
 * the ring that shows, once a step has ended, how full the agent's model's
 * context is and opens what fills it (`agent-context.tsx`), the
 * microphone, and the round button. The box takes a message to the agent:
 * Enter sends it, Shift+Enter is a new line (on a coarse pointer Enter is,
 * and the round Send sends: `composer-editor.ts`), and Escape leaves the box; the
 * box is an editor (`composer-field.tsx`) that holds plain words and a
 * chosen skill's chip, and the message is its words as a string. A
 * message sent while a turn runs steers it, so the agent sees it at its
 * next step; sent idle, it opens a new turn. While a tool call waits on an
 * answer, the box says over its field that a message sent now denies it,
 * as the service does. The box reads the same
 * whatever the agent is doing: one size, the same chips, no hint under it,
 * and one placeholder asking for a follow up, since a started agent's
 * conversation opens on its description or task, because the tab's glyph and the transcript's "Working…"
 * line already say where the agent stands. The one thing that follows the agent's state is
 * the button at the card's right, the way every chat draws it: Send while
 * there are words or files, disabled while there are neither and the agent
 * is idle, and Stop while there are neither and a turn runs, which is the
 * one Stop the tab has. A message that did not go stays in the box with why under the foot's
 * bar and what mends it (`@repo/ui`'s `ErrorState`): Retry, which sends it again
 * under the same key, so a send whose answer was lost reaches the agent
 * once, or, for a repository out of reach, the press its reason names
 * (`repository-remedy.tsx`), a move of the task sending it again by itself
 * once it lands; an agent that takes no message any more keeps the box,
 * disabled, with the reason under the bar and Continue in new agent under
 * that (`closedRemedy`); a change of model that did not take
 * says why in the same place; an editor bundle that could not be loaded
 * says so there too. A server whose sign-in expired is not said here but in
 * a toast of its own, wherever the window is (`expired-server-toasts.ts`).
 * The box takes
 * focus as the tab opens unless the developer is typing somewhere else, so
 * opening a tab never takes the caret out of the description, and a message sent
 * from the box, by Enter or by Send, hands the caret back to the box as it
 * opens again, unless the developer went somewhere else meanwhile, so the
 * next message is written at once. An agent's box never holds while a
 * message goes: the box empties, takes the next message at once, and each
 * agent's messages go one after another, the next once the one before it
 * answered (`use-agent-composer.ts`); a box whose send opens something,
 * New task's or a draft agent's, holds until it answers, its Send busy
 * meanwhile. A draft agent's tab
 * draws the same box over a start rather than a message, asking for the
 * first message of its still empty conversation, and its model chip once
 * the choice it starts on is known.
 *
 * Files go with a message the way every chat takes them: the "+" menu's
 * Attachment opens the system's file picker, an image pasted into the box
 * is taken, so are words pasted long enough to bury the message, as a text
 * file, and files dropped on the card are, each drawn as a chip over
 * the foot's bar with its way off (`attached-file-chips.tsx`). A file that
 * cannot come says why under the bar while the rest still come
 * (`use-attached-files.ts`). A message is words, files, or both, as the wire
 * takes it (`hasWordsOrFiles`), so files alone send too.
 *
 * Words selected in one of the agent's messages and answered with Reply
 * are laid into the words as a quote block under the line the caret stands
 * on, and the caret goes to a fresh line under it, so the developer answers
 * there; Reply again without a word between stacks the quotes, and words
 * between them answer point by point (`reply-to-selection.tsx`). A quote
 * goes out as a Markdown blockquote set apart by a blank line. Note that
 * a quote is part of the words like any other, and sends as they do,
 * because the words cannot tell a Reply's quote from a `>` line the
 * developer typed or pasted, and one of those alone is a message.
 *
 * Words can be spoken into the box as well: the microphone left of the
 * round button records in place of the foot's controls until ✓ or Enter sends the clip
 * to be heard and the words land at the caret, or ✕ or Escape drops it
 * (`use-dictation.ts`, `dictation-strip.tsx`). Why a dictation left nothing
 * is said in the same note a file's refusal is.
 *
 * An `@` at the start of a word, on a task's page, or on any box whose
 * owner hands its mentions (`task-mentions.tsx`), as New task's does for
 * its workspace, opens the list of what
 * the message can mention, the task's repository's files and folders, the
 * description's sections, the pages agents showed on it, its other coding agents,
 * the repository's skills, and the account's connected MCP servers and
 * their tools
 * (`mention-picker.tsx`), and the one chosen is written into the words as
 * its link, drawn as its chip (`mention-chip.tsx`). The `@` and `/` lists and the
 * microphone are the Inbox's answer box's too (`composer-pickers.tsx`). A server mentioned is
 * handed to the agent's next turn even where its switch is off, and to that
 * turn alone.
 *
 * A `/` at the start of a word opens the list of the skills the task's
 * repository keeps, at the caret, and the one chosen is written into the
 * words as its chip, read as `/name`, which the agent loads before it acts
 * and a press opens the `SKILL.md` of (`skill-picker.tsx`).
 *
 * The foot folds as the card narrows as every message box's does
 * (`message-box.tsx`): the ⋯ takes in the context ring and the microphone,
 * then the model chip draws its harness's mark alone, then the + folds in
 * too. The field and the round Send or Stop always stand whole.
 *
 * New task's composer is this same box over a start rather than a message
 * (`new-task-composer.tsx`): its owner names what the box asks for and
 * calls its round button (`wording`), stands its Runs on chip after the "+" (`tools`), handed whether the card is too narrow for its words,
 * holds Start while it cannot start (`sendable`), hears the keys the field leaves (`onKey`),
 * says what Escape does (`onLeave`), hands its workspace's mentions and
 * the chosen repository's skills to its `@` and `/` lists, and hands the
 * MCP servers' switches its first agent starts with, which its "+" menu
 * opens as an agent's does, with no Built in section, since no agent has
 * started yet, and after them Task relation, which its owner hands the
 * menu (`plus`).
 *
 * An Inbox thread's reply is this same box too (`inbox-answer-box.tsx`),
 * writing to the thread's agent. What the box reads off a started agent,
 * its status, its model chip and permission mode, its servers, its payer's
 * owner, and its place and forwarding chips, both owners read through one
 * hook (`agent-box.tsx`'s `useAgentBox`) and spread onto the box as it is,
 * so a chip added there stands on both.
 * Its owner hands what only an answer has (`answer`), an open question's controls
 * over the field, the checkbox that starts a new thread under the card, Send
 * lit by a pick as by words and reading Got it or Start thread in words, what
 * an unfinished answer lacks, and why a reply did not go. Its Send never
 * stands Stop, and a File tab's mention is laid into the agent's own box
 * rather than an answer's.
 */

/** What the box says it takes: the first message of an empty conversation, then a follow-up. */
export const PLACEHOLDER = {
  FIRST: "Ask to make changes",
  FOLLOW_UP: "Send a follow-up",
} as const;

/** What a box other than an agent's own asks for, calls its field, and calls its round button, and the chord its button's hint names. */
export interface ComposerWords {
  readonly placeholder: string;
  readonly label: string;
  readonly send: string;
  readonly chord?: ShortcutChord | undefined;
}

/** The buttons' names, which are their tooltips too. */
export const BUTTON = {
  SEND: "Send",
  STOP: "Stop",
  STOPPING: "Stopping",
  SENDING: "Sending",
  QUEUE: "Queue",
  STEER: "Steer",
  SAVE: "Save",
} as const;

/**
 * The room the composer's card stands in, a note under it, on the
 * transcript's own inset so the card and the column line up, with none above
 * it, since the log meets the card itself. A new task's and an Inbox
 * draft's box take the room in as their own sheets say.
 */
export const COMPOSER_ROOM_CLASS =
  "agent-composer relative flex flex-col gap-control-gap px-ui-16 pt-0 pb-list-inset";

/**
 * What docks over the composer, the to-do list, the pull request's row, and
 * a forked draft's chip, on the composer's own inset, so each card and the
 * composer's line up; a column or a panel that pads the composer in pads
 * these in alike.
 */
export const COMPOSER_DOCK_CLASS = "px-ui-16 pt-0 pb-row-inset";

/**
 * A log that runs right up to the card's top edge, its words dissolving
 * over `--ui-scroll-fade` just above it rather than being sliced short of
 * the card: its foot pads past the fade, so the newest line stands whole
 * above it.
 */
export const LOG_OVER_COMPOSER_CLASS = "agent-log-over-composer";

export function ComposerCard({
  children,
  ...props
}: Omit<ComponentProps<"div">, "className">): React.JSX.Element {
  return (
    <div className={COMPOSER_ROOM_CLASS} {...props}>
      {children}
    </div>
  );
}

/** What a box that answers an Inbox thread lays over an agent's own (`inbox-answer-box.tsx`). */
interface ComposerAnswer {
  /** The open question's controls, the card's body over the field; nothing where none stand. */
  readonly question: ReactNode;
  /** What stands under the card in its room: the checkbox that sends as a new thread; nothing where the page offers none. */
  readonly under: ReactNode;
  /** Whether the box holds something to send, read off the answer as well as its words and files: a pick, a tick, a nod. */
  readonly sendable: boolean;
  /** Whether Send reads its label in words, where it settles something (Got it) or starts a thread. */
  readonly inWords: boolean;
  /** Why an empty Send sends nothing, told on its press and said under the bar; nothing where the answer lacks nothing. */
  readonly refuses: ComposerRefusal | undefined;
  /** What the owner says under the bar over the box's own notes: why a reply or a thread did not go; nothing where it has nothing to say. */
  readonly note: ComposerNote | undefined;
}

/**
 * How an agent's box queues a message behind the turn under way, and edits
 * one queued already (`agent-queue-dock.tsx`); none for a box that queues
 * nothing, as the box of an agent on the retired runtime, or New task's.
 */
export interface ComposerQueueing {
  /** Whether a turn is under way or about to start, a line the box sent still on its way among them: what Queue is offered by. */
  readonly working: boolean;
  /** Whether the agent's first launch boots its machine, which takes no line until it is up, so every send queues and nothing steers. */
  readonly booting: boolean;
  /** Whether Enter queues while a turn runs, as Settings says (`agentEnter`); ⌘↩ does the other. */
  readonly enterQueues: boolean;
  /** Queues the box's message behind the turn. */
  readonly onQueue: () => void;
  /** Whether the box holds a queued message's words being edited, which Send saves back into its place and ⌘↩ steers. */
  readonly editing: boolean;
  readonly onSave: () => void;
  /** Sends the edited message now with the box's words, as that message. */
  readonly onSteer: () => void;
  /** Gives the edit up, as Escape with no list open does; the row's own Cancel does the same. */
  readonly onCancel: () => void;
}

/** The continue in the cloud a note of the agent's machine gone offline offers, carrying the message the note is of; none where no move is offered. */
function continuedInCloud(
  noted: SentLine | undefined,
  onContinueInCloud: ((carry: MoveCarry) => void) | undefined,
): (() => void) | undefined {
  if (onContinueInCloud === undefined) return undefined;

  return () =>
    onContinueInCloud({ words: noted?.text ?? "", attachments: noted?.attachments ?? [] });
}

export function AgentComposer({
  agentId,
  status,
  stoppable = status === AGENT_STATUS.RUNNING,
  steers = stoppable,
  composer,
  model,
  models,
  modelsFailed,
  readModels,
  usage,
  payer,
  payerSubscriptionId,
  owner,
  servers,
  plus = [],
  context,
  brief,
  onStop,
  followsUp,
  keywords = [],
  skills,
  replyDoor,
  sendsEmpty = false,
  closedRemedy,
  wording,
  maxLength = AGENT_BOUNDS.MAX_MESSAGE_CHARS,
  tools,
  actions,
  beforeSend,
  sendable = true,
  onKey,
  onLeave,
  focusedByOwner = false,
  takesFocus = true,
  listSide = MENTION_MENU_SIDE.ABOVE,
  queueing,
  answer,
  mode,
  approvalsWaiting = 0,
  onClear,
  onContinueInCloud,
}: {
  /** The agent the box writes to, which its `@` list does not offer; none for a draft not yet started. */
  agentId?: string | undefined;
  status: AgentStatus;
  /** Whether Stop stands in Send's place while the box is empty: while the agent runs where unsaid, and while a turn runs that a Stop can cancel where the tab knows (`offersStop`). */
  stoppable?: boolean;
  /** Whether a message sent now steers a turn under way rather than opening one: where Stop stands, where unsaid (`turnUnderWay`). */
  steers?: boolean;
  composer: AgentComposerControl;
  /** What the agent runs on and its chip's change; nothing while it is not yet known, which draws no chip. */
  model: AgentModelControl | undefined;
  /** The catalog as last read; nothing before the first read lands. */
  models: readonly CatalogModel[] | undefined;
  /** Whether the last read of the catalog did not land, which the chip's menu says with Retry. */
  modelsFailed: boolean;
  readModels: () => void;
  /** What the agent has cost, said at the chip's menu's foot; nothing before a turn settled. */
  usage: AgentUsage | undefined;
  /** Who pays for the agent, which the chip's menu names where a plan does; nothing where the page said none. */
  payer?: AgentPayer | undefined;
  /** The starter's subscription a plan payer runs the agent on, which the chip's menu names; nothing where the page named none. */
  payerSubscriptionId?: string | undefined;
  /** The teammate who started the agent, whose plan or key pays for it; none for the reader's own. */
  owner?: Actor | undefined;
  /** The MCP servers the agent is handed and their switches, which the + menu opens; none where the box offers none, whose + opens the file picker itself. */
  servers: AgentServersControl | undefined;
  /** Rows the + menu offers after MCP servers, its owner's: New task's Task relation. */
  plus?: readonly MenuEntry[] | undefined;
  /** What the agent's model's context holds, which the ring draws; nothing before a step ended, which draws no ring. */
  context?: AgentContext | undefined;
  /** What the agent was handed, which names the brief's part of the context. */
  brief?: AgentBrief | undefined;
  /** Stops the agent, answering whether the service took the Stop. */
  onStop: () => Promise<boolean>;
  /** Whether the conversation already holds a message, so the box takes a follow up rather than the first. */
  followsUp: boolean;
  /** The words a dictation is likely to say, read off the description (`dictation-keywords.ts`). */
  keywords?: readonly string[] | undefined;
  /** Where the skills a `/` offers are read from (`skill-picker.tsx`); nothing where the box offers none. */
  skills?: SkillSource | undefined;
  /** Where the box hands the transcript's Reply the door that lays a quote in at its caret; none where nothing replies. */
  replyDoor?: RefObject<((words: string) => void) | undefined> | undefined;
  /** Whether an empty box sends too, as a fork's draft does, which needs no words of its own. */
  sendsEmpty?: boolean;
  /** What mends a box closed for good, drawn after its note: Continue in new agent (`continue-agent.tsx`); none where nothing does. */
  closedRemedy?: ReactNode;
  /** What the box asks for, calls its field, and calls its round button, where its owner says other than an agent's box does, as New task's does. */
  wording?: ComposerWords | undefined;
  /** The most the words may spell: a message to an agent's bound, unless the owner sends them elsewhere, as New task's Plan mode sends a task's brief. */
  maxLength?: number;
  /** What stands after the "+" at the foot's left, handed whether the card is too narrow for its words: New task's Runs on chip. */
  tools?: ((narrow: boolean) => ReactNode) | undefined;
  /** What stands first among the foot's right-hand presses, before the model chip, handed whether the card is too narrow for their words. */
  actions?: ((narrow: boolean) => ReactNode) | undefined;
  /** What stands just before the round button, handed whether the card is too narrow for its words, as `actions` is. */
  beforeSend?: ((narrow: boolean) => ReactNode) | undefined;
  /** Whether the round button may send at all, beside the words: New task's is held while Agent mode has no repository. */
  sendable?: boolean;
  /** A key pressed in the field that neither its lists nor dictation took, and none while a file is still being read; answers whether it took it. */
  onKey?: ((event: KeyboardEvent) => boolean) | undefined;
  /** What Escape in the field does where no list or dictation takes it; the field gives up the caret where none is given. */
  onLeave?: (() => void) | undefined;
  /** Whether the owner hands the field focus where it stands as the box first draws, as a dialog's card does, so the field takes it itself only where its editor lands later. */
  focusedByOwner?: boolean;
  /** Whether the field takes the caret as it mounts at all; none on a phone's Home, where the keyboard would cover the places bar. */
  takesFocus?: boolean;
  /** Which side of the caret's line the `@` and `/` lists stand: over it, as at a tab's foot, or under it, as on Home. */
  listSide?: MentionMenuSide;
  /** How the box queues behind the turn and edits a queued message; none where it queues nothing. */
  queueing?: ComposerQueueing | undefined;
  /** What an Inbox thread's answer lays over the agent's box; none for a message to the agent. */
  answer?: ComposerAnswer | undefined;
  /** The agent's permission mode and its change, offered in the model chip's menu; none for an agent that never asks. */
  mode?: AgentModeControl | undefined;
  /** How many of the agent's tool calls wait on an answer, which a message sent now denies. */
  approvalsWaiting?: number;
  /** Starts the agent's harness on a fresh session (`/clear`), answering whether the service took it; none where the box runs no session commands, as New task's and a draft agent's, which have no session yet and run `/model` alone. */
  onClear?: (() => Promise<boolean>) | undefined;
  /** The agent continued in the cloud with the message given, which a note of its machine gone offline offers (`FAILURE_REASON.CONTINUE_IN_CLOUD`); none where no such move is offered. */
  onContinueInCloud?: ((carry: MoveCarry) => void) | undefined;
}): React.JSX.Element {
  const connected = useConnected();
  // Who pays, as the chip's menu names it, is the context popover's last line too.
  const paying = model === undefined ? payer : paidByOf(payer, usage, model.runtime);

  const planName = planNameOf(
    usePayerPlan(paying, payerSubscriptionId, (payer ?? usage?.payer) === undefined, owner),
  );

  const payerValue =
    paying === undefined ? undefined : (
      <PayerValue
        payer={paying}
        provider={model === undefined ? undefined : providerOf(model.choice.model)}
        usage={usage}
        owner={owner}
        planName={planName}
      />
    );

  // The popover the ⋯ may open in place of its hidden press.
  const [contextOpen, setContextOpen] = useState(false);
  const [stopping, setStopping] = useState(false);
  // The newest `/model` the box ran, which the model chip acts on.
  const [modelAsk, setModelAsk] = useState(0);
  // Whether a `/clear` the box ran waits on its answer, which holds the box.
  const [clearing, setClearing] = useState(false);

  // Note that a Stop the service took reads Stopping until the agent offers none, because the task
  // list carries the stop a moment after the answer.
  if (stopping && !stoppable) setStopping(false);
  // Note that a move's retry is read through a ref, because it lands a while
  // after its press and the box it retries is whichever render is current by then.
  const latest = useRef(composer);
  latest.current = composer;
  const closed = composer.closed !== undefined;
  // Note that a box clearing its session holds, so a message sent at once never reaches the session it ends.
  const held = composer.sending || closed || clearing;
  const editingQueued = queueing?.editing === true;
  // Note that `/model` needs only the model chip, so New task's box and a draft's run it, while `/compact` and `/clear` need a session.
  const reach = { model: model !== undefined, session: onClear !== undefined };
  const statuses = useIntegrationStatuses();

  const box = useMessageBox({
    draft: composer.draft,
    setDraft: composer.setDraft,
    // Note that a closed box asks for nothing, since it takes nothing.
    placeholder: closed
      ? ""
      : (wording?.placeholder ?? (followsUp ? PLACEHOLDER.FOLLOW_UP : PLACEHOLDER.FIRST)),
    label: wording?.label ?? "Message to the agent",
    maxLength,
    held,
    holder: { attachments: composer.attachments, update: composer.setAttachments },
    pastesTextAsFile: true,
    self: agentId,
    skills,
    // Note that an edit of a queued message runs no command, chosen as typed, since it saves back into its place.
    commands:
      editingQueued || (!reach.model && !reach.session)
        ? undefined
        : { reach, onRun: (name) => runCommand(name, true) },
    keywords,
    // A server's chip in the box says what a send now does with it: opens a turn, or steers the one running.
    servers: {
      statuses,
      place: {
        disabled: servers?.disabled ?? [],
        handed: steers ? SERVER_HANDED.STEERS : SERVER_HANDED.OPENS,
      },
    },
    // Escape with no list open gives up an edit of a queued message, the box keeping the caret.
    onLeave: editingQueued ? queueing.onCancel : onLeave,
    side: listSide,
    onSubmit: () => submit(),
    onKey: (event) =>
      queueKey(event) ||
      // A file still being read holds the owner's keys too, as it holds Send.
      (!files.reading && onKey?.(event) === true),
    takesFocus,
    focusedByOwner,
    keystrokeSpan: answer === undefined ? undefined : PANEL_SPAN.KEYSTROKE_INBOX_ANSWER,
  });

  const { editor, room, frame, files } = box;
  // Note that Send waits while files are read, so no message goes without a file the developer already handed the box.
  const sendHeld = held || !sendable || files.reading;

  // Note that an edit's Save stands with the box emptied, since saving nothing gives the edit up.
  const empty =
    answer === undefined
      ? !sendsEmpty &&
        !editingQueued &&
        !hasWordsOrFiles(composer.draft.trim(), composer.attachments)
      : !answer.sendable;

  const showsStop = empty && stoppable && !composer.sending && !editingQueued;
  const goes = !empty && !held && !files.reading && !editingQueued;
  // Note that while the first launch boots a message goes one way, into the queue, since nothing steers a machine not yet up.
  const boots = queueing?.booting === true;
  // While a turn runs and the box holds a message it may go two ways; holding ⌘ says on Send which a send takes.
  const queues = !boots && queueing?.working === true && goes;
  const modifierHeld = useModifierHeld(queues || editingQueued);
  const queuesNow = (boots && goes) || (queues && queueing?.enterQueues !== modifierHeld);
  const sendNote = noteWhileOffline(composer.note, connected);
  const repositoryRemedy = useRepositoryRemedy();

  const remedy =
    sendNote === undefined
      ? undefined
      : sendNote.reason === FAILURE_REASON.CONTINUE_IN_CLOUD
        ? continuedInCloud(composer.notedLine, onContinueInCloud)
        : // Note that a move's retry is the box's as the move lands, and only while the refusal it
          // was pressed for still stands, so an edit or a later send meanwhile is never sent over.
          repositoryRemedy(sendNote, () => {
            if (latest.current.note === sendNote) latest.current.retry();
          });

  // Note that a remedy finished where we cannot watch keeps Retry beside it, since the same send goes once it is done.
  const remedyWords = sendNote === undefined ? undefined : remedyLabel(sendNote);

  /** A note of the box's that is a failure of the app's, which no Retry mends: why the box is closed, or a change of model did not take. */
  const refusedNote = (words: string): ComposerNote => ({
    words,
    failure: failureShown({
      surface: FAILURE_SURFACE.AGENT_COMPOSER,
      cause: FAILURE_REASON.OTHER,
      about: { agentId },
      refused: true,
    }),
  });

  // Note that a send's failure keeps its words and its Retry over the cut paste's, since a paste into a full box changes nothing a send's failure could be taken down by.
  const own = box.note?.cut === true && sendNote !== undefined ? undefined : box.note?.note;

  const note: ComposerNote | undefined =
    answer?.note ??
    (composer.closed === undefined
      ? undefined
      : { ...refusedNote(composer.closed), mends: closedRemedy }) ??
    own ??
    (sendNote === undefined
      ? (model?.note ?? mode?.note) === undefined
        ? undefined
        : refusedNote(model?.note ?? mode?.note ?? "")
      : {
          words: sendNote.text,
          // Note that a send's failure is reported as the answer that refused it, where its note holds one,
          // so a refusal the service worded is sent as its word rather than as an unexpected failure.
          failure: failureShown({
            surface: FAILURE_SURFACE.AGENT_SEND,
            cause: sendNote.cause ?? sendNote,
            about: { agentId },
          }),
          remedy:
            remedyWords === undefined || remedy === undefined
              ? undefined
              : { label: remedyWords, onClick: remedy },
          onRetry:
            remedyWords === undefined || retriesBesideRemedy(sendNote) ? composer.retry : undefined,
        });

  const sendLabel = wording?.send ?? BUTTON.SEND;

  // Note that a held box gives up the caret, because a field that takes no
  // words, and a Send disabled under the press, can hold none; a send made
  // from the box hands it back as soon as the box takes words again, which
  // is at once where the send holds nothing, as an agent's never does, and
  // as the answer lands where it holds the box, unless the caret went
  // somewhere else meanwhile: to another field, or to a press or a menu in
  // the box's own foot, such as the model chip's search.
  const refocus = useRef(false);
  const [sends, setSends] = useState(0);
  useEffect(() => {
    if (sends === 0 || held || !refocus.current) return;
    refocus.current = false;
    const active = document.activeElement;

    const dropped =
      active === null ||
      active === document.body ||
      room.current?.contains(active) === true ||
      (active instanceof HTMLButtonElement &&
        active.type === "submit" &&
        frame.current?.contains(active) === true);

    if (dropped) {
      editor.current?.focus();
    }
  }, [held, sends, room, editor, frame]);

  // The transcript's Reply lays its quote in where the caret stands, for as long as the box stands.
  useEffect(() => {
    if (replyDoor === undefined) return undefined;
    replyDoor.current = (words) => {
      editor.current?.insertQuote(words);
    };

    return () => {
      replyDoor.current = undefined;
    };
  }, [replyDoor, editor]);

  // A file's lines picked in a File tab on the page (⌥⌘K) are laid in here, where the caret stands.
  useMentionBox(
    answer === undefined ? (mention) => editor.current?.insertMention(mention) : undefined,
  );

  const stop = () => {
    setStopping(true);
    onStop().then(
      (took) => setStopping(took),
      () => setStopping(false),
    );
  };

  /**
   * The box's message gone the way `go` takes it: sent, queued behind the
   * turn, or an edit of a queued message saved or steered. Note that every
   * way is the one step, so the box's notes go and its caret comes back
   * alike whichever way its message went.
   */
  const sentBy = (go: () => void) => {
    box.quiet();
    refocus.current = frame.current?.contains(document.activeElement) === true;
    go();
    files.settle();
    setSends((count) => count + 1);
  };

  /** The box's message sent now: into the turn under way, or opening one. */
  const steer = () => sentBy(composer.send);

  /**
   * One of the box's own commands, chosen from the `/` list or typed as the
   * message's first word: `/model` opens the model chip's menu, its search
   * focused, `/clear` and `/new` start the
   * agent's harness on a fresh session, and `/compact` chosen from the list
   * is written into the words, where the developer may add what to keep
   * before sending it, the service handing it to the harness as its
   * compaction (`harness-commands.ts`). Whatever runs empties the box.
   */
  const runCommand = (name: SlashCommand, chosen: boolean) => {
    switch (name) {
      case SLASH_COMMAND.COMPACT: {
        const words = leadingCommand(composer.draft)?.words ?? "";

        if (chosen) editor.current?.replace(`/${SLASH_COMMAND.COMPACT} ${words}`);

        return;
      }

      case SLASH_COMMAND.MODEL:
        editor.current?.clear();
        setModelAsk((was) => was + 1);

        return;
      case SLASH_COMMAND.CLEAR:
      case SLASH_COMMAND.NEW:
        editor.current?.clear();

        if (onClear === undefined) return;
        // The box holds until the answer lands, then hands the caret back as a send's does.
        refocus.current = frame.current?.contains(document.activeElement) === true;
        setClearing(true);
        setSends((count) => count + 1);
        onClear().then(
          () => setClearing(false),
          () => setClearing(false),
        );

        return;
      default:
        return absurd(name);
    }
  };

  /**
   * The command the box's words run rather than send, typed as their first
   * word: `/model`, whatever follows it, which is dropped as the menu opens,
   * since the agent would only read it as a stray line; or `/clear` and
   * `/new` typed alone.
   */
  const typedCommand = (): SlashCommand | undefined => {
    if (editingQueued) return undefined;
    const typed = leadingCommand(composer.draft);

    if (typed === undefined || !isSlashCommand(typed.name)) return undefined;

    switch (typed.name) {
      case SLASH_COMMAND.MODEL:
        return reach.model ? typed.name : undefined;
      case SLASH_COMMAND.COMPACT:
        return undefined;
      case SLASH_COMMAND.CLEAR:
      case SLASH_COMMAND.NEW:
        return reach.session && typed.words === "" ? typed.name : undefined;
      default:
        return absurd(typed.name);
    }
  };

  /** Send as it stands: an edit saved, the message queued where a send queues now, or sent; one of the box's commands typed runs instead. */
  const submit = () => {
    const command = typedCommand();

    if (command !== undefined) return runCommand(command, false);

    if (editingQueued) return sentBy(queueing.onSave);

    if (queuesNow) return sentBy(queueing.onQueue);
    steer();
  };

  /** The other way than a send that queues where `pressQueues` says, which ⌘↩ and a touch held on Send take: an edit steered, or the message steered or queued. */
  const sendOtherWay = (pressQueues: boolean) => {
    if (editingQueued) return sentBy(boots ? queueing.onSave : queueing.onSteer);

    if (pressQueues) return steer();

    if (queueing !== undefined) sentBy(queueing.onQueue);
  };

  /** A key the queue takes: ⌘↩ steers an edit, or sends the other way than Enter, held where Send is. */
  const queueKey = (event: KeyboardEvent): boolean => {
    if (queueing === undefined) return false;

    if (!modEnterSends(event)) return false;

    if (editingQueued) {
      if (!sendHeld) sendOtherWay(false);

      return true;
    }

    if (!queues || !sendable) return false;
    sendOtherWay(queueing.enterQueues);

    return true;
  };

  // Send says what a send does while it is other than steering, as its glyph alone in the round send's place:
  // Save for an edit, and Queue or Steer as ⌘ turns it.
  const sendWay =
    editingQueued && !modifierHeld
      ? { label: BUTTON.SAVE, icon: <GLYPH.DONE /> }
      : queuesNow
        ? { label: BUTTON.QUEUE, icon: <GLYPH.QUEUED /> }
        : (queues || (editingQueued && !boots)) && modifierHeld
          ? { label: BUTTON.STEER, icon: <GLYPH.STEER /> }
          : undefined;

  // What the + offers beside files, its menu's rows after Attachment: the servers' popover, where the box hands servers, then its owner's.
  const plusRows: readonly MenuEntry[] = [
    ...(servers === undefined ? [] : [serversMenuPanel(servers, statuses)]),
    ...plus,
  ];

  return (
    <ComposerCard data-status={status} data-closed={closed ? "" : undefined} {...files.drop.target}>
      {/* A box closed for good wears the held look a box sending does, faded, so the note and Continue under it read as the way on. */}
      <MessageBox
        box={box}
        className={closed ? "opacity-60" : answer === undefined ? undefined : "inbox-answer"}
        head={
          answer?.question ??
          (approvalsWaiting > 0 && !closed ? (
            <NoteLine look={NOTE_LINE_LOOK.LIST} data-approval-hint="">
              {DENIES_WAITING}
            </NoteLine>
          ) : undefined)
        }
        plus={plusRows}
        tools={tools?.(box.folds(FOLD_WIDTH.TOOLS))}
        actions={
          <>
            {actions?.(box.folds(FOLD_WIDTH.ACTIONS))}
            {model === undefined ? null : (
              <AgentModelChip
                model={model}
                models={models}
                modelsFailed={modelsFailed}
                readModels={readModels}
                usage={usage}
                payer={payer}
                payerSubscriptionId={payerSubscriptionId}
                owner={owner}
                narrow={box.folds(FOLD_WIDTH.MODEL)}
                permissions={mode}
                asked={modelAsk}
              />
            )}
            <AgentContextRing
              context={context}
              brief={brief}
              payer={payerValue}
              open={contextOpen}
              onOpenChange={box.handBack(setContextOpen)}
            />
          </>
        }
        more={[
          ...(context === undefined
            ? []
            : [
                {
                  press: OVERFLOW_PRESS.CONTEXT,
                  entries: [
                    {
                      label: contextHint(context),
                      icon: <ContextRingIcon context={context} />,
                      onSelect: () => setContextOpen(true),
                    },
                  ],
                },
              ]),
        ]}
        beforeSend={beforeSend?.(box.folds(FOLD_WIDTH.ACTIONS))}
        send={{
          label: sendWay?.label ?? sendLabel,
          ...(sendWay === undefined ? undefined : { icon: sendWay.icon }),
          inWords: answer?.inWords,
          refuses: answer?.refuses,
          chord: wording?.chord,
          // Note that a hold takes the other way than Send as it reads, which a held ⌘ may already have turned.
          onHold: queues || editingQueued ? () => sendOtherWay(queuesNow === true) : undefined,
          empty,
          held: sendHeld,
          busy: composer.sending,
          busyLabel: BUTTON.SENDING,
        }}
        stop={
          showsStop
            ? { label: BUTTON.STOP, onStop: stop, busy: stopping, busyLabel: BUTTON.STOPPING }
            : undefined
        }
        note={note}
      />
      {answer?.under}
    </ComposerCard>
  );
}
