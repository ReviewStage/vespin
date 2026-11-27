/**
 * manager-chat-tab.tsx -- a Manager's page as its chat: the messages its people and it sent, drawn from the chat's own rows, the work under them a press away, and the box that sends to it.
 *
 * A Manager's chat is the conversation over its transcript, never the
 * transcript itself: its messages are the chat's own rows
 * (`LIVE_READ.MANAGER_CHAT`), which the host follows while the page shows
 * them and reads older pages of as the reader nears the top, and the page
 * draws them as a chat app does (`managerChatView`): oldest first, in runs
 * by sender, the reader's own at the column's right and everyone else's at
 * its left, the Manager's beside its face and under its name. The greeting
 * the Manager opens on stands above its first message once the chat's start
 * is read, since nothing stores it. Each message is a row of the log's run
 * (`ConversationRows`), drawn only near the view, which opens at the chat's
 * end and keeps to it as messages land, and which ⌘F reads by its words.
 *
 * The transcript is the work under the chat, read beside it only for what
 * a chat shows of it: whether a turn is under way, which the working line
 * says, and each turn's work, which Show work opens under the Manager's
 * first message of the turn, among its actions and in its menu, and which
 * the working line opens for the turn under way. A call the Manager holds for the reader's answer stands at the chat's
 * foot, its answers under it, since the work it stands in is a press away. A
 * message the reader sends goes to the chat (`agents.chat.send`) and stands
 * drawn at its end from the moment it is sent, as the host draws it on its
 * way, until its row lands; one refused stands marked, with Retry, Edit, and
 * Delete, as any of the agent box's lines does. Each message may be given
 * the reader's 👍 or 👎 from its actions, and wears the reactions it was
 * given under its words (`manager-chat-reactions.tsx`). The first message
 * after the reader's mark, where the chat stood unread as the page opened
 * or where the reader marked one of its messages unread, stands under New
 * (`manager-chat-looks.ts`).
 * The reader's own message offers Edit, which writes its words again where
 * it stands, as a channel's edit does, marking it edited and telling the
 * Manager, and never takes the Manager back (`manager-chat-edit.tsx`). No
 * message of the chat offers Rewind conversation to here, as a channel takes
 * nothing back; the rewind itself stays the agent tab's (`rewind-action.tsx`).
 */

import { waitingOnYouWords } from "@repo/features/agent-approval-model";
import { endLineReason } from "@repo/features/agent-continue-model";
import { computerAppsOf } from "@repo/features/agent-parts";
import type { ShownPicture } from "@repo/features/agent-pictures-model";
import type {
  AgentChatSendParams,
  ManagerChatSending,
  SendingMessage,
} from "@repo/features/agent-view";
import { TRANSCRIPT_KIND } from "@repo/features/agent-view";
import {
  AGENT_STATUS,
  type AgentSummary,
  type AgentTranscriptMessage,
} from "@repo/features/agent-wire";
import { keptPictureSchema } from "@repo/features/conversation-picture-wire";
import { ENTITY_KIND } from "@repo/features/entity-kind";
import { LINK_DESTINATION, type LinkDestination } from "@repo/features/link-grammar";
import { MANAGER_CHAT_AUTHOR, type ManagerChatLiveMessage } from "@repo/features/manager-chat-live";
import {
  CHAT_LANDING,
  CHAT_RUN_ALONE,
  type ChatRunPlace,
  chatMessageLanding,
  type ManagerChatLine,
  managerChatView,
} from "@repo/features/manager-chat-view";
import type { ManagerFace as ManagerFaceValue } from "@repo/features/manager-face";
import { managerGreeting } from "@repo/features/manager-greeting";
import type { MessageFileChip } from "@repo/features/message-files";
import { FAILURE_CONDITION, FAILURE_SURFACE } from "@repo/features/shown-failure";
import { ACT_KIND } from "@repo/host/acts";
import {
  ChannelMessage,
  EmptyState,
  GlyphSlot,
  NewMessagesRule,
  STATUS_TONE,
  ThreadRule,
  TIME_LOOK,
  Time,
} from "@repo/ui";
import {
  Conversation,
  ConversationContent,
  ConversationRows,
  ConversationScrollButton,
} from "@repo/ui/conversation";
import { ICON_SIZE } from "@repo/ui/icons";
import { MANAGER_FACE_SIZE, ManagerFace } from "@repo/ui/manager-face";
import { TAB_WORDS } from "@repo/ui/tab-strip-model";
import { useUntilFound } from "@repo/ui/use-until-found";
import type { VirtualRowsHandle } from "@repo/ui/virtual-rows";
import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Option, Schema } from "effect";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentActAnswer } from "../act.js";
import { actMutation } from "../act-mutations.js";
import { ACTOR_SIZE, ActorMark, ActorRef } from "../actor-ref.js";
import { EntityGlyph } from "../entities/entity-glyph.js";
import { useFindOpen } from "../find-in-tab.js";
import { managerChatQuery, managerChatRetryMutation } from "../live-reads.js";
import { useMemberDirectory, usePerson } from "../member-directory.js";
import { keepPictureRead } from "../picture-query.js";
import { useToast } from "../toast.js";
import { type FindRow, useVirtualFind } from "../virtual-find.js";
import {
  ApprovalsProvider,
  heldCallPart,
  useAgentApprovals,
  useApprovingSend,
} from "./agent-approvals.js";
import { type AgentBox, useAgentBox } from "./agent-box.js";
import { BUTTON, type ComposerWords } from "./agent-composer.js";
import { AgentComposerDock, boxTakesWords } from "./agent-composer-dock.js";
import { AgentEndRow } from "./agent-end-row.js";
import { useCallRoute } from "./agent-machines.js";
import {
  agentName,
  endLineParts,
  providerOf,
  SENT_LINE_STATE,
  type SentLine,
  tabTurnOf,
  teammateStarter,
  workingLineWords,
} from "./agent-model.js";
import {
  AgentPicturesProvider,
  KeptFileChips,
  KeptShownSet,
  useAgentPictureDoor,
} from "./agent-pictures.js";
import type { DelegationDoors } from "./agent-tab.js";
import { LOG_ROW_CLASS, ToolCallView, TurnWorkRows } from "./agent-tab.js";
import { AgentTabFoot, AgentTabFrame } from "./agent-tab-frame.js";
import { TranscriptSkeleton } from "./agent-tab-skeleton.js";
import { useChatMessageMenu } from "./chat-message-menu.js";
import { type ChatWorkToggle, WorkingWorkAction, WorkMessageAction } from "./chat-work.js";
import { CopyMessageAction } from "./copy-message.js";
import {
  type ChatEdit,
  ChatEditField,
  EditChatMessageAction,
  useChatEdit,
} from "./manager-chat-edit.js";
import { useManagerChatLooks } from "./manager-chat-looks.js";
import {
  type ChatReact,
  ChatReactions,
  ReactMessageActions,
  useChatReact,
} from "./manager-chat-reactions.js";
import {
  THREAD_WORDS,
  ThreadReplyAction,
  ThreadSummary,
  useThreadDoors,
} from "./manager-chat-threads.js";
import { CHAT_MESSAGE_GONE, useMessageReveal } from "./message-links.js";
import { useMoveToCloud } from "./move-agent.js";
import { SentMessage } from "./skill-chip.js";
import { type AgentThreads, ThreadsDock } from "./threads-dock.js";
import { TranscriptWords } from "./transcript-blocks.js";
import { OlderReadFailed, TranscriptReadFailed } from "./transcript-read-failed.js";
import { UndeliveredLines, UndeliveredMark, useSentLineMarks } from "./undelivered-mark.js";
import {
  fileUrl,
  type MessageSender,
  type MessageUnsender,
  useAgentComposer,
} from "./use-agent-composer.js";
import { useAgentEndDoors } from "./use-agent-end-doors.js";
import { useAgentQueue, useQueueEditing } from "./use-agent-queue.js";
import { useAgentTranscript } from "./use-agent-transcript.js";
import type { AgentsControl } from "./use-agents.js";
import { WorkingLine } from "./working-time.js";

/** A Manager as its chat draws it: its name over each run of its messages, and its face beside the run, none where a service older than faces answers. */
interface ChatManagerLook {
  readonly name: string;
  readonly face: ManagerFaceValue | undefined;
}

/** What each message of the chat reads beside its row: the Manager it is the chat of, the reader, and how each turn's work is drawn. */
interface ChatDoors {
  /** The Manager whose chat it is, which each message's link names it under. */
  readonly agentId: string;
  readonly manager: ChatManagerLook;
  readonly readerId: string | undefined;
  readonly delegation: DelegationDoors;
  /** The transcript's lines by their ids, which a person's message opens for writing again by its line (`lineId`). */
  readonly lines: ReadonlyMap<string, AgentTranscriptMessage>;
  /** The chat's threads, which its rows open; none in a thread's own tab, whose rows open no thread, nor where nothing beside the chat shows a thread. */
  readonly thread?: ChatThreadDoors | undefined;
  /** Gives a message the reader's 👍 or 👎, or takes it off. */
  readonly react: ChatReact;
  /** The reader's edit of their own messages: which stands open, and its presses. */
  readonly edit: ChatEdit;
  /** Moves the reader's mark of the chat back to just before one of its messages, which its menu's Mark as unread presses; none in a thread's tab. */
  readonly markUnread?: ((message: ManagerChatLiveMessage) => void) | undefined;
}

/** The chat's threads as its rows read them: each root's replies by the root's id, the thread its page's side panel shows, and the press that opens one there. */
interface ChatThreadDoors {
  readonly replies: ReadonlyMap<string, readonly ManagerChatLine[]>;
  readonly open: string | undefined;
  readonly onOpen: (root: string) => void;
}

/** What a row offers of its thread: Reply in thread beside its Copy, and the summary of its replies under it; nothing in a thread's tab. A reply posted to the chat too opens the thread it stands in. */
interface RowThread {
  readonly action: ReactNode;
  readonly summary: ReactNode;
  /** Opens the thread, which its menu's Reply in thread presses; none in a thread's tab. */
  readonly onOpen: (() => void) | undefined;
  /** Whether this message's thread stands open beside the chat. */
  readonly open: boolean;
}

function threadOf(message: ManagerChatLiveMessage, doors: ChatDoors): RowThread {
  const { thread } = doors;

  if (thread === undefined) return { action: null, summary: null, onOpen: undefined, open: false };
  const root = message.threadRoot ?? message.id;
  const onOpen = () => thread.onOpen(root);

  return {
    onOpen,
    open: thread.open === root,
    action: <ThreadReplyAction onOpen={onOpen} />,
    summary: (
      <ThreadSummary
        replies={thread.replies.get(root)}
        face={doors.manager.face}
        open={thread.open === root}
        onOpen={onOpen}
      />
    ),
  };
}

/** The place a message of the chat is linked by: under its Manager, by the chat's own id for it, as a transcript's message is (`message-links.tsx`), whether it stands in the chat or in a thread. */
function chatMessagePlace(doors: ChatDoors, messageId: string): LinkDestination {
  return { kind: LINK_DESTINATION.MESSAGE, agentId: doors.agentId, messageId };
}

/** When a message was sent, as its row's head names it. */
function sentTime(at: number): ReactNode {
  return <Time at={at} look={TIME_LOOK.DAY} />;
}

/** The Manager's picture at a row's seat: its face, or the agent's glyph where a service older than faces names none. */
function ChatFace({ face }: { face: ManagerFaceValue | undefined }): ReactNode {
  return face === undefined ? (
    <GlyphSlot size={ICON_SIZE.LARGE}>
      <EntityGlyph kind={ENTITY_KIND.AGENT} />
    </GlyphSlot>
  ) : (
    <ManagerFace face={face} size={MANAGER_FACE_SIZE.MESSAGE} />
  );
}

/** Whether a turn's work stands open under the message that opens it, closed until Show work opens it. */
function useWorkToggle(): ChatWorkToggle {
  const [shown, setShown] = useState(false);

  return { shown, onToggle: () => setShown((was) => !was), onShow: () => setShown(true) };
}

/** A kept picture as the transcript names one, where a file of a message is one kept with its size; none for any other file. */
const keptPictureOf = Schema.decodeUnknownOption(keptPictureSchema);

/** The pictures of a message kept with their size, drawn as a shown set, each under its caption. */
function shownOf(message: ManagerChatLiveMessage): readonly ShownPicture[] {
  return message.attachments.flatMap((file): ShownPicture[] => {
    if (!("id" in file)) return [];
    const { id, mediaType, width, height, byteCount } = file;
    const picture = keptPictureOf({ id, mediaType, width, height, byteCount });

    if (Option.isNone(picture)) return [];
    const caption = file.caption ?? "";

    return [{ picture: picture.value, name: file.name ?? caption, caption }];
  });
}

/**
 * A message's files as chips, but for the pictures `shown` draws as a set:
 * a kept picture read through the agent's pictures by its id, named by its
 * file's name, else its caption, else its type; any other file by its
 * bytes and its name.
 */
function fileChipsOf(
  message: ManagerChatLiveMessage,
  shown: readonly ShownPicture[],
): readonly MessageFileChip[] {
  const drawn = new Set(
    shown.flatMap((each) => (each.picture === undefined ? [] : [each.picture.id])),
  );

  return message.attachments.flatMap((file): MessageFileChip[] => {
    if (!("id" in file)) return [{ name: file.name, mediaType: file.mediaType, url: file.url }];

    if (drawn.has(file.id)) return [];
    const name = file.name ?? file.caption ?? file.mediaType;

    return [{ name, mediaType: file.mediaType, url: "", pictureId: file.id }];
  });
}

/** The Manager's greeting, drawn as its first message though no one sent it and nothing stores it (`@repo/features/manager-greeting`). */
function ManagerGreeting({
  manager,
  words,
}: {
  manager: ChatManagerLook;
  words: string;
}): ReactNode {
  return (
    <div data-manager-greeting="">
      <ChannelMessage avatar={<ChatFace face={manager.face} />} name={manager.name}>
        <TranscriptWords text={words} />
      </ChannelMessage>
    </div>
  );
}

/**
 * One of the Manager's messages: its words in a bubble at the column's left,
 * under its name where it opens its run, beside its face, with Reply in
 * thread and Copy beside it and in its menu, and Mark as unread in its menu
 * where the chat offers it; Show work there too where it is the
 * first the Manager sent in a turn that did work, which opens the turn's
 * work under it; its files over the words; when it was sent under the run's
 * last.
 */
function ManagerMessage({
  line,
  doors,
  work,
}: {
  line: ManagerChatLine;
  doors: ChatDoors;
  work: ReactNode | null;
}): ReactNode {
  const { message, place } = line;
  const thread = threadOf(message, doors);
  const toggle = useWorkToggle();
  const workToggle = work === null ? undefined : toggle;
  const link = chatMessagePlace(doors, message.id);
  const { markUnread } = doors;
  const onMarkUnread = markUnread === undefined ? undefined : () => markUnread(message);
  const menu = useChatMessageMenu(message.text, thread.onOpen, workToggle, link, onMarkUnread);
  const workAction = workToggle === undefined ? null : <WorkMessageAction toggle={workToggle} />;
  // Note that while a find stands open the closed work is drawn hidden until found, so ⌘F reaches it and a match there opens it, as a closed fold's body is.
  const finding = useFindOpen();
  const workDrawn = work !== null && (toggle.shown || finding);

  // Note that a find opens the work rather than toggling it, because a match in a cut code card inside tells both that card and this rest, and two toggles would cancel.
  const workRest = useUntilFound<HTMLDivElement>(workDrawn && !toggle.shown, toggle.onShow);

  // Note that the Manager's pictures kept with their size stand as the set it showed, as the transcript draws a shown set.
  const shown = shownOf(message);
  const files = fileChipsOf(message, shown);
  const reactions = <ReactMessageActions message={message} react={doors.react} />;

  return (
    <>
      <ChannelMessage
        messageId={message.id}
        avatar={<ChatFace face={doors.manager.face} />}
        name={doors.manager.name}
        at={sentTime(message.createdAt)}
        continues={!place.opens}
        open={thread.open}
        contextMenu={menu.contextMenu}
        actions={
          // Note that a message of files alone has no words to copy, so it offers its reactions, its thread, and its work alone.
          message.text === "" ? (
            <>
              {reactions}
              {thread.action}
              {workAction}
            </>
          ) : (
            <CopyMessageAction
              words={message.text}
              // Note that a turn's journal stands under the turn's own id, which its Copy link names it by; a Manager's chat offers no rewind, as a channel takes nothing back.
              messageId={place.closes && message.turnId !== null ? message.turnId : undefined}
              lead={
                <>
                  {reactions}
                  {thread.action}
                  {workAction}
                </>
              }
            />
          )
        }
        under={
          <>
            {shown.length === 0 && files.length === 0 ? null : (
              <div data-shown-set="">
                <KeptShownSet shown={shown} />
                {files.length === 0 ? null : <KeptFileChips files={files} />}
              </div>
            )}
            <ChatReactions message={message} react={doors.react} />
            {/* Note that the turn's work opens under its first message, in the order it was done, as the working line opens the turn's under way. */}
            {workDrawn ? (
              <div ref={workRest} data-turn-work="">
                {work}
              </div>
            ) : null}
            {thread.summary}
          </>
        }
      >
        {message.text === "" ? null : <TranscriptWords text={message.text} />}
      </ChannelMessage>
      {menu.menu}
    </>
  );
}

/**
 * A person's message: the reader's own in a bubble at the column's right,
 * and anyone else's at its left, under their name where it opens their run
 * and beside their picture, each of which opens their page as their name
 * does wherever the window names them (`ActorRef`), its files over the words, Reply in thread and
 * Copy beside it and in its menu, as every message of the chat offers them, Mark as unread in
 * its menu where the chat offers it, and when it
 * was sent under the run's last. The reader's own offers Edit beside them,
 * which opens its words in a box where they stand; one edited says so after
 * its words.
 */
function PersonMessage({ line, doors }: { line: ManagerChatLine; doors: ChatDoors }): ReactNode {
  const { message, place } = line;
  const own = message.authorUserId !== null && message.authorUserId === doors.readerId;

  const sender = usePerson(
    message.authorUserId === null
      ? undefined
      : { userId: message.authorUserId, name: message.authorName },
  );

  const files = fileChipsOf(message, NONE_SHOWN);
  const lineId = own ? (message.lineId ?? undefined) : undefined;
  const ownLine = lineId === undefined ? undefined : doors.lines.get(lineId);
  const thread = threadOf(message, doors);
  const link = chatMessagePlace(doors, message.id);
  const { markUnread } = doors;
  const onMarkUnread = markUnread === undefined ? undefined : () => markUnread(message);
  const menu = useChatMessageMenu(message.text, thread.onOpen, undefined, link, onMarkUnread);
  const reactions = <ReactMessageActions message={message} react={doors.react} />;
  const { edit } = doors;

  const editAction = own ? <EditChatMessageAction onEdit={() => edit.onOpen(message.id)} /> : null;

  // Note that the message open for writing again stands in its own row under its sender, its files over the box as over its words, since an edit writes its words alone.
  if (own && edit.editing === message.id) {
    return (
      <SentMessage files={files} words={message.text}>
        {(body) => (
          <ChannelMessage
            messageId={message.id}
            avatar={<ActorRef actor={sender} size={ACTOR_SIZE.CARD} faceOnly />}
            name={<ActorRef actor={sender} nameOnly byName />}
            at={sentTime(message.createdAt)}
            continues={!place.opens}
          >
            {body.files}
            <ChatEditField
              messageId={message.id}
              words={message.text}
              box={edit.box}
              onSave={(text) => edit.onSave(message.id, text, message.text)}
              onCancel={edit.onClose}
            />
          </ChannelMessage>
        )}
      </SentMessage>
    );
  }

  return (
    <>
      <SentMessage files={files} words={message.text}>
        {(body) => (
          <ChannelMessage
            messageId={message.id}
            avatar={<ActorRef actor={sender} size={ACTOR_SIZE.CARD} faceOnly />}
            name={<ActorRef actor={sender} nameOnly byName />}
            at={sentTime(message.createdAt)}
            continues={!place.opens}
            open={thread.open}
            contextMenu={menu.contextMenu}
            edited={message.editedAt !== null}
            actions={
              // Note that a message of files alone has no words to copy, so it offers its reactions, its thread, and its Edit alone.
              message.text === "" ? (
                <>
                  {reactions}
                  {thread.action}
                  {editAction}
                </>
              ) : (
                <CopyMessageAction
                  words={message.text}
                  messageId={ownLine === undefined ? undefined : lineId}
                  lead={
                    <>
                      {reactions}
                      {thread.action}
                      {editAction}
                    </>
                  }
                />
              )
            }
            under={
              <>
                <ChatReactions message={message} react={doors.react} />
                {thread.summary}
              </>
            }
          >
            {body.files}
            {body.words}
          </ChannelMessage>
        )}
      </SentMessage>
      {menu.menu}
    </>
  );
}

/** One of the reader's messages on its way to the chat, or refused: their row in the run it will stand in once sent, under their name where it opens one, its files over its words, or with its mark where it did not go. */
function SendingLine({
  line,
  place,
  readerId,
}: {
  line: SentLine;
  place: ChatRunPlace;
  readerId: string | undefined;
}): ReactNode {
  const refused = line.state !== SENT_LINE_STATE.PENDING;
  const { members } = useMemberDirectory();
  const name = members?.find((member) => member.userId === readerId)?.name ?? "";
  const reader = usePerson(readerId === undefined ? undefined : { userId: readerId, name });

  const files = line.attachments.map(
    (file): MessageFileChip => ({ name: file.name, mediaType: file.mediaType, url: fileUrl(file) }),
  );

  return (
    <SentMessage files={files} words={line.text} sending={!refused}>
      {(body) => (
        <div data-message-id={line.id} data-undelivered={refused ? "" : undefined}>
          <ChannelMessage
            avatar={<ActorMark actor={reader} size={ACTOR_SIZE.CARD} />}
            name={name}
            at={refused ? sentTime(line.sentAt) : undefined}
            continues={!place.opens}
            under={refused ? <UndeliveredMark messageId={line.id} /> : undefined}
          >
            {body.files}
            {body.words}
          </ChannelMessage>
        </div>
      )}
    </SentMessage>
  );
}

/** What the chat says while a turn runs: its working line in a bubble of the Manager's, as a chat app shows the other side typing, the turn's work so far a press away. */
function ChatWorking({
  words,
  manager,
  work,
}: {
  words: string;
  manager: ChatManagerLook;
  work: ReactNode | null;
}): ReactNode {
  const toggle = useWorkToggle();

  return (
    <ChannelMessage
      avatar={<ChatFace face={manager.face} />}
      name={manager.name}
      actions={work === null ? null : <WorkingWorkAction toggle={toggle} />}
      under={toggle.shown && work !== null ? work : null}
    >
      <WorkingLine startedAt={undefined} words={words} />
    </ChannelMessage>
  );
}

/** A message's files by the ids this window keeps their bytes under, by the key the message went under, which its Retry carries again. */
type SentFiles = Map<string, NonNullable<SendingMessage["files"]>>;

/**
 * A message's files by the ids this window keeps their bytes under: those
 * kept as it went, else the bytes the host's record of the send carries,
 * kept now under ids of their own, as once its tab closed and opened again,
 * so its Retry and Edit carry them whole.
 */
function filesOf(
  client: QueryClient,
  agentId: string,
  kept: SentFiles,
  message: ManagerChatSending,
): SendingMessage["files"] {
  const sent = kept.get(message.clientKey);

  if (sent !== undefined || message.attachments === undefined) return sent;

  const files = message.attachments.map((file) => {
    const id = crypto.randomUUID();
    keepPictureRead(client, agentId, id, fileUrl(file));

    return { name: file.name, mediaType: file.mediaType, id };
  });

  kept.set(message.clientKey, files);

  return files;
}

/** The reader's messages on their way to the chat, as the box's lines read them: each under its key, which its Retry sends again with its files (`files`), and its Delete lets go by. */
function sendingLinesOf(
  sending: readonly ManagerChatSending[] | undefined,
  files: (message: ManagerChatSending) => SendingMessage["files"],
): readonly SendingMessage[] {
  return (sending ?? []).map((message) => {
    const held = files(message);

    return {
      id: message.clientKey,
      clientKey: message.clientKey,
      text: message.text,
      sentAt: message.sentAt,
      steers: false,
      ...(held === undefined || held.length === 0 ? undefined : { files: held }),
      ...(message.sentBy === undefined ? undefined : { sentBy: message.sentBy }),
      ...(message.refused === undefined ? undefined : { refused: message.refused }),
    };
  });
}

/** What a row of the chat's log, or of a thread's, draws: the Manager's greeting, a message of the chat, the rule counting a thread's replies, or one of the reader's on its way. */
const CHAT_ROW = {
  GREETING: "greeting",
  MESSAGE: "message",
  RULE: "rule",
  SENDING: "sending",
} as const;

/** One row of the chat's log, or of a thread's, under the key the log keeps it by. */
type ChatRow =
  | { readonly kind: typeof CHAT_ROW.GREETING; readonly key: string; readonly words: string }
  | { readonly kind: typeof CHAT_ROW.MESSAGE; readonly key: string; readonly line: ManagerChatLine }
  | { readonly kind: typeof CHAT_ROW.RULE; readonly key: string; readonly count: number }
  | {
      readonly kind: typeof CHAT_ROW.SENDING;
      readonly key: string;
      readonly line: SentLine;
      readonly place: ChatRunPlace;
    };

/** The key the greeting's row stands under, which no message's id is. */
const GREETING_KEY = "greeting";

/** The key a thread's rule stands under, which no message's id is. */
const RULE_KEY = "rule";

/** The height a row of the chat is taken to have before it is drawn and measured, in pixels: a short message's, with the step before it. */
const CHAT_ROW_ESTIMATE_PX = 88;

/** A message's row, under the key it was written under, which its line on its way stood under, so the row lands in that line's place. */
function messageRowOf(line: ManagerChatLine): ChatRow {
  return { kind: CHAT_ROW.MESSAGE, key: line.message.clientKey, line };
}

/** The reader's messages on their way as rows, each under the key it went under, in the run the channel's view placed it in (`ChatSendingPlaces.channel`). */
function sendingRowsOf(
  sent: readonly SentLine[],
  places: ReadonlyMap<string, ChatRunPlace>,
): readonly ChatRow[] {
  return sent.map((line) => ({
    kind: CHAT_ROW.SENDING,
    key: line.clientKey,
    line,
    place: places.get(line.clientKey) ?? CHAT_RUN_ALONE,
  }));
}

/** The chat's log as rows: the greeting where the chat's start is read, its messages oldest first, and the reader's on their way after them. */
function chatRowsOf(
  greeting: string | undefined,
  lines: readonly ManagerChatLine[],
  sent: readonly ChatRow[],
): readonly ChatRow[] {
  return [
    ...(greeting === undefined
      ? []
      : [{ kind: CHAT_ROW.GREETING, key: GREETING_KEY, words: greeting } as const]),
    ...lines.map(messageRowOf),
    ...sent,
  ];
}

/** Each message's row key by the message's id, as a log keeps its rows (`messageRowOf`), but for `but`, a thread's own root. */
function rowKeysById(rows: readonly ChatRow[], but?: string): ReadonlyMap<string, string> {
  return new Map(
    rows.flatMap((row) =>
      row.kind === CHAT_ROW.MESSAGE && row.line.message.id !== but
        ? [[row.line.message.id, row.key] as const]
        : [],
    ),
  );
}

/** A thread's log as rows: the message it stands on, the rule counting its replies, its replies oldest first, and the reader's on their way after them. */
function threadRowsOf(
  root: ManagerChatLine,
  replies: readonly ManagerChatLine[],
  sent: readonly ChatRow[],
): readonly ChatRow[] {
  return [
    messageRowOf(root),
    { kind: CHAT_ROW.RULE, key: RULE_KEY, count: replies.length },
    ...replies.map(messageRowOf),
    ...sent,
  ];
}

/**
 * Each row's class in its log: a message going on its sender's run stands
 * right under the one before it, the two parted only by the padding each
 * message keeps alike above and below (`ChannelMessage`), as a channel
 * stands one sender's run, and every other row a step from it (tasks.css).
 */
function useChatRowClass(
  rows: readonly ChatRow[],
  newKey?: string | undefined,
): (index: number) => string {
  return useCallback(
    (index: number) => {
      if (index === 0) return LOG_ROW_CLASS;
      const row = rows[index];

      // Note that the message under New opens a run of its own (`newKeyOf`).
      const continues =
        (row?.kind === CHAT_ROW.MESSAGE && !row.line.place.opens && row.key !== newKey) ||
        (row?.kind === CHAT_ROW.SENDING && !row.place.opens);

      return continues ? LOG_ROW_CLASS : `${LOG_ROW_CLASS} agent-log-row-next`;
    },
    [rows, newKey],
  );
}

/** A row as ⌘F reads it before it is drawn: its words; a thread's rule has none. */
function findRowOf(row: ChatRow): FindRow {
  if (row.kind === CHAT_ROW.GREETING) return { key: row.key, words: row.words };

  if (row.kind === CHAT_ROW.RULE) return { key: row.key, words: "" };

  return {
    key: row.key,
    words: row.kind === CHAT_ROW.MESSAGE ? row.line.message.text : row.line.text,
  };
}

/** The key of the reader's newest line, which takes the log to its end as it lands: one on its way, or their newest message the chat holds; none where they wrote none. */
function ownLastOf(rows: readonly ChatRow[], readerId: string | undefined): string | undefined {
  return rows.findLast(
    (row) =>
      row.kind === CHAT_ROW.SENDING ||
      (row.kind === CHAT_ROW.MESSAGE &&
        readerId !== undefined &&
        row.line.message.authorUserId === readerId),
  )?.key;
}

/** The key of the row New stands over: the first message after `newAfter`, skipping the reader's own where `readerId` names them; none where New stands nowhere. */
function newKeyOf(
  rows: readonly ChatRow[],
  newAfter: number | undefined,
  readerId: string | undefined,
): string | undefined {
  if (newAfter === undefined) return undefined;

  return rows.find(
    (row) =>
      row.kind === CHAT_ROW.MESSAGE &&
      row.line.message.createdAt > newAfter &&
      (readerId === undefined || row.line.message.authorUserId !== readerId),
  )?.key;
}

/** No row for ⌘F to read, while no find stands. */
const NO_FIND_ROWS: readonly FindRow[] = [];

/** No pictures drawn as a set, as a person's message draws its files as chips. */
const NONE_SHOWN: readonly ShownPicture[] = [];

/** No message on its way. */
const NONE_SENDING: readonly ManagerChatSending[] = [];

/** No row, while a thread's message is not read yet. */
const NO_ROWS: readonly ChatRow[] = [];

/** Nothing to do. */
const NOTHING = (): void => {};

/** No reply in a thread. */
const NO_LINES: readonly ManagerChatLine[] = [];

/** What a Manager's chat tab is handed beside the agent, as an agent's tab is. */
interface ManagerChatTabDoors {
  readonly agent: AgentSummary;
  readonly control: AgentsControl;
  /** Whether the tab is on screen. */
  readonly shown: boolean;
  /** Opens what one of its calls is about, from a turn's work; none where nothing opens it. */
  readonly onOpenTarget?: DelegationDoors["onOpenTarget"];
  /** The cards a turn's work's rows hang. */
  readonly cards?: DelegationDoors["cards"];
  /** The threads the Manager posted that wait on the reader (`ThreadsDock`). */
  readonly threads?: AgentThreads | undefined;
}

/**
 * The box writing to a Manager's chat, the chat's own or one of its
 * threads' (`thread`, by the message it stands on), and what both read: the
 * transcript under the chat, the chat's rows, and the box itself, the
 * composer of an agent's tab, which sends to the chat (`agents.chat.send`),
 * in the thread where it is a thread's, and draws the reader's messages on
 * their way there. Note that each box draws only its own messages on their
 * way, the chat's those to the chat itself and a thread's those replying in
 * it, so a refusal is said once, and a thread's box keeps a draft of its own.
 */
function useManagerChatBox({
  agent,
  control,
  shown,
  onOpenTarget,
  cards,
  thread,
}: {
  agent: AgentSummary;
  control: AgentsControl;
  shown: boolean;
  onOpenTarget: DelegationDoors["onOpenTarget"];
  cards: DelegationDoors["cards"];
  thread: string | undefined;
}) {
  const transcript = useAgentTranscript({
    transcript: useMemo(() => ({ kind: TRANSCRIPT_KIND.AGENT, agentId: agent.id }), [agent.id]),
    shown,
  });

  const read = useQuery(managerChatQuery(agent.id));
  const { mutateAsync: sendChat } = useMutation(actMutation(ACT_KIND.AGENTS_CHAT_SEND));
  const { mutate: unsendChat } = useMutation(actMutation(ACT_KIND.AGENTS_CHAT_UNSEND));
  const chat = read.data;
  const starter = teammateStarter(agent.startedBy, control.me);
  const approvals = useAgentApprovals({ agent, write: control.onAnswerApproval });

  // Note that the chat is sent no file's id, so the window keeps which bytes each message's files are under itself, for its Retry.
  const sentFiles = useRef<SentFiles>(new Map());
  const queryClient = useQueryClient();

  /** Keeps a message's files by the ids this window holds their bytes under, as the host keeps a message to the agent's. */
  const keepFiles = (clientKey: string, message: Parameters<MessageSender>[1]) => {
    const { attachments, pictures } = message;

    if (attachments === undefined || attachments.length === 0) return;

    sentFiles.current.set(
      clientKey,
      attachments.map((file, index) => {
        const id = pictures?.[index];

        return {
          name: file.name,
          mediaType: file.mediaType,
          ...(id === undefined ? undefined : { id }),
        };
      }),
    );
  };

  // Note that a message to the chat answers as a message to the agent does, with the id the chat holds it under beside it, which the host draws it by.
  const send: MessageSender = useApprovingSend((agentId, message) => {
    keepFiles(message.clientKey, message);

    return sendChat({
      agentId,
      text: message.text,
      clientKey: message.clientKey,
      ...(message.attachments === undefined ? undefined : { attachments: message.attachments }),
      ...(message.retry === undefined ? undefined : { retry: message.retry }),
      ...(thread === undefined ? undefined : { threadRoot: thread }),
    } satisfies AgentChatSendParams).then((answer): AgentActAnswer => {
      if ("failure" in answer) return answer;
      // Note that the box reads the answer as a message's: its agent, its transaction, and whether the service queued it, the id the chat holds it under being the host's to draw it by.
      const { agent: sent, txid, queued } = answer;

      return {
        agent: sent,
        ...(txid === undefined ? undefined : { txid }),
        ...(queued === undefined ? undefined : { queued: true as const }),
      };
    });
  }, approvals);

  const unsend: MessageUnsender = (agentId, clientKey) => unsendChat({ agentId, clientKey });

  const composer = useAgentComposer({
    agentId: agent.id,
    taskId: agent.taskId,
    thread,
    messages: transcript.messages,
    sending: useMemo(
      () =>
        sendingLinesOf(
          (chat?.sending ?? NONE_SENDING).filter((message) => message.threadRoot === thread),
          (message) => filesOf(queryClient, agent.id, sentFiles.current, message),
        ),
      [chat?.sending, queryClient, agent.id, thread],
    ),
    running: agent.status === AGENT_STATUS.RUNNING,
    send,
    unsend,
    starter,
    shown,
  });

  const box = useAgentBox({ agentId: agent.id, agent, agents: control });
  const pictures = useAgentPictureDoor(agent.id);
  const moveToCloud = useMoveToCloud(agent, control);
  const callRoute = useCallRoute(agent.id);
  const computerApps = useMemo(() => computerAppsOf(transcript.messages), [transcript.messages]);

  const ends = useAgentEndDoors({
    agent,
    control,
    composer,
    starter,
    hostLost: transcript.hostLost,
    moveToCloud,
    onOpenTarget,
    shown,
  });

  const marks = useSentLineMarks(composer, ends.unarchive !== undefined);

  const boxOpen = boxTakesWords({
    archived: ends.unarchive !== undefined,
    continued: ends.continuedNote !== undefined,
    closed: composer.closed,
  });

  const standing = tabTurnOf(agent, composer);
  const running = standing.working ? (standing.turnId ?? agent.turnId ?? undefined) : undefined;
  const name = agentName(agent, control.models);
  const manager = useMemo(() => ({ name, face: agent.face }), [name, agent.face]);

  // Note that the reader's messages on their way are placed with the rows, so each stands in the run its row will land in.
  const view = useMemo(
    () =>
      managerChatView(chat?.messages ?? [], transcript.messages, {
        running,
        sending: chat?.sending ?? NONE_SENDING,
      }),
    [chat?.messages, chat?.sending, transcript.messages, running],
  );

  const delegation = useMemo(
    () => ({ models: control.models, onOpenTarget, cards }),
    [control.models, onOpenTarget, cards],
  );

  const lines = useMemo(
    () => new Map(transcript.messages.map((line) => [line.id, line])),
    [transcript.messages],
  );

  const react = useChatReact(agent.id);

  // Note that the edit box reads what the chat's own box reads, so it offers the same lists and dictation.
  const editBox = useMemo(
    () => ({ agentId: agent.id, keywords: control.keywords, skills: control.readSkills }),
    [agent.id, control.keywords, control.readSkills],
  );

  const edit = useChatEdit(editBox);

  // Note that these doors open no thread; the chat's own rows add theirs.
  const doors: ChatDoors = useMemo(
    () => ({ agentId: agent.id, manager, readerId: control.me, delegation, lines, react, edit }),
    [agent.id, manager, control.me, delegation, lines, react, edit],
  );

  /** The rows of one turn's work, by the transcript line that opened it, which Show work opens under the Manager's first message of the turn. */
  const workOf = (line: ManagerChatLine): ReactNode | null =>
    line.work === undefined ? null : (
      <TurnWorkRows parts={view.work.get(line.work) ?? []} moving={false} delegation={delegation} />
    );

  /** One message of the chat, as its sender draws it, reading `drawn`'s doors: the chat's, or a thread's tab's. */
  const drawLine = (line: ManagerChatLine, drawn: ChatDoors): ReactNode =>
    line.message.authorKind === MANAGER_CHAT_AUTHOR.AGENT ? (
      <ManagerMessage line={line} doors={drawn} work={workOf(line)} />
    ) : (
      <PersonMessage line={line} doors={drawn} />
    );

  // Note that the box, the chat's or a thread's, is the composer of an agent's tab, read off the Manager as every box writing to an agent reads it.
  const dock = (wiring: {
    readonly approvalsWaiting: number;
    readonly queue: Parameters<typeof AgentComposerDock>[0]["queue"];
    readonly box: AgentBox;
    readonly transcript: Parameters<typeof AgentComposerDock>[0]["transcript"];
    readonly wording?: ComposerWords | undefined;
    readonly talks?: boolean | undefined;
  }) => (
    <AgentComposerDock
      agent={agent}
      box={wiring.box}
      composer={composer}
      transcript={wiring.transcript}
      approvalsWaiting={wiring.approvalsWaiting}
      onStop={() => control.onStop(agent.id)}
      onUnarchive={ends.unarchive}
      continuedNote={ends.continuedNote}
      cards={cards}
      keywords={control.keywords}
      skills={control.readSkills}
      closedRemedy={ends.closedRemedy}
      onMoveToCloud={moveToCloud}
      queue={wiring.queue}
      place={{ owner: undefined, route: callRoute, pictures, computerApps }}
      wording={wiring.wording}
      talks={wiring.talks}
    />
  );

  return {
    transcript,
    read,
    chat,
    starter,
    approvals,
    composer,
    box,
    pictures,
    ends,
    marks,
    boxOpen,
    standing,
    manager,
    name,
    view,
    delegation,
    doors,
    drawLine,
    dock,
  };
}

/**
 * A Manager's page as its chat (see the file's header): its rows, read
 * newest first and drawn oldest first, the work under them a press away,
 * and its box, which sends to the chat.
 */
export function ManagerChatTab({
  agent,
  control,
  shown,
  onOpenTarget,
  cards,
  threads,
}: ManagerChatTabDoors): ReactNode {
  const chatBox = useManagerChatBox({
    agent,
    control,
    shown,
    onOpenTarget,
    cards,
    thread: undefined,
  });

  const { transcript, read, chat, starter, approvals, composer, box, pictures, ends } = chatBox;
  const { marks, standing, manager, name, view, delegation, drawLine } = chatBox;
  const { mutate: retryChat } = useMutation(managerChatRetryMutation());

  const {
    mutate: readOlder,
    isError: olderFailed,
    variables: olderAsked,
  } = useMutation(actMutation(ACT_KIND.AGENTS_MANAGER_CHAT_OLDER));

  const queue = useAgentQueue(agent.id, transcript.queue);
  const queueEditing = useQueueEditing(composer, queue, pictures);
  const list = useRef<HTMLDivElement>(null);
  const rowsHandle = useRef<VirtualRowsHandle>(null);
  const { newAfter, newOverOwn, markUnread } = useManagerChatLooks(agent.id, agent);

  const { endPress, endTrail, continuable } = ends;

  // Note that a message's thread opens in its page's side panel, where one stands beside the chat; elsewhere its messages offer none.
  const opener = useThreadDoors();

  const doors = useMemo(
    () =>
      opener === undefined
        ? { ...chatBox.doors, markUnread }
        : {
            ...chatBox.doors,
            markUnread,
            thread: { replies: view.threads, open: opener.open, onOpen: opener.onOpen },
          },
    [chatBox.doors, view.threads, opener, markUnread],
  );

  const ended =
    transcript.pages === 0 || standing.working
      ? undefined
      : endLineParts(standing.status, standing.failure, starter, continuable, transcript.hostLost);

  const before = chat?.before;
  /** Reads the page before the oldest message read, as the reader nears the top or presses Retry. */
  const onOlder = before === undefined ? undefined : () => readOlder({ agentId: agent.id, before });
  // Note that the page before a cursor is read once, as the reader nears the top: an ask for it out,
  // answered, or refused stands until the cursor moves past it or Retry asks again, so nearing the top
  // again while it is out asks nothing more.
  const onNearTop = olderAsked?.before === before ? undefined : onOlder;

  const rows = useMemo(
    () =>
      chatRowsOf(
        before === undefined ? managerGreeting(agent.title) : undefined,
        view.top,
        sendingRowsOf(composer.sent, view.sending.channel),
      ),
    [before, agent.title, view.top, composer.sent, view.sending],
  );

  const keys = useMemo(() => rows.map((row) => row.key), [rows]);
  const ownLast = ownLastOf(rows, control.me);
  const newKey = newKeyOf(rows, newAfter, newOverOwn ? undefined : control.me);
  const finding = useFindOpen();
  const findRows = useMemo(() => (finding ? rows.map(findRowOf) : NO_FIND_ROWS), [finding, rows]);
  useVirtualFind({ root: list, rows: findRows, handle: rowsHandle, findable: keys.length > 0 });
  const rowClassOf = useChatRowClass(rows, newKey);
  const asks = approvals.asks;

  // A link to a message of the chat lands on it once read, older pages read for it: on its row in the chat,
  // or, for a reply that stands in its thread alone, in the thread's tab, which the chat opens beside it to land there.
  const toast = useToast();
  const rowKeys = useMemo(() => rowKeysById(rows), [rows]);

  useMessageReveal({
    agentId: agent.id,
    shown,
    caughtUp: chat !== undefined,
    whole: before === undefined,
    olderFailed,
    loadOlder: () => onNearTop?.(),
    pages: chat?.messages.length ?? 0,
    // Note that the chat is followed as it is written, so a message read whole and not found is gone.
    settled: true,
    drawn: (messageId) => {
      const landing = chatMessageLanding(view, messageId).kind;

      return (
        landing === CHAT_LANDING.CHAT || (landing === CHAT_LANDING.THREAD && opener !== undefined)
      );
    },
    bringIn: (messageId, then) => {
      const landing = chatMessageLanding(view, messageId);
      const key = rowKeys.get(messageId);

      if (landing.kind === CHAT_LANDING.CHAT && key !== undefined) {
        return rowsHandle.current?.bringIn(key, then) ?? false;
      }

      if (landing.kind !== CHAT_LANDING.THREAD || opener === undefined) return false;
      opener.onOpen(landing.root);

      return true;
    },
    gone: () =>
      toast({
        replayUnmasked: true,
        words: CHAT_MESSAGE_GONE,
        tone: STATUS_TONE.DANGER,
        failure: {
          surface: FAILURE_SURFACE.MESSAGE_REVEAL,
          cause: FAILURE_CONDITION.GONE,
          about: { agentId: agent.id },
          refused: true,
        },
      }),
  });

  const workingWords =
    approvals.waiting > 0
      ? waitingOnYouWords(approvals.waiting)
      : workingLineWords(standing.phase, standing.waitsUntil);

  // What stands after the messages is drawn inside the last of them, as an agent's log draws it, so the run measures it with the row and keeps to it.
  const trailing =
    !standing.working &&
    asks.length === 0 &&
    ended === undefined &&
    endTrail === undefined ? null : (
      <>
        {asks.length === 0 ? null : (
          // Note that only the foot's calls offer the answers, since the same call drawn in the work under the working line would offer them twice.
          <ApprovalsProvider asks={asks}>
            <div className="agent-loose-approvals flex flex-col">
              {asks.map((ask) => (
                <ToolCallView key={ask.approval.id} part={heldCallPart(ask.approval)} />
              ))}
            </div>
          </ApprovalsProvider>
        )}
        {standing.working ? (
          <ChatWorking
            words={workingWords}
            manager={manager}
            work={
              view.live.length === 0 ? null : (
                <TurnWorkRows parts={view.live} moving delegation={delegation} />
              )
            }
          />
        ) : null}
        {ended === undefined && endTrail === undefined ? null : (
          <div className="agent-end flex flex-col items-start gap-control-gap">
            {ended === undefined ? null : (
              <AgentEndRow
                ended={ended}
                endReason={endLineReason(standing.failure, starter)}
                keyProvider={providerOf(agent.model)}
                onOpenApiKeys={
                  control.onOpenApiKeys === undefined
                    ? undefined
                    : () => control.onOpenApiKeys?.(providerOf(agent.model))
                }
                about={{ agentId: agent.id, taskId: agent.taskId ?? undefined }}
                press={endPress}
              />
            )}
            {endTrail}
          </div>
        )}
      </>
    );

  /** One row of the log, as its kind draws it. */
  const drawRow = (row: ChatRow): ReactNode => {
    if (row.kind === CHAT_ROW.GREETING)
      return <ManagerGreeting manager={manager} words={row.words} />;

    if (row.kind === CHAT_ROW.SENDING) {
      return <SendingLine line={row.line} place={row.place} readerId={control.me} />;
    }

    if (row.kind === CHAT_ROW.RULE) return <ThreadRule count={row.count} />;

    // Note that the message under New opens a run of its own, under its sender's name, as a channel heads the first message past its New line.
    return row.key === newKey ? (
      <>
        <NewMessagesRule />
        {drawLine({ ...row.line, place: { ...row.line.place, opens: true } }, doors)}
      </>
    ) : (
      drawLine(row.line, doors)
    );
  };

  const log = (() => {
    if (read.isError) {
      return (
        <TranscriptReadFailed
          failedWith={read.error}
          agentId={agent.id}
          onRetry={() => retryChat({ agentId: agent.id })}
          centered
        />
      );
    }

    if (chat === undefined) return <TranscriptSkeleton />;

    return (
      <Conversation list={list} onNearTop={onNearTop}>
        {olderFailed && onOlder !== undefined ? <OlderReadFailed onRetry={onOlder} /> : null}
        <ConversationContent>
          <ConversationRows
            keys={keys}
            estimate={CHAT_ROW_ESTIMATE_PX}
            gap={0}
            rowClassName={rowClassOf}
            handle={rowsHandle}
            ownLast={ownLast}
          >
            {(at) => {
              const row = rows[at];

              if (row === undefined) return null;

              return (
                <>
                  {drawRow(row)}
                  {at === rows.length - 1 ? trailing : null}
                </>
              );
            }}
          </ConversationRows>
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>
    );
  })();

  return (
    <AgentTabFrame label={name}>
      <AgentPicturesProvider value={pictures}>
        <UndeliveredLines value={marks}>
          {log}
          <AgentTabFoot>
            <ThreadsDock threads={threads} />
            {chatBox.dock({
              box,
              approvalsWaiting: approvals.waiting,
              transcript,
              queue: { controls: true, working: standing.working, editing: queueEditing },
            })}
          </AgentTabFoot>
        </UndeliveredLines>
      </AgentPicturesProvider>
    </AgentTabFrame>
  );
}

/** What a thread's box draws of what the Manager has cost and what its model holds: nothing, since a reply is no turn of its own. */
const THREAD_USAGE = {
  usage: undefined,
  payer: undefined,
  payerSubscriptionId: undefined,
  context: undefined,
} as const;

/** No chip after a thread's +. */
const NO_TOOLS = (): null => null;

/**
 * The Manager's box as a thread's reply draws it: what acts on the Manager
 * itself rather than on one reply stands in the chat's own box alone. Note
 * that a reply steers whatever turn runs, so Stop and the model chip, with
 * its cost and permission mode, are the turn's; `/clear` starts the
 * Manager's session afresh; its MCP servers are switched for its next turn;
 * and the chips after the + say and move where the Manager runs and what
 * it forwards. With no servers to switch, the + attaches files at once.
 */
function threadBoxOf(box: AgentBox): AgentBox {
  return {
    ...box,
    stoppable: false,
    model: undefined,
    mode: undefined,
    onClear: undefined,
    servers: undefined,
    tools: NO_TOOLS,
  };
}

/** What a thread's tab says once the message it stood on is gone from the chat. */
const THREAD_GONE_WORDS = THREAD_WORDS.GONE;

/** What a thread's box asks for and calls its field. */
const THREAD_BOX_WORDS: ComposerWords = {
  placeholder: THREAD_WORDS.BOX,
  label: THREAD_WORDS.BOX,
  send: BUTTON.SEND,
};

/**
 * One thread of a Manager's chat, as its tab in the page's side panel
 * draws it: the message it stands on (`root`), the replies under a rule
 * that counts them, the reader's on their way after them, and the chat's
 * own composer at its foot, which sends the reader's words and files to the
 * chat as a reply in the thread. Note that the box leaves out what acts on
 * the Manager itself rather than on the reply (`threadBoxOf`): Stop, the
 * queue, the model chip with its cost and permission mode, `/clear`, the
 * MCP servers, and the Cloud and Ports chips; and Talk, since a call's lines
 * land in the chat rather than the thread.
 */
export function ManagerThreadTab({
  agent,
  control,
  shown,
  root,
  onOpenTarget,
  cards,
}: Omit<ManagerChatTabDoors, "threads"> & {
  /** The message the thread stands on, by its id. */
  root: string;
}): ReactNode {
  const chatBox = useManagerChatBox({ agent, control, shown, onOpenTarget, cards, thread: root });
  const { read, chat, composer, box, pictures, marks, view, drawLine, doors } = chatBox;
  const { mutate: retryChat } = useMutation(managerChatRetryMutation());

  const { mutate: readOlder, isError: olderFailed } = useMutation(
    actMutation(ACT_KIND.AGENTS_MANAGER_CHAT_OLDER),
  );

  const list = useRef<HTMLDivElement>(null);
  const rowsHandle = useRef<VirtualRowsHandle>(null);

  // The message the thread stands on, among the chat's messages read: a reply's root never stands among its replies.
  const rootLine = view.top.find(
    (line) => line.message.id === root && line.message.threadRoot === null,
  );

  // Note that a root older than the pages read is read for, a page at a time, until it stands or the chat's start is read.
  const before = chat?.before;
  const lacksRoot = chat !== undefined && rootLine === undefined && before !== undefined;
  useEffect(() => {
    if (lacksRoot && before !== undefined) readOlder({ agentId: agent.id, before });
  }, [lacksRoot, before, readOlder, agent.id]);

  /** Asks the page the root may stand in again, where the last ask did not answer. */
  const onOlder = before === undefined ? undefined : () => readOlder({ agentId: agent.id, before });

  const rows = useMemo(
    () =>
      rootLine === undefined
        ? NO_ROWS
        : threadRowsOf(
            // Note that the root stands alone in the tab, under its sender's name.
            { ...rootLine, place: CHAT_RUN_ALONE },
            view.threads.get(root) ?? NO_LINES,
            sendingRowsOf(composer.sent, view.sending.channel),
          ),
    [rootLine, view.threads, root, composer.sent, view.sending],
  );

  const keys = useMemo(() => rows.map((row) => row.key), [rows]);
  const ownLast = ownLastOf(rows, control.me);
  const finding = useFindOpen();
  const findRows = useMemo(() => (finding ? rows.map(findRowOf) : NO_FIND_ROWS), [finding, rows]);
  useVirtualFind({ root: list, rows: findRows, handle: rowsHandle, findable: keys.length > 0 });
  const rowClassOf = useChatRowClass(rows);

  // Note that a link to a reply is the chat's to find, which opens its thread here to land on it, so the thread never says one gone.
  const replyKeys = useMemo(() => rowKeysById(rows, root), [rows, root]);

  useMessageReveal({
    agentId: agent.id,
    shown,
    caughtUp: rootLine !== undefined,
    whole: false,
    olderFailed: false,
    loadOlder: NOTHING,
    pages: 0,
    settled: false,
    drawn: (messageId) => replyKeys.has(messageId),
    bringIn: (messageId, then) => {
      const key = replyKeys.get(messageId);

      return key !== undefined && (rowsHandle.current?.bringIn(key, then) ?? false);
    },
    gone: NOTHING,
  });

  /** One row of the thread, as its kind draws it. */
  const drawRow = (row: ChatRow): ReactNode => {
    if (row.kind === CHAT_ROW.SENDING) {
      return <SendingLine line={row.line} place={row.place} readerId={control.me} />;
    }

    if (row.kind === CHAT_ROW.RULE) return <ThreadRule count={row.count} />;

    if (row.kind === CHAT_ROW.GREETING) return null;

    return drawLine(row.line, doors);
  };

  // Note that the thread is read off the chat's own read, so it fails and stands as the chat does.
  const log = read.isError ? (
    <TranscriptReadFailed
      failedWith={read.error}
      agentId={agent.id}
      onRetry={() => retryChat({ agentId: agent.id })}
      centered
    />
  ) : lacksRoot && olderFailed && onOlder !== undefined ? (
    // Note that an older page that did not answer says so with Retry, since nothing else would ask it again.
    <Conversation list={list}>
      <OlderReadFailed onRetry={onOlder} />
    </Conversation>
  ) : chat === undefined || lacksRoot ? (
    <TranscriptSkeleton />
  ) : rootLine === undefined ? (
    // A root gone from the chat, as a rewind drops one, takes its thread with it.
    <EmptyState icon={<EntityGlyph kind={ENTITY_KIND.INBOX_ITEM} />}>
      {THREAD_GONE_WORDS}
    </EmptyState>
  ) : (
    <Conversation list={list}>
      <ConversationContent>
        <ConversationRows
          keys={keys}
          estimate={CHAT_ROW_ESTIMATE_PX}
          gap={0}
          rowClassName={rowClassOf}
          handle={rowsHandle}
          ownLast={ownLast}
        >
          {(at) => {
            const row = rows[at];

            return row === undefined ? null : drawRow(row);
          }}
        </ConversationRows>
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  );

  return (
    <AgentTabFrame label={TAB_WORDS.THREAD}>
      <AgentPicturesProvider value={pictures}>
        <UndeliveredLines value={marks}>
          {log}
          <AgentTabFoot>
            {chatBox.dock({
              box: threadBoxOf(box),
              approvalsWaiting: chatBox.approvals.waiting,
              transcript: THREAD_USAGE,
              queue: undefined,
              wording: THREAD_BOX_WORDS,
              talks: false,
            })}
          </AgentTabFoot>
        </UndeliveredLines>
      </AgentPicturesProvider>
    </AgentTabFrame>
  );
}
