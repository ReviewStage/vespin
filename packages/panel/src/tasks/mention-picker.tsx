import type { NamedServer } from "@repo/features/agent-servers-model";
import { INBOX_SCOPE_KIND } from "@repo/features/agent-view";
import type { AgentPullRequest, AgentSummary } from "@repo/features/agent-wire";
import { automationTriggerText } from "@repo/features/automation-list-model";
import type { AutomationSummary } from "@repo/features/automation-wire";
import { readerZone } from "@repo/features/date-mention";
import { DEVICE_PLATFORM_NAME } from "@repo/features/device-platform";
import { ENTITY_KIND, type EntityKind, entityOfMention } from "@repo/features/entity-kind";
import type { InboxItemPlace } from "@repo/features/inbox-attachment-link";
import { inboxRowOf } from "@repo/features/inbox-digest";
import type { InboxItem } from "@repo/features/inbox-wire";
import { LINK_DESTINATION } from "@repo/features/link-grammar";
import { machineName, type ThisMac } from "@repo/features/machine-name";
import type { MentionHolder } from "@repo/features/mention-holder";
import { MENTION_FROM, MENTION_WIDEN, narrowingQuery } from "@repo/features/mention-kind";
import type { Mention, MentionPlace } from "@repo/features/mention-link";
import {
  agentCandidate,
  appCandidates,
  automationCandidate,
  dateCandidates,
  descriptionCandidates,
  isKindChoice,
  MENTION_NO_MATCH,
  MENTION_OFFER_KIND,
  type MentionCandidate,
  type MentionHeld,
  type MentionOfferedKind,
  type MentionOfferFrom,
  type MentionOfferRow,
  machineCandidates,
  mentionBack,
  mentionGroups,
  mentionKinds,
  mentionPaths,
  mentionScope,
  mentionSubject,
  offeredAgents,
  pageCandidate,
  pathCandidates,
  personCandidate,
  pullRequestCandidate,
  type RepositoryPath,
  serverCandidates,
  skillCandidate,
  taskCandidate,
  threadCandidate,
} from "@repo/features/mention-offer";
import type { PageLine } from "@repo/features/page-wire";
import { hitRangesIn, searchHit } from "@repo/features/search-score";
import { searchTokens } from "@repo/features/search-tokens";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import type { SkillOption } from "@repo/features/skill-mention";
import { TASK_TREE_ENTRY, type TaskSummary } from "@repo/features/task-wire";
import { readFailedWords } from "@repo/features/words";
import { taskKey } from "@repo/features/workspace-key";
import {
  type Workspace,
  type WorkspaceMachine,
  type WorkspaceMember,
  workspaceOfSlug,
} from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import type { AppInboxItems } from "@repo/host/app-state";
import { EXPERIMENT } from "@repo/settings";
import { SHORTCUT_KEY } from "@repo/settings/shortcuts";
import {
  BackButton,
  type ComboboxGroup,
  ComboboxList,
  comboboxOptionId,
  DocumentIcon,
  ErrorState,
  forkEffect,
  KeepFocus,
  MENU_SURFACE_INSET,
  MenuGlyph,
  type MenuRow,
  MenuSurface,
  NO_BACK_KEY,
  POPOVER_WIDTH,
  ProviderMark,
  RectFloat,
  Shortcut,
  Spinner,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  Time,
  useComboboxField,
  useMinute,
} from "@repo/ui";
import type { Actor } from "@repo/ui/actor-model";
import { eq, useLiveQuery } from "@tanstack/react-db";
import {
  queryOptions,
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useCreateStore, useSelector } from "@tanstack/react-store";
import { Duration, Effect, Predicate } from "effect";
import { UsersIcon } from "lucide-react";
import { type RefObject, useEffect, useId, useMemo, useRef, useState } from "react";
import { askAct, tellAct } from "../act.js";
import { ACTOR_SIZE, ActorMark, AutomationCard, actorCard, automationActor } from "../actor-ref.js";
import {
  type ComposerTrigger,
  type EditorAria,
  listAria,
  type MentionNode,
} from "../description-editor/contract.js";
import { useAutomations } from "../desktop/use-automations.js";
import { entityCard } from "../entities/entity-card.js";
import { EntityGlyph } from "../entities/entity-glyph.js";
import { entityMark } from "../entities/entity-mark.js";
import { unreadShown } from "../failure-report.js";
import { type IntegrationToolsReads, useIntegrationTools } from "../integration-tools.js";
import { inboxItemsQuery, inboxItemsRetryMutation } from "../live-reads.js";
import { useThisMac } from "../machine-name.js";
import { useWorkspaceDirectory } from "../member-directory.js";
import { memberRows } from "../member-rows.js";
import { QUERY_ROOT } from "../query-keys.js";
import { Highlighted } from "../search-field.js";
import { useTaskListCollections, useTaskListRowAs } from "../task-list-collections.js";
import { appStateQuery, selectMachineCommandDevice, selectWorkspaces } from "../use-app-state.js";
import { useWorkspaceExperiment } from "../workspace-experiments.js";
import { type AgentRowPlace, agentMenuRow, useAgentRowPlace } from "./agent-menu-row.js";
import { useComputerApps } from "./agent-pictures.js";
import { useOnThatMac } from "./computer-permission-note.js";
import {
  DATE_PICKER_CLOSE,
  type DatePicked,
  type DatePickerOpening,
  dateMentionNode,
  useDatePicker,
} from "./date-picker.js";
import { InboxItemChipCard } from "./inbox-item-chip.js";
import { inboxItemGlyph } from "./inbox-item-parts.js";
import { useAllowedApps, useMacApps, useMacAppsReadable } from "./mac-apps.js";
import { PageCard } from "./page-card.js";
import { PullRequestMark } from "./pull-request-mark.js";
import { skillOption } from "./skill-ref.js";
import { TaskKey } from "./task-standing.js";
import { useKnownNames } from "./use-known-names.js";
import { useServiceTaskSearch } from "./use-service-task-search.js";
import { MachineGlyph, MachineOwnerFace, useWorkspaceMachines } from "./workspace-machines.js";

/**
 * mention-picker.tsx -- the list an `@` opens: the workspace's agents, tasks, and people, the description and its sections, and the repository's files and folders, grouped by kind, narrowed as the word is typed, the pick written as its mention.
 *
 * The list opens the way the `/` list does (`skill-picker.tsx`), at the
 * word an editor reports (`ComposerTrigger`), the caret staying in the
 * editor throughout, its keys steered as any combobox's are
 * (`@repo/ui`'s `useComboboxField`): ↑ and ↓ move the highlight, a bare Home
 * and End take it to the first row and the last, Enter or Tab write the
 * highlighted row as its mention, and Escape closes the list until the caret
 * leaves the word. Keys an input method is composing with stay its own. Nothing typed after the `@`, it suggests up to four
 * things of the task itself, its agents, open threads, pull requests, and
 * pages in that order, and lists each kind to browse below them, as an
 * editor's `@` menu lists its kinds; typed, it finds each kind's best few by the words typed, scored
 * as ⌘K scores them (`@repo/features/search-score`), each row marking what found
 * it, letters typed in order finding only a path, each group in a fixed place
 * so a later read never moves the rows above it: agents first, then tasks,
 * people, the description, pages, and files and folders, since agents and tasks are
 * what is mentioned most and a path's letters in order find it by almost any
 * word.
 * Once the words run past a space and nothing matches them, the list
 * stands aside, since they are the developer's own words rather than a
 * mention, and the keys go to the editor as they would anywhere.
 * The repository's paths are read once per task, the first time an `@` is
 * typed, through the same listing ⌘K finds files with
 * (`ACT_KIND.TASKS_TREE`, the whole tree at the default branch). Each
 * file's row wears its type's icon and hangs the file's card.
 *
 * Where the editor's words go to an agent, the list offers the repository's
 * skills too, a pick written as the `/name` chip the `/` list writes
 * (`skill-picker.tsx`), and the account's connected MCP servers, and once a word is typed each one's tools, read
 * while the list stands open through the same read the agent's servers
 * popover draws its tools from (`../integration-tools.ts`); a mention of one
 * hands the agent's next turn that server whatever its switch says
 * (`packages/service/src/agents/agent-runtime/servers.ts`).
 *
 * On a plan's page the list offers what the plan holds beside its words
 * too: the pages agents showed on it, each by its title and its tab's
 * glyph, its version or how long ago it was written beside it, hanging its
 * card, and the pull requests its agents published, each by its number
 * and title and its mark, a pick written as the pull request's GitHub
 * address, the link mention a pasted one becomes. And wherever the words go, it offers the coding agents of the
 * whole workspace, each drawn as every agent menu draws it
 * (`agent-menu-row.tsx`): its tab's glyph and name, its task, a teammate's
 * face and the failed mark at its end, and its card on rest; the plan's own agents first, then the workspace's others,
 * on another task or on none, as the place reads them the first time the
 * list opens (`MentionSource.readAgents`), the agent whose box it is left
 * out. Once a word is typed and the typing rests (`SEARCH_PAUSE`), the service finds the agents it names by
 * their title or their task's name, however many the workspace holds. An
 * archived agent takes no message, so it is offered only once a word is
 * typed, and marked archived. A mention of a page or an
 * agent names it by its id (`@repo/features/mention-link`), which the
 * agent it is sent to is handed what it needs to read by
 * (`packages/service/src/agents/mentioned-context.ts`).
 *
 * Wherever the words stand in a workspace, the list offers its other
 * tasks too, as the window lists them, once a word is typed: each by its
 * name, its key beside it (`ACME-42`, `@repo/features/workspace-key`),
 * found by either, a pick written as the task's mention; the plan's own is
 * found by its key in the description's group. Words that are a task's key whole
 * lead the list with that task, as words that read as a date lead it with
 * the date.
 *
 * Wherever the words stand in a workspace, New task's box and the Inbox's
 * as much as a task's page, the list offers its people too, read as it
 * opens where no directory of that workspace stands around the box
 * (`../member-directory.tsx`'s `useWorkspaceDirectory`), each by
 * their name and picture, the reader among them as You, found by their name
 * or their email: a mention of a person names them by their account's id,
 * so it names them still once they rename themselves, and an agent the
 * words go to is handed who they are in the workspace. Nobody is notified
 * of a mention.
 *
 * Wherever the words stand in a workspace, the list offers its machines
 * too, its members' Macs and hosts, read while the list stands open
 * (`workspace-machines.tsx`): the reader's own first as You, then the
 * task's followers', then everyone else's, each by its name and its
 * platform's glyph, a teammate's wearing their face. A mention of one names
 * it by its id, which the agent the words go to is handed to pass as
 * `run_on_mac`'s and `computer`'s `machine`; it makes no machine reachable
 * that routing would refuse.
 *
 * Wherever the words stand in a workspace, the list offers its Inbox
 * threads too once a word is typed, as the account's feed holds them
 * (`../live-reads.ts`), the plan's own first, each by its title and
 * what it asks, said by its task, hanging its
 * Inbox row's card: no mention names a thread, so a pick writes the
 * thread's link (`@repo/features/link-grammar`), which every place draws
 * as its chip.
 *
 * Wherever the words stand in a workspace, the list offers its automations
 * too once a word is typed, as its Automations page lists them, followed
 * only while the list stands open, each by its name and what fires it,
 * wearing its tile and hanging its card: no mention names an automation
 * either, so a pick writes the automation's link, drawn as its chip.
 *
 * Where the words typed read as a date (`@repo/features/date-mention`),
 * `tomorrow 3pm`, `next fri`, `oct 20 to 24`, the list offers that date
 * first, said from today as its chip says it and in full beside it, a pick
 * written with the date in full; narrowed to dates with nothing typed, it
 * offers today, tomorrow, and next Monday.
 *
 * Nothing typed after the `@`, the list browses a row for each kind the
 * place offers, its glyph and name and chevron and nothing else, the
 * connected servers folded into one row: → or Enter on one narrows the list to that
 * kind by writing the word as typing its word and a colon would (`@files:`,
 * `@agents:`, `@servers:`, a server's provider such as `@linear:`), so the
 * letters that found the row never run on into the words searched; a
 * provider's second server, which has no word, narrows the list alone, the
 * word left bare. Typed, a kind the words name leads the list with its row, so
 * `@agent` still offers the way into the agents, and a group holding more
 * than its few ends in the row a capped list ends in ("Show 3 more"), which
 * writes its kind's word before the same words (`@files:invite`). A narrowed list
 * stands under a crumb naming the kind, lists up to fifty rows, opens at
 * its top, and searches that kind alone; as a submenu does, Escape or the
 * crumb's arrow widens it again, deleting the `kind:` and keeping the words,
 * and only then does Escape close the list; ⌫ on its empty words deletes the
 * colon, which widens it too, and on a list narrowed alone ← or ⌫ on its
 * empty words steps back. Narrowed to files and folders, → on a folder walks
 * into it, the word written as `@files:`: its
 * first row mentions the folder, the rest are what it holds, from the tree
 * already read, and ← or ⌫ on its empty words climbs back out. Narrowing changes only what the list offers; a
 * pick writes the same mention it would have written from the wide list.
 *
 * A pick hands the editor the mention's name and its target
 * (`@repo/features/mention-link`), which the editor writes in place of
 * the word; the name is the file's or folder's own name, the heading, the
 * plan's name, the page's title, the agent's tab's name, the server's
 * name, or the server's name and the tool's.
 */

/** The entity each kind of the list lists, whose glyph its row and its crumb wear (`../entities/entity-glyph.tsx`). */
const KIND_ENTITY = {
  [MENTION_FROM.FILES]: ENTITY_KIND.REPOSITORY,
  [MENTION_FROM.TASKS]: ENTITY_KIND.PLAN,
  [MENTION_FROM.PAGES]: ENTITY_KIND.PAGE,
  [MENTION_FROM.AGENTS]: ENTITY_KIND.AGENT,
  [MENTION_FROM.THREADS]: ENTITY_KIND.INBOX_ITEM,
  [MENTION_FROM.AUTOMATIONS]: ENTITY_KIND.AUTOMATION,
  [MENTION_FROM.PULL_REQUESTS]: ENTITY_KIND.PULL_REQUEST,
  [MENTION_FROM.SKILLS]: ENTITY_KIND.SKILL,
  [MENTION_FROM.DATES]: ENTITY_KIND.DATE,
  [MENTION_FROM.APPS]: ENTITY_KIND.MAC_APP,
  [MENTION_FROM.MACHINES]: ENTITY_KIND.MACHINE,
  [MENTION_FROM.SERVERS]: ENTITY_KIND.SERVER,
} as const satisfies Record<
  Exclude<MentionOfferFrom, typeof MENTION_FROM.DESCRIPTION | typeof MENTION_FROM.PEOPLE>,
  EntityKind
>;

/** A word closed with Escape: where it stands. */
interface Closed {
  readonly start: number;
}

/** The row of a list narrowed to dates that opens the date picker, to write the day picked there. */
interface PickDateRow {
  readonly picksDate: true;
  readonly name: string;
}

const PICK_DATE_ROW: PickDateRow = { picksDate: true, name: "Pick a date" };

/** The key the picker's row stands under, which no mention's or kind's key spells. */
const PICK_DATE_KEY = "pick-date";

/**
 * A narrowed list's crumb: back, folded to its glyph, its glyph and name,
 * over a hairline, at the search field's height.
 */
const CRUMB_CLASS =
  "mention-menu-crumb flex h-pane-bar flex-none items-center gap-icon-gap border-b border-border pr-list-inset pl-item-gap [--ui-fold:folded]";

/** The repository's skills as an `@` list offers them: as read, the ask to read them, and the pick that writes one as its `/name` chip. */
export interface MentionSkills {
  readonly known: readonly SkillOption[] | undefined;
  /** Whether the read came back unread, which the list says could not be read, with Retry, rather than that it is reading. */
  readonly unread: boolean;
  readonly ask: () => void;
  readonly onChoose: (name: string) => void;
}

/** The servers of a list that offers none. */
const NO_SERVERS: readonly NamedServer[] = [];

/** How long the typing rests before the service is searched for the agents the words name. */
const SEARCH_PAUSE = Duration.millis(250);

/** No workspaces, before the first document arrives. */
const NO_WORKSPACES: readonly Workspace[] = [];

/** A task as the list offers it to mention: what its row and a thread's row name it by. */
interface OfferedTask {
  readonly id: TaskSummary["id"];
  readonly workspaceId: TaskSummary["workspaceId"];
  readonly name: TaskSummary["name"];
  readonly number?: TaskSummary["number"] | undefined;
}

/** No tasks: what a list not yet read offers rows from. */
const NO_TASKS: readonly OfferedTask[] = [];

/** The list's own name, which its listbox is read by. */
const MENU_LABEL = "Mention";

/** What a narrowed list's back arrow is read by: back to every kind, or up out of a folder. */
const BACK_LABEL = {
  WIDEN: MENTION_WIDEN,
  UP: "Up",
} as const;

/** Where the crumb's way back leads, as its hint says it. */
const BACK_PLACE = {
  WIDEN: "all kinds",
  UP: "the folder above",
} as const;

/**
 * One thing the list offers as `@repo/features/mention-offer` builds it, and
 * what the panel draws beside it: its detail as drawn where that is no plain
 * words, a task's key at its end, its look and card, and the thread, the
 * automation or the pull request whose mark it wears.
 */
interface PanelCandidate extends MentionCandidate {
  /** The detail as drawn where it is not its words, as a page's age ticks. */
  readonly drawn?: React.ReactNode | undefined;
  /** What a task's key is drawn from at the row's end (`TaskKey`), as ⌘K's and the Tasks list's rows draw it; none for any other row. */
  readonly taskKey?: { readonly workspaceName: string; readonly number: number } | undefined;
  /** An agent's row as every agent menu draws it (`agent-menu-row.tsx`), a skill's as the `/` list does (`skill-ref.tsx`), or a machine's: its glyph, its end, and its card. */
  readonly look?: Pick<MenuRow, "icon" | "before" | "end" | "card"> | undefined;
  /** The card a page's, a person's, a thread's, or an automation's row hangs beside it; none for any other row, whose chip's card is drawn as its row is (`comboboxGroups`). */
  readonly card?: React.ReactNode | undefined;
  /** A pull request, whose mark its row wears for where it stands. */
  readonly pullRequest?: MentionablePullRequest | undefined;
  /** An Inbox thread, whose ask its row wears. */
  readonly thread?: { readonly place: InboxItemPlace; readonly item: InboxItem } | undefined;
  /** An automation, whose tile its row wears. */
  readonly automation?: AutomationSummary | undefined;
}

/** One row the list draws: a thing a pick names, a kind a press narrows to, or the row that opens the date picker. */
type MentionRow = MentionOfferRow<PanelCandidate> | PickDateRow;

/** A group of rows the list draws, under its heading. */
interface MentionMenuGroup {
  readonly title: string;
  readonly rows: readonly MentionRow[];
}

/** No rows: what a kind not asked for offers. */
const NO_ROWS: readonly PanelCandidate[] = [];

/** The highlight, held against the word it stands in by the key of the row it stands on (`rowKey`), so a row read late never takes its place. */
interface Highlight {
  readonly start: number;
  readonly query: string;
  readonly key: string;
}

/** Whether a row opens the date picker. */
function isPickDate(row: MentionRow): row is PickDateRow {
  return "picksDate" in row;
}

/** The thing a row names, where it names one rather than a kind or the date picker. */
function candidateOf(row: MentionRow): PanelCandidate | undefined {
  return isPickDate(row) || isKindChoice(row) ? undefined : row;
}

/** Whether → opens the row: a kind's, which narrows the list, or a folder's, which walks into it. */
function opens(row: MentionRow): boolean {
  if (isPickDate(row)) return false;

  return isKindChoice(row) || row.kind === MENTION_OFFER_KIND.FOLDER;
}

/** The workspace's tasks' rows but the plan's own, by its name, its key at its end in TaskKey's words, found by either. */
function workspaceTaskRows(
  taskId: string | undefined,
  workspace: Workspace | undefined,
  tasks: readonly OfferedTask[],
  slug: string,
): readonly PanelCandidate[] {
  if (workspace === undefined) return [];

  return tasks.flatMap((task): PanelCandidate[] => {
    if (task.id === taskId || task.workspaceId !== workspace.id) return [];
    const key = task.number === undefined ? undefined : taskKey(workspace.name, task.number);

    return [
      {
        ...taskCandidate(task, key, slug),
        // Note that the key stands at the row's end in TaskKey's words, as ⌘K and the Tasks list set it, never as the detail's plain words.
        detail: undefined,
        taskKey:
          task.number === undefined
            ? undefined
            : { workspaceName: workspace.name, number: task.number },
      },
    ];
  });
}

/** Each agent's row as every agent menu draws it (`agentMenuRow`), said and found by its task. */
function agentRows(
  agents: readonly MentionableAgent[],
  place: AgentRowPlace,
  workspace: string,
): readonly PanelCandidate[] {
  return agents.map((agent) => {
    const row = agentMenuRow(agent, place);
    const detail = Predicate.isString(row.detail) ? row.detail : undefined;

    return {
      ...agentCandidate({ id: agent.id, name: row.label, detail }, workspace),
      drawn: row.detail,
      look: { icon: row.icon, end: row.end, card: row.card },
    };
  });
}

/** The workspace's members as the list offers them, as every people menu lists them (`memberRows`): the reader first, then everyone else by name, each wearing their picture. */
function directoryPeople(
  members: readonly WorkspaceMember[],
  readerId: string | undefined,
): readonly MentionablePerson[] {
  return memberRows(members, readerId).map((row) => ({
    userId: row.member.userId,
    name: row.label,
    email: row.member.email,
    actor: row.actor,
  }));
}

/** Each person's row, by their name, hanging their card, said by their email or as You, found by their name or their email. */
function personRows(
  people: readonly MentionablePerson[],
  readerId: string | undefined,
  workspace: string,
): readonly PanelCandidate[] {
  return people.map((person) => ({
    ...personCandidate(person, person.userId === readerId, workspace),
    card: actorCard(person.actor),
  }));
}

/** The ids of the tasks the feed holds threads of that the window lists not. */
function unlistedThreadTasks(
  feed: AppInboxItems | undefined,
  listed: (taskId: string) => boolean,
): readonly string[] {
  if (feed === undefined) return [];

  return Object.keys(feed[INBOX_SCOPE_KIND.TASK]).filter((taskId) => !listed(taskId));
}

/**
 * Each of the workspace's Inbox threads' rows as the account's feed holds
 * them, the plan's own first, then the newest changed first: a task's under
 * its task, said by its name, hanging its Inbox row's card; none of another
 * workspace's, or of a task the window lists not.
 */
function threadRows(
  feed: AppInboxItems | undefined,
  taskId: string | undefined,
  workspace: Workspace | undefined,
  tasks: readonly OfferedTask[],
  slug: string,
): readonly PanelCandidate[] {
  if (feed === undefined || workspace === undefined) return [];
  const held: { readonly row: PanelCandidate; readonly own: boolean; readonly at: number }[] = [];
  // Note that the workspace's tasks are read by id, because the feed may hold a thread of every task and a scan per task read the whole list each.
  const named = new Map<string, OfferedTask>();

  for (const each of tasks) if (each.workspaceId === workspace.id) named.set(each.id, each);

  for (const [itemTaskId, items] of Object.entries(feed[INBOX_SCOPE_KIND.TASK])) {
    const task = named.get(itemTaskId);

    if (task === undefined) continue;

    for (const item of items) {
      const place: InboxItemPlace = {
        kind: LINK_DESTINATION.INBOX_ITEM,
        taskId: itemTaskId,
        itemId: item.id,
      };

      const row: PanelCandidate = {
        ...threadCandidate(item, task.name, slug),
        thread: { place, item },
        card: <InboxItemChipCard place={place} fallback={null} />,
      };

      held.push({ row, own: itemTaskId === taskId, at: item.updatedAt });
    }
  }

  return held
    .sort((first, second) => Number(second.own) - Number(first.own) || second.at - first.at)
    .map((each) => each.row);
}

/** Each of the workspace's automations' rows, by its name, said by what fires it, found by both, wearing its tile and hanging its card. */
function automationRows(
  automations: readonly AutomationSummary[],
  workspace: Workspace | undefined,
  slug: string,
): readonly PanelCandidate[] {
  return automations.map((automation) => ({
    ...automationCandidate(
      automation,
      automationTriggerText(automation.trigger, automation.repositories ?? []),
      slug,
    ),
    automation,
    card: <AutomationCard automation={automation} workspaceName={workspace?.name} />,
  }));
}

/** Each of the place's pull requests' rows, its task's or its agent's on no task, wearing its mark, labeled by the agent that published it. */
function pullRequestRows(
  pullRequests: readonly MentionablePullRequest[],
): readonly PanelCandidate[] {
  return pullRequests.map((pullRequest) => ({
    ...pullRequestCandidate(pullRequest, pullRequest.agent),
    pullRequest,
  }));
}

/** Each of the holder's pages' rows, its version where it has more than one and else how long ago it was written, as its card says them, hanging that card; none where nothing holds the place. */
function pageRows(
  holder: MentionHolder | undefined,
  pages: readonly MentionablePage[],
  now: number,
  workspace: string,
): readonly PanelCandidate[] {
  if (holder === undefined) return [];

  return pages.map((page) => ({
    ...pageCandidate(page, holder.taskId, now, workspace),
    drawn: page.version > 1 ? undefined : <Time at={page.at} now={now} hint={false} />,
    card: <PageCard place={holder} page={page} />,
  }));
}

/** Each of the repository's skills' rows, drawn as the `/` list draws it, so it reads as the `/name` chip a pick writes, and hangs its card. */
function skillRows(skills: readonly SkillOption[]): readonly PanelCandidate[] {
  return skills.map((skill) => {
    const option = skillOption(skill);

    return {
      ...skillCandidate(skill),
      look: { icon: option.icon, end: option.hint, card: option.card },
    };
  });
}

/**
 * Each of the workspace's machines' rows, drawn as the agent's Default
 * machine menu draws a machine (`agent-machines.tsx`): its platform's glyph
 * wearing its online dot, a teammate's face before its name, and its name as
 * every list of machines calls it (`machineName`, This Mac for the one the
 * window runs on), found by its own name, its owner's and its platform's. A
 * pick is written with the machine's own name.
 */
function machineRows(
  machines: readonly WorkspaceMachine[],
  readerId: string | undefined,
  followerIds: ReadonlySet<string>,
  people: readonly MentionablePerson[],
  thisMac: ThisMac,
  place: MentionPlace,
): readonly PanelCandidate[] {
  const listed = machines.map((machine) => ({ deviceId: machine.id, name: machine.name }));
  const byId = new Map(machines.map((machine) => [machine.id, machine]));

  const offered = machines.map((machine) => ({
    id: machine.id,
    name: machineName({ deviceId: machine.id, name: machine.name }, listed, thisMac),
    written: machine.name,
    ownerId: machine.userId,
    terms: [
      machine.name,
      people.find((person) => person.userId === machine.userId)?.name ?? "",
      DEVICE_PLATFORM_NAME[machine.platform],
    ],
  }));

  return machineCandidates(offered, { readerId, followerIds }, place).flatMap((row) => {
    const machine = byId.get(row.id);

    if (machine === undefined) return [];

    return [
      {
        ...row,
        look: {
          icon: <MachineGlyph machine={machine} />,
          before:
            machine.userId === readerId ? undefined : <MachineOwnerFace userId={machine.userId} />,
        },
      },
    ];
  });
}

/** The tools a connected server's read answered, or none while it has answered none. */
function toolsOf(
  reads: IntegrationToolsReads,
): (connection: string) => readonly { readonly name: string }[] | undefined {
  return (connection) => {
    const read = reads[connection];

    return read !== undefined && "tools" in read ? read.tools : undefined;
  };
}

/** A kind's glyph, as its rows wear theirs. */
function KindGlyph({ kind }: { kind: MentionOfferedKind }): React.JSX.Element {
  const { narrow } = kind;

  if (narrow.from === MENTION_FROM.SERVER) return <ProviderMark provider={narrow.provider} />;

  // Note that the description and the people are no one entity's kind, so they keep glyphs of their own.
  if (narrow.from === MENTION_FROM.DESCRIPTION) return <DocumentIcon />;

  if (narrow.from === MENTION_FROM.PEOPLE) return <UsersIcon aria-hidden="true" />;

  return <EntityGlyph kind={KIND_ENTITY[narrow.from]} />;
}

/**
 * A mention row's mark: its entity's (`../entities/entity-mark.tsx`), drawn
 * as the chip a pick writes draws it, so the row and the chip it becomes
 * can never wear two marks.
 */
function MentionRowMark({
  mention,
  name,
  workspace,
}: {
  mention: Mention;
  name: string;
  workspace: string;
}): React.JSX.Element {
  const known = useKnownNames();

  return (
    <>
      {entityMark(entityOfMention(mention), {
        name,
        known,
        workspace,
        tiles: undefined,
        standing: undefined,
      })}
    </>
  );
}

/** A row's glyph: a mention's its entity's mark, a pull request's its mark for where it stands, and a kind's, a skill's, a thread's, or an automation's its own. */
function RowGlyph({ row, workspace }: { row: MentionRow; workspace: string }): React.ReactNode {
  if (isPickDate(row)) return <EntityGlyph kind={ENTITY_KIND.DATE} />;

  if (isKindChoice(row)) return <KindGlyph kind={row.kind} />;

  if (row.kind === MENTION_OFFER_KIND.SKILL) return <EntityGlyph kind={ENTITY_KIND.SKILL} />;

  if (row.thread !== undefined) return inboxItemGlyph(inboxRowOf(row.thread.item));

  if (row.automation !== undefined) {
    return <ActorMark actor={automationActor(row.automation)} size={ACTOR_SIZE.INLINE} />;
  }

  if (row.pullRequest !== undefined) return <PullRequestMark pullRequest={row.pullRequest} />;

  if (row.mention === undefined) return null;

  return (
    <MentionRowMark mention={row.mention} name={row.written ?? row.name} workspace={workspace} />
  );
}

/** A row's key, stable while it stands: its skill's name, its kind's narrowing, or its mention. */
function rowKey(row: MentionRow): string {
  if (isPickDate(row)) return PICK_DATE_KEY;

  if (isKindChoice(row)) return JSON.stringify({ ...row.kind.narrow, keeps: row.more });

  if (row.kind === MENTION_OFFER_KIND.SKILL || row.automation !== undefined) return row.id;

  if (row.thread !== undefined) return JSON.stringify(row.thread.place);

  return JSON.stringify(row.mention);
}

/** The card a row hangs where it hangs none of its own: the card the chip a pick writes hangs; none for a row that writes no mention. */
type RowCardOf = (row: MentionRow) => React.ReactNode;

/** The glyph a row leads with where it brings none of its own (`RowGlyph`), drawn under the workspace the list writes in. */
type RowGlyphOf = (row: MentionRow) => React.ReactNode;

type MarkedWordsResult = { readonly label: React.ReactNode; readonly detail: React.ReactNode };

/** A row's name and detail, each marked where the words found it, as ⌘K marks its rows. */
function markedWords(row: MentionRow, query: string): MarkedWordsResult {
  if (isPickDate(row)) return { label: row.name, detail: undefined };
  const subject = mentionSubject(row);
  const hit = searchHit(subject, query);
  const drawn = isKindChoice(row) ? undefined : (row.drawn ?? row.detail);

  if (hit === undefined) return { label: row.name, detail: drawn };

  return {
    label: <Highlighted text={row.name} ranges={hit.label} />,
    detail: Predicate.isString(drawn) ? (
      <Highlighted text={drawn} ranges={hitRangesIn(drawn, subject, hit)} />
    ) : (
      drawn
    ),
  };
}

type ShowMoreWords = {
  readonly label: React.ReactNode;
  readonly detail: React.ReactNode;
};

/** A group's foot's words, in the muted ink a capped list's foot is said in. */
function showMoreWordsOf(row: MentionRow): ShowMoreWords {
  return {
    label: (
      <Text as={TEXT_ELEMENT.SPAN} tone={TEXT_TONE.MUTED}>
        {row.name}
      </Text>
    ),
    detail: undefined,
  };
}

/** Whether a row is a group's foot rather than a kind's own row or anything mentioned. */
function isShowMore(row: MentionRow): boolean {
  return !isPickDate(row) && isKindChoice(row) && row.more;
}

/** The key a highlighted folder's row says at its end walks into it, since choosing the row writes the folder. */
const WALK_INTO_HINT = <Shortcut chord={{ key: SHORTCUT_KEY.RIGHT, plain: true }} />;

/** The groups as the list draws them: each row its glyph, its name and detail marked where `query` found them, an agent's end, its card, a chevron where it opens, and → on the folder at `at`. */
function comboboxGroups(
  groups: readonly MentionMenuGroup[],
  query: string,
  at: number,
  rowCard: RowCardOf,
  rowGlyph: RowGlyphOf,
): ComboboxGroup[] {
  const highlighted = groups.flatMap((group) => group.rows)[at];
  const tokens = searchTokens(query);

  return groups.map((group) => ({
    label: group.title,
    options: group.rows.map((row) => {
      const named = candidateOf(row);
      const kind = !isPickDate(row) && isKindChoice(row);

      return {
        id: rowKey(row),
        ...(isShowMore(row) ? showMoreWordsOf(row) : markedWords(row, query)),
        words: row.name,
        // A group's foot keeps the glyph's room empty, so its words stand in line with the rows above.
        icon: isShowMore(row) ? null : (named?.look?.icon ?? rowGlyph(row)),
        before: named?.look?.before,
        hint:
          row === highlighted && opens(row) && !kind
            ? WALK_INTO_HINT
            : (named?.look?.end ??
              (named?.taskKey === undefined ? undefined : (
                <TaskKey
                  workspaceName={named.taskKey.workspaceName}
                  number={named.taskKey.number}
                  tokens={tokens}
                />
              ))),
        card: named?.look?.card ?? named?.card ?? rowCard(row),
        opens: kind,
      };
    }),
  }));
}

/** What a narrowed list stands under: its kind, the folder walked into, and the way back, where a key made it. */
interface Crumb {
  readonly kind: MentionOfferedKind;
  readonly folder: string | undefined;
  readonly back: (() => void) | undefined;
}

/** A narrowed list's crumb: back, the kind's glyph or a folder's, and the kind's name or the folder's path. */
function MentionCrumb({ crumb }: { crumb: Crumb }): React.JSX.Element {
  const { kind, folder, back } = crumb;

  return (
    // Note that a press on the crumb keeps the caret in the editor, where the keys are read.
    <KeepFocus className={CRUMB_CLASS}>
      {back === undefined ? null : (
        <BackButton
          label={folder === undefined ? BACK_LABEL.WIDEN : BACK_LABEL.UP}
          place={folder === undefined ? BACK_PLACE.WIDEN : BACK_PLACE.UP}
          command={NO_BACK_KEY}
          tabbable={false}
          onBack={back}
        />
      )}
      <MenuGlyph>
        {folder === undefined ? (
          <KindGlyph kind={kind} />
        ) : (
          <EntityGlyph kind={ENTITY_KIND.FOLDER} />
        )}
      </MenuGlyph>
      <Text
        as={TEXT_ELEMENT.SPAN}
        variant={TEXT_VARIANT.SECTION}
        truncate
        className="mention-menu-crumb-title"
      >
        {folder ?? kind.name}
      </Text>
    </KeepFocus>
  );
}

/** The key the wide list is drawn under, which no narrowed list's spells. */
const WIDE_LIST = "wide";

/** The reads the list draws rows from that can fail, each named as its failure says it. */
const MENTION_READ = {
  MEMBERS: "members",
  AGENTS: "agents",
  FILES: "the repository's files",
  SKILLS: "skills",
  THREADS: "Inbox threads",
  AUTOMATIONS: "automations",
  APPS: "the apps on this Mac",
  ALLOWED_APPS: "the apps your machines allow",
  MACHINES: "machines",
} as const;

type MentionRead = (typeof MENTION_READ)[keyof typeof MENTION_READ];

/** A read of the list that failed, and the press that reads it again. */
interface MentionReadFailure {
  readonly read: MentionRead;
  readonly retry: () => void;
}

/** The list itself: a narrowed list's crumb, and each group's heading and rows, the highlighted one washed. */
function MentionMenu({
  id,
  crumb,
  groups,
  query,
  at,
  reading,
  failures,
  rowCard,
  rowGlyph,
  onHover,
  onChoose,
}: {
  id: string;
  crumb: Crumb | undefined;
  groups: readonly MentionMenuGroup[];
  /** The words the groups were found by, which mark each row. */
  query: string;
  at: number;
  /** Whether a read the list offers rows from is still out, which the list says in place of "no match". */
  reading: boolean;
  /** The reads that failed, which the list says could not be read, with Retry, in place of "no match". */
  failures: readonly MentionReadFailure[];
  rowCard: RowCardOf;
  rowGlyph: RowGlyphOf;
  onHover: (index: number) => void;
  onChoose: (row: MentionRow) => void;
}): React.JSX.Element {
  const rows = groups.flatMap((group) => group.rows);
  const noted = reading || failures.length > 0;

  return (
    <MenuSurface className="mention-menu" inset={MENU_SURFACE_INSET.NONE}>
      {crumb === undefined ? null : <MentionCrumb crumb={crumb} />}
      <ComboboxList
        // Note that a list narrowed or widened is drawn afresh, so it opens at its top rather than scrolled where the wide list stood, which a pointer's press leaves it.
        key={crumb === undefined ? WIDE_LIST : JSON.stringify([crumb.kind.narrow, crumb.folder])}
        id={id}
        label={MENU_LABEL}
        groups={comboboxGroups(groups, query, at, rowCard, rowGlyph)}
        active={at}
        onActiveChange={onHover}
        onChoose={(index) => {
          const row = rows[index];

          if (row !== undefined) onChoose(row);
        }}
        // A narrowed list's one group is named by its crumb.
        headed={crumb === undefined}
        empty={noted ? undefined : MENTION_NO_MATCH}
        note={
          noted ? (
            <>
              {reading ? <Spinner delay label="Reading" /> : null}
              {failures.map((failure) => (
                <ErrorState
                  failure={unreadShown(FAILURE_SURFACE.MENTIONS_READ)}
                  key={failure.read}
                  onRetry={failure.retry}
                >
                  {readFailedWords(failure.read)}
                </ErrorState>
              ))}
            </>
          ) : undefined
        }
      />
    </MenuSurface>
  );
}

/** What an editor drawing an `@` list wires: the list and the date picker while they stand, the field's ties to the list for assistive technology, the reports and keys the editor hands it, and what opens the date picker over a chip. */
export interface MentionPicker {
  readonly menu: React.ReactNode;
  /** What ties the editor to the list (`listAria`), which names it a combobox while the list stands. */
  readonly aria: EditorAria;
  readonly onTrigger: (trigger: ComposerTrigger | undefined) => void;
  readonly onKey: (event: KeyboardEvent) => boolean;
  readonly pickDate: (opening: DatePickerOpening) => void;
}

/** Which side of the word the list stands: under it, as in the description, or over it, as at the foot of an agent's tab. */
export const MENTION_MENU_SIDE = {
  BELOW: "below",
  ABOVE: "above",
} as const;

export type MentionMenuSide = (typeof MENTION_MENU_SIDE)[keyof typeof MENTION_MENU_SIDE];

type WordBoxResult = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

/** The box a word's list hangs by, in window coordinates: the line its first letter stands on, as the editor reported it. */
export function wordBox(word: ComposerTrigger): WordBoxResult {
  const { left, top, bottom } = word.rect;

  return { left, top, right: left, bottom };
}

/** A page an agent showed on the plan, as the list offers it: as the plan lists it, its id, its newest version's title and number, and when that version was written, which its row and its card say. */
export type MentionablePage = PageLine;

/** One of the workspace's coding agents, as the list offers it: its id, its tab's name, its tile, which its row wears, its task, and whether it is archived. */
export interface MentionableAgent {
  readonly id: string;
  readonly name: string;
  readonly actor: Actor;
  /** The task it works on, by its id and, where the place knows it, its name; absent where the place does not know it. */
  readonly task?: { readonly id: string; readonly name?: string | undefined } | undefined;
  readonly archived?: boolean | undefined;
  /** The agent as the workspace's list read it, where a place drew it from that list: what a picker draws its tab's look and title from. */
  readonly summary?: AgentSummary | undefined;
}

/** A person as the list offers them: their account's id, their name, their email where the members read names it, and their picture, which their row wears. */
interface MentionablePerson {
  readonly userId: string;
  readonly name: string;
  readonly email: string | undefined;
  readonly actor: Actor;
}

/** One of the place's pull requests, as the list offers it: where it stands, which its mark wears, its GitHub address, and the name of the agent that published it, where the place knows it. */
export interface MentionablePullRequest
  extends Pick<AgentPullRequest, "number" | "title" | "url" | "state" | "checks" | "queued"> {
  readonly agent: string | undefined;
}

/**
 * Reads the workspace's coding agents: the newest the task list carries
 * where no words are given, or, found by the service, those whose title or
 * task's name holds the words, the archived ones among them; rejects where
 * the read failed, so the list says it could not read them rather than
 * that none match.
 */
export type MentionAgentsReader = (
  words: string | undefined,
) => Promise<readonly MentionableAgent[]>;

/** The pages and agents of a place that offers none. */
const NO_PAGES: readonly MentionablePage[] = [];
const NO_AGENTS: readonly MentionableAgent[] = [];
const NO_PULL_REQUESTS: readonly MentionablePullRequest[] = [];

/** The plan whose sections and repository the list offers, the workspace it stands in, and its text as it stands now; a place no task holds offers its repository. */
export interface MentionSource {
  /** The task whose page the list stands on; none for a place no task holds. */
  readonly holder: MentionHolder | undefined;
  readonly taskName: string;
  /** The slug of the task's workspace, which a mention of it is written under. */
  readonly workspace: string;
  /** The task's repository, `owner/name`; null before one is chosen. */
  readonly repository: string | null;
  /** The id of the workspace whose installation the repository is read through, where no plan names it. */
  readonly workspaceId?: string | undefined;
  readonly text: () => string;
  /** The pages agents showed on the plan; none where the place offers none. */
  readonly pages?: readonly MentionablePage[] | undefined;
  /** The plan's coding agents, as its page holds them now; none where the place offers none. */
  readonly agents?: readonly MentionableAgent[] | undefined;
  /** Reads the workspace's coding agents, which the list offers after the plan's own; none where the place offers none. */
  readonly readAgents?: MentionAgentsReader | undefined;
  /** The pull requests the plan's agents published, as its page holds them now; none where the place offers none. */
  readonly pullRequests?: readonly MentionablePullRequest[] | undefined;
}

/** What a repository's paths are read by: the plan whose repository it is, or, with no plan, the workspace and the repository; none where neither names one. */
function treeKey(
  taskId: string | undefined,
  workspaceId: string | undefined,
  repository: string | null,
): { taskId: string } | { workspaceId: string; repository: string } | undefined {
  if (taskId !== undefined) return { taskId: taskId };

  if (workspaceId === undefined || repository === null) return undefined;

  return { workspaceId, repository };
}

/** What a repository's paths are read by. */
type TreeKey = NonNullable<ReturnType<typeof treeKey>>;

/** The repository's paths as one recursive listing names them. */
async function repositoryPaths(key: TreeKey): Promise<readonly RepositoryPath[]> {
  const answer = await askAct(ACT_KIND.TASKS_TREE, { ...key, path: "", recursive: true });

  if (!("folder" in answer)) throw new Error("The repository's paths were not read.");

  return answer.folder.entries.map((entry) => ({
    path: entry.name,
    folder: entry.kind === TASK_TREE_ENTRY.FOLDER,
  }));
}

/**
 * The repository's paths, the whole tree at its default branch, read once
 * per repository: a repository's files rarely move while a word is typed,
 * so they are held for the window's life. A refusal and a rejection both
 * fail the read, never an empty repository, and are answered at once.
 */
function repositoryPathsQueryOptions(place: {
  readonly taskId: string | undefined;
  readonly workspaceId: string | undefined;
  readonly repository: string | null;
}) {
  const key = treeKey(place.taskId, place.workspaceId, place.repository);

  return queryOptions({
    // Note that a plan's repository may change under it, so the paths are kept by the repository too.
    queryKey: [QUERY_ROOT.REPOSITORY_PATHS, place.taskId, place.workspaceId, place.repository],
    queryFn: key === undefined ? skipToken : () => repositoryPaths(key),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
}

/**
 * The kinds the place holds, which the list offers in its order
 * (`mentionKinds`): the workspace's agents where it reads them, its other
 * tasks where it holds any, its people where the window has read them, the
 * description where one stands and the workspace has Descriptions on, the
 * pages of what holds it, its repository's files and folders where it names
 * one, its Inbox threads and automations where it holds any, the pull
 * requests the plan's agents published, the repository's skills where the
 * words go to an agent, its machines, the apps on the reader's machines
 * where the words go to an agent and it may read them, and the connected
 * servers.
 */
function heldKinds(
  source: MentionSource,
  self: string | undefined,
  held: {
    readonly tasks: number;
    readonly people: number;
    readonly threads: number;
    readonly automations: number;
    readonly skills: number;
    readonly machines: number;
    readonly apps: number;
    readonly servers: number;
  },
  descriptionsOn: boolean,
): ReadonlySet<MentionOfferFrom> {
  const { holder, repository } = source;
  const taskId = holder?.taskId;

  const agents =
    source.readAgents !== undefined ||
    (taskId !== undefined && (source.agents ?? NO_AGENTS).some((agent) => agent.id !== self));

  const offered: readonly (readonly [MentionOfferFrom, boolean])[] = [
    [MENTION_FROM.AGENTS, agents],
    [MENTION_FROM.TASKS, held.tasks > 0],
    [MENTION_FROM.PEOPLE, held.people > 0],
    [MENTION_FROM.DESCRIPTION, taskId !== undefined && descriptionsOn],
    [MENTION_FROM.PAGES, holder !== undefined && (source.pages ?? NO_PAGES).length > 0],
    [
      MENTION_FROM.FILES,
      repository !== null && treeKey(taskId, source.workspaceId, repository) !== undefined,
    ],
    [MENTION_FROM.THREADS, held.threads > 0],
    [MENTION_FROM.AUTOMATIONS, held.automations > 0],
    [MENTION_FROM.PULL_REQUESTS, (source.pullRequests ?? NO_PULL_REQUESTS).length > 0],
    [MENTION_FROM.SKILLS, held.skills > 0],
    [MENTION_FROM.MACHINES, held.machines > 0],
    [MENTION_FROM.APPS, held.apps > 0],
    [MENTION_FROM.SERVERS, held.servers > 0],
  ];

  return new Set(offered.flatMap(([from, offers]) => (offers ? [from] : [])));
}

/** Words typed in the `@` word that starts at `wordAt`. */
interface WordsTyped {
  readonly wordAt: number;
  readonly words: string;
}

/**
 * Whether the typing has rested on the words of the `@` word at `wordAt`,
 * which no words always have. The words rest once they have stood the
 * pause, a wait of this reader's own that new words start over, so only
 * the newest rest. Note that the rest is forgotten once the words go, so
 * words typed again, in this word or another, wait afresh.
 */
function useRested(wordAt: number | undefined, words: string | undefined): boolean {
  const rested = useCreateStore<WordsTyped | undefined>(undefined);
  useEffect(() => {
    if (wordAt === undefined || words === undefined) {
      rested.setState(() => undefined);

      return;
    }

    const typed = { wordAt, words };

    return forkEffect(
      Effect.andThen(
        Effect.sleep(SEARCH_PAUSE),
        Effect.sync(() => rested.setState(() => typed)),
      ),
    );
  }, [wordAt, words, rested]);
  const restedOn = useSelector(rested);

  return words === undefined || (restedOn?.wordAt === wordAt && restedOn?.words === words);
}

/**
 * The `@` list for an editor on a task's page: its rows read from the
 * description's words as they stand and the repository's paths, hung by the word
 * (`@repo/ui`'s `RectFloat`) and closed by a press outside it and `room`,
 * and a pick handed to `onChoose` as the mention's node; a list that never
 * opens where there is no task to offer.
 */
export function useMentionPicker({
  source,
  self,
  skills,
  servers = NO_SERVERS,
  macApps = false,
  room,
  side,
  onChoose,
  onRetype,
}: {
  source: MentionSource | undefined;
  /** The agent whose box the list stands in, which it does not offer; none for the description's own words. */
  self?: string | undefined;
  /** The repository's skills, where the words go to an agent; none for the description's own words. */
  skills?: MentionSkills | undefined;
  /** The account's connected MCP servers, where the words go to an agent; none for the description's own words. */
  servers?: readonly NamedServer[] | undefined;
  /** Whether the list offers apps, where the words go to an agent: this Mac's where the window is the Mac the agent uses, else those the reader's machines always allow; never for the description's own words. */
  macApps?: boolean | undefined;
  /** The box the editor stands in: a press in it is the editor's, and the date picker hangs in it. */
  room: RefObject<HTMLElement | null>;
  side: MentionMenuSide;
  onChoose: (mention: MentionNode) => void;
  /** The `@` word written as `@` and the words given, as a kind's row opening writes its `kind:`. */
  onRetype: (words: string) => void;
}): MentionPicker {
  const now = useMinute();
  const listId = useId();
  const [trigger, setTrigger] = useState<ComposerTrigger | undefined>(undefined);
  const [highlight, setHighlight] = useState<Highlight | undefined>(undefined);
  const [closed, setClosed] = useState<Closed | undefined>(undefined);
  const [narrowing, setNarrowing] = useState<MentionHeld | undefined>(undefined);

  // A dismissal or narrowing stays with its word only while the caret is in it.
  if (trigger === undefined && (closed !== undefined || narrowing !== undefined)) {
    setClosed(undefined);
    setNarrowing(undefined);
  }

  const holder = source?.holder;
  const taskId = holder?.taskId;
  const agentPlace = useAgentRowPlace(taskId);
  const workspaceId = source?.workspaceId;
  const repository = source?.repository ?? null;
  const place: MentionPlace = { workspace: source?.workspace ?? "", repository };
  const shut = trigger !== undefined && closed !== undefined && closed.start === trigger.start;
  const open = source !== undefined && trigger !== undefined && !shut;

  // The repository's paths are read the first time the list opens on the task, and again once its repository changes or Retry asks; a failed read is read again by the next word that opens the list.
  const paths = useQuery({
    ...repositoryPathsQueryOptions({ taskId, workspaceId, repository }),
    enabled: open,
  });

  // Each editor reads the paths afresh, since the default branch may have moved since another read them, so a new editor or a new place marks them stale.
  const queryClient = useQueryClient();
  useEffect(() => {
    // Note that refetchOnMount cannot do it, because the query stays off until the list opens and only staleness is weighed then.
    const { queryKey } = repositoryPathsQueryOptions({ taskId, workspaceId, repository });
    void queryClient.invalidateQueries({ queryKey, exact: true, refetchType: "none" });
  }, [queryClient, taskId, workspaceId, repository]);
  const read = paths.data;
  // Note that the paths are searched through one search per read, which keeps what each word found, rather than ranking every path on each render.
  const slug = place.workspace;

  const pathsSearched = useMemo(
    () =>
      mentionPaths(
        read === undefined ? NO_ROWS : pathCandidates(read, { workspace: slug, repository }),
      ),
    [read, slug, repository],
  );

  const pathsFailed = paths.isError && !paths.isFetching;
  const readPathsAgain = paths.refetch;

  // The skills are asked for as each `@` word opens the list, as the `/` list asks for them; a read
  // that answered is kept, and one that failed is asked again by the next word.
  const askSkills = skills?.ask;
  const askedAt = open ? trigger.start : undefined;
  useEffect(() => {
    if (askedAt !== undefined) askSkills?.();
  }, [askedAt, askSkills]);

  // The tasks offered are the workspace's the words stand in: the one that names it, else the plan's, else the one its slug names.
  const collections = useTaskListCollections();
  const workspaces = useQuery({ ...appStateQuery, select: selectWorkspaces }).data ?? NO_WORKSPACES;

  // Note that the words' own task is read for the three facts the list takes of it, so a turn of its agents, which moves its row, leaves the list as it was.
  const ownTaskId = taskId ?? undefined;

  const ownWorkspaceId = useTaskListRowAs(
    collections.tasks,
    ownTaskId,
    (task) => task?.workspaceId,
  );

  const planNumber = useTaskListRowAs(collections.tasks, ownTaskId, (task) => task?.number);
  const followers = useTaskListRowAs(collections.tasks, ownTaskId, (task) => task?.followers);

  const tasksWorkspaceId =
    workspaceId ??
    ownWorkspaceId ??
    (source === undefined ? undefined : workspaceOfSlug(workspaces, source.workspace))?.id;

  const tasksWorkspace = workspaces.find((each) => each.id === tasksWorkspaceId);

  // The workspace's tasks, newest started first as the list holds them, read only while the list stands open, and only what their rows name them by, so a turn of a task's agents leaves the list as it was.
  const { data: workspaceTasks } = useLiveQuery((q) =>
    !open || tasksWorkspaceId === undefined
      ? undefined
      : q
          .from({ task: collections.tasks })
          .where(({ task }) => eq(task.workspaceId, tasksWorkspaceId))
          .orderBy(({ task }) => task.createdAt, "desc")
          .orderBy(({ task }) => task.id, "desc")
          .select(({ task }) => ({
            id: task.id,
            workspaceId: task.workspaceId,
            name: task.name,
            number: task.number,
          })),
  );

  // The people offered are the members of that workspace, read while the list stands open wherever the words stand, so every box offers the same people.
  const directory = useWorkspaceDirectory(open ? tasksWorkspace : undefined);
  const { readerId } = directory;

  const people =
    directory.members === undefined ? [] : directoryPeople(directory.members, readerId);

  // While the workspace has Descriptions off there is no description to mention, its sections or the whole of it, so the task itself is offered among the workspace's tasks.
  const descriptionsOn = useWorkspaceExperiment(tasksWorkspaceId, EXPERIMENT.DESCRIPTIONS);

  // Note that the rows are built once for what they are made from rather than on every key typed, which searches them anew but changes none.
  const taskRowsOffered = useMemo(
    () =>
      open
        ? workspaceTaskRows(
            descriptionsOn ? taskId : undefined,
            tasksWorkspace,
            workspaceTasks ?? NO_TASKS,
            slug,
          )
        : NO_ROWS,
    [open, descriptionsOn, taskId, tasksWorkspace, workspaceTasks, slug],
  );

  // The threads offered are the workspace's as the account's feed holds them, which the host holds for the session.
  const feed = useQuery(inboxItemsQuery());
  const retryFeed = useMutation(inboxItemsRetryMutation());
  const threadsAsked = open && tasksWorkspace !== undefined;

  const threadRowsOffered = useMemo(
    () =>
      threadsAsked
        ? threadRows(feed.data, taskId, tasksWorkspace, workspaceTasks ?? NO_TASKS, slug)
        : NO_ROWS,
    [threadsAsked, feed.data, taskId, tasksWorkspace, workspaceTasks],
  );

  // Note that a thread of a task the window lists not is offered once the task is read into its list, each asked once while the list stands open and again once it opens anew.
  const threadTasksOutside = threadsAsked
    ? unlistedThreadTasks(feed.data, (each) => collections.tasks.has(each))
    : [];

  const threadTasksAsked = useRef(new Set<string>());
  useEffect(() => {
    if (!threadsAsked) threadTasksAsked.current.clear();

    for (const outside of threadTasksOutside) {
      if (threadTasksAsked.current.has(outside)) continue;
      threadTasksAsked.current.add(outside);
      tellAct(ACT_KIND.TASKS_LOAD, { taskId: outside });
    }
  });

  // The automations offered are the workspace's, followed only while the list stands open.
  const automationsAsked = open && tasksWorkspace !== undefined;
  const automations = useAutomations(automationsAsked ? tasksWorkspace.id : undefined);
  const automationsRead = automationsAsked ? automations.read : undefined;

  const automationRowsOffered =
    automationsRead !== undefined && "automations" in automationsRead
      ? automationRows(automationsRead.automations, tasksWorkspace, place.workspace)
      : [];

  // The plan's own key, which finds the description's row as another task's finds its.

  const planKey =
    tasksWorkspace === undefined || planNumber === undefined
      ? undefined
      : taskKey(tasksWorkspace.name, planNumber);

  // The apps offered are this Mac's where the window is the Mac the agent uses, and those the reader's own machines always allow, each read while the list stands open (`mac-apps.ts`), and none until it is known which.
  // Note that the agent's machine is read only where this Mac's apps could be offered, so a list with Computer use off waits on nothing.
  const appsReadable = useMacAppsReadable();
  const appsAsked = open && macApps && appsReadable;
  const onThatMac = useOnThatMac(appsAsked ? self : undefined);
  const apps = useMacApps(open && macApps && onThatMac === true);
  // Note that the apps the reader's other machines allow are offered beside this Mac's own, each row naming its machine.
  const allowedApps = useAllowedApps(open && macApps && onThatMac !== undefined);
  const keptApps = useComputerApps();
  const thisDevice = useQuery({ ...appStateQuery, select: selectMachineCommandDevice }).data;
  const thisMac = useThisMac();

  // The machines offered are the workspace's members', read while the list stands open, the task's followers' after the reader's own.
  const machinesAsked = open && tasksWorkspace !== undefined;
  const machines = useWorkspaceMachines(tasksWorkspace?.id, machinesAsked);

  const appRowsOffered =
    !open || onThatMac === undefined
      ? []
      : appCandidates(
          {
            onMac: onThatMac ? apps.apps : [],
            allowed: allowedApps.machines,
            kept: keptApps,
            thisDevice,
            thisMac,
            ownNameOf: (deviceId) => machines.machines.find((each) => each.id === deviceId)?.name,
          },
          place,
        );

  const followerIds = new Set((followers ?? []).map((follower) => follower.userId));

  const machineRowsOffered = machinesAsked
    ? machineRows(machines.machines, readerId, followerIds, people, thisMac, place)
    : [];

  // The list is narrowed to the kind a key opened or whose word was typed, and searched by the words after it.
  const kinds = open
    ? mentionKinds(
        heldKinds(
          source,
          self,
          {
            tasks: taskRowsOffered.length,
            people: people.length,
            threads: threadRowsOffered.length,
            automations: automationRowsOffered.length,
            skills: (skills?.known ?? []).length,
            machines: machineRowsOffered.length,
            apps: appRowsOffered.length,
            servers: servers.length,
          },
          descriptionsOn,
        ),
        servers,
      )
    : [];

  const scope = open ? mentionScope(trigger, narrowing, kinds) : undefined;
  const term = scope?.term ?? "";

  // Note that the workspace's tasks the window lists not are asked of the service as the typing pauses, as ⌘K asks them, and join the list the task rows above are built from, one row each.
  const tasksSought =
    open &&
    tasksWorkspace !== undefined &&
    (scope?.kind === undefined || scope.kind.narrow.from === MENTION_FROM.TASKS);

  useServiceTaskSearch(term, tasksSought);

  // The workspace's newest agents are read as each `@` word opens the list, and once a word is
  // typed and the typing rests the service finds those it names, archived ones among them, however many the workspace
  // holds; each read is kept while its word stands, and the last one shown until the next lands.
  const readAgents = source?.readAgents;
  const wordAt = open ? trigger.start : undefined;
  const words = open && term.trim() !== "" ? term.trim() : undefined;

  const [workspaceAgents, setWorkspaceAgents] = useState<{
    readonly reader: MentionAgentsReader;
    readonly wordAt: number;
    readonly words: string | undefined;
    /** The agents read; none where the read failed, which Retry clears to read again. */
    readonly agents: readonly MentionableAgent[] | undefined;
  }>();

  const agentsRead =
    workspaceAgents?.reader === readAgents && workspaceAgents?.wordAt === wordAt
      ? workspaceAgents
      : undefined;

  const wantsAgents = agentsRead === undefined || agentsRead.words !== words;

  const agentsFailed =
    agentsRead !== undefined && agentsRead.words === words && agentsRead.agents === undefined;

  // Note that words are asked of the service once the typing rests on them, rather than letter by letter.
  const rested = useRested(wordAt, words);
  useEffect(() => {
    if (!wantsAgents || readAgents === undefined || wordAt === undefined || !rested) return;
    let live = true;
    readAgents(words).then(
      (agents) => {
        if (live) setWorkspaceAgents({ reader: readAgents, wordAt, words, agents });
      },
      () => {
        if (live) setWorkspaceAgents({ reader: readAgents, wordAt, words, agents: undefined });
      },
    );

    return () => {
      live = false;
    };
  }, [wantsAgents, words, readAgents, wordAt, rested]);

  // Each server's tools are read while the list stands open, and forgotten once it closes.
  const tools = useIntegrationTools(
    (open ? servers : NO_SERVERS).map((server) => server.connection),
  );

  const narrow = scope?.kind?.narrow;

  const own: readonly MentionableAgent[] =
    taskId === undefined
      ? []
      : (source?.agents ?? NO_AGENTS).map((agent) => ({ ...agent, task: { id: taskId } }));

  const pullRequestsOffered = pullRequestRows(source?.pullRequests ?? NO_PULL_REQUESTS);
  const pagesOffered = pageRows(holder, source?.pages ?? NO_PAGES, now, slug);

  const offered =
    scope === undefined || source === undefined
      ? []
      : mentionGroups<PanelCandidate>(
          {
            suggested: [
              ...agentRows(offeredAgents(own, NO_AGENTS, self, false), agentPlace, slug),
              ...threadRowsOffered.filter(
                (row) =>
                  row.thread !== undefined &&
                  "taskId" in row.thread.place &&
                  row.thread.place.taskId === taskId,
              ),
              ...pullRequestsOffered,
              ...pagesOffered,
            ],
            description:
              descriptionsOn && taskId !== undefined
                ? descriptionCandidates(
                    { taskId, name: source.taskName, key: planKey },
                    source.text(),
                    place,
                  )
                : NO_ROWS,
            tasks: taskRowsOffered,
            pages: pagesOffered,
            agents: agentRows(
              offeredAgents(own, agentsRead?.agents ?? NO_AGENTS, self, term.trim() !== ""),
              agentPlace,
              slug,
            ),
            people: personRows(people, readerId, slug),
            files: pathsSearched,
            threads: threadRowsOffered,
            automations: automationRowsOffered,
            pullRequests: pullRequestsOffered,
            skills: skillRows(skills?.known ?? []),
            machines: machineRowsOffered,
            apps: appRowsOffered,
            servers: (connection, withTools) =>
              serverCandidates(
                connection === undefined
                  ? servers
                  : servers.filter((server) => server.connection === connection),
                toolsOf(tools),
                withTools,
                place,
              ),
            dates: (words) => dateCandidates(words, now, readerZone(), place),
          },
          scope,
          kinds,
        );

  // A list narrowed to dates ends on the row that opens the date picker.
  const groups: readonly MentionMenuGroup[] =
    scope?.kind !== undefined && narrow?.from === MENTION_FROM.DATES
      ? [{ title: scope.kind.name, rows: [...(offered[0]?.rows ?? []), PICK_DATE_ROW] }]
      : offered;

  const rows = groups.flatMap((group) => group.rows);

  // The list says it is reading, never that nothing matches, while a read it draws rows from is out.
  const reading =
    open &&
    (directory.reading ||
      (readAgents !== undefined && wantsAgents) ||
      (read === undefined &&
        !pathsFailed &&
        treeKey(taskId, workspaceId, repository) !== undefined) ||
      (skills !== undefined && skills.known === undefined && !skills.unread) ||
      (threadsAsked && feed.isPending) ||
      (automationsAsked && automationsRead === undefined) ||
      (appsAsked && onThatMac === undefined) ||
      apps.reading ||
      allowedApps.reading ||
      machines.reading);

  // The list says a read could not be read, never that nothing matches, and Retry reads it again.
  const failures: readonly MentionReadFailure[] = open
    ? [
        ...(directory.refused ? [{ read: MENTION_READ.MEMBERS, retry: directory.retry }] : []),
        ...(readAgents !== undefined && agentsFailed
          ? [{ read: MENTION_READ.AGENTS, retry: () => setWorkspaceAgents(undefined) }]
          : []),
        ...(pathsFailed ? [{ read: MENTION_READ.FILES, retry: () => void readPathsAgain() }] : []),
        ...(skills?.unread === true ? [{ read: MENTION_READ.SKILLS, retry: skills.ask }] : []),
        ...(threadsAsked && feed.isError
          ? [{ read: MENTION_READ.THREADS, retry: () => retryFeed.mutate() }]
          : []),
        ...(automationsRead !== undefined && "failure" in automationsRead
          ? [{ read: MENTION_READ.AUTOMATIONS, retry: automations.reload }]
          : []),
        ...(apps.failed ? [{ read: MENTION_READ.APPS, retry: apps.retry }] : []),
        ...(allowedApps.failed
          ? [{ read: MENTION_READ.ALLOWED_APPS, retry: allowedApps.retry }]
          : []),
        ...(machinesAsked && machines.failed
          ? [{ read: MENTION_READ.MACHINES, retry: machines.retry }]
          : []),
      ]
    : [];

  // Words typed past a space that match nothing are prose, not a mention: the list stands aside, and comes back only if they match again.
  const shown = open && (rows.length > 0 || !/\s/u.test(term.trim()));

  const heldKey =
    highlight !== undefined &&
    trigger !== undefined &&
    highlight.start === trigger.start &&
    highlight.query === trigger.query
      ? highlight.key
      : undefined;

  // A row no longer listed gives the highlight back to the first row, as new words do.
  const at = Math.max(
    heldKey === undefined ? 0 : rows.findIndex((row) => rowKey(row) === heldKey),
    0,
  );

  // Note that the row drawn highlighted is held by its key, the first row's
  // too, because a read that lands late (the workspace's agents, its
  // people) lays rows above it, and Enter must write the row the developer
  // saw highlighted rather than whichever row slid into its place.
  const shownKey = rows[at] === undefined ? undefined : rowKey(rows[at]);
  const wordStart = trigger?.start;
  const wordQuery = trigger?.query;
  useEffect(() => {
    if (shownKey === undefined || wordStart === undefined || wordQuery === undefined) return;
    setHighlight((held) =>
      held?.start === wordStart && held.query === wordQuery && held.key === shownKey
        ? held
        : { start: wordStart, query: wordQuery, key: shownKey },
    );
  }, [shownKey, wordStart, wordQuery]);

  // A key or the pointer moves the highlight onto the row at `index`.
  const highlightRow = (index: number) => {
    const row = rows[index];

    if (trigger !== undefined && row !== undefined)
      setHighlight({ start: trigger.start, query: trigger.query, key: rowKey(row) });
  };

  // The list narrowed or widened by a key starts again at its first row.
  const narrowTo = (next: MentionHeld | undefined) => {
    if (trigger === undefined) return;
    setNarrowing(next);
    setHighlight(undefined);
  };

  // A kind's row narrows the list to it, the word written as typing its `kind:` would write it, so
  // the words never run on from the letters that found the row; a folder's walks into it, the word
  // written as `files:`.
  const openRow = (row: MentionRow) => {
    if (trigger === undefined || scope === undefined) return;
    const { start } = trigger;

    if (isPickDate(row)) return;

    if (isKindChoice(row)) {
      // A group's foot opens its kind searched by the words already typed; a kind's own row opens it afresh, as its query writes it.
      narrowTo(undefined);
      onRetype(row.query);

      return;
    }

    if (row.kind !== MENTION_OFFER_KIND.FOLDER) return;
    const entry = narrowingQuery(MENTION_FROM.FILES, "");
    const within = scope.kind?.narrow.from === MENTION_FROM.FILES;
    const walked = { path: row.id, entry };
    narrowTo({
      start,
      narrow: { from: MENTION_FROM.FILES },
      entry,
      typed: true,
      walked: within ? [...scope.walked, walked] : [walked],
    });
    onRetype(entry);
  };

  const backTo = trigger === undefined ? undefined : mentionBack(scope, trigger.start);

  const back =
    backTo === undefined
      ? undefined
      : () => {
          narrowTo(backTo.to);

          if (backTo.words !== undefined) onRetype(backTo.words);
        };

  // The date picker opened from the list hangs from the word and writes the date picked in its place.
  const datePicker = useDatePicker(room);

  const pickNewDate = (word: ComposerTrigger) => {
    // Note that the editor is handed the caret back before a pick is written, because it finds the `@` word only while it has it.
    const editing = document.activeElement;
    setClosed({ start: word.start });
    datePicker.open({
      at: word.rect,
      date: undefined,
      onClose: ({ date, zone, changed, how }: DatePicked) => {
        const kept = how === DATE_PICKER_CLOSE.CLEAR || !changed ? undefined : date;

        if (
          (kept !== undefined || how !== DATE_PICKER_CLOSE.LEAVE) &&
          editing instanceof HTMLElement
        )
          editing.focus();

        if (kept !== undefined) onChoose(dateMentionNode(kept, place, zone));
      },
    });
  };

  // A skill is written as the `/name` chip its own list writes; a kind's row opens; the picker's row opens the picker; anything else is written as its link, a thread's by its id alone, whose agent and task its reader asks the service for.
  const choose = (row: MentionRow) => {
    if (isPickDate(row)) {
      if (trigger !== undefined) pickNewDate(trigger);
    } else if (isKindChoice(row)) openRow(row);
    else if (row.kind === MENTION_OFFER_KIND.SKILL) skills?.onChoose(row.id);
    else onChoose({ name: row.written ?? row.name, target: row.target });
  };

  // The list closed by Escape or a press away stays closed until the caret leaves its word.
  const closeList = () => {
    if (trigger !== undefined) setClosed({ start: trigger.start });
  };

  // ↑, ↓, Home, End, Enter and Escape steer the list as any combobox's do;
  // ⌘Enter writes the highlighted row as a bare Enter does.
  const activeId = rows.length === 0 ? undefined : comboboxOptionId(listId, at);

  const field = useComboboxField({
    open: shown,
    active: at,
    count: rows.length,
    controls: listId,
    activeId,
    onActiveChange: highlightRow,
    onChoose: (index) => {
      const row = rows[index];

      if (row !== undefined) choose(row);
    },
    onEnter: () => {
      const row = rows[at];

      if (row !== undefined) choose(row);
    },
    onEscape: () => closeList(),
  });

  // The list's own keys come first: ←, ⌫ and Escape step back, → opens, Tab writes, and a
  // Shift+Enter is the editor's line break, as a modified Home or End is
  // its own; with no row only Escape is the list's.
  const onKey = (event: KeyboardEvent): boolean => {
    if (!shown) return false;
    const bare = !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey;

    // A narrowed list steps back as a submenu does: ← or ⌫ on its empty words, or Escape, before Escape closes it; ← and ⌫ at a word's `kind:` are the editor's, which move past or delete its colon.
    const stepsBack =
      (event.key === "Backspace" || event.key === "ArrowLeft") &&
      bare &&
      term === "" &&
      backTo?.words === undefined;

    if (back !== undefined && (stepsBack || (event.key === "Escape" && bare))) {
      // Note that an Escape taken here is kept from the surface behind, as the field keeps one that closes the list, so a dialog around the box stays open.
      if (event.key === "Escape") event.stopPropagation();
      back();

      return true;
    }

    if (event.key === "Escape") return field.onKeyDown(event);
    const row = rows[at];

    if (row === undefined) return false;

    if (event.key === "ArrowRight" && bare && opens(row)) {
      openRow(row);

      return true;
    }

    if (event.key === "Tab") {
      choose(row);

      return true;
    }

    if (event.key === "Enter" && event.shiftKey) return false;

    // A Home or End held with a modifier selects or travels in the editor's words.
    if ((event.key === "Home" || event.key === "End") && !bare) return false;

    return field.onKeyDown(event);
  };

  const rowGlyph: RowGlyphOf = (row) => <RowGlyph row={row} workspace={place.workspace} />;

  // Note that a row's card is the chip's, made as the row is drawn, because the repository's paths are thousands and only the few listed hang one.
  const rowCard: RowCardOf = (row) => {
    const mention = candidateOf(row)?.mention;

    if (mention === undefined) return undefined;

    return entityCard(entityOfMention(mention), {
      own: undefined,
      glyph: rowGlyph(row),
      name: candidateOf(row)?.written ?? row.name,
      workspace: place.workspace,
      wordsWorkspaceId: tasksWorkspaceId,
      repository: repository ?? undefined,
      gone: undefined,
    });
  };

  // The list hangs by the word's line, on the side asked; a press outside it and the room closes it as Escape does, and it fades as it closes.
  const rowsShown = !shown ? null : (
    <MentionMenu
      id={listId}
      crumb={
        scope?.kind === undefined
          ? undefined
          : { kind: scope.kind, folder: scope.walked.at(-1)?.path, back }
      }
      groups={groups}
      query={term}
      at={at}
      reading={reading}
      failures={failures}
      rowCard={rowCard}
      rowGlyph={rowGlyph}
      onHover={highlightRow}
      onChoose={choose}
    />
  );

  const list = (
    <RectFloat
      open={shown}
      anchor={() => (trigger === undefined ? undefined : wordBox(trigger))}
      side={side}
      width={POPOVER_WIDTH.REGULAR}
      onPressAway={closeList}
      holds={(target) => room.current?.contains(target) === true}
    >
      {rowsShown}
    </RectFloat>
  );

  const menu = (
    <>
      {list}
      {datePicker.popover}
    </>
  );

  return {
    menu,
    // The field names the list it opened and the row highlighted in it, as any combobox's does.
    aria: listAria(field.field),
    onTrigger: setTrigger,
    onKey,
    pickDate: datePicker.open,
  };
}
