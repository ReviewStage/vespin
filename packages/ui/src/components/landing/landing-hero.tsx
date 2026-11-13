import { TASK_STATUS, type TaskStatus } from "@repo/features/task-wire";
import { type ReactNode, type RefObject, useEffect, useRef, useState } from "react";
import { cssCustomProperties } from "../../css.js";
import {
  CheckCheckIcon,
  CheckIcon,
  GLYPH,
  ICON_SIZE,
  SlidersHorizontalIcon,
  SquareCheckIcon,
} from "../../icons/icons.js";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ChevronDownIcon,
  CommentsIcon,
  ComposeIcon,
  GearIcon,
  MicrophoneIcon,
  PlayIcon,
  PlusIcon,
  SidebarIcon,
  SidePanelIcon,
} from "../../icons/lucide-glyphs.js";
import { HarnessMark } from "../../marks/harness-mark.js";
import { TaskStatusMark } from "../../marks/task-marks.js";
import { STATUS_TONE } from "../../status-tone.js";
import { DENSITY, PROFILE, surfaceAttributes, THEME } from "../../tokens/surface.js";
import { AVATAR_OUTLINE, AVATAR_SIZE, Avatar } from "../avatar/avatar.js";
import { Breadcrumbs } from "../breadcrumbs/breadcrumbs.js";
import { BUTTON_SIZE, IconButton } from "../button/button.js";
import { CHIP_LOOK, Chip, ChipName } from "../chip/chip.js";
import { CHOICE_LOOK, CHOICE_SELECT, ChoiceList } from "../choice-list/choice-list.js";
import { Comment, type CommentAuthor } from "../comment/comment.js";
import { ComposerBody } from "../composer-frame/composer-body.js";
import { ComposerFoot } from "../composer-frame/composer-foot.js";
import { ComposerFrame } from "../composer-frame/composer-frame.js";
import { DetailPage } from "../detail-page/detail-page.js";
import { Disclosure, DisclosureBody, DisclosureSummary } from "../disclosure/disclosure.js";
import { GlyphSlot } from "../glyph-slot/glyph-slot.js";
import { GROUP_HEADING, GROUP_LOOK, GroupHeader } from "../group-header/group-header.js";
import { LineRow } from "../line-button/line-button.js";
import {
  LIST_DENSITY,
  LIST_ROW_CURRENT,
  LIST_ROW_CURRENT_LOOK,
  LIST_ROW_INK,
  LIST_ROW_LEAD,
  LIST_ROW_META,
  List,
  ListRow,
} from "../list-row/list-row.js";
import { MoreButton } from "../more-button/more-button.js";
import { NAV_ITEM_VARIANT, NavItem } from "../nav-item/nav-item.js";
import { PAGE_FRAME } from "../page-frame/page-frame.js";
import { PROGRESS_COUNT_LOOK, ProgressCount } from "../progress-ring/progress-ring.js";
import { SearchField } from "../search-field/search-field.js";
import { Shimmer } from "../shimmer/shimmer.js";
import { SidebarAccountRow, SidebarFoot, SidebarRule } from "../sidebar/sidebar.js";
import { TABS_GROUND, Tab, Tabs } from "../tabs/tabs.js";
import { TEXT_ELEMENT, TEXT_TONE, Text } from "../text/text.js";
import { TEXT_VARIANT } from "../text/text-role.js";
import { TEXT_AREA_LOOK, TextArea } from "../text-field/text-field.js";
import { Time } from "../time/time.js";
import { Toolbar } from "../toolbar/toolbar.js";
import { TOOLBAR_INSET, TOOLBAR_LOOK } from "../toolbar/toolbar-frame.js";
import { UnreadMark } from "../unread-mark/unread-mark.js";
import { WorkingMark } from "../working-mark/working-mark.js";
import { DESKTOP_PLACE, DesktopPlaces } from "./landing-desktop.js";
import { PullRequestCard } from "./landing-scenes.js";
import { MINUTE, STORY_NOW, still } from "./landing-story.js";

/**
 * landing-hero.tsx -- the hero's app: our Mac app as it stands today, at its own size, which a reader clicks through.
 *
 * It is a replica, drawn from the very `@repo/ui` components the panel
 * draws its shell with and laid out as the panel lays them
 * (`packages/panel/src/desktop/desktop-shell.tsx` and the pages under it,
 * whose geometry `landing.css`'s hero app restates): the frame and its
 * traffic lights, the sidebar's places and My tasks, Home's composer over
 * the Inbox, the Inbox beside an opened thread, and a task's tabs over its
 * agent's transcript. It is drawn at the web app's own surface, dark and
 * compact, at one to one wherever the page is wide enough, and scaled down
 * whole on a phone. Nothing is sent anywhere: what the reader writes stays
 * in this component's state, where Home's composer starts a task, a thread
 * takes an answer or a reply, and a task a follow-up.
 */

/** The surface the app draws at: the web app's, dark. */
const APP_SURFACE = surfaceAttributes(PROFILE.WEB, THEME.DARK, DENSITY.COMPACT);

/** The least width the app lays itself out at; a narrower stage scales it down whole. */
const LEAST_WIDTH = 1040;

const WORKSPACE = "acme";
const MEMBER = "Sam Reyes";
const FIRST_NAME = "Sam";

type View =
  | { readonly place: typeof DESKTOP_PLACE.HOME }
  | { readonly place: typeof DESKTOP_PLACE.INBOX }
  | { readonly place: typeof DESKTOP_PLACE.TASK; readonly task: string };

/** A line of an agent's transcript: the reader's bubble, the agent's words, its calls, how long it worked, or its working line. */
const LINE = {
  YOU: "you",
  AGENT: "agent",
  CALLS: "calls",
  WORKED: "worked",
  WORKING: "working",
} as const;

type Call = {
  readonly id: string;
  readonly icon: ReactNode;
  readonly verb: string;
  readonly subject: string;
};

type Line =
  | { readonly kind: typeof LINE.YOU; readonly id: string; readonly words: string }
  | { readonly kind: typeof LINE.AGENT; readonly id: string; readonly words: string }
  | { readonly kind: typeof LINE.CALLS; readonly id: string; readonly calls: readonly Call[] }
  | { readonly kind: typeof LINE.WORKED; readonly id: string; readonly minutes: number }
  | { readonly kind: typeof LINE.WORKING; readonly id: string };

/** A task as the app holds it: its repository, status, agents, and its open agent's transcript. */
type Task = {
  readonly id: string;
  readonly name: string;
  readonly repository: string;
  readonly status: TaskStatus;
  readonly working: boolean;
  readonly ago: number;
  readonly progress?: { readonly done: number; readonly total: number };
  readonly agents: readonly string[];
  readonly lines: readonly Line[];
  readonly pullRequest?: {
    readonly title: string;
    readonly added: number;
    readonly removed: number;
  };
};

const TASKS: readonly Task[] = [
  {
    id: "invites",
    name: "Teammate invitations",
    repository: "relay",
    status: TASK_STATUS.IN_PROGRESS,
    working: true,
    ago: 12,
    progress: { done: 2, total: 4 },
    agents: ["Invite emails", "Accept page"],
    lines: [
      {
        kind: LINE.YOU,
        id: "ask",
        words: "Let members invite teammates by email. The link should expire after seven days.",
      },
      {
        kind: LINE.AGENT,
        id: "plan",
        words:
          "The emails link to an accept page that isn't built yet, so I'll start an agent on the page and wire the emails meanwhile.",
      },
      {
        kind: LINE.CALLS,
        id: "calls",
        calls: [
          { id: "plan", icon: <GLYPH.FILE />, verb: "Read", subject: "plan.md" },
          { id: "start", icon: <PlayIcon />, verb: "Started an agent", subject: "Accept page" },
          {
            id: "schema",
            icon: <GLYPH.FILE />,
            verb: "Edited",
            subject: "db/schema/memberships.ts",
          },
        ],
      },
      {
        kind: LINE.AGENT,
        id: "done",
        words:
          "Invites go out through Postmark and expire after seven days. A second accept of the same link now reads as no longer valid, and a test opens one link twice at once.",
      },
      { kind: LINE.WORKED, id: "worked", minutes: 14 },
    ],
    pullRequest: { title: "#217 Invite emails through Postmark", added: 184, removed: 12 },
  },
  {
    id: "digest",
    name: "Weekly digest email",
    repository: "relay",
    status: TASK_STATUS.IN_PROGRESS,
    working: true,
    ago: 25,
    agents: ["Digest template"],
    lines: [
      { kind: LINE.YOU, id: "ask", words: "Send each member a weekly digest of what merged." },
      {
        kind: LINE.AGENT,
        id: "plan",
        words:
          "The template lists the week's merged pull requests and finished tasks. I'll send a test once the sender domain is verified; I asked you in the Inbox.",
      },
      { kind: LINE.WORKING, id: "working" },
    ],
  },
  {
    id: "alerts",
    name: "Usage alerts",
    repository: "ledger",
    status: TASK_STATUS.IN_PROGRESS,
    working: false,
    ago: 300,
    agents: ["Usage alerts"],
    lines: [
      {
        kind: LINE.YOU,
        id: "ask",
        words: "Email the workspace's owners when usage passes 80% of the plan.",
      },
      {
        kind: LINE.AGENT,
        id: "done",
        words:
          "Owners get one email per threshold per month, and the alert links to the usage page.",
      },
      { kind: LINE.WORKED, id: "worked", minutes: 9 },
    ],
  },
  {
    id: "export",
    name: "Billing export",
    repository: "ledger",
    status: TASK_STATUS.TODO,
    working: false,
    ago: 60 * 24,
    agents: [],
    lines: [],
  },
];

/** The task pinned over My tasks. */
const PINNED = "digest";

/** What an Inbox item asks: a decision, a to-do, a notice, or one that is settled. */
const ASK = {
  DECIDE: "decide",
  DO: "do",
  NOTICE: "notice",
  SETTLED: "settled",
} as const;

type Ask = (typeof ASK)[keyof typeof ASK];

const ASK_GLYPH: Readonly<Record<Ask, ReactNode>> = {
  [ASK.DECIDE]: <GLYPH.DECIDE />,
  [ASK.DO]: <SquareCheckIcon />,
  [ASK.NOTICE]: null,
  [ASK.SETTLED]: <CheckIcon />,
};

/** An Inbox item: its task, the agent that wrote, its title, its preview line, and its words. */
type Item = {
  readonly id: string;
  readonly task: string;
  readonly agent: string;
  readonly title: string;
  readonly line: string;
  readonly ask: Ask;
  readonly ago: number;
  readonly words: string;
};

const QUESTION_ID = "question";

/** The options of the question the reader can answer. */
const OPTIONS = [
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
] as const;

const ITEMS: readonly Item[] = [
  {
    id: QUESTION_ID,
    task: "invites",
    agent: "Invite emails",
    title: "Who can withdraw an invite?",
    line: "The member who sent it / Any admin / Both (recommended)",
    ask: ASK.DECIDE,
    ago: 12,
    words:
      "An invite is a pending memberships row, so withdrawing one deletes it. The description leaves open who may.",
  },
  {
    id: "recorded",
    task: "invites",
    agent: "Accept page",
    title: "Recorded the invite flow",
    line: "Sent an invite, opened it signed out, and joined.",
    ask: ASK.NOTICE,
    ago: 23,
    words:
      "I sent an invite, opened its link signed out, signed up, and landed in the workspace as a member. An expired link shows Ask for a new invite.",
  },
  {
    id: "domain",
    task: "digest",
    agent: "Digest template",
    title: "Verify the digest's sender domain",
    line: "3 steps left · Open the mail provider's Domains page and add relay.example.com.",
    ask: ASK.DO,
    ago: 25,
    words:
      "The digest can't send until the mail provider trusts our domain. Add its three DNS records, then tell me and I'll send a test.",
  },
  {
    id: "migration",
    task: "invites",
    agent: "Invite emails",
    title: "Run the memberships migration on preview?",
    line: "Approve (recommended) / Decline",
    ask: ASK.DECIDE,
    ago: 40,
    words:
      "The pending memberships table is ready. Should I run the migration on the preview database so the accept page can be tried there?",
  },
  {
    id: "subject",
    task: "digest",
    agent: "Digest template",
    title: "The digest's subject line",
    line: "Answered",
    ask: ASK.SETTLED,
    ago: 62,
    words: "Going with “Your week at acme” as the subject, as you said.",
  },
];

/** The reader's answer to the question: the option picked, the note, and whether it was sent. */
type Answer = { readonly pick: string | null; readonly note: string; readonly sent: boolean };

/** Something the reader wrote, by the id it is listed by. */
type Said = { readonly id: number; readonly words: string };

/** `map` with `key` set to `value`. */
function withEntry<Value>(
  map: ReadonlyMap<string, Value>,
  key: string,
  value: Value,
): ReadonlyMap<string, Value> {
  return new Map(map).set(key, value);
}

/** The name a task started from Home takes: its first sentence, a few words of it at most. */
function taskName(words: string): string {
  const sentence = words.split(/[.!?\n]/)[0] ?? words;
  const named = sentence.trim().split(/\s+/).slice(0, 6).join(" ");

  return named.length > 0 ? named.charAt(0).toUpperCase() + named.slice(1) : "New task";
}

/** An agent's face: its name on Claude's square. */
function agentFace(name: string): React.JSX.Element {
  return (
    <Avatar
      name={name}
      outline={AVATAR_OUTLINE.SQUARE}
      size={AVATAR_SIZE.INLINE}
      glyph={<HarnessMark provider="anthropic" />}
      decorative
    />
  );
}

/** An agent as a comment's writer: its name on Claude's square. */
function agentAuthor(name: string): CommentAuthor {
  return { name, outline: AVATAR_OUTLINE.SQUARE, glyph: <HarnessMark provider="anthropic" /> };
}

/** The app's scale: one where the stage is wide enough, less where it scales the app down whole. */
function useAppFit() {
  const ref = useRef<HTMLElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const box = ref.current;

    // Note that a document with no layout, as jsdom's is, keeps the app unscaled, because it has no box to measure.
    if (!box || typeof ResizeObserver === "undefined") return undefined;

    const watch = new ResizeObserver(([entry]) => {
      const room = entry?.contentRect.width ?? LEAST_WIDTH;
      setScale(room > 0 && room < LEAST_WIDTH ? room / LEAST_WIDTH : 1);
    });

    watch.observe(box);

    return () => watch.disconnect();
  }, []);

  return { ref, scale, style: cssCustomProperties({ "--ui-hero-app-fit": scale }) };
}

/**
 * Scrolls the element `ref` names to its end each time `count`, how many
 * lines it holds, grows, so a message the reader sends stands in view
 * rather than under the scroll's edge; the first draw keeps its place.
 */
function useScrollToEnd(ref: RefObject<HTMLDivElement | null>, count: number): void {
  const seen = useRef(count);
  useEffect(() => {
    const log = ref.current;
    const grew = count > seen.current;

    seen.current = count;

    if (log === null || !grew) return;

    log.scrollTo({ top: log.scrollHeight, behavior: "smooth" });
  }, [ref, count]);
}

/** A composer's field: its words, as they change, sent with Return. */
function ComposerField({
  label,
  words,
  onWords,
  onSend,
  rows = 1,
}: {
  label: string;
  words: string;
  onWords: (words: string) => void;
  onSend?: (() => void) | undefined;
  rows?: number | undefined;
}): React.JSX.Element {
  return (
    <ComposerBody>
      <div className="ui-hero-composer-field">
        <TextArea
          label={label}
          value={words}
          placeholder={label}
          look={TEXT_AREA_LOOK.BARE}
          rows={rows}
          onChange={onWords}
          onSubmit={onSend}
        />
      </div>
    </ComposerBody>
  );
}

/** The agent composer's card: `head` over the field, and its foot of attach, where it runs, the model, dictate, and send. */
function AgentComposer({
  label,
  words,
  onWords,
  onSend,
  sendable,
  rows,
  head,
}: {
  label: string;
  words: string;
  onWords: (words: string) => void;
  onSend: () => void;
  sendable: boolean;
  rows?: number | undefined;
  head?: ReactNode;
}): React.JSX.Element {
  const send = sendable ? onSend : undefined;

  return (
    <ComposerFrame>
      {head}
      <ComposerField label={label} words={words} onWords={onWords} onSend={send} rows={rows} />
      <ComposerFoot
        send={{ label: "Send", empty: send === undefined, onSend: send }}
        tools={
          <>
            <IconButton icon={<PlusIcon />} label="Attach files" onClick={still} />
            <Chip look={CHIP_LOOK.TOOLBAR} chevron onClick={still}>
              <ChipName>
                <span className="ui-hero-chip-words">
                  <GLYPH.CLOUD />
                  Cloud
                </span>
              </ChipName>
            </Chip>
          </>
        }
        actions={
          <>
            <Chip look={CHIP_LOOK.TOOLBAR} chevron onClick={still}>
              <ChipName>
                Opus 5.5 <span className="ui-hero-effort">High</span>
              </ChipName>
            </Chip>
            <IconButton icon={<MicrophoneIcon />} label="Dictate" onClick={still} />
          </>
        }
      />
    </ComposerFrame>
  );
}

/** A task's row in the sidebar: its status, its name, and at its end its sub-tasks done, its working mark, and its age. */
function SidebarTaskRow({
  task,
  current,
  onOpen,
}: {
  task: Task;
  current: boolean;
  onOpen: () => void;
}): React.JSX.Element {
  return (
    <ListRow
      motionKey={task.id}
      density={LIST_DENSITY.DENSE}
      ink={LIST_ROW_INK.SIDEBAR}
      leading={<TaskStatusMark status={task.status} />}
      title={task.name}
      meta={
        <span className="ui-hero-row-time">
          {task.progress === undefined ? null : (
            <ProgressCount
              done={task.progress.done}
              total={task.progress.total}
              label="sub-tasks done"
              look={PROGRESS_COUNT_LOOK.BARE}
            />
          )}
          {task.working ? <WorkingMark /> : null}
          <Time at={STORY_NOW - task.ago * MINUTE} now={STORY_NOW} hint={false} />
        </span>
      }
      current={current ? LIST_ROW_CURRENT.PAGE : undefined}
      onPress={onOpen}
    />
  );
}

/** The sidebar: the title bar's controls, the workspace, the places, Pinned and My tasks by repository, and the account's foot. */
function Sidebar({
  view,
  tasks,
  needYou,
  go,
}: {
  view: View;
  tasks: readonly Task[];
  needYou: number;
  go: (view: View) => void;
}): React.JSX.Element {
  const openTask = view.place === DESKTOP_PLACE.TASK ? view.task : undefined;
  const repositories = [...new Set(tasks.map((task) => task.repository))];

  const row = (task: Task) => (
    <SidebarTaskRow
      key={task.id}
      task={task}
      current={task.id === openTask}
      onOpen={() => go({ place: DESKTOP_PLACE.TASK, task: task.id })}
    />
  );

  return (
    <aside className="ui-hero-sidebar">
      <div className="ui-hero-title-bar">
        <span className="ui-hero-lights" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <IconButton icon={<SidebarIcon />} label="Hide sidebar" onClick={still} />
        <span className="ui-hero-history">
          <IconButton icon={<ArrowLeftIcon />} label="Back" onClick={still} />
          <IconButton icon={<ArrowRightIcon />} label="Forward" disabled onClick={still} />
        </span>
      </div>
      <div className="ui-hero-workspace">
        <NavItem variant={NAV_ITEM_VARIANT.IDENTITY} mark={<ChevronDownIcon />}>
          <span className="ui-hero-workspace-ref">
            <Avatar
              name={WORKSPACE}
              size={AVATAR_SIZE.ROW}
              outline={AVATAR_OUTLINE.TILE}
              decorative
            />
            {WORKSPACE}
          </span>
        </NavItem>
        <IconButton
          icon={<ComposeIcon />}
          label="New task"
          onClick={() => go({ place: DESKTOP_PLACE.HOME })}
        />
      </div>
      <div className="ui-hero-sidebar-body">
        <DesktopPlaces
          place={view.place}
          needYou={needYou}
          go={(place) =>
            go(
              place === DESKTOP_PLACE.INBOX
                ? { place: DESKTOP_PLACE.INBOX }
                : { place: DESKTOP_PLACE.HOME },
            )
          }
        />
        <SidebarRule />
        <nav className="ui-hero-sidebar-group" aria-label="Pinned">
          <GroupHeader heading={GROUP_HEADING.NONE} look={GROUP_LOOK.HEADING} label="Pinned" />
          <List label="Pinned" density={LIST_DENSITY.DENSE}>
            {tasks.filter((task) => task.id === PINNED).map(row)}
          </List>
        </nav>
        <nav className="ui-hero-sidebar-group" aria-label="My tasks">
          <GroupHeader heading={GROUP_HEADING.NONE} look={GROUP_LOOK.HEADING} label="My tasks" />
          {repositories.map((repository) => (
            <div key={repository} className="ui-hero-repository">
              <GroupHeader
                heading={GROUP_HEADING.NONE}
                look={GROUP_LOOK.HEADING}
                glyph={<GLYPH.REPOSITORY />}
                label={repository}
              />
              <List label={repository} density={LIST_DENSITY.DENSE}>
                {tasks.filter((task) => task.repository === repository).map(row)}
              </List>
            </div>
          ))}
        </nav>
      </div>
      <SidebarFoot>
        <SidebarAccountRow>
          <NavItem
            variant={NAV_ITEM_VARIANT.IDENTITY}
            icon={<Avatar name={MEMBER} size={AVATAR_SIZE.ACCOUNT} decorative />}
          >
            {MEMBER}
          </NavItem>
          <IconButton icon={<CommentsIcon />} label="Send feedback" onClick={still} />
          <IconButton icon={<GearIcon />} label="Settings" onClick={still} />
        </SidebarAccountRow>
      </SidebarFoot>
    </aside>
  );
}

/** An Inbox item's row as the panel draws it: its task above, the ask's glyph before its last line, its age beside the title. */
function InboxRow({
  item,
  task,
  settled,
  current,
  onOpen,
}: {
  item: Item;
  task: Task | undefined;
  settled: string | null;
  current: boolean;
  onOpen: () => void;
}): React.JSX.Element {
  const ask = settled === null ? item.ask : ASK.SETTLED;
  const glyph = ASK_GLYPH[ask];
  const unread = ask !== ASK.SETTLED && item.ago < 30;

  return (
    <ListRow
      motionKey={item.id}
      ink={LIST_ROW_INK.SIDEBAR}
      currentLook={LIST_ROW_CURRENT_LOOK.TINT}
      leading={<UnreadMark unread={unread} />}
      title={item.title}
      lead={{
        icon: <TaskStatusMark status={task?.status ?? TASK_STATUS.IN_PROGRESS} />,
        label: task?.name ?? "",
      }}
      leadAt={LIST_ROW_LEAD.ABOVE}
      description={
        <span className="ui-hero-line">
          {glyph === null ? null : (
            <span className="ui-hero-line-glyph" data-open={ask !== ASK.SETTLED}>
              {glyph}
            </span>
          )}
          {settled ?? item.line}
        </span>
      }
      meta={<Time at={STORY_NOW - item.ago * MINUTE} now={STORY_NOW} hint={false} />}
      metaAt={LIST_ROW_META.TITLE}
      current={current ? LIST_ROW_CURRENT.PAGE : undefined}
      unread={unread}
      onPress={onOpen}
    />
  );
}

/** The question's options, `pick` checked; numbered while they wait on the reader, a record once sent. */
function QuestionChoices({
  pick,
  readOnly,
  onPick = still,
}: {
  pick: string | null;
  readOnly: boolean;
  onPick?: ((value: string) => void) | undefined;
}): React.JSX.Element {
  return (
    <ChoiceList
      legend="Options"
      options={OPTIONS}
      value={pick === null ? [] : [pick]}
      select={CHOICE_SELECT.ONE}
      look={CHOICE_LOOK.MARKED}
      numbered={!readOnly}
      readOnly={readOnly}
      onChange={(value) => {
        const [picked] = value;

        if (picked !== undefined) onPick(picked);
      }}
    />
  );
}

/** What the answered question's row says: the option picked, and recommended where it was. */
function answerLine(pick: string | null): string {
  const option = OPTIONS.find((each) => each.value === pick);

  if (option === undefined) return "Answered";

  return "badge" in option ? `${option.label} (recommended)` : option.label;
}

/** An opened Inbox item: its subject, its agent's words, the reader's answer and replies, and the box under them. */
function InboxThread({
  item,
  answer,
  setAnswer,
  replies,
  reply,
  onReply,
  onSend,
}: {
  item: Item;
  answer: Answer;
  setAnswer: (update: (answer: Answer) => Answer) => void;
  replies: readonly Said[];
  reply: string;
  onReply: (words: string) => void;
  onSend: () => void;
}): React.JSX.Element {
  const question = item.id === QUESTION_ID;
  const asking = question && !answer.sent;

  return (
    <div className="ui-hero-thread">
      <header className="ui-hero-subject">
        <Text variant={TEXT_VARIANT.DIALOG} as={TEXT_ELEMENT.H2}>
          {item.title}
        </Text>
      </header>
      <ol className="ui-hero-comments">
        <li className="ui-hero-comment">
          <Comment
            author={agentAuthor(item.agent)}
            at={STORY_NOW - item.ago * MINUTE}
            now={STORY_NOW}
          >
            <Text>{item.words}</Text>
          </Comment>
        </li>
        {question && answer.sent ? (
          <li className="ui-hero-comment ui-hero-enter">
            <Comment author={{ name: MEMBER }} at={STORY_NOW} now={STORY_NOW}>
              <QuestionChoices pick={answer.pick} readOnly />
              {answer.note === "" ? null : <Text>{answer.note}</Text>}
            </Comment>
          </li>
        ) : null}
        {replies.map((said) => (
          <li key={said.id} className="ui-hero-comment ui-hero-enter">
            <Comment author={{ name: MEMBER }} at={STORY_NOW} now={STORY_NOW}>
              <Text>{said.words}</Text>
            </Comment>
          </li>
        ))}
        <li className="ui-hero-comment">
          <Comment author={{ name: MEMBER }} nameRef="You">
            {asking ? (
              <AgentComposer
                label="Add a note"
                words={answer.note}
                onWords={(note) => setAnswer((now) => ({ ...now, note }))}
                onSend={() => setAnswer((now) => ({ ...now, note: now.note.trim(), sent: true }))}
                sendable={answer.pick !== null}
                head={
                  <div className="ui-hero-draft-ask">
                    <div className="ui-hero-draft-ask-options">
                      <QuestionChoices
                        pick={answer.pick}
                        readOnly={false}
                        onPick={(pick) => setAnswer((now) => ({ ...now, pick }))}
                      />
                    </div>
                    <IconButton
                      icon={<GLYPH.CLOSE />}
                      label="Resolve without answering"
                      size={BUTTON_SIZE.COMPACT}
                      onClick={still}
                    />
                  </div>
                }
              />
            ) : (
              <AgentComposer
                label="Reply"
                words={reply}
                onWords={onReply}
                onSend={onSend}
                sendable={reply.trim() !== ""}
              />
            )}
          </Comment>
        </li>
      </ol>
    </div>
  );
}

/** One of an agent's calls in its log: its glyph, what it did, and to what. */
function CallRow({ call }: { call: Call }): React.JSX.Element {
  return (
    <LineRow>
      <GlyphSlot size={ICON_SIZE.MEDIUM}>{call.icon}</GlyphSlot>
      <span className="ui-hero-call-words">
        <span className="ui-hero-call-verb">{call.verb}</span>
        <span className="ui-hero-call-subject">{call.subject}</span>
      </span>
    </LineRow>
  );
}

/** A line of the transcript, as the panel's conversation draws it. */
function TranscriptLine({ line }: { line: Line }): React.JSX.Element {
  switch (line.kind) {
    case LINE.YOU:
      return (
        <div className="ui-hero-message ui-hero-message-you ui-hero-enter">
          <div className="ui-hero-bubble">
            <Text>{line.words}</Text>
          </div>
        </div>
      );
    case LINE.AGENT:
      return (
        <div className="ui-hero-message ui-hero-enter">
          <Text>{line.words}</Text>
        </div>
      );
    case LINE.CALLS:
      return (
        <Disclosure>
          <DisclosureSummary>
            {line.calls.length === 1 ? "1 tool call" : `${line.calls.length} tool calls`}
          </DisclosureSummary>
          <DisclosureBody>
            {line.calls.map((call) => (
              <CallRow key={call.id} call={call} />
            ))}
          </DisclosureBody>
        </Disclosure>
      );
    case LINE.WORKED:
      return (
        <Text tone={TEXT_TONE.MUTED} variant={TEXT_VARIANT.CAPTION}>
          Worked for {line.minutes}m
        </Text>
      );
    case LINE.WORKING:
      return (
        <span className="ui-hero-working">
          <Shimmer>Working…</Shimmer>
        </span>
      );
  }
}

/** A task's page: its name on the frame, its agents' tabs, the open agent's transcript, and the follow-up box. */
function TaskPage({
  task,
  followUp,
  onFollowUp,
  onSend,
}: {
  task: Task;
  followUp: string;
  onFollowUp: (words: string) => void;
  onSend: () => void;
}): React.JSX.Element {
  const started = task.lines.length > 0;
  const agents = task.agents.length > 0 ? task.agents : ["New agent"];
  const log = useRef<HTMLDivElement>(null);

  useScrollToEnd(log, task.lines.length);

  return (
    <div className="ui-hero-page ui-hero-task">
      <div className="ui-hero-bar">
        <span className="ui-hero-task-title">
          <TaskStatusMark status={task.status} />
          {task.name}
        </span>
        <span className="ui-hero-bar-end">
          <IconButton icon={<SidePanelIcon />} label="Show side panel" onClick={still} />
        </span>
      </div>
      <div className="ui-hero-task-tabs">
        <Toolbar
          start={TOOLBAR_INSET.COLUMN}
          look={TOOLBAR_LOOK.TABS}
          title={
            <span className="ui-hero-tabs">
              <Tabs label="Agents" ground={TABS_GROUND.FRAME}>
                {agents.map((agent, index) => (
                  <Tab
                    key={agent}
                    icon={task.working && index === 0 ? <WorkingMark /> : agentFace(agent)}
                    label={agent}
                    selected={index === 0}
                    onSelect={still}
                  />
                ))}
              </Tabs>
              <IconButton icon={<PlusIcon />} label="Open a tab" onClick={still} />
            </span>
          }
        />
      </div>
      <section className="ui-hero-sheet ui-hero-agent" aria-label={task.name}>
        <div ref={log} className="ui-hero-log">
          {started ? (
            task.lines.map((line) => <TranscriptLine key={line.id} line={line} />)
          ) : (
            <div className="ui-hero-empty">
              <GlyphSlot size={ICON_SIZE.LARGE}>
                <ComposeIcon />
              </GlyphSlot>
              <Text tone={TEXT_TONE.MUTED}>Describe the task to start an agent on it.</Text>
            </div>
          )}
        </div>
        <div className="ui-hero-agent-foot">
          {task.pullRequest === undefined ? null : (
            <PullRequestCard
              title={task.pullRequest.title}
              added={task.pullRequest.added}
              removed={task.pullRequest.removed}
            />
          )}
          <AgentComposer
            label={started ? "Send a follow-up" : "Ask to make changes"}
            words={followUp}
            onWords={onFollowUp}
            onSend={onSend}
            sendable={followUp.trim() !== ""}
          />
        </div>
      </section>
    </div>
  );
}

/** Home: the welcome over the new task's composer, and `inbox` under it. */
function HomePage({
  draft,
  onDraft,
  onStart,
  inbox,
}: {
  draft: string;
  onDraft: (words: string) => void;
  onStart: () => void;
  inbox: ReactNode;
}): React.JSX.Element {
  return (
    <div className="ui-hero-page ui-hero-home">
      <section className="ui-hero-sheet" aria-label="Home">
        <DetailPage frame={PAGE_FRAME.PAGE} title={`Welcome back, ${FIRST_NAME}`}>
          <div className="ui-hero-new-task">
            <span className="ui-hero-new-task-head">
              <Chip look={CHIP_LOOK.FIELD} chevron onClick={still}>
                <ChipName>
                  <span className="ui-hero-chip-words">
                    <GLYPH.REPOSITORY />
                    acme/relay
                  </span>
                </ChipName>
              </Chip>
            </span>
            <AgentComposer
              label="Describe the task"
              words={draft}
              onWords={onDraft}
              onSend={onStart}
              sendable={draft.trim() !== ""}
              rows={3}
            />
          </div>
          {inbox}
        </DetailPage>
      </section>
    </div>
  );
}

/** The live Mac app the hero shows, opened on Home. */
export function LandingHeroApp(): React.JSX.Element {
  const fit = useAppFit();
  const [view, setView] = useState<View>({ place: DESKTOP_PLACE.HOME });
  const [tasks, setTasks] = useState<readonly Task[]>(TASKS);
  const [openItem, setOpenItem] = useState<string>(QUESTION_ID);
  const [answer, setAnswer] = useState<Answer>({ pick: null, note: "", sent: false });
  const [drafts, setDrafts] = useState<ReadonlyMap<string, string>>(new Map());
  const [replies, setReplies] = useState<ReadonlyMap<string, readonly Said[]>>(new Map());
  const nextId = useRef(0);
  const thread = useRef<HTMLDivElement>(null);

  useScrollToEnd(thread, (replies.get(openItem)?.length ?? 0) + (answer.sent ? 1 : 0));

  const draft = (key: string) => drafts.get(key) ?? "";

  const setDraft = (key: string) => (words: string) =>
    setDrafts((all) => withEntry(all, key, words));

  const fresh = () => {
    nextId.current += 1;

    return nextId.current;
  };

  const sendReply = (key: string) => () => {
    const words = draft(key).trim();

    if (words === "") return;
    const said = { id: fresh(), words };

    setReplies((all) => withEntry(all, key, [...(all.get(key) ?? []), said]));
    setDraft(key)("");
  };

  const sendFollowUp = (taskId: string) => () => {
    const words = draft(taskId).trim();

    if (words === "") return;
    const id = fresh();

    setTasks((all) =>
      all.map((task) =>
        task.id === taskId
          ? {
              ...task,
              working: true,
              agents: task.agents.length > 0 ? task.agents : [taskName(words)],
              lines: [
                ...task.lines.filter((line) => line.kind !== LINE.WORKING),
                { kind: LINE.YOU, id: `you-${id}`, words },
                { kind: LINE.WORKING, id: `working-${id}` },
              ],
            }
          : task,
      ),
    );
    setDraft(taskId)("");
  };

  const startTask = () => {
    const words = draft(DESKTOP_PLACE.HOME).trim();

    if (words === "") return;
    const id = `new-${fresh()}`;

    const task: Task = {
      id,
      name: taskName(words),
      repository: "relay",
      status: TASK_STATUS.IN_PROGRESS,
      working: true,
      ago: 0,
      agents: [taskName(words)],
      lines: [
        { kind: LINE.YOU, id: "ask", words },
        { kind: LINE.WORKING, id: "working" },
      ],
    };

    setTasks((all) => [task, ...all]);
    setDraft(DESKTOP_PLACE.HOME)("");
    setView({ place: DESKTOP_PLACE.TASK, task: id });
  };

  const settledLine = (item: Item) =>
    item.id === QUESTION_ID && answer.sent ? answerLine(answer.pick) : null;

  const needYou = ITEMS.filter(
    (item) => item.ask !== ASK.SETTLED && item.ask !== ASK.NOTICE && settledLine(item) === null,
  ).length;

  const inboxRows = (current: string | null, onOpen: (id: string) => void) => (
    <List label="Inbox items">
      {ITEMS.map((item) => (
        <InboxRow
          key={item.id}
          item={item}
          task={tasks.find((task) => task.id === item.task)}
          settled={settledLine(item)}
          current={item.id === current}
          onOpen={() => onOpen(item.id)}
        />
      ))}
    </List>
  );

  const inboxPage = (): ReactNode => {
    const item = ITEMS.find((each) => each.id === openItem);
    const task = tasks.find((each) => each.id === item?.task);

    return (
      <div className="ui-hero-page ui-hero-inbox">
        <nav className="ui-hero-inbox-list" aria-label="Inbox">
          <div className="ui-hero-bar" />
          <div className="ui-hero-inbox-list-body">
            <div className="ui-hero-inbox-head">
              <SearchField
                label="Search inbox"
                placeholder="Search inbox"
                value=""
                onChange={still}
              />
              <IconButton icon={<CheckCheckIcon />} label="Mark all read" onClick={still} />
              <IconButton icon={<SlidersHorizontalIcon />} label="View options" onClick={still} />
            </div>
            <div className="ui-hero-inbox-rows">{inboxRows(openItem, setOpenItem)}</div>
          </div>
        </nav>
        <section className="ui-hero-inbox-item" aria-label="Inbox item">
          <div className="ui-hero-bar">
            <Toolbar
              start={TOOLBAR_INSET.COLUMN}
              title={
                item === undefined ? undefined : (
                  <Breadcrumbs
                    label="Path"
                    crumbs={[
                      {
                        label: task?.name ?? "",
                        glyph: <TaskStatusMark status={task?.status ?? TASK_STATUS.IN_PROGRESS} />,
                      },
                      { label: item.agent, glyph: agentFace(item.agent) },
                    ]}
                  />
                )
              }
              actions={<MoreButton thing="thread" onClick={still} />}
            />
          </div>
          <div ref={thread} className="ui-hero-inbox-item-body">
            {item === undefined ? null : (
              <InboxThread
                key={item.id}
                item={item}
                answer={answer}
                setAnswer={setAnswer}
                replies={replies.get(item.id) ?? []}
                reply={draft(item.id)}
                onReply={setDraft(item.id)}
                onSend={sendReply(item.id)}
              />
            )}
          </div>
        </section>
      </div>
    );
  };

  const page = (): ReactNode => {
    switch (view.place) {
      case DESKTOP_PLACE.HOME:
        return (
          <HomePage
            draft={draft(DESKTOP_PLACE.HOME)}
            onDraft={setDraft(DESKTOP_PLACE.HOME)}
            onStart={startTask}
            inbox={
              <section className="ui-hero-home-section">
                <GroupHeader
                  heading={GROUP_HEADING.H2}
                  label="Inbox"
                  count={{ value: needYou, noun: "need you", tone: STATUS_TONE.ATTENTION }}
                />
                {inboxRows(null, (id) => {
                  setOpenItem(id);
                  setView({ place: DESKTOP_PLACE.INBOX });
                })}
              </section>
            }
          />
        );
      case DESKTOP_PLACE.INBOX:
        return inboxPage();
      case DESKTOP_PLACE.TASK: {
        const task = tasks.find((each) => each.id === view.task);

        if (task === undefined) return null;

        return (
          <TaskPage
            key={task.id}
            task={task}
            followUp={draft(task.id)}
            onFollowUp={setDraft(task.id)}
            onSend={sendFollowUp(task.id)}
          />
        );
      }
    }
  };

  return (
    <section
      ref={fit.ref}
      className="ui-hero-app-room"
      aria-label="The Mac app, live: click through it"
      style={fit.style}
      data-scaled={fit.scale < 1}
    >
      <div className="ui-hero-app" {...APP_SURFACE}>
        <Sidebar view={view} tasks={tasks} needYou={needYou} go={setView} />
        <main className="ui-hero-main" data-page={view.place}>
          {page()}
        </main>
      </div>
    </section>
  );
}
