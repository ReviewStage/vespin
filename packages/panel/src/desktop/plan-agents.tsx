import type { AgentPullRequest } from "@repo/features/agent-wire";
import { ENTITY_KIND } from "@repo/features/entity-kind";
import { NEEDS_YOU, threadsWaitingWords } from "@repo/features/inbox-list-model";
import type { InboxItem } from "@repo/features/inbox-wire";
import { agentLastMovedAt, inAgentListOrder } from "@repo/features/task-agents-model";
import { APP_COMMAND } from "@repo/settings/shortcuts";
import {
  BUTTON_SIZE,
  GROUP_ACTIONS,
  GROUP_HEADING,
  GroupAction,
  GroupHeader,
  IconButton,
  LIST_DENSITY,
  List,
  ListRow,
  TaskRows,
  Tooltip,
} from "@repo/ui";
import { GLYPH, PlusIcon } from "@repo/ui/icons";
import { ReplayUnmask } from "@repo/ui/session-replay-marks";
import { agentTab, STRIP_TAB_KIND, sameTab } from "@repo/ui/tab-strip-model";
import { useCoarsePointer } from "../coarse-pointer.js";
import { EntityGlyph } from "../entities/entity-glyph.js";
import { useMemberDirectory } from "../member-directory.js";
import { agentSubject } from "../tasks/agent-ref.js";
import type { AgentsControl } from "../tasks/use-agents.js";
import type { MainTabsControl } from "../tasks/use-main-tabs.js";
import type { MenuAction } from "./action-menu.js";
import { agentEntries } from "./agent-entries.js";
import { AGENT_ROW_CELLS, AgentListRow } from "./agent-list-row.js";
import { useAgentsSelection } from "./agents-selection.js";
import type { AddEntry, HeldTranscripts } from "./strip-tabs.js";
import type { ChosenRows } from "./tasks-selection.js";

/**
 * plan-agents.tsx -- the open task's agents at the head of its description, as a group: one row each in a task's row's anatomy, its tab's glyph and name, its pull request, where it runs, its failure where it failed, and when it last moved.
 *
 * The agents stand under a group head, Agents and how many, which folds
 * them, folded where the page asks, the same shape every group of
 * the head takes, a `GroupHeader` over their rows. Each row is the
 * task's agent as its "+" row draws it (`agentEntries`),
 * drawn as a person's page draws its agents too (`agent-list-row.tsx`), in
 * the columns a task's row stands in (`TaskRows`), so every glyph and name
 * of the group lines up: its
 * tab's glyph, which gives way to the working mark while it works, its
 * tab's name, its pull request, where it opened one, as a chip of GitHub's
 * mark in GitHub's color for where it stands and its number
 * (`pull-request-chip.tsx`), hanging the pull request's one card as its
 * Pull request tab does, the agent whose it is and who it names among what
 * the card says (`pull-request-card.tsx`), where it runs (`runs-on.tsx`),
 * Cloud or the device, each agent's own, the failed mark once its turn
 * failed, and when it last moved, its card hanging beside it as its tab's.
 * A row's press is the page's to answer (`onOpenAgent`): the side panel's
 * plan opens the agent as its tab's own press does. The chip opens the pull
 * request as the agent's own pull request chip does, in its Pull request
 * tab; it is still a link to its page, so a right-click offers its address.
 * An agent with threads waiting on the developer counts them in its run,
 * before its pull request, in the orange figure its tab and the sidebar's
 * Inbox row draw (`WaitingCount`), so a task opened on its plan says which
 * agent waits and on how much; the threads themselves, titles and all, are
 * the Inbox's to say, so the row stays one line.
 * A row's ⋯, a right-click, a long press, and the menu key offer the
 * agent's one menu, as its row on a person's page and its tab offer it:
 * Copy link, Rename in the row's place, Archive, and Permanently delete.
 * The agents are chosen together as a task's related tasks are, by the box
 * in a row's gutter, ⌘-click, ⇧-click, and ⌘A, and a row chosen among
 * several offers Archive, or Unarchive, and Permanently delete on every one
 * chosen (`agents-selection.tsx`).
 * Those agents come first, then those at work, then the newest started; an
 * archived agent is not listed. New agent stands on the group's head at
 * every width, a + at rest as Sub-tasks' is, the strip's "+" by another
 * place (`newAgentStarts`), so it stands while the group is folded too. A
 * task with no agent listed, once its agents are read, still draws the
 * group's head alone, its + the start, as Sub-tasks stands empty, so the
 * head looks the same before its first agent as after it, and that agent
 * lands under it rather than a group arriving to push the description down.
 *
 * On a phone, Overview is the task's one page, with no strip, summary, or
 * Inbox tab beside it (`task-pane-switcher.tsx`), so the group holds the rest
 * of what those offer: the agents' read again where it never landed, the
 * archived agents folded under them as the summary folds them
 * (`ArchivedAgents`), and, after the group, the task's Inbox counting what
 * waits on the developer that no listed agent's row marks already, such as
 * an archived agent's thread, only while something does.
 */

/** A phone's additions to the group; see the module's head. */
interface PlanAgentsPhone {
  /** The archived agents' fold (`ArchivedAgents`), which draws nothing while none is archived. */
  readonly archived: React.ReactNode;
  /** Opens the window's Inbox narrowed to the task. */
  readonly onOpenInbox: () => void;
}

/** What the group is called, and its list for a reader moving between lists. */
const AGENTS_LIST = "Agents";

/** What the group's count counts, said to a reader beside the figure. */
const AGENTS_NOUN = { one: "agent", many: "agents" } as const;

/** New agent as the group's +, standing at rest on its head, its chord in its tooltip as the strip's "+" says it, and why it is unavailable where it is. */
function NewAgentAction({ start }: { start: MenuAction }): React.JSX.Element {
  return (
    <GroupAction>
      <Tooltip label={start.detail ?? start.label} command={APP_COMMAND.NEW_TAB}>
        <IconButton
          icon={start.icon ?? <PlusIcon />}
          label={start.label}
          size={BUTTON_SIZE.COMPACT}
          disabled={start.disabled}
          focusableWhenDisabled
          onClick={start.onSelect}
        />
      </Tooltip>
    </GroupAction>
  );
}

/** One agent's row (`AgentListRow`), offering the agent's menu as a person's page does: its tab's look and card, how many of its threads wait on the developer, its pull request's chip where it opened one, where it runs, its failed mark, and when it last moved. */
function PlanAgentRow({
  entry,
  waits,
  pullRequest,
  agents,
  held,
  tab,
  shown,
  more,
  chosen,
  onOpenPullRequest,
}: {
  entry: AddEntry;
  /** How many of its threads wait on the developer. */
  waits: number;
  pullRequest: AgentPullRequest | undefined;
  agents: AgentsControl;
  held: HeldTranscripts;
  tab: MainTabsControl["tab"];
  /** Whether the group is on screen, which its menu asks on. */
  shown: boolean;
  /** Whether it draws its ⋯, as its list does. */
  more: boolean;
  /** The selection it stands in, where it is one of several chosen. */
  chosen: ChosenRows | undefined;
  onOpenPullRequest: () => void;
}): React.JSX.Element | null {
  const { row, agent, card } = entry;
  if (agent === undefined) return null;
  const opened = tab !== undefined && sameTab(agentTab(row.id), tab);
  return (
    <AgentListRow
      agent={agent}
      agents={agents}
      shown={shown}
      subject={agentSubject(agents, row.id, held, opened)}
      at={agentLastMovedAt(agent)}
      card={card}
      pullRequest={pullRequest}
      waits={waits}
      more={more}
      chosen={chosen}
      onPress={entry.onPick}
      onOpenPullRequest={onOpenPullRequest}
    />
  );
}

/**
 * The task's agents at the head of its description, under their group's head,
 * those waiting on the developer first, then those at work, then the
 * newest, or its head alone where it lists none and offers New agent;
 * nothing where it offers neither.
 * A row's press is handed to `onOpenAgent` by its agent's id, and
 * `onOpenPullRequest` opens an agent's pull request as its own chip does.
 */
export function PlanAgents({
  agents,
  held,
  tab,
  folded,
  waiting,
  shown,
  onOpenAgent,
  onOpenPullRequest,
  newAgent,
  phone,
}: {
  agents: AgentsControl;
  /** What the tabs hold, which each row's card reads as its tab's does. */
  held: HeldTranscripts;
  /** The column's chosen tab, whose agent's card follows its run. */
  tab: MainTabsControl["tab"];
  /** Whether the group starts folded. */
  folded: boolean;
  /** The task's Inbox items waiting on the developer, by the agent that posted each (`waitingByAgent`). */
  waiting: ReadonlyMap<string, readonly InboxItem[]>;
  /** Whether the task's page is on screen, which each row's menu asks on. */
  shown: boolean;
  onOpenAgent: (agentId: string) => void;
  onOpenPullRequest: (agentId: string) => void;
  /** New agent, the + standing at rest on the group's head as the strip's "+" offers it (`newAgentStarts`); none on a task that starts no agent. */
  newAgent: MenuAction | undefined;
  /** A phone's additions; none elsewhere. */
  phone?: PlanAgentsPhone | undefined;
}): React.JSX.Element | null {
  // Note that an entry's pick chooses its agent's tab, which a row hands the page as that agent's id.
  const directory = useMemberDirectory();
  const entries = agentEntries(
    {
      tab,
      onChoose: (chosen) => {
        if (typeof chosen !== "string" && chosen.kind === STRIP_TAB_KIND.AGENT) {
          onOpenAgent(chosen.agent);
        }
      },
    },
    agents,
    directory,
    held,
  );
  // Note that a phone's group stands for its archived agents too, on a task whose every agent is archived, which starts none.
  const archived = phone === undefined ? 0 : (agents.archived?.length ?? 0);
  // Note that an empty group stands only once the agents are read, so a task loading its agents does not offer New agent.
  const empty = agents.agents?.length === 0 && newAgent !== undefined;
  // Note that a group over nothing folds nothing, since a fold over no rows would hide nothing.
  const holds = entries.length > 0 || archived > 0;
  const grouped = holds || empty;
  // Note that a phone's Inbox row counts only what no listed agent's row marks already.
  const listed = new Set(entries.map((entry) => entry.row.id));
  let unmarked = 0;
  for (const [agentId, items] of waiting) if (!listed.has(agentId)) unmarked += items.length;
  const inboxRow = phone !== undefined && unmarked > 0 ? phone : undefined;
  const more = !useCoarsePointer();
  const ordered = inAgentListOrder(
    entries,
    (entry) => entry.agent,
    (entry) => waiting.has(entry.row.id),
  );
  const selection = useAgentsSelection(
    agents,
    ordered.flatMap(({ agent }) => (agent === undefined ? [] : [agent])),
    shown,
  );
  if (!grouped && inboxRow === undefined) return null;
  return (
    // Note that the group is pulled out by a row's inset on each side, so its marks stand on the title's edge and its fills hang past it.
    <div className="plan-agents -mx-row-inset mb-block-gap">
      {grouped ? (
        <ReplayUnmask>
          <GroupHeader
            // Note that the head is drawn anew as it empties or fills, so a fold closed over agents now gone does not hide the next one, as the group used to leave and come back open.
            key={holds ? "holds" : "empty"}
            heading={GROUP_HEADING.NONE}
            label={AGENTS_LIST}
            glyph={<EntityGlyph kind={ENTITY_KIND.AGENT} />}
            actions={newAgent === undefined ? undefined : <NewAgentAction start={newAgent} />}
            actionsShown={GROUP_ACTIONS.AT_REST}
            // Note that a group over no agent, standing for its read again or its archived agents, counts none.
            count={
              entries.length === 0
                ? undefined
                : {
                    value: entries.length,
                    noun: entries.length === 1 ? AGENTS_NOUN.one : AGENTS_NOUN.many,
                  }
            }
            fold={holds ? { defaultOpen: !folded } : undefined}
          >
            {entries.length === 0 ? null : (
              <TaskRows
                id={selection.regionId}
                label={AGENTS_LIST}
                cells={AGENT_ROW_CELLS}
                more={more}
                selection={{ selected: selection.selected, onChange: selection.onChange }}
                moves
              >
                {ordered.map((entry) => (
                  <PlanAgentRow
                    key={entry.row.id}
                    entry={entry}
                    waits={waiting.get(entry.row.id)?.length ?? 0}
                    pullRequest={agents.pullRequests.get(entry.row.id)}
                    agents={agents}
                    held={held}
                    tab={tab}
                    shown={shown}
                    more={more}
                    chosen={selection.chosenOf(entry.row.id)}
                    onOpenPullRequest={() => onOpenPullRequest(entry.row.id)}
                  />
                ))}
              </TaskRows>
            )}
            {phone?.archived}
          </GroupHeader>
        </ReplayUnmask>
      ) : null}
      {selection.dialog}
      {inboxRow === undefined ? null : (
        <List label={NEEDS_YOU.LABEL} density={LIST_DENSITY.DENSE}>
          <ListRow
            leading={<GLYPH.INBOX />}
            title={<ReplayUnmask>{threadsWaitingWords(unmarked)}</ReplayUnmask>}
            chevron
            onPress={inboxRow.onOpenInbox}
          />
        </List>
      )}
    </div>
  );
}
