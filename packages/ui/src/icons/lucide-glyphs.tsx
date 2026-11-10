import {
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  AudioLines,
  Bold,
  Bot,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleArrowUp,
  CircleCheck,
  Code,
  CodeXml,
  Copy,
  Download,
  Ellipsis,
  ExternalLink,
  Eye,
  EyeOff,
  FastForward,
  FileText,
  Folder,
  Hand,
  Heading1,
  Heading2,
  Heading3,
  Image,
  Inbox,
  Italic,
  Keyboard,
  Laptop,
  Lightbulb,
  Link,
  List,
  ListChecks,
  ListOrdered,
  Mail,
  Maximize,
  Maximize2,
  MessageSquare,
  MessageSquarePlus,
  Mic,
  Minimize,
  Minimize2,
  Minus,
  Monitor,
  PanelLeft,
  PanelRight,
  Pause,
  Pencil,
  PenLine,
  Pin,
  PinOff,
  Play,
  Plug,
  Plus,
  Rewind,
  RotateCw,
  Search,
  SearchX,
  Settings,
  ShieldAlert,
  ShieldCheck,
  SkipBack,
  SkipForward,
  Square,
  SquareCode,
  SquarePen,
  SquareTerminal,
  Strikethrough,
  Table,
  TextQuote,
  Trash2,
  Type,
  Unlink,
  User,
  X,
} from "lucide-react";

import React from "react";

import { lucideGlyph } from "./lucide-glyph.js";

// `tsx` executes imported workspace-package JSX with the classic runtime.
void React;

/**
 * lucide-glyphs.tsx -- the glyphs `glyphs.tsx` once drew as copies of
 * Lucide's, now Lucide's own, under the names their call sites already import.
 *
 * Every one was Lucide's paths redrawn in our stroke, mostly a step smaller
 * than Lucide's, but three, which were Tabler's (the plug and both pins),
 * each beside a Lucide glyph of the same meaning. They are Lucide's drawing
 * now, in our stroke (`lucide-glyph.tsx`), so there is one drawing of each
 * and every glyph stands at one scale. `RemoveIcon` is Lucide's X at a stroke
 * of its own. A name here goes when the last screen that
 * imports it draws the glyph through `GLYPH` instead. The one name that is
 * no copy is `AgentPlaceholderIcon`, Lucide's robot in the muted ink, which
 * stands where `glyphs.tsx` once held an agent's mark's box empty.
 */

/** Two halves of a plug joined, for the services an account connects: Settings' Integrations page. */
export const PlugIcon = lucideGlyph(Plug, "settings-icon");

/** A push pin: keeps a task at the head of the sidebar. */
export const PinIcon = lucideGlyph(Pin, "icon-button-glyph");

/** The pin struck through: lets a pinned task back among the rest. */
export const UnpinIcon = lucideGlyph(PinOff, "icon-button-glyph");

/** A window with a pane down its right side: the side panel beside the document, shown or hidden. */
export const SidePanelIcon = lucideGlyph(PanelRight, "icon-button-glyph");

/** The window's sidebar, shown or folded away: the side panel's frame with its left column ruled off. */
export const SidebarIcon = lucideGlyph(PanelLeft, "icon-button-glyph");

/** Two arrows out to opposite corners: a pane grown to fill the window. */
export const ExpandIcon = lucideGlyph(Maximize2, "icon-button-glyph");

/** Two arrows in from opposite corners: a full-window pane brought back to its place. */
export const CollapseIcon = lucideGlyph(Minimize2, "icon-button-glyph");

/** An arrow turning round to where it began: tries again what did not land. */
export const RetryIcon = lucideGlyph(RotateCw, "icon-button-glyph");

/** A ring round a mark of exclamation: something did not land. */
export const AlertIcon = lucideGlyph(CircleAlert, "ui-glyph");

/** A magnifier struck through: a place the window cannot show, gone or not the reader's. */
export const NotFoundIcon = lucideGlyph(SearchX, "ui-glyph");

/** A shield round a mark of exclamation, in the warning ink wherever it stands: an agent runs every tool call without asking. */
export const FullAccessIcon = lucideGlyph(ShieldAlert, "ui-glyph text-attention");

/** A raised hand: an agent asks before it edits a file or runs a command, and a call it holds for an answer. */
export const AskFirstIcon = lucideGlyph(Hand, "ui-glyph");

/** A shield round a check: an agent's tool calls left to its CLI's own judgment, which asks where it is unsure. */
export const AutoApproveIcon = lucideGlyph(ShieldCheck, "ui-glyph");

/** A ring round a check: something was done. */
export const CircleCheckIcon = lucideGlyph(CircleCheck, "ui-glyph");

/** An in-tray: something was posted to the Inbox. */
export const InboxIcon = lucideGlyph(Inbox, "ui-glyph");

/** A speech bubble, for a description's comments: the side panel's Comments tab and the summary's row. */
export const CommentsIcon = lucideGlyph(MessageSquare, "icon-button-glyph");

/** A sound wave's bars: a call into an agent, which starts one where none is up. */
export const WaveformIcon = lucideGlyph(AudioLines, "icon-button-glyph");

/**
 * The worker's robot in the muted ink: an agent whose harness is not known
 * yet, until the harness's mark takes its place. Note that it is muted,
 * because beside the harnesses' colored marks a robot in the full ink would
 * read as the agent's own mark rather than a stand-in for one.
 */
export const AgentPlaceholderIcon = lucideGlyph(Bot, "settings-icon text-muted-foreground");

/*
 * The writing glyphs: what the format toolbar, Turn into, and the `/` menu
 * draw for each mark and block, the same set the pull request box's toolbar
 * draws.
 */

/** Bold words. */
export const BoldIcon = lucideGlyph(Bold, "icon-button-glyph");

/** Italic words. */
export const ItalicIcon = lucideGlyph(Italic, "icon-button-glyph");

/** Words struck through. */
export const StrikethroughIcon = lucideGlyph(Strikethrough, "icon-button-glyph");

/** Code among words, two angle brackets. */
export const InlineCodeIcon = lucideGlyph(Code, "icon-button-glyph");

/** Two links of a chain: a link on words. */
export const LinkIcon = lucideGlyph(Link, "icon-button-glyph");

/** The chain broken: a link taken off words. */
export const UnlinkIcon = lucideGlyph(Unlink, "icon-button-glyph");

/** A line of plain text. */
export const TextBlockIcon = lucideGlyph(Type, "icon-button-glyph");

/** A first-level heading. */
export const Heading1Icon = lucideGlyph(Heading1, "icon-button-glyph");

/** A second-level heading. */
export const Heading2Icon = lucideGlyph(Heading2, "icon-button-glyph");

/** A third-level heading. */
export const Heading3Icon = lucideGlyph(Heading3, "icon-button-glyph");

/** A bulleted list. */
export const BulletedListIcon = lucideGlyph(List, "icon-button-glyph");

/** A numbered list. */
export const NumberedListIcon = lucideGlyph(ListOrdered, "icon-button-glyph");

/** A list of things to do, each ticked. */
export const TodoListIcon = lucideGlyph(ListChecks, "icon-button-glyph");

/** Quoted words under a bar. */
export const QuoteIcon = lucideGlyph(TextQuote, "icon-button-glyph");

/** A block of code, brackets in a frame. */
export const CodeBlockIcon = lucideGlyph(SquareCode, "icon-button-glyph");

/** A rule across the page between blocks. */
export const DividerIcon = lucideGlyph(Minus, "icon-button-glyph");

/** A grid of cells under a header row: a table laid into a document. */
export const TableIcon = lucideGlyph(Table, "icon-button-glyph");

/** A speech bubble with a plus: a comment begun on words. */
export const CommentAddIcon = lucideGlyph(MessageSquarePlus, "icon-button-glyph");

/** An open eye: shows a secret's typed characters. */
export const ShowSecretIcon = lucideGlyph(Eye, "icon-button-glyph");

/** The eye struck through: masks a secret's typed characters again. */
export const HideSecretIcon = lucideGlyph(EyeOff, "icon-button-glyph");

/*
 * The everyday controls' glyphs: copy, edit, archive, search, settings, and
 * the rest a row or a toolbar draws beside the registry's Lucide glyphs.
 */

/** Sits beside a provider's name to say it is connected, in the state palette. */
export const CheckIcon = lucideGlyph(Check, "credential-check");

/** A check, drawn as a button's glyph: marks a task done. */
export const MarkDoneIcon = lucideGlyph(Check, "icon-button-glyph");

export const CopyIcon = lucideGlyph(Copy, "icon-button-glyph");

export const PencilIcon = lucideGlyph(Pencil, "icon-button-glyph");

export const TrashIcon = lucideGlyph(Trash2, "icon-button-glyph");

/** A box under its lid: puts an agent, or a task left archived, away under Archived. */
export const ArchiveIcon = lucideGlyph(Archive, "icon-button-glyph");

/** A box with an arrow rising out of it: brings an archived task back. */
export const UnarchiveIcon = lucideGlyph(ArchiveRestore, "icon-button-glyph");

/** The display the app stands on: everything about where and how it is drawn. */
export const DisplayIcon = lucideGlyph(Monitor, "settings-icon");

export const KeyboardIcon = lucideGlyph(Keyboard, "settings-icon");

/** Heads the Updates section: the arrival a newer release waits as. */
export const DownloadIcon = lucideGlyph(Download, "settings-icon");

/** An arrow rising in a circle: the sidebar's way into a newer release. */
export const UpdateIcon = lucideGlyph(CircleArrowUp, "settings-icon");

/** Drawn rather than typed: a ↗ character depends on a font having one. */
export const ExternalIcon = lucideGlyph(ExternalLink, "link-icon");

/** A person: the account the app is signed in as. */
export const UserIcon = lucideGlyph(User, "settings-icon");

/** A magnifier: the list read for the rows that say the typed words. */
export const SearchIcon = lucideGlyph(Search, "search-glyph");

/** Work happening on this Mac: the machine it is happening on. */
export const LaptopIcon = lucideGlyph(Laptop, "filter-icon");

/** The microphone itself — what macOS's own access ask is about. */
export const MicrophoneIcon = lucideGlyph(Mic, "settings-icon");

/** A picture, on the control that attaches one. */
export const ImageIcon = lucideGlyph(Image, "icon-button-glyph");

/** A pencil over an open square: a new piece of work, as every chat app's compose button draws it. */
export const ComposeIcon = lucideGlyph(SquarePen, "icon-button-glyph");

/** An envelope: an email to be sent, as a draft's card is headed. */
export const MailIcon = lucideGlyph(Mail, "icon-button-glyph");

/** A pen over a line: words written to be sent, as a draft bound nowhere in particular is headed. */
export const DraftIcon = lucideGlyph(PenLine, "icon-button-glyph");

/** A cog: the account's row that leads to Settings, drawn the way every app draws settings. */
export const GearIcon = lucideGlyph(Settings, "gear-glyph");

/** A terminal's prompt: the Settings page about the coding agents that run in one. Outline, like the other pages' glyphs. */
export const TerminalIcon = lucideGlyph(SquareTerminal, "settings-icon");

/** A page with its corner turned down and lines of text on it: the task's own document. */
export const DocumentIcon = lucideGlyph(FileText, "icon-button-glyph");

/** A folder with its tab: a repository whose owner's picture is not drawn. */
export const FolderIcon = lucideGlyph(Folder, "icon-button-glyph");

/** Four corners turned out: a video grown to fill the screen. */
export const FullScreenIcon = lucideGlyph(Maximize, "icon-button-glyph");

/** Four corners turned in: a full-screen video brought back to its place. */
export const ExitFullScreenIcon = lucideGlyph(Minimize, "icon-button-glyph");

/** A pair of angle brackets with a slash between them: code. */
export const CodeIcon = lucideGlyph(CodeXml, "icon-button-glyph");

/*
 * The arrows, chevrons, and marks a control points or acts with.
 */

/** Stands down without choosing: the cancel a control becomes mid-action. */
export const CloseIcon = lucideGlyph(X, "icon-button-glyph");

/** Three dots in a row: more actions on the thing it sits beside, in a menu. */
export const EllipsisIcon = lucideGlyph(Ellipsis, "icon-button-glyph");

/** Points back out of one: the control that returns to the front page. */
export const BackIcon = lucideGlyph(ChevronLeft, "icon-button-glyph");

/** Points on, the mirror of `BackIcon`: a calendar's next month. */
export const ForwardIcon = lucideGlyph(ChevronRight, "icon-button-glyph");

/** An arrow pointing left: back to the place the window stood on before. */
export const ArrowLeftIcon = lucideGlyph(ArrowLeft, "icon-button-glyph");

/** An arrow pointing right: forward again to where back came from. */
export const ArrowRightIcon = lucideGlyph(ArrowRight, "icon-button-glyph");

/** An arrow pointing up: a row moved one place up its list. */
export const ArrowUpIcon = lucideGlyph(ArrowUp, "icon-button-glyph");

/** An arrow pointing down: a row moved one place down its list. */
export const ArrowDownIcon = lucideGlyph(ArrowDown, "icon-button-glyph");

/** An arrow up and to the right, set after a link's words: a press leaves the place for another. */
export const ArrowUpRightIcon = lucideGlyph(
  ArrowUpRight,
  "ui-text-link-out ms-[0.12em] inline-block size-[0.78em] align-[-0.02em] opacity-55 transition-opacity duration-(--ui-duration-hover) ease-motion-exit group-hover/text-link:opacity-100 group-focus-visible/text-link:opacity-100",
);

/** A plus: a workspace or an agent that did not exist before the action. */
export const PlusIcon = lucideGlyph(Plus, "icon-button-glyph");

/** A lit bulb: what our agents remember for the workspace. */
export const MemoryIcon = lucideGlyph(Lightbulb, "icon-button-glyph");

/** Points down into a menu: the half of a split button that opens its choices. */
export const ChevronDownIcon = lucideGlyph(ChevronDown, "settings-chevron");

/** Points at a fold's body, turned down by its stylesheet while the fold is open. */
export const FoldChevronIcon = lucideGlyph(ChevronRight, "ui-disclosure-chevron");

/** Points into a submenu beside a menu row, in the chevron's own stroke. */
export const ChevronRightIcon = lucideGlyph(ChevronRight, "settings-chevron");

/*
 * The transport, in Lucide's outlines as every other glyph is.
 */

/** Starts a run: the triangle every transport draws for play. */
export const PlayIcon = lucideGlyph(Play, "control-icon");

/** Holds what is playing: the two bars every transport draws for pause. */
export const PauseIcon = lucideGlyph(Pause, "control-icon");

/** Steps a paused video back one frame: a bar and the play triangle turned toward it. */
export const PreviousFrameIcon = lucideGlyph(SkipBack, "control-icon");

/** Steps a paused video on one frame: the play triangle and a bar it stops at. */
export const NextFrameIcon = lucideGlyph(SkipForward, "control-icon");

/** A video sent back a few seconds: the two triangles every transport draws for rewind. */
export const RewindIcon = lucideGlyph(Rewind, "control-icon");

/** A video sent on a few seconds: the mirror of `RewindIcon`, every transport's fast-forward. */
export const FastForwardIcon = lucideGlyph(FastForward, "control-icon");

/** Stops what is playing or running: Lucide's square, filled, because an outline square reads as a checkbox at a control's size. */
export const StopIcon = lucideGlyph(Square, "control-icon fill-current");

/**
 * Takes one attachment back off the note: Lucide's X at a stroke of its own,
 * because at the eight pixels it is drawn at the shared stroke thins to
 * nothing and the X reads as a dot.
 */
export function RemoveIcon(): React.JSX.Element {
  return <X strokeWidth={3.4} aria-hidden="true" focusable="false" />;
}
