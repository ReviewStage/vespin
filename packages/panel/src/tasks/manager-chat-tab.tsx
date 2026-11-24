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
 * says, and each turn's work, which stands folded over the Manager's first
 * message of the turn, as a chat app stands what it thought over its answer,
 * and which the working line opens for the turn under way. A call the Manager holds for the reader's answer stands at the chat's
 * foot, its answers under it, since the work it stands in is a press away. A
 * message the reader sends goes to the chat (`agents.chat.send`) and stands
 * drawn at its end from the moment it is sent, as the host draws it on its
 * way, until its row lands; one refused stands marked, with Retry, Edit, and
 * Delete, as any of the agent box's lines does.
 */

import { waitingOnYouWords } from "@repo/features/agent-approval-model";
import { endLineReason } from "@repo/features/agent-continue-model";
import { computerAppsOf } from "@repo/features/agent-parts";
import type { ShownPicture } from "@repo/features/agent-pictures-model";
import { REWIND_ACTION, rewindPoints } from "@repo/features/agent-rewind-model";
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
import { chatWorkWords } from "@repo/features/manager-chat";
import { MANAGER_CHAT_AUTHOR, type ManagerChatLiveMessage } from "@repo/features/manager-chat-live";
import { type ManagerChatLine, managerChatView } from "@repo/features/manager-chat-view";
import type { ManagerFace as ManagerFaceValue } from "@repo/features/manager-face";
import { managerGreeting } from "@repo/features/manager-greeting";
import type { MessageFileChip } from "@repo/features/message-files";
import { WORKED_WORDS, workingTime } from "@repo/features/time-format";
import { ACT_KIND } from "@repo/host/acts";
import { EXPERIMENT } from "@repo/settings";
import {
  ChannelMessage,
  ChannelSplit,
  Disclosure,
  DisclosureBody,
  DisclosureSummary,
  GlyphSlot,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  TIME_LOOK,
  Time,
} from "@repo/ui";
import { ICON_SIZE } from "@repo/ui/icons";
import { MANAGER_FACE_SIZE, ManagerFace } from "@repo/ui/manager-face";
import type { VirtualRowsHandle } from "@repo/ui/virtual-rows";
import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Option, Schema } from "effect";
import { Fragment, type ReactNode, useCallback, useMemo, useRef, useState } from "react";
import type { AgentActAnswer } from "../act.js";
import { actMutation } from "../act-mutations.js";
import { ACTOR_SIZE, ActorMark } from "../actor-ref.js";
import {
  Conversation,
  ConversationContent,
  ConversationRows,
  ConversationScrollButton,
} from "../ai-elements/conversation.js";
import { EntityGlyph } from "../entities/entity-glyph.js";
import { useFindOpen } from "../find-in-tab.js";
import { managerChatQuery, managerChatRetryMutation } from "../live-reads.js";
import { useMemberDirectory, usePerson } from "../member-directory.js";
import { keepPictureRead } from "../picture-query.js";
import { appStateQuery, selectExperiment } from "../use-app-state.js";
import { type FindRow, useVirtualFind } from "../virtual-find.js";
import {
  ApprovalsProvider,
  heldCallPart,
  useAgentApprovals,
  useApprovingSend,
} from "./agent-approvals.js";
import { useAgentBox } from "./agent-box.js";
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
import { ReplyMessageAction, useChatMessageMenu } from "./chat-reply.js";
import { type ChatWorkToggle, WorkingWorkAction } from "./chat-work.js";
import { CopyMessageAction } from "./copy-message.js";
import { EditComposer } from "./edit-composer.js";
import { useManagerChatLooks } from "./manager-chat-looks.js";
import { ManagerThreadPane, ThreadReplyAction, ThreadSummary } from "./manager-chat-threads.js";
import { useMoveToCloud } from "./move-agent.js";
import { ReplyDoorProvider, ReplyToSelection, useBoxReplyDoor } from "./reply-to-selection.js";
import { RewindProvider, useMessageEdit } from "./rewind-action.js";
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
  readonly manager: ChatManagerLook;
  readonly readerId: string | undefined;
  readonly delegation: DelegationDoors;
  /** The transcript's lines by their ids, which a person's message opens for writing again by its line (`lineId`). */
  readonly lines: ReadonlyMap<string, AgentTranscriptMessage>;
  /** The chat's threads, which its rows open; none in a thread's own pane, whose rows open no thread. */
  readonly thread?: ChatThreadDoors | undefined;
}

/** The chat's threads as its rows read them: each root's replies by the root's id, the thread open in the pane, and the press that opens one. */
interface ChatThreadDoors {
  readonly replies: ReadonlyMap<string, readonly ManagerChatLine[]>;
  readonly open: string | undefined;
  readonly onOpen: (root: string) => void;
}

/** What a row offers of its thread: Reply in thread beside its Copy, and the summary of its replies under it; nothing in a thread's pane. A reply posted to the chat too opens the thread it stands in. */
/** What a row draws of its thread: its press beside its Copy, and its summary under its words. */
interface RowThread {
  readonly action: ReactNode;
  readonly summary: ReactNode;
}

function threadOf(message: ManagerChatLiveMessage, doors: ChatDoors): RowThread {
  const { thread } = doors;

  if (thread === undefined) return { action: null, summary: null };
  const root = message.threadRoot ?? message.id;
  const onOpen = () => thread.onOpen(root);

  return {
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

  return { shown, onToggle: () => setShown((was) => !was) };
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

/** A turn's work as its fold draws it: what its line says, and the work's rows. */
interface TurnWork {
  readonly summary: string;
  readonly rows: ReactNode;
}

/** What a turn's fold says: how long the turn worked, where its journal says when it began and ended, as the transcript's last line of a turn says it; Show work otherwise. */
function turnWorkSummary(turn: AgentTranscriptMessage | undefined): string {
  const startedAt = turn?.startedAt;
  const finishedAt = turn?.finishedAt;

  if (startedAt === undefined || finishedAt === undefined || finishedAt < startedAt) {
    return chatWorkWords(false);
  }

  return `${WORKED_WORDS}${workingTime(finishedAt - startedAt)}`;
}

/**
 * One of the Manager's messages: its words in a bubble at the column's left,
 * under its name where it opens its run, beside its face, with Copy and
 * Reply beside it; the work of its turn folded over it where it is the
 * first the Manager sent in a turn that did work; its files over the words;
 * when it was sent under the run's last.
 */
function ManagerMessage({
  line,
  doors,
  work,
}: {
  line: ManagerChatLine;
  doors: ChatDoors;
  work: TurnWork | null;
}): ReactNode {
  const { message, place } = line;
  const menu = useChatMessageMenu(message.text);
  // Note that the Manager's pictures kept with their size stand as the set it showed, as the transcript draws a shown set.
  const shown = shownOf(message);
  const files = fileChipsOf(message, shown);
  const thread = threadOf(message, doors);

  return (
    <>
      <ChannelMessage
        messageId={message.id}
        avatar={<ChatFace face={doors.manager.face} />}
        name={doors.manager.name}
        at={sentTime(message.createdAt)}
        continues={!place.opens}
        contextMenu={menu.contextMenu}
        actions={
          message.text === "" ? null : (
            <CopyMessageAction
              words={message.text}
              // Note that a turn's journal stands under the turn's own id, which Rewind conversation to here names it by.
              messageId={place.closes && message.turnId !== null ? message.turnId : undefined}
              rewind={place.closes && message.turnId !== null ? REWIND_ACTION.REVERT : undefined}
              lead={
                <>
                  {thread.action}
                  <ReplyMessageAction words={message.text} />
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
            {thread.summary}
          </>
        }
      >
        {work === null ? null : (
          // Note that the turn's work stands folded over its first message, in the order it was done.
          <Disclosure data-turn-work="">
            <DisclosureSummary>
              <span>{work.summary}</span>
            </DisclosureSummary>
            <DisclosureBody>{work.rows}</DisclosureBody>
          </Disclosure>
        )}
        {message.text === "" ? null : <TranscriptWords text={message.text} />}
      </ChannelMessage>
      {menu.menu}
    </>
  );
}

/**
 * A person's message: the reader's own in a bubble at the column's right,
 * and anyone else's at its left, under their name where it opens their run
 * and beside their picture, its files over the words, Reply and Copy beside
 * it and in its menu, as every message of the chat offers them, and when it
 * was sent under the run's last.
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
  const editor = useMessageEdit(lineId ?? "");
  // Note that any message of the chat is answered as the Manager's is: Reply quotes it whole into the box, beside its Copy and in its menu.
  const menu = useChatMessageMenu(message.text);

  if (ownLine !== undefined && editor !== undefined) {
    return <EditComposer message={ownLine} words={message.text} edit={editor} />;
  }

  const thread = threadOf(message, doors);

  return (
    <>
      <ChannelMessage
        messageId={message.id}
        avatar={<ActorMark actor={sender} size={ACTOR_SIZE.CARD} />}
        name={message.authorName}
        at={sentTime(message.createdAt)}
        continues={!place.opens}
        contextMenu={menu.contextMenu}
        actions={
          message.text === "" ? null : (
            <CopyMessageAction
              words={message.text}
              messageId={ownLine === undefined ? undefined : lineId}
              rewind={ownLine === undefined ? undefined : REWIND_ACTION.EDIT}
              lead={
                <>
                  {thread.action}
                  <ReplyMessageAction words={message.text} />
                </>
              }
            />
          )
        }
        under={thread.summary}
      >
        {files.length === 0 ? null : <KeptFileChips files={files} />}
        {message.text === "" ? null : <TranscriptWords text={message.text} />}
      </ChannelMessage>
      {menu.menu}
    </>
  );
}

/** One of the reader's messages on its way to the chat, or refused: their row under their name, its files over its words, and Sending… under it, or its mark where it did not go. */
function SendingLine({
  line,
  readerId,
}: {
  line: SentLine;
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
    <div data-message-id={line.id} data-undelivered={refused ? "" : undefined}>
      <ChannelMessage
        avatar={<ActorMark actor={reader} size={ACTOR_SIZE.CARD} />}
        name={name}
        at={refused ? sentTime(line.sentAt) : undefined}
        under={
          refused ? (
            <UndeliveredMark messageId={line.id} />
          ) : (
            <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
              {SENDING_WORDS}
            </Text>
          )
        }
      >
        {files.length === 0 ? null : <KeptFileChips files={files} sending={!refused} />}
        <TranscriptWords text={line.text} />
      </ChannelMessage>
    </div>
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

/** What a row of the chat's log draws: the Manager's greeting, a message of the chat, or one of the reader's on its way. */
const CHAT_ROW = {
  GREETING: "greeting",
  MESSAGE: "message",
  SENDING: "sending",
} as const;

/** One row of the chat's log, under the key the log keeps it by. */
type ChatRow =
  | { readonly kind: typeof CHAT_ROW.GREETING; readonly key: string; readonly words: string }
  | { readonly kind: typeof CHAT_ROW.MESSAGE; readonly key: string; readonly line: ManagerChatLine }
  | { readonly kind: typeof CHAT_ROW.SENDING; readonly key: string; readonly line: SentLine };

/** The key the greeting's row stands under, which no message's id is. */
const GREETING_KEY = "greeting";

/** The height a row of the chat is taken to have before it is drawn and measured, in pixels: a short message's, with the step before it. */
const CHAT_ROW_ESTIMATE_PX = 88;

/** The chat's log as rows: the greeting where the chat's start is read, its messages oldest first, and the reader's on their way after them. */
function chatRowsOf(
  greeting: string | undefined,
  lines: readonly ManagerChatLine[],
  sent: readonly SentLine[],
): readonly ChatRow[] {
  return [
    ...(greeting === undefined
      ? []
      : [{ kind: CHAT_ROW.GREETING, key: GREETING_KEY, words: greeting } as const]),
    ...lines.map((line): ChatRow => ({ kind: CHAT_ROW.MESSAGE, key: line.message.id, line })),
    ...sent.map((line): ChatRow => ({ kind: CHAT_ROW.SENDING, key: line.id, line })),
  ];
}

/** A row as ⌘F reads it before it is drawn: its words. */
function findRowOf(row: ChatRow): FindRow {
  if (row.kind === CHAT_ROW.GREETING) return { key: row.key, words: row.words };

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

/** No row for ⌘F to read, while no find stands. */
const NO_FIND_ROWS: readonly FindRow[] = [];

/** No pictures drawn as a set, as a person's message draws its files as chips. */
const NONE_SHOWN: readonly ShownPicture[] = [];

/** No message on its way. */
const NONE_SENDING: readonly ManagerChatSending[] = [];

/** What stands under one of the reader's messages on its way. */
const SENDING_WORDS = "Sending…";

/** Whether a message on its way replies in a thread, where it stands on its way rather than at the chat's end. */
function inThread(message: ManagerChatSending): boolean {
  return message.threadRoot !== undefined;
}

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
  const transcript = useAgentTranscript({
    transcript: useMemo(() => ({ kind: TRANSCRIPT_KIND.AGENT, agentId: agent.id }), [agent.id]),
    shown,
  });

  const read = useQuery(managerChatQuery(agent.id));
  const { mutate: retryChat } = useMutation(managerChatRetryMutation());
  const { mutateAsync: sendChat } = useMutation(actMutation(ACT_KIND.AGENTS_CHAT_SEND));
  const { mutate: unsendChat } = useMutation(actMutation(ACT_KIND.AGENTS_CHAT_UNSEND));

  const { mutate: readOlder, isError: olderFailed } = useMutation(
    actMutation(ACT_KIND.AGENTS_MANAGER_CHAT_OLDER),
  );

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
  const send: MessageSender = useApprovingSend(async (agentId, message) => {
    keepFiles(message.clientKey, message);

    // Note that an edit takes the Manager back to just before its line first, which drops the line's row from the chat, and then sends its words to the chat as a message of its own.
    if (message.rewinds !== undefined) {
      const { messageId, restoreFiles } = message.rewinds;
      const rewound = await control.onRewind(agentId, messageId, restoreFiles);

      if ("failure" in rewound) return rewound;
    }

    return sendChat({
      agentId,
      text: message.text,
      clientKey: message.clientKey,
      ...(message.attachments === undefined ? undefined : { attachments: message.attachments }),
      ...(message.retry === undefined ? undefined : { retry: message.retry }),
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
    messages: transcript.messages,
    sending: useMemo(
      () =>
        sendingLinesOf(
          (chat?.sending ?? NONE_SENDING).filter((message) => !inThread(message)),
          (message) => filesOf(queryClient, agent.id, sentFiles.current, message),
        ),
      [chat?.sending, queryClient, agent.id],
    ),
    running: agent.status === AGENT_STATUS.RUNNING,
    send,
    unsend,
    rewind: control.onRewind,
    starter,
    shown,
  });

  const box = useAgentBox({ agentId: agent.id, agent, agents: control });
  const pictures = useAgentPictureDoor(agent.id);
  const queue = useAgentQueue(agent.id, transcript.queue);
  const queueEditing = useQueueEditing(composer, queue, pictures);
  const moveToCloud = useMoveToCloud(agent, control);
  const callRoute = useCallRoute(agent.id);
  const computerApps = useMemo(() => computerAppsOf(transcript.messages), [transcript.messages]);
  const { door: replyDoor, reply: replyThroughBox } = useBoxReplyDoor();
  const tab = useRef<HTMLElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const rowsHandle = useRef<VirtualRowsHandle>(null);
  useManagerChatLooks(agent.id, agent.saidAt);

  const { unarchive, endPress, endTrail, continuedNote, closedRemedy, continuable } =
    useAgentEndDoors({
      agent,
      control,
      composer,
      starter,
      hostLost: transcript.hostLost,
      moveToCloud,
      onOpenTarget,
      shown,
    });

  const marks = useSentLineMarks(composer, unarchive !== undefined);

  // A rewind writes in the box, so it is offered only while the box takes words, and nothing is rewound under a call into the Manager.
  const rewinds =
    boxTakesWords({
      archived: unarchive !== undefined,
      continued: continuedNote !== undefined,
      closed: composer.closed,
    }) && transcript.calls.length === 0;

  const restores =
    useQuery({ ...appStateQuery, select: selectExperiment(EXPERIMENT.REWIND_FILES) }).data === true;

  const pendingSends = composer.sent.length > 0;

  const points = useMemo(
    () => rewindPoints(transcript.messages, pendingSends, control.me, composer.going, restores),
    [transcript.messages, pendingSends, control.me, composer.going, restores],
  );

  // Note that the line's box reads what the tab's own box reads, as it opens.
  const editorProps = useRef({
    agentId: agent.id,
    keywords: control.keywords,
    skills: control.readSkills,
  });

  editorProps.current = {
    agentId: agent.id,
    keywords: control.keywords,
    skills: control.readSkills,
  };

  const rewind = rewinds
    ? {
        editing: composer.editing,
        onEdit: composer.edit,
        onCancelEdit: composer.dropEdit,
        onSendEdit: composer.sendEdit,
        onRevert: composer.revert,
        editor: () => editorProps.current,
        ...points,
      }
    : undefined;

  const standing = tabTurnOf(agent, composer);
  const running = standing.working ? (standing.turnId ?? agent.turnId ?? undefined) : undefined;
  const name = agentName(agent, control.models);
  const manager = useMemo(() => ({ name, face: agent.face }), [name, agent.face]);

  const view = useMemo(
    () => managerChatView(chat?.messages ?? [], transcript.messages, { running }),
    [chat?.messages, transcript.messages, running],
  );

  const delegation = useMemo(
    () => ({ models: control.models, onOpenTarget, cards }),
    [control.models, onOpenTarget, cards],
  );

  const lines = useMemo(
    () => new Map(transcript.messages.map((line) => [line.id, line])),
    [transcript.messages],
  );

  const [openThread, setOpenThread] = useState<string | undefined>(undefined);

  // Note that the pane's own rows read the chat's doors with no thread, so a reply offers no thread of its own.
  const paneDoors = useMemo(
    () => ({ manager, readerId: control.me, delegation, lines }),
    [manager, control.me, delegation, lines],
  );

  const doors = useMemo(
    () => ({
      ...paneDoors,
      thread: { replies: view.threads, open: openThread, onOpen: setOpenThread },
    }),
    [paneDoors, view.threads, openThread],
  );

  const boxOpen = boxTakesWords({
    archived: unarchive !== undefined,
    continued: continuedNote !== undefined,
    closed: composer.closed,
  });

  const replies = boxOpen && !composer.sending;

  const ended =
    transcript.pages === 0 || standing.working
      ? undefined
      : endLineParts(standing.status, standing.failure, starter, continuable, transcript.hostLost);

  const before = chat?.before;
  const onOlder = before === undefined ? undefined : () => readOlder({ agentId: agent.id, before });

  const rows = useMemo(
    () =>
      chatRowsOf(
        before === undefined ? managerGreeting(agent.title) : undefined,
        view.messages,
        composer.sent,
      ),
    [before, agent.title, view.messages, composer.sent],
  );

  const keys = useMemo(() => rows.map((row) => row.key), [rows]);
  const ownLast = ownLastOf(rows, control.me);
  const finding = useFindOpen();
  const findRows = useMemo(() => (finding ? rows.map(findRowOf) : NO_FIND_ROWS), [finding, rows]);
  useVirtualFind({ root: list, rows: findRows, handle: rowsHandle, findable: keys.length > 0 });

  // Note that a message going on its sender's run stands close under the one before it, as a chat app stands one sender's bubbles, and every other row a step from it (tasks.css).
  const rowClassOf = useCallback(
    (index: number) => {
      if (index === 0) return LOG_ROW_CLASS;
      const row = rows[index];

      return row?.kind === CHAT_ROW.MESSAGE && !row.line.place.opens
        ? `${LOG_ROW_CLASS} agent-log-row-run`
        : `${LOG_ROW_CLASS} agent-log-row-next`;
    },
    [rows],
  );

  const asks = approvals.asks;

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

  /** One message of the chat, as its sender draws it, reading `drawn`'s doors: the chat's, or a thread pane's. */
  const drawLine = (line: ManagerChatLine, drawn: ChatDoors): ReactNode => {
    if (line.message.authorKind !== MANAGER_CHAT_AUTHOR.AGENT) {
      return <PersonMessage line={line} doors={drawn} />;
    }

    return (
      <ManagerMessage
        line={line}
        doors={drawn}
        work={
          line.work === undefined
            ? null
            : {
                summary: turnWorkSummary(lines.get(line.work)),
                rows: (
                  <TurnWorkRows
                    parts={view.work.get(line.work) ?? []}
                    moving={false}
                    delegation={delegation}
                  />
                ),
              }
        }
      />
    );
  };

  /** One row of the log, as its kind draws it. */
  const drawRow = (row: ChatRow): ReactNode => {
    if (row.kind === CHAT_ROW.GREETING)
      return <ManagerGreeting manager={manager} words={row.words} />;

    if (row.kind === CHAT_ROW.SENDING) return <SendingLine line={row.line} readerId={control.me} />;

    return drawLine(row.line, doors);
  };

  // The open thread, where its root stands among the messages read: its root, its replies, and the reader's replies on their way.
  const rootLine =
    openThread === undefined
      ? undefined
      : view.messages.find(
          (line) => line.message.id === openThread && line.message.threadRoot === null,
        );

  // Note that a thread's box sends words alone, so a reply on its way stands as its words, marked where it did not go.
  const threadSending = useMemo(
    () =>
      (chat?.sending ?? NONE_SENDING)
        .filter((message) => message.threadRoot === openThread)
        .map(
          (message): SentLine => ({
            id: message.clientKey,
            clientKey: message.clientKey,
            text: message.text,
            attachments: [],
            steers: false,
            sentAt: message.sentAt,
            state:
              message.refused === undefined ? SENT_LINE_STATE.PENDING : SENT_LINE_STATE.UNDELIVERED,
          }),
        ),
    [chat?.sending, openThread],
  );

  /** Sends the reader's words to the chat as a reply in the open thread. */
  const sendInThread = (root: string) => (text: string) => {
    void sendChat({
      agentId: agent.id,
      text,
      clientKey: crypto.randomUUID(),
      threadRoot: root,
    } satisfies AgentChatSendParams);
  };

  const threadReplies = rootLine === undefined ? [] : (view.threads.get(rootLine.message.id) ?? []);

  const threadPane =
    rootLine === undefined ? null : (
      <ManagerThreadPane
        rootKey={rootLine.message.id}
        // Note that the root stands alone in the pane, under its sender's name.
        root={drawLine({ ...rootLine, place: { opens: true, closes: true } }, paneDoors)}
        count={threadReplies.length}
        replies={
          <>
            {threadReplies.map((line) => (
              <Fragment key={line.message.id}>{drawLine(line, paneDoors)}</Fragment>
            ))}
            {threadSending.map((line) => (
              <SendingLine key={line.id} line={line} readerId={control.me} />
            ))}
          </>
        }
        onSend={boxOpen ? sendInThread(rootLine.message.id) : undefined}
        onClose={() => setOpenThread(undefined)}
      />
    );

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
      <Conversation list={list} onNearTop={onOlder}>
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
    <AgentTabFrame ref={tab} label={name}>
      <AgentPicturesProvider value={pictures}>
        <UndeliveredLines value={marks}>
          <RewindProvider value={rewind}>
            <ReplyDoorProvider value={replies ? replyThroughBox : undefined}>
              <ChannelSplit pane={threadPane}>
                {log}
                <AgentTabFoot>
                  <ThreadsDock threads={threads} />
                  <AgentComposerDock
                    agent={agent}
                    box={box}
                    composer={composer}
                    transcript={transcript}
                    approvalsWaiting={approvals.waiting}
                    onStop={() => control.onStop(agent.id)}
                    onUnarchive={unarchive}
                    continuedNote={continuedNote}
                    cards={cards}
                    keywords={control.keywords}
                    skills={control.readSkills}
                    replyDoor={replyDoor}
                    closedRemedy={closedRemedy}
                    onMoveToCloud={moveToCloud}
                    queue={{ controls: true, working: standing.working, editing: queueEditing }}
                    place={{ owner: undefined, route: callRoute, pictures, computerApps }}
                  />
                </AgentTabFoot>
              </ChannelSplit>
            </ReplyDoorProvider>
          </RewindProvider>
        </UndeliveredLines>
      </AgentPicturesProvider>
      {replies ? <ReplyToSelection scope={tab} onReply={replyThroughBox} /> : null}
    </AgentTabFrame>
  );
}
