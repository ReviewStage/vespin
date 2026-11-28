import { BOOT_WORDS } from "@repo/features/agent-boot-words";
import { readingWords } from "@repo/features/words";
import {
  CHAT_RUN,
  CHAT_SIDE,
  ChannelMessage,
  ChatBubble,
  ComposerFoot,
  SKELETON_KIND,
  Skeleton,
  SkeletonRegion,
} from "@repo/ui";
import { ConversationLead } from "@repo/ui/conversation";
import { Message, MessageContent } from "../ai-elements/message.js";
import { PromptInputCard } from "../ai-elements/prompt-input.js";
import { BUTTON, ComposerCard, PLACEHOLDER } from "./agent-composer.js";
import { AgentTabFoot, AgentTabFrame } from "./agent-tab-frame.js";
import { ATTACH_FILES, AttachFilesButton } from "./attach-files-button.js";
import { ComposerFieldRoom, ComposerPlaceholder, UnloadedComposerField } from "./composer-field.js";
import { ComposerActions, ComposerAttach } from "./message-box.js";
import { WorkingLine } from "./working-time.js";

/**
 * agent-tab-skeleton.tsx -- an agent's tab in the shape it lands in, while what it draws is on its way.
 *
 * An agent's tab follows its transcript from the agent's id alone, while
 * the agent itself, its plan, its model, where it stands, is read beside it
 * (`AgentTab`). Until the agent is read the tab stands as this: the log's
 * last exchange over the composer, each where the tab will draw it. The
 * log stands as a conversation's foot does, the developer's bubble at the
 * right over the agent's reply and the line under it, drawn in the
 * transcript's own turns, and its lines stand on until its first page
 * lands. The composer stands as itself, held: its field asking for a follow
 * up, its + and its send as they land, and only the model's name, which the
 * agent alone knows, a block, so the composer lands without moving. So the
 * tab lands in place rather than through a spinner per read, on every
 * platform alike. The task's page stands its column as this too while the
 * task itself is read (`desktop-tasks.tsx`), so a task opened on an agent
 * shows one placeholder from the open to the transcript, never a chain of
 * them. A Start still under way has no transcript to stand in for, so its
 * log says only that the agent is starting, at its top where the agent's
 * tab goes on saying how its machine boots (`AgentBootLine`), rather than
 * an exchange that never took place. A Manager's chat is a channel, not a
 * transcript, so until its messages are read it stands as a channel's last
 * runs, each drawn as the chat draws a message (`ChannelMessage`): a
 * picture's disc in the gutter, a name and a time over the lines, and a run
 * going on under its sender's with neither (`ManagerChatSkeleton`); a
 * thread beside it stands its message and a reply from its top
 * (`ManagerThreadSkeleton`).
 */

/** What the log's placeholder says to a reader. */
const TRANSCRIPT_LOADING_LABEL = readingWords("the transcript");

/**
 * How wide each line of the log's last exchange stands, the newest last: the
 * developer's two lines in their bubble, the agent's three in its reply, and
 * the short line under the reply that says how long it worked.
 */
const LOG_LINE_WIDTHS = {
  ASKED: ["208px", "132px"],
  REPLY: ["94%", "86%", "58%"],
  WORKED: "36%",
} as const;

/**
 * A channel message as its skeleton stands it: how wide each of its lines
 * stands, and, where it opens its sender's run, how wide the sender's name
 * stands over them; one with no name goes on under the message before it.
 */
interface ChannelMessageSkeletonLines {
  readonly name?: string;
  readonly lines: readonly string[];
}

/** How wide a channel message's time stands beside its sender's name, as a day's time reads ("Today, 8:04 PM"). */
const CHANNEL_TIME_WIDTH = "88px";

/** A channel message's picture, the gutter's disc, as wide as the gutter the chat stands its faces in. */
const CHANNEL_AVATAR_WIDTH = "var(--spacing-channel-avatar)";

/**
 * A Manager's chat's last messages, the newest last: a person's ask, then
 * the Manager's answer, a second message going on under it, as the chat's
 * foot most often reads.
 */
const CHAT_MESSAGES: readonly ChannelMessageSkeletonLines[] = [
  { name: "112px", lines: ["58%"] },
  { name: "136px", lines: ["94%", "72%"] },
  { lines: ["44%"] },
];

/** A Manager's thread from its top: the message it answers, then a reply under it. */
const THREAD_MESSAGES: readonly ChannelMessageSkeletonLines[] = [
  { name: "136px", lines: ["92%", "64%"] },
  { name: "112px", lines: ["52%"] },
];

/** What the chat's placeholder says to a reader, and its thread's. */
const CHAT_LOADING_LABEL = {
  CHAT: readingWords("the messages"),
  THREAD: readingWords("the thread"),
} as const;

/** How wide the model's name stands in the composer until the agent says which it is. */
const MODEL_NAME_WIDTH = "96px";

/** Does nothing with files handed to the held composer's +, which takes no press. */
function takeNoFiles(): void {}

/** The log's last exchange, standing at its foot where the newest lines draw, which `label` names to a reader. */
export function TranscriptSkeleton({
  label = TRANSCRIPT_LOADING_LABEL,
}: {
  label?: string | undefined;
}): React.JSX.Element {
  return (
    <div className="agent-log-skeleton-wait">
      <SkeletonRegion label={label}>
        <div className="agent-log-skeleton">
          <Message from="user">
            <ChatBubble side={CHAT_SIDE.SENT} run={CHAT_RUN.ALONE}>
              {LOG_LINE_WIDTHS.ASKED.map((width) => (
                <Skeleton key={width} width={width} />
              ))}
            </ChatBubble>
          </Message>
          <Message from="assistant">
            <MessageContent>
              {LOG_LINE_WIDTHS.REPLY.map((width) => (
                <Skeleton key={width} width={width} />
              ))}
            </MessageContent>
          </Message>
          <Skeleton width={LOG_LINE_WIDTHS.WORKED} />
        </div>
      </SkeletonRegion>
    </div>
  );
}

/** A channel's messages, each drawn as the chat draws one: opening a run under its sender's disc, name, and time, or going on under the one before. */
function ChannelMessagesSkeleton({
  messages,
}: {
  messages: readonly ChannelMessageSkeletonLines[];
}): React.JSX.Element {
  return (
    <div className="agent-log-skeleton manager-chat-skeleton">
      {messages.map(({ name, lines }, at) => (
        <ChannelMessage
          // Note that the messages are a fixed declaration, so each keeps its place in it.
          key={at}
          avatar={<Skeleton kind={SKELETON_KIND.CIRCLE} width={CHANNEL_AVATAR_WIDTH} />}
          name={<Skeleton width={name} />}
          at={<Skeleton width={CHANNEL_TIME_WIDTH} />}
          continues={name === undefined}
        >
          {lines.map((width) => (
            <Skeleton key={width} width={width} />
          ))}
        </ChannelMessage>
      ))}
    </div>
  );
}

/** A Manager's chat while its messages are read, which `label` names to a reader: its last messages, standing at its foot where the newest draw over the box. */
export function ManagerChatSkeleton({
  label = CHAT_LOADING_LABEL.CHAT,
}: {
  label?: string | undefined;
}): React.JSX.Element {
  return (
    <div className="agent-log-skeleton-wait">
      <SkeletonRegion label={label}>
        <ChannelMessagesSkeleton messages={CHAT_MESSAGES} />
      </SkeletonRegion>
    </div>
  );
}

/** A Manager's thread while its messages are read: the message it answers and a reply, standing from its top as a thread reads. */
export function ManagerThreadSkeleton(): React.JSX.Element {
  return (
    <div className="agent-log-skeleton-wait manager-thread-skeleton-wait">
      <SkeletonRegion label={CHAT_LOADING_LABEL.THREAD}>
        <ChannelMessagesSkeleton messages={THREAD_MESSAGES} />
      </SkeletonRegion>
    </div>
  );
}

/**
 * The composer's card in its own frame and size, drawn as the composer
 * itself, held and inert: its field unloaded and asking for a follow up as
 * the loaded one will, and its foot as the composer lays it, the + at the
 * left and the round send at the right, each taking no press, with a block
 * of the model's name beside the send. The icon presses between
 * the chip and Send are left out, as a narrow card folds them into its ⋯.
 */
function ComposerSkeleton(): React.JSX.Element {
  return (
    <ComposerCard inert>
      <PromptInputCard>
        <ComposerFieldRoom>
          <ComposerPlaceholder>{PLACEHOLDER.FOLLOW_UP}</ComposerPlaceholder>
          <UnloadedComposerField />
        </ComposerFieldRoom>
        <ComposerFoot
          tools={
            <ComposerAttach>
              <AttachFilesButton label={ATTACH_FILES} disabled onFiles={takeNoFiles} />
            </ComposerAttach>
          }
          actions={
            <ComposerActions>
              <Skeleton width={MODEL_NAME_WIDTH} />
            </ComposerActions>
          }
          send={{ label: BUTTON.SEND, empty: true }}
        />
      </PromptInputCard>
    </ComposerCard>
  );
}

/**
 * The log of an agent whose Start is still under way: no transcript, only
 * the working line at its top, uncounted, in the words the agent's tab says
 * while it cannot yet name where the machine boots.
 */
function StartingLog(): React.JSX.Element {
  return (
    <ConversationLead>
      <WorkingLine startedAt={undefined} words={BOOT_WORDS.STARTING} />
    </ConversationLead>
  );
}

/**
 * A whole agent's tab before it can be drawn: the log's last exchange over
 * the composer, which `label` names to a reader, or, while the agent's
 * Start is still under way (`starting`), the log saying it starts; a
 * Manager's (`chat`) its chat's last messages over the composer.
 */
export function AgentTabSkeleton({
  label,
  starting = false,
  chat = false,
}: {
  label?: string | undefined;
  starting?: boolean;
  chat?: boolean;
}): React.JSX.Element {
  const log = chat ? (
    <ManagerChatSkeleton label={label} />
  ) : starting ? (
    <StartingLog />
  ) : (
    <TranscriptSkeleton label={label} />
  );

  return (
    <AgentTabFrame>
      {log}
      <AgentTabFoot>
        <ComposerSkeleton />
      </AgentTabFoot>
    </AgentTabFrame>
  );
}
