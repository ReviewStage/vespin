/**
 * ios-menu-commands.ts -- the iPad menu bar's commands as the iOS app routes them, and what stands in front for them to act on, read off the app's route.
 *
 * The app's native module (`apps/mobile/modules/menu-commands/`) draws each
 * command in the system's menus and hands its id back when it is pressed;
 * the ids below are the ones it names, so the two must agree. What the
 * app's own menu acts on is whatever the route stands in front: a thread of
 * the Inbox, a task, or an agent, opened on a page of its own or chosen
 * beside its list in a split view, where the tab's root route keeps it in
 * its `selected` param, or the task or agent a page pushed over it belongs to.
 */

/** Every command the menu bar hands the app's JavaScript, by the id the native module names it. */
export const MENU_COMMAND = {
  SETTINGS: "settings",
  SWITCH_WORKSPACE: "switchWorkspace",
  SIGN_OUT: "signOut",
  NEW_TASK: "newTask",
  NEW_AGENT: "newAgent",
  INBOX: "inbox",
  TASKS: "tasks",
  SEARCH: "search",
  SIDEBAR: "sidebar",
  BACK: "back",
  PREVIOUS_ITEM: "previousItem",
  NEXT_ITEM: "nextItem",
  MARK_DONE: "markDone",
  RESOLVE: "resolve",
  STOP_AGENT: "stopAgent",
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

/** The app's route segments the focus is read from: its two tabs that open things, and the pages under Tasks that are not a task by their own id. */
const MENU_ROUTE = {
  INBOX: "inbox",
  TASKS: "tasks",
  AGENT: "agent",
  PAGE: "page",
  HISTORY: "history",
  VERSION: "version",
  PULL: "pull",
} as const;

/** The query a route carries beside its path, as expo-router hands its global search params: a split view's choice, and the task, agent, page, and workspace a pushed page names. */
export type MenuRouteParams = {
  readonly selected?: string | undefined;
  readonly task?: string | undefined;
  readonly agent?: string | undefined;
  readonly page?: string | undefined;
  readonly workspace?: string | undefined;
};

/** What a page pushed over a task or agent opens in the browser in place of it: a pull request on GitHub, or a page by its task or agent. */
export const MENU_OWN_PAGE = {
  PULL_REQUEST: "pull-request",
  TASK_PAGE: "task-page",
  AGENT_PAGE: "agent-page",
} as const;

export type MenuOwnPage =
  | {
      readonly kind: typeof MENU_OWN_PAGE.PULL_REQUEST;
      readonly repository: string;
      readonly number: number;
    }
  | {
      readonly kind: typeof MENU_OWN_PAGE.TASK_PAGE;
      readonly taskId: string;
      readonly pageId: string;
      readonly workspaceId: string | undefined;
    }
  | { readonly kind: typeof MENU_OWN_PAGE.AGENT_PAGE; readonly pageId: string };

/** A route's segments as expo-router hands them, already decoded, so an id holding `%` is read as itself rather than decoded again. */
function segmentsOf(pathname: string): readonly string[] {
  return pathname.split("/").filter((segment) => segment !== "");
}

/** A param as named, or nothing where it is missing or empty. */
function given(value: string | undefined): string | undefined {
  return value === undefined || value === "" ? undefined : value;
}

/** A focus on the thing an id names, or nothing where none is named. */
function focusOn(
  kind: Exclude<MenuSubject, typeof MENU_SUBJECT.NONE>,
  id: string | undefined,
): MenuFocus {
  return id === undefined ? NOTHING : { kind, id };
}

/**
 * What the route stands in front, from its path and its params: `/inbox/<id>`
 * or the Inbox's choice is a thread; `/tasks/agent/<id>` and the pages
 * under it an agent; a pull request the agent it was opened from, where it
 * names one; a task's page, history, or version the task they
 * belong to; `/tasks/<id>` or the Tasks tab's choice a task; and any other
 * place nothing, Search among them.
 */
export function menuFocusOf(pathname: string, params: MenuRouteParams): MenuFocus {
  const [tab, first, second] = segmentsOf(pathname);

  if (tab === MENU_ROUTE.INBOX)
    return focusOn(MENU_SUBJECT.THREAD, first ?? given(params.selected));

  if (tab !== MENU_ROUTE.TASKS) return NOTHING;

  switch (first) {
    case MENU_ROUTE.AGENT:
      return focusOn(MENU_SUBJECT.AGENT, second);
    case MENU_ROUTE.PULL:
      return focusOn(MENU_SUBJECT.AGENT, given(params.agent));
    case MENU_ROUTE.HISTORY:
    case MENU_ROUTE.VERSION:
      return focusOn(MENU_SUBJECT.TASK, second);
    case MENU_ROUTE.PAGE:
      return focusOn(MENU_SUBJECT.TASK, given(params.task));
    default:
      return focusOn(MENU_SUBJECT.TASK, first ?? given(params.selected));
  }
}

/**
 * The page the route stands in front that opens in the browser as itself
 * rather than as the task or agent it was opened from: a pull request by
 * its repository and number, a task's page, or a page an agent showed.
 */
export function menuOwnPageOf(pathname: string, params: MenuRouteParams): MenuOwnPage | undefined {
  const [tab, first, second, third, fourth, fifth] = segmentsOf(pathname);

  if (tab !== MENU_ROUTE.TASKS) return undefined;

  if (first === MENU_ROUTE.PULL) {
    const number = Number(fifth);

    return third === undefined || fourth === undefined || !Number.isInteger(number)
      ? undefined
      : { kind: MENU_OWN_PAGE.PULL_REQUEST, repository: `${third}/${fourth}`, number };
  }

  const pageId = given(params.page);

  if (first === MENU_ROUTE.AGENT && third === MENU_ROUTE.PAGE && pageId !== undefined) {
    return { kind: MENU_OWN_PAGE.AGENT_PAGE, pageId };
  }

  const taskId = given(params.task);

  return first === MENU_ROUTE.PAGE && second !== undefined && taskId !== undefined
    ? {
        kind: MENU_OWN_PAGE.TASK_PAGE,
        taskId,
        pageId: second,
        workspaceId: given(params.workspace),
      }
    : undefined;
}
