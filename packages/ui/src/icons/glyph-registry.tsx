import {
  Activity,
  Target,
  AppWindow,
  BookBookmark,
  BookOpen,
  Bot,
  BrainCircuit,
  Building2,
  Calendar,
  CircleArrowOutUpLeft,
  CircleDashed,
  CircleDot,
  CircleDotDashed,
  CircleMinus,
  ClipboardCheck,
  Clock,
  Cloud,
  CornerDownRight,
  Cpu,
  Eraser,
  Eye,
  EyeOff,
  File,
  FileDiff,
  FilePenLine,
  Folder,
  FolderGit,
  FolderInput,
  FolderKanban,
  FoldVertical,
  GitBranch,
  GitPullRequest,
  Globe,
  GripVertical,
  Hash,
  Heading,
  History,
  House,
  KeyRound,
  Layers,
  ListChecks,
  ListEnd,
  ListTodo,
  ListTree,
  Lock,
  MemoryStick,
  MessageSquareHeart,
  MessagesSquare,
  PhoneOff,
  Pin,
  PinOff,
  RotateCcw,
  Server,
  ShieldUser,
  Split,
  Unplug,
  Users,
  Zap,
} from "lucide-react";
import React from "react";

import { McpIcon } from "../face/glyphs.js";
import { MARK_PROVIDER, ProviderMark } from "../marks/provider-mark.js";
import { lucideGlyph } from "./lucide-glyph.js";
import {
  AlertIcon,
  ArchiveIcon,
  BackIcon,
  CircleCheckIcon,
  CloseIcon,
  CommentsIcon,
  CopyIcon,
  DocumentIcon,
  EllipsisIcon,
  ExternalIcon,
  GearIcon,
  InboxIcon,
  LaptopIcon,
  LinkIcon,
  MarkDoneIcon,
  MemoryIcon,
  PencilIcon,
  PlusIcon,
  RetryIcon,
  SearchIcon,
  StopIcon,
  TerminalIcon,
  TrashIcon,
  UnarchiveIcon,
  UserIcon,
  WaveformIcon,
} from "./lucide-glyphs.js";

// `tsx` executes imported workspace-package JSX with the classic runtime.
void React;

/** The GitHub mark, which is what "Open on GitHub" is drawn with. */
function GitHubMarkGlyph(): React.JSX.Element {
  return <ProviderMark provider={MARK_PROVIDER.GITHUB} />;
}

/**
 * glyph-registry.tsx -- every concept the app draws as an icon, and the one
 * glyph that stands for it.
 *
 * One glyph per meaning and one meaning per glyph: a screen that draws a task
 * asks for `GLYPH.TASK` and never picks a drawing, so a task wears the same
 * mark in the sidebar, a tab, a chip, and a menu. A concept is a thing the
 * app has (a task, an agent, a pull request) or an act a control does (copy,
 * stop, open somewhere else). Where the audit found one thing drawn three
 * ways, the entry here is the winner, and where one drawing meant several
 * things, it keeps the one it is most used for and the others have their
 * own row. A state wears its own glyph (`RESOLVED`, `FAILED`, `WITHDRAWN`), and
 * the glyph a state is drawn with is never a thing's: `CircleDot` is a GitHub
 * issue and nothing else.
 *
 * The values are components that take no props, `glyphs.tsx`'s own or
 * Lucide's behind `lucide-glyph.tsx`, so `GlyphIcon` seats any of them alike.
 * A brand's mark is a glyph here only where a concept is the brand: "Open on
 * GitHub" opens GitHub.
 */
export const GLYPH = {
  // Things the app has.
  TASK: lucideGlyph(ListTodo),
  // A task under another, its parent, wherever sub-tasks are named, counted, or added.
  SUB_TASK: lucideGlyph(ListTree),
  AGENT: lucideGlyph(Bot),
  PULL_REQUEST: lucideGlyph(GitPullRequest),
  BRANCH: lucideGlyph(GitBranch),
  PULL_REQUEST_STACK: lucideGlyph(Layers),
  PULL_REQUEST_CHANGES: lucideGlyph(FileDiff),
  PULL_REQUEST_CHAPTERS: lucideGlyph(BookBookmark),
  // A pull request's CI checks, GitHub's Checks tab and its summary.
  CHECKS: lucideGlyph(ClipboardCheck),
  ISSUE: lucideGlyph(CircleDot),
  // A linked GitHub issue whose provider did not answer, so it says no state: neither open nor closed.
  ISSUE_UNREAD: lucideGlyph(CircleDashed),
  FILE: lucideGlyph(File),
  FOLDER: lucideGlyph(Folder),
  // A section a person keeps tasks in, where it was given no glyph of its own.
  SECTION: lucideGlyph(FolderKanban),
  REPOSITORY: lucideGlyph(FolderGit),
  PAGE: lucideGlyph(AppWindow),
  // A heading of a task's description, the section a heading opens, as its chip and its row name it.
  HEADING: lucideGlyph(Heading),
  // A page of the web, outside the app, as a website chip names it.
  WEBSITE: lucideGlyph(Globe),
  DESCRIPTION: DocumentIcon,
  // What one version of a description changed: its changed sections.
  VERSION_CHANGES: lucideGlyph(FilePenLine),
  INBOX: InboxIcon,
  AUTOMATION: lucideGlyph(Zap),
  PERSON: UserIcon,
  PEOPLE: lucideGlyph(Users),
  SKILL: lucideGlyph(BookOpen),
  COMMENT: CommentsIcon,
  // A Slack channel, as the Slack bot's settings list it.
  CHANNEL: lucideGlyph(Hash),
  // A channel only its members see, as Slack marks a private one.
  PRIVATE_CHANNEL: lucideGlyph(Lock),
  // A provider's API key, pasted from its console, beside a plan that signs in.
  API_KEY: lucideGlyph(KeyRound),
  // A thread, the Inbox's item, where no ask of its own says more.
  THREAD: lucideGlyph(MessagesSquare),
  TERMINAL: TerminalIcon,
  MEMORY: MemoryIcon,
  MCP_SERVER: McpIcon,
  CALL: WaveformIcon,
  SETTINGS: GearIcon,
  TIME: lucideGlyph(Clock),
  // A day, as a date's chip and its picker name it; a time of day is TIME's.
  DATE: lucideGlyph(Calendar),
  // The workspace's Home, the page with no task open.
  HOME: lucideGlyph(House),
  // The Admin pages, the service's own view of its accounts and workspaces.
  ADMIN: lucideGlyph(ShieldUser),
  // A workspace, where no tile of its own is drawn.
  WORKSPACE: lucideGlyph(Building2),
  // Where a task's coding agents run: the cloud, a member's Mac running the app, or a host they added.
  CLOUD: lucideGlyph(Cloud),
  DESKTOP: LaptopIcon,
  HOST: lucideGlyph(Server),
  // A cloud sandbox's state, its processors, and its memory, as its Cloud chip's popover lists them.
  SANDBOX_STATE: lucideGlyph(Activity),
  CPU: lucideGlyph(Cpu),
  RAM: lucideGlyph(MemoryStick),
  // A task's or an item's status as a field: what a filter or a grouping is by.
  STATUS: lucideGlyph(CircleDotDashed),
  // An agent's to-do list, the same ticked list a description's to-do block wears.
  TODOS: lucideGlyph(ListChecks),
  // An ask that wants a choice among options, the Inbox's "decide".
  DECIDE: lucideGlyph(Split),
  // Word sent back to the makers of the app, which no comment is.
  FEEDBACK: lucideGlyph(MessageSquareHeart),
  // A message waiting behind an agent's running turn, to open the next one.
  QUEUED: lucideGlyph(ListEnd),
  // A goal an agent works toward across turns until it holds.
  GOAL: lucideGlyph(Target),

  // States.
  DONE: MarkDoneIcon,
  // A thing resolved, a comment thread or an Inbox item, and the Resolve that does it: one mark for the act and the state it leaves, never Close's ×.
  RESOLVED: CircleCheckIcon,
  FAILED: AlertIcon,
  // An Inbox item its agent took back before anyone answered it.
  WITHDRAWN: lucideGlyph(CircleArrowOutUpLeft),

  // Acts.
  ADD: PlusIcon,
  CLOSE: CloseIcon,
  MORE: EllipsisIcon,
  SEARCH: SearchIcon,
  RENAME: PencilIcon,
  DELETE: TrashIcon,
  /** Taking a thing off a list here, which still stands elsewhere: a host, a channel, a repository, a member; never Delete's, which destroys. */
  REMOVE: lucideGlyph(CircleMinus),
  COPY: CopyIcon,
  LINK: LinkIcon,
  STOP: StopIcon,
  END_CALL: lucideGlyph(PhoneOff),
  RETRY: RetryIcon,
  GO_BACK: lucideGlyph(RotateCcw),
  // What was put away and can be opened again: a task's closed and archived agents.
  HISTORY: lucideGlyph(History),
  // The way back to the place above, which `BackButton` alone draws.
  BACK: BackIcon,
  PIN: lucideGlyph(Pin),
  UNPIN: lucideGlyph(PinOff),
  // Something put out of sight, as a development build's branch is for a demo, and brought back.
  HIDE: lucideGlyph(EyeOff),
  SHOW: lucideGlyph(Eye),
  ARCHIVE: ArchiveIcon,
  UNARCHIVE: UnarchiveIcon,
  MOVE: lucideGlyph(FolderInput),
  // Ending a connection to a service, which deletes nothing of it.
  DISCONNECT: lucideGlyph(Unplug),
  // A queued message sent into the turn under way now, rather than waiting for it to end.
  STEER: lucideGlyph(CornerDownRight),
  // The model an agent runs on, which `/model` changes.
  MODEL: lucideGlyph(BrainCircuit),
  // A harness's session folded into a summary of itself to free up its context (`/compact`).
  COMPACT: lucideGlyph(FoldVertical),
  // A harness's session let go, the next message opening a fresh one in the same agent (`/clear`).
  NEW_SESSION: lucideGlyph(Eraser),
  // What a row is dragged by to put it in another place.
  DRAG_HANDLE: lucideGlyph(GripVertical),
  OPEN_EXTERNALLY: ExternalIcon,
  OPEN_ON_GITHUB: GitHubMarkGlyph,
} as const;
