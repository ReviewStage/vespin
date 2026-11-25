// manager-thread-screens.tsx -- one thread of a Manager's chat, pushed from the chat: the message it hangs on, its replies, and the box that answers in it, as the panel's Thread tab stands it beside the chat.

import { messageFailureWords } from "@repo/features/agent-refusal-words";
import { AGENT_KIND } from "@repo/features/agent-wire";
import { CHAT_THREAD_WORDS, managerChatView } from "@repo/features/manager-chat-view";
import { agentStillWriting } from "@repo/features/task-agents-model";
import { selectInboxReader } from "@repo/host/app-state-reads";
import {
  AgentTranscript,
  AskNote,
  BAR_TITLE,
  BUTTON_LOOK,
  Composer,
  GLYPH,
  GlassDock,
  MentionSuggestions,
  managerThreadItems,
  NO_TOGGLES,
  openCuts,
  SkillSuggestions,
  shownFiles,
  shownMediaIds,
  shownPictureIds,
  type TranscriptItem,
  type TranscriptToggles,
  toggledAt,
  type UndeliveredLine,
  useColors,
} from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  useAgentMedia,
  useAgentTranscript,
  useFollowedAgent,
  useManagerChat,
  useManagerChatRetry,
  useOlderChatPages,
  useSentFiles,
  useShownAgent,
  useWholeParts,
} from "../agents/use-agent.js";
import { useAgentComposer } from "../agents/use-agent-composer.js";
import { AgentPicturesProvider, useAgentPictures } from "../agents/use-agent-pictures.js";
import { useChatFaces } from "../agents/use-managers.js";
import { useMessageActs } from "../agents/use-message-acts.js";
import { appStateQuery } from "../host/app-state-query.js";
import { useNewestNote } from "../newest-note.js";
import { openInSafari, useOpenLink } from "../open-link.js";
import { useOnOwnTab } from "../tab-route.js";
import { useDictation } from "../use-dictation.js";

/** No row, while the thread is not read yet, the same array every render so nothing read off the rows reads again. */
const NO_ROWS: readonly TranscriptItem[] = [];

/** What the page says while it reads the chat, and where it could not. */
const READ_WORDS = {
  READING: "Reading the thread",
  FAILED: "The thread could not be read.",
  RETRY: "Try again",
} as const;

/**
 * The box that answers in the thread `root` names: the chat's own composer,
 * its words and photos sent to the chat as a reply in the thread
 * (`useAgentComposer`'s `thread`), with a draft of its own. Note that it
 * leaves out what acts on the Manager rather than on a reply, as the panel's
 * thread box does: Stop, the queue, the model chip, the MCP servers, where
 * it runs, and Talk, since a call's lines land in the chat; so its + attaches
 * photos at once.
 */
function ThreadComposer({
  composer,
  note,
}: {
  readonly composer: ReturnType<typeof useAgentComposer>;
  readonly note: string | undefined;
}) {
  const dictated = useDictation(composer.words, composer.onWords);
  const said = useNewestNote([composer.note, dictated.note, note]);

  const head =
    composer.skills === undefined &&
    composer.mentions === undefined &&
    said === undefined ? undefined : (
      <>
        {composer.skills === undefined ? null : (
          <SkillSuggestions
            skills={composer.skills.skills}
            empty={composer.skills.empty}
            onPick={composer.skills.pick}
          />
        )}
        {composer.mentions === undefined ? null : (
          <MentionSuggestions
            groups={composer.mentions.groups}
            empty={composer.mentions.empty}
            crumb={composer.mentions.crumb}
            onPick={composer.mentions.pick}
          />
        )}
        {said === undefined ? null : <AskNote words={said} />}
      </>
    );

  return (
    <Composer
      placeholder={composer.placeholder}
      words={composer.words}
      onWords={composer.onWords}
      sendable={composer.sendable}
      onSend={composer.send}
      onAdd={composer.attach}
      dictation={dictated.dictation}
      onDropPictures={composer.dropPictures}
      onLongPaste={composer.pasteText}
      head={head}
      focusAsk={composer.focusAsk}
      pills={composer.pills}
    />
  );
}

/**
 * One thread of a Manager's chat, named by the route's `id` and `root`, the
 * message it hangs on: that message alone under its sender's name, a rule
 * counting the replies, the replies in their runs, and the reader's replies
 * on their way after them, each as the chat's channel draws it
 * (`managerThreadItems`), opening at its newest; and at its foot the box
 * that answers in it (`ThreadComposer`). It is pushed over the chat on the
 * agent's own stack in every window, as Slack's app pushes a thread, so its
 * back button leads to the chat. It reads the chat's own rows, so it moves
 * as the chat does: a root older than the pages read is read for a page at
 * a time, and a root gone from the chat, as a rewind drops it, says so.
 */
export function ManagerThreadScreen() {
  const { id = "", root = "" } = useLocalSearchParams<{ id: string; root: string }>();
  const colors = useColors();
  const router = useRouter();
  const onOwnTab = useOnOwnTab();
  const agent = useFollowedAgent(id);
  const shown = useShownAgent(id);
  const { data: readerId } = useQuery({ ...appStateQuery, select: selectInboxReader });
  const chatHeld = useManagerChat(id, shown?.kind === AGENT_KIND.MANAGER);
  const chatPage = chatHeld?.rows;
  const held = useAgentTranscript(id);
  const transcript = held?.rows;
  const messages = transcript?.messages;
  const status = agent?.status ?? transcript?.word?.status ?? shown?.status;
  const writing = status !== undefined && agentStillWriting(status);
  const running = writing ? (agent?.turnId ?? undefined) : undefined;
  const chatFaces = useChatFaces(shown, readerId);
  const [toggles, setToggles] = useState<TranscriptToggles>(NO_TOGGLES);
  const whole = useWholeParts(id);
  const openLink = useOpenLink(shown?.workspaceId);
  const retry = useManagerChatRetry(id);
  const older = useOlderChatPages(id, chatPage?.before);
  const composer = useAgentComposer(id, agent, transcript, status, undefined, undefined, root);

  const items = useMemo(
    () =>
      chatPage === undefined
        ? undefined
        : managerThreadItems(
            managerChatView(chatPage.messages, messages ?? [], {
              running,
              sending: chatPage.sending ?? [],
            }),
            root,
            messages ?? [],
            {
              writing: false,
              readerId,
              toggles,
              now: Date.now(),
              pullRequests: [],
              wholePart: whole.read,
              sending: chatPage.sending,
              managerName: chatFaces?.managerName,
              readerName: chatFaces?.readerName,
            },
          ),
    [chatPage, messages, running, root, readerId, toggles, whole.read, chatFaces],
  );

  // Note that a root older than the pages read is read for, a page at a time, until it stands or the chat's start is read, as the panel's thread tab reads for it.
  const lacksRoot = chatPage !== undefined && items === undefined && older !== undefined;
  const readOlder = older?.onRead;
  useEffect(() => {
    if (lacksRoot) readOlder?.();
  }, [lacksRoot, readOlder]);

  const rows = items ?? NO_ROWS;
  // A call opened in a turn's work on an answer its page carried cut reads it whole, as the chat's page reads it.
  const cuts = useMemo(() => openCuts(rows), [rows]);
  useEffect(() => whole.ask(cuts), [whole, cuts]);
  const pictureIds = useMemo(() => shownPictureIds(rows), [rows]);
  const pictureSet = useMemo(() => new Set(pictureIds), [pictureIds]);

  const mediaIds = useMemo(
    () => shownMediaIds(rows).filter((each) => !pictureSet.has(each)),
    [rows, pictureSet],
  );

  const pictures = useAgentPictures(id, pictureIds);
  const media = useAgentMedia(id, mediaIds);
  const sentFiles = useSentFiles(useMemo(() => shownFiles(rows), [rows]));

  // Note that each message of the thread offers Reply, which quotes it into the thread's box, and never Edit, since a line is written again only where it stands in the chat itself, as the panel's thread box takes the Manager back nowhere.
  const chatLines = useMemo(
    () => new Map((chatPage?.messages ?? []).map((message) => [message.id, null])),
    [chatPage?.messages],
  );

  const messageActs = useMessageActs({
    agentId: id,
    agent: shown,
    transcript,
    readerId,
    composer,
    calling: false,
    chatLines,
  });

  // A reply of the reader's the service refused, marked Not delivered where it went, with Retry, Edit, and Delete, by the key it went under.
  const sending = chatPage?.sending;

  const undelivered = useCallback(
    (lineId: string): UndeliveredLine | undefined => {
      const sent = sending?.find((each) => each.clientKey === lineId);

      return sent?.refused === undefined
        ? undefined
        : {
            why: messageFailureWords(sent.refused.failure),
            newThread: false,
            onRetry: () => composer.undelivered.retry(lineId),
            onEdit: () => composer.undelivered.edit(lineId),
            onDelete: () => composer.undelivered.drop(lineId),
          };
    },
    [sending, composer.undelivered],
  );

  const failed = chatHeld?.failed === true;
  const gone = chatPage !== undefined && items === undefined && older === undefined;

  const empty = gone
    ? { title: CHAT_THREAD_WORDS.GONE, symbol: GLYPH.THREAD }
    : {
        title: failed ? READ_WORDS.FAILED : READ_WORDS.READING,
        symbol: failed ? GLYPH.FAILED : GLYPH.THREAD,
        loading: !failed,
        action: failed
          ? { label: READ_WORDS.RETRY, look: BUTTON_LOOK.BORDERED, onPress: retry }
          : undefined,
      };

  return (
    <>
      <Stack.Screen
        options={{
          title: CHAT_THREAD_WORDS.TITLE,
          headerTitleStyle: { ...BAR_TITLE.SCREEN, color: colors.TEXT },
        }}
      />
      <GlassDock bar={<ThreadComposer composer={composer} note={undefined} />}>
        <AgentPicturesProvider agentId={id}>
          <AgentTranscript
            items={rows}
            head={null}
            empty={empty}
            older={lacksRoot ? older : undefined}
            repository={agent?.repository}
            onOpenLink={openLink}
            onToggle={(item) => setToggles((was) => toggledAt(was, item))}
            onOpenPage={(item) =>
              router.push({
                pathname: onOwnTab("/tasks/agent/[id]/page"),
                params: { id, page: item.page, version: String(item.version), title: item.title },
              })
            }
            mediaSource={(mediaId) =>
              pictureSet.has(mediaId) ? pictures.refOf(mediaId) : media.sources.get(mediaId)
            }
            fileSource={sentFiles.source}
            onRetryFile={sentFiles.retry}
            onRetryMedia={(mediaId) =>
              pictureSet.has(mediaId) ? pictures.retry(mediaId) : media.retry(mediaId)
            }
            onOpenAddress={openInSafari}
            messageMore={messageActs.more}
            channel={chatFaces?.faces}
            undelivered={undelivered}
          />
        </AgentPicturesProvider>
      </GlassDock>
    </>
  );
}
