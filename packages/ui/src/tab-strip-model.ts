/**
 * tab-strip-model.ts -- what a tab of the window's two strips is, and how a strip orders, remembers, and replaces its tabs, as an editor's does.
 *
 * The task's column and the side panel each hold a strip of tabs over the
 * open task (the desktop's `tasks/use-main-tabs.ts` and
 * `tasks/use-side-panel.ts`). A tab is either a word
 * its column names it by, such as the plan's own or the side panel's Board,
 * or an object naming what it shows: one coding agent, a draft agent not yet
 * started, one subagent, one file, one pull request, one agent turn's
 * changes, one terminal of
 * an agent's, one page, one Browser tab in an agent's cloud browser, or one
 * thread of a Manager's chat,
 * tagged with its kind (`STRIP_TAB_KIND`) and built by its kind's
 * constructor (`agentTab`, …). Two tabs are the same where they name the
 * same thing, as each kind declares it (`TAB_IDENTITY`), so a tab rebuilt
 * on every render is still the tab it was.
 *
 * Each strip keeps, per task, the order the developer moved its tabs into
 * and the tabs they viewed, the latest last. What follows is how both
 * strips read and change those two lists alike: a tab the order does not
 * hold stands after those it does, in its kind's place (`inTaskOrder`); a
 * tab opened goes to the strip's end (`openedOrder`); a move takes the tab
 * out and puts it back before the tab standing at its new place
 * (`movedOrder`); and closing the chosen tab chooses the one viewed before
 * it that still stands, and only where none does its neighbor
 * (`replacementOf`), as a browser's tabs do. Each strip also keeps when each
 * tab was last viewed (`stampedViewed`), from which a tab left unviewed long
 * enough closes itself (`idleTabs`, the panel's `tasks/use-idle-tabs.ts`).
 */

import type { NumberedAddress } from "@repo/features/link-grammar";
import { Predicate, Schema } from "effect";

/**
 * What each kind of tab whose name is not its subject's is called, wherever
 * it is named (the desktop's `tasks/tab-look.tsx`): the task's Inbox, the
 * thread the side panel holds beside the window's Inbox, the task's Overview, a draft agent's tab and the "+" row that opens one, an agent the window holds
 * nothing of, and a Pull request tab before its pull request is read. The side panel's fixed kinds
 * are named beside their glyphs (`SIDE_PANEL_TAB_KIND`).
 */
export const TAB_WORDS = {
  INBOX: "Inbox",
  THREAD: "Thread",
  OVERVIEW: "Overview",
  NEW_AGENT: "New agent",
  AGENT: "Agent",
  PULL_REQUEST: "Pull request",
  TURN_CHANGES: "Turn changes",
  BROWSER: "Browser",
} as const;

/** A Pull request tab's name once its pull request is read: the pull request's number, then its title, as GitHub names it. */
export function pullRequestLabelOf(pullRequest: {
  readonly number: number;
  readonly title: string;
}): string {
  return `#${pullRequest.number} ${pullRequest.title}`;
}

/**
 * What a tab of either strip shows: a word of its column's own, or the one
 * thing an object tab names, its kind spelled as the field naming it, which
 * is how a tab kept before tabs carried their kind is told
 * (`taggedStripTab`, `storedStripTab`).
 */
export const STRIP_TAB_KIND = {
  WORD: "word",
  AGENT: "agent",
  TRANSCRIPT: "transcript",
  DRAFT: "draft",
  SUBAGENT: "subagent",
  FILE: "file",
  CHANGES: "changes",
  TURN_CHANGES: "turnChanges",
  TERMINAL: "terminal",
  LOCAL: "local",
  PAGE: "page",
  CLOUD_BROWSER: "cloudBrowser",
  THREAD: "thread",
  /** PROTOTYPE 2: a task agent's Inbox thread, beside the Inbox's feed. */
  INBOX_THREAD: "inboxThread",
} as const;

export type StripTabKind = (typeof STRIP_TAB_KIND)[keyof typeof STRIP_TAB_KIND];

/** The kinds a tab names by an object, every kind but a word. */
type ObjectStripTabKind = Exclude<StripTabKind, typeof STRIP_TAB_KIND.WORD>;

/** The object kinds, which a tab kept without its kind is told by. */
const OBJECT_STRIP_TAB_KINDS: readonly ObjectStripTabKind[] = Object.values(STRIP_TAB_KIND).filter(
  (kind): kind is ObjectStripTabKind => kind !== STRIP_TAB_KIND.WORD,
);

/** One coding agent's tab, named by the agent it shows. */
export interface AgentStripTab {
  readonly kind: typeof STRIP_TAB_KIND.AGENT;
  readonly agent: string;
}

/** The tab of an agent not yet started, named by the key its first message will start it under. */
export interface DraftStripTab {
  readonly kind: typeof STRIP_TAB_KIND.DRAFT;
  readonly draft: string;
}

/** A worker one of the task's agents delegated to, as its tab carries it: the agent, and the task it handed over, which the tab names itself by. */
interface SubagentDelegation {
  readonly agent: string;
  readonly task: string;
}

/** One subagent's tab, named by the call that started it: on the open task's work, or, with the delegation, on one of its agents' turns. */
export interface SubagentStripTab {
  readonly kind: typeof STRIP_TAB_KIND.SUBAGENT;
  readonly subagent: string;
  /** Absent for the brain's worker, whose session the task's work holds. */
  readonly delegation?: SubagentDelegation;
}

/** One file's tab, named by the file's path in the open task's repository. */
export interface FileStripTab {
  readonly kind: typeof STRIP_TAB_KIND.FILE;
  readonly file: string;
}

/**
 * One pull request's tab, named by the pull request it shows, its
 * repository and its number, as a link to it on GitHub names it: its
 * overview and its changed files. It names no agent, so any link to a pull
 * request opens exactly that one, whichever agent opened it or none did.
 * It is spelled `changes`, as the tab that showed an agent's files alone
 * was, though what an earlier version kept of it, named by an agent, no
 * longer reads.
 */
export interface ChangesStripTab {
  readonly kind: typeof STRIP_TAB_KIND.CHANGES;
  readonly changes: NumberedAddress;
}

/** The changes of one of an agent's turns, named by the agent and the developer's line that opened the turn: a tab of its own beside the pull request's. */
export interface TurnChangesStripTab {
  readonly kind: typeof STRIP_TAB_KIND.TURN_CHANGES;
  readonly turnChanges: string;
  readonly turn: string;
}

/**
 * One terminal in a coding agent's cloud sandbox, a tab of its own: named by
 * the agent and the id the window minted the terminal under before its shell
 * was opened, and carrying the terminal's name ("Cloud 1"), which titles the
 * tab and never changes.
 */
export interface TerminalStripTab {
  readonly kind: typeof STRIP_TAB_KIND.TERMINAL;
  readonly terminal: string;
  readonly shell: string;
  readonly title: string;
}

/**
 * One terminal on this Mac in a cloud agent's mirrored files, a tab of its
 * own, on the same terms as a cloud one, named "Local 1".
 */
export interface LocalStripTab {
  readonly kind: typeof STRIP_TAB_KIND.LOCAL;
  readonly local: string;
  readonly shell: string;
  readonly title: string;
}

/** One page's tab, named by the page an agent wrote for the task. */
export interface PageStripTab {
  readonly kind: typeof STRIP_TAB_KIND.PAGE;
  readonly page: string;
}

/** One Browser tab in an agent's cloud browser, named by the id the service keeps it under. */
export interface CloudBrowserStripTab {
  readonly kind: typeof STRIP_TAB_KIND.CLOUD_BROWSER;
  readonly cloudBrowser: string;
}

/** One coding agent's transcript and composer in the side panel, named by the agent, as an agent mention pressed beside the Inbox opens it. */
export interface TranscriptStripTab {
  readonly kind: typeof STRIP_TAB_KIND.TRANSCRIPT;
  readonly transcript: string;
}

/** One thread of a Manager's chat in the side panel beside its page, named by the message it stands on and the Manager whose chat holds it. */
export interface ThreadStripTab {
  readonly kind: typeof STRIP_TAB_KIND.THREAD;
  readonly thread: string;
  readonly manager: string;
}

/** PROTOTYPE 2: one task agent's Inbox thread in the side panel beside the Inbox's feed, named by the thread and the agent that posted it. */
export interface InboxThreadStripTab {
  readonly kind: typeof STRIP_TAB_KIND.INBOX_THREAD;
  readonly inboxThread: string;
  readonly agent: string;
}

/** A tab naming what it shows, of any object kind. */
type ObjectStripTab =
  | AgentStripTab
  | TranscriptStripTab
  | DraftStripTab
  | SubagentStripTab
  | FileStripTab
  | ChangesStripTab
  | TurnChangesStripTab
  | TerminalStripTab
  | LocalStripTab
  | PageStripTab
  | CloudBrowserStripTab
  | ThreadStripTab
  | InboxThreadStripTab;

/** A tab of either strip: a word of its column's own, or one naming what it shows. */
export type StripTab = string | ObjectStripTab;

/** The tab of one kind. */
type StripTabOf<K extends StripTabKind> = K extends typeof STRIP_TAB_KIND.WORD
  ? string
  : Extract<ObjectStripTab, { readonly kind: K }>;

/** A tab of `T` as a build before tabs carried their kind kept it: a word as it is, an object without its kind. */
export type UntaggedStripTab<T extends StripTab = StripTab> = T extends ObjectStripTab
  ? Omit<T, "kind">
  : T;

/** One coding agent's tab. */
export function agentTab(agent: string): AgentStripTab {
  return { kind: STRIP_TAB_KIND.AGENT, agent };
}

/** One coding agent's transcript tab in the side panel. */
export function transcriptTab(transcript: string): TranscriptStripTab {
  return { kind: STRIP_TAB_KIND.TRANSCRIPT, transcript };
}

/** A draft agent's tab, by the key its first message will start it under. */
export function draftTab(draft: string): DraftStripTab {
  return { kind: STRIP_TAB_KIND.DRAFT, draft };
}

/** One subagent's tab, by the call that started it, and the delegation where one of the task's agents handed it over. */
export function subagentTab(subagent: string, delegation?: SubagentDelegation): SubagentStripTab {
  return delegation === undefined
    ? { kind: STRIP_TAB_KIND.SUBAGENT, subagent }
    : { kind: STRIP_TAB_KIND.SUBAGENT, subagent, delegation };
}

/** One file's tab, by its path in the open task's repository. */
export function fileTab(file: string): FileStripTab {
  return { kind: STRIP_TAB_KIND.FILE, file };
}

/** Whether two pull requests are one: the same number in the same repository, whatever the case its owner and name are spelled in, as GitHub reads them (`samePullRequest`). */
export function samePullRequestAddress(a: NumberedAddress, b: NumberedAddress): boolean {
  return a.number === b.number && a.repository.toLowerCase() === b.repository.toLowerCase();
}

/** One pull request's tab, by its repository, `owner/name`, and its number. */
export function changesTab(pullRequest: NumberedAddress): ChangesStripTab {
  return {
    kind: STRIP_TAB_KIND.CHANGES,
    changes: { repository: pullRequest.repository, number: pullRequest.number },
  };
}

/** The changes of one of an agent's turns, the one the developer's line given opened, a tab of its own beside the pull request's. */
export function turnChangesTab(turnChanges: string, turn: string): TurnChangesStripTab {
  return { kind: STRIP_TAB_KIND.TURN_CHANGES, turnChanges, turn };
}

/** One terminal in an agent's cloud sandbox, by the agent, the id its terminal was minted under, and its name. */
export function terminalTab(terminal: string, shell: string, title: string): TerminalStripTab {
  return { kind: STRIP_TAB_KIND.TERMINAL, terminal, shell, title };
}

/** One terminal on this Mac in an agent's mirrored files, on the same terms as a cloud one. */
export function localTab(local: string, shell: string, title: string): LocalStripTab {
  return { kind: STRIP_TAB_KIND.LOCAL, local, shell, title };
}

/** One page's tab. */
export function pageTab(page: string): PageStripTab {
  return { kind: STRIP_TAB_KIND.PAGE, page };
}

/** One Browser tab in an agent's cloud browser, by the id the service keeps it under. */
export function cloudBrowserTab(cloudBrowser: string): CloudBrowserStripTab {
  return { kind: STRIP_TAB_KIND.CLOUD_BROWSER, cloudBrowser };
}

/** One thread of a Manager's chat, by the message it stands on, and the Manager. */
export function threadTab(thread: string, manager: string): ThreadStripTab {
  return { kind: STRIP_TAB_KIND.THREAD, thread, manager };
}

/** PROTOTYPE 2: a task agent's Inbox thread's tab, by the thread and its agent. */
export function inboxThreadTab(inboxThread: string, agent: string): InboxThreadStripTab {
  return { kind: STRIP_TAB_KIND.INBOX_THREAD, inboxThread, agent };
}

/** A tab's kind: a word's for a string, and an object's own otherwise. */
export function stripTabKind(tab: StripTab): StripTabKind {
  return Predicate.isString(tab) ? STRIP_TAB_KIND.WORD : tab.kind;
}

/**
 * A tab a build before tabs carried their kind kept, tagged with the kind
 * the one field naming what it shows spells; a word, or a tab already
 * tagged, as it is; none for an object naming nothing a tab names.
 */
export function taggedStripTab<T extends StripTab>(tab: T | UntaggedStripTab<T>): T | undefined {
  // SAFETY: a tab is a StripTab or an untagged one, whatever its `T`.
  const held = tab as StripTab | UntaggedStripTab;

  if (Predicate.isString(held) || "kind" in held) {
    // SAFETY: a word, or a tab already tagged, is the `T` it was handed as.
    return tab as T;
  }

  const kind = OBJECT_STRIP_TAB_KINDS.find((each) => each in held);

  // SAFETY: a tab keeps its kind of `T` through the tag, the field it was found to hold, which the compiler cannot follow.
  return kind === undefined ? undefined : ({ kind, ...held } as T);
}

/**
 * A tab of one kind as a record keeps it: `fields`, the tab's own, without
 * its kind, which is told on read from the kind the schema is built for and
 * left out on write, so a record reads and writes the bytes a build before
 * tabs carried their kind did, and a rollback reads what this one wrote.
 */
export function storedStripTab<K extends ObjectStripTabKind, F extends Schema.Struct.Fields>(
  kind: K,
  fields: F,
) {
  return Schema.Struct({ kind: Schema.tagDefaultOmit(kind), ...fields });
}

/**
 * The agent whose tab follows its run now: the one the plan's column
 * shows, while the column is on screen, the plan's page shown and no panel
 * filling the window over it; none otherwise, since a tab out of sight
 * stops following its transcript, and what it last held is no longer the
 * agent's latest step.
 */
export function followedAgent(
  tab: StripTab | undefined,
  column: { readonly shown: boolean; readonly covered: boolean },
): string | undefined {
  return column.shown &&
    !column.covered &&
    tab !== undefined &&
    !Predicate.isString(tab) &&
    tab.kind === STRIP_TAB_KIND.AGENT
    ? tab.agent
    : undefined;
}

/** The key each agent's transcript tab in the side panel is drawn under, by agent, made the first time it is asked for, apart from its agent tab's. */
const transcriptKeys = new Map<string, string>();

function transcriptKey(agentId: string): string {
  const held = transcriptKeys.get(agentId);

  if (held !== undefined) return held;
  const made = crypto.randomUUID();
  transcriptKeys.set(agentId, made);

  return made;
}

/**
 * The key each Pull request tab is drawn under, by its repository, spelled
 * as GitHub reads it whatever its case, and then by its number, made the
 * first time it is asked for.
 */
const pullRequestKeys = new Map<string, Map<number, string>>();

function pullRequestKey(pullRequest: NumberedAddress): string {
  const repository = pullRequest.repository.toLowerCase();
  const ofRepository = pullRequestKeys.get(repository) ?? new Map<number, string>();
  pullRequestKeys.set(repository, ofRepository);
  const held = ofRepository.get(pullRequest.number);

  if (held !== undefined) return held;
  const made = crypto.randomUUID();
  ofRepository.set(pullRequest.number, made);

  return made;
}

/** The key each turn's Changes tab is drawn under, by agent and then by the line that opened the turn, made the first time it is asked for, as a pull request's is. */
const turnKeys = new Map<string, Map<string, string>>();

function turnKey(agentId: string, turn: string): string {
  const ofAgent = turnKeys.get(agentId) ?? new Map<string, string>();
  turnKeys.set(agentId, ofAgent);
  const held = ofAgent.get(turn);

  if (held !== undefined) return held;
  const made = crypto.randomUUID();
  ofAgent.set(turn, made);

  return made;
}

/** What a kind declares of its tab's identity: when two of its tabs are one, the key a list draws its tab under, and the coding agent the tab is one of the agent's own. */
interface TabIdentity<T extends StripTab> {
  readonly same: (a: T, b: T) => boolean;
  readonly key: (tab: T) => string;
  readonly agent: (tab: T) => string | undefined;
}

/** No coding agent, for a tab that is none of an agent's own. */
const NO_AGENT = (): undefined => undefined;

/**
 * Each kind's identity, a missing kind failing to compile. A delegated
 * worker's call names it within its agent, as the service names its
 * conversation, so its tab is the pair. A word is keyed by itself, an
 * agent's, call's, or draft's tab by its own id, which no word spells, and
 * a file's by its path. A Pull request tab is one per pull request, its
 * repository matched whatever its case, keyed by a key made for the pair
 * (`pullRequestKey`), and a turn's Changes tab by one made for its agent and
 * its turn (`turnKey`); a Terminal or Local tab by the id its terminal was
 * minted under, a page's by the page's own id, and a cloud Browser tab's by
 * the id the service keeps it under, and a Manager's chat's thread's by the
 * id of the message it stands on. An agent's tab, a turn's Changes tab,
 * its Terminal tab, and its Local tab are the agent's own, which is where a
 * terminal command means that agent (`terminal-entry.ts`); a Pull request
 * tab is no agent's.
 */
const TAB_IDENTITY = {
  [STRIP_TAB_KIND.WORD]: { same: (a, b) => a === b, key: (tab) => tab, agent: NO_AGENT },
  [STRIP_TAB_KIND.AGENT]: {
    same: (a, b) => a.agent === b.agent,
    key: (tab) => tab.agent,
    agent: (tab) => tab.agent,
  },
  [STRIP_TAB_KIND.TRANSCRIPT]: {
    same: (a, b) => a.transcript === b.transcript,
    key: (tab) => transcriptKey(tab.transcript),
    agent: NO_AGENT,
  },
  [STRIP_TAB_KIND.DRAFT]: {
    same: (a, b) => a.draft === b.draft,
    key: (tab) => tab.draft,
    agent: NO_AGENT,
  },
  [STRIP_TAB_KIND.SUBAGENT]: {
    same: (a, b) => a.subagent === b.subagent && a.delegation?.agent === b.delegation?.agent,
    key: (tab) => tab.subagent,
    agent: NO_AGENT,
  },
  [STRIP_TAB_KIND.FILE]: {
    same: (a, b) => a.file === b.file,
    key: (tab) => tab.file,
    agent: NO_AGENT,
  },
  [STRIP_TAB_KIND.CHANGES]: {
    same: (a, b) => samePullRequestAddress(a.changes, b.changes),
    key: (tab) => pullRequestKey(tab.changes),
    agent: NO_AGENT,
  },
  [STRIP_TAB_KIND.TURN_CHANGES]: {
    same: (a, b) => a.turnChanges === b.turnChanges && a.turn === b.turn,
    key: (tab) => turnKey(tab.turnChanges, tab.turn),
    agent: (tab) => tab.turnChanges,
  },
  [STRIP_TAB_KIND.TERMINAL]: {
    same: (a, b) => a.terminal === b.terminal && a.shell === b.shell,
    key: (tab) => tab.shell,
    agent: (tab) => tab.terminal,
  },
  [STRIP_TAB_KIND.LOCAL]: {
    same: (a, b) => a.local === b.local && a.shell === b.shell,
    key: (tab) => tab.shell,
    agent: (tab) => tab.local,
  },
  [STRIP_TAB_KIND.PAGE]: {
    same: (a, b) => a.page === b.page,
    key: (tab) => tab.page,
    agent: NO_AGENT,
  },
  [STRIP_TAB_KIND.CLOUD_BROWSER]: {
    same: (a, b) => a.cloudBrowser === b.cloudBrowser,
    key: (tab) => tab.cloudBrowser,
    agent: NO_AGENT,
  },
  [STRIP_TAB_KIND.THREAD]: {
    same: (a, b) => a.thread === b.thread && a.manager === b.manager,
    key: (tab) => tab.thread,
    agent: NO_AGENT,
  },
  [STRIP_TAB_KIND.INBOX_THREAD]: {
    same: (a, b) => a.inboxThread === b.inboxThread && a.agent === b.agent,
    key: (tab) => tab.inboxThread,
    agent: NO_AGENT,
  },
} as const satisfies { readonly [K in StripTabKind]: TabIdentity<StripTabOf<K>> };

/** The identity of a tab's kind, over any tab. */
function identityOf(tab: StripTab): TabIdentity<StripTab> {
  // SAFETY: each entry is read only with a tab of its own kind, which is what makes the widening sound.
  return TAB_IDENTITY[stripTabKind(tab)] as TabIdentity<StripTab>;
}

/** The coding agent a tab is one of the agent's own (`TAB_IDENTITY`); none for any other tab. */
export function agentOfTab(tab: StripTab | undefined): string | undefined {
  return tab === undefined ? undefined : identityOf(tab).agent(tab);
}

/** Whether two tabs are the same tab: of one kind, and the same as that kind declares it (`TAB_IDENTITY`). No tab, as a column showing its plan has, is the same as none. */
export function sameTab(a: StripTab | undefined, b: StripTab | undefined): boolean {
  if (a === undefined || b === undefined) return false;

  return stripTabKind(a) === stripTabKind(b) && identityOf(a).same(a, b);
}

/** A tab's key for a list that draws one element per tab, as its kind declares it (`TAB_IDENTITY`). */
export function tabKey(tab: StripTab): string {
  return identityOf(tab).key(tab);
}

/**
 * `drawn` in the task's order: each tab `order` holds first, as it stands
 * there, then the rest as they stood. Note that a tab never moved, such as
 * one just opened, so stands after every tab that was.
 */
export function inTaskOrder<T>(
  drawn: readonly T[],
  order: readonly StripTab[],
  tabOf: (each: T) => StripTab,
): T[] {
  const placed = order.flatMap((tab) => drawn.filter((each) => sameTab(tabOf(each), tab)));

  return [...placed, ...drawn.filter((each) => !placed.includes(each))];
}

/**
 * The task's order written whole: the tabs `was` already held, those the
 * strip does not draw now among them, such as one closed, then the rest of
 * `strip`, the run of tabs the strip draws now, as it stands.
 */
function wholeOrder<T extends StripTab>(was: readonly T[], strip: readonly T[]): T[] {
  return [...was, ...strip.filter((each) => !was.some((other) => sameTab(other, each)))];
}

/**
 * The task's order with the tab opened at the end of `strip`, the run of
 * tabs the strip draws now, as an editor opens a file: the order written
 * whole (`wholeOrder`), so every tab keeps the place it is drawn in, then
 * the tab, taken from wherever the order held it. Nothing where the tab
 * already stands in the strip, which an open only chooses.
 */
export function openedOrder<T extends StripTab>(
  was: readonly T[],
  strip: readonly T[],
  tab: T,
): readonly T[] | undefined {
  if (strip.some((other) => sameTab(other, tab))) return undefined;

  return [...wholeOrder(was, strip).filter((other) => !sameTab(other, tab)), tab];
}

/**
 * The task's order with the tab moved to `to` in `strip`, the run of tabs
 * the strip draws now: the tabs the order already held, those the strip
 * does not draw now among them, such as one closed, then the rest of the
 * strip as it stands, the tab taken out and put back before the tab that
 * stands at `to` now, or after every one where none does. Nothing where the
 * tab does not move.
 */
export function movedOrder<T extends StripTab>(
  was: readonly T[],
  strip: readonly T[],
  tab: T,
  to: number,
): readonly T[] | undefined {
  const all = wholeOrder(was, strip);
  const at = strip.findIndex((other) => sameTab(other, tab));
  const own = all.find((other) => sameTab(other, tab));

  if (at < 0 || to === at || own === undefined) return undefined;
  const before = strip.filter((other) => !sameTab(other, tab))[Math.max(0, to)];
  const rest = all.filter((other) => !sameTab(other, tab));
  const place = before === undefined ? -1 : rest.findIndex((other) => sameTab(other, before));

  return place < 0 ? [...rest, own] : [...rest.slice(0, place), own, ...rest.slice(place)];
}

/**
 * The tabs viewed with `viewed` viewed last, in the order given, each taken
 * from where it stood before, and the oldest let go past `kept`; nothing
 * where they were already viewed so.
 */
export function viewedLast<T extends StripTab>(
  before: readonly T[],
  viewed: readonly T[],
  kept: number,
): readonly T[] | undefined {
  const others = before.filter((each) => !viewed.some((tab) => sameTab(tab, each)));
  const recent = [...others, ...viewed].slice(-kept);

  const same =
    recent.length === before.length &&
    recent.every((tab, at) => before[at] !== undefined && sameTab(tab, before[at]));

  return same ? undefined : recent;
}

/**
 * The tab chosen in place of the closed one: the latest of `recent` that
 * still stands in `standing`, the strip as the close leaves it, or where
 * none does, the tab after it in `strip`, the strip as it stood, or the one
 * before.
 */
export function replacementOf<T extends StripTab>(
  standing: readonly T[],
  recent: readonly T[],
  strip: readonly T[],
  tab: T,
): T | undefined {
  const viewed = recent.findLast((each) => standing.some((other) => sameTab(other, each)));

  if (viewed !== undefined) return viewed;
  const place = strip.findIndex((other) => sameTab(other, tab));

  return strip[place + 1] ?? strip[place - 1];
}

/** When a tab of a strip was last viewed, in epoch milliseconds: shown on screen, or first known to the strip, whichever is later. */
export interface ViewedAt<T extends StripTab> {
  readonly tab: T;
  readonly at: number;
}

/** When the tab was last viewed, as `stamps` holds it; none where it holds nothing of it. */
export function viewedAtOf<T extends StripTab>(
  stamps: readonly ViewedAt<T>[],
  tab: T,
): number | undefined {
  return stamps.find((each) => sameTab(each.tab, tab))?.at;
}

/**
 * The stamps with each of `viewed` viewed at `at`, and each of `standing`
 * that holds no stamp yet stamped at `at` too, as a tab never seen or kept
 * before stamps were counts as viewed now, the stamps newest last and the
 * oldest of tabs not standing let go past `kept`; nothing where every one
 * already stood so. Note that a standing tab's stamp is never let go,
 * because one stamped anew would never grow old enough to close.
 */
export function stampedViewed<T extends StripTab>(
  before: readonly ViewedAt<T>[],
  viewed: readonly T[],
  standing: readonly T[],
  at: number,
  kept: number,
): readonly ViewedAt<T>[] | undefined {
  const unstamped = standing.filter((tab) => viewedAtOf(before, tab) === undefined);

  const fresh = [...viewed, ...unstamped].filter(
    (tab, place, all) =>
      viewedAtOf(before, tab) !== at && all.findIndex((other) => sameTab(other, tab)) === place,
  );

  if (fresh.length === 0) return undefined;
  const others = before.filter((each) => !fresh.some((tab) => sameTab(tab, each.tab)));
  const all = [...others, ...fresh.map((tab) => ({ tab, at }))];

  const loose = all
    .filter((each) => !standing.some((tab) => sameTab(tab, each.tab)))
    .slice(0, Math.max(0, all.length - kept));

  return all.filter((each) => !loose.includes(each));
}

/** The stamps without the tab's, as a close leaves them, so a tab opened again counts as viewed anew; the stamps as they are where none was its. */
export function withoutViewedAt<T extends StripTab>(
  stamps: readonly ViewedAt<T>[],
  tab: T,
): readonly ViewedAt<T>[] {
  return stamps.some((each) => sameTab(each.tab, tab))
    ? stamps.filter((each) => !sameTab(each.tab, tab))
    : stamps;
}

/**
 * The tabs of `strip` not viewed for `idle` or longer by `now`, those `keeps`
 * holds open left out, the last in the strip first, so each closes at the
 * place it stood and a reopen, latest closed first, stands each back there.
 * A tab with no stamp counts as viewed now.
 */
export function idleTabs<T extends StripTab>(
  strip: readonly T[],
  stamps: readonly ViewedAt<T>[],
  now: number,
  idle: number,
  keeps: (tab: T) => boolean,
): readonly T[] {
  return strip
    .filter((tab) => {
      const at = viewedAtOf(stamps, tab);

      return at !== undefined && now - at >= idle && !keeps(tab);
    })
    .toReversed();
}
