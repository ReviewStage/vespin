import { AGENT_BOUNDS, type AgentAttachment, base64Bytes } from "@repo/features/agent-wire";
import type { FileChip } from "@repo/features/attachment-model";
import { textChange } from "@repo/features/description-comment-anchor";
import {
  DESCRIPTION_COMMENT_ACTION,
  DESCRIPTION_COMMENT_ACTOR,
  DESCRIPTION_COMMENT_BOUNDS,
  DESCRIPTION_COMMENT_ENTRY,
  DESCRIPTION_COMMENT_SCOPE,
  DESCRIPTION_COMMENT_STATUS,
  type DescriptionCommentEntry,
  type DescriptionCommentFile,
  type DescriptionCommentStart,
  type DescriptionCommentThread,
  type DescriptionCommentWriter,
} from "@repo/features/description-comment-wire";
import type { DescriptionSection } from "@repo/features/description-document";
import { fileMarkers } from "@repo/features/file-marker";
import { LINK_DESTINATION } from "@repo/features/link-grammar";
import type { FrameBox, PagePicked } from "@repo/features/page-pick";
import { FAILURE_CONDITION, FAILURE_SURFACE } from "@repo/features/shown-failure";
import { IRREVERSIBLE_WORDS } from "@repo/features/words";
import { APP_COMMAND } from "@repo/settings/shortcuts";
import {
  BUTTON_SIZE,
  BUTTON_VARIANT,
  Button,
  CARD_CORNER,
  CARD_HOVER,
  CARD_LOOK,
  CARD_PADDING,
  CARD_PRESS_CORNER,
  CARD_PRESS_REACH,
  CARD_SHADOW,
  Card,
  type CardHover,
  type CardLook,
  CardPress,
  type CardShadow,
  CHOICE_BAR_LOOK,
  CHOICE_BAR_SIZE,
  ChoiceBar,
  COMMENT_PIN_LOOK,
  COMMENT_PIN_STANDS,
  CONFIRM_LOSS,
  Comment,
  type CommentAuthor,
  CommentPin,
  type CommentPinStands,
  CommentsIcon,
  ConfirmDialog,
  cssCustomProperties,
  type DialogQuestion,
  DRAFT_WORD,
  EmptyState,
  ERROR_STATE_PLACEMENT,
  ErrorState,
  FailureNote,
  Fill,
  GAP,
  HoverCard,
  HoverCardScroll,
  IconButton,
  LINE_BUTTON_LOOK,
  LineButton,
  MENU_SURFACE_FLOW,
  MenuSurface,
  PaneBar,
  POPOVER_SIDE,
  pointCard,
  QuietWords,
  RectFloat,
  SCROLL_FADE,
  SCROLL_OVERSCROLL,
  SCROLL_SIZE,
  ScrollArea,
  Skeleton,
  SkeletonRegion,
  Stack,
  TEXT_BUTTON_TONE,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  TextButton,
  Time,
  Tooltip,
  TrashIcon,
  useConfirmDialog,
  useMinute,
  usePressAway,
  VisuallyHidden,
} from "@repo/ui";
import { type Actor, APP_ACTOR, DELETED_ACCOUNT_ACTOR } from "@repo/ui/actor-model";
import { neverBusyAct } from "@repo/ui/confirm-state";
import {
  type DescriptionCommentsControl,
  hungTop,
  type MarginView,
  marginTops,
  openThread,
  PENDING_THREAD,
  type PendingThread,
  useDescriptionCommentsControl as useDescriptionCommentsControlOrUndefined,
} from "@repo/ui/description-comments";
import {
  CheckIcon,
  CircleCheckIcon,
  GLYPH,
  MessageSquareIcon,
  MessageSquarePlusIcon,
  RotateCcwIcon,
} from "@repo/ui/icons";
import { QUOTE_CLASS } from "@repo/ui/quote-face";
import { MESSAGE_BLOCK, messageBlocks, messageText, replyOf } from "@repo/ui/reply-quote";
import { ReplayUnmask, writeWithheldSheet } from "@repo/ui/session-replay-marks";
import { useDisclosure } from "@repo/ui/use-disclosure";
import { VIRTUAL_ROWS_ANCHOR, VirtualRows, type VirtualRowsHandle } from "@repo/ui/virtual-rows";
import { visibleViewport } from "@repo/ui/visible-viewport";
import { useSelector } from "@tanstack/react-store";
import { Equal } from "effect";
import {
  createContext,
  type ReactNode,
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ActorMark, ActorRef, commentAuthor } from "../actor-ref.js";
import { useAppCommand } from "../app-commands.js";
import { coarsePointerNow, FINGER_SELECTION_GAP } from "../coarse-pointer.js";
import {
  type DescriptionCommentPlace,
  DRAFT_PLACE,
  type DraftPageElement,
  type DraftPlace,
  EMPTY_DRAFT,
  heldLines,
  useDraft,
  useDraftWriter,
} from "../composer-drafts.js";
import { useLinkItems } from "../copy-link-item.js";
import type { DescriptionEditorHandle, EditorSpan } from "../description-editor/contract.js";
import type { MenuAction } from "../desktop/action-menu.js";
import { confirmFailure, failureShown, unreadShown } from "../failure-report.js";
import { useFindOpen } from "../find-in-tab.js";
import { MarkdownMessage } from "../markdown-message.js";
import { useMemberDirectory, usePerson } from "../member-directory.js";
import { centerWithin } from "../scroll-within.js";
import { type FindRow, useVirtualFind } from "../virtual-find.js";
import { AgentActorRef, type AgentSubject, agentSubject, NOTHING_HELD } from "./agent-ref.js";
import { attachmentChips } from "./attached-file-chips.js";
import { CommentMenu, CommentTools } from "./comment-menu.js";
import { REPLY_LOOK, REPLY_VARIANT, type ReplyVariant } from "./comment-variant.js";
import {
  CommentFiles,
  useCommentFileChips,
  useCommentFileEntries,
} from "./description-comment-files.js";
import { EDITOR_ROOM_CLASS } from "./description-document-editor.js";
import type { EditAgents } from "./edit-ref.js";
import { useWordFiles, type WordFiles } from "./file-chips.js";
import { MessageBox, useMessageBox } from "./message-box.js";
import { type HeldComment, PAGE_REVIEW_WORDS, type PageReviewControl } from "./page-review.js";
import { PendingWords } from "./pending-comments.js";
import { pressPlace, ReplyPress, roomAround } from "./reply-to-selection.js";
import { useMentionLink } from "./task-mentions.js";
import { useOpenLink } from "./use-open-link.js";
import {
  useWordsDatePicker,
  WordsDatePickerRoom,
  type WordsDates,
  WordsDatesContext,
  wordsDatesDoor,
} from "./words-dates.js";

/**
 * description-comments.tsx -- comments on the open description, beside its words: each open thread in the margin level with the words it is on, or behind a count at the line's end where the column has no room for a margin, a thread started from words selected or from a block's own button, and each thread answered, resolved, reopened, edited, and deleted where it stands.
 *
 * The words a thread is on are marked in the read view (`description-body.tsx`
 * draws them through `markdown-message.tsx`'s comment marks), each mark
 * naming its thread, and the margin stands each card level with its mark,
 * the open one exactly so and the rest stepped aside so none overlap
 * (`@repo/ui/description-comments`'s `marginTops`). A thread whose words were
 * deleted stands at the top of the section they stood in, saying so over
 * its quote. Where the document's column is narrower than the description's
 * reading width, a margin, and the gap between them, the margin folds: each
 * line holding marks wears a count at its end, which opens its thread as a
 * card floating under the words, or over them where the view has no room
 * below. An open card stands no taller than the view and inside it
 * (`keptInView`, `hungTop`), its entries scrolling above its reply field.
 *
 * A thread is started from words selected in the read view, with the
 * bubble that rises over them, or from the button a block shows at its end
 * under the pointer, which comments on the whole block; while the bubble
 * stands, ⇧⌘M starts it as a press on the bubble does
 * (`APP_COMMAND.COMMENT_ON_SELECTION`), and with no words selected it
 * comments on the block under the pointer as the block's button does. In the open editor the format
 * toolbar over the words selected takes the bubble's place, its Comment
 * starting the thread (`useEditorComment`), so two surfaces never stand over
 * one selection; and in a description the reader may edit, words a press selects in
 * the read view open the editor on them (`clickPlacement`), so the bubble
 * stands there only until the press ends. Its words are
 * measured in the description's Markdown by laying the words drawn over the
 * section's source (`@repo/features/description-comment-anchor`), so emphasis, a
 * link, or a chip inside them puts nothing off. Posting a comment asks no
 * agent anything.
 *
 * Every write here is drawn by the host the moment it is asked, standing
 * until the read carries it (`@repo/host`'s `description-comment-writes.ts`), so
 * nothing waits on the service: a resolve, a reopen, an edit, or a deletion
 * once asked draws in the frame of the press, and one refused is taken back
 * and said in a toast. A thread being started is drawn under the key its
 * first comment is sent under, which names the thread, and opens at once
 * in its card's place. A reply leaves its field the moment it is sent and
 * draws at the thread's end as the reader's own comment, and the field
 * takes the next at once, as the agent's box does
 * (`use-agent-composer.ts`): nothing holds Send, the files' +, or the
 * microphone while the service answers, and the host sends a thread's
 * replies one at a time in the order written, each under a key of its own.
 * A reply refused comes back into the field above whatever was written
 * there since; where the field is gone or the two are more than one comment
 * carries, it stands apart as not sent, under its own key, with Retry and
 * Discard, since a refusal may be an answer lost after the service wrote the
 * reply, and only its own key keeps Retry from writing it twice. A thread's
 * first comment refused comes back the same way, where its words are
 * commented on again.
 */

/**
 * The words a thread is on, quoted over it in the quote's face every quote
 * wears (`@repo/ui/quote-face`), a message's and the message box's alike:
 * whole where they are words chosen, as a selection or a Reply chooses
 * them, and two lines at most where they are a whole block or element,
 * which may run on for a section; struck out where the words are gone.
 */
const COMMENT_QUOTE_CLASS = `${QUOTE_CLASS} comment-quote data-[clipped=true]:line-clamp-2 data-[gone=true]:line-through data-[gone=true]:decoration-quote-strike`;

/**
 * A card's place in the margin: a card already there travels to its next
 * place, as threads above it open, grow, or arrive, on the spring every move
 * rides; one arriving lands where it belongs and fades in, and one leaving,
 * its thread resolved or deleted or the thread being started let go, fades
 * out where it last stood as the cards below travel up (tasks.css).
 */
const SLOT_CLASS =
  "comment-slot absolute inset-x-0 top-0 data-[moves=true]:transition-transform data-[moves=true]:duration-(--ui-duration-shape)";

/** A slot that stands where a list lays it rather than where the margin measured it, arriving and leaving as a margin's card does. */
const FLOW_SLOT_CLASS = "comment-slot";

/** A card in the margin as it was last drawn: its thread or the thread being started, where it stood, and whether it stood open. */
interface MarginCard {
  readonly id: string;
  readonly thread: DescriptionCommentThread | undefined;
  readonly pending: PendingThread | undefined;
  readonly top: number;
  readonly open: boolean;
}

/** A card drawn in the margin, and whether it is fading out. */
interface DrawnCard extends MarginCard {
  readonly leaving: boolean;
}

function sameCards(a: readonly MarginCard[], b: readonly MarginCard[]): boolean {
  return (
    a.length === b.length &&
    a.every((card, at) => {
      const other = b[at];

      return (
        other !== undefined &&
        card.id === other.id &&
        card.thread === other.thread &&
        card.pending === other.pending &&
        card.top === other.top &&
        card.open === other.open
      );
    })
  );
}

/**
 * The margin's cards to draw, while it is drawn: those standing, then each
 * that left, as it was last drawn, until its fade is done (`gone`). Note that what left is
 * taken in the render that sees it go, so its card is the same element
 * fading rather than one drawn again, and a card standing again is no
 * longer held.
 */
function useMarginCards(
  cards: readonly MarginCard[],
  drawing: boolean,
): {
  drawn: readonly DrawnCard[];
  gone: (id: string) => void;
} {
  const [held, setHeld] = useState<{
    last: readonly MarginCard[];
    leaving: readonly MarginCard[];
  }>(() => ({ last: cards, leaving: [] }));

  let { leaving } = held;

  // Note that a margin not drawn, folded, holds nothing, since a card it held would fade out once it is drawn again.
  if (!sameCards(held.last, cards) || (!drawing && leaving.length > 0)) {
    const standing = new Set(cards.map((card) => card.id));
    const left = held.last.filter((card) => !standing.has(card.id));
    leaving = drawing ? [...leaving.filter((card) => !standing.has(card.id)), ...left] : [];
    setHeld({ last: cards, leaving });
  }

  const gone = useCallback((id: string) => {
    setHeld((now) => ({ last: now.last, leaving: now.leaving.filter((card) => card.id !== id) }));
  }, []);

  return {
    drawn: [
      ...cards.map((card) => ({ ...card, leaving: false })),
      ...leaving.map((card) => ({ ...card, leaving: true })),
    ],
    gone,
  };
}

/**
 * A card's place in the margin, held drawn through its fade once it leaves,
 * and let go once that is done; or, where it `flows`, a row of a list that
 * arrives and leaves the same way, standing where the list lays it.
 */
function MarginSlot({
  card,
  moves,
  slotRef,
  onGone,
  flows = false,
  children,
}: {
  card: DrawnCard;
  moves: boolean;
  slotRef: (element: HTMLDivElement | null) => void;
  onGone: (id: string) => void;
  flows?: boolean;
  children: ReactNode;
}): React.JSX.Element | null {
  const shown = useDisclosure(!card.leaving);
  const { id } = card;
  useEffect(() => {
    if (!shown.mounted) onGone(id);
  }, [shown.mounted, onGone, id]);

  if (!shown.mounted) return null;

  return (
    <div
      ref={(element) => {
        shown.ref(element);
        // Note that a card leaving is no longer measured, so the cards below take its room as it fades.
        slotRef(card.leaving ? null : element);
      }}
      className={flows ? FLOW_SLOT_CLASS : SLOT_CLASS}
      data-moves={moves && !card.leaving}
      data-leaving={card.leaving ? "true" : undefined}
      inert={card.leaving}
      style={flows ? undefined : { transform: `translateY(${card.top}px)` }}
    >
      {children}
    </div>
  );
}

/** The column's room a margin needs beside the reading width: the gap and the card, as `planning.css` spends them. */
const MARGIN_ROOM = 48 + 288;

/** The reading width, as `--ui-page-measure` spends it. */
const READING_WIDTH = 720;

/** The class the words a thread is on wear in the read view (`markdown-message.tsx`'s comment mark). */
const COMMENT_MARK_CLASS = "description-comment-mark";

/** How far below the scroller's top a thread asked to be shown lands. */
const REVEAL_ROOM = 96;

/** What a mention's chip wears, whose press opens the thread at rest it stands in as well as what it names. */
const MENTION_REF = "[data-mention-ref]";

/** The button a block under the pointer shows at the column's end. */
const BLOCK_BUTTON_CLASS = "comment-block-button";

/** The `over` of the block under the pointer's comment command, which answers only where no words selected offer it. */
const YIELDS_TO_SELECTION = (): boolean => false;

/** How far apart two cards of the margin stand. */
const CARD_GAP = 8;

/** How far below a folded line's top the card opened from its count hangs, clear of the count. */
const HUNG_DROP = 28;

/** How far inside the scroller's edges an open card keeps. */
const VIEW_EDGE = 16;

/** Where a thread's card stands: in the description's margin, floating under a folded line's count, or in the description's comments list. */
const THREAD_PLACE = {
  MARGIN: "margin",
  FLOAT: "float",
  LIST: "list",
} as const;

type ThreadPlace = (typeof THREAD_PLACE)[keyof typeof THREAD_PLACE];

/** The room a finger's bubble needs under the words, its gap past the handle and its own height, short of which it stands over them after all. */
const BUBBLE_ROOM_TOUCH = FINGER_SELECTION_GAP + 48;

/** The words a thread's controls are named by. */
const COMMENT_WORDS = {
  COMMENT: "Comment",
  ADD: "Add a comment",
  REPLY: "Reply",
  RESOLVE: "Resolve",
  REOPEN: "Reopen",
  THING: "Comment",
  EDIT: "Edit",
  DELETE: "Delete",
  DELETE_THREAD: "Delete thread",
  SAVE: "Save",
  CANCEL: "Cancel",
  GONE: "Original content deleted",
  RESOLVED_IT: "resolved this",
  REOPENED_IT: "reopened this",
  EDITED: "edited",
  OPEN_THREAD: "Open thread",
  SHOW_WORDS: "Show in the description",
  SHOW_ELEMENT: "Show on the page",
  DISCARD: "Discard",
  NOT_SENT: "This comment could not be sent.",
  NOT_SENT_MANY: "These comments could not be sent.",
  YOU: "You",
} as const;

/** Which thread is open, and the one being started, shared by the marks that open them and the margin that draws them. */
interface CommentFocus {
  readonly active: string | undefined;
  readonly onActive: (thread: string | undefined) => void;
  readonly pending: PendingThread | undefined;
  /** Opens a thread and asks the description to scroll to its words, as the description's comments list and a link to it do. */
  readonly reveal: (thread: string) => void;
  /** The last ask to scroll to a thread, counted so the same thread asked twice scrolls twice. */
  readonly revealed: { readonly thread: string; readonly ask: number } | undefined;
  /** Which threads the description lists in its margin's place, open or resolved; none while its open threads stand in the margin beside their words. */
  readonly listing: CommentsFilter | undefined;
  readonly onListing: (listing: CommentsFilter | undefined) => void;
}

/** What the description's comments are focused on: nothing, an open thread, or a thread being started. */
const FOCUS_KIND = { NONE: "none", THREAD: "thread", STARTING: "starting" } as const;

/** The one focus, so a thread opened while another is being started is never held behind it. */
type Focused =
  | { readonly kind: typeof FOCUS_KIND.NONE }
  | { readonly kind: typeof FOCUS_KIND.THREAD; readonly id: string }
  | { readonly kind: typeof FOCUS_KIND.STARTING; readonly pending: PendingThread };

const UNFOCUSED: Focused = { kind: FOCUS_KIND.NONE };

/** The thread drawn open, the one being started under its stand-in id. */
function activeOf(focused: Focused): string | undefined {
  if (focused.kind === FOCUS_KIND.THREAD) return focused.id;

  return focused.kind === FOCUS_KIND.STARTING ? PENDING_THREAD : undefined;
}

const CommentFocusContext = createContext<CommentFocus>({
  active: undefined,
  onActive: () => undefined,
  pending: undefined,
  reveal: () => undefined,
  revealed: undefined,
  listing: undefined,
  onListing: () => undefined,
});

/** Where the description's comments are drawn: which thread is open, and the one being started. */
export function useCommentFocus(): CommentFocus {
  return useContext(CommentFocusContext);
}

/**
 * The agent that wrote an entry: one of the task's own, or, where an agent
 * of another task wrote on the description by naming it, as the window's list
 * across the workspace names it, rather than as an agent no list holds;
 * and whether it is such an agent, which has no tab on this task.
 */
function writerSubject(
  agents: EditAgents,
  agentId: string,
): { subject: AgentSubject; elsewhere: boolean } {
  const line = agents.control.listed?.find((each) => each.id === agentId);
  const subject = agentSubject(agents.control, agentId, NOTHING_HELD, false, line);

  return { subject, elsewhere: subject.agent === undefined && line !== undefined };
}

/** Who wrote an entry as a comment draws them: their face, and their name as every place naming an actor draws it. */
function useWriter(
  writer: DescriptionCommentWriter,
  agents: EditAgents | undefined,
): { author: CommentAuthor; nameRef: ReactNode } {
  const person = usePerson(writer.by);

  if (writer.actor === DESCRIPTION_COMMENT_ACTOR.APP) {
    return { author: commentAuthor(APP_ACTOR), nameRef: <ActorRef actor={APP_ACTOR} nameOnly /> };
  }

  if (
    writer.actor === DESCRIPTION_COMMENT_ACTOR.AGENT &&
    writer.agentId !== undefined &&
    agents !== undefined
  ) {
    const { agentId } = writer;
    const { subject, elsewhere } = writerSubject(agents, agentId);

    return {
      author: commentAuthor(subject.tile),
      nameRef: (
        <AgentActorRef
          subject={subject}
          models={agents.control.models}
          // An agent of another task has no tab on this one to open.
          onOpen={elsewhere ? undefined : () => agents.onOpen?.(agentId)}
          nameOnly
        />
      ),
    };
  }

  // Note that the service names a member's entry by nobody only once their account is deleted.
  const member =
    writer.actor === DESCRIPTION_COMMENT_ACTOR.MEMBER && writer.by === undefined
      ? DELETED_ACCOUNT_ACTOR
      : person;

  return { author: commentAuthor(member), nameRef: <ActorRef actor={member} nameOnly /> };
}

/** One entry of a thread as a comment (`Comment`): its writer's face and name, when it was written, what stands at the head's end, then its words. */
function WrittenComment({
  writer,
  agents,
  said,
  at,
  now,
  trailing,
  children,
}: {
  writer: DescriptionCommentWriter;
  agents: EditAgents | undefined;
  /** What the writer did, said after their name, for a line of what happened to a thread. */
  said?: string;
  at: number;
  now: number;
  trailing?: ReactNode;
  children?: ReactNode;
}): React.JSX.Element {
  const { author, nameRef } = useWriter(writer, agents);

  return (
    <Comment author={author} nameRef={nameRef} said={said} at={at} now={now} trailing={trailing}>
      {children}
    </Comment>
  );
}

/** The mark of who wrote an entry, alone, for a thread at rest's faces. */
function WriterMark({
  writer,
  agents,
}: {
  writer: DescriptionCommentWriter;
  agents: EditAgents | undefined;
}): ReactNode {
  const person = usePerson(writer.by);
  let actor: Actor = person;

  if (writer.actor === DESCRIPTION_COMMENT_ACTOR.APP) actor = APP_ACTOR;
  else if (
    writer.actor === DESCRIPTION_COMMENT_ACTOR.AGENT &&
    writer.agentId !== undefined &&
    agents !== undefined
  ) {
    actor = writerSubject(agents, writer.agentId).subject.tile;
  }

  return <ActorMark actor={actor} />;
}

/** Whether the reader wrote an entry, which only its writer edits or deletes. */
function writtenByReader(entry: DescriptionCommentEntry, me: string | undefined): boolean {
  return (
    entry.writer.actor === DESCRIPTION_COMMENT_ACTOR.MEMBER &&
    me !== undefined &&
    entry.writer.by?.userId === me
  );
}

/** A line of what happened to a thread, drawn as a comment's head is: its writer, what they did, and when, level with every name above it. */
function EventLine({
  entry,
  agents,
  now,
}: {
  entry: DescriptionCommentEntry;
  agents: EditAgents | undefined;
  now: number;
}): React.JSX.Element {
  return (
    <div className="comment-event py-tight-gap" data-kind={entry.kind}>
      <WrittenComment
        writer={entry.writer}
        agents={agents}
        said={
          entry.kind === DESCRIPTION_COMMENT_ENTRY.RESOLVED
            ? COMMENT_WORDS.RESOLVED_IT
            : COMMENT_WORDS.REOPENED_IT
        }
        at={entry.at}
        now={now}
      />
    </div>
  );
}

/** What a thread's controls do, as the card that draws them is handed. */
interface ThreadDoors {
  readonly control: DescriptionCommentsControl;
  readonly agents: EditAgents | undefined;
  readonly me: string | undefined;
  /** The reader's review of the page the threads are on, which a reply may be held in; none on the description, or where comments are not held. */
  readonly review?: PageReviewControl | undefined;
}

/** What deleting asks first, a comment's or a whole thread's, since neither comes back. */
const DELETE_QUESTION: DialogQuestion = {
  title: "Delete this comment?",
  body: `The comment is deleted for everyone. ${IRREVERSIBLE_WORDS}`,
  verb: "Delete comment",
  running: "Deleting",
  loss: CONFIRM_LOSS.IRREVERSIBLE,
  replayUnmasked: true,
};

const DELETE_THREAD_QUESTION: DialogQuestion = {
  title: "Delete this thread?",
  body: `Every comment in it is deleted with it. ${IRREVERSIBLE_WORDS}`,
  verb: "Delete thread",
  running: "Deleting",
  loss: CONFIRM_LOSS.IRREVERSIBLE,
  replayUnmasked: true,
};

/** What discarding a send not sent asks first, since its words and files are kept nowhere else. */
const DISCARD_QUESTION: DialogQuestion = {
  title: "Discard this comment?",
  body: `Its words and files are kept nowhere else. ${IRREVERSIBLE_WORDS}`,
  verb: "Discard comment",
  running: "Discarding",
  loss: CONFIRM_LOSS.IRREVERSIBLE,
  replayUnmasked: true,
};

/** What discarding several sends not sent asks first, a reply refused and those queued behind it. */
const DISCARD_MANY_QUESTION: DialogQuestion = {
  title: "Discard these comments?",
  body: `Their words and files are kept nowhere else. ${IRREVERSIBLE_WORDS}`,
  verb: "Discard comments",
  running: "Discarding",
  loss: CONFIRM_LOSS.IRREVERSIBLE,
  replayUnmasked: true,
};

/** One comment of a thread: who wrote it and when, its words, or the field editing them, and its tools under the pointer. */
function CommentEntry({
  thread,
  entry,
  first,
  doors,
  now,
  lead,
}: {
  thread: DescriptionCommentThread;
  entry: DescriptionCommentEntry;
  first: boolean;
  doors: ThreadDoors;
  now: number;
  /** What stands between the comment's writer and its words: the thread's quote, under the first comment's name, so the thread's tools keep the card's top corner. */
  lead?: ReactNode;
}): React.JSX.Element {
  const [editing, setEditing] = useState<string | undefined>(undefined);

  // The edit's words, kept where they differ from the comment's, so a Cancel or an Esc finds them as the box reopens.
  const edited = useDraft({
    kind: DRAFT_PLACE.DESCRIPTION_COMMENT,
    planId: doors.control.planId,
    on: { threadId: thread.id, entryId: entry.id },
  });

  const drafts = useDraftWriter();

  // Note that a deletion asks first, then is drawn by the host at once, so the dialog closes on the press; one refused is taken back and said in a toast.
  const deleting = useConfirmDialog(
    { subject: true, surfaceOpen: true },
    neverBusyAct(() => {
      void doors.control
        .act(
          thread.id,
          first
            ? { action: DESCRIPTION_COMMENT_ACTION.DELETE_THREAD }
            : { action: DESCRIPTION_COMMENT_ACTION.DELETE, entry: entry.id },
        )
        .then((deleted) => {
          // Words left unsent on what went go with it, so no description is marked holding a draft no box opens.
          if (deleted)
            drafts.drop((place) => writtenOn(place, thread.id, first ? undefined : entry.id));
        });
    }),
    confirmFailure(FAILURE_SURFACE.DESCRIPTION_COMMENT_DELETE),
  );

  const copies = useLinkItems()({
    kind: LINK_DESTINATION.COMMENT,
    planId: doors.control.planId,
    threadId: thread.id,
  });

  const mine = writtenByReader(entry, doors.me);
  // Note that a page thread's first comment is drawn without the quote its quote line already says.
  const shown = first ? ownWordsOf(thread, entry.words ?? "") : (entry.words ?? "");

  // Note that a reply copies its thread's link, since a link names a comment thread and no comment of one (`LINK_DESTINATION.COMMENT`).
  const edits: MenuAction[] = mine
    ? [
        {
          label: COMMENT_WORDS.EDIT,
          icon: <GLYPH.RENAME />,
          onSelect: () => setEditing(edited.draft.text === "" ? shown : edited.draft.text),
        },
      ]
    : [];

  // Note that a thread's starter deletes it whole, or any member where the app or an agent started it, as the service holds it to.
  const deletes: MenuAction[] = [
    ...(mine && !first
      ? [
          {
            label: COMMENT_WORDS.DELETE,
            icon: <TrashIcon />,
            danger: true,
            onSelect: deleting.ask,
          },
        ]
      : []),
    ...(first && (mine || entry.writer.actor !== DESCRIPTION_COMMENT_ACTOR.MEMBER)
      ? [
          {
            label: COMMENT_WORDS.DELETE_THREAD,
            icon: <TrashIcon />,
            danger: true,
            onSelect: deleting.ask,
          },
        ]
      : []),
  ];

  const groups = [copies, edits, deletes].filter((group) => group.length > 0);
  const settle = first && openThread(thread);

  // Note that a resolve or a reopen is drawn by the host on the press; one refused is taken back and said in a toast.
  const settleThread = () =>
    void doors.control.act(thread.id, {
      action: settle ? DESCRIPTION_COMMENT_ACTION.RESOLVE : DESCRIPTION_COMMENT_ACTION.REOPEN,
    });

  // The reader's own words take a date changed from its chip, as their editor would, saved as an edit of the comment.
  const openDate = useWordsDatePicker();
  const latestWords = useRef(entry.words);
  latestWords.current = entry.words;
  const { control } = doors;

  const dates = useMemo<WordsDates | undefined>(
    () =>
      !mine || openDate === undefined
        ? undefined
        : wordsDatesDoor(
            openDate,
            () => latestWords.current,
            (words) => {
              // Note that a comment is never saved empty, so Clear on a comment of a date alone leaves it.
              if (words.trim() === "") return;
              void control.act(thread.id, {
                action: DESCRIPTION_COMMENT_ACTION.EDIT,
                entry: entry.id,
                words: words.trim(),
              });
            },
          ),
    [mine, openDate, control, thread.id, entry.id],
  );

  const write = (words: string) => {
    setEditing(words);
    // Note that words as the comment holds them, or none, keep no draft, so the box reopens on the comment as it stands.
    edited.update((was) => ({
      ...was,
      text: words.trim() === "" || words === shown ? "" : words,
    }));
  };

  const save = (files: EditedFiles) => {
    const words = editing?.trim() ?? "";

    // Note that a comment is never saved empty, so an edit emptied asks to delete it, as its menu's Delete does.
    if (words === "") {
      deleting.ask();

      return;
    }

    // Note that the edit is drawn by the host on the press, so the field closes at once; words refused come back as its draft (`use-description-comments.ts`), and its files here, which Edit opens on again.
    setEditing(undefined);
    edited.update(() => EMPTY_DRAFT);
    const carried = entry.files ?? [];
    void doors.control
      .act(thread.id, {
        action: DESCRIPTION_COMMENT_ACTION.EDIT,
        entry: entry.id,
        words,
        ...filesChanged(carried, files),
      })
      .then((landed) => {
        if (landed) return;
        const kept = new Set(files.kept.map((file) => file.attachmentId));
        edited.update((was) => ({
          ...was,
          attachments: files.added,
          dropped: carried.map((file) => file.attachmentId).filter((id) => !kept.has(id)),
        }));
      });
  };

  // The files the edit changes, kept in its draft beside its words.
  const editFiles: EditFilesHolder = {
    files: { dropped: edited.draft.dropped ?? [], attachments: edited.draft.attachments },
    update: (next) =>
      edited.update((was) => {
        const files = next({ dropped: was.dropped ?? [], attachments: was.attachments });

        return { ...was, dropped: files.dropped, attachments: files.attachments };
      }),
  };

  return (
    <div className="comment-entry relative py-tight-gap" data-entry={entry.id}>
      {/* Note that the tools stand at the head's end, shown under the pointer or the keyboard, so a long name gives way to them and nothing stands over it. */}
      <WrittenComment
        writer={entry.writer}
        agents={doors.agents}
        at={entry.at}
        now={now}
        trailing={
          <>
            {entry.editedAt === undefined ? null : (
              <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED} as={TEXT_ELEMENT.SPAN}>
                <ReplayUnmask>{COMMENT_WORDS.EDITED}</ReplayUnmask>
              </Text>
            )}
            <CommentTools>
              {first ? (
                <Tooltip label={settle ? COMMENT_WORDS.RESOLVE : COMMENT_WORDS.REOPEN}>
                  <IconButton
                    size={BUTTON_SIZE.COMPACT}
                    icon={settle ? <CheckIcon /> : <RotateCcwIcon />}
                    label={settle ? COMMENT_WORDS.RESOLVE : COMMENT_WORDS.REOPEN}
                    // Note that the host draws a resolve or a reopen on the press, so the check is never busy.
                    busy={false}
                    onClick={settleThread}
                  />
                </Tooltip>
              ) : null}
              <CommentMenu groups={groups} />
            </CommentTools>
            <ConfirmDialog
              open
              confirm={deleting}
              question={first ? DELETE_THREAD_QUESTION : DELETE_QUESTION}
            />
          </>
        }
      >
        {lead}
        {editing === undefined ? (
          <>
            <WordsDatesContext.Provider value={dates}>
              <PostedComment
                planId={doors.control.planId}
                files={entry.files ?? NO_FILES}
                words={shown}
              />
            </WordsDatesContext.Provider>
          </>
        ) : (
          <CommentEditField
            planId={doors.control.planId}
            files={entry.files ?? NO_FILES}
            changes={editFiles}
            value={editing}
            onChange={write}
            onSave={save}
            onCancel={() => setEditing(undefined)}
          />
        )}
      </WrittenComment>
    </div>
  );
}

/**
 * The field a comment's words are edited in, in their place, on the message
 * box as the field a thread's first comment is written in: the words stay
 * where they were read, bare on the card with no box around them, and the
 * box's foot stands under them, its + and microphone and Cancel beside the
 * round send, which saves. The box holds the comment's own files first, as
 * entries of its own (`useCommentFileEntries`), and the files added by the
 * +, a paste, or a drop after them, so the two are taken off alike and held
 * together to the bounds of one message's; the edit keeps what changed as
 * the ids it took off and the files it added.
 */
function CommentEditField({
  planId,
  files,
  attached = NO_ATTACHMENTS,
  changes: handed,
  value,
  onChange,
  onSave,
  onCancel,
}: {
  planId: string;
  /** The files the service keeps for the comment. */
  files: readonly DescriptionCommentFile[];
  /** The files the window holds for it as the edit opens, a held comment's not yet sent; none for a posted one's. */
  attached?: readonly AgentAttachment[];
  /** Where what the edit changes of the files is kept, as its words are, so Cancel, Esc, or a save refused finds them as the edit opens again; the field keeps its own where none is handed. */
  changes?: EditFilesHolder | undefined;
  value: string;
  onChange: (words: string) => void;
  /** Saves the words, with the files the field holds. */
  onSave: (files: EditedFiles) => void;
  onCancel: () => void;
}): React.JSX.Element {
  const [own, setOwn] = useState<EditFiles>({ dropped: [], attachments: attached });
  const changes = handed ?? { files: own, update: setOwn };
  const { entries, idOf } = useCommentFileEntries(planId, files);

  /** The box's files for what the edit changed: the comment's own it keeps, then those added. */
  const held = (edit: EditFiles) => [
    ...entries.filter((entry) => !edit.dropped.includes(idOf(entry) ?? "")),
    ...edit.attachments,
  ];

  const box = useMessageBox({
    draft: value,
    setDraft: onChange,
    placeholder: COMMENT_WORDS.EDIT,
    label: COMMENT_WORDS.EDIT,
    maxLength: DESCRIPTION_COMMENT_BOUNDS.MAX_WORDS_CHARS,
    // Note that what the box holds after a change is read back as the comment's files it no longer holds and the files it added.
    holder: {
      attachments: held(changes.files),
      update: (next) =>
        changes.update((was) => {
          const now = next(held(was));

          return {
            dropped: entries.flatMap((entry) => {
              const id = idOf(entry);

              return id === undefined || now.includes(entry) ? [] : [id];
            }),
            attachments: now.filter((entry) => idOf(entry) === undefined),
          };
        }),
    },
    onLeave: onCancel,
    onSubmit: () => {
      if (box.files.reading) return;
      // Note that a file the box holds no entry of is kept as it stands, after those it holds, in their order.
      const held = new Set(box.files.attachments.flatMap((entry) => idOf(entry) ?? []));

      const unheld = files.filter(
        (file) => !entries.some((entry) => idOf(entry) === file.attachmentId),
      );

      onSave({
        kept: [
          ...[...held].flatMap((id) => files.find((file) => file.attachmentId === id) ?? []),
          ...unheld,
        ],
        added: box.files.attachments.filter((entry) => idOf(entry) === undefined),
      });
    },
    focus: true,
  });

  return (
    <MessageBox
      box={box}
      look={REPLY_LOOK[REPLY_VARIANT.EDIT]}
      className="comment-field comment-editing"
      data-variant={REPLY_VARIANT.EDIT}
      beforeSend={
        <Button variant={BUTTON_VARIANT.QUIET} size={BUTTON_SIZE.COMPACT} onClick={onCancel}>
          <ReplayUnmask>{COMMENT_WORDS.CANCEL}</ReplayUnmask>
        </Button>
      }
      // Note that an edit emptied asks to delete the comment, so the send takes a press while empty, that it waits on files still read, and that an edit is drawn on the press, which closes the field, so it is never busy.
      send={{ label: COMMENT_WORDS.SAVE, empty: false, held: box.files.reading }}
    />
  );
}

/** The files an edit's field holds as it saves: the comment's own it kept, in order, and those added after them. */
interface EditedFiles {
  readonly kept: readonly DescriptionCommentFile[];
  readonly added: readonly AgentAttachment[];
}

/** The files an edit changes as it stands open: the comment's own taken off, by their ids, and those added. */
interface EditFiles {
  readonly dropped: readonly string[];
  readonly attachments: readonly AgentAttachment[];
}

/** Where an edit's files are kept while it stands open, and how they change. */
interface EditFilesHolder {
  readonly files: EditFiles;
  readonly update: (next: (was: EditFiles) => EditFiles) => void;
}

/** A comment that carries no files. */
const NO_FILES: readonly DescriptionCommentFile[] = [];

/** An edit that opens holding no files of the window's. */
const NO_ATTACHMENTS: readonly AgentAttachment[] = [];

/** What an edit says of its comment's files: nothing where it leaves them as they stand, else the files it keeps by their ids, in order, and those it adds. */
function filesChanged(
  carried: readonly DescriptionCommentFile[],
  { kept, added }: EditedFiles,
): { readonly keep?: readonly string[]; readonly attachments?: readonly AgentAttachment[] } {
  const keep = kept.map((file) => file.attachmentId);

  const same =
    keep.length === carried.length && keep.every((id, at) => carried[at]?.attachmentId === id);

  if (same && added.length === 0) return {};

  return { keep, ...(added.length === 0 ? undefined : { attachments: added }) };
}

/**
 * A comment's words without the quote of `quote` they open with, which a
 * page comment's quote line already says: a comment started on an element
 * used to carry its element's words as its first quote. Words holding
 * nothing past that quote are kept whole, so a comment never reads empty.
 */
function leadQuoteDropped(words: string, quote: string): string {
  const [lead, ...rest] = messageBlocks(words);

  if (lead?.kind !== MESSAGE_BLOCK.QUOTE || lead.words !== replyOf(quote)) return words;
  const own = messageText(rest).trim();

  return own === "" ? words : own;
}

/** A thread's first comment's words as drawn: on a page's element, without the element's words it opens with. */
function ownWordsOf(thread: DescriptionCommentThread, words: string): string {
  return thread.page?.element === undefined ? words : leadQuoteDropped(words, thread.quote);
}

/** A comment's words as Markdown, its mentions drawn as their chips, as a message's are, and each file of its own they name (`files`) drawn where its marker stands. */
function CommentWords({
  words,
  files,
}: {
  words: string;
  files?: WordFiles | undefined;
}): React.JSX.Element {
  const link = useMentionLink();
  const openLink = useOpenLink();

  return (
    <MarkdownMessage
      words={files === undefined ? words : withFileImages(words, files.names)}
      className="comment-words block text-body-foreground wrap-anywhere"
      link={link}
      openLink={openLink}
      picture={
        files === undefined
          ? undefined
          : (src) => {
              const name = fileNameOf(src);

              return name === undefined ? undefined : files.chip(name);
            }
      }
    />
  );
}

/** Where a file's marker is written as an image, so the words' own image drawer draws its chip: a link within the page, which every link transform keeps. */
const FILE_SOURCE = "#file:";

/**
 * The words with each marker outside code that names one of `names` written
 * as an image of that file, so it is drawn where it stands. Note that the
 * image says nothing of the file but its source, its name encoded there,
 * because a name may spell Markdown that would read in its words.
 */
function withFileImages(words: string, names: ReadonlySet<string>): string {
  let written = "";
  let at = 0;

  for (const marker of fileMarkers(words)) {
    if (!names.has(marker.name)) continue;
    written += `${words.slice(at, marker.start)}![](${FILE_SOURCE}${encodeURIComponent(marker.name)})`;
    at = marker.end;
  }

  return written + words.slice(at);
}

/** The file an image written by `withFileImages` names; nothing for any other image, nor for one typed by hand whose source does not decode, which is its alt text. */
function fileNameOf(src: string): string | undefined {
  if (!src.startsWith(FILE_SOURCE)) return undefined;

  try {
    return decodeURIComponent(src.slice(FILE_SOURCE.length));
  } catch {
    return undefined;
  }
}

/**
 * A comment's body: its words, the files they name drawn in them, and its
 * other files over them, as every message's stand: those sent before
 * markers, or named only in code. A folded card draws the words alone.
 */
function CommentBody({
  chips,
  words,
  folded = false,
}: {
  chips: readonly FileChip[];
  words: string;
  folded?: boolean | undefined;
}): React.JSX.Element {
  const shown = useWordFiles(chips, words);

  return (
    <>
      {folded ? null : <CommentFiles chips={shown.beside} />}
      <CommentWords words={words} files={shown.named} />
      {shown.viewer}
    </>
  );
}

/** A posted comment's body as `CommentBody` draws it, each of its files read as the description's. */
function PostedComment({
  planId,
  files,
  words,
  folded,
}: {
  planId: string;
  files: readonly DescriptionCommentFile[];
  words: string;
  folded?: boolean | undefined;
}): React.JSX.Element {
  return <CommentBody chips={useCommentFileChips(planId, files)} words={words} folded={folded} />;
}

/** What a field that may hold its words in the writer's review is handed. */
interface CommentReview {
  /** Whether the writer already holds comments in the review, so Return adds to it rather than posting. */
  readonly open: boolean;
  /** Holds the words and files in the review, unsent. */
  readonly onHold: (words: string, attachments: readonly AgentAttachment[]) => void;
}

/** The field under a thread that answers it, or starts it where it is the thread being started. */
function ReplyField({
  label,
  place,
  onSend,
  onCancel,
  autoFocus,
  failure,
  variant = REPLY_VARIANT.REPLY,
  review,
}: {
  label: string;
  /** Where the words are kept unsent, so Esc, a press away, or the thread closing finds them as the field opens again. */
  place: DescriptionCommentPlace;
  /** Sends the words and the files under a key that stays the same while they do, so a send tried again after a lost answer is taken once; answers whether they landed. */
  onSend: (
    words: string,
    clientKey: string,
    attachments: readonly AgentAttachment[],
  ) => Promise<boolean>;
  /** What Escape does once no list or dictation takes it; none gives up the caret, as a thread that stands open with nothing to close does. */
  onCancel?: (() => void) | undefined;
  autoFocus: boolean;
  /** Why the last act on the thread did not go, which the foot says under the box; none while nothing failed. */
  failure?: string | undefined;
  /** A thread's first comment, which is the card itself, or a reply under its comments, which stays a line until it is used. */
  variant?: ReplyVariant;
  /** Where the words may be held in the writer's review rather than posted; none where they may not. */
  review?: CommentReview | undefined;
}): React.JSX.Element {
  const { draft, update } = useDraft(place);
  const words = draft.text;
  const setWords = (text: string) => update((was) => ({ ...was, text }));

  const box = useMessageBox({
    draft: words,
    setDraft: setWords,
    placeholder: label,
    label,
    maxLength: DESCRIPTION_COMMENT_BOUNDS.MAX_WORDS_CHARS,
    onLeave: onCancel,
    onSubmit: () => submit(),
    focus: autoFocus,
  });

  const { files } = box;
  // The last send refused, whose key the same words and files sent again go under, so a send whose answer was lost is taken once.
  const attempt = useRef<CommentSend | undefined>(undefined);
  // Sends refused that the field could not take back beside what was typed or added since, kept apart in the order written, marked as not sent, with Retry under their keys.
  const lines = useSelector(unsentLines.store);
  const unsent = lines.filter((each) => Equal.equals(each.place, place)).map(({ send }) => send);
  const keepUnsent = unsentLines.set;

  const addUnsent = (sends: readonly CommentSend[]) =>
    keepUnsent((all) => [...all, ...sends.map((send) => ({ place, send }))]);

  const dropUnsent = () =>
    keepUnsent((all) => all.filter((each) => !Equal.equals(each.place, place)));

  // The words the field holds this moment, for a send's answer that lands after the render it was made in.
  const wordsNow = useRef(words);
  wordsNow.current = words;
  // Whether the field still stands, since sends refused after their thread closed have no field to come back into.
  const standing = useRef(true);
  useEffect(() => {
    standing.current = true;

    return () => {
      standing.current = false;
    };
  }, []);

  // Note that a refused send goes back above whatever was typed or added since, so neither is dropped, unless the field is gone or the two together are more than one comment carries; sends refused together stand apart under their own keys, so one the service wrote before its answer was lost is not written again under a new one.
  const takeBack = (sends: readonly CommentSend[]) => {
    const [first] = sends;

    if (first === undefined) return;
    attempt.current = first;
    const typed = wordsNow.current;

    const back = {
      words: typed.trim() === "" ? first.words : `${first.words}\n\n${typed}`,
      attachments: [...first.attachments, ...files.now()],
    };

    if (sends.length > 1 || !standing.current || !carried(back)) {
      addUnsent(sends);

      return;
    }

    update((now) => ({ ...now, text: back.words }));
    files.set(back.attachments);
  };

  // Note that the host draws a send the moment it is asked and sends a thread's in the order asked, so nothing here waits on one; one refused comes back.
  const go = (out: CommentSend) => {
    void onSend(out.words, out.key, out.attachments).then((sent) => {
      if (!sent) takeBack([out]);
    });
  };

  const send = () => {
    const trimmed = words.trim();

    // Note that sends not sent go first, so comments land in the order they were written.
    if (trimmed === "" || files.reading || unsent.length > 0) return;
    const { attachments } = files;
    const was = attempt.current;
    const same = was?.words === trimmed && sameFiles(was.attachments, attachments);
    // Note that the key is let go as the words go, since the same words sent again while they are out, or once they land, are a new comment.
    attempt.current = undefined;
    // Note that the field empties as the words are sent, since a send may wait on the ones before it and on those its mentions hand the thread to.
    setWords("");
    files.set([]);
    go({
      words: trimmed,
      attachments,
      key: same ? was.key : crypto.randomUUID(),
    });
  };

  // Note that holding lets the words and files go from the field as sending does, into the review rather than to the service.
  const hold = () => {
    const trimmed = words.trim();

    if (review === undefined || trimmed === "" || files.reading || unsent.length > 0) return;
    const { attachments } = files;
    attempt.current = undefined;
    setWords("");
    files.set([]);
    review.onHold(trimmed, attachments);
  };

  // Note that once a review is held, every comment joins it until it is sent or discarded, as a batch of notes on a page does; until then Start a review stands beside the send.
  const holds = review?.open === true;
  const submit = holds ? hold : send;

  const other =
    review === undefined || holds ? undefined : (
      <Button
        size={BUTTON_SIZE.COMPACT}
        disabled={words.trim() === "" || files.reading || unsent.length > 0}
        onClick={hold}
      >
        <ReplayUnmask>{PAGE_REVIEW_WORDS.START}</ReplayUnmask>
      </Button>
    );

  const retry = () => {
    if (unsent.length === 0) return;
    dropUnsent();

    for (const each of unsent) go(each);
  };

  // Note that Discard asks first, since a send not sent is kept nowhere else.
  const discard = useConfirmDialog(
    { subject: unsent.length > 0, surfaceOpen: true },
    neverBusyAct(() => {
      dropUnsent();
      // Note that words written again after a discard are a new comment, so they go under a new key.
      attempt.current = undefined;
    }),
    confirmFailure(FAILURE_SURFACE.DESCRIPTION_COMMENT_DISCARD),
  );

  return (
    <MessageBox
      box={box}
      look={REPLY_LOOK[variant]}
      className="comment-field"
      data-variant={variant}
      // Note that held files and files still being read, and a dictation whose words land once heard, hold the field, so a press away keeps a thread being started; typed words are kept as its draft and hold nothing.
      data-held={files.attachments.length > 0 || files.reading || box.dictating}
      {...files.drop.target}
      head={
        unsent.length === 0 ? null : (
          <div className="comment-unsent" data-unsent="">
            {unsent.map((each) => (
              <CommentBody
                key={each.key}
                chips={attachmentChips(each.attachments)}
                words={each.words}
              />
            ))}
            <FailureNote
              onRetry={retry}
              failure={failureShown({
                surface: FAILURE_SURFACE.DESCRIPTION_COMMENT_SEND,
                cause:
                  failure === undefined ? FAILURE_CONDITION.NOT_KEPT : FAILURE_CONDITION.REFUSED,
              })}
              also={
                <TextButton tone={TEXT_BUTTON_TONE.QUIET} onClick={discard.ask}>
                  <ReplayUnmask>{COMMENT_WORDS.DISCARD}</ReplayUnmask>
                </TextButton>
              }
            >
              {/* Note that a refusal's words are the service's, so only the app's own note shows. */}
              {failure ?? (
                <ReplayUnmask>
                  {unsent.length === 1 ? COMMENT_WORDS.NOT_SENT : COMMENT_WORDS.NOT_SENT_MANY}
                </ReplayUnmask>
              )}
            </FailureNote>
            <ConfirmDialog
              open
              confirm={discard}
              question={unsent.length === 1 ? DISCARD_QUESTION : DISCARD_MANY_QUESTION}
            />
          </div>
        )
      }
      actions={other}
      send={{
        label: holds
          ? PAGE_REVIEW_WORDS.ADD
          : label === COMMENT_WORDS.ADD
            ? COMMENT_WORDS.COMMENT
            : COMMENT_WORDS.REPLY,
        empty: words.trim() === "",
        held: files.reading || unsent.length > 0,
      }}
      // Note that a failed send is said over the box's own notes, a refused file, a dictation's, a cut paste, or an editor that did not load, unless it stands on the not-sent line.
      note={
        unsent.length === 0 && failure !== undefined
          ? {
              words: failure,
              failure: failureShown({
                surface: FAILURE_SURFACE.DESCRIPTION_COMMENT_SEND,
                cause: FAILURE_CONDITION.REFUSED,
                refused: true,
              }),
            }
          : undefined
      }
    />
  );
}

/** Whether a draft's place is a comment's of a thread: any of its own, or one comment's edit where `entryId` names it. */
function writtenOn(place: DraftPlace, threadId: string, entryId: string | undefined): boolean {
  if (place.kind !== DRAFT_PLACE.DESCRIPTION_COMMENT || !("threadId" in place.on)) return false;

  if (place.on.threadId !== threadId) return false;

  return entryId === undefined || ("entryId" in place.on && place.on.entryId === entryId);
}

/** One comment's words and files as they are sent, under the key a send tried again goes under. */
interface CommentSend {
  readonly words: string;
  readonly attachments: readonly AgentAttachment[];
  readonly key: string;
}

/**
 * Each window's sends marked as not sent, by the place they were written
 * in and in the order written there, kept past their field for the account
 * that wrote them as its drafts are (`heldLines`), so a thread closed and
 * opened again finds its line where it was left, another account signed in
 * to the window reads none, and one written while only the account's
 * address was known stands still once its identity learns its id. Note that
 * each window holds its own.
 */
const unsentLines = heldLines<{
  readonly place: DescriptionCommentPlace;
  readonly send: CommentSend;
}>();

/** Whether one comment carries these words and files: its words' bound, and a message's count of files and their bytes together. */
function carried(send: Pick<CommentSend, "words" | "attachments">): boolean {
  if (send.words.length > DESCRIPTION_COMMENT_BOUNDS.MAX_WORDS_CHARS) return false;

  if (send.attachments.length > AGENT_BOUNDS.MAX_ATTACHMENTS) return false;
  const bytes = send.attachments.reduce((sum, each) => sum + base64Bytes(each.data), 0);

  return bytes <= AGENT_BOUNDS.MAX_ATTACHMENTS_BYTES;
}

/** Whether two sends carry the same files, each the very one read, in the same order. */
function sameFiles(was: readonly AgentAttachment[], now: readonly AgentAttachment[]): boolean {
  return was.length === now.length && was.every((file, at) => file === now[at]);
}

/** Over a thread whose words were deleted: that they were, and what they said. */
function GoneQuote({
  thread,
  onShowWords,
}: {
  thread: DescriptionCommentThread;
  /** Shows where the words stood, their section's start; none where the quote is only words. */
  onShowWords?: (() => void) | undefined;
}): React.JSX.Element {
  return (
    <>
      <div className="comment-gone">
        <TrashIcon />
        <ReplayUnmask>{COMMENT_WORDS.GONE}</ReplayUnmask>
      </div>
      <ThreadQuote thread={thread} gone onShowWords={onShowWords} />
    </>
  );
}

/** A quote line over a comment: the words it is on, whole where they were chosen, or a press that shows them where they stand, labeled `label`, where one is offered. */
function QuoteLine({
  words,
  label,
  whole = false,
  gone = false,
  onShow,
}: {
  words: string;
  label: string;
  /** Whether the words were chosen, a few of a block's, so they are quoted whole rather than cut to two lines. */
  whole?: boolean;
  gone?: boolean;
  onShow?: (() => void) | undefined;
}): React.JSX.Element {
  if (onShow === undefined) {
    return (
      <blockquote className={COMMENT_QUOTE_CLASS} data-clipped={!whole} data-gone={gone}>
        {words}
      </blockquote>
    );
  }

  return (
    <blockquote className={COMMENT_QUOTE_CLASS} data-clipped={!whole} data-gone={gone}>
      <Tooltip label={label}>
        <LineButton look={LINE_BUTTON_LOOK.QUOTE} onClick={onShow}>
          {words}
        </LineButton>
      </Tooltip>
    </blockquote>
  );
}

/** A thread's quote over it, the words it is on (on a page, its element's, or the page's title for the whole page), or a press that shows them in the description, or its element on the page, where it is offered. */
function ThreadQuote({
  thread,
  gone = false,
  onShowWords,
}: {
  thread: DescriptionCommentThread;
  gone?: boolean;
  onShowWords?: (() => void) | undefined;
}): React.JSX.Element {
  return (
    <QuoteLine
      words={thread.quote}
      label={thread.page === undefined ? COMMENT_WORDS.SHOW_WORDS : COMMENT_WORDS.SHOW_ELEMENT}
      whole={thread.scope === DESCRIPTION_COMMENT_SCOPE.WORDS}
      gone={gone}
      onShow={onShowWords}
    />
  );
}

/**
 * How a thread's card stands where it is: open over the page, raised on a
 * menu's shadow, as at rest under a count, where it floats with the open
 * one; at rest in the margin, its edge alone on the column's ground; and in
 * the description's comments list, where every thread stands whole on the panel's ground,
 * its edge alone.
 */
function threadFrame(place: ThreadPlace, open: boolean): { look: CardLook; shadow: CardShadow } {
  const raised = place === THREAD_PLACE.FLOAT || (open && place === THREAD_PLACE.MARGIN);

  return raised
    ? { look: CARD_LOOK.RAISED, shadow: CARD_SHADOW.MENU }
    : { look: CARD_LOOK.OUTLINE, shadow: CARD_SHADOW.NONE };
}

/**
 * A thread's card, raised or outlined by where it stands and whether it is
 * open (`threadFrame`), in a comment's own type and inset. Every thread
 * draws it, and so do the list's placeholder cards, so a thread
 * lands where its placeholder stood.
 */
function CommentCard({
  place,
  open,
  hover = CARD_HOVER.NONE,
  lit,
  children,
  ...data
}: {
  place: ThreadPlace;
  open: boolean;
  hover?: CardHover;
  lit?: boolean | undefined;
  "data-thread"?: string | undefined;
  "data-pointed"?: boolean | undefined;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <Card
      {...threadFrame(place, open)}
      corner={CARD_CORNER.MENU}
      padding={CARD_PADDING.NONE}
      hover={hover}
      lit={lit}
      className="comment-card px-list-inset py-row-inset text-body text-foreground data-[open=false]:cursor-press"
      data-open={String(open)}
      {...data}
    >
      {children}
    </Card>
  );
}

/** One row of the description's comments list, a step from the next: a thread's card, or a placeholder's. */
function CommentsRow({ children }: { children: ReactNode }): React.JSX.Element {
  return <div className="comments-row [.comments-row+&]:mt-control-gap">{children}</div>;
}

/**
 * One thread as the margin, a count's card, or the description's comments list draws it:
 * open, every entry, the reader's replies on their way after them in the
 * order sent, and the field that answers it; at rest, its first comment and
 * the faces and count of its replies, which opens it.
 */
function ThreadCard({
  thread,
  open,
  place,
  doors,
  onOpen,
  onClose,
  quote = false,
  pointed = false,
  onShowWords,
}: {
  thread: DescriptionCommentThread;
  open: boolean;
  place: ThreadPlace;
  doors: ThreadDoors;
  /** Opens the card at rest; none where it always stands open, as in the description's comments list. */
  onOpen?: (() => void) | undefined;
  /** Closes it, as its field's Escape asks; none where it stands open, whose field's Escape gives up the caret. */
  onClose?: (() => void) | undefined;
  /** Whether the quote stands over it, as in the description's comments list, where its words are not beside it. */
  quote?: boolean;
  /** Whether the pointer is on the thread's words, which the card at rest answers as it answers the pointer itself. */
  pointed?: boolean;
  /** Shows the thread's words where the description holds them, which its quote offers; none where the quote is only words. */
  onShowWords?: (() => void) | undefined;
}): React.JSX.Element {
  const now = useMinute();

  const comments = thread.entries.filter(
    (entry) => entry.kind === DESCRIPTION_COMMENT_ENTRY.COMMENT,
  );

  const [first] = comments;
  // Note that a page's thread stands on no words of the description, so it never reads as having lost them.
  const gone = thread.anchor === undefined && thread.page === undefined;
  const note = doors.control.notes.get(thread.id);
  const { review } = doors;
  const heldReplies = review?.held.filter((comment) => comment.reply?.threadId === thread.id) ?? [];
  // Whether a press on the card at rest opened it, which is what hands its reply the caret; a thread open from the first, as every one in the description's comments list, takes none.
  const [pressed, setPressed] = useState(false);
  useEffect(() => {
    if (!open) setPressed(false);
  }, [open]);

  const head = (
    <>
      {gone ? <GoneQuote thread={thread} onShowWords={onShowWords} /> : null}
      {!gone && quote ? <ThreadQuote thread={thread} onShowWords={onShowWords} /> : null}
    </>
  );

  if (!open) {
    const replies = comments.slice(1);

    const faces = [
      ...new Map(replies.map((entry) => [JSON.stringify(entry.writer), entry.writer])).values(),
    ];

    return (
      <CommentCard
        place={place}
        open={false}
        hover={CARD_HOVER.WASH}
        lit={pointed}
        data-pointed={pointed}
        data-thread={thread.id}
      >
        {head}
        {/* Note that the words are drawn as they are open, their chips with them, clamped; the card's press opens the thread. */}
        {first === undefined ? null : (
          <WrittenComment writer={first.writer} agents={doors.agents} at={first.at} now={now}>
            <div className="comment-clamp line-clamp-3">
              <PostedComment
                planId={doors.control.planId}
                files={first.files ?? NO_FILES}
                words={ownWordsOf(thread, first.words ?? "")}
                folded
              />
            </div>
          </WrittenComment>
        )}
        {/* Note that the whole card at rest is one press that opens it, but for a control of its own inside it, an agent's name say, and a mention's chip opens it as it takes its own press; its button is the keyboard's way in, the replies drawn on it, or its name alone where there are none. */}
        <CardPress
          reach={CARD_PRESS_REACH.CARD}
          alsoPressedBy={MENTION_REF}
          corner={CARD_PRESS_CORNER.MENU}
          onPress={() => {
            setPressed(true);
            onOpen?.();
          }}
        >
          {replies.length === 0 ? (
            <VisuallyHidden>
              <ReplayUnmask>{COMMENT_WORDS.OPEN_THREAD}</ReplayUnmask>
            </VisuallyHidden>
          ) : (
            <span className="mt-list-gap mr-0 mb-0 ml-comment-indent flex items-center gap-item-gap text-caption-inline text-muted-foreground">
              <span className="inline-flex">
                {faces.map((writer) => (
                  <WriterMark key={JSON.stringify(writer)} writer={writer} agents={doors.agents} />
                ))}
              </span>
              <ReplayUnmask>
                {replies.length === 1 ? "1 reply" : `${replies.length} replies`}
              </ReplayUnmask>
              <span className="comment-time">
                {" · "}
                <Time at={replies.at(-1)?.at ?? thread.updatedAt} now={now} />
              </span>
            </span>
          )}
        </CardPress>
      </CommentCard>
    );
  }

  return (
    <CommentCard place={place} open data-thread={thread.id}>
      {/* Note that the entries scroll inside a card taller than the room it stands in, so the field that answers them stays in view under them; a swipe past their end, or over a card with nothing to scroll, moves the description. */}
      <ScrollArea
        size={SCROLL_SIZE.CONTENT}
        fade={SCROLL_FADE.BOTH}
        overscroll={SCROLL_OVERSCROLL.CHAIN}
      >
        <div className="comment-entries">
          {first === undefined ? head : null}
          {thread.entries.map((entry) =>
            entry.kind === DESCRIPTION_COMMENT_ENTRY.COMMENT ? (
              <CommentEntry
                key={entry.id}
                thread={thread}
                entry={entry}
                first={entry.id === first?.id}
                doors={doors}
                now={now}
                lead={entry.id === first?.id ? head : undefined}
              />
            ) : // Note that who a thread was sent to is the mention in its words, so the line an ask writes is the service's to keep and none to draw.
            entry.kind === DESCRIPTION_COMMENT_ENTRY.ASKED ? null : (
              <EventLine key={entry.id} entry={entry} agents={doors.agents} now={now} />
            ),
          )}
          {/* Note that the reader's replies held in their review stand last, Pending, as a pull request's pending replies do. */}
          {review === undefined
            ? null
            : heldReplies.map((comment) => (
                <PendingPageComment
                  key={comment.clientKey}
                  comment={comment}
                  review={review}
                  busy={review.sending}
                />
              ))}
        </div>
      </ScrollArea>
      {thread.status === DESCRIPTION_COMMENT_STATUS.OPEN ? (
        <ReplyField
          label={COMMENT_WORDS.REPLY}
          place={{
            kind: DRAFT_PLACE.DESCRIPTION_COMMENT,
            planId: doors.control.planId,
            on: { threadId: thread.id },
          }}
          autoFocus={pressed}
          failure={note}
          review={
            review === undefined || thread.page === undefined
              ? undefined
              : {
                  open: review.held.length > 0,
                  onHold: (words, attachments) =>
                    review.hold({
                      clientKey: crypto.randomUUID(),
                      version: thread.page?.version ?? 0,
                      element: undefined,
                      reply: {
                        threadId: thread.id,
                        quote: thread.quote,
                        ...(thread.page?.element === undefined
                          ? undefined
                          : { path: thread.page.element }),
                      },
                      words,
                      attachments,
                    }),
                }
          }
          onCancel={onClose}
          onSend={(words, clientKey, attachments) =>
            doors.control.act(thread.id, {
              action: DESCRIPTION_COMMENT_ACTION.REPLY,
              clientKey,
              words,
              // Note that a reply with no files sends no key for them, so a service from before files reads it as it always did.
              ...(attachments.length === 0 ? undefined : { attachments }),
            })
          }
        />
      ) : null}
    </CommentCard>
  );
}

/** A thread's first comment as its field sends it, under the key it keeps while it is sent again, and the id of the thread it starts. */
interface FirstComment {
  readonly id: string;
  readonly clientKey: string;
  readonly words: string;
  readonly attachments?: readonly AgentAttachment[];
}

/**
 * The thread being started, its field focused, which posts its first
 * comment: on the description's words, or on a page or one of its elements, as
 * `begin` makes the start of it. The thread is started under the key its
 * first comment is sent under, so a send tried again names the same
 * thread, and the host draws it the moment it is asked, so the card hands
 * its place to the thread at once.
 */
function PendingCard({
  on,
  place = THREAD_PLACE.MARGIN,
  head,
  doors,
  begin,
  onStarted,
  onCancel,
  review,
}: {
  /** What the thread is started on, which its unsent words are kept under. */
  on: { readonly quote: string; readonly scope: DescriptionCommentThread["scope"] };
  place?: ThreadPlace;
  /** What stands over the field, the quote where its words are not beside it. */
  head?: ReactNode;
  doors: ThreadDoors;
  begin: (first: FirstComment) => DescriptionCommentStart;
  /** Hands the card's place to the thread it started, by its id. */
  onStarted: (threadId: string) => void;
  onCancel: () => void;
  /** Where its first comment may be held in the writer's review rather than posted; the card closes once it is. */
  review?: CommentReview | undefined;
}): React.JSX.Element {
  return (
    <CommentCard place={place} open data-thread={PENDING_THREAD}>
      {head}
      <ReplyField
        label={COMMENT_WORDS.ADD}
        place={{ kind: DRAFT_PLACE.DESCRIPTION_COMMENT, planId: doors.control.planId, on }}
        autoFocus
        onCancel={onCancel}
        variant={REPLY_VARIANT.FIRST}
        review={
          review === undefined
            ? undefined
            : {
                open: review.open,
                onHold: (words, attachments) => {
                  review.onHold(words, attachments);
                  onCancel();
                },
              }
        }
        onSend={(words, clientKey, attachments) => {
          const started = doors.control.start(
            begin({
              id: clientKey,
              clientKey,
              words,
              ...(attachments.length === 0 ? undefined : { attachments }),
            }),
          );

          onStarted(clientKey);

          return started.then((answer) => !("note" in answer));
        }}
      />
    </CommentCard>
  );
}

/**
 * The start of a thread on the description's words a pending card makes, measured
 * in the description's text as saved where its words stand there, so the thread
 * the host draws at once stands on them as the service will place it, and
 * the open editor marks them where they are. Note that words started on in
 * the editor and not saved yet are measured in its text, which the service
 * lays over the saved one.
 */
function descriptionBegin(
  pending: PendingThread,
  text: string,
): (first: FirstComment) => DescriptionCommentStart {
  return (first) => {
    const saved = pending.text === undefined ? pending : textChange(pending.text, text)(pending);

    return {
      ...first,
      scope: pending.scope,
      quote: pending.quote,
      ...(saved === undefined
        ? { anchor: { from: pending.from, to: pending.to }, text: pending.text ?? text }
        : { anchor: { from: saved.from, to: saved.to }, text }),
    };
  };
}

/** Where words drawn inside `root` stand in its drawn text, from its start to the point. */
function drawnOffset(root: HTMLElement, node: globalThis.Node, offset: number): number {
  const range = document.createRange();
  range.setStart(root, 0);
  range.setEnd(node, offset);

  return range.toString().length;
}

/** A block's own words in its section's drawn text: a bullet's up to the list nested under it, which its own bullets are commented on apart; any other block's whole. */
function ownWords(unit: HTMLElement, block: HTMLElement) {
  const from = drawnOffset(unit, block, 0);
  const quote = ownRange(block).toString().trimEnd();

  return { quote, from, to: from + quote.length };
}

/** A block's own words, a list item's without the bullets nested under it. */
function ownRange(block: HTMLElement): Range {
  const nested = [...block.childNodes].findIndex(
    (child) => child instanceof HTMLElement && (child.tagName === "UL" || child.tagName === "OL"),
  );

  const range = document.createRange();
  range.selectNodeContents(block);

  if (nested >= 0) range.setEnd(block, nested);

  return range;
}

/**
 * Whether threads' marks cover every one of the block's own words, as a
 * thread on the block does, so it is commented on through them; a thread on
 * a few of its words, or on a bullet nested under it, leaves it its button.
 */
function threadedWhole(block: HTMLElement): boolean {
  const own = ownRange(block);

  const marked = [...block.querySelectorAll(`.${COMMENT_MARK_CLASS}[data-threads]`)]
    .filter(
      (mark) =>
        own.intersectsNode(mark) && mark.parentElement?.closest(`.${COMMENT_MARK_CLASS}`) === null,
    )
    .map((mark) => mark.textContent)
    .join("");

  const words = own.toString().replace(/\s+/gu, "");

  return words !== "" && marked.replace(/\s+/gu, "") === words;
}

/** A thread started on the editor's words, its quote held to the bound the service keeps. */
function editorPending(span: EditorSpan, scope: PendingThread["scope"]): PendingThread {
  return { ...span, scope, quote: span.quote.slice(0, DESCRIPTION_COMMENT_BOUNDS.MAX_QUOTE_CHARS) };
}

/** The words a section's drawn stretch stands for in the description's text, laid over the section's source; nothing where none of them do. */
function sourceSpan(
  unit: HTMLElement,
  section: DescriptionSection,
  drawn: { readonly from: number; readonly to: number },
): { readonly from: number; readonly to: number } | undefined {
  const span = textChange(unit.textContent, section.text)(drawn);

  return span === undefined
    ? undefined
    : { from: section.from + span.from, to: section.from + span.to };
}

/** What a thread is started on: the words or block drawn, as the description's text holds them. */
function pendingOf(
  unit: HTMLElement,
  section: DescriptionSection,
  drawn: { readonly from: number; readonly to: number },
  scope: PendingThread["scope"],
  quote: string,
): PendingThread | undefined {
  const span = sourceSpan(unit, section, drawn);

  return span === undefined
    ? undefined
    : { ...span, scope, quote: quote.slice(0, DESCRIPTION_COMMENT_BOUNDS.MAX_QUOTE_CHARS) };
}

/** Whether two measures stand every card at the same top. */
function sameTops(a: ReadonlyMap<string, number>, b: ReadonlyMap<string, number>): boolean {
  return a.size === b.size && [...b].every(([id, top]) => a.get(id) === top);
}

/** Where an element's top stands in the description body's own box. */
function topIn(body: HTMLElement, element: Element): number {
  return element.getBoundingClientRect().top - body.getBoundingClientRect().top;
}

/**
 * Where the middle of the first line `element`'s words stand on, in the description
 * body's own box: a count or a block's button stands centered on it, so it
 * reads as that line's whether the words go on past it or not. Note that the
 * element holding the first words is measured: an inline one by the first
 * of its line boxes, and a block by its top and half its line, because a
 * box wrapping onto more lines spans them all.
 */
function lineMiddleIn(body: HTMLElement, element: Element): number {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, (node) =>
    (node.textContent ?? "").trim() === "" ? NodeFilter.FILTER_SKIP : NodeFilter.FILTER_ACCEPT,
  );

  const holder = walker.nextNode()?.parentElement ?? element;
  const style = getComputedStyle(holder);
  const line = style.display === "inline" ? holder.getClientRects()[0] : undefined;

  if (line !== undefined) return (line.top + line.bottom) / 2 - body.getBoundingClientRect().top;
  const height = Number.parseFloat(style.lineHeight);

  return topIn(body, holder) + (Number.isFinite(height) ? height / 2 : 0);
}

/** The part of the scroller in view, inside its edges, in the description body's own box; none before either is drawn. */
function viewIn(scroller: HTMLElement | null, body: HTMLElement | null): MarginView | undefined {
  if (scroller === null || body === null) return undefined;
  const at = topIn(body, scroller) + scroller.clientTop;

  return { top: at + VIEW_EDGE, bottom: at + scroller.clientHeight - VIEW_EDGE };
}

/** The block a point is over, one of a section's own: a paragraph, a list, a heading, a quote, a table, or code. */
function blockAt(
  target: EventTarget | null,
  unitClass: string,
): { block: HTMLElement; unit: HTMLElement } | undefined {
  if (!(target instanceof HTMLElement)) return undefined;
  const unit = target.closest<HTMLElement>(`.${unitClass}`);

  if (unit === null) return undefined;

  // A list is commented on a bullet at a time, its innermost one under the pointer, and the gaps between them offer none.
  if (target.tagName === "UL" || target.tagName === "OL") return undefined;
  const item = target.closest<HTMLElement>("li");

  if (item !== null && unit.contains(item)) return { block: item, unit };
  let block: HTMLElement | null = target;

  while (block !== null && block.parentElement !== unit) block = block.parentElement;

  return block === null ? undefined : { block, unit };
}

/**
 * The description's comments beside its body: the margin or the counts, the
 * thread being started, the button a block shows under the pointer, and
 * the bubble over words selected. Drawn inside the body, which it measures,
 * from the scroller around it, whose width says whether a margin fits.
 */
/**
 * The sheet naming the open thread's words in the editor, built once; a
 * constructed sheet, since the window's policy takes no inline style. It
 * names the thread's id, so it is written withheld from the screen
 * recording (`@repo/ui/session-replay-marks`), from before it is adopted.
 */
let openThreadSheet: CSSStyleSheet | undefined;

/** The open thread's words drawn open in the editor, as the read view draws its marks with `data-active`; none where no thread is open. */
function editorOpenThread(thread: string | undefined): void {
  if (!("CSSStyleSheet" in globalThis) || !("adoptedStyleSheets" in document)) return;

  if (openThreadSheet === undefined) {
    openThreadSheet = new CSSStyleSheet();
    writeWithheldSheet(openThreadSheet, "");
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, openThreadSheet];
  }

  // Note that a thread's id is the service's UUID, which a selector takes as it is; the rule draws the edge whole, so words inside another thread's mark, which draws none of its own, show it too.
  writeWithheldSheet(
    openThreadSheet,
    thread === undefined
      ? ""
      : `.description-document-text .${COMMENT_MARK_CLASS}[data-threads~="${thread}"] { padding-bottom: 1px; border-bottom: 1.5px solid var(--comment-mark-active-edge); background: var(--comment-mark-active); }`,
  );
}

/** The thread itself and what it opened over the page, where a caret or the focus is the thread's rather than the words'. */
const THREAD_ITSELF = '.comment-card, [role="menu"], [role="dialog"], [role="alertdialog"]';

/** What a press may land on and leave the open thread open: its card, a thread's words or count, the controls that start one, and a menu or dialog it opened. */
const KEEPS_THREAD_OPEN = [
  ".comment-card",
  `.${COMMENT_MARK_CLASS}`,
  ".comment-count",
  ".comment-bubble",
  ".comment-block-button",
  '[role="menu"]',
  '[role="dialog"]',
  '[role="alertdialog"]',
].join(", ");

/** The thread's cards are several boxes, which `KEEPS_THREAD_OPEN` names, so its press away stands by no layer of its own. */
const NO_LAYER: RefObject<HTMLElement | null> = { current: null };

export function DescriptionCommentLayer({
  body,
  scroller,
  shown: descriptionShown,
  unitClass,
  sections,
  text,
  doors,
  editor,
}: {
  body: RefObject<HTMLDivElement | null>;
  scroller: RefObject<HTMLDivElement | null>;
  /** Whether the description is the tab its column shows. */
  shown: boolean;
  /** The class each section's drawn words wear, in the order of `sections`. */
  unitClass: string;
  sections: readonly DescriptionSection[];
  /** The description's text, which `sections` were read from and a thread's words are measured in. */
  text: string;
  doors: ThreadDoors;
  /**
   * The open editor's handle, where the editor stands in place of the drawn
   * sections: a thread started there is measured on the editor's words, in
   * the text it would hand over now, rather than on a section's.
   */
  editor: RefObject<DescriptionEditorHandle | undefined> | undefined;
}): React.JSX.Element | null {
  const { active, onActive, pending, revealed, listing, onListing } = useCommentFocus();
  const setPending = useContext(PendingSetter);
  const [wide, setWide] = useState(true);
  const [tops, setTops] = useState<ReadonlyMap<string, number>>(new Map());
  // Where each folded line's open card hangs, under its count or over it.
  const [hung, setHung] = useState<ReadonlyMap<string, number>>(new Map());
  // How tall an open card may stand, the scroller's height inside its edges.
  const [cardRoom, setCardRoom] = useState<number | undefined>(undefined);
  // Where each thread's words stand, which a fold's counts stand level with.
  const [anchors, setAnchors] = useState<ReadonlyMap<string, number>>(new Map());
  // The middle of the first line each thread's words stand on, which its count is centered on.
  const [lines, setLines] = useState<ReadonlyMap<string, number>>(new Map());

  const [hovered, setHovered] = useState<
    { top: number; middle: number; start: () => void } | undefined
  >(undefined);

  // Whether the pointer is on a block or its button now, rather than the margin's cards or off the description, which the button stands on after.
  const [onBlocks, setOnBlocks] = useState(false);
  // The thread whose words the pointer is on, whose card answers it before a press.
  const [pointed, setPointed] = useState<string | undefined>(undefined);
  // Whether the open thread was opened by the editor's caret standing in its words, which closes it as the caret leaves them.
  const caretOpened = useRef(false);
  // Whether a pointer is down, whose press moves the focus before its own rule says what becomes of the thread.
  const pressing = useRef(false);
  // Whether the last press was a finger's, whose tap names the block its button stands by.
  const touching = useRef(false);

  const [bubble, setBubble] = useState<
    { top: number; left: number; below: boolean; start: () => void } | undefined
  >(undefined);

  const cards = useRef(new Map<string, HTMLDivElement>());
  // The cards already stood in the margin, which move to their next place rather than land there, so a card arriving lands where it belongs.
  const settled = useRef(new Set<string>());

  // Note that the open threads stand in the order of their words rather than of their starting, so the keyboard meets their counts and cards top to bottom.
  const open = doors.control.threads
    .filter(openThread)
    .sort((one, other) => (anchors.get(one.id) ?? 0) - (anchors.get(other.id) ?? 0));

  const marginCards = useMarginCards(
    [
      ...open.map((thread) => ({
        id: thread.id,
        thread,
        pending: undefined,
        top: tops.get(thread.id) ?? 0,
        open: active === thread.id,
      })),
      ...(pending === undefined
        ? []
        : [
            {
              id: PENDING_THREAD,
              thread: undefined,
              pending,
              top: tops.get(PENDING_THREAD) ?? 0,
              open: true,
            },
          ]),
    ],
    wide,
  );

  // The margin folds where the scroller has no room for it beside the reading width. Note that the column stands centered, so the margin's room must stand on both its sides, or the card runs past the scroller's edge.
  useEffect(() => {
    const element = scroller.current;

    if (element === null) return;

    const measure = () => {
      setWide(element.clientWidth >= READING_WIDTH + 2 * MARGIN_ROOM);
      setCardRoom(Math.max(0, element.clientHeight - 2 * VIEW_EDGE));
      // Note that a scroller drawn shorter or taller resizes no card that already fits, so the open one is measured into the new view here.
      setResized((count) => count + 1);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);

    return () => observer.disconnect();
  }, [scroller]);

  useEffect(() => {
    const element = scroller.current;

    if (element === null) return;
    element.dataset.comments =
      wide && (open.length > 0 || pending !== undefined) ? "margin" : "folded";
  });

  // Each card's words are measured after the body draws them, and the cards stood beside them.
  const anchorOf = useCallback(
    (thread: string, section: string): Element | undefined => {
      const element = body.current;

      if (element === null) return undefined;
      const mark = element.querySelector(`.${COMMENT_MARK_CLASS}[data-threads~="${thread}"]`);

      if (mark !== null) return mark;
      // Note that a thread's id is the service's UUID, which a selector takes as it is.
      // A thread whose words were deleted stands where its section starts, or at the top.
      const at = sections.findIndex((each) => each.heading === section);

      return (at < 0 ? undefined : element.querySelectorAll(`.${unitClass}`)[at]) ?? element;
    },
    [body, sections, unitClass],
  );

  const anchorAt = useCallback(
    (thread: string, section: string): { top: number; middle: number } | undefined => {
      const element = body.current;
      const anchor = anchorOf(thread, section);

      if (element === null || anchor === undefined) return undefined;

      return {
        top: anchor === element ? 0 : topIn(element, anchor),
        middle: lineMiddleIn(element, anchor),
      };
    },
    [body, anchorOf],
  );

  // Note that the margin is measured again only when what it stands on
  // changes, or the description's words or a card are resized, never on every draw,
  // because each measure lays the page out, a draw for every word typed among
  // it. A resize is measured once in the frame after it, however many land.
  const { threads } = doors.control;
  const [resized, setResized] = useState(0);
  // Whether the last measure found no body to measure in, as the first does, the body's ref being its ancestor's and attached after this layer's own effects.
  const unmeasured = useRef(false);
  useEffect(() => {
    const element = body.current;

    if (element === null) return;

    if (unmeasured.current) {
      unmeasured.current = false;
      setResized((count) => count + 1);
    }

    let frame: number | undefined;

    const observer = new ResizeObserver(() => {
      if (frame !== undefined) return;
      frame = requestAnimationFrame(() => {
        frame = undefined;
        setResized((count) => count + 1);
      });
    });

    observer.observe(element);

    for (const card of cards.current.values()) observer.observe(card);

    return () => {
      observer.disconnect();

      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, [body, threads, pending, wide, active]);
  useLayoutEffect(() => {
    unmeasured.current = body.current === null;

    const placed = [
      ...threads.filter(openThread).map((thread) => ({ id: thread.id, section: thread.section })),
      ...(pending === undefined ? [] : [{ id: PENDING_THREAD, section: "" }]),
    ].flatMap(({ id, section }) => {
      const at = anchorAt(id, section);

      return at === undefined
        ? []
        : [{ id, ...at, height: cards.current.get(id)?.offsetHeight ?? 0 }];
    });

    const view = viewIn(scroller.current, body.current);

    const next = marginTops(
      placed,
      active ?? (pending === undefined ? undefined : PENDING_THREAD),
      CARD_GAP,
      view,
    );

    setTops((held) => (sameTops(held, next) ? held : next));

    const nextHung = new Map(
      placed.map((card) => [
        card.id,
        view === undefined
          ? card.top + HUNG_DROP
          : hungTop(card.top, HUNG_DROP, card.height, CARD_GAP, view),
      ]),
    );

    setHung((held) => (sameTops(held, nextHung) ? held : nextHung));
    const nextAnchors = new Map(placed.map((card) => [card.id, card.top]));
    setAnchors((held) => (sameTops(held, nextAnchors) ? held : nextAnchors));
    const nextLines = new Map(placed.map((card) => [card.id, card.middle]));
    setLines((held) => (sameTops(held, nextLines) ? held : nextLines));
  }, [threads, pending, active, anchorAt, text, wide, resized]);

  // An ask to show a thread scrolls the document's own scroller to its words, once per ask.
  const scrolled = useRef<number | undefined>(undefined);
  useLayoutEffect(() => {
    const element = scroller.current;
    const room = body.current;

    if (revealed === undefined || element === null || room === null) return;

    if (scrolled.current === revealed.ask) return;
    // Note that the ask waits for the read to name the thread, since a link may open the description before its comments land.
    const asked = doors.control.threads.find((each) => each.id === revealed.thread);

    if (!doors.control.read || asked === undefined) return;

    // Note that a resolved thread has no words lit in the description; it is listed instead, under Resolved (`DescriptionCommentList`).
    if (!openThread(asked)) return;
    const at = anchorAt(asked.id, asked.section);

    if (at === undefined) return;
    scrolled.current = revealed.ask;
    element.scrollTop +=
      room.getBoundingClientRect().top + at.top - element.getBoundingClientRect().top - REVEAL_ROOM;
    // Note that the open card was kept in the view before it scrolled, so it is kept in the one it scrolled to.
    setResized((count) => count + 1);
  });

  // A resolved thread asked to be shown, as a link to it asks, is listed under Resolved in the margin's place, once per ask.
  const listedAsk = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (revealed === undefined || listedAsk.current === revealed.ask) return;
    const asked = doors.control.threads.find((each) => each.id === revealed.thread);

    if (asked === undefined || openThread(asked)) return;
    listedAsk.current = revealed.ask;
    onListing(COMMENTS_FILTER.RESOLVED);
  }, [revealed, doors.control.threads, onListing]);
  // A thread being started stands beside its words, so starting one puts the margin back in the list's place.
  useEffect(() => {
    if (pending !== undefined && listing !== undefined) onListing(undefined);
  }, [pending, listing, onListing]);
  // The list stands under the description's Comments toggle, measured as the body draws it.
  const [listTop, setListTop] = useState(0);
  useLayoutEffect(() => {
    const room = body.current;
    const toggle = room?.querySelector(`.${COMMENTS_TOGGLE_CLASS}`);

    if (listing === undefined || room === null || toggle == null) return;
    const top = toggle.getBoundingClientRect().bottom - room.getBoundingClientRect().top + CARD_GAP;
    setListTop((held) => (Math.abs(held - top) < 1 ? held : top));
  });

  // A block under the pointer, or the one a finger last tapped, shows its button at the column's end; words selected raise the bubble over them.
  useEffect(() => {
    const element = body.current;

    if (element === null) return;

    const point = (target: EventTarget | null) => {
      const marked =
        target instanceof Element
          ? target.closest<HTMLElement>(`.${COMMENT_MARK_CLASS}[data-threads]`)
          : null;

      setPointed(marked?.dataset.threads?.split(" ")[0]);

      // A divider holds no words for a thread to stand on, so it offers no button, and the block's it came from goes.
      if (target instanceof HTMLHRElement) {
        setHovered(undefined);

        return;
      }

      const found = blockAt(target, unitClass);

      if (found === undefined) return;

      // Note that a block whose words a thread already covers is commented on through that thread, so it offers no button.
      if (threadedWhole(found.block)) {
        setHovered(undefined);

        return;
      }

      if (editor !== undefined) {
        setHovered({
          top: topIn(element, found.block),
          middle: lineMiddleIn(element, found.block),
          start: () => {
            const span = editor.current?.blockSpan(found.block);

            if (span !== undefined)
              setPending(editorPending(span, DESCRIPTION_COMMENT_SCOPE.BLOCK));
          },
        });

        return;
      }

      const index = [...element.querySelectorAll(`.${unitClass}`)].indexOf(found.unit);
      const section = sections[index];

      if (section === undefined) return;
      const { quote, from, to } = ownWords(found.unit, found.block);
      setHovered({
        top: topIn(element, found.block),
        middle: lineMiddleIn(element, found.block),
        start: () => {
          const begun = pendingOf(
            found.unit,
            section,
            { from, to },
            DESCRIPTION_COMMENT_SCOPE.BLOCK,
            quote,
          );

          if (begun !== undefined) setPending(begun);
        },
      });
    };

    // Note that a finger's arrival names no block, because iOS plays a tap's
    // arrival as a hover and spends the tap on a button that comes in with
    // it, a link's in the block among them; its tap names the block once
    // the tap has gone where it leads.
    const over = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      point(event.target);
      const { target } = event;
      setOnBlocks(
        blockAt(target, unitClass) !== undefined ||
          (target instanceof Element && target.closest(`.${BLOCK_BUTTON_CLASS}`) !== null),
      );
    };

    const tapped = (event: MouseEvent) => {
      if (touching.current) point(event.target);
    };

    // In the editor, a caret standing in a thread's words opens it, and leaving them closes the one it opened.
    const letCaretGo = () => {
      if (!caretOpened.current) return;
      caretOpened.current = false;
      onActive(undefined);
    };

    const caretIn = (selection: Selection) => {
      if (active === PENDING_THREAD) return;
      const node = selection.anchorNode;
      const at = node instanceof Element ? node : node?.parentElement;

      if (at === null || at === undefined) return;

      // Note that a caret in the thread itself, its reply say, takes it over, so it no longer closes as the caret leaves its words.
      if (at.closest(THREAD_ITSELF) !== null) {
        caretOpened.current = false;

        return;
      }

      if (!element.contains(at)) {
        letCaretGo();

        return;
      }

      const threads = (
        at.closest<HTMLElement>(`.${COMMENT_MARK_CLASS}[data-threads]`)?.dataset.threads ?? ""
      )
        .split(" ")
        .filter((thread) => thread !== "" && thread !== PENDING_THREAD);

      if (threads.length > 0) {
        if (active !== undefined && threads.includes(active)) return;
        caretOpened.current = true;
        onActive(threads[0]);

        return;
      }

      letCaretGo();
    };

    // The editor let go of by the keyboard, Tab say, lets go of the thread its caret opened, but for the thread itself taking the focus.
    const blurred = (event: FocusEvent) => {
      if (editor === undefined) return;
      const next = event.relatedTarget;

      // Note that a press on words that take no focus, a card's say, lets the focus go to nothing, and the press's own rule says whether it closes the thread.
      if (next === null) return;

      if (next instanceof Element && next.closest(THREAD_ITSELF) !== null) {
        caretOpened.current = false;

        return;
      }

      // Note that a press on a control, a line's count say, focuses it before its click, and the press's own rule, the count's toggle say, settles the thread.
      if (pressing.current) return;
      // Note that the focus staying is the editor's room holding it, not the description's body, whose title and buttons are Tab stops of their own.
      const room = element.querySelector(`.${EDITOR_ROOM_CLASS}`);

      if (next instanceof Node && room?.contains(next) === true) return;
      letCaretGo();
    };

    const selected = () => {
      // Note that a description kept mounted under a hidden tab keeps its selection, but its words are no longer on screen to comment on.
      if (element.closest("[hidden]") !== null) {
        setBubble(undefined);

        return;
      }

      const selection = window.getSelection();

      if (selection === null || selection.isCollapsed || selection.rangeCount === 0) {
        if (editor !== undefined && selection?.isCollapsed === true) caretIn(selection);
        setBubble(undefined);

        return;
      }

      // Note that in the editor the format toolbar over the words starts their thread, so no bubble stands beside it.
      if (editor !== undefined) {
        setBubble(undefined);

        return;
      }

      const range = selection.getRangeAt(0);
      const start = range.startContainer.parentElement?.closest<HTMLElement>(`.${unitClass}`);
      const end = range.endContainer.parentElement?.closest<HTMLElement>(`.${unitClass}`);

      if (start === null || start === undefined || start !== end || !element.contains(start)) {
        setBubble(undefined);

        return;
      }

      const box = range.getBoundingClientRect();
      const own = element.getBoundingClientRect();

      // Note that a finger's bubble stands under the words, because the system's own selection menu stands over them, unless the window ends first.
      const below =
        coarsePointerNow() && box.bottom + BUBBLE_ROOM_TOUCH <= visibleViewport().bottom;

      const top = (below ? box.bottom : box.top) - own.top;
      const index = [...element.querySelectorAll(`.${unitClass}`)].indexOf(start);
      const section = sections[index];
      const quote = selection.toString().trim();

      if (section === undefined || quote === "") return;
      const from = drawnOffset(start, range.startContainer, range.startOffset);
      const to = drawnOffset(start, range.endContainer, range.endOffset);
      setBubble({
        top,
        left: box.left - own.left,
        below,
        start: () => {
          const begun = pendingOf(
            start,
            section,
            { from, to },
            DESCRIPTION_COMMENT_SCOPE.WORDS,
            quote,
          );

          if (begun !== undefined) setPending(begun);
          setBubble(undefined);
          selection.removeAllRanges();
        },
      });
    };

    // Note that a press on marked words opens their thread, as the editor would otherwise open there.
    const pressed = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      const mark = event.target.closest<HTMLElement>(`.${COMMENT_MARK_CLASS}[data-threads]`);

      // Note that words under more than one thread open the next of them each press.
      const threads = (mark?.dataset.threads ?? "")
        .split(" ")
        .filter((each) => each !== "" && each !== PENDING_THREAD);

      const thread = threads[(threads.indexOf(active ?? "") + 1) % Math.max(threads.length, 1)];

      if (thread === undefined) return;
      setPending(undefined);
      onActive(thread);
    };

    const left = () => {
      setPointed(undefined);
      setOnBlocks(false);
    };

    const down = (event: PointerEvent) => {
      pressing.current = true;
      touching.current = event.pointerType === "touch";
    };

    const up = () => {
      pressing.current = false;
    };

    element.addEventListener("pointerover", over);
    element.addEventListener("click", tapped);
    element.addEventListener("pointerleave", left);
    element.addEventListener("focusout", blurred);
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("pointerup", up, true);
    document.addEventListener("pointercancel", up, true);
    // Note that a key pressed ends any press whose pointerup the window missed, so the Tab after it is the keyboard's.
    document.addEventListener("keydown", up, true);

    // Note that in the editor a press places the caret, so marked words there open no thread.
    if (editor === undefined) element.addEventListener("click", pressed);
    document.addEventListener("selectionchange", selected);

    // Note that hiding the tab the description stands in changes no selection and moves no pointer, so its `hidden` attribute is watched for itself.
    // Note that the tab shown again offers the words still selected there, though only a selection, not a caret, is read again, since a caret read opens and closes threads.
    const hiding = new MutationObserver(() => {
      if (element.closest("[hidden]") !== null) setOnBlocks(false);

      if (element.closest("[hidden]") !== null || window.getSelection()?.isCollapsed === false) {
        selected();
      }
    });

    hiding.observe(document.body, { attributes: true, attributeFilter: ["hidden"], subtree: true });

    return () => {
      hiding.disconnect();
      element.removeEventListener("pointerover", over);
      element.removeEventListener("click", tapped);
      element.removeEventListener("pointerleave", left);
      element.removeEventListener("focusout", blurred);
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("pointerup", up, true);
      document.removeEventListener("pointercancel", up, true);
      document.removeEventListener("keydown", up, true);
      element.removeEventListener("click", pressed);
      document.removeEventListener("selectionchange", selected);
    };
  }, [body, editor, sections, unitClass, setPending, onActive, active]);

  // While the bubble stands, its command starts the thread as a press on it does.
  useAppCommand(APP_COMMAND.COMMENT_ON_SELECTION, bubble?.start);
  // While the pointer is on a block, the same command comments on it as its button does, giving way to words selected, the bubble's or the editor's toolbar's.
  useAppCommand(
    APP_COMMAND.COMMENT_ON_SELECTION,
    descriptionShown && onBlocks ? hovered?.start : undefined,
    YIELDS_TO_SELECTION,
  );

  const cardRef = (id: string) => (element: HTMLDivElement | null) => {
    if (element === null) cards.current.delete(id);
    else cards.current.set(id, element);
  };

  useEffect(() => {
    settled.current = new Set(tops.keys());
  });
  // The editor's marks are the editor's own, so the open thread's words are drawn open there by a rule naming them.
  const editorActive = editor !== undefined && active !== PENDING_THREAD ? active : undefined;
  useEffect(() => {
    editorOpenThread(editorActive);

    return () => editorOpenThread(undefined);
  }, [editorActive]);
  // A press anywhere but the thread, its words, or what it opened over the page closes it, its words kept as its draft; a thread being started goes too, but while its words are sent or it holds files or a dictation, which no draft keeps.
  usePressAway(NO_LAYER, () => undefined, {
    onPressAway:
      active === undefined
        ? undefined
        : () => {
            if (
              active === PENDING_THREAD &&
              cards.current.get(PENDING_THREAD)?.querySelector('[data-held="true"]')
            ) {
              return;
            }

            if (active === PENDING_THREAD) setPending(undefined);
            onActive(undefined);
          },
    holds: (target) => target instanceof Element && target.closest(KEEPS_THREAD_OPEN) !== null,
  });

  const close = () => {
    onActive(undefined);
    setPending(undefined);
  };

  const startedFromPending = (threadId: string) => {
    setPending(undefined);
    onActive(threadId);
  };

  const pendingCard =
    pending === undefined ? null : (
      <PendingCard
        on={pending}
        doors={doors}
        begin={descriptionBegin(pending, text)}
        onCancel={close}
        onStarted={startedFromPending}
      />
    );

  const blockButton =
    // Note that folded, a line holding a count opens its threads there, a thread whose words were deleted counted at its section's top too, so its block shows no button over it.
    hovered === undefined ||
    (!wide && [...anchors.values()].some((top) => Math.abs(top - hovered.top) < 4)) ? null : (
      <div className={BLOCK_BUTTON_CLASS} style={{ top: hovered.middle }}>
        <Tooltip label={COMMENT_WORDS.COMMENT} command={APP_COMMAND.COMMENT_ON_SELECTION}>
          {/* Note that the press takes no focus, so an open editor stays to measure the block through. */}
          <IconButton
            keepFocus
            icon={<MessageSquarePlusIcon />}
            label={COMMENT_WORDS.COMMENT}
            onClick={hovered.start}
          />
        </Tooltip>
      </div>
    );

  const bubbleDrawn =
    bubble === undefined ? null : (
      <MenuSurface
        flow={MENU_SURFACE_FLOW.TOOLBAR}
        className="comment-bubble absolute z-3 -translate-y-[calc(100%+var(--ui-space-6))] data-below:translate-y-ui-16"
        data-below={bubble.below ? "" : undefined}
        style={{ top: bubble.top, left: bubble.left }}
      >
        <Tooltip label={COMMENT_WORDS.COMMENT} command={APP_COMMAND.COMMENT_ON_SELECTION}>
          <Button keepFocus icon={<MessageSquarePlusIcon />} onClick={bubble.start}>
            <ReplayUnmask>{COMMENT_WORDS.COMMENT}</ReplayUnmask>
          </Button>
        </Tooltip>
      </MenuSurface>
    );

  // Note that an open card stands no taller than the scroller it opens in, its entries scrolling inside it.
  const layerStyle =
    cardRoom === undefined
      ? undefined
      : cssCustomProperties({ "--comment-card-room": `${cardRoom}px` });

  // Listed, every thread of the kind chosen stands under the toggle in the margin's place, or over the words where it folds; no card stands beside its words meanwhile, so none is drawn twice.
  if (listing !== undefined) {
    return (
      <div className="comment-layer" style={layerStyle}>
        {blockButton}
        {bubbleDrawn}
        <DescriptionCommentList
          doors={doors}
          listing={listing}
          onListing={onListing}
          wide={wide}
          top={listTop}
          scroller={scroller}
          shown={descriptionShown}
        />
      </div>
    );
  }

  if (wide) {
    return (
      <div className="comment-layer" style={layerStyle}>
        {blockButton}
        {bubbleDrawn}
        <div className="comment-margin absolute top-0 left-comment-margin w-comment-card">
          {marginCards.drawn.map((card) => (
            <MarginSlot
              key={card.id}
              card={card}
              moves={settled.current.has(card.id)}
              slotRef={cardRef(card.id)}
              onGone={marginCards.gone}
            >
              {card.thread !== undefined ? (
                <ThreadCard
                  thread={card.thread}
                  open={card.open}
                  place={THREAD_PLACE.MARGIN}
                  doors={doors}
                  pointed={!card.leaving && pointed === card.id}
                  onOpen={() => {
                    setPending(undefined);
                    onActive(card.id);
                  }}
                  onClose={close}
                />
              ) : card.pending !== undefined ? (
                <PendingCard
                  on={card.pending}
                  doors={doors}
                  begin={descriptionBegin(card.pending, text)}
                  onCancel={close}
                  onStarted={startedFromPending}
                />
              ) : null}
            </MarginSlot>
          ))}
        </div>
      </div>
    );
  }

  // Folded: a count at the end of each line holding marks, the open thread floating under it.
  const counts = new Map<number, DescriptionCommentThread[]>();

  for (const thread of open) {
    const top = anchors.get(thread.id);

    if (top === undefined) continue;
    counts.set(top, [...(counts.get(top) ?? []), thread]);
  }

  const shown = open.find((thread) => thread.id === active);
  const shownTop = shown === undefined ? undefined : anchors.get(shown.id);

  return (
    <div className="comment-layer" style={layerStyle}>
      {blockButton}
      {bubbleDrawn}
      {[...counts].map(([top, threads]) => {
        const comments = threads.reduce(
          (sum, thread) =>
            sum +
            thread.entries.filter((entry) => entry.kind === DESCRIPTION_COMMENT_ENTRY.COMMENT)
              .length,
          0,
        );

        const first = threads[0];
        const middle = first === undefined ? undefined : lines.get(first.id);

        return (
          <span key={top} className="comment-count" style={{ top: middle ?? top }}>
            <Button
              icon={<MessageSquareIcon />}
              label={`${comments} ${comments === 1 ? "comment" : "comments"}`}
              aria-expanded={threads.some((thread) => thread.id === active)}
              onClick={() =>
                onActive(threads.some((thread) => thread.id === active) ? undefined : first?.id)
              }
            >
              {comments}
            </Button>
          </span>
        );
      })}
      {shown === undefined || shownTop === undefined ? null : (
        // Every thread on the line stands under its count, the one pressed open, so none is hidden behind another.
        <div
          className="comment-float"
          style={{ top: hung.get(shown.id) ?? shownTop + HUNG_DROP }}
          ref={cardRef(shown.id)}
        >
          {/* Note that a line holding more threads than the view has room for scrolls them all, so no card is pressed below its own reply field. */}
          <ScrollArea size={SCROLL_SIZE.CONTENT} overscroll={SCROLL_OVERSCROLL.CHAIN}>
            <div className="comment-float-cards">
              {(counts.get(shownTop) ?? [shown]).map((thread) => (
                <ThreadCard
                  key={thread.id}
                  thread={thread}
                  open={thread.id === active}
                  place={THREAD_PLACE.FLOAT}
                  doors={doors}
                  onOpen={() => onActive(thread.id)}
                  onClose={close}
                />
              ))}
            </div>
          </ScrollArea>
        </div>
      )}
      {pendingCard === null ? null : (
        <div
          className="comment-float"
          style={{
            top: hung.get(PENDING_THREAD) ?? (anchors.get(PENDING_THREAD) ?? 0) + HUNG_DROP,
          }}
          ref={cardRef(PENDING_THREAD)}
        >
          {pendingCard}
        </div>
      )}
    </div>
  );
}

const PendingSetter = createContext<(pending: PendingThread | undefined) => void>(() => undefined);

/**
 * Starts a thread on the words selected in the open editor, measured through
 * it and its selection left as it stands, as the format toolbar's Comment
 * over them does; nothing where none are selected.
 */
export function useEditorComment(
  editor: RefObject<DescriptionEditorHandle | undefined>,
): () => void {
  const setPending = useContext(PendingSetter);

  return () => {
    const span = editor.current?.selectionSpan();

    if (span !== undefined) setPending(editorPending(span, DESCRIPTION_COMMENT_SCOPE.WORDS));
  };
}

/** Holds which thread is open, the one being started, and the replies on their way, for the marks, the margin, and the list in its place. */
export function CommentFocusScope({
  planId,
  children,
  reveal,
}: {
  /** The description the focus is on; another description opened lets go of the open thread and the one being started. */
  planId?: string | undefined;
  children: ReactNode;
  /** A thread to open, as a link to it asks; opened once per ask. */
  reveal?: { readonly thread: string; readonly ask: number } | undefined;
}): React.JSX.Element {
  const [focused, setFocused] = useState<Focused>(UNFOCUSED);
  const [revealed, setRevealed] = useState<CommentFocus["revealed"]>(undefined);
  // Note that the list stands across the descriptions opened, as a document app's comments view does, until it is put back.
  const [listing, setListing] = useState<CommentsFilter | undefined>(undefined);
  const [focusedOn, setFocusedOn] = useState(planId);

  // Note that the thread being started is let go in the render the description changes in, so it is never posted to another description.
  if (focusedOn !== planId) {
    setFocusedOn(planId);
    setFocused(UNFOCUSED);
    setRevealed(undefined);
  }

  // Note that a thread opened or closed while one is being started changes nothing, since the one being started holds the focus until it is let go.
  const onActive = useCallback((thread: string | undefined) => {
    setFocused((was) => {
      if (was.kind === FOCUS_KIND.STARTING) return was;

      return thread === undefined ? UNFOCUSED : { kind: FOCUS_KIND.THREAD, id: thread };
    });
  }, []);

  // Letting go of the thread being started leaves an open thread open.
  const setPending = useCallback((pending: PendingThread | undefined) => {
    setFocused((was) => {
      if (pending !== undefined) return { kind: FOCUS_KIND.STARTING, pending };

      return was.kind === FOCUS_KIND.STARTING ? UNFOCUSED : was;
    });
  }, []);

  const asked = useRef<number | undefined>(undefined);

  const onReveal = useCallback((thread: string) => {
    setFocused({ kind: FOCUS_KIND.THREAD, id: thread });
    setRevealed((was) => ({ thread, ask: (was?.ask ?? 0) + 1 }));
  }, []);

  useEffect(() => {
    if (reveal === undefined || asked.current === reveal.ask) return;
    asked.current = reveal.ask;
    onReveal(reveal.thread);
  }, [reveal, onReveal]);

  const focus = useMemo(() => {
    const now = focusedOn === planId ? focused : UNFOCUSED;

    return {
      active: activeOf(now),
      onActive,
      pending: now.kind === FOCUS_KIND.STARTING ? now.pending : undefined,
      reveal: onReveal,
      revealed,
      listing,
      onListing: setListing,
    };
  }, [focused, onActive, onReveal, revealed, listing, focusedOn, planId]);

  return (
    <CommentFocusContext.Provider value={focus}>
      <PendingSetter.Provider value={setPending}>{children}</PendingSetter.Provider>
    </CommentFocusContext.Provider>
  );
}

/** Which of the threads a list of them shows: the description's list, or a page's comments pane. */
export const COMMENTS_FILTER = { OPEN: "open", RESOLVED: "resolved" } as const;

export type CommentsFilter = (typeof COMMENTS_FILTER)[keyof typeof COMMENTS_FILTER];

/** What a comments pane's head names the threads it lists, by its filter. */
const COMMENTS_FILTER_WORDS = {
  [COMMENTS_FILTER.OPEN]: "Open",
  [COMMENTS_FILTER.RESOLVED]: "Resolved",
} as const satisfies Record<CommentsFilter, string>;

/** What a comments pane's toggle says it does, by whether resolved threads are shown. */
const RESOLVED_PRESS = {
  SHOW: "Show resolved comments",
  HIDE: "Show open comments",
} as const;

/** A comments pane's toggle, as the Inbox's Needs you is one: pressed, the pane lists the resolved threads in the open ones' place. */
function ResolvedOnly({
  shown,
  onShown,
}: {
  shown: boolean;
  onShown: (shown: boolean) => void;
}): React.JSX.Element {
  return (
    <Tooltip label={shown ? RESOLVED_PRESS.HIDE : RESOLVED_PRESS.SHOW}>
      <IconButton
        icon={<CircleCheckIcon />}
        label={COMMENTS_FILTER_WORDS[COMMENTS_FILTER.RESOLVED]}
        pressed={shown}
        onClick={() => onShown(!shown)}
      />
    </Tooltip>
  );
}

/** The widths of each stand-in card's author line and its words, while the threads are read. */
const COMMENTS_SKELETON = [
  { author: "30%", words: ["100%", "70%"] },
  { author: "24%", words: ["100%", "85%", "40%"] },
  { author: "34%", words: ["90%"] },
] as const;

/** The threads as quiet cards while they are read, in a card's own type. */
function CommentsSkeleton(): React.JSX.Element {
  return (
    <SkeletonRegion label="Reading the comments…">
      {COMMENTS_SKELETON.map((card) => (
        <CommentsRow key={card.author}>
          <CommentCard place={THREAD_PLACE.LIST} open={false}>
            <Skeleton width={card.author} />
            {card.words.map((width) => (
              <Skeleton key={width} width={width} />
            ))}
          </CommentCard>
        </CommentsRow>
      ))}
    </SkeletonRegion>
  );
}

/** What the description's list says over a list holding nothing, by its filter. */
const NO_COMMENTS = {
  [COMMENTS_FILTER.OPEN]: {
    title: "No comments",
    line: "Select words in the description, or press a block's comment button, to start a thread.",
  },
  [COMMENTS_FILTER.RESOLVED]: {
    title: "No resolved comments",
    line: undefined,
  },
} as const satisfies Record<CommentsFilter, { title: string; line: string | undefined }>;

/** Where a thread stands in a list: by when it was started, so a row leaving keeps its place among the others as it fades. */
function listedRank(card: DrawnCard): number {
  return card.thread?.createdAt ?? Number.POSITIVE_INFINITY;
}

/** No measure of a row a list lays out, which the margin's slots take and a list's need not. */
const NO_SLOT = () => undefined;

/** No threads to find in, while no find bar stands open. */
const NO_FIND_ROWS: readonly FindRow[] = [];

/** How tall a thread is taken to be in a list before it is drawn, in pixels: its quote, a comment, and its reply field. */
const LISTED_ESTIMATE_PX = 200;

/** The room between two threads in a list, in pixels: a control's gap (`--ui-control-gap`), as two cards stand apart (`CommentsRow`). */
const LISTED_GAP_PX = 8;

/** The words a thread draws that a find counts before its row is drawn: its quote, and its comments' words and files. */
function threadFindRow(thread: DescriptionCommentThread): FindRow {
  const entries = thread.entries.flatMap((entry) => [
    entry.words ?? "",
    ...(entry.files ?? []).map((file) => file.name),
  ]);

  return { key: thread.id, words: [thread.quote, ...entries].join("\n") };
}

/**
 * The threads a list draws, each whole, under what is drawn over them: why
 * they could not be read, that there are none, or stand-in cards while they
 * are read. A thread arrives and leaves the list as a card arrives in and
 * leaves the description's margin, fading in its row, so one resolved fades out of
 * Open where it stood. The description's list and a page's comments both list
 * theirs so.
 */
function ThreadList({
  control,
  listed,
  empty,
  doors,
  onShowWords,
  flush,
  scroller,
  handle,
}: {
  control: DescriptionCommentsControl;
  listed: readonly DescriptionCommentThread[];
  empty: { readonly title: string; readonly line: string | undefined };
  doors: ThreadDoors;
  /** What a thread's quote shows when pressed; none where it is only words. */
  onShowWords: (thread: DescriptionCommentThread) => (() => void) | undefined;
  /** Whether the list stands flush in a column of its own, as the description's margin, rather than inset in a pane. */
  flush?: boolean;
  /** The scroller the threads stand in, which draws only those near its view (`VirtualRows`). */
  scroller: RefObject<HTMLElement | null>;
  handle: RefObject<VirtualRowsHandle | null>;
}): React.JSX.Element {
  const held = useMarginCards(
    listed.map((thread) => ({ id: thread.id, thread, pending: undefined, top: 0, open: true })),
    true,
  );

  const rows = [...held.drawn].sort((a, b) => listedRank(a) - listedRank(b));
  const keys = rows.map((card) => card.id);
  const none = !control.failed && rows.length === 0 && control.read;
  const { gone } = held;
  // Note that a thread leaving where its row is not drawn has no fade to wait out, so it is let go at once.
  useLayoutEffect(() => {
    for (const card of rows) {
      if (card.leaving && handle.current?.rowElement(card.id) === undefined) gone(card.id);
    }
  });

  return (
    <div
      className="comments-list box-border px-ui-16 pt-ui-16 pb-ui-24 data-empty:flex data-empty:min-h-full data-empty:flex-col data-flush:p-0"
      data-empty={none ? "" : undefined}
      data-flush={flush === true ? "" : undefined}
    >
      {control.failed ? (
        <ReplayUnmask>
          <ErrorState
            failure={unreadShown(FAILURE_SURFACE.DESCRIPTION_COMMENTS_READ)}
            placement={ERROR_STATE_PLACEMENT.CENTERED}
            onRetry={control.onRetry}
          >
            The comments could not be read.
          </ErrorState>
        </ReplayUnmask>
      ) : none ? (
        <ReplayUnmask>
          <EmptyState replayUnmasked icon={<CommentsIcon />} title={empty.title}>
            {empty.line}
          </EmptyState>
        </ReplayUnmask>
      ) : !control.read ? (
        <CommentsSkeleton />
      ) : (
        <VirtualRows
          scroller={scroller}
          keys={keys}
          estimate={LISTED_ESTIMATE_PX}
          gap={LISTED_GAP_PX}
          anchor={VIRTUAL_ROWS_ANCHOR.START}
          holdsFocus
          handle={handle}
        >
          {(index) => {
            const card = rows[index];

            return card?.thread === undefined ? null : (
              <MarginSlot card={card} moves={false} slotRef={NO_SLOT} onGone={gone} flows>
                <CommentsRow>
                  {/* Note that every thread stands whole here, its replies and its field, its quote the way to what it is on. */}
                  <ThreadCard
                    thread={card.thread}
                    open
                    place={THREAD_PLACE.LIST}
                    quote
                    doors={doors}
                    onShowWords={onShowWords(card.thread)}
                  />
                </CommentsRow>
              </MarginSlot>
            );
          }}
        </VirtualRows>
      )}
    </div>
  );
}

/** The class of the description's Comments toggle, which the list stands under. */
const COMMENTS_TOGGLE_CLASS = "comments-toggle";

/** What the description's list calls the threads it can show. */
const LISTING_WORDS = {
  LABEL: "Comments shown",
  [COMMENTS_FILTER.OPEN]: "Open",
  [COMMENTS_FILTER.RESOLVED]: "Resolved",
} as const;

/** What the description's Comments toggle says, and what its press does. */
const TOGGLE_WORDS = {
  LIST: "List all comments",
  MARGIN: "Show comments beside the description",
} as const;

/** The toggle's words: how many threads the description holds, as the byline's other phrases say what they count. */
function commentCount(threads: number): string {
  return `${threads} ${threads === 1 ? "comment" : "comments"}`;
}

/**
 * The description's Comments toggle, a phrase of its byline as its Edited time is,
 * and pressed as Word's and Google Docs' Comments button is: pressed, the
 * description lists its threads in the margin's place (`DescriptionCommentList`), open or
 * resolved; pressed again, its open threads stand beside their words. It
 * counts every thread, and stands only while the description holds any at all.
 */
export function CommentsToggle(): React.JSX.Element | null {
  const control = useDescriptionCommentsControlOrUndefined();
  const { listing, onListing } = useCommentFocus();

  if (control === undefined || control.threads.length === 0) return null;
  const listed = listing !== undefined;

  return (
    <span className={`${COMMENTS_TOGGLE_CLASS} actor-line`}>
      <Tooltip label={listed ? TOGGLE_WORDS.MARGIN : TOGGLE_WORDS.LIST}>
        <TextButton
          aria-expanded={listed}
          onClick={() => onListing(listed ? undefined : COMMENTS_FILTER.OPEN)}
        >
          <ReplayUnmask>{commentCount(control.threads.length)}</ReplayUnmask>
        </TextButton>
      </Tooltip>
    </span>
  );
}

/**
 * The description's threads listed in its margin's place, as a document app's
 * comments view lists them: open or resolved, chosen over the list, each
 * thread whole under its quote. On a wide column it stands where the
 * margin's cards stood, under the description's Comments toggle, scrolling with the
 * description; where the margin folds it floats over the words under the toggle,
 * scrolling inside itself. An open thread's quote shows its words in the
 * description; a resolved one's says them alone, and its Reopen puts it back
 * beside them. A thread a link asked for is scrolled to once.
 */
function DescriptionCommentList({
  doors,
  listing,
  onListing,
  wide,
  top,
  scroller,
  shown,
}: {
  doors: ThreadDoors;
  listing: CommentsFilter;
  onListing: (listing: CommentsFilter) => void;
  wide: boolean;
  /** Where the list starts in the body, under the toggle. */
  top: number;
  scroller: RefObject<HTMLDivElement | null>;
  /** Whether the description is the tab its column shows, which alone a find over the column searches. */
  shown: boolean;
}): React.JSX.Element {
  const { reveal, revealed } = useCommentFocus();
  const { control } = doors;
  const { threads: all } = control;
  const open = useMemo(() => all.filter(openThread), [all]);
  const resolved = useMemo(() => all.filter((thread) => !openThread(thread)), [all]);
  const listed = listing === COMMENTS_FILTER.OPEN ? open : resolved;
  const list = useRef<HTMLDivElement>(null);
  const run = useRef<VirtualRowsHandle>(null);
  // Note that the threads' words are read only while a find bar stands open over the description, which then finds in the description's words and the threads' alike.
  const finding = useFindOpen();

  const findRows = useMemo(
    () => (finding ? listed.map(threadFindRow) : NO_FIND_ROWS),
    [finding, listed],
  );

  useVirtualFind({ root: scroller, rows: findRows, handle: run, findable: shown });
  const scrolledAsk = useRef<number | undefined>(undefined);
  const broughtAsk = useRef<number | undefined>(undefined);
  useLayoutEffect(() => {
    const box = wide ? scroller.current : list.current;

    if (revealed === undefined || box === null || scrolledAsk.current === revealed.ask) return;
    const row = list.current?.querySelector(`.comment-card[data-thread="${revealed.thread}"]`);

    // A thread its run has not drawn is brought in first, and scrolled to once it is drawn.
    if (row == null) {
      if (broughtAsk.current === revealed.ask) return;
      broughtAsk.current = revealed.ask;
      run.current?.bringIn(revealed.thread);

      return;
    }

    scrolledAsk.current = revealed.ask;
    box.scrollTop +=
      row.getBoundingClientRect().top - box.getBoundingClientRect().top - REVEAL_ROOM;
  });

  const choice = (
    <ReplayUnmask>
      <ChoiceBar<CommentsFilter>
        label={LISTING_WORDS.LABEL}
        items={[
          {
            value: COMMENTS_FILTER.OPEN,
            label: LISTING_WORDS[COMMENTS_FILTER.OPEN],
            count: String(open.length),
          },
          {
            value: COMMENTS_FILTER.RESOLVED,
            label: LISTING_WORDS[COMMENTS_FILTER.RESOLVED],
            count: String(resolved.length),
          },
        ]}
        value={listing}
        look={CHOICE_BAR_LOOK.SEGMENTED}
        size={CHOICE_BAR_SIZE.COMPACT}
        stretch
        onChange={onListing}
      />
    </ReplayUnmask>
  );

  const threads = (
    // Note that the list is drawn afresh as the choice turns, so the threads of the one let go do not fade out under the other's.
    <ThreadList
      key={listing}
      control={control}
      listed={listed}
      empty={NO_COMMENTS[listing]}
      doors={doors}
      onShowWords={(thread) => (openThread(thread) ? () => reveal(thread.id) : undefined)}
      flush
      scroller={wide ? scroller : list}
      handle={run}
    />
  );

  return wide ? (
    <div
      ref={list}
      className="comment-list absolute left-comment-margin w-comment-card"
      style={{ top }}
    >
      {choice}
      {threads}
    </div>
  ) : (
    // Note that over the words the list stands on the well the threads were listed on in the panel, so the words never show through and no card stands in another.
    <div className="comment-float" style={{ top }}>
      <Card
        look={CARD_LOOK.WELL}
        shadow={CARD_SHADOW.MENU}
        padding={CARD_PADDING.SNUG}
        className="comment-list comment-list-float"
      >
        {choice}
        <ScrollArea ref={list} size={SCROLL_SIZE.CONTENT} overscroll={SCROLL_OVERSCROLL.CHAIN}>
          {threads}
        </ScrollArea>
      </Card>
    </div>
  );
}

/**
 * A list of threads under its head, as a page's comments pane stands: the head naming the threads listed, open or
 * resolved, and how many, with the toggle between the two; under it the
 * threads, whole, scrolling. Note that the list is drawn afresh as the
 * filter turns, so the threads of the one let go do not fade out under the
 * other's.
 */
function ThreadsPane({
  control,
  doors,
  filter,
  onFilter,
  empty,
  list,
  run,
  className,
  onShowWords,
}: {
  control: DescriptionCommentsControl;
  doors: ThreadDoors;
  filter: CommentsFilter;
  onFilter: (filter: CommentsFilter) => void;
  /** What the list says when it holds nothing, by its filter. */
  empty: Record<CommentsFilter, { readonly title: string; readonly line: string | undefined }>;
  list: RefObject<HTMLDivElement | null>;
  /** The run of threads the list draws, near its view alone. */
  run: RefObject<VirtualRowsHandle | null>;
  className: string;
  onShowWords: (thread: DescriptionCommentThread) => (() => void) | undefined;
}): React.JSX.Element {
  const listed = control.threads.filter((thread) =>
    filter === COMMENTS_FILTER.OPEN ? openThread(thread) : !openThread(thread),
  );

  return (
    <Fill className={className}>
      <WordsDatePickerRoom>
        <PaneBar
          title={COMMENTS_FILTER_WORDS[filter]}
          titleReplayUnmasked
          detail={listed.length}
          actions={
            <ResolvedOnly
              shown={filter === COMMENTS_FILTER.RESOLVED}
              onShown={(shown) => {
                onFilter(shown ? COMMENTS_FILTER.RESOLVED : COMMENTS_FILTER.OPEN);

                // Note that the other list starts at its top, not where the one it replaces was scrolled to.
                if (list.current !== null) list.current.scrollTop = 0;
              }}
            />
          }
        />
        <ScrollArea ref={list} fade={SCROLL_FADE.BOTH}>
          <ThreadList
            key={filter}
            control={control}
            listed={listed}
            empty={empty[filter]}
            doors={doors}
            onShowWords={onShowWords}
            scroller={list}
            handle={run}
          />
        </ScrollArea>
      </WordsDatePickerRoom>
    </Fill>
  );
}

/** What a thread being started on a page stands on: the element it was started from, picked or holding the words selected, and where it stood in the frame; neither for the whole page. */
export interface PageCommentOn {
  readonly element:
    | {
        readonly path: string;
        readonly quote: string;
        readonly section: string;
        readonly words?: true;
      }
    | undefined;
  readonly box: FrameBox | undefined;
}

/** What a page's thread being started is kept under in its draft: the page, one for each page. */
function pageDraftOn(pageId: string) {
  return { quote: pageId, scope: DESCRIPTION_COMMENT_SCOPE.PAGE } as const;
}

/** The draft a page's thread being started is written in, one for each page, the quotes it was started from among its words. */
export function pageDraftPlace(planId: string, pageId: string): DescriptionCommentPlace {
  return { kind: DRAFT_PLACE.DESCRIPTION_COMMENT, planId, on: pageDraftOn(pageId) };
}

/** A comment's words with `words` quoted after them, as the agent box's Reply lays a quote in, and an empty line under it to write on. */
export function withQuote(text: string, words: string): string {
  const kept = messageBlocks(text).filter(
    (block) => block.kind === MESSAGE_BLOCK.QUOTE || block.lines.some((line) => line.trim() !== ""),
  );

  return messageText([
    ...kept,
    { kind: MESSAGE_BLOCK.QUOTE, words: replyOf(words) },
    { kind: MESSAGE_BLOCK.WORDS, lines: [""] },
  ]);
}

/** What a page's comments pane says over a list holding nothing, by its filter. */
const NO_PAGE_COMMENTS = {
  [COMMENTS_FILTER.OPEN]: {
    title: "No comments",
    line: "Press Comment, then an element of the page, to start a thread with the agent that wrote it.",
  },
  [COMMENTS_FILTER.RESOLVED]: NO_COMMENTS[COMMENTS_FILTER.RESOLVED],
} as const satisfies Record<CommentsFilter, { title: string; line: string | undefined }>;

/** What commenting on a page says and offers. */
export const PAGE_COMMENT_WORDS = {
  COMMENT: "Comment on the page",
  PICKING: "Press an element of the page to comment on it",
  WHOLE_PAGE: "Whole page",
  DRAFT: "Draft comment",
} as const;

/** What a page's comments hold or keep open, and what keeps a card standing by the page open as it is pressed: its own boxes, a pin, and a menu or a question one of them opened. */
const KEEPS_PAGE_CARD_OPEN = `${KEEPS_THREAD_OPEN}, .page-comment-pin`;

function keepsPageCardOpen(target: Node): boolean {
  return target instanceof Element && target.closest(KEEPS_PAGE_CARD_OPEN) !== null;
}

/** Whether a comment's words hold any of the writer's own, past what they quote. */
export function ownWordsIn(text: string): boolean {
  return messageBlocks(text).some(
    (block) => block.kind === MESSAGE_BLOCK.WORDS && block.lines.some((line) => line.trim() !== ""),
  );
}

/**
 * A page's comments in the pane beside it, as the description's comments list lists
 * the description's: open or resolved under the same head, each thread whole under
 * its quote. A quote pressed outlines its element on the page, scrolled into
 * the frame's view, until a press anywhere but a thread or the page's pins
 * lets it go. A thread opened from its pin on the page is brought into the
 * pane's view, under Open.
 */
export function PageComments({
  control,
  doors,
  open,
  filter,
  onFilter,
  onOpen,
  review,
}: {
  /** The page's threads, as `useDescriptionComments` holds them for the page. */
  control: DescriptionCommentsControl;
  doors: Omit<ThreadDoors, "control" | "review">;
  /** The reader's review of the page, which a reply may be held in; none where comments are not held. */
  review?: PageReviewControl | undefined;
  /** The threads whose element is outlined, by their ids. */
  open: readonly string[] | undefined;
  /** Which threads the pane lists, kept by its tab so the pane shut and opened again lists the same. */
  filter: CommentsFilter;
  onFilter: (filter: CommentsFilter) => void;
  /** Outlines the thread's element, or lets the one outlined go where none is handed. */
  onOpen: (thread: DescriptionCommentThread | undefined) => void;
}): React.JSX.Element {
  const list = useRef<HTMLDivElement>(null);
  const run = useRef<VirtualRowsHandle>(null);
  usePressAway(NO_LAYER, () => undefined, {
    onPressAway: open === undefined ? undefined : () => onOpen(undefined),
    holds: keepsPageCardOpen,
  });
  // The thread opened from its pin is listed and brought into the pane's view, the pane alone moving.
  const first = open?.[0];
  const opened = control.threads.find((thread) => thread.id === first);

  const openedFilter =
    opened === undefined
      ? undefined
      : openThread(opened)
        ? COMMENTS_FILTER.OPEN
        : COMMENTS_FILTER.RESOLVED;

  useEffect(() => {
    if (openedFilter !== undefined) onFilter(openedFilter);
  }, [first, openedFilter, onFilter]);
  useLayoutEffect(() => {
    if (first === undefined || list.current === null) return;
    const card = list.current.querySelector<HTMLElement>(`.comment-card[data-thread="${first}"]`);

    // A thread its run has not drawn is brought into the middle of the pane as it is drawn.
    if (card === null) run.current?.bringIn(first);
    else centerWithin(list.current, card);
  }, [first, filter]);

  return (
    <ThreadsPane
      control={control}
      doors={{ ...doors, control, review }}
      filter={filter}
      onFilter={onFilter}
      empty={NO_PAGE_COMMENTS}
      list={list}
      run={run}
      className="page-comments relative h-full"
      onShowWords={(thread) =>
        thread.page?.element === undefined ? undefined : () => onOpen(thread)
      }
    />
  );
}

/** A box of the frame as the window measures it, from where the frame's room stands; none where either is not drawn. */
function inWindow(room: HTMLElement | null, box: FrameBox | undefined): FrameBox | undefined {
  if (room === null || box === undefined) return undefined;
  const at = room.getBoundingClientRect();

  return {
    left: at.left + box.left,
    top: at.top + box.top,
    right: at.left + box.right,
    bottom: at.top + box.bottom,
  };
}

/** The room a pin needs beside its element, a face and two figures across, short of which it stands inside the element's corner. */
const PIN_ROOM = 48;

/** Where an element's pin stands: beside it, or inside its corner where the room left of it is too narrow, as a phone's page inset is. */
function pinStands(box: FrameBox): CommentPinStands {
  return box.left < PIN_ROOM ? COMMENT_PIN_STANDS.INSIDE : COMMENT_PIN_STANDS.BESIDE;
}

/** Where the pin drawn for `path` stands in the window, which its card opens under; none where it is not drawn. */
function pinBox(pins: ReadonlyMap<string, HTMLElement>, path: string): FrameBox | undefined {
  return pins.get(path)?.getBoundingClientRect();
}

/**
 * Where a card about an element in the frame opens from, in the window:
 * under the element where the room shows its foot, and otherwise under its
 * top edge, where its pin stands, since a card under a foot past the room
 * has nowhere to stand; none where the element is not measured.
 */
function underElement(room: HTMLElement | null, box: FrameBox | undefined): FrameBox | undefined {
  if (room === null || box === undefined) return undefined;
  const foot = room.getBoundingClientRect().height;

  return inWindow(room, box.bottom <= foot ? box : { ...box, bottom: Math.max(box.top, 0) });
}

/** Keeps the pin drawn for `path` in `pins` while it stands, by its element's path. */
function keptPin(pins: Map<string, HTMLElement>, path: string) {
  return (node: HTMLElement | null) => {
    if (node === null) pins.delete(path);
    else pins.set(path, node);
  };
}

/** The pin drawn for `path`, its held comments' before its threads', where one stands. */
function pinOf(
  pins: readonly ReadonlyMap<string, HTMLElement>[],
  path: string,
): HTMLElement | undefined {
  for (const each of pins) {
    const pin = each.get(path)?.querySelector<HTMLElement>(".ui-comment-pin");

    if (pin !== undefined && pin !== null) return pin;
  }

  return undefined;
}

/**
 * Tells the comments on the element marked that the pointer is over in the
 * page (`over`), as the pointer over its pin tells them, and lets them go
 * as it leaves for another or for none. Note that its pins may be drawn
 * only after the pointer arrived, as a comment held there is, or a held one
 * posted, so whether each is drawn (`drawn`) asks again.
 */
function usePointedPin(
  over: string | undefined,
  drawn: { readonly held: boolean; readonly posted: boolean },
  held: ReadonlyMap<string, HTMLElement>,
  posted: ReadonlyMap<string, HTMLElement>,
): void {
  const { held: heldDrawn, posted: postedDrawn } = drawn;
  useEffect(() => {
    if (over === undefined || !(heldDrawn || postedDrawn)) return undefined;
    const pin = pinOf([held, posted], over);

    if (pin === undefined) return undefined;
    pointCard(pin, true);

    return () => pointCard(pin, false);
  }, [over, heldDrawn, postedDrawn, held, posted]);
}

/** Where a thread on the whole page is started: the frame's top edge. */
const PAGE_TOP: FrameBox = { left: 0, top: 0, right: 0, bottom: 0 };

/** The open threads on each element of the page, by its path, in the order they were started; a thread on the whole page is on none. */
export function threadsByElement(
  threads: readonly DescriptionCommentThread[],
): ReadonlyMap<string, readonly DescriptionCommentThread[]> {
  const by = new Map<string, DescriptionCommentThread[]>();

  for (const thread of threads) {
    const path = thread.page?.element;

    if (path === undefined || !openThread(thread)) continue;
    by.set(path, [...(by.get(path) ?? []), thread]);
  }

  return by;
}

/** A preview's files by their names and types alone, which it draws and opens none of. */
const NO_PREVIEW_FILES: readonly Pick<FileChip, "name" | "mediaType">[] = [];

/** What a pin's card says of one comment: who wrote it and when, the words it quotes where they were chosen, and its words. */
interface PreviewEntry {
  readonly head: Pick<
    Parameters<typeof Comment>[0],
    "author" | "nameRef" | "status" | "at" | "now"
  >;
  readonly quote?: string | undefined;
  readonly words: string;
  readonly files?: readonly Pick<FileChip, "name" | "mediaType">[] | undefined;
}

/**
 * A pin's comments as the pointer over it, or over its element in the
 * page, is told them: each whole, under the words it quotes where they were
 * chosen, so several on one element tell which words each is on, scrolling
 * past the card's height.
 */
function PinPreview({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <HoverCard>
      <HoverCardScroll>
        <Stack gap={GAP.BLOCK}>{children}</Stack>
      </HoverCardScroll>
    </HoverCard>
  );
}

/** One comment in a pin's card. */
function PreviewComment({
  head,
  quote,
  words,
  files = NO_PREVIEW_FILES,
}: PreviewEntry): React.JSX.Element {
  const shown = useWordFiles(
    files.map((file) => ({ name: file.name, mediaType: file.mediaType, url: "" })),
    words,
  );

  return (
    <Comment {...head}>
      {quote === undefined ? null : (
        <QuoteLine words={quote} label={COMMENT_WORDS.SHOW_ELEMENT} whole />
      )}
      <CommentWords words={words} files={shown.named} />
    </Comment>
  );
}

/** A thread's first comment in its pin's card, under the words it quotes where they were chosen. */
function ThreadPreview({
  thread,
  agents,
  now,
}: {
  thread: DescriptionCommentThread;
  agents: EditAgents | undefined;
  now: number;
}): React.JSX.Element | null {
  const first = thread.entries.find((entry) => entry.kind === DESCRIPTION_COMMENT_ENTRY.COMMENT);
  const fallback: DescriptionCommentWriter = { actor: DESCRIPTION_COMMENT_ACTOR.MEMBER };
  const { author, nameRef } = useWriter(first?.writer ?? fallback, agents);

  if (first === undefined) return null;

  return (
    <PreviewComment
      head={{ author, nameRef, at: first.at, now }}
      quote={thread.scope === DESCRIPTION_COMMENT_SCOPE.WORDS ? thread.quote : undefined}
      words={ownWordsOf(thread, first.words ?? "")}
      files={first.files}
    />
  );
}

/**
 * The pin of the threads on one element: the bubble wearing the face of
 * whoever started the first, told over it that comment whole, as its
 * thread draws it.
 */
function PagePin({
  threads,
  doors,
  open,
  onOpen,
  onHint,
  cardAt,
  stands,
}: {
  threads: readonly DescriptionCommentThread[];
  doors: Omit<ThreadDoors, "control" | "review">;
  open: boolean;
  onOpen: () => void;
  onHint: (over: boolean) => void;
  /** Where its preview hangs from, where its comments open when pressed. */
  cardAt: () => FrameBox | undefined;
  stands: CommentPinStands;
}): React.JSX.Element | null {
  const now = useMinute();
  const thread = threads[0];
  const first = thread?.entries.find((entry) => entry.kind === DESCRIPTION_COMMENT_ENTRY.COMMENT);
  const fallback: DescriptionCommentWriter = { actor: DESCRIPTION_COMMENT_ACTOR.MEMBER };
  const { author } = useWriter(first?.writer ?? fallback, doors.agents);
  const comments = threads.length;

  return (
    <CommentPin
      cardAt={cardAt}
      author={author}
      count={comments}
      label={`${comments} ${comments === 1 ? "comment" : "comments"}`}
      open={open}
      stands={stands}
      onPress={onOpen}
      onHover={onHint}
      preview={
        thread === undefined || first === undefined ? null : (
          <PinPreview>
            {threads.map((each) => (
              <ThreadPreview key={each.id} thread={each} agents={doors.agents} now={now} />
            ))}
          </PinPreview>
        )
      }
    />
  );
}

/** The reader as a comment of theirs draws them: their face and their name. */
function useReaderWriter(): { author: CommentAuthor; nameRef: ReactNode } {
  const { readerId } = useMemberDirectory();
  const reader = usePerson(readerId === undefined ? undefined : { userId: readerId, name: "" });

  return { author: commentAuthor(reader), nameRef: <ActorRef actor={reader} nameOnly /> };
}

/** A held comment's words as drawn: without its element's words it opens with, which its quote line says. */
function heldWords(comment: HeldComment): string {
  return comment.element === undefined
    ? comment.words
    : leadQuoteDropped(comment.words, comment.element.quote);
}

/**
 * A comment held in the reader's review, drawn as a posted comment is, in
 * their name: Pending right after the name, where its time would stand,
 * whether or not its ⋯ is shown, and its ⋯ at the head's
 * end with Edit, which opens its words in place in a posted comment's edit
 * field, and Delete, which takes it out of the review at once with Undo.
 * Where it stands apart from its element, in the Review panel, its quote line
 * says what it is on, its element's words, its thread's quote where it is a
 * reply, or the page's title, and pressed, shows its element on the page; by
 * its element, it says the words it was started on where they were selected
 * in it, as several comments' may be.
 */
export function PendingPageComment({
  comment,
  review,
  busy,
  title,
  onShow,
}: {
  comment: HeldComment;
  review: Pick<PageReviewControl, "edit" | "remove" | "markEditing">;
  /** Whether the review is on its way, which offers no Edit or Delete. */
  busy: boolean;
  /** The page's title, the quote line of a comment on the whole page; none where it stands by its element, which draws the words selected alone. */
  title?: string | undefined;
  /** Shows its element on the page; none where its quote line is only words. */
  onShow?: ((path: string) => void) | undefined;
}): React.JSX.Element {
  const { author, nameRef } = useReaderWriter();
  const [editing, setEditing] = useState<string | undefined>(undefined);
  const words = heldWords(comment);
  const open = editing !== undefined;
  const { markEditing } = review;
  // Note that the review waits on an edit standing open, so it never sends words the edit is about to change.
  useEffect(() => {
    if (!open) return undefined;
    markEditing(comment.clientKey, true);

    return () => markEditing(comment.clientKey, false);
  }, [open, markEditing, comment.clientKey]);
  const { clientKey, element } = comment;

  // What its quote line says: apart from its element, what it is on; by it, the words it was started on where they are a few of the element's.
  const quoted =
    title === undefined
      ? element?.words === true
        ? element.quote
        : undefined
      : (comment.reply?.quote ?? element?.quote ?? title);

  // The element its quote line shows: its own, or the one its thread is on, where it is a reply.
  const shownPath = comment.reply === undefined ? element?.path : comment.reply.path;

  // Note that one a send posted already is the service's as it stood, so it offers neither.
  const groups: MenuAction[][] =
    busy || comment.landed === true
      ? []
      : [
          [
            {
              label: COMMENT_WORDS.EDIT,
              icon: <GLYPH.RENAME />,
              onSelect: () => setEditing(words),
            },
          ],
          [
            {
              label: COMMENT_WORDS.DELETE,
              icon: <TrashIcon />,
              danger: true,
              onSelect: () => review.remove(clientKey),
            },
          ],
        ];

  // Note that an edit emptied deletes the comment, as a posted one's does, here at once with Undo.
  const save = ({ added }: EditedFiles) => {
    const next = editing?.trim() ?? "";
    setEditing(undefined);

    if (next === "") review.remove(clientKey);
    else review.edit(clientKey, next, added);
  };

  return (
    <div className="comment-entry relative py-tight-gap" data-pending={clientKey}>
      <Comment
        author={author}
        nameRef={nameRef}
        status={<PendingWords />}
        trailing={
          editing === undefined ? (
            <CommentTools>
              <CommentMenu groups={groups} />
            </CommentTools>
          ) : undefined
        }
      >
        {quoted === undefined ? null : (
          <QuoteLine
            words={quoted}
            label={COMMENT_WORDS.SHOW_ELEMENT}
            whole={comment.reply === undefined && element?.words === true}
            onShow={
              shownPath === undefined || onShow === undefined ? undefined : () => onShow(shownPath)
            }
          />
        )}
        {editing === undefined ? (
          <CommentBody chips={attachmentChips(comment.attachments)} words={words} />
        ) : (
          <CommentEditField
            planId={comment.planId}
            files={NO_FILES}
            attached={comment.attachments}
            value={editing}
            onChange={setEditing}
            onSave={save}
            onCancel={() => setEditing(undefined)}
          />
        )}
      </Comment>
    </div>
  );
}

/** How far left of an element a pin of held comments stands where a pin of its posted threads stands beside it already, so neither covers the other. */
const HELD_PIN_STEP = 28;

/**
 * The pin of the comments the reader holds on one element in their review,
 * dashed, wearing their own face, told over it as a posted pin is, the
 * first whole, Pending where the time would stand; a press opens them under
 * the pin, as a posted pin opens its threads.
 */
function HeldPin({
  held,
  open,
  stands,
  onOpen,
  onHint,
  cardAt,
}: {
  held: readonly HeldComment[];
  open: boolean;
  stands: CommentPinStands;
  onOpen: () => void;
  onHint: (over: boolean) => void;
  /** Where its preview hangs from, where its comments open when pressed. */
  cardAt: () => FrameBox | undefined;
}): React.JSX.Element {
  const { author, nameRef } = useReaderWriter();
  const first = held[0];

  return (
    <CommentPin
      cardAt={cardAt}
      author={author}
      count={held.length}
      label={PAGE_REVIEW_WORDS.pin(held.length)}
      open={open}
      look={COMMENT_PIN_LOOK.HELD}
      stands={stands}
      onPress={onOpen}
      onHover={onHint}
      preview={
        first === undefined ? null : (
          <PinPreview>
            {held.map((comment) => (
              <PreviewComment
                key={comment.clientKey}
                head={{ author, nameRef, status: <PendingWords /> }}
                quote={comment.element?.words === true ? comment.element.quote : undefined}
                words={heldWords(comment)}
                files={comment.attachments}
              />
            ))}
          </PinPreview>
        )
      }
    />
  );
}

/** What a draft's pin says where a comment's time would stand. */
function DraftWords(): React.JSX.Element {
  return (
    <QuietWords>
      <ReplayUnmask>{DRAFT_WORD}</ReplayUnmask>
    </QuietWords>
  );
}

/**
 * The pin of a comment the reader started on the page and left unsent,
 * its words kept as its draft: the muted pencil in a face's place, told
 * over it the words left, Draft where the time would stand; a press opens
 * the comment again where it was started, its words as they were left.
 */
function DraftPin({
  words,
  files,
  stands,
  onOpen,
  onHint,
  cardAt,
}: {
  words: string;
  files: readonly AgentAttachment[];
  stands: CommentPinStands;
  onOpen: () => void;
  onHint: (over: boolean) => void;
  /** Where its preview hangs from, where its comments open when pressed. */
  cardAt: () => FrameBox | undefined;
}): React.JSX.Element {
  const { author, nameRef } = useReaderWriter();

  return (
    <CommentPin
      cardAt={cardAt}
      look={COMMENT_PIN_LOOK.DRAFT}
      label={PAGE_COMMENT_WORDS.DRAFT}
      open={false}
      stands={stands}
      onPress={onOpen}
      onHover={onHint}
      preview={
        <PinPreview>
          <PreviewComment
            head={{ author, nameRef, status: <DraftWords /> }}
            words={words}
            files={files}
          />
        </PinPreview>
      }
    />
  );
}

/** The comments held in a review on each element of the page, by its path, in the order they were held; one on the whole page is on none. */
function heldByElement(held: readonly HeldComment[]): ReadonlyMap<string, readonly HeldComment[]> {
  const by = new Map<string, HeldComment[]>();

  for (const comment of held) {
    const path = comment.element?.path;

    if (path !== undefined) by.set(path, [...(by.get(path) ?? []), comment]);
  }

  return by;
}

/**
 * Where a draft's pin stands: by its element's top start corner, stepped
 * left past the pins already standing there, or at the frame's top corner
 * where it is on the whole page or its element is no longer on the page;
 * none while its element is scrolled up out of the frame or not yet
 * measured. `at` is the element's box, which its card opens by again.
 */
function draftPinAt(
  drafted: { readonly element: DraftPageElement | undefined } | undefined,
  marks: ReadonlyMap<string, FrameBox | null>,
  pinsAt: (path: string) => number,
): { box: FrameBox; step: number; at: FrameBox | undefined } | undefined {
  if (drafted === undefined) return undefined;
  const path = drafted.element?.path;

  if (path === undefined) return { box: PAGE_TOP, step: 0, at: undefined };
  const box = marks.get(path);

  if (box === undefined) return undefined;

  if (box === null) return { box: PAGE_TOP, step: 0, at: undefined };

  if (box.bottom < 0) return undefined;

  return { box, step: pinsAt(path) * HELD_PIN_STEP, at: box };
}

/**
 * A page's comments over the page itself, as the description's folded margin draws
 * its own: each element holding open threads pinned with the face of who
 * started them, the pointer over a pin, or over its element in the page,
 * told every comment on it, and a press opening its threads in a card
 * under the element, where the comment that started them was written and
 * clear of what they are on, or closing them, where the column beside the
 * page does not stand to open them in;
 * the thread being started, in a card by the element it was started from;
 * while the page is picking an element, a line saying so, with Whole page
 * and Cancel; and Reply by words selected in the page, which quotes them
 * into the comment being written, or starts one on the element holding
 * them. A comment being started may be held in the reader's review
 * instead, pinned dashed to its element until the review is sent, its pin
 * opening the comments held there in a card under the element, as a posted
 * pin opens its threads, column or no column, since the column lists
 * posted threads alone. A comment started and let go with words of the
 * writer's own left in it is pinned where it was started, the muted pencil
 * in a face's place, its pin opening it again as it was left, so a draft
 * never waits unseen until its element is picked again. A card
 * closes on a press away, a press in the page among them, as a
 * description's does. It stands over the frame's room, where every box the frame
 * says it measured in its own viewport stands as it is, and takes no press
 * but its own.
 */
export function PageCommentLayer({
  control,
  doors,
  page,
  room,
  marks,
  selected,
  over,
  picking,
  pending,
  open,
  floats,
  onOpen,
  onHint,
  onReply,
  onWholePage,
  onStopPick,
  onStarted,
  onCancel,
  drafted,
  onReopen,
  review,
}: {
  control: DescriptionCommentsControl;
  doors: Omit<ThreadDoors, "control" | "review">;
  /** The reader's review of the page; none where comments are not held, which posts each at once. */
  review?: PageReviewControl | undefined;
  /** The page and the version shown, which a thread is started on. */
  page: { readonly id: string; readonly version: number };
  /** The frame's room, which the layer fills. */
  room: RefObject<HTMLElement | null>;
  /** Where each element holding threads stands in the frame, by its path; none where the page holds it no more. */
  marks: ReadonlyMap<string, FrameBox | null>;
  /** The words selected in the page, as the frame said them. */
  selected: PagePicked | undefined;
  /** The element marked that the pointer is over in the page, whose comments are told as its pin's are; none. */
  over: string | undefined;
  picking: boolean;
  pending: PageCommentOn | undefined;
  /** The threads open, by their ids. */
  open: readonly string[] | undefined;
  /** Whether threads open in a card by their element here, rather than in the column beside the page. */
  floats: boolean;
  onOpen: (threads: readonly string[] | undefined) => void;
  /** Told the element whose pin the pointer is over, or none as it leaves. */
  onHint: (path: string | undefined) => void;
  onReply: (selected: PagePicked) => void;
  onWholePage: () => void;
  onStopPick: () => void;
  onStarted: (threadId: string) => void;
  onCancel: () => void;
  /** The comment started and let go with words of the writer's own, its words and the element it was started on, none on the whole page; none where no such draft waits. */
  drafted:
    | {
        readonly words: string;
        readonly attachments: readonly AgentAttachment[];
        readonly element: DraftPageElement | undefined;
      }
    | undefined;
  /** Opens the draft again where it was started, `box` where its element stands in the frame, none on the whole page. */
  onReopen: (box: FrameBox | undefined) => void;
}): React.JSX.Element {
  const full = { ...doors, control, review };
  const byElement = threadsByElement(control.threads);
  const opened = control.threads.filter((thread) => open?.includes(thread.id) === true);
  const at = opened[0]?.page?.element;
  const starting = useRef<HTMLDivElement>(null);
  // The pins drawn, by their element's path, which a card opened from one stands under.
  const postedPins = useRef(new Map<string, HTMLElement>());
  const heldPins = useRef(new Map<string, HTMLElement>());
  // The element whose held comments stand open by it, by its path; none open.
  const [heldOpen, setHeldOpen] = useState<string | undefined>(undefined);

  const heldThere =
    heldOpen === undefined ? [] : (heldByElement(review?.held ?? []).get(heldOpen) ?? []);

  // Note that the last held comment on the element deleted lets the element go, so the next held there opens nothing until its pin is pressed.
  useEffect(() => {
    if (heldOpen !== undefined && heldThere.length === 0) setHeldOpen(undefined);
  }, [heldOpen, heldThere.length]);

  const pins = [...byElement].flatMap(([path, threads]) => {
    const box = marks.get(path);

    // Note that an element scrolled up out of the frame is pinned nowhere until it comes back, and one below it stands past the room's foot, which clips it.
    if (box === undefined || box === null || box.bottom < 0) return [];

    return [{ path, threads, box }];
  });

  const heldMarks = [...heldByElement(review?.held ?? [])].flatMap(([path, held]) => {
    const box = marks.get(path);

    if (box === undefined || box === null || box.bottom < 0) return [];

    return [{ path, held, box, step: byElement.has(path) ? HELD_PIN_STEP : 0 }];
  });

  usePointedPin(
    over,
    {
      held: heldMarks.some((mark) => mark.path === over),
      posted: pins.some((pin) => pin.path === over),
    },
    heldPins.current,
    postedPins.current,
  );

  // Note that a draft's pin stands left of its element's posted and held pins, so none covers another.
  const draftMark = draftPinAt(
    drafted,
    marks,
    (path) => Number(byElement.has(path)) + Number(heldMarks.some((mark) => mark.path === path)),
  );

  return (
    <div className="page-comment-layer">
      {review === undefined
        ? null
        : heldMarks.map(({ path, held, box, step }) => (
            <span
              key={path}
              ref={keptPin(heldPins.current, path)}
              className="page-comment-pin"
              data-stands={pinStands(box)}
              style={{ left: Math.max(box.left - step, 0), top: Math.max(box.top, 0) }}
            >
              <HeldPin
                held={held}
                open={heldOpen === path}
                stands={pinStands(box)}
                cardAt={() => underElement(room.current, marks.get(path) ?? undefined)}
                onOpen={() => {
                  // Note that an edit standing open holds its card, so no pin takes its place until it is saved or canceled.
                  if (review.editing) return;
                  onOpen(undefined);
                  setHeldOpen(heldOpen === path ? undefined : path);
                }}
                onHint={(over) => onHint(over ? path : undefined)}
              />
            </span>
          ))}
      {pins.map(({ path, threads, box }) => (
        // Note that the bubble's pointed corner touches its element's top start corner, beside it, or inside it where the room has none beside it.
        <span
          key={path}
          ref={keptPin(postedPins.current, path)}
          className="page-comment-pin"
          data-stands={pinStands(box)}
          style={{ left: Math.max(box.left, 0), top: Math.max(box.top, 0) }}
        >
          <PagePin
            threads={threads}
            doors={doors}
            open={threads.some((thread) => open?.includes(thread.id) === true)}
            onOpen={() => {
              if (review?.editing === true) return;
              setHeldOpen(undefined);
              onOpen(
                threads.some((thread) => open?.includes(thread.id) === true)
                  ? undefined
                  : threads.map((thread) => thread.id),
              );
            }}
            onHint={(over) => onHint(over ? path : undefined)}
            stands={pinStands(box)}
            cardAt={() => underElement(room.current, marks.get(path) ?? undefined)}
          />
        </span>
      ))}
      {drafted === undefined || draftMark === undefined ? null : (
        <span
          className="page-comment-pin"
          data-stands={pinStands(draftMark.box)}
          style={{
            left: Math.max(draftMark.box.left - draftMark.step, 0),
            top: Math.max(draftMark.box.top, 0),
          }}
        >
          <DraftPin
            words={drafted.words}
            files={drafted.attachments}
            stands={pinStands(draftMark.box)}
            cardAt={() => underElement(room.current, draftMark.at ?? PAGE_TOP)}
            onOpen={() => {
              if (review?.editing === true) return;
              setHeldOpen(undefined);
              onOpen(undefined);
              onReopen(draftMark.at);
            }}
            onHint={(over) => onHint(over ? drafted.element?.path : undefined)}
          />
        </span>
      )}
      <RectFloat
        open={floats && opened.length > 0}
        // Note that a thread opens under its element, where the comment that started it was written, clear of what it is on; under its pin where the element is not measured.
        anchor={() =>
          at === undefined
            ? inWindow(room.current, PAGE_TOP)
            : (underElement(room.current, marks.get(at) ?? undefined) ??
              pinBox(postedPins.current, at))
        }
        side={POPOVER_SIDE.BELOW}
        // Note that a held reply's edit standing open in a thread holds the card, so a stray press never drops its words.
        onPressAway={() => {
          if (review?.editing !== true) onOpen(undefined);
        }}
        holds={keepsPageCardOpen}
      >
        {/* Note that the threads stand no taller than the room their side leaves, so each card scrolls its entries above its reply field, and several scroll together, rather than run off the room's edge. */}
        <div className="page-comment-float page-comment-threads">
          <ScrollArea size={SCROLL_SIZE.CONTENT} overscroll={SCROLL_OVERSCROLL.CHAIN}>
            <div className="comment-float-cards">
              {opened.map((thread) => (
                <ThreadCard
                  key={thread.id}
                  thread={thread}
                  open
                  place={THREAD_PLACE.FLOAT}
                  doors={full}
                  // Note that words selected in the element are quoted over their thread, since several threads' words may stand in one element.
                  quote={thread.scope === DESCRIPTION_COMMENT_SCOPE.WORDS}
                />
              ))}
            </div>
          </ScrollArea>
        </div>
      </RectFloat>
      <RectFloat
        open={review !== undefined && heldThere.length > 0}
        anchor={() =>
          heldOpen === undefined
            ? undefined
            : (underElement(room.current, marks.get(heldOpen) ?? undefined) ??
              pinBox(heldPins.current, heldOpen))
        }
        side={POPOVER_SIDE.BELOW}
        // Note that an edit standing open in the card holds it, so its words are never lost to a stray press.
        onPressAway={() => {
          if (review?.editing !== true) setHeldOpen(undefined);
        }}
        holds={keepsPageCardOpen}
      >
        {review === undefined ? null : (
          <div className="page-comment-float page-comment-threads">
            <ScrollArea size={SCROLL_SIZE.CONTENT} overscroll={SCROLL_OVERSCROLL.CHAIN}>
              <div className="comment-float-cards">
                <CommentCard place={THREAD_PLACE.FLOAT} open>
                  {heldThere.map((comment) => (
                    <PendingPageComment
                      key={comment.clientKey}
                      comment={comment}
                      review={review}
                      busy={review.sending}
                    />
                  ))}
                </CommentCard>
              </div>
            </ScrollArea>
          </div>
        )}
      </RectFloat>
      <RectFloat
        open={pending !== undefined}
        anchor={() => underElement(room.current, pending?.box ?? PAGE_TOP)}
        side={POPOVER_SIDE.BELOW}
        // Note that a comment being sent, or holding files or a dictation, which no draft keeps, stands through a press away, as a description's does.
        onPressAway={() => {
          if (starting.current?.querySelector('[data-held="true"]') === null) onCancel();
        }}
        holds={keepsPageCardOpen}
      >
        {pending === undefined ? null : (
          <div ref={starting} className="page-comment-float">
            <PendingCard
              on={pageDraftOn(page.id)}
              place={THREAD_PLACE.FLOAT}
              // Note that an element picked has its words stand over the field as the thread's quote line will, while words replied to stand in the field as the quote Reply laid in.
              head={
                pending.element === undefined || pending.element.words === true ? undefined : (
                  <QuoteLine words={pending.element.quote} label={COMMENT_WORDS.SHOW_ELEMENT} />
                )
              }
              doors={full}
              begin={(first) => ({
                ...first,
                page: { id: page.id, version: page.version },
                ...(pending.element === undefined ? undefined : { element: pending.element }),
              })}
              onStarted={onStarted}
              onCancel={onCancel}
              review={
                review === undefined
                  ? undefined
                  : {
                      open: review.held.length > 0,
                      onHold: (words, attachments) =>
                        review.hold({
                          clientKey: crypto.randomUUID(),
                          version: page.version,
                          element: pending.element,
                          words,
                          attachments,
                        }),
                    }
              }
            />
          </div>
        )}
      </RectFloat>
      {picking ? (
        <MenuSurface flow={MENU_SURFACE_FLOW.TOOLBAR} className="page-comment-hint">
          <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED} as={TEXT_ELEMENT.SPAN}>
            {PAGE_COMMENT_WORDS.PICKING}
          </Text>
          <Button onClick={onWholePage}>{PAGE_COMMENT_WORDS.WHOLE_PAGE}</Button>
          <Button onClick={onStopPick}>{COMMENT_WORDS.CANCEL}</Button>
        </MenuSurface>
      ) : selected === undefined ? null : (
        <SelectedReply room={room} selected={selected} onReply={onReply} />
      )}
    </div>
  );
}

/** Reply by the words selected in the page, where they stand in the window. */
function SelectedReply({
  room,
  selected,
  onReply,
}: {
  room: RefObject<HTMLElement | null>;
  selected: PagePicked;
  onReply: (selected: PagePicked) => void;
}): React.JSX.Element | null {
  const box = inWindow(room.current, selected.box);

  if (box === undefined || room.current === null) return null;

  return (
    <ReplyPress
      place={pressPlace(box, roomAround(room.current))}
      onReply={() => onReply(selected)}
    />
  );
}
