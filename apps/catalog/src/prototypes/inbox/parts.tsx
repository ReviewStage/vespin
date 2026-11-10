/**
 * parts.tsx -- what the four designs share: the agent's face and standing,
 * a thread's messages and their menu, the Decide ask, the reply box in its
 * thread form and its full agent form, and the agent's chat.
 *
 * Everything is drawn from `@repo/ui`. Where the panel draws a part of its
 * own (the Inbox row's marks, the agent's model chip, a turn's steps), it is
 * approximated from `@repo/ui`'s parts, and `APPROXIMATIONS` says which.
 */

import {
  ALIGN,
  AVATAR_SHAPE,
  AVATAR_SIZE,
  Avatar,
  BANNER_LOOK,
  Badge,
  Banner,
  BUTTON_SIZE,
  BUTTON_VARIANT,
  Button,
  CARD_ELEMENT,
  CARD_LOOK,
  CARD_PADDING,
  CARD_SHADOW,
  Card,
  CHIP_LOOK,
  Chip,
  COMMENT_ELEMENT,
  COMPOSER_ELEMENT,
  COMPOSER_LOOK,
  Comment,
  ComposerBody,
  ComposerFoot,
  ComposerFrame,
  CopyIcon,
  Disclosure,
  DisclosureBody,
  DisclosureSummary,
  GAP,
  GlyphSlot,
  IconButton,
  INLINE_REF_LOOK,
  Inline,
  InlineRef,
  JUSTIFY,
  LAYOUT_ELEMENT,
  MESSAGE_LINE_ALIGN,
  MESSAGE_LINE_INSET,
  Menu,
  type MenuEntry,
  MessageActions,
  MessageFrame,
  MessageHead,
  MessageLine,
  MoreButton,
  NOTE_LINE_LOOK,
  NoteLine,
  STATUS_TONE,
  Stack,
  SUBJECT_FIT,
  SubjectLine,
  TEXT_AREA_LOOK,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  TextArea,
  Tooltip,
  useMenu,
  useSecond,
  WaitingLine,
  WorkingMark,
} from "@repo/ui";
import { GLYPH, ICON_SIZE, PlusIcon, Split } from "@repo/ui/icons";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import {
  AGENT,
  AGENT_STATE,
  type AgentState,
  type Ask,
  AUTHOR,
  CHAT_KIND,
  type ChatItem,
  type ChatKind,
  LIVE_STEPS,
  MEMBER,
  momentOf,
  NOW,
  STATE_WORDS,
  type ThreadId,
  type ThreadMessage,
} from "./data";

/** Which parts the prototype approximates from `@repo/ui`, where the panel draws its own. */
export const APPROXIMATIONS =
  "Approximations: the Inbox row's marks, the agent's model chip and its menu, a turn's steps, and the chat's bubbles are built from @repo/ui parts (ListRow, Chip, Menu, Disclosure, Card), not the panel's own components.";

/** How long each live step stands before the next, in seconds. */
const STEP_SECONDS = 3;

/** The id a fork of the whole agent is kept under, beside the messages forked from. */
export const AGENT_FORK = "agent";

/** The name of the agent a fork would start. */
const FORK_NAME = `${AGENT.name} (fork)`;

/** The agent's square face. */
export function AgentFace({
  size = AVATAR_SIZE.ROW,
}: {
  size?: (typeof AVATAR_SIZE)[keyof typeof AVATAR_SIZE];
}): React.JSX.Element {
  return (
    <Avatar
      name={AGENT.name}
      id={AGENT.id}
      size={size}
      shape={AVATAR_SHAPE.SQUARE}
      glyph={<GLYPH.AGENT />}
      tiled
      decorative
    />
  );
}

/** The agent's standing as a badge: its dot in the state's tone and its one word. */
export function StateBadge({ state }: { state: AgentState }): React.JSX.Element {
  const words = STATE_WORDS[state];
  return <Badge tone={words.tone}>{words.word}</Badge>;
}

/** The step the agent is on now, moving on every few seconds while it works. */
export function useLiveSteps(count: number): readonly string[] {
  const second = useSecond();
  const at = Math.floor(second / 1000 / STEP_SECONDS);
  return Array.from({ length: count }, (_, back) => {
    const index = (at - (count - 1 - back)) % LIVE_STEPS.length;
    return LIVE_STEPS[(index + LIVE_STEPS.length) % LIVE_STEPS.length] ?? "";
  });
}

/** The one line saying what the agent is on: a live step while it works, its activity otherwise. */
export function ActivityLine({ state }: { state: AgentState }): React.JSX.Element {
  const [step] = useLiveSteps(1);
  const words = STATE_WORDS[state];
  if (state !== AGENT_STATE.WORKING) {
    return (
      <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
        {words.activity}
      </Text>
    );
  }
  return (
    <Stack gap={GAP.NONE}>
      <Text variant={TEXT_VARIANT.CAPTION} truncate>
        {words.activity}
      </Text>
      <Inline gap={GAP.TIGHT} wrap={false}>
        <WorkingMark />
        <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED} truncate>
          {step}
        </Text>
      </Inline>
    </Stack>
  );
}

/**
 * A compact strip naming the agent: its face, name, standing and what it is
 * on now, and a press into its chat where the place has one to offer.
 */
export function AgentStatusStrip({
  state,
  onOpenChat,
}: {
  state: AgentState;
  onOpenChat?: (() => void) | undefined;
}): React.JSX.Element {
  return (
    <Card look={CARD_LOOK.WELL} padding={CARD_PADDING.COMPACT}>
      <Inline gap={GAP.CONTROL} wrap={false} align={ALIGN.START}>
        <AgentFace size={AVATAR_SIZE.CARD} />
        <div className="inbox-proto-grow">
          <Stack gap={GAP.TIGHT}>
            <Text variant={TEXT_VARIANT.LABEL} truncate>
              {AGENT.name}
            </Text>
            <div>
              <StateBadge state={state} />
            </div>
            <ActivityLine state={state} />
          </Stack>
        </div>
        {onOpenChat === undefined ? null : (
          <Button variant={BUTTON_VARIANT.OUTLINE} size={BUTTON_SIZE.COMPACT} onClick={onOpenChat}>
            Open chat
          </Button>
        )}
      </Inline>
    </Card>
  );
}

/** The menu a message offers, by its ⋯ or a long press: Fork first, as touch has no hover to find it. */
function messageMenu(
  onFork: () => void,
  onOpenChat: (() => void) | undefined,
): readonly (readonly MenuEntry[])[] {
  const ignore = () => undefined;
  const first: MenuEntry[] = [
    { label: "Fork to new agent", icon: <Split />, onSelect: onFork },
    { label: "Copy", icon: <CopyIcon />, onSelect: ignore },
  ];
  if (onOpenChat !== undefined)
    first.push({ label: "Show in chat", icon: <GLYPH.AGENT />, onSelect: onOpenChat });
  return [first];
}

/** What a fork from the agent's ⋯ or the composer says it started, under the head that offered it. */
export function ForkNotice({ forked }: { forked: ReadonlySet<string> }): React.JSX.Element | null {
  if (!forked.has(AGENT_FORK)) return null;
  return (
    <Banner look={BANNER_LOOK.STRIP} tone={STATUS_TONE.COMPLETE} glyph={<Split />}>
      {`Forked to ${FORK_NAME}, from the chat's newest message.`}
    </Banner>
  );
}

/** The line under a message forked from, as the panel's own says it. */
export function ForkedLine(): React.JSX.Element {
  return (
    <NoteLine look={NOTE_LINE_LOOK.TRAIL} glyph={<Split />}>
      Forked to {FORK_NAME}
    </NoteLine>
  );
}

/**
 * One message of a thread as a comment card, a document's rather than a
 * chat's: its writer, when, and a ⋯ whose menu a long press opens too.
 */
export function ThreadMessageCard({
  message,
  forked,
  onFork,
  onOpenChat,
}: {
  message: ThreadMessage;
  forked: boolean;
  onFork: () => void;
  onOpenChat?: (() => void) | undefined;
}): React.JSX.Element {
  const menu = useMenu(true);
  const agent = message.author === AUTHOR.AGENT;
  const author = agent
    ? { name: AGENT.name, id: AGENT.id, shape: AVATAR_SHAPE.SQUARE, glyph: <GLYPH.AGENT /> }
    : { name: MEMBER.name, id: MEMBER.id };
  return (
    <Card
      as={CARD_ELEMENT.LI}
      look={CARD_LOOK.SURFACE}
      padding={CARD_PADDING.COMPACT}
      {...menu.contextMenu()}
    >
      <Stack gap={GAP.TIGHT}>
        <Comment
          as={COMMENT_ELEMENT.DIV}
          author={author}
          at={message.at}
          now={NOW}
          trailing={<MoreButton thing="Message" size={BUTTON_SIZE.COMPACT} {...menu.trigger()} />}
        >
          {message.text}
        </Comment>
        {message.sentToChat === true ? <SentMark /> : null}
        {forked ? <ForkedLine /> : null}
      </Stack>
      {menu.drawn && (
        <Menu
          label="Message actions"
          menu={menu.drawn}
          groups={messageMenu(onFork, onOpenChat)}
          onClose={menu.close}
        />
      )}
    </Card>
  );
}

/** The mark under the member's own reply: it went to the agent's chat too. */
export function SentMark(): React.JSX.Element {
  return (
    <NoteLine look={NOTE_LINE_LOOK.TRAIL} glyph={<GLYPH.DONE />}>
      Sent to {AGENT.name}
    </NoteLine>
  );
}

/** The agent writing its answer, a beat after a reply. */
export function Answering(): React.JSX.Element {
  return <WaitingLine>{`${AGENT.name} is reading your reply…`}</WaitingLine>;
}

/**
 * The Decide ask as a block of its own: the question, each option a press
 * with its detail and the agent's recommendation, and once chosen, which.
 */
export function DecideBlock({
  ask,
  decided,
  onDecide,
}: {
  ask: Ask;
  decided: string | undefined;
  onDecide: (label: string) => void;
}): React.JSX.Element {
  return (
    <Card
      look={decided === undefined ? CARD_LOOK.TINT : CARD_LOOK.OUTLINE}
      padding={CARD_PADDING.REGULAR}
    >
      <Stack gap={GAP.CONTROL}>
        <Inline gap={GAP.TIGHT} justify={JUSTIFY.BETWEEN}>
          <Inline gap={GAP.TIGHT}>
            <GlyphSlot size={ICON_SIZE.MEDIUM}>
              <GLYPH.DECIDE />
            </GlyphSlot>
            <Text variant={TEXT_VARIANT.GROUP} as={TEXT_ELEMENT.SPAN}>
              Decide
            </Text>
          </Inline>
          {decided === undefined ? (
            <Badge tone={STATUS_TONE.ATTENTION}>Needs you</Badge>
          ) : (
            <Badge tone={STATUS_TONE.COMPLETE}>Answered</Badge>
          )}
        </Inline>
        <Text variant={TEXT_VARIANT.LABEL}>{ask.question}</Text>
        <Stack gap={GAP.TIGHT}>
          {ask.options.map((option) => (
            <Stack key={option.label} gap={GAP.NONE}>
              <Inline>
                <Button
                  variant={BUTTON_VARIANT.OUTLINE}
                  size={BUTTON_SIZE.COMPACT}
                  pressed={decided === option.label}
                  readOnly={decided !== undefined}
                  badge={option.label === ask.recommended ? "Recommended" : undefined}
                  onClick={() => onDecide(option.label)}
                >
                  {option.label}
                </Button>
              </Inline>
              <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
                {option.detail}
              </Text>
            </Stack>
          ))}
        </Stack>
      </Stack>
    </Card>
  );
}

/** A sheet risen from the foot of the frame's screen over a scrim, its title and Done over what it holds: a phone's peek or Highlights. */
export function FrameSheet({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <div className="inbox-proto-sheet" data-open={open ? "true" : "false"} inert={!open}>
      <div className="inbox-proto-scrim" />
      <div className="inbox-proto-sheet-card">
        <Card look={CARD_LOOK.RAISED} padding={CARD_PADDING.REGULAR} shadow={CARD_SHADOW.MENU}>
          <Stack gap={GAP.FIELD}>
            <Inline justify={JUSTIFY.BETWEEN} wrap={false}>
              <Text variant={TEXT_VARIANT.LABEL}>{title}</Text>
              <Button variant={BUTTON_VARIANT.QUIET} onClick={onClose}>
                Done
              </Button>
            </Inline>
            {children}
          </Stack>
        </Card>
      </div>
    </div>
  );
}

/** The model chip of the agent's composer, and its menu: approximated from `Chip` and `Menu`. */
export function ModelChip(): React.JSX.Element {
  const menu = useMenu(true);
  const [model, setModel] = useState<string>(AGENT.model);
  const models = ["Opus 5.5", "Sonnet 5.5", "GPT-5.5"] as const;
  return (
    <>
      <Tooltip label="Model">
        <Chip look={CHIP_LOOK.TOOLBAR} chevron {...menu.trigger()}>
          {model} High
        </Chip>
      </Tooltip>
      {menu.drawn && (
        <Menu
          label="Model"
          menu={menu.drawn}
          groups={[
            models.map((label) => ({
              label,
              checked: label === model,
              onSelect: () => setModel(label),
            })),
          ]}
          onClose={menu.close}
        />
      )}
    </>
  );
}

/** The agent's ⋯: Fork to new agent first, then the rest of its menu. */
export function AgentMenu({
  state,
  onFork,
  onHighlights,
}: {
  state: AgentState;
  onFork: () => void;
  /** Opens design E's Highlights, which a phone's head reaches through this menu. */
  onHighlights?: (() => void) | undefined;
}): React.JSX.Element {
  const menu = useMenu(true);
  const ignore = () => undefined;
  const archived = state === AGENT_STATE.ARCHIVED;
  return (
    <>
      <MoreButton thing="Agent" {...menu.trigger()} />
      {menu.drawn && (
        <Menu
          label="Agent actions"
          menu={menu.drawn}
          groups={[
            ...(onHighlights === undefined
              ? []
              : [[{ label: "Highlights", icon: <GLYPH.PIN />, onSelect: onHighlights }]]),
            [
              { label: "Fork to new agent", icon: <Split />, onSelect: onFork },
              { label: "Copy link", icon: <CopyIcon />, onSelect: ignore },
            ],
            [
              {
                label: archived ? "Unarchive" : "Archive",
                icon: archived ? <GLYPH.UNARCHIVE /> : <GLYPH.ARCHIVE />,
                onSelect: ignore,
              },
            ],
          ]}
          onClose={menu.close}
        />
      )}
    </>
  );
}

/** A quiet caption led by its glyph, wrapping under its words rather than under the glyph. */
export function GlyphLine({
  glyph,
  children,
}: {
  glyph: ReactNode;
  children: string;
}): React.JSX.Element {
  return (
    <Inline gap={GAP.TIGHT} wrap={false} align={ALIGN.START}>
      <GlyphSlot size={ICON_SIZE.SMALL}>{glyph}</GlyphSlot>
      <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
        {children}
      </Text>
    </Inline>
  );
}

/** The line near the reply box saying what replying will do in the agent's state. */
export function ReplyNote({ state }: { state: AgentState }): React.JSX.Element {
  const glyph =
    state === AGENT_STATE.ARCHIVED ? (
      <GLYPH.UNARCHIVE />
    ) : state === AGENT_STATE.WORKING ? (
      <GLYPH.STEER />
    ) : (
      <GLYPH.TIME />
    );
  return <GlyphLine glyph={glyph}>{STATE_WORDS[state].replyNote}</GlyphLine>;
}

/** How a reply box looks: the thread's own, plain, or the agent's full composer, with its model chip, + and Fork. */
export const REPLY_LOOK = {
  THREAD: "thread",
  AGENT: "agent",
} as const;

export type ReplyLook = (typeof REPLY_LOOK)[keyof typeof REPLY_LOOK];

/**
 * The reply box: its label over it, the field and its foot, and what stands
 * under it. A working agent's send steers it, as the panel's does, and a
 * touch held on it queues instead.
 */
export function ReplyBox({
  look,
  label,
  placeholder,
  state,
  under,
  over,
  sendsEmpty = false,
  onSend,
  onFork,
}: {
  look: ReplyLook;
  label: ReactNode;
  placeholder: string;
  state: AgentState;
  under?: ReactNode;
  /** What stands over the field inside the box: design E's Needs you or Done card. */
  over?: ReactNode;
  /** Whether Send takes an empty box, as one carrying picks from a card above it does. */
  sendsEmpty?: boolean;
  onSend: (text: string) => void;
  onFork?: (() => void) | undefined;
}): React.JSX.Element {
  const [text, setText] = useState("");
  const working = state === AGENT_STATE.WORKING;
  const send = () => {
    const words = text.trim();
    if (words === "" && !sendsEmpty) return;
    onSend(words);
    setText("");
  };
  const ignore = () => undefined;
  const tools =
    look === REPLY_LOOK.AGENT ? (
      <>
        <Tooltip label="Add files and more">
          <IconButton label="Add files and more" icon={<PlusIcon />} onClick={ignore} />
        </Tooltip>
        {onFork === undefined ? null : (
          <Tooltip label="Fork to new agent">
            <IconButton label="Fork to new agent" icon={<Split />} onClick={onFork} />
          </Tooltip>
        )}
      </>
    ) : undefined;
  return (
    <Stack gap={GAP.TIGHT}>
      {label}
      {over}
      <ComposerFrame
        as={COMPOSER_ELEMENT.FORM}
        look={COMPOSER_LOOK.CARD}
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <ComposerBody>
          <TextArea
            label={placeholder}
            placeholder={placeholder}
            look={TEXT_AREA_LOOK.BARE}
            rows={1}
            grow
            value={text}
            onChange={setText}
            onSubmit={send}
          />
        </ComposerBody>
        <ComposerFoot
          tools={tools}
          actions={look === REPLY_LOOK.AGENT ? <ModelChip /> : undefined}
          send={
            working
              ? {
                  label: "Steer",
                  icon: <GLYPH.STEER />,
                  empty: text.trim() === "" && !sendsEmpty,
                  onHold: send,
                }
              : { label: "Reply", empty: text.trim() === "" && !sendsEmpty }
          }
        />
      </ComposerFrame>
      {under}
    </Stack>
  );
}

/** A received line's sender: a face and a name. */
function Sender({
  name,
  id,
  agent,
}: {
  name: string;
  id: string;
  agent: boolean;
}): React.JSX.Element {
  return (
    <InlineRef
      look={INLINE_REF_LOOK.WASH}
      glyph={
        <Avatar
          name={name}
          id={id}
          size={AVATAR_SIZE.INLINE}
          shape={agent ? AVATAR_SHAPE.SQUARE : AVATAR_SHAPE.CIRCLE}
          glyph={agent ? <GLYPH.AGENT /> : undefined}
          decorative
        />
      }
      label={name}
      onPress={() => undefined}
    />
  );
}

/** A turn's actions: Copy, and Fork, which the ⋯ and a long press offer too. */
function TurnActions({ onFork }: { onFork: () => void }): React.JSX.Element {
  return (
    <MessageActions>
      <IconButton
        icon={<CopyIcon />}
        label="Copy"
        size={BUTTON_SIZE.COMPACT}
        onClick={() => undefined}
      />
      <Tooltip label="Fork to new agent">
        <IconButton
          icon={<Split />}
          label="Fork to new agent"
          size={BUTTON_SIZE.COMPACT}
          onClick={onFork}
        />
      </Tooltip>
    </MessageActions>
  );
}

/** The lines the member sent, which stand at the chat's end side. */
const SENT_KINDS: ReadonlySet<ChatKind> = new Set([
  CHAT_KIND.MEMBER,
  CHAT_KIND.TOPIC,
  CHAT_KIND.THREAD_REPLY,
]);

/** One line of the chat, its menu on a long press. */
function ChatLine({
  item,
  forked,
  onFork,
  onOpenThread,
  threadTitle,
}: {
  item: ChatItem;
  forked: boolean;
  onFork: () => void;
  onOpenThread: ((id: ThreadId) => void) | undefined;
  threadTitle: (id: ThreadId) => string;
}): React.JSX.Element {
  const menu = useMenu(true);
  const drawn = menu.drawn && (
    <Menu
      label="Message actions"
      menu={menu.drawn}
      groups={messageMenu(onFork, undefined)}
      onClose={menu.close}
    />
  );
  const fork = forked ? <ForkedLine /> : null;
  const threadRef =
    item.thread === undefined ? null : (
      <InlineRef
        look={INLINE_REF_LOOK.PILL}
        glyph={<GLYPH.THREAD />}
        label={threadTitle(item.thread)}
        onPress={() => (item.thread === undefined ? undefined : onOpenThread?.(item.thread))}
      />
    );
  switch (item.kind) {
    case CHAT_KIND.MEMBER:
    case CHAT_KIND.TOPIC:
    case CHAT_KIND.THREAD_REPLY:
      return (
        <>
          <MessageFrame revealActionsOnTap {...menu.contextMenu()}>
            {item.kind === CHAT_KIND.THREAD_REPLY ? (
              <div className="inbox-proto-end">
                <SubjectLine lead="Replied on" fit={SUBJECT_FIT.OWN}>
                  {threadRef}
                </SubjectLine>
              </div>
            ) : null}
            <div className="inbox-proto-bubble">
              <Card look={CARD_LOOK.WELL} padding={CARD_PADDING.COMPACT}>
                <Text>{item.text}</Text>
              </Card>
            </div>
            <MessageLine at={item.at} actions={<TurnActions onFork={onFork} />} />
            {fork}
          </MessageFrame>
          {drawn}
        </>
      );
    case CHAT_KIND.TEAMMATE:
    case CHAT_KIND.OTHER_AGENT: {
      const agent = item.kind === CHAT_KIND.OTHER_AGENT;
      const name = item.from ?? "";
      return (
        <>
          <MessageFrame revealActionsOnTap {...menu.contextMenu()}>
            <MessageHead sender={<Sender name={name} id={name} agent={agent} />}>
              {agent ? <SubjectLine lead="sent a message" fit={SUBJECT_FIT.OWN} /> : null}
            </MessageHead>
            <div className="inbox-proto-bubble" data-side="start">
              <Card look={CARD_LOOK.OUTLINE} padding={CARD_PADDING.COMPACT}>
                <Text>{item.text}</Text>
              </Card>
            </div>
            <MessageLine
              align={MESSAGE_LINE_ALIGN.START}
              at={item.at}
              actions={<TurnActions onFork={onFork} />}
            />
            {fork}
          </MessageFrame>
          {drawn}
        </>
      );
    }
    case CHAT_KIND.GITHUB:
      return (
        <NoteLine look={NOTE_LINE_LOOK.TRAIL} glyph={<GLYPH.PULL_REQUEST />}>
          {`GitHub · ${item.from ?? ""}: ${item.text}`}
        </NoteLine>
      );
    case CHAT_KIND.THREAD_CARD:
      return (
        <Card look={CARD_LOOK.OUTLINE} padding={CARD_PADDING.COMPACT}>
          <Inline gap={GAP.CONTROL} justify={JUSTIFY.BETWEEN}>
            <Inline gap={GAP.TIGHT} wrap={false}>
              <GlyphSlot size={ICON_SIZE.MEDIUM}>
                <GLYPH.THREAD />
              </GlyphSlot>
              <Stack gap={GAP.NONE}>
                <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
                  {`Opened a thread · ${momentOf(item.at)}`}
                </Text>
                <Text variant={TEXT_VARIANT.LABEL}>{item.text}</Text>
              </Stack>
            </Inline>
            {onOpenThread === undefined || item.thread === undefined ? null : (
              <Button
                variant={BUTTON_VARIANT.OUTLINE}
                size={BUTTON_SIZE.COMPACT}
                onClick={() => (item.thread === undefined ? undefined : onOpenThread(item.thread))}
              >
                Open thread
              </Button>
            )}
          </Inline>
        </Card>
      );
    case CHAT_KIND.TURN:
      return (
        <>
          <MessageFrame revealActionsOnTap {...menu.contextMenu()}>
            {item.thread === undefined ? null : (
              <MessageHead sender={<Sender name={AGENT.name} id={AGENT.id} agent />}>
                <SubjectLine lead="answered on" fit={SUBJECT_FIT.OWN}>
                  {threadRef}
                </SubjectLine>
              </MessageHead>
            )}
            <Stack gap={GAP.TIGHT}>
              {item.steps === undefined ? null : <Steps steps={item.steps} />}
              <Text>{item.text}</Text>
            </Stack>
            <MessageLine
              align={MESSAGE_LINE_ALIGN.START}
              inset={MESSAGE_LINE_INSET.FLUSH}
              at={item.at}
              actions={<TurnActions onFork={onFork} />}
            />
            {fork}
          </MessageFrame>
          {drawn}
        </>
      );
  }
}

/** A turn's steps, folded under their count. */
function Steps({ steps }: { steps: readonly string[] }): React.JSX.Element {
  return (
    <Disclosure>
      <DisclosureSummary>
        <span>{`${steps.length} steps`}</span>
      </DisclosureSummary>
      <DisclosureBody>
        <Stack gap={GAP.NONE} as={LAYOUT_ELEMENT.UL}>
          {steps.map((step) => (
            <li key={step}>
              <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
                {step}
              </Text>
            </li>
          ))}
        </Stack>
      </DisclosureBody>
    </Disclosure>
  );
}

/** The run under way at the chat's foot while the agent works: what it is on and its last steps, live. */
export function LiveRun({ count = 3 }: { count?: number }): React.JSX.Element {
  const steps = useLiveSteps(count);
  return (
    <Stack gap={GAP.TIGHT}>
      <Inline gap={GAP.TIGHT} wrap={false}>
        <WorkingMark />
        <Text variant={TEXT_VARIANT.LABEL}>{STATE_WORDS[AGENT_STATE.WORKING].activity}</Text>
      </Inline>
      <Stack gap={GAP.NONE} as={LAYOUT_ELEMENT.UL}>
        {steps.map((step, index) => (
          <li key={`${index}-${step}`}>
            <Text
              variant={TEXT_VARIANT.CAPTION}
              tone={index === steps.length - 1 ? TEXT_TONE.DEFAULT : TEXT_TONE.MUTED}
            >
              {step}
            </Text>
          </li>
        ))}
      </Stack>
    </Stack>
  );
}

/**
 * The agent's chat, oldest first, opened at its newest line, or at the
 * line `scrollTo` names. A working agent's run stands live at its foot.
 */
export function ChatTranscript({
  items,
  state,
  forked,
  highlight,
  scrollTo,
  onFork,
  onOpenThread,
  threadTitle,
}: {
  items: readonly ChatItem[];
  state: AgentState;
  forked: ReadonlySet<string>;
  highlight?: ThreadId | undefined;
  scrollTo?: string | undefined;
  onFork: (id: string) => void;
  onOpenThread?: ((id: ThreadId) => void) | undefined;
  threadTitle: (id: ThreadId) => string;
}): React.JSX.Element {
  const list = useRef<HTMLUListElement>(null);
  const count = items.length;
  // Note that the chat opens at its newest line, or the one asked for, never at some point in between.
  useLayoutEffect(() => {
    const element = list.current;
    if (element === null || count < 0) return;
    const target =
      scrollTo === undefined ? null : element.querySelector(`[data-line="${scrollTo}"]`);
    if (target instanceof HTMLElement) target.scrollIntoView({ block: "center" });
    else element.lastElementChild?.scrollIntoView({ block: "end" });
  }, [scrollTo, count]);
  return (
    <ul className="inbox-proto-chat" ref={list}>
      {items.map((item) => (
        <li
          key={item.id}
          className="inbox-proto-line"
          data-line={item.id}
          data-side={SENT_KINDS.has(item.kind) ? "end" : undefined}
          data-highlight={highlight !== undefined && item.thread === highlight ? "" : undefined}
        >
          <ChatLine
            item={item}
            forked={forked.has(item.id)}
            onFork={() => onFork(item.id)}
            onOpenThread={onOpenThread}
            threadTitle={threadTitle}
          />
        </li>
      ))}
      {state === AGENT_STATE.WORKING ? (
        <li className="inbox-proto-line">
          <LiveRun />
        </li>
      ) : null}
    </ul>
  );
}

/** The foot of the agent's chat: its full composer, or the archived note in its place. */
export function ChatComposer({
  state,
  onSend,
  onFork,
}: {
  state: AgentState;
  onSend: (text: string) => void;
  onFork: () => void;
}): React.JSX.Element {
  return (
    <ReplyBox
      look={REPLY_LOOK.AGENT}
      label={null}
      placeholder="Send a follow-up"
      state={state}
      onSend={onSend}
      onFork={onFork}
      under={
        state === AGENT_STATE.WORKING || state === AGENT_STATE.WAITING ? null : (
          <ReplyNote state={state} />
        )
      }
    />
  );
}
