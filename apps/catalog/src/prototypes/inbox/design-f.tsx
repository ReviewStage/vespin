/**
 * design-f.tsx -- F · Slack-style threads inside the agent's chat, on E's
 * sidebar. The sidebar groups agents as Needs you, Done, Running, Scheduled
 * and Archived, an agent's open asks listed under it. In the chat each ask
 * is a compact anchor where it was posted, and answers on a thread show only
 * as a quiet line. Opening a thread drills into the chat column, the
 * agent's head staying over it and the right panel keeping the PR and any
 * page; the variant opens it inline instead, in place in the chat. A small
 * bar over the composer says what needs you, and Threads (n) in the head
 * finds any thread again.
 */

import {
  ALIGN,
  BACK_BUTTON_LOOK,
  BackButton,
  Badge,
  BUTTON_SIZE,
  BUTTON_VARIANT,
  Button,
  CARD_LOOK,
  CARD_PADDING,
  Card,
  CHOICE_BAR_LOOK,
  CHOICE_BAR_SIZE,
  ChoiceBar,
  GAP,
  GlyphSlot,
  GROUP_LOOK,
  GroupHeader,
  IconButton,
  INLINE_REF_LOOK,
  Inline,
  InlineRef,
  JUSTIFY,
  LAYOUT_ELEMENT,
  LIST_ROW_META,
  List,
  ListRow,
  Menu,
  type MenuEntry,
  NO_BACK_KEY,
  STATUS_TONE,
  Stack,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  TOOLBAR_LOOK,
  Toolbar,
  Tooltip,
  useMenu,
  useSecond,
} from "@repo/ui";
import { GLYPH, ICON_SIZE, Play, Split } from "@repo/ui/icons";
import { type ReactNode, useState } from "react";
import {
  AGENT,
  AGENT_STATE,
  type AgentState,
  AUTHOR,
  ageOf,
  CHAT_KIND,
  type ChatItem,
  LIST_SECTION,
  type ListedAgent,
  momentOf,
  NOW,
  OTHER_AGENTS,
  ROW_MARK,
  timeIn,
} from "./data";
import {
  BLOCK,
  type Block,
  F_THREAD_ANSWER,
  F_THREADS,
  type FReply,
  type FThread,
  type FThreadId,
  fDecidedAnswer,
  PAGE_TITLE,
  PR_TITLE,
} from "./data-f";
import type { DesignProps } from "./design-a";
import { AgentRow } from "./design-e";
import { FRAME, type Frame, FrameLayout } from "./inbox-list";
import {
  ActivityLine,
  AGENT_FORK,
  AgentFace,
  AgentMenu,
  Answering,
  ChatComposer,
  ChatTranscript,
  ForkedLine,
  ForkNotice,
  FrameSheet,
  REPLY_LOOK,
  ReplyBox,
  ReplyNote,
  StateBadge,
  ThreadMessageCard,
} from "./parts";
import { useWorld } from "./world";

/** How long the agent takes to answer on a thread, in real milliseconds. */
const ANSWER_DELAY_MS = 2200;

/** When the page loaded, so a new reply's time counts on from the prototype's "now". */
const LOADED = Date.now();

/** F's sidebar sections, in the order they stand. */
const F_SECTION = {
  NEEDS_YOU: "Needs you",
  DONE: "Done",
  RUNNING: "Running",
  SCHEDULED: "Scheduled",
  ARCHIVED: "Archived",
} as const;

type FSection = (typeof F_SECTION)[keyof typeof F_SECTION];

/** Whether a section starts open. */
const F_SECTIONS: readonly { readonly section: FSection; readonly open: boolean }[] = [
  { section: F_SECTION.NEEDS_YOU, open: true },
  { section: F_SECTION.DONE, open: true },
  { section: F_SECTION.RUNNING, open: true },
  { section: F_SECTION.SCHEDULED, open: true },
  { section: F_SECTION.ARCHIVED, open: false },
];

/** What the right panel shows: the PR, or the page a thread posted. */
const SIDE_TAB = {
  PR: "pr",
  PAGE: "page",
} as const;

type SideTab = (typeof SIDE_TAB)[keyof typeof SIDE_TAB];

/** A synthetic screenshot of today's picker, drawn in place so the prototype loads nothing. */
const SCREENSHOT = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180"><rect width="320" height="180" rx="10" fill="#1d1d21"/><rect x="16" y="16" width="120" height="12" rx="6" fill="#55555f"/><g fill="#2c2c33"><rect x="16" y="44" width="288" height="36" rx="8"/><rect x="16" y="88" width="288" height="36" rx="8"/><rect x="16" y="132" width="288" height="36" rx="8"/></g><g fill="#8a8a96"><rect x="28" y="56" width="90" height="10" rx="5"/><rect x="28" y="100" width="70" height="10" rx="5"/><rect x="28" y="144" width="110" height="10" rx="5"/></g></svg>',
)}`;

const MACHINES = [
  { name: "smolvm · Ubuntu 24.04", size: "2 vCPU · 4 GB RAM · 20 GB disk" },
  { name: "smolvm · Alpine 3.21", size: "1 vCPU · 1 GB RAM · 4 GB disk" },
  { name: "Vercel Sandbox", size: "4 vCPU · 8 GB RAM · 32 GB disk" },
] as const;

interface FAdded {
  readonly id: string;
  readonly thread: FThreadId;
  readonly author: typeof AUTHOR.AGENT | typeof AUTHOR.MEMBER;
  readonly text: string;
  readonly showAt: number;
}

/** The threads as they stand now: their replies in `state`'s times, the member's own after them, and what was chosen. */
function useThreads(state: AgentState) {
  const second = useSecond();
  const [added, setAdded] = useState<readonly FAdded[]>([]);
  const [choices, setChoices] = useState<ReadonlyMap<FThreadId, string>>(new Map());
  const shown = added.filter((each) => each.showAt <= second);
  const send = (thread: FThreadId, text: string, answer: string) => {
    const at = Date.now();
    setAdded((was) => [
      ...was,
      { id: `f-sent-${at}`, thread, author: AUTHOR.MEMBER, text, showAt: at },
      {
        id: `f-answer-${at}`,
        thread,
        author: AUTHOR.AGENT,
        text: answer,
        showAt: at + ANSWER_DELAY_MS,
      },
    ]);
  };
  const threads: FThread[] = F_THREADS.map((base) => ({
    ...base,
    postedAt: timeIn(state, base.postedAt),
    answered: choices.get(base.id) ?? base.answered,
    replies: [
      ...base.replies.map((reply) => ({ ...reply, at: timeIn(state, reply.at) })),
      ...shown
        .filter((each) => each.thread === base.id)
        .map(
          (each): FReply => ({
            id: each.id,
            author: each.author,
            text: each.text,
            at: prototypeTime(each.showAt),
          }),
        ),
    ],
  }));
  return {
    threads,
    answering: (id: FThreadId) =>
      added.some(
        (each) => each.thread === id && each.author === AUTHOR.AGENT && each.showAt > second,
      ),
    reply: (id: FThreadId, text: string) => send(id, text, F_THREAD_ANSWER),
    decide: (id: FThreadId, label: string) => {
      setChoices((was) => new Map(was).set(id, label));
      send(id, `Chose “${label}”.`, fDecidedAnswer(label));
    },
  };
}

/** The prototype's time for a real one: its "now", moved on by what has passed since the page loaded. */
function prototypeTime(real: number): number {
  return NOW + (real - LOADED);
}

/** Whether a thread asks something still unanswered. */
function isOpen(thread: FThread): boolean {
  return thread.options.length > 0 && thread.answered === undefined;
}

/** What a thread's badge says: it needs you, what was answered, or that it only tells. */
function ThreadBadge({ thread }: { thread: FThread }): React.JSX.Element {
  if (isOpen(thread)) return <Badge tone={STATUS_TONE.ATTENTION}>Needs you</Badge>;
  if (thread.answered !== undefined)
    return <Badge tone={STATUS_TONE.COMPLETE}>{`Answered · ${thread.answered}`}</Badge>;
  return <Badge>FYI</Badge>;
}

/** "3 replies · 2h ago", or the way in to a thread with none yet. */
function repliesWords(thread: FThread): string {
  const last = thread.replies.at(-1);
  if (last === undefined) return "Reply in thread";
  const count = thread.replies.length;
  return `${count} ${count === 1 ? "reply" : "replies"} · ${ageOf(last.at)}`;
}

/** The two layouts the long ask's page compares, drawn from `@repo/ui`'s cards and rows. */
function PickerMockup(): React.JSX.Element {
  return (
    <Stack gap={GAP.FIELD}>
      <Stack gap={GAP.TIGHT}>
        <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
          A · Grid of machines
        </Text>
        <Inline gap={GAP.TIGHT}>
          {MACHINES.map((machine) => (
            <Card key={machine.name} look={CARD_LOOK.OUTLINE} padding={CARD_PADDING.COMPACT}>
              <Text variant={TEXT_VARIANT.CAPTION}>{machine.name}</Text>
            </Card>
          ))}
        </Inline>
      </Stack>
      <Stack gap={GAP.TIGHT}>
        <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
          B · List with sizes
        </Text>
        <List label="Machines">
          {MACHINES.map((machine) => (
            <ListRow
              key={machine.name}
              leading={<GLYPH.CLOUD />}
              title={machine.name}
              description={machine.size}
              more={false}
            />
          ))}
        </List>
      </Stack>
    </Stack>
  );
}

/** The PR as the right panel's PR tab shows it. */
function PrPane(): React.JSX.Element {
  return (
    <Stack gap={GAP.CONTROL}>
      <Text variant={TEXT_VARIANT.LABEL}>{PR_TITLE}</Text>
      <Inline gap={GAP.TIGHT}>
        <Badge tone={STATUS_TONE.COMPLETE}>Checks passing</Badge>
        <Badge tone={STATUS_TONE.ATTENTION}>Review required</Badge>
      </Inline>
      <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
        smolvm-picker → main · 6 files changed
      </Text>
      <Stack as={LAYOUT_ELEMENT.UL} gap={GAP.NONE}>
        {[
          "packages/panel/src/sandbox/picker.tsx",
          "packages/ui/src/components/machine-row/machine-row.tsx",
          "packages/service/src/sandbox/providers.ts",
        ].map((file) => (
          <li key={file}>
            <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
              {file}
            </Text>
          </li>
        ))}
      </Stack>
      <Inline>
        <Button
          variant={BUTTON_VARIANT.OUTLINE}
          size={BUTTON_SIZE.COMPACT}
          icon={<GLYPH.OPEN_ON_GITHUB />}
          onClick={() => undefined}
        >
          Open on GitHub
        </Button>
      </Inline>
    </Stack>
  );
}

/** The page the long ask posted, as the right panel's Page tab shows it. */
function PagePane(): React.JSX.Element {
  return (
    <Stack gap={GAP.CONTROL}>
      <Text variant={TEXT_VARIANT.LABEL}>{PAGE_TITLE}</Text>
      <PickerMockup />
    </Stack>
  );
}

/** The right panel on a desktop: the PR tab and the page, which a thread opens without taking the panel over. */
function SidePanel({
  tab,
  onTab,
}: {
  tab: SideTab;
  onTab: (tab: SideTab) => void;
}): React.JSX.Element {
  return (
    <aside className="inbox-proto-side" data-wide="" aria-label="Pull request and pages">
      <Stack gap={GAP.FIELD}>
        <ChoiceBar<SideTab>
          label="Right panel"
          look={CHOICE_BAR_LOOK.SEGMENTED}
          size={CHOICE_BAR_SIZE.COMPACT}
          items={[
            { value: SIDE_TAB.PR, label: "PR #7887" },
            { value: SIDE_TAB.PAGE, label: "Page" },
          ]}
          value={tab}
          onChange={onTab}
        />
        {tab === SIDE_TAB.PR ? <PrPane /> : <PagePane />}
      </Stack>
    </aside>
  );
}

/** One part of a thread's opening post: words, an inline page, a screenshot, a clip, or a PR. */
function BlockView({
  block,
  onRef,
}: {
  block: Block;
  onRef: (tab: SideTab) => void;
}): React.JSX.Element {
  switch (block.kind) {
    case BLOCK.TEXT:
      return <Text>{block.text}</Text>;
    case BLOCK.PAGE:
      return (
        <Card look={CARD_LOOK.WELL} padding={CARD_PADDING.COMPACT}>
          <Stack gap={GAP.CONTROL}>
            <Inline justify={JUSTIFY.BETWEEN} wrap={false}>
              <Inline gap={GAP.TIGHT} wrap={false}>
                <GlyphSlot size={ICON_SIZE.MEDIUM}>
                  <GLYPH.PAGE />
                </GlyphSlot>
                <Text variant={TEXT_VARIANT.LABEL} as={TEXT_ELEMENT.SPAN}>
                  {block.title}
                </Text>
              </Inline>
              <Button
                variant={BUTTON_VARIANT.OUTLINE}
                size={BUTTON_SIZE.COMPACT}
                onClick={() => onRef(SIDE_TAB.PAGE)}
              >
                Open page
              </Button>
            </Inline>
            <PickerMockup />
          </Stack>
        </Card>
      );
    case BLOCK.SCREENSHOT:
      return (
        <Stack gap={GAP.TIGHT}>
          <img className="inbox-proto-shot" src={SCREENSHOT} alt={block.caption} />
          <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
            {block.caption}
          </Text>
        </Stack>
      );
    case BLOCK.VIDEO:
      return (
        <Card look={CARD_LOOK.WELL} padding={CARD_PADDING.COMPACT}>
          <Inline gap={GAP.CONTROL} wrap={false}>
            <GlyphSlot size={ICON_SIZE.LARGE}>
              <Play />
            </GlyphSlot>
            <Stack gap={GAP.NONE}>
              <Text variant={TEXT_VARIANT.LABEL}>{block.name}</Text>
              <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
                {`${block.length} · video placeholder`}
              </Text>
            </Stack>
          </Inline>
        </Card>
      );
    case BLOCK.PR:
      return (
        <div>
          <InlineRef
            look={INLINE_REF_LOOK.PILL}
            glyph={<GLYPH.PULL_REQUEST />}
            label={block.title}
            onPress={() => onRef(SIDE_TAB.PR)}
          />
        </div>
      );
  }
}

/** A thread's answers as presses, the one chosen pressed, read-only once chosen or while the agent is archived. */
function Options({
  thread,
  readOnly,
  onDecide,
}: {
  thread: FThread;
  readOnly: boolean;
  onDecide: (label: string) => void;
}): React.JSX.Element | null {
  if (thread.options.length === 0) return null;
  return (
    <Inline gap={GAP.TIGHT}>
      {thread.options.map((option) => (
        <Button
          key={option}
          variant={BUTTON_VARIANT.OUTLINE}
          size={BUTTON_SIZE.COMPACT}
          pressed={thread.answered === option}
          readOnly={readOnly || thread.answered !== undefined}
          badge={
            option === thread.recommended && thread.answered === undefined
              ? "Recommended"
              : undefined
          }
          onClick={() => onDecide(option)}
        >
          {option}
        </Button>
      ))}
    </Inline>
  );
}

/** A thread whole: its post, its answers, then only this topic's replies. */
function ThreadBody({
  thread,
  heading,
  readOnly,
  answering,
  forked,
  onDecide,
  onRef,
  onFork,
}: {
  thread: FThread;
  heading: boolean;
  readOnly: boolean;
  answering: boolean;
  forked: ReadonlySet<string>;
  onDecide: (label: string) => void;
  onRef: (tab: SideTab) => void;
  onFork: (id: string) => void;
}): React.JSX.Element {
  return (
    <Stack gap={GAP.FIELD}>
      {heading ? (
        <Stack gap={GAP.TIGHT}>
          <Inline justify={JUSTIFY.BETWEEN}>
            <Text variant={TEXT_VARIANT.DIALOG} as={TEXT_ELEMENT.H2}>
              {thread.title}
            </Text>
            <ThreadBadge thread={thread} />
          </Inline>
          <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
            {`Posted by ${AGENT.name} · ${momentOf(thread.postedAt)}`}
          </Text>
        </Stack>
      ) : null}
      {thread.body.map((block, index) => (
        <BlockView key={`${thread.id}-${index}`} block={block} onRef={onRef} />
      ))}
      <Options thread={thread} readOnly={readOnly} onDecide={onDecide} />
      {thread.replies.length === 0 ? null : (
        <Stack gap={GAP.TIGHT}>
          <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
            {`${thread.replies.length} ${thread.replies.length === 1 ? "reply" : "replies"}`}
          </Text>
          <Stack as={LAYOUT_ELEMENT.UL} gap={GAP.TIGHT}>
            {thread.replies.map((reply) => (
              <ThreadMessageCard
                key={reply.id}
                message={{ ...reply, sentToChat: false }}
                forked={forked.has(reply.id)}
                onFork={() => onFork(reply.id)}
              />
            ))}
          </Stack>
        </Stack>
      )}
      {answering ? <Answering /> : null}
    </Stack>
  );
}

/** The box a thread is answered in, saying the agent sees it. */
function ThreadReply({
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
      label={
        <Text variant={TEXT_VARIANT.LABEL} as={TEXT_ELEMENT.SPAN}>
          {`Reply in thread · ${AGENT.name} sees it`}
        </Text>
      }
      placeholder="Reply in thread"
      state={state}
      onSend={onSend}
      onFork={onFork}
      under={state === AGENT_STATE.WAITING ? null : <ReplyNote state={state} />}
    />
  );
}

/**
 * An ask where it was posted in the chat: its title, a one-line gist, its
 * answers, and how many replies, which open the thread; inline, the thread
 * opens in the anchor itself. A long press offers Fork, as any line does.
 */
function Anchor({
  thread,
  inline,
  expanded,
  readOnly,
  forked,
  onOpen,
  onDecide,
  onFork,
  children,
}: {
  thread: FThread;
  inline: boolean;
  expanded: boolean;
  readOnly: boolean;
  forked: boolean;
  onOpen: () => void;
  onDecide: (label: string) => void;
  onFork: () => void;
  /** The thread itself and its box, where it opens inline. */
  children?: ReactNode;
}): React.JSX.Element {
  const menu = useMenu(true);
  return (
    <Card look={CARD_LOOK.OUTLINE} padding={CARD_PADDING.COMPACT} {...menu.contextMenu()}>
      <Stack gap={GAP.TIGHT}>
        <Inline justify={JUSTIFY.BETWEEN} wrap={false} align={ALIGN.START}>
          <Inline gap={GAP.TIGHT} wrap={false}>
            <GlyphSlot size={ICON_SIZE.MEDIUM}>
              {thread.options.length > 0 ? <GLYPH.DECIDE /> : <GLYPH.THREAD />}
            </GlyphSlot>
            <Text variant={TEXT_VARIANT.LABEL} as={TEXT_ELEMENT.SPAN}>
              {thread.title}
            </Text>
          </Inline>
          <ThreadBadge thread={thread} />
        </Inline>
        {expanded ? null : (
          <>
            <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED} truncate>
              {thread.gist}
            </Text>
            {isOpen(thread) ? (
              <Options thread={thread} readOnly={readOnly} onDecide={onDecide} />
            ) : null}
          </>
        )}
        {expanded ? children : null}
        <Inline justify={JUSTIFY.BETWEEN}>
          <Button
            variant={BUTTON_VARIANT.QUIET}
            size={BUTTON_SIZE.COMPACT}
            icon={<GLYPH.THREAD />}
            onClick={onOpen}
          >
            {inline && expanded ? "Hide thread" : repliesWords(thread)}
          </Button>
          <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED} as={TEXT_ELEMENT.SPAN}>
            {momentOf(thread.postedAt)}
          </Text>
        </Inline>
        {forked ? <ForkedLine /> : null}
      </Stack>
      {menu.drawn && (
        <Menu
          label="Thread actions"
          menu={menu.drawn}
          groups={[[{ label: "Fork to new agent", icon: <Split />, onSelect: onFork }]]}
          onClose={menu.close}
        />
      )}
    </Card>
  );
}

/** The bar over the composer saying what needs you, each item opening its thread. */
function NeedYouBar({
  open,
  onOpen,
}: {
  open: readonly FThread[];
  onOpen: (id: FThreadId) => void;
}): React.JSX.Element | null {
  if (open.length === 0) return null;
  return (
    <Card look={CARD_LOOK.WELL} padding={CARD_PADDING.COMPACT}>
      <Inline gap={GAP.TIGHT}>
        <Badge tone={STATUS_TONE.ATTENTION}>{`${open.length} need you`}</Badge>
        {open.map((thread) => (
          <Button
            key={thread.id}
            variant={BUTTON_VARIANT.QUIET}
            size={BUTTON_SIZE.COMPACT}
            onClick={() => onOpen(thread.id)}
          >
            {thread.title}
          </Button>
        ))}
      </Inline>
    </Card>
  );
}

/** Threads (n): every thread of the agent's, open first, then answered and FYI, so an old one is found again. */
function ThreadsMenu({
  threads,
  onOpen,
}: {
  threads: readonly FThread[];
  onOpen: (id: FThreadId) => void;
}): React.JSX.Element {
  const menu = useMenu(true);
  const entry = (thread: FThread): MenuEntry => ({
    label: thread.title,
    detail: isOpen(thread)
      ? "Needs you"
      : thread.answered === undefined
        ? "FYI"
        : `Answered · ${thread.answered}`,
    icon: isOpen(thread) ? <GLYPH.DECIDE /> : <GLYPH.THREAD />,
    onSelect: () => onOpen(thread.id),
  });
  const open = threads.filter(isOpen).map(entry);
  const rest = threads.filter((thread) => !isOpen(thread)).map(entry);
  return (
    <>
      <Button
        variant={BUTTON_VARIANT.QUIET}
        size={BUTTON_SIZE.COMPACT}
        icon={<GLYPH.THREAD />}
        {...menu.trigger()}
      >
        {`Threads (${threads.length})`}
      </Button>
      {menu.drawn && (
        <Menu
          label="Threads"
          menu={menu.drawn}
          groups={[open, rest].filter((group) => group.length > 0)}
          onClose={menu.close}
        />
      )}
    </>
  );
}

/** The agent's head under its bar, standing in the chat and in a thread alike: face, standing, model, what it is on, Threads (n) and Fork. */
function AgentHead({
  state,
  threads,
  phone,
  onOpen,
  onFork,
}: {
  state: AgentState;
  threads: readonly FThread[];
  phone: boolean;
  onOpen: (id: FThreadId) => void;
  onFork: () => void;
}): React.JSX.Element {
  return (
    <div className="inbox-proto-agent-head">
      <Inline gap={GAP.CONTROL} wrap={false} align={ALIGN.START}>
        <AgentFace />
        <div className="inbox-proto-grow">
          <Stack gap={GAP.NONE}>
            <Inline gap={GAP.TIGHT}>
              <StateBadge state={state} />
              <Text variant={TEXT_VARIANT.CAPTION} as={TEXT_ELEMENT.SPAN}>
                {`${AGENT.model} · ${AGENT.task}`}
              </Text>
            </Inline>
            <ActivityLine state={state} />
          </Stack>
        </div>
        <Inline gap={GAP.NONE} wrap={false}>
          <ThreadsMenu threads={threads} onOpen={onOpen} />
          {phone ? null : (
            <Tooltip label="Fork to new agent">
              <IconButton label="Fork to new agent" icon={<Split />} onClick={onFork} />
            </Tooltip>
          )}
        </Inline>
      </Inline>
    </div>
  );
}

/** Which of F's sections an agent stands in. */
function sectionOf(agent: ListedAgent): FSection {
  if (agent.section === LIST_SECTION.ARCHIVED) return F_SECTION.ARCHIVED;
  if (agent.section === LIST_SECTION.HIBERNATING) return F_SECTION.SCHEDULED;
  if (agent.section === LIST_SECTION.RUNNING) return F_SECTION.RUNNING;
  return agent.mark === ROW_MARK.NEEDS_YOU ? F_SECTION.NEEDS_YOU : F_SECTION.DONE;
}

/** The sidebar: one row per agent in its section, the prototype's agent with its open asks under it. */
function FSidebar({
  frame,
  state,
  open,
  unread,
  current,
  onOpenAgent,
  onOpenThread,
}: {
  frame: Frame;
  state: AgentState;
  open: readonly FThread[];
  unread: boolean;
  current: boolean;
  onOpenAgent: () => void;
  onOpenThread: (id: FThreadId) => void;
}): React.JSX.Element {
  const base = { id: AGENT.id, name: AGENT.name, project: AGENT.task };
  const asking = open.length > 0;
  const me: ListedAgent =
    state === AGENT_STATE.ARCHIVED
      ? { ...base, section: LIST_SECTION.ARCHIVED, mark: ROW_MARK.ARCHIVED, detail: "Nov 7" }
      : state === AGENT_STATE.WORKING && !asking
        ? { ...base, section: LIST_SECTION.RUNNING, mark: ROW_MARK.WORKING, detail: "" }
        : state === AGENT_STATE.WORKING
          ? { ...base, section: LIST_SECTION.INBOX, mark: ROW_MARK.NEEDS_YOU, detail: "" }
          : {
              ...base,
              section: LIST_SECTION.INBOX,
              mark: asking ? ROW_MARK.NEEDS_YOU : ROW_MARK.DONE,
              detail: state === AGENT_STATE.IDLE ? "Nov 6" : "9:06 PM",
            };
  const others = OTHER_AGENTS.map((agent) =>
    agent.section === LIST_SECTION.HIBERNATING ? { ...agent, detail: "Wakes 11:40 PM" } : agent,
  );
  const agents = [me, ...others];
  return (
    <div className="inbox-proto-column">
      <Toolbar
        look={frame === FRAME.PHONE ? TOOLBAR_LOOK.PHONE : TOOLBAR_LOOK.WINDOW}
        title="Inbox"
      />
      <div className="inbox-proto-scroll">
        <Stack gap={GAP.FIELD}>
          {F_SECTIONS.map(({ section, open: startsOpen }) => {
            const rows = agents.filter((agent) => sectionOf(agent) === section);
            if (rows.length === 0) return null;
            const mine = rows.some((agent) => agent.id === AGENT.id);
            return (
              <GroupHeader
                key={`${section}-${mine}`}
                label={section}
                look={GROUP_LOOK.HEADING}
                count={{ value: rows.length, noun: rows.length === 1 ? "agent" : "agents" }}
                fold={{ defaultOpen: startsOpen || mine }}
              >
                <List label={section}>
                  {rows.map((agent) =>
                    agent.id === AGENT.id ? (
                      <MyRows
                        key={agent.id}
                        agent={
                          state === AGENT_STATE.WORKING
                            ? { ...agent, mark: ROW_MARK.WORKING }
                            : agent
                        }
                        needsYou={asking && state !== AGENT_STATE.ARCHIVED}
                        unread={unread}
                        current={current}
                        open={open}
                        onOpenAgent={onOpenAgent}
                        onOpenThread={onOpenThread}
                      />
                    ) : (
                      <AgentRow
                        key={agent.id}
                        agent={agent}
                        needsYou={false}
                        current={false}
                        onOpen={undefined}
                      />
                    ),
                  )}
                </List>
              </GroupHeader>
            );
          })}
        </Stack>
      </div>
    </div>
  );
}

/** The prototype's agent's row, then a row for each of its open asks under it. */
function MyRows({
  agent,
  needsYou,
  unread,
  current,
  open,
  onOpenAgent,
  onOpenThread,
}: {
  agent: ListedAgent;
  needsYou: boolean;
  unread: boolean;
  current: boolean;
  open: readonly FThread[];
  onOpenAgent: () => void;
  onOpenThread: (id: FThreadId) => void;
}): React.JSX.Element {
  return (
    <>
      <AgentRow
        agent={agent}
        needsYou={needsYou || unread}
        current={current}
        onOpen={onOpenAgent}
      />
      {open.map((thread) => (
        <ListRow
          key={thread.id}
          depth={1}
          leading={<GLYPH.DECIDE />}
          title={thread.title}
          description={thread.gist}
          more={false}
          metaAt={LIST_ROW_META.TITLE}
          meta={ageOf(thread.replies.at(-1)?.at ?? thread.postedAt)}
          onPress={() => onOpenThread(thread.id)}
        />
      ))}
    </>
  );
}

/** The chat as F has it: no thread cards, each thread an anchor where it was posted, each reply of the member's a quiet line. */
function chatOf(items: readonly ChatItem[], threads: readonly FThread[]): ChatItem[] {
  const own = items.filter(
    (item) =>
      item.thread === undefined &&
      item.kind !== CHAT_KIND.THREAD_CARD &&
      item.kind !== CHAT_KIND.THREAD_REPLY,
  );
  const anchors: ChatItem[] = threads.map((thread) => ({
    id: `anchor-${thread.id}`,
    kind: CHAT_KIND.TURN,
    at: thread.postedAt,
    text: thread.title,
  }));
  const quiet: ChatItem[] = threads.flatMap((thread) =>
    thread.replies
      .filter((reply) => reply.author === AUTHOR.MEMBER)
      .map((reply) => ({
        id: `quiet-${reply.id}`,
        kind: CHAT_KIND.TURN,
        at: reply.at,
        text: thread.title,
      })),
  );
  return [...own, ...anchors, ...quiet].sort((a, b) => a.at - b.at);
}

export function DesignF({ frame, state, threadsInline = false }: DesignProps): React.JSX.Element {
  const world = useWorld(state);
  const { threads, answering, reply, decide } = useThreads(state);
  const phone = frame === FRAME.PHONE;
  const [chatOpen, setChatOpen] = useState(false);
  const [seen, setSeen] = useState(false);
  const [drilled, setDrilled] = useState<FThreadId | undefined>(undefined);
  const [expanded, setExpanded] = useState<ReadonlySet<FThreadId>>(new Set());
  const [scrollTo, setScrollTo] = useState<string | undefined>(undefined);
  const [tab, setTab] = useState<SideTab>(SIDE_TAB.PR);
  const [sheet, setSheet] = useState<SideTab | undefined>(undefined);
  const readOnly = state === AGENT_STATE.ARCHIVED;
  const open = threads.filter(isOpen);
  const threadOf = (id: FThreadId) => threads.find((thread) => thread.id === id);
  const fork = () => world.fork(AGENT_FORK);

  const openAgent = () => {
    setChatOpen(true);
    setSeen(true);
    setDrilled(undefined);
    setScrollTo(undefined);
  };
  // Note that a thread opens in the column, or inline in place with the chat standing at its anchor.
  const openThread = (id: FThreadId) => {
    setChatOpen(true);
    setSeen(true);
    if (threadsInline) {
      setDrilled(undefined);
      setExpanded((was) => new Set(was).add(id));
      setScrollTo(`anchor-${id}`);
    } else {
      setDrilled(id);
    }
  };
  const toggle = (id: FThreadId) =>
    setExpanded((was) => {
      const next = new Set(was);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  // Note that a page or PR a thread names opens in the right panel on a desktop, and in a sheet on a phone.
  const openRef = (to: SideTab) => {
    if (phone) setSheet(to);
    else setTab(to);
  };

  const renderItem = (item: ChatItem): ReactNode => {
    if (item.id.startsWith("quiet-")) {
      const thread = threads.find((each) => each.title === item.text);
      return (
        <Inline gap={GAP.TIGHT}>
          <GlyphSlot size={ICON_SIZE.SMALL}>
            <GLYPH.THREAD />
          </GlyphSlot>
          <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED} as={TEXT_ELEMENT.SPAN}>
            Dean replied in thread:
          </Text>
          <InlineRef
            look={INLINE_REF_LOOK.PILL}
            label={item.text}
            onPress={() => (thread === undefined ? undefined : openThread(thread.id))}
          />
        </Inline>
      );
    }
    if (!item.id.startsWith("anchor-")) return undefined;
    const thread = threads.find((each) => `anchor-${each.id}` === item.id);
    if (thread === undefined) return undefined;
    const inlineOpen = threadsInline && expanded.has(thread.id);
    return (
      <Anchor
        thread={thread}
        inline={threadsInline}
        expanded={inlineOpen}
        readOnly={readOnly}
        forked={world.forked.has(item.id)}
        onOpen={() => (threadsInline ? toggle(thread.id) : openThread(thread.id))}
        onDecide={(label) => decide(thread.id, label)}
        onFork={() => world.fork(item.id)}
      >
        <Stack gap={GAP.FIELD}>
          <ThreadBody
            thread={thread}
            heading={false}
            readOnly={readOnly}
            answering={answering(thread.id)}
            forked={world.forked}
            onDecide={(label) => decide(thread.id, label)}
            onRef={openRef}
            onFork={world.fork}
          />
          <ThreadReply state={state} onSend={(text) => reply(thread.id, text)} onFork={fork} />
        </Stack>
      </Anchor>
    );
  };

  const drilledThread = drilled === undefined ? undefined : threadOf(drilled);
  const column =
    drilledThread === undefined ? (
      <div className="inbox-proto-column">
        <div className="inbox-proto-scroll">
          <ChatTranscript
            items={chatOf(world.chat, threads)}
            state={state}
            forked={world.forked}
            scrollTo={scrollTo}
            onFork={world.fork}
            threadTitle={() => ""}
            renderItem={renderItem}
          />
        </div>
        <div className="inbox-proto-foot">
          <Stack gap={GAP.TIGHT}>
            <NeedYouBar open={open} onOpen={openThread} />
            <ChatComposer state={state} onSend={world.say} onFork={fork} />
          </Stack>
        </div>
      </div>
    ) : (
      <div className="inbox-proto-column">
        <div className="inbox-proto-crumbs">
          <BackButton
            look={BACK_BUTTON_LOOK.COLUMN}
            label="Chat"
            place="the chat"
            command={NO_BACK_KEY}
            onBack={() => setDrilled(undefined)}
          />
        </div>
        <div className="inbox-proto-scroll">
          <div className="inbox-proto-document">
            <ThreadBody
              thread={drilledThread}
              heading
              readOnly={readOnly}
              answering={answering(drilledThread.id)}
              forked={world.forked}
              onDecide={(label) => decide(drilledThread.id, label)}
              onRef={openRef}
              onFork={world.fork}
            />
          </div>
        </div>
        <div className="inbox-proto-foot">
          <ThreadReply
            state={state}
            onSend={(text) => reply(drilledThread.id, text)}
            onFork={fork}
          />
        </div>
      </div>
    );

  const chat = chatOpen ? (
    <div className="inbox-proto-column">
      <Toolbar
        look={phone ? TOOLBAR_LOOK.PHONE : TOOLBAR_LOOK.WINDOW}
        lead={
          phone ? (
            <BackButton
              label="Inbox"
              place="Inbox"
              onBack={() => {
                setChatOpen(false);
                setDrilled(undefined);
              }}
            />
          ) : undefined
        }
        title={AGENT.name}
        actions={<AgentMenu state={state} onFork={fork} />}
      />
      <AgentHead state={state} threads={threads} phone={phone} onOpen={openThread} onFork={fork} />
      <ForkNotice forked={world.forked} />
      <div className="inbox-proto-split">
        {column}
        {phone ? null : <SidePanel tab={tab} onTab={setTab} />}
      </div>
      {phone ? (
        <FrameSheet
          open={sheet !== undefined}
          title={sheet === SIDE_TAB.PAGE ? PAGE_TITLE : "PR #7887"}
          onClose={() => setSheet(undefined)}
        >
          <div className="inbox-proto-sheet-body">
            {sheet === SIDE_TAB.PAGE ? <PickerMockup /> : <PrPane />}
          </div>
        </FrameSheet>
      ) : null}
    </div>
  ) : null;

  return (
    <FrameLayout
      frame={frame}
      list={
        <FSidebar
          frame={frame}
          state={state}
          open={open}
          unread={!seen}
          current={chatOpen}
          onOpenAgent={openAgent}
          onOpenThread={openThread}
        />
      }
      detail={chat}
    />
  );
}
