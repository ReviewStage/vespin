import { AUTOMATION_TRIGGER } from "@repo/features/automation-wire";
import { MODEL_PROVIDER } from "@repo/features/models-wire";
import { TASK_STATUS, type TaskStatus } from "@repo/features/task-wire";
import { APP_COMMAND, APP_SHORTCUTS } from "@repo/settings/shortcuts";
import { type ReactNode, type RefObject, useRef } from "react";
import {
  CheckCheckIcon,
  CheckIcon,
  GLYPH,
  HistoryIcon,
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
  SidePanelIcon,
} from "../../icons/lucide-glyphs.js";
import { FiringGlyph } from "../../marks/firing-glyph.js";
import { HarnessMark } from "../../marks/harness-mark.js";
import {
  MARK_PROVIDER,
  type MarkProvider,
  PROVIDER_MARK_SIZE,
  ProviderMark,
} from "../../marks/provider-mark.js";
import { TaskStatusMark } from "../../marks/task-marks.js";
import { STATUS_TONE } from "../../status-tone.js";
import { PROFILE, surfaceAttributes, THEME } from "../../tokens/surface.js";
import { AVATAR_SHAPE, AVATAR_SIZE, Avatar } from "../avatar/avatar.js";
import { Badge } from "../badge/badge.js";
import { BarAction, BarItem, BarItems } from "../bar-item/bar-item.js";
import { Breadcrumbs } from "../breadcrumbs/breadcrumbs.js";
import { BUTTON_SIZE, BUTTON_VARIANT, Button, IconButton } from "../button/button.js";
import { Checkbox } from "../checkbox/checkbox.js";
import { CHIP_LOOK, CHIP_WIDTH, Chip, ChipName } from "../chip/chip.js";
import { CountParts, linesCount } from "../choice/count-part.js";
import { CHOICE_LOOK, CHOICE_SELECT, ChoiceList } from "../choice-list/choice-list.js";
import { Comment, type CommentAuthor } from "../comment/comment.js";
import { ComposerBody } from "../composer-frame/composer-body.js";
import { ComposerFoot } from "../composer-frame/composer-foot.js";
import { ComposerFrame } from "../composer-frame/composer-frame.js";
import { Disclosure, DisclosureBody, DisclosureSummary } from "../disclosure/disclosure.js";
import { EmptyState } from "../empty-state/empty-state.js";
import { FoldingButton } from "../folding-button/folding-button.js";
import { GlyphSlot } from "../glyph-slot/glyph-slot.js";
import { GROUP_HEADING, GROUP_LOOK, GroupHeader } from "../group-header/group-header.js";
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
import {
  PROGRESS_COUNT_LOOK,
  PROGRESS_RING_TONE,
  ProgressCount,
  ProgressRing,
} from "../progress-ring/progress-ring.js";
import { SearchField } from "../search-field/search-field.js";
import { SettingsOrderedRows } from "../settings-ordered-rows/settings-ordered-rows.js";
import {
  SETTINGS_ROW_CONTROLS,
  SETTINGS_ROW_STATE,
  SettingsRow,
  SettingsRowMark,
  SettingsRowStateLine,
  SettingsRowUsage,
} from "../settings-row/settings-row.js";
import { SETTINGS_SECTION_FRAME, SettingsSection } from "../settings-section/settings-section.js";
import { Shimmer } from "../shimmer/shimmer.js";
import { Shortcut } from "../shortcut/shortcut.js";
import { Switch } from "../switch/switch.js";
import { TABS_GROUND, Tab, Tabs } from "../tabs/tabs.js";
import { TEXT_ELEMENT, TEXT_TONE, Text } from "../text/text.js";
import { TEXT_VARIANT } from "../text/text-role.js";
import { TEXT_AREA_LOOK, TextArea } from "../text-field/text-field.js";
import { TIME_LOOK, Time } from "../time/time.js";
import { Toolbar } from "../toolbar/toolbar.js";
import { TOOLBAR_INSET, TOOLBAR_LOOK } from "../toolbar/toolbar-frame.js";
import { UnreadMark } from "../unread-mark/unread-mark.js";
import type { UsageMeterRow } from "../usage-meters/usage-meters.js";
import { WorkingMark } from "../working-mark/working-mark.js";
import {
  agentFace,
  DESKTOP_PLACE,
  DesktopSidebar,
  MEMBER,
  MemberFace,
  SidePanelToggle,
  useMemberPicture,
} from "./landing-desktop.js";
import { LandingPhone, LandingWindow } from "./landing-devices.js";
import { MINUTE, STORY_NOW, still, useNarrowPage, useStory } from "./landing-story.js";

/**
 * landing-scenes.tsx -- the landing's moving screens: the app's own components, composed as the panel composes them, stepping through a short story each.
 *
 * Every scene is drawn from `@repo/ui`'s parts in the panel's own
 * arrangement, at the profile the screen stands for: a Mac window draws at
 * the desktop's, the phone at the site's on a phone. The Inbox answers an
 * agent's question in the draft under it; a task's page shows its agent's
 * log, folded calls and all, starting another agent and trading messages
 * with it, then its Overview of sub-tasks and agents; an automation's page fires a run;
 * the phone holds the same Inbox; and Settings › Agents connects Claude on
 * its plan and Codex on an API key. None is pressed: each plays its story on a clock that
 * runs only while it is on screen (`landing-story.ts`). On a page too narrow
 * for a whole window, the Inbox and the task play only from their telling
 * moment, the ask and the hand-off, which is all their crop shows.
 */

/** How long each scene holds a step, in milliseconds. */
const BEAT = { INBOX: 1900, AGENTS: 1800, RUNS: 1700, KEYS: 1500 } as const;

/**
 * A window's story: how many steps it plays, the last it draws (held for the
 * rest), and the steps a narrow page's crop opens and closes on.
 */
const STORY = {
  INBOX: { STEPS: 7, LAST: 5, NARROW_FROM: 2, NARROW_LAST: 5 },
  // Note that a narrow page's crop stops before the Overview, because its crop is the log's.
  AGENTS: { STEPS: 9, LAST: 7, NARROW_FROM: 3, NARROW_LAST: 5 },
} as const;

/** The step a window's `story` draws: all of it on a wide page, from its telling moment on a narrow one. */
function useWindowStory(
  ref: RefObject<HTMLDivElement | null>,
  story: (typeof STORY)[keyof typeof STORY],
  beat: number,
): number {
  const narrow = useNarrowPage(ref);
  const from = narrow ? story.NARROW_FROM : 0;
  return Math.min(
    useStory(ref, story.STEPS - from, beat) + from,
    narrow ? story.NARROW_LAST : story.LAST,
  );
}

/** The scenes the landing plays, by the feature each shows. */
export const LANDING_SCENE = {
  INBOX: "inbox",
  AGENTS: "agents",
  AUTOMATIONS: "automations",
  DEVICES: "devices",
  KEYS: "keys",
} as const;

export type LandingScene = (typeof LANDING_SCENE)[keyof typeof LANDING_SCENE];

/** The Mac app's own surface, which a window's screen is drawn at. */
const DESKTOP_SURFACE = surfaceAttributes(PROFILE.DESKTOP, THEME.DARK);

/** An agent as a comment's writer: its name on the square of the harness it runs in. */
function agentAuthor(name: string): CommentAuthor {
  return {
    name,
    shape: AVATAR_SHAPE.SQUARE,
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
      motionKey={item.id}
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
}: {
  label: string;
  placeholder: string;
  words?: string | undefined;
}): React.JSX.Element {
  return (
    <ComposerBody>
      <div className="ui-landing-composer-field">
        <TextArea
          label={label}
          value={words}
          placeholder={placeholder}
          look={TEXT_AREA_LOOK.BARE}
          rows={1}
          onChange={still}
        />
      </div>
    </ComposerBody>
  );
}

/** A reply's composer: its field over its foot of attach, dictate, and send. */
function ReplyComposer({
  placeholder,
  words,
  sendable,
  children,
}: {
  placeholder: string;
  words?: string | undefined;
  sendable: boolean;
  children?: ReactNode;
}): React.JSX.Element {
  return (
    <ComposerFrame>
      {children}
      <ComposerField label={placeholder} placeholder={placeholder} words={words} />
      <ComposerFoot
        send={{ label: "Send", empty: !sendable }}
        tools={<IconButton icon={<PlusIcon />} label="Attach files" onClick={still} />}
        actions={<IconButton icon={<MicrophoneIcon />} label="Dictate" onClick={still} />}
      />
    </ComposerFrame>
  );
}

/** The reader's draft under the question: its options in the composer, a note, and the new thread's choice. */
function DraftAnswer({ picked, note }: { picked: boolean; note: string }): React.JSX.Element {
  return (
    <>
      <ReplyComposer placeholder="Add a note" words={note} sendable={picked}>
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
function QuestionThread({ step }: { step: number }): React.JSX.Element {
  const sent = step >= 5;
  const memberPicture = useMemberPicture();
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
            <Comment
              author={{ name: MEMBER, picture: memberPicture }}
              at={STORY_NOW}
              now={STORY_NOW}
            >
              <AskChoices picked readOnly />
              <Text>{QUESTION.NOTE}</Text>
            </Comment>
          </li>
        ) : null}
        <li className="ui-landing-comment">
          <Comment author={{ name: MEMBER, picture: memberPicture }} nameRef="You">
            {sent ? (
              <ReplyComposer placeholder="Reply" sendable={false} />
            ) : (
              <DraftAnswer picked={step >= 3} note={step >= 4 ? QUESTION.NOTE : ""} />
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
          <Toolbar end={TOOLBAR_INSET.COLUMN} />
          <div className="ui-landing-sheet-start">
            <div className="ui-landing-inbox-head">
              <search className="ui-landing-inbox-search">
                <SearchField
                  label="Search inbox"
                  placeholder="Search inbox"
                  value=""
                  onChange={still}
                />
              </search>
              <IconButton icon={<CheckCheckIcon />} label="Mark all as read" onClick={still} />
              <IconButton icon={<SlidersHorizontalIcon />} label="View options" onClick={still} />
            </div>
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
              <EmptyState icon={<InboxIcon />}>
                Choose an item, or step with{" "}
                <Shortcut chord={APP_SHORTCUTS[APP_COMMAND.NEXT_INBOX_ITEM].chord} spoken />{" "}
                <Shortcut chord={APP_SHORTCUTS[APP_COMMAND.PREVIOUS_INBOX_ITEM].chord} spoken />
              </EmptyState>
            )}
          </div>
        </section>
      </div>
      {open ? <SidePanelToggle /> : null}
    </div>
  );
}

function InboxScene(): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const step = useWindowStory(ref, STORY.INBOX, BEAT.INBOX);
  return (
    <div ref={ref} className="ui-landing-scene">
      <DesktopWindow label="The Inbox, where an agent's question is answered">
        <InboxPage step={step} />
      </DesktopWindow>
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

const ACCEPT_PAGE = "Accept page";
const INVITE_EMAILS = "Invite emails";
const TASK_NAME = "Teammate invitations";

/** The step the task's name is pressed on, its Overview taking the page from the log. */
const OVERVIEW_FROM = 6;

/** A sub-task in the task's Overview. */
type SubTask = {
  readonly id: string;
  readonly name: string;
  readonly status: TaskStatus;
};

/** The sub-tasks at `step`, each stepping toward done as the story goes. */
function subTasks(step: number): readonly SubTask[] {
  const at = (from: number, to: number): TaskStatus =>
    step >= to ? TASK_STATUS.DONE : step >= from ? TASK_STATUS.IN_PROGRESS : TASK_STATUS.TODO;
  return [
    { id: "schema", name: "Pending memberships schema", status: TASK_STATUS.DONE },
    { id: "endpoints", name: "Invite and accept endpoints", status: TASK_STATUS.DONE },
    { id: "accept", name: ACCEPT_PAGE, status: at(1, 4) },
    { id: "emails", name: "Invite emails through Postmark", status: at(0, 9) },
  ];
}

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
      <IconButton icon={<PlusIcon />} label="New agent" onClick={still} />
    </span>
  );
}

/** The agent's log at `step`: its words, its folded calls, the other agent's messages, and its working line. */
function AgentLog({ step }: { step: number }): React.JSX.Element {
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
      <NoteLine look={NOTE_LINE_LOOK.INSET}>
        <span className="ui-landing-working">
          <Shimmer>Working…</Shimmer>
          <Time at={STORY_NOW - 14 * MINUTE} now={STORY_NOW} look={TIME_LOOK.DURATION} />
        </span>
      </NoteLine>
    </div>
  );
}

/** The log's foot at `step`: the pull request once opened, over the composer with the model the agent runs on. */
function AgentFoot({ step }: { step: number }): React.JSX.Element {
  return (
    <div className="ui-landing-agent-foot">
      {step >= 5 ? (
        <div className="ui-landing-dock ui-landing-enter">
          <List label="Pull request" variant={LIST_VARIANT.CARD}>
            <ListRow
              leading={
                <span className="ui-landing-pull-request">
                  <GLYPH.PULL_REQUEST />
                </span>
              }
              title="#217 Invite emails through Postmark"
              meta={
                <span className="ui-landing-row-marks">
                  <CountParts parts={linesCount(184, 12)} />
                </span>
              }
              onPress={still}
            />
          </List>
        </div>
      ) : null}
      <div className="ui-landing-composer">
        <ComposerFrame>
          <ComposerField label="Follow-up" placeholder="Send a follow-up" />
          <ComposerFoot
            send={{ label: "Send", empty: true }}
            stop={{ label: "Stop", onStop: still }}
            tools={
              <>
                <IconButton icon={<PlusIcon />} label="Attach files" onClick={still} />
                <Badge tone={STATUS_TONE.NEUTRAL} icon={<GLYPH.CLOUD />}>
                  Cloud
                </Badge>
              </>
            }
            actions={
              <>
                <Chip look={CHIP_LOOK.TOOLBAR} chevron onClick={still}>
                  <ChipName>
                    Opus 5.5 <span className="ui-landing-effort">High</span>
                  </ChipName>
                </Chip>
                <IconButton
                  icon={<ProgressRing share={0.38} tone={PROGRESS_RING_TONE.MUTED} />}
                  label="Context usage"
                  onClick={still}
                />
                <IconButton icon={<MicrophoneIcon />} label="Dictate" onClick={still} />
              </>
            }
          />
        </ComposerFrame>
      </div>
    </div>
  );
}

/** The task's Overview at `step`: its name and description over its sub-tasks and its agents. */
function TaskOverview({ step }: { step: number }): React.JSX.Element {
  const tasks = subTasks(step);
  const done = tasks.filter((task) => task.status === TASK_STATUS.DONE).length;
  return (
    <section className="ui-landing-overview" aria-label="Overview">
      <div className="ui-landing-overview-page">
        <Text as={TEXT_ELEMENT.H2} variant={TEXT_VARIANT.TITLE}>
          {TASK_NAME}
        </Text>
        <Text tone={TEXT_TONE.MUTED}>
          Let an admin invite a teammate by email, and let them accept from a link that signs them
          into the workspace.
        </Text>
        <GroupHeader
          heading={GROUP_HEADING.NONE}
          look={GROUP_LOOK.SECTION}
          label="Sub-tasks"
          mark={
            <ProgressCount
              done={done}
              total={tasks.length}
              label={`${done} of ${tasks.length} sub-tasks finished`}
              look={PROGRESS_COUNT_LOOK.BADGE}
            />
          }
          actions={<IconButton icon={<PlusIcon />} label="New sub-task" onClick={still} />}
        >
          <List label="Sub-tasks">
            {tasks.map((task) => (
              <ListRow
                key={task.id}
                motionKey={task.id}
                leading={<TaskStatusMark status={task.status} />}
                title={task.name}
                onPress={still}
              />
            ))}
          </List>
        </GroupHeader>
        <GroupHeader
          heading={GROUP_HEADING.NONE}
          look={GROUP_LOOK.SECTION}
          label="Agents"
          actions={<IconButton icon={<PlusIcon />} label="New agent" onClick={still} />}
        >
          <List label="Agents">
            <ListRow
              leading={<WorkingMark />}
              title={INVITE_EMAILS}
              meta="Opus 5.5"
              onPress={still}
            />
            <ListRow
              leading={agentFace(ACCEPT_PAGE, AVATAR_SIZE.ROW)}
              title={ACCEPT_PAGE}
              meta="Sonnet 5.5"
              onPress={still}
            />
          </List>
        </GroupHeader>
      </div>
    </section>
  );
}

/** The task's own bar across its page: its status and name, which open its Overview in place of its agents. */
function TaskTopbar({ overview }: { overview: boolean }): React.JSX.Element {
  const mark = <TaskStatusMark status={TASK_STATUS.IN_PROGRESS} />;
  return (
    <Toolbar
      start={TOOLBAR_INSET.COLUMN}
      title={TASK_NAME}
      titlePress={{ open: overview, label: "Overview", icon: mark, onPress: still }}
    />
  );
}

/** The task's page at `step`: its bar over the agents' tabs and the log, then, pressed, its Overview. */
function TaskPage({ step }: { step: number }): React.JSX.Element {
  const overview = step >= OVERVIEW_FROM;
  return (
    <div className="ui-landing-app">
      <DesktopSidebar place={DESKTOP_PLACE.TASK} openTask="invites" />
      <div className="ui-landing-main ui-landing-task">
        <TaskTopbar overview={overview} />
        {overview ? (
          <TaskOverview step={step} />
        ) : (
          <section className="ui-landing-agent-log">
            <Toolbar
              start={TOOLBAR_INSET.COLUMN}
              look={TOOLBAR_LOOK.TABS}
              title={<TaskTabs step={step} />}
              actions={<IconButton icon={<HistoryIcon />} label="History" onClick={still} />}
            />
            <div className="ui-landing-sheet-start ui-landing-log-sheet">
              <AgentLog step={step} />
              <AgentFoot step={step} />
            </div>
          </section>
        )}
      </div>
      <SidePanelToggle />
    </div>
  );
}

function AgentsScene(): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const step = useWindowStory(ref, STORY.AGENTS, BEAT.AGENTS);
  return (
    <div ref={ref} className="ui-landing-scene">
      <DesktopWindow label="A task's agent starting another agent and the two trading messages, then the task's Overview of its sub-tasks and agents">
        <TaskPage step={step} />
      </DesktopWindow>
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
            <IconButton icon={<SidePanelIcon />} label="Hide runs" onClick={still} />
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
          shape={AVATAR_SHAPE.SQUARE}
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
        <SettingsRow label="Repository">{() => <FieldChip>acme/relay</FieldChip>}</SettingsRow>
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
              motionKey={run.id}
              leading={
                <Avatar
                  name={run.title}
                  shape={AVATAR_SHAPE.SQUARE}
                  size={AVATAR_SIZE.ROW}
                  glyph={running ? <WorkingMark /> : <FiringGlyph of={SCHEDULE} />}
                  decorative
                />
              }
              title={run.title}
              description={running ? <Shimmer>Working</Shimmer> : run.line}
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
        lead={
          <IconButton
            icon={<MemberFace size={AVATAR_SIZE.ACCOUNT} />}
            label="Account"
            onClick={still}
          />
        }
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

/** A credential under a harness in Settings › Agents: its provider's mark, its name, and its usage windows, or none for a key, which says Ready. */
type KeyCredential = {
  readonly id: string;
  readonly name: string;
  readonly mark: MarkProvider;
  readonly usage?: readonly UsageMeterRow[];
};

/** A harness's card in Settings › Agents: its mark and name over its credentials, which connect at `at`. */
type KeyHarness = {
  readonly id: string;
  readonly name: string;
  readonly mark: ReactNode;
  readonly credentials: readonly KeyCredential[];
  readonly at: number;
};

/** How much of its windows the Claude plan has used at each step, as the turns it runs use them. */
const CLAUDE_USE = [
  { session: 18, week: 41 },
  { session: 26, week: 43 },
  { session: 34, week: 44 },
  { session: 42, week: 46 },
  { session: 49, week: 47 },
] as const;

/** The two harnesses at `step`: Claude's plan using its windows, and Codex's API key arriving on the second step. */
function keyHarnesses(step: number): readonly KeyHarness[] {
  const use = CLAUDE_USE[step % CLAUDE_USE.length] ?? CLAUDE_USE[0];
  return [
    {
      id: "claude",
      name: "Claude",
      mark: <HarnessMark provider={MODEL_PROVIDER.ANTHROPIC} />,
      at: 0,
      credentials: [
        {
          id: "claude-plan",
          name: "Claude plan",
          mark: MARK_PROVIDER.CLAUDE,
          usage: [
            { label: "5-hour", usedPercent: use.session },
            { label: "Weekly", usedPercent: use.week },
          ],
        },
      ],
    },
    {
      id: "codex",
      name: "Codex",
      // Note that Codex is marked by ChatGPT's mark, because its own picture is a file the app serves and the landing does not.
      mark: <ProviderMark provider={MARK_PROVIDER.CHATGPT} />,
      at: 2,
      credentials: [{ id: "codex-key", name: "API key", mark: MARK_PROVIDER.CHATGPT }],
    },
  ];
}

/** Every meter on the page, which each plan's meters line up with as one table. */
const KEY_METERS: readonly UsageMeterRow[] = [
  { label: "5-hour", usedPercent: 100 },
  { label: "Weekly", usedPercent: 100 },
];

/** One credential's row: its mark, its name, its meters or Ready, and its ⋯. */
function KeyCredentialRow({ credential }: { credential: KeyCredential }): React.JSX.Element {
  return (
    <SettingsRow
      leading={<ProviderMark provider={credential.mark} size={PROVIDER_MARK_SIZE.ROW} />}
      label={credential.name}
      description={
        credential.usage === undefined ? (
          <SettingsRowStateLine state={SETTINGS_ROW_STATE.PLAIN}>Ready</SettingsRowStateLine>
        ) : (
          <SettingsRowUsage rows={credential.usage} alignWith={KEY_METERS} />
        )
      }
      controls={SETTINGS_ROW_CONTROLS.BESIDE}
      end={() => <MoreButton thing={credential.name} onClick={still} />}
    />
  );
}

/**
 * Settings › Agents as the app draws it: a card for each harness, its mark,
 * its name, and Add over the plans and keys it runs on. Claude's plan uses
 * its windows as the story runs, and Codex's API key arrives.
 *
 * Note that the section stands in no device, so it is made a picture here as
 * a device makes its screen one: a reader is told what it shows, and its rows
 * are inert, since none of them is ever pressed.
 */
function KeysScene(): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const step = useStory(ref, 5, BEAT.KEYS);
  return (
    <div
      ref={ref}
      className="ui-landing-scene ui-landing-keys"
      role="img"
      aria-label="Settings › Agents: Claude on its Claude plan, its usage meters filling, and Codex on an OpenAI API key"
      {...DESKTOP_SURFACE}
    >
      <div className="ui-landing-keys-cards" inert>
        {keyHarnesses(step).map((harness) => {
          const credentials = step >= harness.at ? harness.credentials : [];
          return (
            <SettingsSection key={harness.id}>
              <SettingsRow
                leading={<SettingsRowMark>{harness.mark}</SettingsRowMark>}
                label={harness.name}
                controls={SETTINGS_ROW_CONTROLS.BESIDE}
              >
                {() => (
                  <Button variant={BUTTON_VARIANT.OUTLINE} onClick={still}>
                    Add
                  </Button>
                )}
              </SettingsRow>
              {credentials.length === 0 ? null : (
                <SettingsOrderedRows
                  label={harness.name}
                  rows={credentials.map((credential) => ({
                    key: credential.id,
                    row: <KeyCredentialRow credential={credential} />,
                  }))}
                />
              )}
            </SettingsSection>
          );
        })}
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
};

/** The scene that shows `scene`'s feature. */
export function LandingSceneView({ scene }: { scene: LandingScene }): React.JSX.Element {
  const Scene = SCENES[scene];
  return <Scene />;
}
