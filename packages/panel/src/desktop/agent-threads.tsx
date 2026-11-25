import {
  EVERYONES,
  INBOX_SHOW,
  INBOX_WHOSE,
  type InboxAnyHolder,
  type InboxListed,
  inboxAtNow,
  inboxCounts,
  inboxGroup,
  listedItems,
  NOTHING_HERE,
} from "@repo/features/inbox-list-model";
import { searchTokens } from "@repo/features/search-tokens";
import { APP_COMMAND } from "@repo/settings/shortcuts";
import { BackButton, FILL_ELEMENT, Fill, Toolbar, useMinute } from "@repo/ui";
import { ReplayUnmask } from "@repo/ui/session-replay-marks";
import { useMemo, useState } from "react";
import { useAppCommand } from "../app-commands.js";
import { useBackOr } from "../places/narrow-backs.js";
import { useInboxResolver } from "../tasks/inbox-close.js";
import {
  INBOX_COLUMNS,
  INBOX_VIEW,
  INBOX_VIEW_ITEMS,
  useInboxColumns,
} from "../tasks/inbox-columns.js";
import { InboxList, InboxListNote, InboxPaneEmpty } from "../tasks/inbox-list.js";
import { useInboxPager } from "../tasks/inbox-pager.js";
import { INBOX_PANE_ACTIONS, InboxPane, type InboxPaneDoors } from "../tasks/inbox-pane.js";
import { type AgentsSource, useTaskAgents } from "../tasks/use-agents.js";
import { useHeldInboxList } from "../tasks/use-held-inbox-list.js";
import { useInboxReadMarks, useNodOnOpen, useReadOnOpen } from "../tasks/use-inbox-read-marks.js";
import type { TaskInboxControl } from "../tasks/use-task-inbox.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { paneDoors, startedThreads } from "./desktop-inbox.js";
import { useInboxViewChoices } from "./folded-groups.js";

/**
 * agent-threads.tsx -- an agent's threads inside its card in the task's column: the Inbox's list of the items it posted beside the one chosen, both the window's Inbox's own.
 *
 * The dock over the agent's box (`threads-dock.tsx`) opens them in the
 * card, on the thread it names, and they stand in the transcript's place,
 * the transcript kept drawn beneath, hidden (`AgentPane`'s `hidden`), so
 * the way back, the list head's ‹ Transcript or Escape, finds it where it
 * was, standing where the task's details stand their ‹ Agents. Nothing here
 * is drawn anew: the list is the Inbox's (`inbox-list.tsx`) as an Inbox
 * narrowed to a task lists it, every item, open and settled, addressed to
 * anyone, the latest changed first, held still while it is shown
 * (`use-held-inbox-list.ts`), but of this agent alone, its name in a bar
 * title's type; the thread is the Inbox's pane (`inbox-pane.tsx`), answered
 * on the task's own held read as the task's page holds it, its bar naming
 * neither the task nor the agent, which the card's tab and the task's
 * topbar name, with the window's Inbox's doors (`desktop-inbox.tsx`'s `paneDoors`), bar a
 * press on the agent, which goes back to the transcript, the agent's own.
 * Choosing a row, or K and J,
 * shows its thread; an answer keeps the list beside it, and a new thread
 * started from the box opens in the card (`startedThreads`). Opening an item
 * reads it, and a notice is acknowledged as it opens, as in the Inbox. Too
 * narrow for both, the card shows one at a time as the Inbox does
 * (`inbox-columns.ts`). A Manager's page, its agent on no task, draws the
 * same as its Inbox tab (`desktop-agent-page.tsx`), held by the Manager
 * rather than a task, with no way back, since its transcript is a sibling
 * tab rather than the step behind: the tab row names the list, so the list
 * stands with no bar of its own, and the thread's ⋯ stands at its title
 * (`INBOX_PANE_ACTIONS.SUBJECT`), as the window's Inbox's title starts at
 * the pane's top. Its list offers the window's Inbox's search and view's
 * menu, its scope and Addressed to, the choices the window's Inbox keeps
 * and shares with it (`useInboxViewChoices`), so either narrowed narrows
 * both; Pinned tasks first is left out, since the Manager holds its
 * threads itself rather than under a task to pin.
 *
 * Each agent keeps whether its card shows its threads, and which
 * (`tasks/agent-thread-views.ts`), so going to another agent's tab and back
 * finds the card as it was left, and the task's step in the window's
 * history holds them: opening them from the dock, and each thread chosen,
 * K and J among them, is a step of its own, and their ways back are Back
 * where what they go back to is the step behind (`places/task-step.ts`).
 */

/** What the card's way back says, and the place its hint names. */
const TRANSCRIPT = { LABEL: "Transcript", PLACE: "transcript" } as const;

/** What the list lists: every item, open or settled, as an Inbox narrowed to a task does. */
const AGENT_LISTS = { show: INBOX_SHOW.ALL, whose: EVERYONES } as const;

/**
 * The pane's doors as the window's Inbox hands them for an item of a task
 * (`paneDoors`), the panel beside the card standing for the task, but for
 * the agent's own crumb, which goes back to its transcript in this card.
 */
function agentPaneDoors(
  tasks: TasksControl,
  listed: InboxListed<InboxAnyHolder>,
  agentId: string,
  onBack: () => void,
): InboxPaneDoors {
  const doors = paneDoors(tasks, listed.holder, {
    panelFor: tasks.activeTaskId,
    openPlace: (_place, elsewhere) => elsewhere(),
  });

  return {
    ...doors,
    onOpenAgent: (each) => (each === agentId ? onBack() : doors.onOpenAgent(each)),
  };
}

/** The agent's threads in its card: the Inbox's list of its items beside the one chosen. */
export function AgentThreads({
  agentId,
  holder,
  tasks,
  agentsOf,
  inbox,
  chosen,
  shown,
  active,
  onChoose,
  onBack,
  tabbed,
}: {
  agentId: string;
  /** What holds the agent's items, as the list names it: the task it works on, or the agent itself on no task. */
  holder: InboxAnyHolder;
  tasks: TasksControl;
  /** The agents the card reads: the task's, or the page's own where the agent is on no task. */
  agentsOf: AgentsSource;
  /** The holder's own held read, which its page holds, and which answers its items. */
  inbox: TaskInboxControl;
  /** The id of the item shown; none while the list stands alone. */
  chosen: string | undefined;
  /** Whether the card is on screen. */
  shown: boolean;
  /** Whether the card holds the keys, for K, J, and Escape, and an item opened to be read. */
  active: boolean;
  onChoose: (itemId: string | undefined) => void;
  /** Goes back to the agent's transcript, as its crumb in a thread does. */
  onBack: () => void;
  /** Whether the transcript is a sibling tab rather than the step behind, so the list leads with no ‹ Transcript and Escape leaves it be. */
  tabbed?: boolean | undefined;
}): React.JSX.Element {
  const { me } = tasks;
  // Note that the card draws the task's agents' threads, so it reads their rows while it stands.
  const agents = useTaskAgents(agentsOf);
  const { open, settled } = inbox.board;
  // Note that a reminder is weighed on the window's clock, as the Inbox weighs it.
  const now = useMinute();

  const standing = useMemo(
    () =>
      inboxAtNow(
        [
          inboxGroup(
            holder,
            [...open, ...settled].filter((item) => item.agentId === agentId),
          ),
        ],
        now,
      ),
    [holder, open, settled, agentId, now],
  );

  // Note that a Manager's Inbox tab lists as the window's Inbox's choices say, where a task's card lists every item.
  const choices = useInboxViewChoices();
  const { show, whose } = tabbed === true ? choices : AGENT_LISTS;
  const [query, setQuery] = useState("");
  const search = useMemo(() => searchTokens(query), [query]);

  const filter = useMemo(() => ({ show, whose, search, readerId: me }), [show, whose, search, me]);

  const { list, steps, onPointing } = useHeldInboxList(standing, filter, chosen, shown);
  const listedRows = useMemo(() => listedItems(list), [list]);

  const listed = useMemo(
    () => listedItems(steps).find(({ item }) => item.id === chosen),
    [steps, chosen],
  );

  const counts = useMemo(() => inboxCounts(standing, me, whose), [standing, me, whose]);
  const searched = search.length > 0 ? query : undefined;

  // Note that a scope leaving out every item the agent holds is said apart from an agent holding none, as the window's Inbox says it.
  const filteredOut =
    tabbed === true &&
    searched === undefined &&
    listedRows.length === 0 &&
    (show !== INBOX_SHOW.ALL || whose.kind !== INBOX_WHOSE.EVERYONE) &&
    standing.some(({ items }) => items.length > 0);

  // Note that the narrow card's ‹ back to the list is the window's Back, as the Inbox's is, the list taking the thread's step only where none stands behind.
  const backOr = useBackOr();

  // Note that the card's columns hold no item while it is off screen, so no way back of theirs takes the window's Back meanwhile,
  // nor one the read no longer holds, so a narrow card stands its list, with its way back, rather than nothing.
  const columns = useInboxColumns(shown ? listed?.item.id : undefined, {
    onClear: () => backOr(() => onChoose(undefined)),
  });

  const choose = (each: InboxListed<InboxAnyHolder>) => {
    columns.onOpen(each.item.id);
    onChoose(each.item.id);
  };

  const step = (each: InboxListed<InboxAnyHolder>) => {
    columns.onStep();
    onChoose(each.item.id);
  };

  const pager = useInboxPager(steps, list, chosen, step, { shown: active });
  useAppCommand(APP_COMMAND.EXIT_AGENT_THREADS, active && tabbed !== true ? onBack : undefined);
  const marks = useInboxReadMarks({ workspaceId: tasks.workspace?.id, readerId: me });
  const resolveItems = useInboxResolver();
  // The item shown is read as it opens, as the Inbox reads it, only while the card holds the keys.
  const opened = active && columns.shown !== INBOX_COLUMNS.LIST ? listed : undefined;
  useReadOnOpen({
    shown: opened?.item,
    chosen: listed?.item,
    active,
    marks,
  });
  // Note that the task's page holds its read with its cards' drafts, so the pane takes it whole.
  useNodOnOpen({ shown: opened, readerId: me, control: inbox });

  // Note that under a tab row, which names the list, the list draws no bar of its own, and the thread's ⋯ stands at its title.
  const head =
    tabbed === true
      ? { shown: active, view: choices, search: { query, onQuery: setQuery }, bare: true }
      : {
          shown: active,
          view: undefined,
          lead: (
            <ReplayUnmask>
              <BackButton
                label={TRANSCRIPT.LABEL}
                place={TRANSCRIPT.PLACE}
                command={APP_COMMAND.EXIT_AGENT_THREADS}
                onBack={onBack}
              />
            </ReplayUnmask>
          ),
        };

  return (
    <Fill as={FILL_ELEMENT.SECTION} className="agent-threads" data-popover-room="">
      <div className={INBOX_VIEW} ref={columns.ref} data-columns={columns.shown}>
        <InboxList
          view={list}
          chosen={chosen}
          columns={columns.shown}
          rows={columns.rows}
          head={head}
          models={agents.models}
          readerId={me}
          note={
            <InboxListNote
              failed={inbox.failed}
              reading={inbox.reading}
              empty={listedRows.length === 0}
              alone={columns.shown === INBOX_COLUMNS.LIST}
              filteredOut={filteredOut ? choices : undefined}
              counts={counts}
              onList={columns.onList}
              onRetry={inbox.onRetry}
              searched={searched}
              none={NOTHING_HERE}
            />
          }
          onChoose={choose}
          onMark={(each, unread, saying) => marks.onMark(each.item, unread, saying)}
          onClose={resolveItems}
          onRemind={marks.onRemind}
          onPointing={onPointing}
        />
        {listed === undefined ? (
          <section className={INBOX_VIEW_ITEMS} hidden={columns.shown !== INBOX_COLUMNS.BOTH}>
            <Toolbar />
            {inbox.failed || inbox.reading ? null : (
              <InboxPaneEmpty listed={listedRows.length} none={NOTHING_HERE} />
            )}
          </section>
        ) : (
          <InboxPane
            holder={listed.holder}
            item={listed.item}
            control={inbox}
            agents={agents}
            hidden={columns.shown === INBOX_COLUMNS.LIST}
            onBack={columns.onBack}
            pager={columns.shown === INBOX_COLUMNS.ITEM ? pager : undefined}
            within
            actionsAt={tabbed === true ? INBOX_PANE_ACTIONS.SUBJECT : INBOX_PANE_ACTIONS.BAR}
            newThread={
              tasks.signedIn
                ? startedThreads(agents.startInboxThread, (_item, itemId) => onChoose(itemId))
                : undefined
            }
            doors={{
              ...agentPaneDoors(tasks, listed, agentId, onBack),
              onMark: marks.onMark,
              onClose: resolveItems,
              onRemind: marks.onRemind,
            }}
          />
        )}
      </div>
    </Fill>
  );
}
