/**
 * design-e.tsx -- E · Threadbear's model. No threads apart from the chat:
 * the Inbox lists agents in sections (Inbox, Running, Hibernating,
 * Archived), a row opens the agent's chat at its newest line, and what the
 * agent asks stands in a Needs you card docked over the message box, paging
 * its asks, each answered by a pick or by Something else, the picks going
 * with the next message. Highlights keeps every ask, open and answered, with
 * a box to tick beside each. A turn that needs nothing ends in a Done card.
 */

import {
  ALIGN,
  BackButton,
  BUTTON_SIZE,
  BUTTON_VARIANT,
  Button,
  CARD_LOOK,
  CARD_PADDING,
  Card,
  Checkbox,
  GAP,
  GlyphSlot,
  GROUP_LOOK,
  GroupHeader,
  IconButton,
  Inline,
  JUSTIFY,
  LAYOUT_ELEMENT,
  LIST_ROW_CURRENT,
  LIST_ROW_META,
  List,
  ListRow,
  Spinner,
  Stack,
  TEXT_AREA_LOOK,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  TextArea,
  TOOLBAR_LOOK,
  Toolbar,
  Tooltip,
  UnreadMark,
  useSecond,
} from "@repo/ui";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  GLYPH,
  ICON_SIZE,
} from "@repo/ui/icons";
import { useState } from "react";
import {
  AGENT,
  AGENT_STATE,
  type AgentState,
  ANSWERED_ASKS,
  CARRY_ON,
  type CardAsk,
  CHAT_KIND,
  type ChatItem,
  LIST_SECTION,
  type ListedAgent,
  type ListSection,
  NOW,
  OPEN_ASKS,
  OTHER_AGENTS,
  PICKS_ANSWER,
  ROW_MARK,
  STILL_OPEN,
  THREAD_ID,
  timeIn,
} from "./data";
import type { DesignProps } from "./design-a";
import { FRAME, type Frame, FrameLayout } from "./inbox-list";
import {
  AGENT_FORK,
  AgentMenu,
  ChatTranscript,
  ForkNotice,
  FrameSheet,
  REPLY_LOOK,
  ReplyBox,
  ReplyNote,
} from "./parts";
import { useWorld } from "./world";

/** When the page loaded, which the Running rows' timers count from. */
const LOADED = Date.now();

const MINUTE = 60_000;

/** The sections in the order the list stands them, and whether each starts open. */
const SECTIONS: readonly { readonly section: ListSection; readonly open: boolean }[] = [
  { section: LIST_SECTION.INBOX, open: true },
  { section: LIST_SECTION.RUNNING, open: true },
  { section: LIST_SECTION.HIBERNATING, open: false },
  { section: LIST_SECTION.ARCHIVED, open: false },
];

/** What the prototype's agent has done since the design opened, beyond the chat. */
interface Progress {
  /** The pick or own words for each open ask, not yet sent. */
  readonly picks: ReadonlyMap<string, string>;
  /** The asks whose Something else box is open, and what it holds. */
  readonly notes: ReadonlyMap<string, string>;
  /** The asks answered by a message sent, and with what. */
  readonly answered: ReadonlyMap<string, string>;
  /** The asks ticked off in Highlights or on the card. */
  readonly ticked: ReadonlySet<string>;
  /** The Done card's follow-ups ticked to go with the next message. */
  readonly carry: ReadonlySet<string>;
  /** Whether the member sent their picks, which ends the turn in a Done card once the agent answers. */
  readonly sent: boolean;
  readonly unarchived: boolean;
  readonly archived: boolean;
}

const START: Progress = {
  picks: new Map(),
  notes: new Map(),
  answered: new Map(),
  ticked: new Set(ANSWERED_ASKS.map((ask) => ask.id)),
  carry: new Set(),
  sent: false,
  unarchived: false,
  archived: false,
};

/** The timer a Running row shows, counted on from `minutes` ago. */
function Timer({ minutes }: { minutes: number }): React.JSX.Element {
  const second = useSecond();
  const elapsed = Math.max(0, Math.floor((minutes * MINUTE + second - LOADED) / 1000));
  return (
    <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED} as={TEXT_ELEMENT.SPAN}>
      {`${Math.floor(elapsed / 60)}m ${String(elapsed % 60).padStart(2, "0")}s`}
    </Text>
  );
}

/** What a row says at its right: a spinner and its timer, its helpers, its wakeup, or a time. */
function RowMeta({ agent }: { agent: ListedAgent }): React.JSX.Element {
  if (agent.mark === ROW_MARK.WORKING || agent.mark === ROW_MARK.SUB_AGENTS) {
    return (
      <Inline gap={GAP.TIGHT} wrap={false}>
        <Spinner
          label={agent.mark === ROW_MARK.WORKING ? "Working" : "Sub-agents working"}
          delay={false}
        />
        {agent.mark === ROW_MARK.WORKING ? (
          <Timer minutes={agent.id === AGENT.id ? 3 : 14} />
        ) : (
          <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED} as={TEXT_ELEMENT.SPAN}>
            {agent.detail}
          </Text>
        )}
      </Inline>
    );
  }
  return (
    <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED} as={TEXT_ELEMENT.SPAN}>
      {agent.detail}
    </Text>
  );
}

/** One agent's row: the blue dot where it needs you or the tick where it finished unread, its name bold while either stands. */
function AgentRow({
  agent,
  needsYou,
  current,
  onOpen,
}: {
  agent: ListedAgent;
  needsYou: boolean;
  current: boolean;
  onOpen: (() => void) | undefined;
}): React.JSX.Element {
  const done = agent.mark === ROW_MARK.DONE;
  return (
    <ListRow
      leading={
        done ? (
          <GlyphSlot size={ICON_SIZE.SMALL}>
            <GLYPH.DONE />
          </GlyphSlot>
        ) : (
          <UnreadMark unread={needsYou} />
        )
      }
      title={agent.name}
      description={agent.project}
      meta={<RowMeta agent={agent} />}
      metaAt={LIST_ROW_META.TITLE}
      unread={needsYou || done}
      muted={agent.section === LIST_SECTION.ARCHIVED}
      current={current ? LIST_ROW_CURRENT.PAGE : undefined}
      more={false}
      onPress={onOpen}
    />
  );
}

/** Where the prototype's agent stands in the list, by its state and what the member has done. */
function placeOf(state: AgentState, progress: Progress, asking: boolean): ListedAgent {
  const base = { id: AGENT.id, name: AGENT.name, project: AGENT.task };
  if (progress.archived || (state === AGENT_STATE.ARCHIVED && !progress.unarchived)) {
    return { ...base, section: LIST_SECTION.ARCHIVED, mark: ROW_MARK.ARCHIVED, detail: "Nov 7" };
  }
  // Note that an agent that asks something keeps its Inbox place even while it works on something else.
  if (state === AGENT_STATE.WORKING) {
    return {
      ...base,
      section: asking ? LIST_SECTION.INBOX : LIST_SECTION.RUNNING,
      mark: ROW_MARK.WORKING,
      detail: "",
    };
  }
  if (!asking) return { ...base, section: LIST_SECTION.INBOX, mark: ROW_MARK.DONE, detail: "Now" };
  return {
    ...base,
    section: LIST_SECTION.INBOX,
    mark: ROW_MARK.NEEDS_YOU,
    detail: state === AGENT_STATE.WAITING ? "9:06 PM" : "Nov 6",
  };
}

/** The list of agents in its sections, the ones that need you first in the Inbox. */
function AgentList({
  frame,
  me,
  needsYou,
  current,
  onOpen,
}: {
  frame: Frame;
  me: ListedAgent;
  needsYou: boolean;
  current: boolean;
  onOpen: () => void;
}): React.JSX.Element {
  const agents = [me, ...OTHER_AGENTS];
  // Note that the needs-you rows lead the Inbox, then the finished ones.
  const order = (agent: ListedAgent) => (agent.id === AGENT.id && needsYou ? 0 : 1);
  return (
    <div className="inbox-proto-column">
      <Toolbar
        look={frame === FRAME.PHONE ? TOOLBAR_LOOK.PHONE : TOOLBAR_LOOK.WINDOW}
        title="Inbox"
      />
      <div className="inbox-proto-scroll">
        <Stack gap={GAP.FIELD}>
          {SECTIONS.map(({ section, open }) => {
            const rows = agents
              .filter((agent) => agent.section === section)
              .sort((a, b) => order(a) - order(b));
            if (rows.length === 0) return null;
            const mine = rows.some((agent) => agent.id === AGENT.id);
            return (
              <GroupHeader
                key={`${section}-${mine}`}
                label={section}
                look={GROUP_LOOK.HEADING}
                count={{ value: rows.length, noun: rows.length === 1 ? "agent" : "agents" }}
                fold={{ defaultOpen: open || mine }}
              >
                <List label={section}>
                  {rows.map((agent) => (
                    <AgentRow
                      key={agent.id}
                      agent={agent}
                      needsYou={agent.id === AGENT.id && needsYou}
                      current={agent.id === AGENT.id && current}
                      onOpen={agent.id === AGENT.id ? onOpen : undefined}
                    />
                  ))}
                </List>
              </GroupHeader>
            );
          })}
        </Stack>
      </div>
    </div>
  );
}

/**
 * The asks docked over the message box: outlined, headed by what is wanted,
 * one ask at a time behind ‹ 1 of 3 ›, each with its answers and Something
 * else; a pick moves on to the next ask still open, and the chevron folds
 * the card to its heading. An archived agent's card is read, not answered.
 */
function NeedsYouCard({
  asks,
  progress,
  readOnly,
  onPick,
  onNote,
  onUnarchive,
}: {
  asks: readonly CardAsk[];
  progress: Progress;
  readOnly: boolean;
  onPick: (id: string, answer: string) => void;
  onNote: (id: string, words: string | undefined) => void;
  onUnarchive: () => void;
}): React.JSX.Element {
  const [page, setPage] = useState(0);
  const [folded, setFolded] = useState(false);
  const at = Math.min(page, asks.length - 1);
  const ask = asks[at];
  const picked = asks.filter((each) => progress.picks.has(each.id)).length;
  const nextOpen = (from: number) => {
    const ahead = asks.findIndex((each, index) => index > from && !progress.picks.has(each.id));
    return ahead === -1 ? from : ahead;
  };
  const pick = (answer: string) => {
    if (ask === undefined) return;
    onPick(ask.id, answer);
    setPage(nextOpen(at));
  };
  const note = ask === undefined ? undefined : progress.notes.get(ask.id);
  return (
    <Card look={CARD_LOOK.OUTLINE} padding={CARD_PADDING.COMPACT}>
      <Stack gap={GAP.CONTROL}>
        <Inline justify={JUSTIFY.BETWEEN} wrap={false}>
          <Inline gap={GAP.TIGHT} wrap={false}>
            <GlyphSlot size={ICON_SIZE.MEDIUM}>
              <GLYPH.DECIDE />
            </GlyphSlot>
            <Text variant={TEXT_VARIANT.LABEL} as={TEXT_ELEMENT.SPAN}>
              Decisions needed
            </Text>
          </Inline>
          <Inline gap={GAP.NONE} wrap={false}>
            {asks.length > 1 ? (
              <>
                <IconButton
                  label="Previous ask"
                  icon={<ChevronLeft />}
                  size={BUTTON_SIZE.COMPACT}
                  disabled={at === 0}
                  onClick={() => setPage(at - 1)}
                />
                <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED} as={TEXT_ELEMENT.SPAN}>
                  {`${at + 1} of ${asks.length}`}
                </Text>
                <IconButton
                  label="Next ask"
                  icon={<ChevronRight />}
                  size={BUTTON_SIZE.COMPACT}
                  disabled={at === asks.length - 1}
                  onClick={() => setPage(at + 1)}
                />
              </>
            ) : null}
            <Tooltip label={folded ? "Show the asks" : "Fold to read the reply"}>
              <IconButton
                label={folded ? "Show the asks" : "Fold to read the reply"}
                icon={folded ? <ChevronUp /> : <ChevronDown />}
                size={BUTTON_SIZE.COMPACT}
                onClick={() => setFolded(!folded)}
              />
            </Tooltip>
          </Inline>
        </Inline>
        {folded || ask === undefined ? null : (
          <Stack gap={GAP.TIGHT}>
            <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
              {ask.topic}
            </Text>
            <Text>{ask.question}</Text>
            <Inline gap={GAP.TIGHT}>
              {ask.options.map((option) => (
                <Button
                  key={option}
                  variant={BUTTON_VARIANT.OUTLINE}
                  size={BUTTON_SIZE.COMPACT}
                  pressed={progress.picks.get(ask.id) === option}
                  readOnly={readOnly}
                  badge={option === ask.recommended ? "Recommended" : undefined}
                  onClick={() => pick(option)}
                >
                  {option}
                </Button>
              ))}
              {readOnly ? null : (
                <Button
                  variant={BUTTON_VARIANT.QUIET}
                  size={BUTTON_SIZE.COMPACT}
                  pressed={note !== undefined}
                  onClick={() => onNote(ask.id, note === undefined ? "" : undefined)}
                >
                  Something else
                </Button>
              )}
            </Inline>
            {note === undefined ? null : (
              <TextArea
                label={`Your answer to ${ask.topic}`}
                placeholder="Say it in your own words"
                look={TEXT_AREA_LOOK.WELL}
                rows={2}
                value={note}
                onChange={(words) => onNote(ask.id, words)}
                onSubmit={() => (note.trim() === "" ? undefined : pick(note.trim()))}
              />
            )}
          </Stack>
        )}
        {readOnly ? (
          <Inline justify={JUSTIFY.BETWEEN}>
            <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED} as={TEXT_ELEMENT.SPAN}>
              This agent is archived. Unarchive it to answer.
            </Text>
            <Button
              variant={BUTTON_VARIANT.OUTLINE}
              size={BUTTON_SIZE.COMPACT}
              onClick={onUnarchive}
            >
              Unarchive
            </Button>
          </Inline>
        ) : picked > 0 ? (
          <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
            {`${picked} of ${asks.length} picked · they go with your next message`}
          </Text>
        ) : null}
      </Stack>
    </Card>
  );
}

/** The card a turn that needs nothing ends in: Archive, what is still open, and follow-ups to tick. */
function DoneCard({
  carry,
  onCarry,
  onArchive,
}: {
  carry: ReadonlySet<string>;
  onCarry: (item: string) => void;
  onArchive: () => void;
}): React.JSX.Element {
  return (
    <Card look={CARD_LOOK.OUTLINE} padding={CARD_PADDING.COMPACT}>
      <Stack gap={GAP.CONTROL}>
        <Inline justify={JUSTIFY.BETWEEN} wrap={false}>
          <Inline gap={GAP.TIGHT} wrap={false}>
            <GlyphSlot size={ICON_SIZE.MEDIUM}>
              <GLYPH.DONE />
            </GlyphSlot>
            <Text variant={TEXT_VARIANT.LABEL} as={TEXT_ELEMENT.SPAN}>
              Done
            </Text>
          </Inline>
          <Button variant={BUTTON_VARIANT.OUTLINE} size={BUTTON_SIZE.COMPACT} onClick={onArchive}>
            Archive agent
          </Button>
        </Inline>
        <Stack gap={GAP.NONE}>
          <Text variant={TEXT_VARIANT.CAPTION}>Still open</Text>
          <Stack as={LAYOUT_ELEMENT.UL} gap={GAP.NONE}>
            {STILL_OPEN.map((item) => (
              <li key={item}>
                <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
                  {item}
                </Text>
              </li>
            ))}
          </Stack>
        </Stack>
        <Stack gap={GAP.TIGHT}>
          <Text variant={TEXT_VARIANT.CAPTION}>Or carry on</Text>
          {CARRY_ON.map((item) => (
            <Checkbox key={item} checked={carry.has(item)} onChange={() => onCarry(item)}>
              {item}
            </Checkbox>
          ))}
        </Stack>
      </Stack>
    </Card>
  );
}

/** Every ask the agent made, open first and then answered, each with a box to tick off. */
function HighlightsBody({
  progress,
  onTick,
}: {
  progress: Progress;
  onTick: (id: string) => void;
}): React.JSX.Element {
  const open = OPEN_ASKS.filter((ask) => !progress.answered.has(ask.id));
  const answered = [
    ...OPEN_ASKS.filter((ask) => progress.answered.has(ask.id)).map((ask) => ({
      id: ask.id,
      topic: ask.topic,
      detail: `Answered “${progress.answered.get(ask.id) ?? ""}” · Today`,
    })),
    ...ANSWERED_ASKS.map((ask) => ({
      id: ask.id,
      topic: ask.topic,
      detail: `Answered “${ask.answer}” · ${ask.at}`,
    })),
  ];
  return (
    <Stack gap={GAP.FIELD}>
      <Stack gap={GAP.TIGHT}>
        <Text variant={TEXT_VARIANT.GROUP}>{`Needs you · ${open.length}`}</Text>
        {open.length === 0 ? (
          <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
            Nothing open.
          </Text>
        ) : (
          open.map((ask) => (
            <Checkbox
              key={ask.id}
              detail={
                progress.picks.has(ask.id)
                  ? `Picked “${progress.picks.get(ask.id)}”, not sent`
                  : ask.question
              }
              checked={progress.ticked.has(ask.id)}
              onChange={() => onTick(ask.id)}
            >
              {ask.topic}
            </Checkbox>
          ))
        )}
      </Stack>
      <Stack gap={GAP.TIGHT}>
        <Text variant={TEXT_VARIANT.GROUP}>{`Answered · ${answered.length}`}</Text>
        {answered.map((ask) => (
          <Checkbox
            key={ask.id}
            detail={ask.detail}
            checked={progress.ticked.has(ask.id)}
            onChange={() => onTick(ask.id)}
          >
            {ask.topic}
          </Checkbox>
        ))}
      </Stack>
    </Stack>
  );
}

/** The chat as E has it: no thread cards, the asks said in the agent's own last reply. */
function chatOf(items: readonly ChatItem[], state: AgentState): ChatItem[] {
  const said: Record<string, string> = {
    [THREAD_ID.MERGE]:
      "#2126 fixes #2101 and #2104 and is green on Linux, but no one has reviewed it.",
    [THREAD_ID.REVIEW]:
      "#7887 adds smolvm to the sandbox picker behind the smolvm flag. CI is green.",
  };
  const asked: ChatItem = {
    id: "e-asks",
    kind: CHAT_KIND.TURN,
    at: timeIn(state, NOW - 8 * MINUTE),
    text: "Three things need you before I go on: whether to merge #2126 now, who reviews #7887, and whether the 0.5 notes ship as drafted.",
    steps: ["Checked #2126's CI", "Read CHANGELOG.md"],
  };
  const lines = items.map((item): ChatItem => {
    const { thread, ...rest } = item;
    if (item.kind === CHAT_KIND.THREAD_CARD && thread !== undefined) {
      return { ...rest, kind: CHAT_KIND.TURN, text: said[thread] ?? item.text };
    }
    return item.kind === CHAT_KIND.THREAD_REPLY ? { ...rest, kind: CHAT_KIND.MEMBER } : rest;
  });
  // Note that the reply asking stands after everything else the agent had said by then, before what the member sends.
  const before = lines.filter((line) => line.at <= asked.at);
  const after = lines.filter((line) => line.at > asked.at);
  return [...before, asked, ...after];
}

/** The picks and own words going with a message, said as one. */
function picksMessage(progress: Progress, words: string): string {
  const lines = OPEN_ASKS.filter((ask) => progress.picks.has(ask.id)).map(
    (ask) => `${ask.topic}: ${progress.picks.get(ask.id) ?? ""}`,
  );
  const carried = [...progress.carry].map((item) => `Carry on: ${item}`);
  return [...lines, ...carried, words].filter((line) => line !== "").join(" · ");
}

export function DesignE({ frame, state }: DesignProps): React.JSX.Element {
  const world = useWorld(state);
  const [open, setOpen] = useState(false);
  const [progress, setProgress] = useState<Progress>(START);
  const phone = frame === FRAME.PHONE;
  const [highlights, setHighlights] = useState(!phone);
  const change = (next: Partial<Progress>) => setProgress((was) => ({ ...was, ...next }));
  const asks = OPEN_ASKS.filter((ask) => !progress.answered.has(ask.id));
  const asking = asks.length > 0;
  const readOnly = state === AGENT_STATE.ARCHIVED && !progress.unarchived;
  const shownState =
    state === AGENT_STATE.ARCHIVED && progress.unarchived ? AGENT_STATE.IDLE : state;
  const items = chatOf(world.chat, state);
  const answeredNow = progress.sent && items.at(-1)?.kind === CHAT_KIND.TURN;
  const me = placeOf(state, progress, asking);

  const send = (words: string) => {
    const picks = progress.picks.size > 0 || progress.carry.size > 0;
    if (!picks) {
      world.say(words);
      return;
    }
    world.say(picksMessage(progress, words), PICKS_ANSWER);
    const answered = new Map(progress.answered);
    for (const [id, answer] of progress.picks) answered.set(id, answer);
    const ticked = new Set(progress.ticked);
    for (const id of progress.picks.keys()) ticked.add(id);
    change({
      answered,
      ticked,
      picks: new Map(),
      notes: new Map(),
      carry: new Set(),
      sent: answered.size === OPEN_ASKS.length,
    });
  };

  const card = asking ? (
    <NeedsYouCard
      asks={asks}
      progress={progress}
      readOnly={readOnly}
      onPick={(id, answer) => change({ picks: new Map(progress.picks).set(id, answer) })}
      onNote={(id, words) => {
        const notes = new Map(progress.notes);
        if (words === undefined) notes.delete(id);
        else notes.set(id, words);
        change({ notes });
      }}
      onUnarchive={() => change({ unarchived: true })}
    />
  ) : answeredNow && !progress.archived ? (
    <DoneCard
      carry={progress.carry}
      onCarry={(item) => {
        const carry = new Set(progress.carry);
        if (carry.has(item)) carry.delete(item);
        else carry.add(item);
        change({ carry });
      }}
      onArchive={() => change({ archived: true })}
    />
  ) : null;

  const tick = (id: string) => {
    const ticked = new Set(progress.ticked);
    if (ticked.has(id)) ticked.delete(id);
    else ticked.add(id);
    change({ ticked });
  };

  const chat = open ? (
    <div className="inbox-proto-column">
      <Toolbar
        look={phone ? TOOLBAR_LOOK.PHONE : TOOLBAR_LOOK.WINDOW}
        lead={
          phone ? (
            <BackButton label="Inbox" place="Inbox" onBack={() => setOpen(false)} />
          ) : undefined
        }
        title={AGENT.name}
        actions={
          <Inline gap={GAP.NONE} wrap={false} align={ALIGN.CENTER}>
            {phone ? null : (
              <Tooltip label="Highlights">
                <IconButton
                  label="Highlights"
                  icon={<GLYPH.PIN />}
                  pressed={highlights}
                  onClick={() => setHighlights(!highlights)}
                />
              </Tooltip>
            )}
            <AgentMenu
              state={state}
              onFork={() => world.fork(AGENT_FORK)}
              onHighlights={phone ? () => setHighlights(true) : undefined}
            />
          </Inline>
        }
      />
      <ForkNotice forked={world.forked} />
      <div className="inbox-proto-split">
        <div className="inbox-proto-column">
          <div className="inbox-proto-scroll">
            <ChatTranscript
              items={items}
              state={state}
              forked={world.forked}
              onFork={world.fork}
              threadTitle={() => ""}
            />
          </div>
          <div className="inbox-proto-foot">
            <ReplyBox
              look={REPLY_LOOK.AGENT}
              label={null}
              over={card}
              placeholder={
                progress.picks.size > 0 ? "Add a note to your picks" : "Send a follow-up"
              }
              state={shownState}
              sendsEmpty={progress.picks.size > 0 || progress.carry.size > 0}
              onSend={send}
              onFork={() => world.fork(AGENT_FORK)}
              under={state === AGENT_STATE.WAITING ? null : <ReplyNote state={shownState} />}
            />
          </div>
        </div>
        {phone || !highlights ? null : (
          <aside className="inbox-proto-side" aria-label="Highlights">
            <Stack gap={GAP.FIELD}>
              <Text variant={TEXT_VARIANT.LABEL}>Highlights</Text>
              <HighlightsBody progress={progress} onTick={tick} />
            </Stack>
          </aside>
        )}
      </div>
      {phone ? (
        <FrameSheet open={highlights} title="Highlights" onClose={() => setHighlights(false)}>
          <HighlightsBody progress={progress} onTick={tick} />
        </FrameSheet>
      ) : null}
    </div>
  ) : null;

  return (
    <FrameLayout
      frame={frame}
      list={
        <AgentList
          frame={frame}
          me={me}
          needsYou={asking && !readOnly}
          current={open}
          onOpen={() => {
            setOpen(true);
            if (phone) setHighlights(false);
          }}
        />
      }
      detail={chat}
    />
  );
}
