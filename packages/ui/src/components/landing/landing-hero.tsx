import { PRODUCT_NAME } from "@repo/features/product-name";
import { TASK_STATUS, type TaskStatus } from "@repo/features/task-wire";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { cssCustomProperties } from "../../css.js";
import {
  CheckCheckIcon,
  CheckIcon,
  GLYPH,
  ICON_SIZE,
  PlugIcon,
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
import { PROFILE, surfaceAttributes, THEME } from "../../tokens/surface.js";
import { AVATAR_OUTLINE, AVATAR_SIZE, Avatar } from "../avatar/avatar.js";
import { Breadcrumbs } from "../breadcrumbs/breadcrumbs.js";
import { BUTTON_SIZE, BUTTON_VARIANT, IconButton } from "../button/button.js";
import { CHIP_LOOK, Chip, ChipName } from "../chip/chip.js";
import { CHOICE_LOOK, CHOICE_SELECT, ChoiceList } from "../choice-list/choice-list.js";
import { Comment, type CommentAuthor } from "../comment/comment.js";
import { ComposerBody } from "../composer-frame/composer-body.js";
import { ComposerFoot } from "../composer-frame/composer-foot.js";
import { ComposerFrame } from "../composer-frame/composer-frame.js";
import { Disclosure, DisclosureBody, DisclosureSummary } from "../disclosure/disclosure.js";
import { GlyphSlot } from "../glyph-slot/glyph-slot.js";
import { GROUP_HEADING, GROUP_LOOK, GroupHeader } from "../group-header/group-header.js";
import { INLINE_REF_LOOK, InlineRef } from "../inline-ref/inline-ref.js";
import { LineRow } from "../line-button/line-button.js";
import {
  LIST_DENSITY,
  LIST_ROW_CURRENT,
  LIST_ROW_CURRENT_LOOK,
  LIST_ROW_INK,
  LIST_ROW_LEAD,
  LIST_ROW_META,
  LIST_VARIANT,
  List,
  ListRow,
} from "../list-row/list-row.js";
import { useMenu } from "../menu/menu.js";
import { MoreButton } from "../more-button/more-button.js";
import { NAV_ITEM_VARIANT, NavItem } from "../nav-item/nav-item.js";
import {
  PROGRESS_COUNT_LOOK,
  PROGRESS_RING_TONE,
  ProgressCount,
  ProgressRing,
} from "../progress-ring/progress-ring.js";
import { SearchField } from "../search-field/search-field.js";
import { Shimmer } from "../shimmer/shimmer.js";
import { SidebarAccountRow, SidebarFoot, SidebarRule } from "../sidebar/sidebar.js";
import { SplitButton } from "../split-button/split-button.js";
import { TABS_GROUND, Tab, Tabs } from "../tabs/tabs.js";
import { TEXT_ELEMENT, TEXT_TONE, Text } from "../text/text.js";
import { TEXT_VARIANT } from "../text/text-role.js";
import { TEXT_AREA_LOOK, TextArea } from "../text-field/text-field.js";
import { TIME_LOOK, Time } from "../time/time.js";
import { Toolbar } from "../toolbar/toolbar.js";
import { TOOLBAR_INSET } from "../toolbar/toolbar-frame.js";
import { UnreadMark } from "../unread-mark/unread-mark.js";
import { WorkingMark } from "../working-mark/working-mark.js";
import {
  DESKTOP_PLACE,
  DesktopPlaces,
  useLandingMember,
  WorkspaceFace,
} from "./landing-desktop.js";
import { PullRequestCard } from "./landing-scenes.js";
import { MINUTE, STORY_NOW, still, useTimeline, useTyping } from "./landing-story.js";

/**
 * landing-hero.tsx -- the hero's app: our Mac app as it stands today, at its own size, playing a short story on a loop.
 *
 * It is a replica, drawn from the very `@repo/ui` components the panel
 * draws its shell with and laid out as the panel lays them
 * (`packages/panel/src/desktop/desktop-shell.tsx` and the pages under it,
 * whose geometry `landing.css`'s hero app restates): the frame and its
 * traffic lights, the sidebar's places and My tasks, the Inbox beside an
 * opened thread, and a task's tabs over its agent's transcript. It is drawn
 * at the web app's own surface, dark and compact, at one to one wherever
 * the page is wide enough, and scaled down whole on a phone.
 *
 * It is a picture, never a control: nothing in it takes a press, a key, or
 * a scroll. It plays one story on the scene clock (`useTimeline`): the
 * member asks the task's agent for a follow-up, the agent works through its
 * calls, asks a question in the Inbox, the member answers it there, and the
 * agent finishes and opens its pull request. A transcript grows from its
 * foot, its oldest turns passing under its top edge, as the app's does
 * while it follows a running agent.
 */

/** The surface the app draws at: the Mac app's own, dark. */
const APP_SURFACE = surfaceAttributes(PROFILE.DESKTOP, THEME.DARK);

/** The least width the app lays itself out at; a narrower stage scales it down whole. */
const LEAST_WIDTH = 1040;

const _FIRST_NAME = "Sam";

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
  | {
      readonly kind: typeof LINE.YOU;
      readonly id: string;
      readonly words: string;
      readonly at: string;
      /** The thread the words answered, which stands over the bubble. */
      readonly answered?: string;
    }
  | { readonly kind: typeof LINE.AGENT; readonly id: string; readonly words: string }
  | {
      readonly kind: typeof LINE.CALLS;
      readonly id: string;
      readonly calls: readonly Call[];
      /** Whether its calls stand open, as a turn still running shows them. */
      readonly open?: boolean;
    }
  | {
      readonly kind: typeof LINE.WORKED;
      readonly id: string;
      readonly seconds: number;
      readonly at: string;
      readonly last?: boolean;
    }
  | { readonly kind: typeof LINE.WORKING; readonly id: string };

/** A task as the app holds it: where it is listed, its status and marks, its agent, and that agent's transcript. */
type Task = {
  readonly id: string;
  readonly name: string;
  readonly list: (typeof LIST)[keyof typeof LIST];
  readonly status: TaskStatus;
  readonly working: boolean;
  readonly ago: number;
  readonly unread?: boolean;
  readonly progress?: { readonly done: number; readonly total: number };
  readonly agent: string;
  /** How many of the agent's threads wait in the Inbox, which its tab counts. */
  readonly asks?: number;
  readonly lines: readonly Line[];
  readonly pullRequest?: {
    readonly title: string;
    readonly added: number;
    readonly removed: number;
  };
};

/** The sidebar's lists a task stands in. */
const LIST = {
  PINNED: "pinned",
  MINE: "mine",
} as const;

/** The task the app opens on. */
const OPEN_TASK = "invites";

const TASKS: readonly Task[] = [
  {
    id: "invites",
    name: "Teammate invitations",
    list: LIST.PINNED,
    status: TASK_STATUS.IN_PROGRESS,
    working: true,
    ago: 0,
    progress: { done: 3, total: 4 },
    agent: "Teammate invitations",
    asks: 1,
    lines: [],
    pullRequest: {
      title: "#217 feat(invites): invite teammates by email",
      added: 412,
      removed: 38,
    },
  },
  {
    id: "cpu",
    name: "Investigate CPU usage spikes",
    list: LIST.PINNED,
    status: TASK_STATUS.IN_PROGRESS,
    working: true,
    ago: 1,
    unread: true,
    progress: { done: 7, total: 23 },
    agent: "CPU spikes",
    lines: [
      {
        kind: LINE.YOU,
        id: "ask",
        words: "The API's CPU spikes every few minutes. Find out why.",
        at: "Today, 3:41 PM",
      },
      {
        kind: LINE.AGENT,
        id: "found",
        words:
          "The spikes line up with the session sweep, which reads every row to find expired ones. I'm adding an index on expiry and batching the sweep.",
      },
      { kind: LINE.WORKING, id: "working" },
    ],
  },
  {
    id: "rate",
    name: "Stay under GitHub's rate limit",
    list: LIST.PINNED,
    status: TASK_STATUS.IN_PROGRESS,
    working: false,
    ago: 3,
    unread: true,
    progress: { done: 7, total: 10 },
    agent: "Rate limits",
    lines: [
      {
        kind: LINE.YOU,
        id: "ask",
        words: "We keep hitting GitHub's rate limit on big repositories.",
        at: "Today, 2:10 PM",
      },
      {
        kind: LINE.AGENT,
        id: "done",
        words:
          "Pull request lists now use conditional requests, so an unchanged page costs nothing against the limit. Seven of ten sub-tasks are merged.",
      },
      { kind: LINE.WORKED, id: "worked", seconds: 54, at: "Today, 2:31 PM", last: true },
    ],
  },
  {
    id: "digest",
    name: "Weekly digest email",
    list: LIST.PINNED,
    status: TASK_STATUS.IN_PROGRESS,
    working: true,
    ago: 8,
    agent: "Digest template",
    lines: [
      {
        kind: LINE.YOU,
        id: "ask",
        words: "Send each member a weekly digest of what merged.",
        at: "Today, 1:05 PM",
      },
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
    id: "export",
    name: "Billing export",
    list: LIST.MINE,
    status: TASK_STATUS.IN_PROGRESS,
    working: false,
    ago: 60 * 24,
    progress: { done: 0, total: 7 },
    agent: "Billing export",
    lines: [
      {
        kind: LINE.YOU,
        id: "ask",
        words: "Let owners export a month of invoices as CSV.",
        at: "Yesterday, 5:12 PM",
      },
      {
        kind: LINE.AGENT,
        id: "plan",
        words: "I wrote a plan with seven sub-tasks. Approve it and I'll start on the first.",
      },
      { kind: LINE.WORKED, id: "worked", seconds: 48, at: "Yesterday, 5:14 PM", last: true },
    ],
  },
  {
    id: "alerts",
    name: "Usage alerts",
    list: LIST.MINE,
    status: TASK_STATUS.IN_PROGRESS,
    working: false,
    ago: 60 * 24,
    agent: "Usage alerts",
    lines: [
      {
        kind: LINE.YOU,
        id: "ask",
        words: "Email the workspace's owners when usage passes 80% of the plan.",
        at: "Yesterday, 11:20 AM",
      },
      {
        kind: LINE.AGENT,
        id: "done",
        words:
          "Owners get one email per threshold per month, and the alert links to the usage page.",
      },
      { kind: LINE.WORKED, id: "worked", seconds: 32, at: "Yesterday, 11:24 AM", last: true },
    ],
  },
  {
    id: "onboarding",
    name: "Onboarding checklist",
    list: LIST.MINE,
    status: TASK_STATUS.TODO,
    working: false,
    ago: 60 * 24,
    agent: "New agent",
    lines: [],
  },
  {
    id: "search",
    name: "Search across tasks",
    list: LIST.MINE,
    status: TASK_STATUS.IN_PROGRESS,
    working: false,
    ago: 60 * 48,
    progress: { done: 0, total: 6 },
    agent: "Task search",
    lines: [
      {
        kind: LINE.YOU,
        id: "ask",
        words: "Let members search every task's title and description.",
        at: "Wednesday, 9:40 AM",
      },
      {
        kind: LINE.AGENT,
        id: "plan",
        words:
          "Postgres full-text search covers it without a new service. The plan has six sub-tasks.",
      },
      { kind: LINE.WORKED, id: "worked", seconds: 41, at: "Wednesday, 9:43 AM", last: true },
    ],
  },
];

/** How many tasks the member follows, which the sidebar's folded Following counts. */
const FOLLOWING = 4;

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
    line: "3 steps left · Open the mail provider's Domains page and add mail.vespin.dev.",
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
    words: `Going with “Your week at ${PRODUCT_NAME}” as the subject, as you said.`,
  },
];

/** The reader's answer to the question: the option picked, the note, and whether it was sent. */
type Answer = { readonly pick: string | null; readonly note: string; readonly sent: boolean };

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

/** The agent composer's card: `head` over the field, and its foot of attach, where it runs, its tools, the model, its context, dictate, and send, or stop while the agent works and nothing waits to be sent. */
function AgentComposer({
  label,
  words,
  onWords,
  onSend,
  sendable,
  working = false,
  rows,
  head,
}: {
  label: string;
  words: string;
  onWords: (words: string) => void;
  onSend: () => void;
  sendable: boolean;
  working?: boolean | undefined;
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
        stop={working && send === undefined ? { label: "Stop", onStop: still } : undefined}
        tools={
          <>
            <IconButton icon={<PlusIcon />} label="Attach files" onClick={still} />
            <Chip look={CHIP_LOOK.TOOLBAR} onClick={still}>
              <ChipName>
                <span className="ui-hero-chip-words">
                  <span className="ui-hero-cloud">
                    <GLYPH.CLOUD />
                  </span>
                  Cloud
                </span>
              </ChipName>
            </Chip>
            <IconButton icon={<PlugIcon />} label="Forward a port" onClick={still} />
          </>
        }
        actions={
          <>
            <Chip look={CHIP_LOOK.TOOLBAR} chevron onClick={still}>
              <ChipName>
                Opus 5.5 <span className="ui-hero-effort">Medium</span>
              </ChipName>
            </Chip>
            <span className="ui-hero-context">
              <ProgressRing share={0.34} tone={PROGRESS_RING_TONE.MUTED} />
            </span>
            <IconButton icon={<MicrophoneIcon />} label="Dictate" onClick={still} />
          </>
        }
      />
    </ComposerFrame>
  );
}

/** A task's row in the sidebar: its status, its name, bold while unread, and at its end its sub-tasks done, its working mark, and its age. */
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
          {task.working && task.progress === undefined ? <WorkingMark /> : null}
          <Time at={STORY_NOW - task.ago * MINUTE} now={STORY_NOW} hint={false} />
        </span>
      }
      current={current ? LIST_ROW_CURRENT.PAGE : undefined}
      unread={task.unread === true}
      onPress={onOpen}
    />
  );
}

/** The sidebar: the title bar's controls, the workspace, the places, Pinned, Following folded, and My tasks, over the account's foot. */
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
  const member = useLandingMember();
  const openTask = view.place === DESKTOP_PLACE.TASK ? view.task : undefined;

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
            <WorkspaceFace size={AVATAR_SIZE.ROW} />
            {PRODUCT_NAME}
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
            {tasks.filter((task) => task.list === LIST.PINNED).map(row)}
          </List>
        </nav>
        <div className="ui-hero-sidebar-group">
          <GroupHeader
            heading={GROUP_HEADING.NONE}
            look={GROUP_LOOK.HEADING}
            label="Following"
            count={{ value: FOLLOWING, noun: "tasks" }}
          />
        </div>
        <nav className="ui-hero-sidebar-group" aria-label="My tasks">
          <GroupHeader heading={GROUP_HEADING.NONE} label="My tasks" />
          <List label="My tasks" density={LIST_DENSITY.DENSE}>
            {tasks.filter((task) => task.list === LIST.MINE).map(row)}
          </List>
        </nav>
      </div>
      <SidebarFoot>
        <SidebarAccountRow>
          <NavItem
            variant={NAV_ITEM_VARIANT.IDENTITY}
            icon={
              <Avatar
                name={member.name}
                src={member.picture}
                size={AVATAR_SIZE.ACCOUNT}
                decorative
              />
            }
          >
            {member.name}
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

/** An opened Inbox item: its subject, its agent's words, the member's answer once sent, and the box under them. */
function InboxThread({ item, answer }: { item: Item; answer: Answer }): React.JSX.Element {
  const member = useLandingMember();
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
            <Comment author={member} at={STORY_NOW} now={STORY_NOW}>
              <QuestionChoices pick={answer.pick} readOnly />
              {answer.note === "" ? null : <Text>{answer.note}</Text>}
            </Comment>
          </li>
        ) : null}
        <li className="ui-hero-comment">
          <Comment author={member} nameRef="You">
            {asking ? (
              <AgentComposer
                label="Add a note"
                words={answer.note}
                onWords={still}
                onSend={still}
                sendable={answer.pick !== null}
                head={
                  <div className="ui-hero-draft-ask">
                    <div className="ui-hero-draft-ask-options">
                      <QuestionChoices pick={answer.pick} readOnly={false} onPick={still} />
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
                words=""
                onWords={still}
                onSend={still}
                sendable={false}
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

/** A turn's foot: how long the agent worked and when, and on the last turn the acts on it. */
function WorkedLine({
  seconds,
  at,
  last,
}: {
  seconds: number;
  at: string;
  last: boolean;
}): React.JSX.Element {
  return (
    <div className="ui-hero-worked">
      <Text tone={TEXT_TONE.MUTED} variant={TEXT_VARIANT.CAPTION}>
        Worked for {seconds}s · {at}
      </Text>
      {last ? (
        <span className="ui-hero-turn-acts">
          <IconButton
            icon={<GLYPH.COPY />}
            label="Copy"
            size={BUTTON_SIZE.COMPACT}
            onClick={still}
          />
          <IconButton
            icon={<GLYPH.LINK />}
            label="Copy link"
            size={BUTTON_SIZE.COMPACT}
            onClick={still}
          />
          <IconButton
            icon={<GLYPH.BRANCH />}
            label="Fork from here"
            size={BUTTON_SIZE.COMPACT}
            onClick={still}
          />
          <IconButton
            icon={<GLYPH.RETRY />}
            label="Retry"
            size={BUTTON_SIZE.COMPACT}
            onClick={still}
          />
        </span>
      ) : null}
    </div>
  );
}

/** A line of the transcript, as the panel's conversation draws it. */
function TranscriptLine({ line }: { line: Line }): React.JSX.Element {
  switch (line.kind) {
    case LINE.YOU:
      return (
        <div className="ui-hero-message ui-hero-message-you ui-hero-enter">
          {line.answered === undefined ? null : (
            <span className="ui-hero-answered">
              <Text as={TEXT_ELEMENT.SPAN} tone={TEXT_TONE.MUTED} variant={TEXT_VARIANT.CAPTION}>
                Answered
              </Text>
              <InlineRef
                look={INLINE_REF_LOOK.PILL}
                glyph={<GLYPH.DECIDE />}
                label={line.answered}
                hint={false}
              />
            </span>
          )}
          <div className="ui-hero-bubble">
            <Text>{line.words}</Text>
          </div>
          <Text tone={TEXT_TONE.MUTED} variant={TEXT_VARIANT.CAPTION}>
            {line.at}
          </Text>
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
        <Disclosure defaultOpen={line.open === true}>
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
      return <WorkedLine seconds={line.seconds} at={line.at} last={line.last === true} />;
    case LINE.WORKING:
      return (
        <span className="ui-hero-working">
          <Shimmer>Working…</Shimmer>
          <Time at={STORY_NOW - 5000} now={STORY_NOW} look={TIME_LOOK.DURATION} />
        </span>
      );
  }
}

/** A task's page: its name on the frame, its agent's tab and the task's checks beside it, the transcript, the dock of its pull request and Inbox, and the follow-up box holding `followUp`. */
function TaskPage({ task, followUp }: { task: Task; followUp: string }): React.JSX.Element {
  const started = task.lines.length > 0;
  const checks = useMenu(false);

  return (
    <div className="ui-hero-page ui-hero-task">
      <div className="ui-hero-bar">
        <span className="ui-hero-task-title">
          <TaskStatusMark status={task.status} />
          {task.name}
        </span>
      </div>
      <div className="ui-hero-task-tabs">
        <span className="ui-hero-tabs">
          <Tabs label="Agents" ground={TABS_GROUND.FRAME}>
            <Tab
              icon={task.working ? <WorkingMark /> : agentFace(task.agent)}
              label={task.agent}
              detail={task.asks === undefined ? undefined : String(task.asks)}
              detailTone={STATUS_TONE.ATTENTION}
              selected
              onSelect={still}
            />
          </Tabs>
          <IconButton icon={<PlusIcon />} label="Open a tab" onClick={still} />
        </span>
        <span className="ui-hero-tabs-end">
          <span className="ui-hero-check">
            <SplitButton
              variant={BUTTON_VARIANT.OUTLINE}
              icon={<CheckIcon />}
              menu={{ label: "More checks", ...checks.trigger() }}
              onClick={still}
            >
              Check
            </SplitButton>
          </span>
          <IconButton icon={<SidePanelIcon />} label="Show side panel" onClick={still} />
        </span>
      </div>
      <section className="ui-hero-sheet ui-hero-agent" aria-label={task.name}>
        <div className="ui-hero-log">
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
          {task.asks === undefined ? null : (
            <List label="Inbox" variant={LIST_VARIANT.CARD}>
              <ListRow
                leading={<GLYPH.INBOX />}
                title="Inbox"
                meta={<span className="ui-hero-asks">{task.asks}</span>}
                onPress={still}
              />
            </List>
          )}
          <AgentComposer
            label={started ? "Send a follow-up" : "Ask to make changes"}
            words={followUp}
            onWords={still}
            onSend={still}
            sendable={followUp.trim() !== ""}
            working={task.working}
          />
        </div>
      </section>
    </div>
  );
}

/** The story's beats, in order, each held its own while (`STORY_BEATS`). */
const BEAT = {
  OPEN: 0,
  TYPE: 1,
  SEND: 2,
  READ: 3,
  EDIT: 4,
  TEST: 5,
  ASK: 6,
  INBOX: 7,
  PICK: 8,
  ANSWER: 9,
  BACK: 10,
  FIX: 11,
  DONE: 12,
} as const;

/** How long each beat holds, in milliseconds, by its place in `BEAT`: long enough to read what it adds. */
const STORY_BEATS: readonly number[] = [
  1600, 4200, 900, 800, 800, 1000, 2000, 1400, 1100, 1300, 1100, 1300, 4000,
];

/** The follow-up the member types to the task's agent. */
const FOLLOW_UP = "Also send a reminder if an invite hasn't been accepted after three days.";

/** The option the member picks in the Inbox. */
const PICKED = "both";

/** The task's transcript as the story opens: the ask, the plan, its calls, and the first turn's end. */
const OPENING: readonly Line[] = [
  {
    kind: LINE.YOU,
    id: "ask",
    words: "Invite teammates by email. Links should expire after a week.",
    at: "Today, 3:41 PM",
  },
  {
    kind: LINE.AGENT,
    id: "plan",
    words:
      "I split this into four sub-tasks: the memberships schema, the invite and accept endpoints, the accept page, and the emails. The first two are merged, and I started an agent on the accept page while I wire the emails.",
  },
  {
    kind: LINE.CALLS,
    id: "calls",
    calls: [
      { id: "plan", icon: <GLYPH.FILE />, verb: "Read", subject: "plan.md" },
      { id: "start", icon: <PlayIcon />, verb: "Started an agent", subject: "Accept page" },
      { id: "mail", icon: <GLYPH.FILE />, verb: "Edited", subject: "server/mail/invite-email.tsx" },
    ],
  },
  {
    kind: LINE.AGENT,
    id: "sent",
    words:
      "Invites now go out through Postmark and expire after seven days. A second accept of the same link reads as no longer valid. #217 is open with the emails.",
  },
  { kind: LINE.WORKED, id: "worked", seconds: 37, at: "Today, 3:55 PM" },
];

/** The reminder turn's calls, one more at each beat from reading to testing. */
const REMINDER_CALLS: readonly Call[] = [
  { id: "read", icon: <GLYPH.FILE />, verb: "Read", subject: "server/mail/invite-email.tsx" },
  { id: "job", icon: <GLYPH.FILE />, verb: "Edited", subject: "server/jobs/invite-reminders.ts" },
  { id: "test", icon: <PlayIcon />, verb: "Ran", subject: "pnpm test invites" },
];

/** The turn after the answer: its calls. */
const WITHDRAW_CALLS: readonly Call[] = [
  {
    id: "route",
    icon: <GLYPH.FILE />,
    verb: "Edited",
    subject: "server/routes/invites/withdraw.ts",
  },
  { id: "test", icon: <PlayIcon />, verb: "Ran", subject: "pnpm test invites" },
];

/** The task's transcript at `beat`: the opening, then each line the story has reached. */
function storyLines(beat: number): readonly Line[] {
  const lines: Line[] = [...OPENING];
  const reached = (at: number) => beat >= at;

  if (reached(BEAT.SEND))
    lines.push({ kind: LINE.YOU, id: "reminder", words: FOLLOW_UP, at: "Today, 4:24 PM" });

  if (reached(BEAT.READ)) {
    const shown = Math.min(beat - BEAT.READ + 1, REMINDER_CALLS.length);

    lines.push({
      kind: LINE.CALLS,
      id: "reminder-calls",
      calls: REMINDER_CALLS.slice(0, shown),
      open: true,
    });
  }

  if (reached(BEAT.ASK)) {
    lines.push({
      kind: LINE.AGENT,
      id: "ask-withdraw",
      words:
        "The reminder job is in. Before I wire the withdraw route: who should be able to withdraw an invite? I asked in your Inbox.",
    });
  }

  if (reached(BEAT.BACK)) {
    lines.push({
      kind: LINE.YOU,
      id: "answer",
      words: "Chose \u201cBoth\u201d.",
      at: "Today, 4:26 PM",
      answered: "Who can withdraw an invite?",
    });
  }

  if (reached(BEAT.FIX))
    lines.push({ kind: LINE.CALLS, id: "withdraw-calls", calls: WITHDRAW_CALLS, open: true });

  if (reached(BEAT.DONE)) {
    lines.push({
      kind: LINE.AGENT,
      id: "done",
      words:
        "An invite left unaccepted gets one reminder after three days, and its sender or any admin can withdraw it. #217 is ready for review.",
    });
    lines.push({
      kind: LINE.WORKED,
      id: "worked-2",
      seconds: 52,
      at: "Today, 4:27 PM",
      last: true,
    });
  }

  // Note that the agent works from the sent follow-up to its answer and again after it, so its working line stands at the foot then.
  const working =
    (reached(BEAT.SEND) && !reached(BEAT.ASK)) || (reached(BEAT.BACK) && !reached(BEAT.DONE));

  if (working) lines.push({ kind: LINE.WORKING, id: "working" });

  return lines;
}

/** A task the story is still writing, before it is handed to the page. */
type StoryTask = { -readonly [Key in keyof Task]: Task[Key] };

/** The open task at `beat`: its transcript, whether its agent works, its Inbox count, its sub-tasks, and its pull request once ready. */
function storyTask(task: Task, beat: number): Task {
  const done = beat >= BEAT.DONE;
  const { asks: _asks, pullRequest, ...rest } = task;

  const shown: StoryTask = {
    ...rest,
    lines: storyLines(beat),
    working: beat >= BEAT.SEND && !done && !(beat >= BEAT.ASK && beat < BEAT.BACK),
    status: done ? TASK_STATUS.DONE : TASK_STATUS.IN_PROGRESS,
    progress: { done: done ? 4 : 3, total: 4 },
  };

  // Note that the question counts on the agent's tab only while it waits on the member.
  if (beat >= BEAT.ASK && beat < BEAT.ANSWER) shown.asks = 1;

  if (done && pullRequest !== undefined) shown.pullRequest = pullRequest;

  return shown;
}

/** Where the story stands the app at `beat`: the task, the Inbox while the member answers, and the task again. */
function storyView(beat: number): View {
  return beat >= BEAT.INBOX && beat < BEAT.BACK
    ? { place: DESKTOP_PLACE.INBOX }
    : { place: DESKTOP_PLACE.TASK, task: OPEN_TASK };
}

/** The Mac app the hero shows, playing its story on a loop: a picture, inert. */
export function LandingHeroApp(): React.JSX.Element {
  const fit = useAppFit();
  const app = useRef<HTMLDivElement>(null);
  const beat = useTimeline(app, STORY_BEATS);
  const typed = useTyping(FOLLOW_UP, beat === BEAT.TYPE, false);
  const view = storyView(beat);
  const tasks = TASKS.map((task) => (task.id === OPEN_TASK ? storyTask(task, beat) : task));

  const answer: Answer = {
    pick: beat >= BEAT.PICK ? PICKED : null,
    note: "",
    sent: beat >= BEAT.ANSWER,
  };

  // Note that the question reaches the Inbox only when the agent asks it.
  const items = ITEMS.filter((item) => item.id !== QUESTION_ID || beat >= BEAT.ASK);

  const settledLine = (item: Item) =>
    item.id === QUESTION_ID && answer.sent ? answerLine(answer.pick) : null;

  const needYou = items.filter(
    (item) => item.ask !== ASK.SETTLED && item.ask !== ASK.NOTICE && settledLine(item) === null,
  ).length;

  const inboxPage = (): ReactNode => {
    const item = items.find((each) => each.id === QUESTION_ID);
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
            <div className="ui-hero-inbox-rows">
              <List label="Inbox items">
                {items.map((each) => (
                  <InboxRow
                    key={each.id}
                    item={each}
                    task={tasks.find((owner) => owner.id === each.task)}
                    settled={settledLine(each)}
                    current={each.id === QUESTION_ID}
                    onOpen={still}
                  />
                ))}
              </List>
            </div>
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
          <div className="ui-hero-inbox-item-body">
            {item === undefined ? null : <InboxThread item={item} answer={answer} />}
          </div>
        </section>
      </div>
    );
  };

  const page = (): ReactNode => {
    if (view.place === DESKTOP_PLACE.INBOX) return inboxPage();

    const task = tasks.find((each) => each.id === OPEN_TASK);

    if (task === undefined) return null;

    return <TaskPage task={task} followUp={beat === BEAT.TYPE ? typed : ""} />;
  };

  return (
    <section
      ref={fit.ref}
      className="ui-hero-app-room"
      role="img"
      aria-label="The Mac app: an agent works through a follow-up, asks a question in the Inbox, is answered, and opens its pull request"
      style={fit.style}
      data-scaled={fit.scale < 1}
    >
      <div ref={app} className="ui-hero-app" inert {...APP_SURFACE}>
        <Sidebar view={view} tasks={tasks} needYou={needYou} go={still} />
        <main className="ui-hero-main" data-page={view.place}>
          {page()}
        </main>
      </div>
    </section>
  );
}
