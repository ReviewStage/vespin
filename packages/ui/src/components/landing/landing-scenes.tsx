import { AUTOMATION_TRIGGER } from "@repo/features/automation-wire";
import { MODEL_PROVIDER } from "@repo/features/models-wire";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { TASK_STATUS, type TaskStatus } from "@repo/features/task-wire";
import { THEME } from "@repo/settings";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { cssCustomProperties } from "../../css.js";
import {
  CheckIcon,
  GLYPH,
  ICON_SIZE,
  InboxIcon,
  ListTodoIcon,
  SendIcon,
  SlidersHorizontalIcon,
  SquareCheckIcon,
  ZapIcon,
} from "../../icons/icons.js";
import {
  ComposeIcon,
  MicrophoneIcon,
  PlayIcon,
  PlusIcon,
  SearchIcon,
  SidebarIcon,
} from "../../icons/lucide-glyphs.js";
import { FiringGlyph } from "../../marks/firing-glyph.js";
import { HarnessMark } from "../../marks/harness-mark.js";
import { ProductMark } from "../../marks/product-mark.js";
import { MARK_PROVIDER, PROVIDER_MARK_SIZE, ProviderMark } from "../../marks/provider-mark.js";
import { TaskStatusMark } from "../../marks/task-marks.js";
import { PROFILE, surfaceAttributes } from "../../tokens/surface.js";
import { AVATAR_OUTLINE, AVATAR_SIZE, Avatar } from "../avatar/avatar.js";
import { Badge } from "../badge/badge.js";
import { BarAction, BarItem, BarItems } from "../bar-item/bar-item.js";
import { Breadcrumbs } from "../breadcrumbs/breadcrumbs.js";
import { BUTTON_SIZE, BUTTON_VARIANT, Button, IconButton } from "../button/button.js";
import { CARD_LOOK, Card } from "../card/card.js";
import { Checkbox } from "../checkbox/checkbox.js";
import { CHIP_LOOK, CHIP_WIDTH, Chip, ChipName } from "../chip/chip.js";
import { CountParts, linesCount } from "../choice/count-part.js";
import { CHOICE_LOOK, CHOICE_SELECT, ChoiceList } from "../choice-list/choice-list.js";
import { CODE_CARD_TITLE, CodeCard } from "../code-card/code-card.js";
import { Comment, type CommentAuthor } from "../comment/comment.js";
import { ComposerBody } from "../composer-frame/composer-body.js";
import { ComposerFoot } from "../composer-frame/composer-foot.js";
import { ComposerFrame } from "../composer-frame/composer-frame.js";
import { Disclosure, DisclosureBody, DisclosureSummary } from "../disclosure/disclosure.js";
import { FoldingButton } from "../folding-button/folding-button.js";
import { GlyphSlot } from "../glyph-slot/glyph-slot.js";
import { INLINE_REF_LOOK, InlineRef } from "../inline-ref/inline-ref.js";
import { INLINE_REF_FIT, type InlineRefFit } from "../inline-ref/inline-ref-fit.js";
import { LineRow } from "../line-button/line-button.js";
import {
  LIST_ROW_CURRENT,
  LIST_ROW_CURRENT_LOOK,
  LIST_ROW_INK,
  LIST_ROW_LEAD,
  LIST_ROW_META,
  LIST_VARIANT,
  List,
  ListRow,
} from "../list-row/list-row.js";
import { MessageFrame } from "../message/message.js";
import { MessageHead } from "../message/message-head.js";
import { MoreButton } from "../more-button/more-button.js";
import { NOTE_LINE_LOOK, NoteLine } from "../note-line/note-line.js";
import { SearchField } from "../search-field/search-field.js";
import { SettingsRow } from "../settings-row/settings-row.js";
import { SETTINGS_SECTION_FRAME, SettingsSection } from "../settings-section/settings-section.js";
import { Switch } from "../switch/switch.js";
import { TABS_GROUND, Tab, Tabs } from "../tabs/tabs.js";
import { TEXT_ELEMENT, TEXT_TONE, Text } from "../text/text.js";
import { TEXT_VARIANT } from "../text/text-role.js";
import { TEXT_AREA_LOOK, TextArea } from "../text-field/text-field.js";
import { TIME_LOOK, Time } from "../time/time.js";
import { Toolbar } from "../toolbar/toolbar.js";
import { TOOLBAR_INSET, TOOLBAR_LOOK } from "../toolbar/toolbar-frame.js";
import { UnreadMark } from "../unread-mark/unread-mark.js";
import { WorkingMark } from "../working-mark/working-mark.js";
import { TypingCaret } from "./landing-caret.js";
import {
  agentFace,
  DESKTOP_PLACE,
  DesktopSidebar,
  type LandingPerson,
  REPOSITORY,
  SidePanelToggle,
  useLandingMember,
  useLandingTeammate,
} from "./landing-desktop.js";
import { LandingPhone, LandingWindow } from "./landing-devices.js";
import { heldStill } from "./landing-paint.js";
import { DemoPointer, usePointer } from "./landing-pointer.js";
import { MINUTE, STORY_NOW, still, useStory, useTimeline, useTyping } from "./landing-story.js";

/**
 * landing-scenes.tsx -- the landing's moving screens: the app's own components, composed as the panel composes them, stepping through a short story each.
 *
 * Every scene is drawn from `@repo/ui`'s parts in the panel's own
 * arrangement, at the profile the screen stands for: a Mac window draws at
 * the desktop's, the phone at the site's on a phone. The Inbox answers an
 * agent's question in the draft under it; a task's page shows its agent's
 * log, folded calls and all, starting another agent and trading messages
 * with it, the plan's sub-tasks beside it; an automation's page fires a run;
 * the phone holds the same Inbox; and the composer's model menu stands
 * open over Claude's models on a plan and GPT on an API key, still; and a
 * Slack mention and the `vespin` command each start an agent. None is
 * pressed: each other scene plays its story on a clock that
 * runs only while it is on screen (`landing-story.ts`). The Inbox and the
 * task are close-ups cut to the panel their story happens in, so they play
 * only from their telling moment, the ask and the hand-off.
 */

/** How long each scene holds a step, in milliseconds. */
const BEAT = { AGENTS: 1800, RUNS: 1700, STARTS: 1600 } as const;

/**
 * The team scene's story: how many steps it plays, the last its log draws
 * (held a beat), and the step the log turns over on, scrolling its finished
 * turn away to the opening it starts from, so the loop has no cut.
 */
const AGENTS_STORY = { STEPS: 9, LAST: 6, TURN: 8 } as const;

/** The scenes the landing plays, by the feature each shows. */
export const LANDING_SCENE = {
  INBOX: "inbox",
  AGENTS: "agents",
  AUTOMATIONS: "automations",
  DEVICES: "devices",
  KEYS: "keys",
  STARTS: "starts",
} as const;

export type LandingScene = (typeof LANDING_SCENE)[keyof typeof LANDING_SCENE];

/** The Mac app's own surface, which a window's screen is drawn at. */
const DESKTOP_SURFACE = surfaceAttributes(PROFILE.DESKTOP, THEME.DARK);

/** An agent as a comment's writer: its name on the square of the harness it runs in. */
function agentAuthor(name: string): CommentAuthor {
  return {
    name,
    outline: AVATAR_OUTLINE.SQUARE,
    glyph: <HarnessMark provider={MODEL_PROVIDER.ANTHROPIC} />,
  };
}

/** A pill naming an agent, its face before its name, wrapping where it stands in words (`fit`). */
function AgentPill({
  name,
  look = INLINE_REF_LOOK.PILL,
  fit,
}: {
  name: string;
  look?: (typeof INLINE_REF_LOOK)[keyof typeof INLINE_REF_LOOK];
  fit?: InlineRefFit | undefined;
}): React.JSX.Element {
  return (
    <InlineRef
      look={look}
      fit={fit}
      glyph={agentFace(name, AVATAR_SIZE.INLINE)}
      label={name}
      hint={false}
    />
  );
}

/** The Mac app's window: the desktop's surface holding `children` as the app on show. */
function DesktopWindow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <LandingWindow label={label}>
      <div className="ui-landing-desktop" {...DESKTOP_SURFACE}>
        {children}
      </div>
    </LandingWindow>
  );
}

/** What a line of the Inbox asks: a decision, a to-do, or one that is settled. */
const LINE = {
  DECIDE: "decide",
  DO: "do",
  SETTLED: "settled",
} as const;

type Line = (typeof LINE)[keyof typeof LINE];

const LINE_GLYPH: Readonly<Record<Line, ReactNode>> = {
  [LINE.DECIDE]: <GLYPH.DECIDE />,
  [LINE.DO]: <SquareCheckIcon />,
  [LINE.SETTLED]: <CheckIcon />,
};

/** One of the Inbox's items: its task, what it asks, its last line, and where the reader stands with it. */
type InboxItem = {
  readonly id: string;
  readonly task: string;
  readonly status: TaskStatus;
  readonly title: string;
  readonly line: string;
  readonly kind: Line;
  readonly ago: number;
  readonly unread?: boolean;
  readonly current?: boolean;
};

/** An Inbox row as the panel draws it: the task above, the ask's glyph before its last line, its age beside the title. */
function InboxRow({ item }: { item: InboxItem }): React.JSX.Element {
  const open = item.kind !== LINE.SETTLED;

  return (
    <ListRow
      ink={LIST_ROW_INK.SIDEBAR}
      currentLook={LIST_ROW_CURRENT_LOOK.TINT}
      leading={<UnreadMark unread={item.unread === true} />}
      title={item.title}
      lead={{ icon: <TaskStatusMark status={item.status} />, label: item.task }}
      leadAt={LIST_ROW_LEAD.ABOVE}
      description={
        <span className="ui-landing-line">
          <span className="ui-landing-line-glyph" data-open={open}>
            {LINE_GLYPH[item.kind]}
          </span>
          {item.line}
        </span>
      }
      meta={
        <span className="ui-landing-row-marks">
          <Time at={STORY_NOW - item.ago * MINUTE} now={STORY_NOW} hint={false} />
        </span>
      }
      metaAt={LIST_ROW_META.TITLE}
      current={item.current === true ? LIST_ROW_CURRENT.PAGE : undefined}
      unread={item.unread === true}
      onPress={still}
    />
  );
}

/** The question the Inbox's story turns on, its options, the one the reader picks, and the note they send with it. */
const QUESTION = {
  TITLE: "Who can withdraw an invite?",
  TASK: "Teammate invitations",
  AGENT: "Invite emails",
  WORDS:
    "An invite is a pending membership row, so withdrawing one deletes it. The description leaves open who may.",
  OPTIONS: [
    {
      value: "sender",
      label: "The member who sent it",
      detail: "Admins can't touch someone else's invite.",
    },
    { value: "admin", label: "Any admin", detail: "Senders wait on an admin to take one back." },
    {
      value: "both",
      label: "Both",
      detail: "The sender, or any admin of the workspace.",
      badge: "Recommended",
    },
  ],
  PICK: "both",
  NOTE: "Log who withdrew it.",
} as const;

const OTHER_ITEMS: readonly InboxItem[] = [
  {
    id: "domain",
    task: "Weekly digest email",
    status: TASK_STATUS.IN_PROGRESS,
    title: "Verify the digest's sender domain",
    line: "3 steps left · Open the mail provider's Domains page",
    kind: LINE.DO,
    ago: 25,
  },
  {
    id: "migration",
    task: "Teammate invitations",
    status: TASK_STATUS.IN_PROGRESS,
    title: "Run the memberships migration on preview?",
    line: "Approve (recommended) / Decline",
    kind: LINE.DECIDE,
    ago: 40,
  },
  {
    id: "alerts",
    task: "Usage alerts",
    status: TASK_STATUS.IN_PROGRESS,
    title: "Which threshold alerts first?",
    line: "80% of the plan (recommended) / 90% / 100%",
    kind: LINE.DECIDE,
    ago: 48,
  },
  {
    id: "webhook",
    task: "Billing export",
    status: TASK_STATUS.IN_PROGRESS,
    title: "Add the billing webhook's signing secret",
    line: "2 steps left · Copy it from the payment provider's dashboard",
    kind: LINE.DO,
    ago: 55,
  },
  {
    id: "subject",
    task: "Weekly digest email",
    status: TASK_STATUS.IN_PROGRESS,
    title: "The digest's subject line",
    line: "Answered",
    kind: LINE.SETTLED,
    ago: 62,
  },
];

/** The Inbox's items at `step` of the story: the question arriving on top, opened, and settled once answered. */
function inboxItems(step: number): readonly InboxItem[] {
  if (step < 1) return OTHER_ITEMS;
  const answered = step >= 5;

  const question: InboxItem = {
    id: "question",
    task: QUESTION.TASK,
    status: TASK_STATUS.IN_PROGRESS,
    title: QUESTION.TITLE,
    line: answered ? "Both (recommended)" : "The member who sent it / Any admin / Both",
    kind: answered ? LINE.SETTLED : LINE.DECIDE,
    ago: 1,
    unread: step < 2,
    current: step >= 2,
  };

  return [question, ...OTHER_ITEMS];
}

/** The thread's path in its bar: its task, then the agent that asked. */
function ThreadPath(): React.JSX.Element {
  return (
    <Breadcrumbs
      label="Path"
      crumbs={[
        { label: QUESTION.TASK, glyph: <TaskStatusMark status={TASK_STATUS.IN_PROGRESS} /> },
        { label: QUESTION.AGENT, glyph: agentFace(QUESTION.AGENT, AVATAR_SIZE.INLINE) },
      ]}
    />
  );
}

/** The ask's options as the thread holds them, `picked` checked; numbered while they wait on the reader. */
function AskChoices({
  picked,
  readOnly,
}: {
  picked: boolean;
  readOnly: boolean;
}): React.JSX.Element {
  return (
    <ChoiceList
      legend="Options"
      options={QUESTION.OPTIONS}
      value={picked ? [QUESTION.PICK] : []}
      select={CHOICE_SELECT.ONE}
      look={CHOICE_LOOK.MARKED}
      numbered={!readOnly}
      readOnly={readOnly}
      onChange={still}
    />
  );
}

/** A composer's body: its one field, empty but for `placeholder` or holding `words`. */
function ComposerField({
  label,
  placeholder,
  words = "",
  typing = false,
}: {
  label: string;
  placeholder: string;
  words?: string | undefined;
  /** Whether the story is typing `words`, which a caret follows. */
  typing?: boolean | undefined;
}): React.JSX.Element {
  return (
    <ComposerBody>
      <div className="ui-landing-composer-field">
        <TypingCaret words={words} typing={typing}>
          <TextArea
            label={label}
            value={words}
            placeholder={placeholder}
            look={TEXT_AREA_LOOK.BARE}
            rows={1}
            onChange={still}
          />
        </TypingCaret>
      </div>
    </ComposerBody>
  );
}

/** A reply's composer: its field over its foot of attach, dictate, and send. */
function ReplyComposer({
  placeholder,
  words,
  sendable,
  typing,
  children,
}: {
  placeholder: string;
  words?: string | undefined;
  sendable: boolean;
  /** Whether the story is typing `words`, which a caret follows. */
  typing?: boolean | undefined;
  children?: ReactNode;
}): React.JSX.Element {
  return (
    <ComposerFrame>
      {children}
      <ComposerField label={placeholder} placeholder={placeholder} words={words} typing={typing} />
      <ComposerFoot
        send={{ label: "Send", empty: !sendable }}
        tools={<IconButton icon={<PlusIcon />} label="Attach files" onClick={still} />}
        actions={<IconButton icon={<MicrophoneIcon />} label="Dictate" onClick={still} />}
      />
    </ComposerFrame>
  );
}

/** The reader's draft under the question: its options in the composer, a note, and the new thread's choice. */
function DraftAnswer({
  picked,
  note,
  typing,
}: {
  picked: boolean;
  note: string;
  /** Whether the story is typing `note`. */
  typing: boolean;
}): React.JSX.Element {
  return (
    <>
      <ReplyComposer placeholder="Add a note" words={note} sendable={picked} typing={typing}>
        <div className="ui-landing-draft-ask">
          <div className="ui-landing-draft-ask-options">
            <AskChoices picked={picked} readOnly={false} />
          </div>
          <IconButton
            icon={<GLYPH.CLOSE />}
            label="Resolve without answering"
            size={BUTTON_SIZE.COMPACT}
            onClick={still}
          />
        </div>
      </ReplyComposer>
      <div className="ui-landing-new-thread">
        <Checkbox checked={false} onChange={still}>
          Send as a new thread to{" "}
          <AgentPill name={QUESTION.AGENT} look={INLINE_REF_LOOK.WASH} fit={INLINE_REF_FIT.FLOW} />
        </Checkbox>
      </div>
    </>
  );
}

/**
 * The question's thread at `step` of the story: the agent's question over
 * the reader's draft, an option picked, a note written, and the answer sent,
 * a fresh draft waiting under it.
 */
function QuestionThread({
  step,
  note,
  typing = false,
}: {
  step: number;
  note?: string | undefined;
  /** Whether the story is typing `note`. */
  typing?: boolean | undefined;
}): React.JSX.Element {
  const member = useLandingMember();
  const sent = step >= 5;

  return (
    <div className="ui-landing-thread">
      <header className="ui-landing-subject">
        <Text variant={TEXT_VARIANT.DIALOG} as={TEXT_ELEMENT.H2}>
          {QUESTION.TITLE}
        </Text>
      </header>
      <ol className="ui-landing-comments">
        <li className="ui-landing-comment">
          <Comment
            author={agentAuthor(QUESTION.AGENT)}
            at={STORY_NOW - 12 * MINUTE}
            now={STORY_NOW}
          >
            <Text>{QUESTION.WORDS}</Text>
          </Comment>
        </li>
        {sent ? (
          <li className="ui-landing-comment ui-landing-enter">
            <Comment author={member} at={STORY_NOW} now={STORY_NOW}>
              <AskChoices picked readOnly />
              <Text>{QUESTION.NOTE}</Text>
            </Comment>
          </li>
        ) : null}
        <li className="ui-landing-comment">
          <Comment author={member} nameRef="You">
            {sent ? (
              <ReplyComposer placeholder="Reply" sendable={false} />
            ) : (
              <DraftAnswer
                picked={step >= 3}
                note={note ?? (step >= 4 ? QUESTION.NOTE : "")}
                typing={typing}
              />
            )}
          </Comment>
        </li>
      </ol>
    </div>
  );
}

/** The Inbox's page at `step`: the list, a question arriving, opened, answered in the draft under it, and sent. */
function InboxPage({ step }: { step: number }): React.JSX.Element {
  const open = step >= 2;

  return (
    <div className="ui-landing-app">
      <DesktopSidebar place={DESKTOP_PLACE.INBOX} />
      <div className="ui-landing-main ui-landing-inbox">
        <nav className="ui-landing-inbox-list" aria-label="Inbox">
          <Toolbar
            title="Inbox"
            end={TOOLBAR_INSET.COLUMN}
            actions={
              <IconButton icon={<SlidersHorizontalIcon />} label="View options" onClick={still} />
            }
          />
          <div className="ui-landing-sheet-start">
            <search className="ui-landing-search">
              <SearchField
                label="Search inbox"
                placeholder="Search inbox"
                value=""
                onChange={still}
              />
            </search>
            <div className="ui-landing-rows">
              <List label="Inbox items">
                {inboxItems(step).map((item) => (
                  <InboxRow key={item.id} item={item} />
                ))}
              </List>
            </div>
          </div>
        </nav>
        <section className="ui-landing-inbox-thread">
          <Toolbar
            start={TOOLBAR_INSET.COLUMN}
            title={open ? <ThreadPath /> : undefined}
            actions={open ? <MoreButton thing="thread" onClick={still} /> : undefined}
          />
          <div className="ui-landing-sheet-end">
            {open ? (
              <QuestionThread step={step} />
            ) : (
              <div className="ui-landing-empty">
                <GlyphSlot size={ICON_SIZE.LARGE}>
                  <InboxIcon />
                </GlyphSlot>
                <Text tone={TEXT_TONE.MUTED}>Choose an item</Text>
              </div>
            )}
          </div>
        </section>
      </div>
      <SidePanelToggle />
    </div>
  );
}

/**
 * A column of the app as a card: its bar on the frame over its sheet, at the
 * Mac app's own sizes, so a close-up draws the columns its story happens in
 * and nothing else of the window. `aside` names the card that stands beside
 * the story, which a phone's narrow stage leaves out.
 */
function ColumnCard({
  bar,
  aside = false,
  children,
}: {
  bar: ReactNode;
  aside?: boolean;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <div className="ui-landing-card" data-aside={aside}>
      {bar}
      <div className="ui-landing-card-sheet">{children}</div>
    </div>
  );
}

/**
 * The Inbox demo's beats, in order: the list, the question arriving, the
 * pointer going to it and pressing, the thread opening, the pointer picking
 * an option, pressing into the note and typing it, pressing send, the
 * answer standing in the thread, the question resolved out of the list
 * behind it, and the list again as it opened, held before the loop.
 */
const INBOX_BEAT = {
  LIST: 0,
  ARRIVE: 1,
  AIM_ROW: 2,
  PRESS_ROW: 3,
  OPEN: 4,
  AIM_PICK: 5,
  PICK: 6,
  AIM_NOTE: 7,
  TYPE: 8,
  AIM_SEND: 9,
  SEND: 10,
  SENT: 11,
  BACK: 12,
  HOLD: 13,
} as const;

/** How long each beat holds, in milliseconds, by its place in `INBOX_BEAT`: long enough for the pointer's move or the typing it holds. */
const INBOX_DURATIONS: readonly number[] = [
  900, 1000, 700, 350, 650, 700, 450, 700, 1100, 700, 350, 800, 1000, 1400,
];

/** What the pointer rests on at each beat: the row, the picked option, the note, the send, or nothing. */
const POINTER_AIM = {
  REST: "rest",
  ROW: "row",
  PICK: "pick",
  NOTE: "note",
  SEND: "send",
} as const;

type PointerAim = (typeof POINTER_AIM)[keyof typeof POINTER_AIM];

/** Where the pointer is at `beat`. */
function pointerAim(beat: number): PointerAim {
  // Note that after a press the pointer stays where it pressed while the screen answers.
  if (beat >= INBOX_BEAT.AIM_ROW && beat <= INBOX_BEAT.OPEN) return POINTER_AIM.ROW;

  if (beat === INBOX_BEAT.AIM_PICK || beat === INBOX_BEAT.PICK) return POINTER_AIM.PICK;

  if (beat === INBOX_BEAT.AIM_NOTE || beat === INBOX_BEAT.TYPE) return POINTER_AIM.NOTE;

  if (beat >= INBOX_BEAT.AIM_SEND && beat <= INBOX_BEAT.SENT) return POINTER_AIM.SEND;

  return POINTER_AIM.REST;
}

/** The beats a press lands on: the row, the option, the note's field, and the send. */
function pressedAt(beat: number): boolean {
  return (
    beat === INBOX_BEAT.PRESS_ROW ||
    beat === INBOX_BEAT.PICK ||
    beat === INBOX_BEAT.TYPE ||
    beat === INBOX_BEAT.SEND
  );
}

/** The element the pointer goes to for `aim`, found in the scene's own markup, or nothing at rest. */
const AIM_TARGET: Readonly<Record<PointerAim, string | null>> = {
  [POINTER_AIM.REST]: null,
  [POINTER_AIM.ROW]: ".ui-landing-demo-list li",
  [POINTER_AIM.PICK]: `.ui-landing-demo-thread [data-value="${QUESTION.PICK}"]`,
  [POINTER_AIM.NOTE]: ".ui-landing-demo-thread textarea",
  [POINTER_AIM.SEND]: '.ui-landing-demo-thread button[aria-label="Send"]',
};

/** The Inbox list's step (`inboxItems`) at a beat of the demo. */
function listStep(beat: number): number {
  if (beat < INBOX_BEAT.ARRIVE) return 0;

  if (beat < INBOX_BEAT.PRESS_ROW) return 1;

  // Note that the answered question is resolved and leaves the list as it is sent, so the list the thread slides back to stands as the demo opened and the loop starts over without a cut.
  if (beat < INBOX_BEAT.SENT) return 2;

  return 0;
}

/** The thread's step (`QuestionThread`) at a beat of the demo. */
function threadStep(beat: number): number {
  if (beat < INBOX_BEAT.PICK) return 2;

  if (beat < INBOX_BEAT.SENT) return 3;

  return 5;
}

/**
 * The Inbox as one screen, looping: the list, a question arriving on top,
 * the pointer opening it, picking an option, writing a note, and sending,
 * then the list again with the question settled. The thread slides in over
 * the list as the panel opens an item at this width.
 */
function InboxScene(): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const beat = useTimeline(ref, INBOX_DURATIONS);
  const open = beat >= INBOX_BEAT.OPEN && beat < INBOX_BEAT.BACK;
  const aim = pointerAim(beat);
  const point = usePointer(ref, AIM_TARGET[aim], beat);

  const pressed = pressedAt(beat);
  const note = useTyping(QUESTION.NOTE, beat === INBOX_BEAT.TYPE, beat > INBOX_BEAT.TYPE);

  return (
    <div
      ref={ref}
      className="ui-landing-scene ui-landing-closeup"
      role="img"
      aria-label="The Inbox: a question arrives, is opened, answered, and settled"
      {...DESKTOP_SURFACE}
    >
      <div className="ui-landing-closeup-cards" inert>
        <ColumnCard
          bar={
            <Toolbar
              start={TOOLBAR_INSET.COLUMN}
              title={open ? <ThreadPath /> : "Inbox"}
              actions={
                open ? (
                  <MoreButton thing="thread" onClick={still} />
                ) : (
                  <IconButton
                    icon={<SlidersHorizontalIcon />}
                    label="View options"
                    onClick={still}
                  />
                )
              }
            />
          }
        >
          <div className="ui-landing-demo" data-open={open}>
            <div className="ui-landing-demo-list ui-landing-rows">
              <List label="Inbox items">
                {inboxItems(listStep(beat)).map((item) => (
                  <InboxRow key={item.id} item={item} />
                ))}
              </List>
            </div>
            <div className="ui-landing-demo-thread">
              <QuestionThread
                step={threadStep(beat)}
                note={note}
                typing={beat === INBOX_BEAT.TYPE}
              />
            </div>
          </div>
        </ColumnCard>
      </div>
      <DemoPointer point={point} pressed={pressed} />
    </div>
  );
}

/** One call in an agent's log: its glyph, what it did, the agent or file it did it to, and what it said. */
function CallRow({
  icon,
  verb,
  to,
  words,
}: {
  icon: ReactNode;
  verb: string;
  to: ReactNode;
  words?: string;
}): React.JSX.Element {
  return (
    <div className="ui-landing-call ui-landing-enter">
      <LineRow>
        <GlyphSlot size={ICON_SIZE.MEDIUM}>{icon}</GlyphSlot>
        <span className="ui-landing-call-words">
          <span className="ui-landing-call-verb">{verb}</span>
          {to}
          {words === undefined ? null : <span className="ui-landing-call-subject">{words}</span>}
        </span>
      </LineRow>
    </div>
  );
}

/** Another agent's message in the log: its name over its words in a bubble. */
function ReceivedMessage({ sender, words }: { sender: string; words: string }): React.JSX.Element {
  return (
    <MessageFrame className="ui-landing-received ui-landing-enter">
      <MessageHead sender={<AgentPill name={sender} look={INLINE_REF_LOOK.WASH} />} />
      <div className="ui-landing-bubble">
        <Text>{words}</Text>
      </div>
    </MessageFrame>
  );
}

/** A person in a log's words: their face beside their name, as a mention draws them. */
function PersonPill({
  person,
  look = INLINE_REF_LOOK.PILL,
}: {
  person: LandingPerson;
  look?: (typeof INLINE_REF_LOOK)[keyof typeof INLINE_REF_LOOK];
}): React.JSX.Element {
  return (
    <InlineRef
      look={look}
      glyph={
        <Avatar name={person.name} src={person.picture} size={AVATAR_SIZE.INLINE} decorative />
      }
      label={person.name}
      hint={false}
    />
  );
}

/** The member's own message in the log, at its trailing side: their words, a teammate named in them. */
function SentMessage({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <MessageFrame className="ui-landing-sent ui-landing-enter">
      <div className="ui-landing-bubble">
        <Text>{children}</Text>
      </div>
    </MessageFrame>
  );
}

/** A teammate's message in the log: their face and name over their words. */
function TeammateMessage({
  person,
  words,
}: {
  person: LandingPerson;
  words: string;
}): React.JSX.Element {
  return (
    <MessageFrame className="ui-landing-received ui-landing-enter">
      <MessageHead sender={<PersonPill person={person} look={INLINE_REF_LOOK.WASH} />} />
      <div className="ui-landing-bubble">
        <Text>{words}</Text>
      </div>
    </MessageFrame>
  );
}

const ACCEPT_PAGE = "Accept page";
const INVITE_EMAILS = "Invite emails";

/** The task's tab strip: the agent on show, the one it started once it has, and the way to open another. */
function TaskTabs({ step }: { step: number }): React.JSX.Element {
  return (
    <span className="ui-landing-tabs">
      <Tabs label="Task" ground={TABS_GROUND.FRAME}>
        <Tab icon={<WorkingMark />} label={INVITE_EMAILS} selected onSelect={still} />
        {step >= 1 ? (
          <Tab
            icon={step >= 4 ? <HarnessMark provider={MODEL_PROVIDER.ANTHROPIC} /> : <WorkingMark />}
            label={ACCEPT_PAGE}
            selected={false}
            onSelect={still}
          />
        ) : null}
      </Tabs>
      <IconButton icon={<PlusIcon />} label="Open a tab" onClick={still} />
    </span>
  );
}

/** The agent's log at `step`: its words, its folded calls, the other agent's messages, and its working line. */
function AgentLog({ step }: { step: number }): React.JSX.Element {
  const teammate = useLandingTeammate();
  const calls = step >= 3 ? 3 : step >= 1 ? 2 : 1;

  return (
    <div className="ui-landing-log">
      <MessageFrame>
        <Text>
          The emails link to the accept page, which isn't built yet, so I'll start an agent on the
          page and wire the emails meanwhile.
        </Text>
      </MessageFrame>
      <Disclosure defaultOpen>
        <DisclosureSummary>{calls === 1 ? "1 tool call" : `${calls} tool calls`}</DisclosureSummary>
        <DisclosureBody>
          <CallRow
            icon={<GLYPH.FILE />}
            verb="Read"
            to={<span className="ui-landing-call-subject">plan.md</span>}
          />
          {step >= 1 ? (
            <CallRow
              icon={<PlayIcon />}
              verb="Started an agent"
              to={<AgentPill name={ACCEPT_PAGE} />}
            />
          ) : null}
          {step >= 3 ? (
            <CallRow
              icon={<SendIcon />}
              verb="Messaged"
              to={<AgentPill name={ACCEPT_PAGE} />}
              words="Link the email to /invites/:token."
            />
          ) : null}
        </DisclosureBody>
      </Disclosure>
      {step >= 2 ? (
        <ReceivedMessage
          sender={ACCEPT_PAGE}
          words="The token column is in, and the page is at /invites/:token."
        />
      ) : null}
      {step >= 4 ? (
        <ReceivedMessage sender={ACCEPT_PAGE} words="#216 is ready for review." />
      ) : null}
      {step >= 5 ? (
        <SentMessage>
          <PersonPill person={teammate} /> can you review #216?
        </SentMessage>
      ) : null}
      {step >= 6 ? <TeammateMessage person={teammate} words="Looks good. Merging it now." /> : null}
      <NoteLine look={NOTE_LINE_LOOK.INSET}>
        <span className="ui-landing-working">
          Working…
          <Time at={STORY_NOW - 14 * MINUTE} now={STORY_NOW} look={TIME_LOOK.DURATION} />
        </span>
      </NoteLine>
    </div>
  );
}

/** A pull request an agent opened, as the log's dock holds it: its glyph, its title, and the lines it adds and removes. */
export function PullRequestCard({
  title,
  added,
  removed,
}: {
  title: string;
  added: number;
  removed: number;
}): React.JSX.Element {
  return (
    <List label="Pull request" variant={LIST_VARIANT.CARD}>
      <ListRow
        leading={
          <span className="ui-landing-pull-request">
            <GLYPH.PULL_REQUEST />
          </span>
        }
        title={title}
        meta={
          <span className="ui-landing-row-marks">
            <CountParts parts={linesCount(added, removed)} />
          </span>
        }
        onPress={still}
      />
    </List>
  );
}

/**
 * The agent's log at `step` under its tabs, or `turning` over to its
 * opening: its finished turn scrolling up and away and the opening arriving
 * under it, stopping where the log starts. Note that the log on show keeps
 * one key through the turn, so its rows never enter again when the turn
 * ends and the loop starts over; the finished turn drawn above it is a
 * copy, whose rows stand still as they arrive. It measures the opening's
 * place as the turn starts, because the finished turn's height comes from
 * its words.
 */
function LogCard({ step, turning }: { step: number; turning: boolean }): React.JSX.Element {
  const reel = useRef<HTMLDivElement>(null);
  const [by, setBy] = useState(0);

  useLayoutEffect(() => {
    const opening = reel.current?.lastElementChild;

    setBy(turning && opening instanceof HTMLElement ? opening.offsetTop : 0);
  }, [turning]);

  return (
    <ColumnCard
      bar={
        <Toolbar
          start={TOOLBAR_INSET.COLUMN}
          look={TOOLBAR_LOOK.TABS}
          title={<TaskTabs step={turning ? 0 : step} />}
          actions={<MoreButton thing="agent" onClick={still} />}
        />
      }
    >
      <div className="ui-landing-log-sheet">
        <div className="ui-landing-log-turn">
          <div
            ref={reel}
            className="ui-landing-log-reel"
            data-turning={(turning && by > 0) || undefined}
            style={cssCustomProperties({ "--ui-landing-turn-by": `${String(by)}px` })}
          >
            {turning ? <AgentLog key="finished" step={AGENTS_STORY.LAST} /> : null}
            <AgentLog key="on-show" step={turning ? 0 : step} />
          </div>
        </div>
      </div>
    </ColumnCard>
  );
}

/**
 * A task close up: the agent's log, where it starts another agent and the
 * two trade messages, then the member tags a teammate to review and the
 * teammate answers in the same log, and the log turns over to the opening
 * it starts from, so the story loops without a cut.
 */
function AgentsScene(): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const played = useStory(ref, AGENTS_STORY.STEPS, BEAT.AGENTS);
  const step = Math.min(played, AGENTS_STORY.LAST);
  // Note that where motion is held the story stands on its last full step, never mid-turn.
  const turning = played === AGENTS_STORY.TURN && !heldStill();

  return (
    <div
      ref={ref}
      className="ui-landing-scene ui-landing-closeup"
      role="img"
      aria-label="A task's agent starting another agent, the two trading messages, and a teammate brought in to review"
      {...DESKTOP_SURFACE}
    >
      <div className="ui-landing-closeup-cards" inert>
        <LogCard step={step} turning={turning} />
      </div>
    </div>
  );
}

/** An automation's run: when it started, what it was, and how it went. */
type Run = {
  readonly id: string;
  readonly ago: number;
  readonly title: string;
  readonly line: string;
};

const RUNS: readonly Run[] = [
  { id: "231", ago: 60 * 24, title: "Quarantine the billing export test", line: "Finished" },
  { id: "228", ago: 60 * 48, title: "Retry the usage alert webhook once", line: "Finished" },
  { id: "224", ago: 60 * 72, title: "Scheduled run", line: "Nothing flaky found" },
];

/** The automation's trigger: weekdays at 2:00 AM in London. */
const SCHEDULE = {
  kind: AUTOMATION_TRIGGER.SCHEDULE,
  cron: "0 2 * * 1-5",
  timezone: "Europe/London",
} as const;

/** A row's chip in a settings card: a field's chevron over `words`. */
function FieldChip({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <Chip look={CHIP_LOOK.FIELD} width={CHIP_WIDTH.MIN_FIELD} chevron onClick={still}>
      <ChipName>{children}</ChipName>
    </Chip>
  );
}

/** The automation's toolbar: the way back to Automations, and its state, run, save, switch, and more. */
function AutomationBar(): React.JSX.Element {
  return (
    <div className="ui-landing-automation-bar">
      <Toolbar
        title={
          <span className="ui-landing-crumb">
            <ZapIcon />
            Automations
          </span>
        }
        actions={
          <>
            <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
              Saved
            </Text>
            <FoldingButton
              label="Run now"
              icon={<PlayIcon />}
              variant={BUTTON_VARIANT.OUTLINE}
              onClick={still}
            />
            <Button variant={BUTTON_VARIANT.PRIMARY} disabled onClick={still}>
              Save
            </Button>
            <Switch checked label="Turn off Nightly flaky-test sweep" onChange={still} />
            <MoreButton thing="Automation" onClick={still} />
          </>
        }
      />
    </div>
  );
}

/** The automation's settings: its title, its trigger, its prompt, and where it runs. */
function AutomationSettings(): React.JSX.Element {
  return (
    <div className="ui-landing-automation-page">
      <div className="ui-landing-automation-title">
        <Avatar
          name="Nightly flaky-test sweep"
          outline={AVATAR_OUTLINE.SQUARE}
          size={AVATAR_SIZE.PAGE}
          glyph={<FiringGlyph of={SCHEDULE} />}
          decorative
        />
        <Text variant={TEXT_VARIANT.TITLE} as={TEXT_ELEMENT.H2}>
          Nightly flaky-test sweep
        </Text>
      </div>
      <SettingsSection title="Trigger">
        <SettingsRow label="Type" description="Every weekday at 2:00 AM, Europe/London">
          {() => <FieldChip>Schedule</FieldChip>}
        </SettingsRow>
      </SettingsSection>
      <SettingsSection title="Prompt" frame={SETTINGS_SECTION_FRAME.NONE}>
        <TextArea
          label="Prompt"
          value="Run the suite three times. Quarantine any test that fails once and passes twice, and open a pull request with the fix you'd make."
          rows={3}
          onChange={still}
        />
      </SettingsSection>
      <SettingsSection title="Where it runs">
        <SettingsRow label="Repository">{() => <FieldChip>{REPOSITORY}</FieldChip>}</SettingsRow>
        <SettingsRow label="Model">
          {() => (
            <FieldChip>
              Opus 5.5 <span className="ui-landing-effort">High</span>
            </FieldChip>
          )}
        </SettingsRow>
      </SettingsSection>
    </div>
  );
}

/** The automation's runs at `step`: a scheduled run firing, working, and finishing on top of the earlier ones. */
function AutomationRuns({ step }: { step: number }): React.JSX.Element {
  const working = step >= 1 && step < 3;

  const latest: Run = {
    id: "236",
    ago: 0,
    title: step >= 3 ? "Wait for the invite email in the accept test" : "Scheduled run",
    line: "Finished",
  };

  const runs = step >= 1 ? [latest, ...RUNS] : RUNS;

  return (
    <aside className="ui-landing-runs">
      <Text as={TEXT_ELEMENT.H2} variant={TEXT_VARIANT.SECTION} tone={TEXT_TONE.MUTED}>
        Runs
      </Text>
      <List label="Runs">
        {runs.map((run) => {
          const running = run.id === latest.id && working;

          return (
            <ListRow
              key={run.id}
              leading={
                <Avatar
                  name={run.title}
                  outline={AVATAR_OUTLINE.SQUARE}
                  size={AVATAR_SIZE.ROW}
                  glyph={running ? <WorkingMark /> : <FiringGlyph of={SCHEDULE} />}
                  decorative
                />
              }
              title={run.title}
              description={running ? "Working" : run.line}
              meta={<Time at={STORY_NOW - run.ago * MINUTE} now={STORY_NOW} hint={false} />}
              metaAt={LIST_ROW_META.TITLE}
              onPress={still}
            />
          );
        })}
      </List>
    </aside>
  );
}

/** The automation's page at `step`, its sidebar folded: its toolbar over its settings beside its runs. */
function AutomationPage({ step }: { step: number }): React.JSX.Element {
  return (
    <div className="ui-landing-app ui-landing-app-folded">
      <div className="ui-landing-main ui-landing-automation">
        <AutomationBar />
        <div className="ui-landing-automation-sheet">
          <AutomationSettings />
          <AutomationRuns step={step} />
        </div>
      </div>
      <span className="ui-landing-title-bar-folded">
        <IconButton icon={<SidebarIcon />} label="Show sidebar" onClick={still} />
        <IconButton icon={<ComposeIcon />} label="New task" onClick={still} />
      </span>
      <SidePanelToggle />
    </div>
  );
}

function AutomationsScene(): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const step = useStory(ref, 5, BEAT.RUNS);

  return (
    <div ref={ref} className="ui-landing-scene">
      <DesktopWindow label="An automation's page, a scheduled run firing and finishing">
        <AutomationPage step={step} />
      </DesktopWindow>
    </div>
  );
}

/** The Inbox as a phone draws it: its bar, its search, its rows, and the bar of places at its foot. */
function PhoneInbox(): React.JSX.Element {
  return (
    <div className="ui-landing-phone-app">
      <Toolbar
        look={TOOLBAR_LOOK.PHONE}
        start={TOOLBAR_INSET.COLUMN}
        end={TOOLBAR_INSET.COLUMN}
        lead={<IconButton icon={<ComposeIcon />} label="New task" onClick={still} />}
        title={
          <Text as={TEXT_ELEMENT.H1} variant={TEXT_VARIANT.TOOLBAR_TITLE}>
            Inbox
          </Text>
        }
        actions={<MoreButton thing="Inbox" onClick={still} />}
      />
      <search className="ui-landing-search">
        <SearchField label="Search inbox" placeholder="Search inbox" value="" onChange={still} />
      </search>
      <div className="ui-landing-rows">
        <List label="Inbox items">
          {inboxItems(1).map((item) => (
            <InboxRow key={item.id} item={item} />
          ))}
        </List>
      </div>
      <nav className="ui-landing-phone-places" aria-label="Places">
        <BarItems>
          <BarItem
            icon={<InboxIcon />}
            current
            count={{ value: 2, noun: "need you" }}
            onPress={still}
          >
            Inbox
          </BarItem>
          <BarItem icon={<ListTodoIcon />} onPress={still}>
            Tasks
          </BarItem>
          <BarItem icon={<SearchIcon />} onPress={still}>
            Search
          </BarItem>
        </BarItems>
        <BarAction icon={<PlusIcon />} label="New task" onPress={still} />
      </nav>
    </div>
  );
}

function DevicesScene(): React.JSX.Element {
  return (
    <div className="ui-landing-scene ui-landing-devices">
      <div className="ui-landing-devices-window">
        <DesktopWindow label="The Inbox in the Mac app">
          <InboxPage step={2} />
        </DesktopWindow>
      </div>
      <div className="ui-landing-devices-phone">
        <LandingPhone label="The same Inbox on a phone">
          <PhoneInbox />
        </LandingPhone>
      </div>
    </div>
  );
}

/** How many tiles the keys scene's grid sets across, and how many rows. */
const KEY_GRID = { COLUMNS: 7, ROWS: 3 } as const;

/** The tile at the grid's heart, where the product's mark stands between the two harnesses. */
const KEY_HUB = KEY_GRID.COLUMNS + Math.floor(KEY_GRID.COLUMNS / 2);

/** Every tile of the grid, by its place, row by row. */
const KEY_TILES: readonly number[] = Array.from(
  { length: KEY_GRID.COLUMNS * KEY_GRID.ROWS },
  (_, place) => place,
);

/**
 * The keys scene: a grid of tiles fading at its edges, the product's mark
 * lit at its heart between Claude's and OpenAI's, the rest of the tiles
 * empty. It names no plan or key of its own; the words beside it do, as a
 * logo grid on a devtool's page does. A picture, inert.
 */
function KeysScene(): React.JSX.Element {
  const marks = new Map<number, ReactNode>([
    [KEY_HUB - 1, <HarnessMark key="claude" provider={MODEL_PROVIDER.ANTHROPIC} />],
    [KEY_HUB, <ProductMark key="vespin" inherit />],
    [KEY_HUB + 1, <HarnessMark key="codex" provider={MODEL_PROVIDER.OPENAI} />],
  ]);

  return (
    <div
      className="ui-landing-scene ui-landing-keys"
      role="img"
      aria-label={`Claude's and OpenAI's marks lit either side of ${PRODUCT_NAME}'s`}
      {...DESKTOP_SURFACE}
    >
      <div className="ui-landing-key-grid" inert>
        {KEY_TILES.map((tile) => (
          <span
            key={tile}
            className="ui-landing-key-tile"
            data-lit={marks.has(tile) || undefined}
            data-hub={tile === KEY_HUB || undefined}
          >
            {marks.get(tile)}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * The starts' story: how many steps it plays, the last it draws (held a
 * beat), and the step both cards turn over on, the finished pair scrolling
 * away to the opening it starts from, so the loop has no cut.
 */
const STARTS_STORY = { STEPS: 6, LAST: 4, TURN: 5 } as const;

/** What the member asks for from both places, the repository it is asked in, the task the command makes of it, and what the agent posts back. */
const START = {
  CHANNEL: "#eng-web",
  ASK: "the invite link 404s on staging, can you fix it?",
  REPOSITORY: "acme/relay",
  COMMAND: 'vespin task create "Invite link" -F bug.md --start',
  // What `vespin task create` prints once its agent starts (`apps/cli/src/commands/task.ts`).
  ANSWER: [
    "Created ACME-58 Invite link in acme/relay.",
    "Started agent 4f1c9a2e on claude-opus-5-5 (high).",
  ],
  // What the agent sends the thread itself (`send_slack_message`), since the bot posts none of a turn's words.
  REPLY: "The link was built from the production host. Fixed in acme/relay#412.",
} as const;

/**
 * The bot's reactions on the member's message (`STATUS_EMOJI`): 👀 while
 * the agent works, and ✅ once its pull request merges.
 */
const STATUS_REACTION = { WORKING: "👀", MERGED: "✅" } as const;

/** The clipboard's act for a card nothing presses. */
function stillCopy(): Promise<void> {
  return Promise.resolve();
}

/** A part a later step shows: drawn from the opening, and held invisible until `shown`, so its card's height never changes. */
function StartsPart({
  shown,
  children,
}: {
  shown: boolean;
  children: ReactNode;
}): React.JSX.Element {
  return <div className={shown ? "ui-landing-enter" : "ui-landing-starts-held"}>{children}</div>;
}

/**
 * A Slack thread at `step`: a member's mention of the bot, marked 👀 as its
 * agent starts, the agent's own reply, and ✅ once its pull request merges.
 */
function SlackThread({ step }: { step: number }): React.JSX.Element {
  const member = useLandingMember();
  const reaction = step >= 3 ? STATUS_REACTION.MERGED : STATUS_REACTION.WORKING;

  return (
    <Card look={CARD_LOOK.SURFACE}>
      <div className="ui-landing-starts-cards">
        <span className="ui-landing-crumb">
          <ProviderMark provider={MARK_PROVIDER.SLACK} size={PROVIDER_MARK_SIZE.ICON} />
          {START.CHANNEL}
        </span>
        <Comment author={member} at={STORY_NOW - MINUTE} now={STORY_NOW}>
          <Text>
            <InlineRef look={INLINE_REF_LOOK.PILL} label={`@${PRODUCT_NAME}`} hint={false} />{" "}
            {START.ASK}
          </Text>
          <StartsPart key={reaction} shown={step >= 1}>
            <span className="ui-landing-starts-reactions">
              <Badge>{`${reaction} 1`}</Badge>
            </span>
          </StartsPart>
        </Comment>
        <StartsPart shown={step >= 2}>
          <Comment
            author={{
              name: PRODUCT_NAME,
              outline: AVATAR_OUTLINE.SQUARE,
              glyph: <ProductMark small />,
            }}
            at={STORY_NOW}
            now={STORY_NOW}
          >
            <Text>{START.REPLY}</Text>
          </Comment>
        </StartsPart>
      </div>
    </Card>
  );
}

/** A terminal at `step`: the `vespin` command, and what it prints once its agent starts. */
function StartTerminal({ step }: { step: number }): React.JSX.Element {
  // Note that the lines not yet printed stand as blank ones, so the card keeps its height.
  const printed = step >= 1 ? START.ANSWER : START.ANSWER.map(() => " ");

  return (
    <CodeCard
      glyph={<GLYPH.TERMINAL />}
      title="Terminal"
      titleIs={CODE_CARD_TITLE.WORDS}
      code={[`$ ${START.COMMAND}`, ...printed].join("\n")}
      copied={START.COMMAND}
      copy={stillCopy}
    />
  );
}

/** Both places at `step`: the Slack thread over the terminal. */
function StartsCards({ step }: { step: number }): React.JSX.Element {
  return (
    <div className="ui-landing-starts-cards">
      <SlackThread step={step} />
      <StartTerminal step={step} />
    </div>
  );
}

/**
 * Two ways to start an agent: a Slack mention the bot marks 👀, its agent's
 * own reply in the thread, and ✅ once its pull request merges, over the
 * `vespin` command printing the task and agent it started. Then both turn
 * over, the finished pair scrolling away to the opening it starts from, so
 * the story loops without a cut. Note that the section stands in no device,
 * as the keys' does, so it is made a picture the same way: a reader is told
 * what it shows, and its cards are inert.
 */
function StartsScene(): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const played = useStory(ref, STARTS_STORY.STEPS, BEAT.STARTS);
  const step = Math.min(played, STARTS_STORY.LAST);
  // Note that where motion is held the story stands on its last full step, never mid-turn.
  const turning = played === STARTS_STORY.TURN && !heldStill();

  return (
    <div
      ref={ref}
      className="ui-landing-scene ui-landing-starts"
      role="img"
      aria-label={`A Slack message mentioning @${PRODUCT_NAME} and a vespin command in a terminal, each starting an agent`}
      {...DESKTOP_SURFACE}
    >
      <div className="ui-landing-starts-turn" inert>
        <div className="ui-landing-starts-reel" data-turning={turning || undefined}>
          {turning ? (
            <div className="ui-landing-starts-finished">
              <StartsCards step={STARTS_STORY.LAST} />
            </div>
          ) : null}
          <StartsCards key="on-show" step={turning ? 0 : step} />
        </div>
      </div>
    </div>
  );
}

const SCENES: Readonly<Record<LandingScene, () => React.JSX.Element>> = {
  [LANDING_SCENE.INBOX]: InboxScene,
  [LANDING_SCENE.AGENTS]: AgentsScene,
  [LANDING_SCENE.AUTOMATIONS]: AutomationsScene,
  [LANDING_SCENE.DEVICES]: DevicesScene,
  [LANDING_SCENE.KEYS]: KeysScene,
  [LANDING_SCENE.STARTS]: StartsScene,
};

/** The scene that shows `scene`'s feature. */
export function LandingSceneView({ scene }: { scene: LandingScene }): React.JSX.Element {
  const Scene = SCENES[scene];

  return <Scene />;
}
