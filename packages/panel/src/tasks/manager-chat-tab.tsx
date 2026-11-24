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
 * is read, since nothing stores it.
 *
 * The transcript is the work under the chat, read beside it only for what
 * a chat shows of it: whether a turn is under way, which the working line
 * says, and each turn's work, which the Manager's last message of the turn
 * opens on Show work, and the working line opens for the turn under way. A
 * message the reader sends goes to the chat (`agents.chat.send`) and stands
 * drawn at its end from the moment it is sent, as the host draws it on its
 * way, until its row lands; one refused stands marked, with Retry, Edit, and
 * Delete, as any of the agent box's lines does.
 */

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
import { MANAGER_CHAT_AUTHOR, type ManagerChatLiveMessage } from "@repo/features/manager-chat-live";
import { type ManagerChatLine, managerChatView } from "@repo/features/manager-chat-view";
import type { ManagerFace as ManagerFaceValue } from "@repo/features/manager-face";
import { managerGreeting } from "@repo/features/manager-greeting";
import type { MessageFileChip } from "@repo/features/message-files";
import { ACT_KIND } from "@repo/host/acts";
import { EXPERIMENT } from "@repo/settings";
import {
  CHAT_RUN,
  CHAT_SIDE,
  ChatAside,
  ChatBubble,
  chatRunOf,
  MESSAGE_LINE_ALIGN,
  MESSAGE_LINE_INSET,
  MessageHead,
  MessageLine,
  type MessageLineInset,
  TEXT_ELEMENT,
  TEXT_VARIANT,
  Text,
} from "@repo/ui";
import { MANAGER_FACE_SIZE, ManagerFace } from "@repo/ui/manager-face";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Option, Schema } from "effect";
import { type ReactNode, useMemo, useRef, useState } from "react";
import type { AgentActAnswer } from "../act.js";
import { actMutation } from "../act-mutations.js";
import { ACTOR_SIZE, ActorMark, ActorRef } from "../actor-ref.js";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "../ai-elements/conversation.js";
import { Message, RECEIVED_MESSAGE_CLASS } from "../ai-elements/message.js";
import { managerChatQuery, managerChatRetryMutation } from "../live-reads.js";
import { usePerson } from "../member-directory.js";
import { appStateQuery, selectExperiment } from "../use-app-state.js";
import { useAgentApprovals, useApprovingSend } from "./agent-approvals.js";
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
import { TurnWorkRows } from "./agent-tab.js";
import { AgentTabFoot, AgentTabFrame } from "./agent-tab-frame.js";
import { TranscriptSkeleton } from "./agent-tab-skeleton.js";
import { ReplyMessageAction, useChatMessageMenu } from "./chat-reply.js";
import { type ChatWorkToggle, WorkingWorkAction, WorkMessageAction } from "./chat-work.js";
import { CopyMessageAction } from "./copy-message.js";
import { EditComposer } from "./edit-composer.js";
import { useManagerChatLooks } from "./manager-chat-looks.js";
import { useMoveToCloud } from "./move-agent.js";
import { ReplyDoorProvider, ReplyToSelection, useBoxReplyDoor } from "./reply-to-selection.js";
import { RewindProvider, useMessageEdit } from "./rewind-action.js";
import { type AgentThreads, ThreadsDock } from "./threads-dock.js";
import { TranscriptWords } from "./transcript-blocks.js";
import { OlderReadFailed, TranscriptReadFailed } from "./transcript-read-failed.js";
import { UndeliveredLines, UndeliveredMark, useSentLineMarks } from "./undelivered-mark.js";
import {
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
}

/** The face beside a Manager's bubbles; none where it wears none. */
function chatAvatar(face: ManagerFaceValue | undefined): ReactNode {
  return face === undefined ? undefined : (
    <ManagerFace face={face} size={MANAGER_FACE_SIZE.MESSAGE} />
  );
}

/** Where a run's head and the line under it start: past the face beside its bubbles, or at the bubble's inset where none stands. */
function chatInset(face: ManagerFaceValue | undefined): MessageLineInset {
  return face === undefined ? MESSAGE_LINE_INSET.BUBBLE : MESSAGE_LINE_INSET.AVATAR;
}

/** A Manager's name over a run of its messages, as a group chat names a speaker over theirs. */
function ManagerHead({ manager }: { manager: ChatManagerLook }): ReactNode {
  return (
    <MessageHead
      inset={chatInset(manager.face)}
      sender={
        <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.INHERIT} truncate>
          {manager.name}
        </Text>
      }
    />
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
    <Message from="assistant" className={RECEIVED_MESSAGE_CLASS} data-manager-greeting="">
      <ManagerHead manager={manager} />
      <ChatBubble side={CHAT_SIDE.RECEIVED} run={CHAT_RUN.ALONE} avatar={chatAvatar(manager.face)}>
        <TranscriptWords text={words} />
      </ChatBubble>
    </Message>
  );
}

/**
 * One of the Manager's messages: its words in a bubble at the column's left,
 * under its name where it opens its run, beside its face, with Copy and
 * Reply beside it, and Show work where it is the last the Manager sent in a
 * turn that did work, which opens that turn's work under it; its files over
 * the words; when it was sent under the run's last.
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
  const { face } = doors.manager;
  const toggle = useWorkToggle();
  const offered = work === null ? undefined : toggle;
  const menu = useChatMessageMenu(message.text, offered);
  // Note that the Manager's pictures kept with their size stand as the set it showed, as the transcript draws a shown set.
  const shown = shownOf(message);
  const files = fileChipsOf(message, shown);

  return (
    <Message from="assistant" className={RECEIVED_MESSAGE_CLASS} data-message-id={message.id}>
      {place.opens ? <ManagerHead manager={doors.manager} /> : null}
      {shown.length === 0 && files.length === 0 ? null : (
        // Note that what the Manager showed stands at its bubbles' inset, past its face, as the work under a message does.
        <ChatAside inset={chatInset(face)}>
          <KeptShownSet shown={shown} />
          {files.length === 0 ? null : <KeptFileChips files={files} />}
        </ChatAside>
      )}
      {message.text === "" ? null : (
        <ChatBubble
          side={CHAT_SIDE.RECEIVED}
          run={chatRunOf(place.opens, place.closes)}
          avatar={chatAvatar(face)}
          contextMenu={menu.contextMenu}
          beside={
            <CopyMessageAction
              words={message.text}
              // Note that a turn's journal stands under the turn's own id, which Rewind conversation to here names it by.
              messageId={place.closes && message.turnId !== null ? message.turnId : undefined}
              rewind={place.closes && message.turnId !== null ? REWIND_ACTION.REVERT : undefined}
              lead={
                <>
                  <ReplyMessageAction words={message.text} />
                  {offered === undefined ? null : <WorkMessageAction toggle={offered} />}
                </>
              }
            />
          }
        >
          <TranscriptWords text={message.text} />
        </ChatBubble>
      )}
      {toggle.shown && work !== null ? <ChatAside inset={chatInset(face)}>{work}</ChatAside> : null}
      {menu.menu}
      {place.closes ? (
        <MessageLine
          align={MESSAGE_LINE_ALIGN.START}
          inset={chatInset(face)}
          at={message.createdAt}
        />
      ) : null}
    </Message>
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

  return (
    <Message
      from={own ? "user" : "assistant"}
      className={own ? undefined : RECEIVED_MESSAGE_CLASS}
      data-message-id={message.id}
    >
      {!own && place.opens ? (
        <MessageHead
          inset={MESSAGE_LINE_INSET.AVATAR}
          sender={<ActorRef actor={sender} nameOnly />}
        />
      ) : null}
      {files.length === 0 ? null : <KeptFileChips files={files} />}
      {message.text === "" ? null : (
        <ChatBubble
          side={own ? CHAT_SIDE.SENT : CHAT_SIDE.RECEIVED}
          run={chatRunOf(place.opens, place.closes)}
          avatar={own ? undefined : <ActorMark actor={sender} size={ACTOR_SIZE.CARD} />}
          contextMenu={menu.contextMenu}
          beside={
            <CopyMessageAction
              words={message.text}
              messageId={ownLine === undefined ? undefined : lineId}
              rewind={ownLine === undefined ? undefined : REWIND_ACTION.EDIT}
              lead={<ReplyMessageAction words={message.text} />}
            />
          }
        >
          <TranscriptWords text={message.text} />
        </ChatBubble>
      )}
      {menu.menu}
      {place.closes ? (
        <MessageLine
          align={own ? MESSAGE_LINE_ALIGN.END : MESSAGE_LINE_ALIGN.START}
          inset={own ? MESSAGE_LINE_INSET.BUBBLE : MESSAGE_LINE_INSET.AVATAR}
          at={message.createdAt}
        />
      ) : null}
    </Message>
  );
}

/** One of the reader's messages on its way to the chat, or refused, at the chat's end: their bubble at the column's right, its files over it, and its mark where it did not go. */
function SendingLine({ line }: { line: SentLine }): ReactNode {
  const refused = line.state !== SENT_LINE_STATE.PENDING;
  const mark = refused ? <UndeliveredMark messageId={line.id} /> : null;

  const files = line.attachments.map(
    (file): MessageFileChip => ({ name: file.name, mediaType: file.mediaType, url: file.data }),
  );

  return (
    <Message from="user" data-message-id={line.id} data-undelivered={refused ? "" : undefined}>
      {files.length === 0 ? null : <KeptFileChips files={files} sending={!refused} />}
      <ChatBubble side={CHAT_SIDE.SENT} run={CHAT_RUN.ALONE} beside={mark}>
        <TranscriptWords text={line.text} />
      </ChatBubble>
      <MessageLine
        align={MESSAGE_LINE_ALIGN.END}
        inset={MESSAGE_LINE_INSET.BUBBLE}
        status={refused ? undefined : "Sending…"}
        at={refused ? line.sentAt : undefined}
      />
    </Message>
  );
}

/** What the chat says while a turn runs: its working line in a bubble of the Manager's, as a chat app shows the other side typing, the turn's work so far a press away. */
function ChatWorking({
  words,
  face,
  work,
}: {
  words: string;
  face: ManagerFaceValue | undefined;
  work: ReactNode | null;
}): ReactNode {
  const toggle = useWorkToggle();

  return (
    <Message from="assistant" className={RECEIVED_MESSAGE_CLASS}>
      <ChatBubble
        side={CHAT_SIDE.RECEIVED}
        run={CHAT_RUN.ALONE}
        avatar={chatAvatar(face)}
        beside={work === null ? null : <WorkingWorkAction toggle={toggle} />}
      >
        <WorkingLine startedAt={undefined} words={words} />
      </ChatBubble>
      {toggle.shown && work !== null ? <ChatAside inset={chatInset(face)}>{work}</ChatAside> : null}
    </Message>
  );
}

/** A message's files by the ids this window keeps their bytes under, by the key the message went under, which its Retry carries again. */
type SentFiles = Map<string, NonNullable<SendingMessage["files"]>>;

/** The reader's messages on their way to the chat, as the box's lines read them: each under its key, which its Retry sends again with the files this window keeps the bytes of, and its Delete lets go by. */
function sendingLinesOf(
  sending: readonly ManagerChatSending[] | undefined,
  files: SentFiles,
): readonly SendingMessage[] {
  return (sending ?? []).map((message) => ({
    id: message.clientKey,
    clientKey: message.clientKey,
    text: message.text,
    sentAt: message.sentAt,
    steers: false,
    ...(files.has(message.clientKey) ? { files: files.get(message.clientKey) } : undefined),
    ...(message.sentBy === undefined ? undefined : { sentBy: message.sentBy }),
    ...(message.refused === undefined ? undefined : { refused: message.refused }),
  }));
}

/** The chat's lines in runs, each run the lines of one sender that go on from its first, so the log stands each run as one row and its bubbles close together. */
function runsOf(lines: readonly ManagerChatLine[]): readonly (readonly ManagerChatLine[])[] {
  const runs: ManagerChatLine[][] = [];

  for (const line of lines) {
    const run = runs.at(-1);

    if (run === undefined || line.place.opens) runs.push([line]);
    else run.push(line);
  }

  return runs;
}

/** No pictures drawn as a set, as a person's message draws its files as chips. */
const NONE_SHOWN: readonly ShownPicture[] = [];

/** No message on its way. */
const NONE_SENDING: readonly ManagerChatSending[] = [];

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
      () => sendingLinesOf(chat?.sending ?? NONE_SENDING, sentFiles.current),
      [chat?.sending],
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

  const doors = useMemo(
    () => ({ manager, readerId: control.me, delegation, lines }),
    [manager, control.me, delegation, lines],
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
      <Conversation onNearTop={onOlder}>
        {olderFailed && onOlder !== undefined ? <OlderReadFailed onRetry={onOlder} /> : null}
        <ConversationContent>
          {before === undefined ? (
            <ManagerGreeting manager={manager} words={managerGreeting(agent.title)} />
          ) : null}
          {runsOf(view.messages).map((run) => (
            // Note that a run stands as one row of the log, so its bubbles stand close together and runs a step apart.
            <div key={run[0]?.message.id} className="flex flex-col gap-tight-gap">
              {run.map((line) =>
                line.message.authorKind === MANAGER_CHAT_AUTHOR.AGENT ? (
                  <ManagerMessage
                    key={line.message.id}
                    line={line}
                    doors={doors}
                    work={
                      line.work === undefined ? null : (
                        <TurnWorkRows
                          parts={view.work.get(line.work) ?? []}
                          moving={false}
                          delegation={delegation}
                        />
                      )
                    }
                  />
                ) : (
                  <PersonMessage key={line.message.id} line={line} doors={doors} />
                ),
              )}
            </div>
          ))}
          {composer.sent.map((line) => (
            <SendingLine key={line.id} line={line} />
          ))}
          {standing.working ? (
            <ChatWorking
              words={workingLineWords(standing.phase, standing.waitsUntil)}
              face={agent.face}
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
              {log}
            </ReplyDoorProvider>
          </RewindProvider>
        </UndeliveredLines>
      </AgentPicturesProvider>
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
      {replies ? <ReplyToSelection scope={tab} onReply={replyThroughBox} /> : null}
    </AgentTabFrame>
  );
}
