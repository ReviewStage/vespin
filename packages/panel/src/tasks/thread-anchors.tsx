/**
 * thread-anchors.tsx -- the Inbox threads prototype's design F in the real
 * panel: each thread an agent posts stands in its chat as a compact anchor
 * where it was posted, a reply on a thread as a quiet line, a small "N need
 * you" bar over the box, and the agent's head over its card, naming its
 * standing, its model, its threads, and Fork. Opening a thread drills into
 * the agent's card (`agent-threads.tsx`). A throwaway prototype on
 * `prototype/inbox-threads-real`; nothing here merges.
 */

import { AGENT_STATUS, type AgentSummary } from "@repo/features/agent-wire";
import { ENTITY_KIND } from "@repo/features/entity-kind";
import {
  INBOX_ASK,
  INBOX_MESSAGE_AUTHOR,
  INBOX_STATUS,
  type InboxItem,
  openAskOf,
} from "@repo/features/inbox-wire";
import { modelLabel } from "@repo/features/model-label";
import {
  ALIGN,
  Badge,
  BUTTON_SIZE,
  BUTTON_VARIANT,
  Button,
  CARD_LOOK,
  CARD_PADDING,
  Card,
  GAP,
  GlyphSlot,
  IconButton,
  INLINE_REF_LOOK,
  Inline,
  InlineRef,
  JUSTIFY,
  Menu,
  type MenuEntry,
  STATUS_TONE,
  Stack,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  Tooltip,
  useMenu,
  useMinute,
} from "@repo/ui";
import { GLYPH, ICON_SIZE, Split } from "@repo/ui/icons";
import { createContext, type ReactNode, useContext } from "react";
import { EntityGlyph } from "../entities/entity-glyph.js";
import { COMPOSER_DOCK_CLASS } from "./agent-composer.js";
import type { AgentThreads } from "./threads-dock.js";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** The agent's threads, handed down to its transcript's anchors and lines. */
const ProtoThreads = createContext<AgentThreads | undefined>(undefined);

export function ProtoThreadsProvider({
  value,
  children,
}: {
  value: AgentThreads | undefined;
  children: ReactNode;
}): React.JSX.Element {
  return <ProtoThreads.Provider value={value}>{children}</ProtoThreads.Provider>;
}

/** "12m ago", "3h ago", "2d ago": an age as an anchor says it. */
function ageWords(at: number, now: number): string {
  const gone = Math.max(0, now - at);
  if (gone < HOUR) return `${Math.max(1, Math.round(gone / MINUTE))}m ago`;
  if (gone < DAY) return `${Math.round(gone / HOUR)}h ago`;
  return `${Math.round(gone / DAY)}d ago`;
}

/** The first line of a post's words, plain, as an anchor's gist. */
function gistOf(text: string): string {
  const line =
    text.split("\n").find((each) => each.trim() !== "" && !each.trim().startsWith("![")) ?? "";
  return line
    .replace(/\[@?([^\]]+)\]\([^)]*\)/gu, "$1")
    .replace(/[*_`]/gu, "")
    .trim();
}

/** Whether an item waits on the reader: open, with an ask still open. */
function isAsking(item: InboxItem): boolean {
  return item.status === INBOX_STATUS.OPEN && openAskOf(item.thread ?? []) !== undefined;
}

/** What an item's badge says: it needs you, it was answered, or it only tells. */
function ItemBadge({ item }: { item: InboxItem }): React.JSX.Element {
  if (isAsking(item)) return <Badge tone={STATUS_TONE.ATTENTION}>Needs you</Badge>;
  const asked = (item.thread ?? []).some((message) => message.ask !== undefined);
  if (asked || item.status !== INBOX_STATUS.OPEN)
    return <Badge tone={STATUS_TONE.COMPLETE}>Answered</Badge>;
  return <Badge>FYI</Badge>;
}

/** The item a post names by its key, among the agent's threads. */
function itemOfKey(threads: AgentThreads | undefined, key: unknown): InboxItem | undefined {
  return typeof key === "string" ? threads?.posted.find((each) => each.key === key) : undefined;
}

/**
 * A post to a thread where it stands in the chat. The thread's first post is
 * its anchor: its title, a one-line gist, the answers it asks for, and how
 * many replies, each opening the thread. A later post to the same thread is
 * a quiet line pointing to it, as a reply is.
 */
export function ThreadAnchor({ input }: { input: unknown }): ReactNode {
  const threads = useContext(ProtoThreads);
  const now = useMinute();
  const record =
    typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
  const item = itemOfKey(threads, record.key);
  if (threads === undefined || item === undefined) return null;
  const first = (item.thread ?? []).find(
    (message) => message.author === INBOX_MESSAGE_AUTHOR.AGENT,
  );
  const open = () => threads.onOpen(item);
  if (first !== undefined && first.text !== record.body) {
    return <QuietLine lead="Posted in thread:" title={item.title} onOpen={open} />;
  }
  const asking = openAskOf(item.thread ?? []);
  const ask = asking?.ask;
  const decide =
    ask !== undefined && ask.type === INBOX_ASK.DECIDE && "options" in ask ? ask : undefined;
  const options: readonly { readonly label: string }[] = decide?.options ?? [];
  const recommended =
    decide !== undefined && "recommended" in decide ? decide.recommended : undefined;
  const replies = Math.max(0, (item.thread ?? []).length - 1);
  return (
    <div className="proto-thread-anchor">
      <Card look={CARD_LOOK.OUTLINE} padding={CARD_PADDING.COMPACT}>
        <Stack gap={GAP.TIGHT}>
          <Inline justify={JUSTIFY.BETWEEN} wrap={false} align={ALIGN.START}>
            <Inline gap={GAP.TIGHT} wrap={false}>
              <GlyphSlot size={ICON_SIZE.MEDIUM}>
                {asking === undefined ? (
                  <EntityGlyph kind={ENTITY_KIND.INBOX_ITEM} />
                ) : (
                  <GLYPH.DECIDE />
                )}
              </GlyphSlot>
              <Text variant={TEXT_VARIANT.LABEL} as={TEXT_ELEMENT.SPAN}>
                {item.title}
              </Text>
            </Inline>
            <ItemBadge item={item} />
          </Inline>
          <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED} truncate>
            {gistOf(first?.text ?? "")}
          </Text>
          {options.length === 0 ? null : (
            <Inline gap={GAP.TIGHT}>
              {options.map((option) => (
                <Button
                  key={option.label}
                  variant={BUTTON_VARIANT.OUTLINE}
                  size={BUTTON_SIZE.COMPACT}
                  badge={recommended === option.label ? "Recommended" : undefined}
                  onClick={open}
                >
                  {option.label}
                </Button>
              ))}
            </Inline>
          )}
          <Inline>
            <Button
              variant={BUTTON_VARIANT.QUIET}
              size={BUTTON_SIZE.COMPACT}
              icon={<EntityGlyph kind={ENTITY_KIND.INBOX_ITEM} />}
              onClick={open}
            >
              {replies === 0
                ? `Open thread · ${ageWords(item.postedAt, now)}`
                : `${replies} ${replies === 1 ? "reply" : "replies"} · ${ageWords(item.updatedAt, now)}`}
            </Button>
          </Inline>
        </Stack>
      </Card>
    </div>
  );
}

/** A quiet line in the chat pointing to a thread: what happened on it, and its chip. */
function QuietLine({
  lead,
  title,
  onOpen,
}: {
  lead: string;
  title: string;
  onOpen: () => void;
}): React.JSX.Element {
  return (
    <div className="proto-thread-quiet">
      <Inline gap={GAP.TIGHT}>
        <GlyphSlot size={ICON_SIZE.SMALL}>
          <EntityGlyph kind={ENTITY_KIND.INBOX_ITEM} />
        </GlyphSlot>
        <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED} as={TEXT_ELEMENT.SPAN}>
          {lead}
        </Text>
        <InlineRef look={INLINE_REF_LOOK.PILL} label={title} onPress={onOpen} />
      </Inline>
    </div>
  );
}

/** A member's reply on a thread as the chat holds it: a quiet line, its words the thread's alone. */
export function ThreadReplyLine({
  itemId,
  sender,
}: {
  itemId: string;
  sender: string | undefined;
}): ReactNode {
  const threads = useContext(ProtoThreads);
  const item = threads?.posted.find((each) => each.id === itemId);
  if (threads === undefined || item === undefined) return null;
  const who = sender?.split(" ")[0] ?? "You";
  return (
    <QuietLine
      lead={`${who} replied in thread:`}
      title={item.title}
      onOpen={() => threads.onOpen(item)}
    />
  );
}

/** The bar over the box: how many threads wait on the reader, each opening its thread; nothing while none waits. */
export function NeedYouBar({ threads }: { threads: AgentThreads | undefined }): ReactNode {
  // Note that an FYI post waits on a nod alone, which never counts as needing you.
  const waiting = (threads?.waiting ?? []).filter(isAsking);
  if (threads === undefined || waiting.length === 0) return null;
  return (
    <div className={`agent-threads-dock proto-need-you ${COMPOSER_DOCK_CLASS}`}>
      <Card look={CARD_LOOK.WELL} padding={CARD_PADDING.COMPACT}>
        <Inline gap={GAP.TIGHT} wrap={false} className="proto-need-you-row">
          <Badge tone={STATUS_TONE.ATTENTION}>{`${waiting.length} need you`}</Badge>
          {waiting.map((item) => (
            <Button
              key={item.id}
              variant={BUTTON_VARIANT.QUIET}
              size={BUTTON_SIZE.COMPACT}
              onClick={() => threads.onOpen(item)}
            >
              {item.title}
            </Button>
          ))}
        </Inline>
      </Card>
    </div>
  );
}

/** Threads (N): every thread the agent posted, those waiting first, so an old one is found again. */
function ThreadsMenu({ threads }: { threads: AgentThreads }): React.JSX.Element {
  const menu = useMenu(true);
  const entry = (item: InboxItem): MenuEntry => ({
    label: item.title,
    detail: isAsking(item)
      ? "Needs you"
      : (item.thread ?? []).some((message) => message.ask !== undefined)
        ? "Answered"
        : "FYI",
    icon: isAsking(item) ? <GLYPH.DECIDE /> : <EntityGlyph kind={ENTITY_KIND.INBOX_ITEM} />,
    onSelect: () => threads.onOpen(item),
  });
  const waiting = threads.posted.filter(isAsking).map(entry);
  // Note that the head's count is every thread, open first, then answered and FYI.
  const rest = threads.posted.filter((item) => !isAsking(item)).map(entry);
  return (
    <>
      <Button
        variant={BUTTON_VARIANT.QUIET}
        size={BUTTON_SIZE.COMPACT}
        icon={<EntityGlyph kind={ENTITY_KIND.INBOX_ITEM} />}
        {...menu.trigger()}
      >
        {`Threads (${threads.posted.length})`}
      </Button>
      {menu.drawn && (
        <Menu
          label="Threads"
          menu={menu.drawn}
          groups={[waiting, rest].filter((group) => group.length > 0)}
          onClose={menu.close}
        />
      )}
    </>
  );
}

/** The agent's standing as its head says it, from its status and what waits on the reader. */
function standingOf(
  agent: AgentSummary,
  threads: AgentThreads | undefined,
  now: number,
): { tone: (typeof STATUS_TONE)[keyof typeof STATUS_TONE]; words: string } {
  const waiting = threads?.waiting.length ?? 0;
  if (agent.archivedAt !== undefined)
    return { tone: STATUS_TONE.NEUTRAL, words: "Archived · replying unarchives it" };
  if (agent.status === AGENT_STATUS.RUNNING || agent.status === AGENT_STATUS.STARTING) {
    return {
      tone: STATUS_TONE.WORKING,
      words: waiting > 0 ? "Working on something else" : "Working",
    };
  }
  const last = Math.max(0, ...(threads?.posted ?? []).map((item) => item.updatedAt));
  if (last > 0 && now - last > DAY) {
    const since = new Date(last).toLocaleDateString("en-US", { month: "short", day: "numeric" });
    return { tone: STATUS_TONE.NEUTRAL, words: `Idle since ${since} · replying wakes it` };
  }
  return waiting > 0
    ? { tone: STATUS_TONE.ATTENTION, words: "Waiting on you" }
    : { tone: STATUS_TONE.COMPLETE, words: "Done" };
}

/**
 * The agent's head over its card, which stands while a thread is drilled
 * into: its name, its standing, its model, Threads (N), and Fork.
 */
export function ProtoAgentHead({
  agent,
  models,
  threads,
  onFork,
}: {
  agent: AgentSummary | undefined;
  models: Parameters<typeof modelLabel>[1];
  threads: AgentThreads | undefined;
  onFork: (() => void) | undefined;
}): ReactNode {
  const now = useMinute();
  if (agent === undefined) return null;
  const standing = standingOf(agent, threads, now);
  return (
    <div className="proto-agent-head">
      <Inline justify={JUSTIFY.BETWEEN}>
        <Inline gap={GAP.TIGHT}>
          <Badge tone={standing.tone}>{standing.words}</Badge>
          <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED} as={TEXT_ELEMENT.SPAN}>
            {modelLabel(agent.model, models)}
          </Text>
        </Inline>
        <Inline gap={GAP.NONE} wrap={false}>
          {threads === undefined ? null : <ThreadsMenu threads={threads} />}
          {onFork === undefined ? null : (
            <Tooltip label="Fork to new agent">
              <IconButton
                label="Fork to new agent"
                icon={<Split />}
                size={BUTTON_SIZE.COMPACT}
                onClick={onFork}
              />
            </Tooltip>
          )}
        </Inline>
      </Inline>
    </div>
  );
}
