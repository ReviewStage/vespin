/**
 * ios-menu-commands.ts -- the iPad menu bar's commands as the iOS app routes them, and what stands in front for them to act on, read off the app's route.
 *
 * The app's native module (`apps/mobile/modules/menu-commands/`) draws each
 * command in the system's menus and hands its id back when it is pressed;
 * the ids below are the ones it names, so the two must agree. What the
 * app's own menu acts on is whatever the route stands in front: a thread of
 * the Inbox, a task, or an agent, opened on a page of its own or chosen
 * beside its list in a split view, where the tab's root route keeps it in
 * its `selected` param.
 */

/** Every command the menu bar hands the app's JavaScript, by the id the native module names it. */
export const MENU_COMMAND = {
  SETTINGS: "settings",
  SIGN_OUT: "signOut",
  NEW_TASK: "newTask",
  NEW_AGENT: "newAgent",
  INBOX: "inbox",
  TASKS: "tasks",
  SEARCH: "search",
  MARK_DONE: "markDone",
  TOGGLE_READ: "toggleRead",
  PIN: "pin",
  REMIND_HOUR: "remindHour",
  REMIND_TOMORROW: "remindTomorrow",
  REMIND_NEXT_WEEK: "remindNextWeek",
  REMIND_CLEAR: "remindClear",
  OPEN_IN_BROWSER: "openInBrowser",
  HELP: "help",
  FEEDBACK: "feedback",
} as const;

export type MenuCommand = (typeof MENU_COMMAND)[keyof typeof MENU_COMMAND];

/** The kind of thing the app's own menu acts on, which also names that menu. */
export const MENU_SUBJECT = {
  NONE: "none",
  THREAD: "thread",
  TASK: "task",
  AGENT: "agent",
} as const;

export type MenuSubject = (typeof MENU_SUBJECT)[keyof typeof MENU_SUBJECT];

/** What stands in front: nothing the menu acts on, or a thread, a task by its id or number, or an agent, by the word its route names it by. */
export type MenuFocus =
  | { readonly kind: typeof MENU_SUBJECT.NONE }
  | {
      readonly kind: Exclude<MenuSubject, typeof MENU_SUBJECT.NONE>;
      readonly id: string;
    };

const NOTHING: MenuFocus = { kind: MENU_SUBJECT.NONE };

/** A route's segments, each decoded as expo-router encoded it. */
function segmentsOf(pathname: string): readonly string[] {
  return pathname
    .split("/")
    .filter((segment) => segment !== "")
    .map((segment) => decodeURIComponent(segment));
}

/**
 * What the route stands in front, from its path and the `selected` param a
 * split view's root keeps: `/inbox/<id>` or the Inbox's choice is a thread,
 * `/tasks/agent/<id>` and the pages under it an agent, `/tasks/<id>` or the
 * Tasks tab's choice a task, and any other place nothing, a task's page and
 * Search among them.
 */
export function menuFocusOf(pathname: string, selected: string | undefined): MenuFocus {
  const [tab, first, second] = segmentsOf(pathname);
  const chosen = selected === undefined || selected === "" ? undefined : selected;
  if (tab === "inbox") {
    const id = first ?? chosen;
    return id === undefined ? NOTHING : { kind: MENU_SUBJECT.THREAD, id };
  }
  if (tab !== "tasks") return NOTHING;
  if (first === "agent") {
    return second === undefined ? NOTHING : { kind: MENU_SUBJECT.AGENT, id: second };
  }
  if (first === "page") return NOTHING;
  const id = first ?? chosen;
  return id === undefined ? NOTHING : { kind: MENU_SUBJECT.TASK, id };
}
