import type { AgentPullRequest } from "@repo/features/agent-wire";
import { NEEDS_YOU, threadsWaitingWords } from "@repo/features/inbox-list-model";
import type { InboxItem } from "@repo/features/inbox-wire";
import { type NumberedAddress, pullRequestAddressOf } from "@repo/features/link-grammar";
import {
  agentLastMovedAt,
  agentTree,
  inAgentListOrder,
  type StartedAgentsStanding,
} from "@repo/features/task-agents-model";
import { APP_COMMAND } from "@repo/settings/shortcuts";
import {
  BUTTON_SIZE,
  GROUP_ACTIONS,
  GROUP_HEADING,
  GROUP_LOOK,
  GroupAction,
  GroupHeader,
  IconButton,
  LIST_DENSITY,
  List,
  ListRow,
  type ListRowFold,
  type ListRowNest,
  TaskRows,
  Tooltip,
} from "@repo/ui";
import { GLYPH, PlusIcon } from "@repo/ui/icons";
import { ReplayUnmask } from "@repo/ui/session-replay-marks";
import { agentTab, sameTab } from "@repo/ui/tab-strip-model";
import { Schema } from "effect";
import { memo, useMemo, useState } from "react";
import { useCoarsePointer } from "../coarse-pointer.js";
import { useSteadyDoors } from "../steady-door.js";
import { AgentCard, agentSubject, NOTHING_HELD } from "../tasks/agent-ref.js";
import {
  type AgentsControl,
  type AgentsSource,
  type ListedAgentPlace,
  placeAgents,
  useListedAgentPlaces,
  useTaskAgentsFor,
} from "../tasks/use-agents.js";
import type { MainTabsControl } from "../tasks/use-main-tabs.js";
import { keptKey, useKept } from "../use-kept.js";
import type { MenuAction } from "./action-menu.js";
import { AGENT_ROW_CELLS, AgentListRow } from "./agent-list-row.js";
import { useAgentsSelection } from "./agents-selection.js";
import { nestsOf } from "./nested-rows.js";
import { type CountNoun, foldedCount } from "./sidebar-fold.js";
import type { HeldTranscripts } from "./strip-tabs.js";
import type { ChosenRows } from "./tasks-selection.js";

/**
 * overview-agents.tsx -- the open task's agents at the head of its description, as a group: one row each in a task's row's anatomy, its tab's glyph and name, its pull request, where it runs, its failure where it failed, and when it last moved.
 *
 * The agents stand under a group head, Agents and how many, which folds
 * them, folded where the page asks, the same shape every group of
 * the head takes, a `GroupHeader` over their rows. Each row is the
 * task's agent, hanging its tab's card,
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
 * An agent another agent started stands nested under it, an orchestrator's
 * workers under the orchestrator, as a task's sub-tasks nest, folded until
 * opened, the row it stands under counting how many under it still work
 * and marking one that failed (`agentTree`); a worker an orchestrator started before it was continued
 * stands under the agent that continued it.
 * The agents list oldest started first, as Sub-tasks do, each row at the
 * top standing where the first agent under it does; an
 * archived agent is not listed. The group lays its rows out by what a
 * step of a turn never moves (`useListedAgentPlaces`), and each row reads
 * its own agent, so one agent's step draws that agent's row alone. New agent stands on the group's head at
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
 * archived agents folded under them behind Archived, each the same row as a
 * listed agent's, settled, chosen together as the listed agents are, and
 * offering Unarchive in Archive's place, starting folded and then standing
 * as the reader left it, kept on this device, and, after the group, the
 * task's Inbox counting what
 * waits on the developer that no listed agent's row marks already, such as
 * an archived agent's thread, only while something does.
 */

/** A phone's additions to the group; see the module's head. */
interface PlanAgentsPhone {
  /** Opens an archived agent's tab, where its transcript is read and it is brought back. */
  readonly onOpenArchived: (agentId: string) => void;
  /** Opens the window's Inbox narrowed to the task. */
  readonly onOpenInbox: () => void;
}

/** What the group is called, and its list for a reader moving between lists. */
const AGENTS_LIST = "Agents";

/** The words an agent's fold is named by, before its name: the agents it started. */
const STARTED_BY = "Agents started by";

/** What the group's count counts, said to a reader beside the figure. */
const AGENTS_NOUN = { one: "agent", many: "agents" } as const;

/** What the archived agents' fold says, and its list for a reader moving between lists. */
const ARCHIVED = { LABEL: "Archived", LIST: "Archived agents" } as const;

/** What the archived fold's count is read as while folded. */
const ARCHIVED_NOUN: CountNoun = { one: "archived agent", many: "archived agents" };

/** Whether the reader left Archived open, one choice for every task's Overview, kept on this device. */
const KEPT = {
  UNFOLDED: keptKey("app.taskArchivedUnfolded", Schema.fromJsonString(Schema.Boolean)),
} as const;

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

/** What one agent's row of the group is handed besides the control, all of it steady across draws that change nothing it reads (`useSteadyDoors`). */
interface PlanAgentRowProps {
  agentId: string;
  /** How many of its threads wait on the developer, those under its fold among them. */
  waits: number;
  held: HeldTranscripts;
  /** Whether its tab is the column's chosen one, whose card follows its run. */
  opened: boolean;
  /** Whether the group is on screen, which its menu asks on. */
  shown: boolean;
  /** Whether it draws its ⋯, as its list does. */
  more: boolean;
  /** The selection it stands in, where it is one of several chosen. */
  chosen: ChosenRows | undefined;
  /** Whether it stands settled, an archived agent's row on a phone. */
  settled?: boolean | undefined;
  /** How deep it stands nested under the agent that started it. */
  depth?: number | undefined;
  /** Where it stands among the agents nested beside it. */
  nest?: ListRowNest | undefined;
  /** The agents it started, which it folds; none where it started none. */
  fold?: ListRowFold | undefined;
  /** Where the agents it started stand, at every depth. */
  started?: StartedAgentsStanding | undefined;
  /** Opens the agent, by its id. */
  onOpen: (agentId: string) => void;
  onOpenPullRequest: (pullRequest: NumberedAddress) => void;
}

/**
 * One agent's row (`AgentListRow`), offering the agent's menu as a person's
 * page does: its tab's card, how many of its threads wait on the developer,
 * its pull request's chip where it opened one, where it runs, its failed
 * mark, and when it last moved. Note that it reads its own agent
 * (`useTaskAgentsFor`), and holds while what it is handed does (`memo`), so
 * a step of one agent's turn draws only that agent's row.
 */
const HeldPlanAgentRow = memo(function HeldPlanAgentRow({
  agents: source,
  agentId,
  waits,
  held,
  opened,
  shown,
  more,
  chosen,
  settled,
  depth,
  nest,
  fold,
  started,
  onOpen,
  onOpenPullRequest,
}: PlanAgentRowProps & { agents: AgentsSource }): React.JSX.Element | null {
  const agents = useTaskAgentsFor(source, agentId);

  const agent =
    agents.agents?.find((each) => each.id === agentId) ??
    agents.archived?.find((each) => each.id === agentId);

  if (agent === undefined) return null;
  const subject = agentSubject(agents, agentId, held, opened);
  const pullRequest = agents.pullRequests.get(agentId);

  return (
    <AgentListRow
      agent={agent}
      agents={agents}
      shown={shown}
      subject={subject}
      at={agentLastMovedAt(agent)}
      card={<AgentCard subject={subject} models={agents.models} />}
      pullRequest={pullRequest}
      waits={waits}
      more={more}
      chosen={chosen}
      settled={settled}
      depth={depth}
      nest={nest}
      fold={fold}
      started={started}
      onPress={() => onOpen(agentId)}
      onOpenPullRequest={() => openListed(pullRequest, onOpenPullRequest)}
    />
  );
});

/** One agent's row of the group, handed on steady, so the row holds while its list draws again for another (`HeldPlanAgentRow`). */
function PlanAgentRow({
  agents,
  ...rest
}: PlanAgentRowProps & { agents: AgentsSource }): React.JSX.Element {
  return <HeldPlanAgentRow {...useSteadyDoors(rest)} agents={agents} />;
}

/** Opens the pull request an agent's row names, by the repository and number its page names; nothing where it names none. */
function openListed(
  pullRequest: Pick<AgentPullRequest, "url"> | undefined,
  open: (pullRequest: NumberedAddress) => void,
): void {
  const address = pullRequest === undefined ? undefined : pullRequestAddressOf(pullRequest.url);

  if (address !== undefined) open(address);
}

/** The task's archived agents, folded under Archived at the foot of a phone's agents, each a listed agent's row, settled; nothing while none is archived. */
function PlanArchivedAgents({
  agents,
  acts,
  archived,
  shown,
  more,
  onOpen,
  onOpenPullRequest,
}: {
  agents: AgentsSource;
  /** The control the selection acts through. */
  acts: AgentsControl;
  /** The task's archived agents as the list lays them out. */
  archived: readonly ListedAgentPlace[];
  /** Whether the task's page is on screen, which each row's menu asks on. */
  shown: boolean;
  /** Whether its rows draw their ⋯. */
  more: boolean;
  onOpen: (agentId: string) => void;
  onOpenPullRequest: (pullRequest: NumberedAddress) => void;
}): React.JSX.Element | null {
  const [unfolded, setUnfolded] = useKept(KEPT.UNFOLDED, false);
  const selection = useAgentsSelection(acts, archived, shown);

  if (archived.length === 0) return null;

  return (
    <div className="overview-agents-archived mt-list-gap">
      <GroupHeader
        heading={GROUP_HEADING.NONE}
        look={GROUP_LOOK.SECTION}
        label={ARCHIVED.LABEL}
        fold={{ open: unfolded, onOpenChange: setUnfolded }}
        count={foldedCount(!unfolded, archived.length, ARCHIVED_NOUN)}
      >
        <TaskRows
          id={selection.regionId}
          label={ARCHIVED.LIST}
          cells={AGENT_ROW_CELLS}
          more={more}
          selection={{ selected: selection.selected, onChange: selection.onChange }}
        >
          {archived.map((agent) => (
            <PlanAgentRow
              key={agent.id}
              agents={agents}
              agentId={agent.id}
              waits={0}
              // Note that an archived agent's card reads nothing its tabs hold, since none of them shows it here.
              held={NOTHING_HELD}
              opened={false}
              shown={shown}
              more={more}
              chosen={selection.chosenOf(agent.id)}
              settled
              onOpen={onOpen}
              onOpenPullRequest={onOpenPullRequest}
            />
          ))}
        </TaskRows>
      </GroupHeader>
      {selection.dialog}
    </div>
  );
}

/**
 * The task's agents at the head of its description, under their group's head,
 * oldest started first, or its head alone where it lists none and offers New agent;
 * nothing where it offers neither.
 * A row's press is handed to `onOpenAgent` by its agent's id, and
 * `onOpenPullRequest` opens an agent's pull request as its own chip does, by
 * its repository and number.
 */
export function OverviewAgents({
  agents: agentsSource,
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
  agents: AgentsSource;
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
  onOpenPullRequest: (pullRequest: NumberedAddress) => void;
  /** New agent, the + standing at rest on the group's head as the strip's "+" offers it (`newAgentStarts`); none on a task that starts no agent. */
  newAgent: MenuAction | undefined;
  /** A phone's additions; none elsewhere. */
  phone?: PlanAgentsPhone | undefined;
}): React.JSX.Element | null {
  // Note that the list reads only what lays its rows out, and each row reads its own agent, so a step of an agent's turn draws that agent's row and nothing around it.
  const places = useListedAgentPlaces(agentsSource);
  const listedPlaces = places.agents ?? [];

  const acts = useMemo(
    () => ("rows" in agentsSource ? placeAgents(agentsSource) : agentsSource),
    [agentsSource],
  );

  // Note that a phone's group stands for its archived agents too, on a task whose every agent is archived, which starts none.
  const archived = phone === undefined ? 0 : (places.archived?.length ?? 0);
  // Note that an empty group stands only once the agents are read, so a task loading its agents does not offer New agent.
  const empty = places.agents?.length === 0 && newAgent !== undefined;
  // Note that a group over nothing folds nothing, since a fold over no rows would hide nothing.
  const holds = listedPlaces.length > 0 || archived > 0;
  const grouped = holds || empty;
  // Note that a phone's Inbox row counts only what no listed agent's row marks already.
  const listed = new Set(listedPlaces.map((agent) => agent.id));
  let unmarked = 0;

  for (const [agentId, items] of waiting) if (!listed.has(agentId)) unmarked += items.length;
  const inboxRow = phone !== undefined && unmarked > 0 ? phone : undefined;
  const more = !useCoarsePointer();

  const ordered = inAgentListOrder(listedPlaces, (agent) => agent);

  // Note that the agents an agent started stand folded under it until opened, as a sub-task's own sub-tasks do.
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set());

  const tree = agentTree(
    ordered,
    (agent) => agent,
    (agentId) => opened.has(agentId),
  );

  const nests = nestsOf(tree);

  const foldOf = (agent: ListedAgentPlace, open: boolean): ListRowFold => ({
    open,
    label: `${STARTED_BY} ${agent.title ?? AGENTS_NOUN.one}`,
    onOpenChange: (asked) => {
      setOpened((held) => {
        if (asked === held.has(agent.id)) return held;
        const next = new Set(held);

        if (asked) next.add(agent.id);
        else next.delete(agent.id);

        return next;
      });
    },
  });

  // Note that a row standing folded counts what waits on the developer under it too, so no thread waits unsaid.
  const waitsUnder = (agent: ListedAgentPlace, folded: readonly ListedAgentPlace[] | undefined) =>
    [agent, ...(folded ?? [])].reduce(
      (count, each) => count + (waiting.get(each.id)?.length ?? 0),
      0,
    );

  const selection = useAgentsSelection(acts, ordered, shown);

  if (!grouped && inboxRow === undefined) return null;

  return (
    // Note that the group is pulled out by a row's inset on each side, so its marks stand on the title's edge and its fills hang past it.
    <div className="overview-agents -mx-row-inset mb-block-gap">
      {grouped ? (
        <ReplayUnmask>
          <GroupHeader
            // Note that the head is drawn anew as it empties or fills, so a fold closed over agents now gone does not hide the next one.
            key={holds ? "holds" : "empty"}
            heading={GROUP_HEADING.NONE}
            label={AGENTS_LIST}
            look={GROUP_LOOK.SECTION}
            actions={newAgent === undefined ? undefined : <NewAgentAction start={newAgent} />}
            actionsShown={GROUP_ACTIONS.AT_REST}
            // Note that a group over no agent, standing for its read again or its archived agents, counts none.
            count={
              listedPlaces.length === 0
                ? undefined
                : {
                    value: listedPlaces.length,
                    noun: listedPlaces.length === 1 ? AGENTS_NOUN.one : AGENTS_NOUN.many,
                  }
            }
            fold={holds ? { defaultOpen: !folded } : undefined}
          >
            {listedPlaces.length === 0 ? null : (
              <div className="min-w-0">
                <TaskRows
                  id={selection.regionId}
                  label={AGENTS_LIST}
                  cells={AGENT_ROW_CELLS}
                  more={more}
                  selection={{ selected: selection.selected, onChange: selection.onChange }}
                >
                  {tree.map(({ entry, depth, started, folded }, at) => (
                    <PlanAgentRow
                      key={entry.id}
                      agents={agentsSource}
                      agentId={entry.id}
                      depth={depth}
                      nest={nests[at]}
                      fold={started === undefined ? undefined : foldOf(entry, opened.has(entry.id))}
                      started={started}
                      waits={waitsUnder(entry, folded)}
                      held={held}
                      opened={tab !== undefined && sameTab(agentTab(entry.id), tab)}
                      shown={shown}
                      more={more}
                      chosen={selection.chosenOf(entry.id)}
                      onOpen={onOpenAgent}
                      onOpenPullRequest={onOpenPullRequest}
                    />
                  ))}
                </TaskRows>
              </div>
            )}
            {phone === undefined ? null : (
              <PlanArchivedAgents
                agents={agentsSource}
                acts={acts}
                archived={places.archived ?? []}
                shown={shown}
                more={more}
                onOpen={phone.onOpenArchived}
                onOpenPullRequest={onOpenPullRequest}
              />
            )}
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
