import { APP_COMMAND } from "@repo/settings/shortcuts";
import { BarAction, BarItem, BarItems, MENU_KEEPS_CLEAR, PlusIcon, SearchIcon } from "@repo/ui";
import { raiseKeyboard } from "@repo/ui/command";
import { ReplayUnmask } from "@repo/ui/session-replay-marks";
import { InboxIcon, ListTodoIcon } from "lucide-react";
import { useAdminView } from "../admin/admin-route.js";
import { type AdminView, adminSection } from "../admin/routing.js";
import { runAppCommand } from "../app-commands.js";
import { useAutomationsPlace } from "../automations-route.js";
import { type InboxView, useInboxView } from "../inbox-route.js";
import { useBoardDoor, useInboxDoor } from "../places/routed-doors.js";
import { ROUTED_PLACE, type RoutedPlace, useWindowPlace } from "../places/routed-places.js";
import { SHELL_ROOM, type ShellRoom } from "../shell-room.js";
import { type AutomationsPlace, automationsTab } from "../tasks/automations-place.js";
import { NEEDS_YOU } from "../tasks/inbox-model.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { useInboxWaiting } from "./places-waiting.js";
import { groupCount } from "./sidebar-fold.js";

/**
 * mobile-bar.tsx -- a phone's way between the window's places: a bar
 * floating at the screen's foot with the Inbox, Tasks, and Search in one
 * pill, and New task beside it, as a phone's own apps float their tabs
 * beside a compose button.
 *
 * The Inbox is a phone's first place, the one it opens on
 * (`places/window-history.ts`). Tasks is the Tasks page, which a phone draws
 * as the sidebar's tree of tasks, the pinned and each section, standing in
 * place above the bar (`desktop-shell.tsx`), a list sized for a finger
 * rather than the page's list or board. Search opens the command palette,
 * as the sidebar's Search does, and New task the New task dialog.
 *
 * It stands only in a narrow room and only on a place's list, the Inbox's,
 * the Tasks page, Automations, or Home, so a task, an agent's page, or an
 * item being read keeps the whole screen and is left by Back. Each press
 * lands on its place's list, not on the item last read, since on a phone the
 * list is the place (`use-tasks-tab.ts`'s `onOpen`).
 *
 * Settings, which stands over the places rather than among them, keeps the
 * bar on a phone too, its list and its pages alike: no place is the current
 * one there, and a press leaves Settings for the place pressed (`leave`).
 *
 * The Inbox counts what waits on the developer there, the count the
 * drawer's row shows, read from the one reading they draw from
 * (`places-waiting.ts`), so the two never disagree, and said in the
 * sidebar's words.
 */

/** The routed place the window stands on (`useWindowPlace`), with the Inbox, the Automations page, and Admin's view, which the bar stands over or not by. */
export interface BarStanding {
  readonly place: RoutedPlace | undefined;
  /** The Inbox as a surface reads it: whether it stands, and the item chosen in it. */
  readonly inbox: Pick<InboxView, "open" | "chosen">;
  /** The Automations page standing, none while none does. */
  readonly automations: AutomationsPlace | undefined;
  /** Admin's view, the Overview while it does not stand. */
  readonly admin: AdminView;
}

/** Where the window stands, as the bar reads it, the Inbox's choice as the listed workspace's list holds it. */
export function useBarStanding(tasks: Pick<TasksControl, "tasks" | "workspace">): BarStanding {
  const { place } = useWindowPlace();
  const automations = useAutomationsPlace();
  return {
    place,
    inbox: useInboxView(tasks),
    automations: automations.open ? automations.place : undefined,
    admin: useAdminView(),
  };
}

/** Whether the bar stands: a narrow room, signed in, on one of the places' lists, by where the window stands (`standing`). */
export function mobileBarShown(
  room: ShellRoom,
  tasks: TasksControl,
  standing: BarStanding,
): boolean {
  // Note that the open task's side panel is not asked: it is held behind every place, so it says nothing of the one on screen.
  if (room !== SHELL_ROOM.NARROW || !tasks.signedIn) return false;
  const { agentView } = tasks;
  const { place, inbox, automations } = standing;
  if (inbox.open) return inbox.chosen === undefined;
  if (agentView.agentId !== undefined || place === ROUTED_PLACE.PERSON) return false;
  if (place === ROUTED_PLACE.BOARD) return true;
  // Note that an automation's editor and its runs keep the whole screen, as an item does; only the list and the Runs tab stand over the bar.
  if (automations !== undefined) return automationsTab(automations);
  // So does Admin: a section stands over the bar, an account's or a day's page under one keeps the whole screen.
  if (place === ROUTED_PLACE.ADMIN) return adminSection(standing.admin);
  return tasks.atHome;
}

/** The bar; see the module's head. */
export function MobileBar({
  tasks,
  leave,
}: {
  tasks: TasksControl;
  /** Leaves what stands over the places (Settings) before a press opens one; none where the bar stands among them. */
  leave?: (() => void) | undefined;
}): React.JSX.Element {
  const board = useBoardDoor(tasks);
  const inbox = useInboxDoor(tasks);
  const { place } = useWindowPlace();
  const boardOpen = place === ROUTED_PLACE.BOARD;
  const among = leave === undefined;
  const inInbox = among && place === ROUTED_PLACE.INBOX;
  const inTasks = among && !inInbox && boardOpen;
  const waiting = useInboxWaiting(tasks);
  // Note that a press leaves what stands over the places first, so the place it opens is the one on screen.
  const go = (open: () => void) => () => {
    leave?.();
    open();
  };
  return (
    <nav
      className="mobile-bar flex items-center gap-ui-12 bg-ground px-ui-12 py-ui-8"
      aria-label="Places"
      {...MENU_KEEPS_CLEAR}
    >
      <ReplayUnmask>
        <BarItems>
          <BarItem
            icon={<InboxIcon />}
            current={inInbox}
            count={groupCount(waiting, NEEDS_YOU.COUNT)}
            onPress={go(inbox.open)}
          >
            Inbox
          </BarItem>
          <BarItem icon={<ListTodoIcon />} current={inTasks} onPress={go(board.open)}>
            Tasks
          </BarItem>
          <BarItem
            icon={<SearchIcon />}
            onPress={go(() => {
              // A tap opening Search brings the keyboard up with it, as a phone's own search does.
              raiseKeyboard();
              runAppCommand(APP_COMMAND.COMMAND_PALETTE);
            })}
          >
            Search
          </BarItem>
        </BarItems>
        <BarAction
          icon={<PlusIcon />}
          label="New task"
          disabled={!tasks.signedIn}
          onPress={go(tasks.newTask.onOpen)}
        />
      </ReplayUnmask>
    </nav>
  );
}
