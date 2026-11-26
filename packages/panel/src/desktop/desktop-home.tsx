import {
  type InboxAnyHolder,
  type InboxListed,
  waitsOnReaderNow,
} from "@repo/features/inbox-list-model";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { TERM } from "@repo/features/words";
import {
  Arrival,
  DetailPage,
  ErrorState,
  joinRefs,
  PAGE_FRAME,
  STATUS_TONE,
  useMinute,
  useRovingKeys,
} from "@repo/ui";
import { ReplayMask, ReplayUnmask } from "@repo/ui/session-replay-marks";
import { TAB_WORDS } from "@repo/ui/tab-strip-model";
import { reachAcrossRuns } from "@repo/ui/virtual-rows";
import { useMemo, useRef, useState } from "react";
import { LinkWorkspaceProvider } from "../copy-link-item.js";
import { EDITOR_ROOT_SELECTOR } from "../description-editor/contract.js";
import { unreadShown } from "../failure-report.js";
import { useInboxOn } from "../inbox-on.js";
import { MemberDirectory } from "../member-directory.js";
import { SHELL_ROOM, type ShellRoom } from "../shell-room.js";
import { useRecentTasks } from "../task-list-collections.js";
import { NOTICE_LOOK } from "../tasks/connect-agent-banner.js";
import { InboxItemRows } from "../tasks/inbox-item-rows.js";
import { MENTION_MENU_SIDE } from "../tasks/mention-picker.js";
import { NewTaskComposer } from "../tasks/new-task-composer.js";
import { useNewTaskShown } from "../tasks/use-new-task.js";
import { useUnreadTasks } from "../tasks/use-task-looks.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { useWaitingItems, type WaitingItems } from "../tasks/use-waiting-items.js";
import { letGoOfFocus, useHomeNewTask, useListsTask, welcomed } from "./desktop-welcome.js";
import { HomeStarters } from "./home-starters.js";
import { OfficePage } from "./office-prototype/office-page.js";
import { OFFICE } from "./office-prototype/office-params.js";
import { PERSON_SECTION_FOLD, PersonBody, PersonSectionFrame } from "./person-frame.js";
import { RecentTasks } from "./recent-tasks.js";

/**
 * desktop-home.tsx -- Home: the page the window rests on with no task open, opening on New task's composer under a greeting and saying what waits on the developer and the tasks worked on latest.
 *
 * It is one page (`DetailPage`), as a chat app's empty page is: the
 * greeting as its title, and at the top of its content New task's composer
 * (`new-task-composer.tsx`) in place of a New task button, drawn as the
 * dialog draws it, so the page opens on a prompt box the way Codex's and
 * ChatGPT's do, but that what holds a start, no agent connected, or the
 * workspace having no repositories yet, stands over it as cards rather than
 * the dialog's line, since Home is where a new account first looks; then
 * Inbox, every open item of the listed workspace waiting on the reader, as
 * the Inbox's own row draws it, a press opening the Inbox on it; then Recent, the listed workspace's tasks with the latest activity,
 * each the Tasks page's row as a person's page lists it (`recent-tasks.tsx`),
 * a press opening it. Its sections are a person's page's (`person-frame.tsx`),
 * whose voice was Home's to begin with, each folding on a press on its
 * head as the person's page's do, and standing in its body
 * (`PersonBody`), so Recent glides as Inbox folds or its rows go. While the
 * workspace holds few tasks, a few starters stand under the composer, each
 * a job a press writes into it, since a blank box leaves a newcomer to
 * think of what to ask. Inbox stands only while something waits, so a new
 * account's page is its greeting and composer alone, and a
 * cleared one's Recent rises under the composer. An account with nothing yet
 * is greeted as new.
 * Nothing here names the sidebar, which may be folded away.
 *
 * The composer starts the task in the listed workspace, as the dialog
 * would. Home is New task's page: a New task press while it stands, ⌘N's
 * and the sidebar's among them, hands the composer's words the caret
 * rather than opening the dialog over the same card; the dialog stays for
 * every other place, and only Home holds the card inline. Its words take the caret as the page
 * shows, unless the developer is typing in a field elsewhere or the room is a
 * phone's, whose places bar a field typed in puts away, and Escape
 * there with nothing in it to close takes the caret out of the words. Its
 * words and files are New task's draft in the workspace, which the dialog
 * shares, so leaving Home keeps them.
 *
 * The rows of both sections are one Tab stop that ↑ and ↓ walk from the
 * first Inbox item to the last recent task (`useRovingKeys`), and Return
 * opens the row reached, so a launch is a key or two from a task. The
 * Inbox draws only the rows near the view (`InboxItemRows`), so the walk
 * reads its every row where it stands (`reachAcrossRuns`), and a step past
 * the last one drawn goes on to the next item rather than to Recent. Until the
 * task list is read the page draws what it already knows, the greeting and
 * the composer, which hang on no list, and nothing where the sections will
 * stand, unless the read has stood a while, when one quiet line says it is
 * reading; the sections fade in as they land (`Arrival`), together where the
 * page opened on a list still being read. A read refused says so under
 * Recent, with Retry.
 */

/**
 * How many tasks Recent lists in each room: a few beside the sidebar, which
 * lists them all, and more on a phone, where the sidebar is a drawer and
 * Home, the page the app opens on, is the list at hand.
 */
const RECENT_COUNT = {
  [SHELL_ROOM.WIDE]: 6,
  [SHELL_ROOM.NARROW]: 20,
} as const satisfies Record<ShellRoom, number>;

/** What Recent is called, as its heading and its list. */
const RECENT = "Recent";

/** What the page says once the task list's read has stood a while. */
const READING_TASKS = "Reading your tasks…";

/** What the page says where an Inbox read did not answer, as the Inbox says it. */
const ITEMS_NOT_READ = "Some inbox items could not be read.";

/** What the page says where the task list could not be read, as the sidebar says it. */
const TASKS_NOT_READ = "Your tasks could not be read.";

/** The greeting: the account's first name where it has one, welcomed back unless the account is new; a screen recording shows the welcome and masks the name. */
function greeting(name: string | undefined, fresh: boolean): React.JSX.Element {
  const first = name?.trim().split(/\s+/u)[0];
  const words = fresh ? "Welcome" : "Welcome back";

  return (
    <ReplayUnmask>
      {words}
      {first === undefined || first === "" ? null : (
        <>
          , <ReplayMask>{first}</ReplayMask>
        </>
      )}
    </ReplayUnmask>
  );
}

/**
 * Whether Home's sections are still arriving: while the task list is read,
 * and, where the page opened on a list still being read, until the Inbox's
 * first read answers too, so both sections land together rather than the
 * Inbox landing over Recent. Note that a later read of a holder newly listed
 * leaves what stands in place, because only the first read holds the page.
 */
function useArriving(
  tasks: TasksControl,
  read: WaitingItems,
  waiting: number,
  inboxOn: boolean,
): boolean {
  const reading = !tasks.listRead && !tasks.listFailed;
  const [opened] = useState(reading);
  const [heard, setHeard] = useState(false);

  // Note that an account keeping no Inbox waits on no Inbox read, since no section of it lands.
  const inboxOut =
    inboxOn && opened && !heard && waiting === 0 && read.reading && !tasks.listFailed;

  if (tasks.listRead && !inboxOut && !heard) setHeard(true);

  return reading || inboxOut;
}

/**
 * Inbox: the items waiting on the reader, a teammate's left to the Inbox and
 * one with a reminder still ahead left out until it comes due, as the
 * sidebar's Inbox row counts them (`waitsOnReaderNow`), or a refused read's Retry; nothing while
 * none waits. A press on a row opens the Inbox on its item, and its menu
 * offers what the Inbox's row's does (`InboxItemRows`).
 */
function HomeInbox({
  tasks,
  read,
  waiting,
}: {
  tasks: TasksControl;
  read: WaitingItems;
  waiting: readonly InboxListed<InboxAnyHolder>[];
}): React.JSX.Element | null {
  // Note that nothing waiting draws nothing, while a read is still out or the list was refused too, because an empty section would only say what the page already shows; a refused list is Recent's to say.
  if (waiting.length === 0 && (tasks.listFailed || !read.failed)) return null;

  if (read.failed) {
    return (
      <div className="home-note my-tight-gap">
        <ErrorState failure={unreadShown(FAILURE_SURFACE.HOME_INBOX_READ)} onRetry={read.onRetry}>
          {ITEMS_NOT_READ}
        </ErrorState>
      </div>
    );
  }

  return (
    <PersonSectionFrame
      label={TAB_WORDS.INBOX}
      title={TAB_WORDS.INBOX}
      count={waiting.length}
      noun={TERM.INBOX_ITEM}
      tone={STATUS_TONE.ATTENTION}
      fold={PERSON_SECTION_FOLD}
    >
      <InboxItemRows label={TAB_WORDS.INBOX} listed={waiting} tasks={tasks} joinsWalk />
    </PersonSectionFrame>
  );
}

/** Recent: the tasks worked on latest, under a refused read's Retry where the list could not be read, which stands while Recent is folded too, and nothing where neither stands. */
function HomeRecent({
  tasks,
  room,
  staged,
}: {
  tasks: TasksControl;
  room: ShellRoom;
  staged: boolean;
}): React.JSX.Element | null {
  // A task's row is unread as its sidebar row is, so its weight and its menu's Mark as read agree with the sidebar's.
  const unread = useUnreadTasks({ staged });
  // Note that the read holds only each task's place among the latest, so a turn of an agent moving none of them draws no Recent but the row of its task (`RecentTasks`).
  const recent = useRecentTasks(tasks.workspace?.id, RECENT_COUNT[room]);

  if (recent.length === 0 && !tasks.listFailed) return null;

  const refused = tasks.listFailed ? (
    <div className="home-note my-tight-gap">
      <ErrorState
        failure={unreadShown(FAILURE_SURFACE.HOME_TASKS_READ)}
        onRetry={tasks.onRetryList}
      >
        {TASKS_NOT_READ}
      </ErrorState>
    </div>
  ) : null;

  // Note that a refused read stays under the head while Recent is folded too, so its Retry is never folded away.
  return (
    <PersonSectionFrame label={RECENT} title={RECENT} fold={PERSON_SECTION_FOLD} standing={refused}>
      {refused}
      {recent.length === 0 ? null : (
        <ReplayMask>
          <RecentTasks
            tasks={tasks}
            label={RECENT}
            listed={recent}
            unread={unread}
            onOpen={tasks.onResume}
            joinsWalk
          />
        </ReplayMask>
      )}
    </PersonSectionFrame>
  );
}

/**
 * New task's composer, at the top of the page as a chat app's empty page
 * opens on its prompt box; nothing while signed out, where nothing could
 * start. An `@` or `/` list opens under the caret's line, because one risen
 * over it from the page's top is cut off under the page's head. A start
 * pressed here and refused opens it again on what it pressed, with why under
 * it and Retry, as the dialog's card opens on a refusal, rather than a dialog
 * drawing a second composer over it (`newTask.homeRefused`). Under it, while
 * the workspace holds few tasks, stand the starters (`home-starters.tsx`),
 * whose press writes a job into its words and hands them the caret.
 */
function HomeComposer({
  tasks,
  takesFocus,
}: {
  tasks: TasksControl;
  takesFocus: boolean;
}): React.JSX.Element | null {
  const box = useRef<HTMLDivElement>(null);
  const { homeAsks, homeRefused: refusal } = useNewTaskShown();
  useHomeNewTask(box, homeAsks);

  if (!tasks.signedIn) return null;

  // A starter pressed hands the words it wrote the caret, which the editor lays at their end.
  const takeCaret = () => box.current?.querySelector<HTMLElement>(EDITOR_ROOT_SELECTOR)?.focus();

  return (
    <>
      <div className="home-composer mb-page-section-gap" ref={box}>
        <NewTaskComposer
          // Note that each refusal mounts the composer afresh, as the card opens on what it pressed only as it mounts.
          key={refusal?.opening}
          newTask={tasks.newTask}
          preset={refusal === undefined ? undefined : { refused: refusal.refused }}
          workspaceId={tasks.newTask.workspaceId}
          onLeave={letGoOfFocus}
          takesFocus={takesFocus}
          listSide={MENTION_MENU_SIDE.BELOW}
          notices={NOTICE_LOOK.CARD}
        />
      </div>
      <HomeStarters tasks={tasks} onFilled={takeCaret} />
    </>
  );
}

/** Home, in the task's place while no task is open. */
export function DesktopHome({
  tasks,
  room = SHELL_ROOM.WIDE,
  accountName,
  staged,
}: {
  tasks: TasksControl;
  /** The room the panel's stage gives, which says how many tasks Recent lists; wide where left out. */
  room?: ShellRoom | undefined;
  /** The signed-in account's name, which greets it. */
  accountName: string | undefined;
  /** Whether a fixture stages the window, whose tasks' looks are its own rather than kept (`useUnreadTasks`). */
  staged: boolean;
}): React.JSX.Element {
  // The rows of both sections, one walk for ↑ and ↓ from the first Inbox item to the last task, the Inbox's undrawn rows among them.
  const rows = useRef<HTMLDivElement>(null);
  const roving = useRovingKeys<HTMLDivElement>({ reach: reachAcrossRuns(rows) });
  const rowsRef = useMemo(() => joinRefs(rows, roving.ref), [roving.ref]);
  // Note that on a phone the words leave the caret alone, because a field typed in puts the places bar away (`mobile-bar.tsx`).
  const takesFocus = room !== SHELL_ROOM.NARROW;
  const read = useWaitingItems(tasks);
  // Note that the clock moves with the minute, so an item whose reminder comes due joins the section without a read.
  const now = useMinute();
  const waiting = read.items.filter(({ item }) => waitsOnReaderNow(item, tasks.me, now));
  // Note that an account that turned its Inbox off is shown no Inbox section, its agents asking in their replies.
  const inboxOn = useInboxOn();
  const arriving = useArriving(tasks, read, waiting.length, inboxOn);
  const fresh = welcomed(tasks, useListsTask(undefined));

  // PROTOTYPE, throwaway: the Office in Home's place while the address asks for it.
  if (OFFICE !== undefined) return <OfficePage variant={OFFICE} />;

  return (
    // Note that the rows' links are written under the listed workspace, so their menus offer Copy link.
    <LinkWorkspaceProvider value={tasks.workspace?.slug ?? tasks.workspace?.id}>
      {/* Note that the greeting welcomes the reader back while the list is read, because an account is new but once. */}
      <DetailPage frame={PAGE_FRAME.PAGE} title={greeting(accountName, fresh)}>
        <HomeComposer tasks={tasks} takesFocus={takesFocus} />
        {/* Note that the box lays nothing out: it only hears the arrows its rows walk by. */}
        <div className="home-rows contents" {...roving} ref={rowsRef}>
          {/* Note that the sections stand in one mark, so a section still follows the last (`person-frame.tsx`), and their names, counts, and notes show in a screen recording while each masks its rows. */}
          <ReplayUnmask>
            <Arrival reading={arriving} label={READING_TASKS}>
              {/* The Inbox's rows name who started each agent, and Recent's who is on each task, read against the listed workspace's members. */}
              <MemberDirectory workspace={tasks.workspace} readerId={tasks.me}>
                <PersonBody>
                  {inboxOn ? <HomeInbox tasks={tasks} read={read} waiting={waiting} /> : null}
                  <HomeRecent tasks={tasks} room={room} staged={staged} />
                </PersonBody>
              </MemberDirectory>
            </Arrival>
          </ReplayUnmask>
        </div>
      </DetailPage>
    </LinkWorkspaceProvider>
  );
}
