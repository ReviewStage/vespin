/**
 * turn-rows.ts -- what every transcript's turn shares: how its calls are named on their rows, and how its rows fold.
 *
 * An agent's tab draws a coding agent's turns from the message its
 * journal stored, read into blocks of its own. What every transcript
 * shares is decided here, so none drifts: a call is one of a few kinds,
 * each with the verb its row says and whether its subject is code; and a
 * turn's blocks fold one way (Stagent's walk, Stage's chat panel): calls
 * and subagents next to one another, and the reasoning between and beside
 * them, are one group that is open while it is the turn's latest work on a
 * turn that moves and folded once the model moved on, its line counting
 * the calls and subagents and never the thoughts. The model's words are
 * never folded, on a turn that moves or one that has finished, as Claude
 * Code and Cursor draw an agent's words between its folded calls: an answer
 * the agent gave before it waited on a wakeup, a check, or background work
 * stands where it was said, never under the words it said after. A run of
 * one call stands on its own row, since a fold saying "1 tool call" over
 * the one row it hides only costs a click.
 * A message that reached a turn while it ran, a steer from whoever sent
 * it, stands where it arrived: it ends the group before it.
 */

import { Predicate } from "effect";
import { countWords } from "./words.js";

/** The kinds of call a row can be, across both tabs. */
export const CALL_KIND = {
  COMMAND: "command",
  /** A command an agent ran on the developer's own Mac (`run_on_mac`), drawn as a command with where it ran beside it. */
  MAC_COMMAND: "mac-command",
  /** Actions an agent took in the browser in its own sandbox (`browser`), its line saying what it did and in which tab, with where it ran beside it. */
  BROWSER: "browser",
  /** One action an agent took on an app on the developer's own Mac (`computer`), its line saying what it did and to which app, the app's icon in its kind's icon's place. */
  COMPUTER: "computer",
  READ_FILE: "read-file",
  WRITE_FILE: "write-file",
  EDIT: "edit",
  SEARCH: "search",
  WEB_SEARCH: "web-search",
  WEB_PAGE: "web-page",
  LOAD_SKILL: "load-skill",
  LOOK_AT_PICTURE: "look-at-picture",
  /** A look at a picture a thread's message carries (`look_at_picture` on a thread's address). */
  LOOK_AT_THREAD_PICTURE: "look-at-thread-picture",
  /** A PDF in the description written into the agent's machine (`look_at_picture` answering `written`), its row naming the PDF. */
  READ_DESCRIPTION_PDF: "read-description-pdf",
  EDIT_DESCRIPTION: "edit-description",
  TODOS: "todos",
  INBOX_POST: "inbox-post",
  INBOX_CLOSE: "inbox-close",
  INBOX_READ: "inbox-read",
  /** One thread read whole (`read_thread`), its row naming the thread's title. */
  INBOX_THREAD_READ: "inbox-thread-read",
  INBOX_REPLY: "inbox-reply",
  /** An ask on one of the agent's inbox threads taken back with why (`withdraw_ask`), its row naming the thread's key. */
  INBOX_WITHDRAW: "inbox-withdraw",
  WORKER: "worker",
  WORKER_WAIT: "worker-wait",
  WORKER_CANCEL: "worker-cancel",
  /** More sent to one of a native harness's subagents (Claude Code's `SendMessage`), its row naming the subagent. */
  WORKER_MESSAGE: "worker-message",
  /** A background command, monitor, or subagent stopped (Claude Code's `TaskStop`), its row naming it by its id. */
  STOP_BACKGROUND: "stop-background",
  LIST_AGENTS: "list-agents",
  READ_AGENT: "read-agent",
  MESSAGE_AGENT: "message-agent",
  START_AGENT: "start-agent",
  /** A suggestion put in the agent's reply (`add_suggestion`), its row naming the suggestion's label. */
  ADD_SUGGESTION: "add-suggestion",
  ARCHIVE_AGENT: "archive-agent",
  UNARCHIVE_AGENT: "unarchive-agent",
  /** A list of the models a coding agent may be started on (`list_models`). */
  LIST_MODELS: "list-models",
  STOP_AGENT: "stop-agent",
  /** The ports a server listens on in a coding agent's own sandbox listed (`list_ports`). */
  LIST_PORTS: "list-ports",
  /** A port of a coding agent's own sandbox shared by link (`share_port`), its row naming the port. */
  SHARE_PORT: "share-port",
  /** A coding agent's link to its port closed (`share_port` of null). */
  UNSHARE_PORT: "unshare-port",
  /** A coding agent renamed, moved to another model, pinned, or given other servers (`update_agent`), its row naming it by its chip. */
  UPDATE_AGENT: "update-agent",
  /** One task of the workspace read with its description (`read_task`), its row naming the task once answered. */
  READ_TASK: "read-task",
  /** A section made in the member's sidebar (`create_section`), its row naming its title. */
  CREATE_SECTION: "create-section",
  /** A section of the member's sidebar deleted (`delete_section`), its row naming its title once answered. */
  DELETE_SECTION: "delete-section",
  /** The workspace's automations listed, or one read whole (`list_automations`). */
  LIST_AUTOMATIONS: "list-automations",
  /** An automation made (`create_automation`), its row naming it. */
  CREATE_AUTOMATION: "create-automation",
  /** An automation changed, paused, or resumed (`update_automation`), its row naming it once answered. */
  UPDATE_AUTOMATION: "update-automation",
  /** An automation deleted (`delete_automation`), its row naming it once answered. */
  DELETE_AUTOMATION: "delete-automation",
  /** An automation run now (`run_automation`), its row naming it once answered. */
  RUN_AUTOMATION: "run-automation",
  /** A task moved into a section of the member's sidebar or out of them (`move_task`), its row naming the task once answered. */
  MOVE_TASK: "move-task",
  /** A task of the workspace changed (`update_task`), its row naming the task once answered; an older transcript's archive of one reads as a change too. */
  UPDATE_TASK: "update-task",
  /** The workspace's issues listed (`list_issues`, retired with our own issues; an older transcript still names it). */
  LIST_ISSUES: "list-issues",
  /** One issue read (`read_issue`), filed (`create_issue`), or changed (`update_issue`), retired with `list_issues`, its row naming it by its identifier and title once answered. */
  READ_ISSUE: "read-issue",
  CREATE_ISSUE: "create-issue",
  UPDATE_ISSUE: "update-issue",
  /** A task made in the workspace (`create_task`), its row naming it once answered. */
  CREATE_TASK: "create-task",
  SHOW_PAGE: "show-page",
  READ_PAGE: "read-page",
  /** Pictures a coding agent showed from its sandbox (`show_image`), drawn as a row only where the call was refused; a shown set draws as its pictures. */
  SHOW_IMAGE: "show-image",
  /** A pull request a coding agent opened (`open_pull_request`), its row naming it by its number and title, which opens its Pull request tab; a refusal folds open its reason instead. */
  OPEN_PULL_REQUEST: "open-pull-request",
  /** A pause a coding agent took (`sleep`) before it checked again on what takes time, its row naming how long. */
  SLEEP: "sleep",
  /** A wakeup a coding agent booked for later (`schedule_wakeup`), its row naming how long until it fires. */
  SCHEDULE_WAKEUP: "schedule-wakeup",
  /** The wakeup a coding agent booked canceled (`schedule_wakeup` with `stop`). */
  CANCEL_WAKEUP: "cancel-wakeup",
  /** A turn a coding agent ended (`end_turn`), with the summary its developer reads as the reply and the follow-ups it offers. */
  END_TURN: "end-turn",
  /** The workspace's tasks listed (`list_tasks`). */
  LIST_TASKS: "list-tasks",
  /** A fact kept in the workspace's shared memory (`save_memory`, or `remember` in an older transcript), its row saying it. */
  REMEMBER: "remember",
  /** The workspace's shared memory searched (`search_memory`, or `recall` in an older transcript), its row naming how many memories it answered and the query, or the query alone before it answers. */
  RECALL: "recall",
  /** The memories kept or corrected since a time listed (`list_memories`). */
  LIST_MEMORIES: "list-memories",
  /** One memory of the workspace forgotten (`forget_memory`). */
  FORGET_MEMORY: "forget-memory",
  /** The description's comment threads read (`read_comments`). */
  READ_COMMENTS: "read-comments",
  /** An answer written in one of the description's comment threads (`reply_to_comment`), its row saying it. */
  REPLY_TO_COMMENT: "reply-to-comment",
  /** A comment thread of the description resolved (`update_comment`, or `resolve_thread` in an older transcript). */
  RESOLVE_THREAD: "resolve-thread",
  /** A resolved comment thread of the description brought back (`update_comment`, or `reopen_thread` in an older transcript). */
  REOPEN_THREAD: "reopen-thread",
  /** A connection's tools searched (`connection_search`), its row naming the server it searched. */
  SEARCH_TOOLS: "search-tools",
  /** A tool of an MCP server or an integration run (`connection_execute`, an integration's own call, a native harness's MCP call), its row naming the tool and the server it ran on. */
  MCP_TOOL: "mcp-tool",
  OTHER: "other",
} as const;

export type CallKind = (typeof CALL_KIND)[keyof typeof CALL_KIND];

/** How a call of each kind says what it did, and whether its subject is code (a command, a path) rather than words. */
export const CALL_WORDS = {
  [CALL_KIND.COMMAND]: { verb: "Ran", code: true },
  [CALL_KIND.MAC_COMMAND]: { verb: "Ran", code: true },
  [CALL_KIND.BROWSER]: { verb: "Used the browser", code: false },
  [CALL_KIND.COMPUTER]: { verb: "Used an app", code: false },
  [CALL_KIND.READ_FILE]: { verb: "Read", code: true },
  [CALL_KIND.WRITE_FILE]: { verb: "Wrote", code: true },
  [CALL_KIND.EDIT]: { verb: "Edited", code: true },
  [CALL_KIND.SEARCH]: { verb: "Searched", code: true },
  [CALL_KIND.WEB_SEARCH]: { verb: "Searched the web for", code: false },
  [CALL_KIND.WEB_PAGE]: { verb: "Fetched", code: true },
  [CALL_KIND.LOAD_SKILL]: { verb: "Loaded skill", code: true },
  [CALL_KIND.LOOK_AT_PICTURE]: { verb: "Looked at a picture in the description", code: false },
  [CALL_KIND.LOOK_AT_THREAD_PICTURE]: { verb: "Looked at a picture in a thread", code: false },
  [CALL_KIND.READ_DESCRIPTION_PDF]: { verb: "Read a PDF in the description:", code: false },
  [CALL_KIND.EDIT_DESCRIPTION]: { verb: "Updated the description:", code: false },
  [CALL_KIND.TODOS]: { verb: "Updated the to-dos:", code: false },
  [CALL_KIND.INBOX_POST]: { verb: "Posted a thread:", code: false },
  [CALL_KIND.INBOX_CLOSE]: { verb: "Closed a thread:", code: false },
  [CALL_KIND.INBOX_READ]: { verb: "Read threads", code: false },
  [CALL_KIND.INBOX_THREAD_READ]: { verb: "Read a thread:", code: false },
  [CALL_KIND.INBOX_REPLY]: { verb: "Replied in a thread:", code: false },
  [CALL_KIND.INBOX_WITHDRAW]: { verb: "Withdrew an ask:", code: false },
  [CALL_KIND.WORKER]: { verb: "Asked the worker", code: false },
  [CALL_KIND.WORKER_WAIT]: { verb: "Waited for the worker", code: false },
  [CALL_KIND.WORKER_CANCEL]: { verb: "Stopped the worker", code: false },
  [CALL_KIND.WORKER_MESSAGE]: { verb: "Messaged the worker", code: false },
  [CALL_KIND.STOP_BACKGROUND]: { verb: "Stopped", code: true },
  [CALL_KIND.LIST_AGENTS]: { verb: "Listed the agents", code: false },
  [CALL_KIND.READ_AGENT]: { verb: "Read the agent", code: false },
  [CALL_KIND.MESSAGE_AGENT]: { verb: "Messaged the agent", code: false },
  [CALL_KIND.START_AGENT]: { verb: "Started an agent", code: false },
  [CALL_KIND.ADD_SUGGESTION]: { verb: "Suggested", code: false },
  [CALL_KIND.ARCHIVE_AGENT]: { verb: "Archived the agent", code: false },
  [CALL_KIND.UNARCHIVE_AGENT]: { verb: "Unarchived the agent", code: false },
  [CALL_KIND.LIST_MODELS]: { verb: "Listed the models", code: false },
  [CALL_KIND.STOP_AGENT]: { verb: "Stopped the agent", code: false },
  [CALL_KIND.LIST_PORTS]: { verb: "Listed the ports", code: false },
  [CALL_KIND.SHARE_PORT]: { verb: "Shared port", code: true },
  [CALL_KIND.UNSHARE_PORT]: { verb: "Stopped sharing the port", code: false },
  [CALL_KIND.UPDATE_AGENT]: { verb: "Changed the agent", code: false },
  [CALL_KIND.READ_TASK]: { verb: "Read the task", code: false },
  [CALL_KIND.CREATE_SECTION]: { verb: "Made the section", code: false },
  [CALL_KIND.DELETE_SECTION]: { verb: "Deleted the section", code: false },
  [CALL_KIND.LIST_AUTOMATIONS]: { verb: "Listed the automations", code: false },
  [CALL_KIND.CREATE_AUTOMATION]: { verb: "Made the automation", code: false },
  [CALL_KIND.UPDATE_AUTOMATION]: { verb: "Changed the automation", code: false },
  [CALL_KIND.DELETE_AUTOMATION]: { verb: "Deleted the automation", code: false },
  [CALL_KIND.RUN_AUTOMATION]: { verb: "Ran the automation", code: false },
  [CALL_KIND.MOVE_TASK]: { verb: "Moved the task", code: false },
  [CALL_KIND.UPDATE_TASK]: { verb: "Updated the task", code: false },
  [CALL_KIND.LIST_ISSUES]: { verb: "Listed the issues", code: false },
  [CALL_KIND.READ_ISSUE]: { verb: "Read the issue", code: false },
  [CALL_KIND.CREATE_ISSUE]: { verb: "Filed the issue", code: false },
  [CALL_KIND.UPDATE_ISSUE]: { verb: "Updated the issue", code: false },
  [CALL_KIND.CREATE_TASK]: { verb: "Made the task", code: false },
  [CALL_KIND.SHOW_PAGE]: { verb: "Showed a page:", code: false },
  [CALL_KIND.READ_PAGE]: { verb: "Read the page", code: false },
  [CALL_KIND.SHOW_IMAGE]: { verb: "Showed", code: true },
  [CALL_KIND.OPEN_PULL_REQUEST]: { verb: "Opened pull request", code: false },
  [CALL_KIND.SLEEP]: { verb: "Waited", code: false },
  [CALL_KIND.SCHEDULE_WAKEUP]: { verb: "Set a wakeup in", code: false },
  [CALL_KIND.CANCEL_WAKEUP]: { verb: "Canceled the wakeup", code: false },
  [CALL_KIND.END_TURN]: { verb: "Ended the turn", code: false },
  [CALL_KIND.LIST_TASKS]: { verb: "Listed the tasks", code: false },
  [CALL_KIND.REMEMBER]: { verb: "Saved to memory:", code: false },
  [CALL_KIND.RECALL]: { verb: "Recalled", code: false },
  [CALL_KIND.LIST_MEMORIES]: { verb: "Listed the memories", code: false },
  [CALL_KIND.FORGET_MEMORY]: { verb: "Forgot a memory", code: false },
  [CALL_KIND.READ_COMMENTS]: { verb: "Read the comments", code: false },
  [CALL_KIND.REPLY_TO_COMMENT]: { verb: "Replied to a comment:", code: false },
  [CALL_KIND.RESOLVE_THREAD]: { verb: "Resolved a thread", code: false },
  [CALL_KIND.REOPEN_THREAD]: { verb: "Reopened a thread", code: false },
  [CALL_KIND.SEARCH_TOOLS]: { verb: "Searched the tools", code: false },
  [CALL_KIND.MCP_TOOL]: { verb: "Ran", code: true },
  [CALL_KIND.OTHER]: { verb: "Used", code: true },
} as const satisfies Record<CallKind, { verb: string; code: boolean }>;

/** What a row of a call that ran on the developer's own Mac says of where it ran, beside its line. */
const ON_YOUR_MAC = "On your Mac";

/** What a row of a call in the agent's own browser says of where it ran, beside its line. */
const IN_THE_BROWSER = "Browser";

/** What each of the browser's actions says it did, on a browser call's line. */
const BROWSER_ACTION_WORDS: ReadonlyMap<string, string> = new Map([
  ["list", "listed the tabs"],
  ["open", "opened"],
  ["navigate", "went to a page"],
  ["back", "went back"],
  ["forward", "went forward"],
  ["click", "clicked"],
  ["type", "typed"],
  ["key", "pressed a key"],
  ["scroll", "scrolled"],
  ["wait", "waited"],
  ["screenshot", "took a screenshot"],
  ["snapshot", "read the page"],
  ["console", "read the console"],
  ["close", "closed"],
  ["record", "started recording"],
  ["stop_recording", "stopped recording"],
]);

/** What each of the computer tool's actions says it did, before the app it did it to, on its call's line. */
const COMPUTER_ACTION_WORDS: Readonly<Record<string, string>> = {
  list_apps: "Listed the apps",
  get_app_state: "Looked at",
  click: "Clicked in",
  type_text: "Typed in",
  press_key: "Pressed a key in",
  scroll: "Scrolled in",
  drag: "Dragged in",
  set_value: "Set a value in",
  perform_secondary_action: "Acted in",
};

/** What a computer call's line says it did, in place of its kind's verb; nothing for an action this build does not know, so the kind's own verb stands. */
export function computerCallWords(action: string | undefined): string | undefined {
  return action === undefined ? undefined : COMPUTER_ACTION_WORDS[action];
}

/**
 * What a browser call's line says it did, in place of its kind's verb: each
 * action it named once, in the order first named, and "in" where the tab it
 * acted on follows as the subject; nothing where it named no action this
 * build knows, so the kind's own verb stands.
 */
export function browserCallWords(
  actions: readonly string[],
  tabNamed: boolean,
): string | undefined {
  const said = [
    ...new Set(actions.flatMap((action) => BROWSER_ACTION_WORDS.get(action) ?? [])),
  ].join(", ");

  if (said === "") return undefined;
  const line = `${said.charAt(0).toUpperCase()}${said.slice(1)}`;

  return tabNamed ? `${line} in` : line;
}

/**
 * How a call about one coding agent says what it did where its row names
 * the agent by its chip: the verb alone, the chip standing in the place of
 * "the coding agent", and whether the row still says its subject after the
 * chip. Note that a read, an archive, an unarchive, and a stop say none, because
 * their subject is the agent itself, which the chip already names, while a
 * message and a start keep the words they sent as the line's preview.
 */
const AGENT_CALL_WORDS = {
  [CALL_KIND.READ_AGENT]: { verb: "Read", subject: false },
  [CALL_KIND.MESSAGE_AGENT]: { verb: "Messaged", subject: true },
  [CALL_KIND.START_AGENT]: { verb: "Started", subject: true },
  [CALL_KIND.ARCHIVE_AGENT]: { verb: "Archived", subject: false },
  [CALL_KIND.UNARCHIVE_AGENT]: { verb: "Unarchived", subject: false },
  [CALL_KIND.STOP_AGENT]: { verb: "Stopped", subject: false },
  [CALL_KIND.UPDATE_AGENT]: { verb: "Changed", subject: false },
} as const satisfies Partial<Record<CallKind, { verb: string; subject: boolean }>>;

type AgentCallKind = keyof typeof AGENT_CALL_WORDS;

/** Whether a call is about one coding agent, which its row may name by the agent's chip. */
export function isAgentCallKind(kind: CallKind): kind is AgentCallKind {
  return Object.hasOwn(AGENT_CALL_WORDS, kind);
}

/** How the line of a call about one coding agent reads where the agent's chip follows its verb: the verb alone, then the words it sent where it sent any. */
export function agentCallLine(kind: AgentCallKind, subject: string | undefined): CallLine {
  const words = AGENT_CALL_WORDS[kind];

  return { verb: words.verb, subject: words.subject ? subject : undefined, code: false };
}

/**
 * How a call says what it did where its row names what it made or is about
 * by that thing's chip: the verb alone, the chip standing in the place of
 * "a page", "the description", "a thread", "the task", or "pull request", so the
 * row reads "Showed" then the page's chip. Note that an edit of the description
 * says no count, because the chip is its description's, and the body under the row
 * says what changed.
 */
const MADE_CALL_WORDS = {
  [CALL_KIND.SHOW_PAGE]: "Showed",
  [CALL_KIND.READ_PAGE]: "Read",
  [CALL_KIND.EDIT_DESCRIPTION]: "Updated",
  [CALL_KIND.LOOK_AT_PICTURE]: "Looked at a picture in",
  [CALL_KIND.READ_COMMENTS]: "Read the comments on",
  [CALL_KIND.REPLY_TO_COMMENT]: "Replied to a comment on",
  [CALL_KIND.RESOLVE_THREAD]: "Resolved a thread on",
  [CALL_KIND.REOPEN_THREAD]: "Reopened a thread on",
  [CALL_KIND.INBOX_POST]: "Posted",
  [CALL_KIND.INBOX_WITHDRAW]: "Withdrew an ask on",
  [CALL_KIND.CREATE_TASK]: "Made",
  [CALL_KIND.READ_TASK]: "Read",
  [CALL_KIND.UPDATE_TASK]: "Updated",
  [CALL_KIND.OPEN_PULL_REQUEST]: "Opened",
} as const satisfies Partial<Record<CallKind, string>>;

export type MadeCallKind = keyof typeof MADE_CALL_WORDS;

/** Whether a call's row may name what it made or is about by that thing's chip. */
export function isMadeCallKind(kind: CallKind): kind is MadeCallKind {
  return Object.hasOwn(MADE_CALL_WORDS, kind);
}

/** How the line of a call reads where the chip of what it made follows its verb: the verb alone. */
export function madeCallLine(kind: MadeCallKind): CallLine {
  return { verb: MADE_CALL_WORDS[kind], subject: undefined, code: false };
}

/** Whether a call is a shell command, wherever it ran: its line may say its description, and its body draws it behind a prompt. */
export function isCommandKind(kind: CallKind): boolean {
  return kind === CALL_KIND.COMMAND || kind === CALL_KIND.MAC_COMMAND;
}

/**
 * Where a call ran, as its row says beside its line, or nothing for a call
 * that ran where its tab says. A command on a Mac ran on the Mac of the
 * agent's starter, whom a row that knows them draws in these words' place;
 * a call of an MCP server's tool ran on the server it names.
 */
export function callPlace(kind: CallKind, server?: string): string | undefined {
  if (kind === CALL_KIND.MCP_TOOL || kind === CALL_KIND.SEARCH_TOOLS) return server;
  if (kind === CALL_KIND.MAC_COMMAND || kind === CALL_KIND.COMPUTER) return ON_YOUR_MAC;
  return kind === CALL_KIND.BROWSER ? IN_THE_BROWSER : undefined;
}

/** What a call's line says: the verb, or a described command's purpose, then the subject, and whether the subject is code. */
export interface CallLine {
  readonly verb: string;
  readonly subject: string | undefined;
  readonly code: boolean;
}

/**
 * How a call's line reads: its kind's verb before its subject; or, for a
 * command the model said the purpose of, those plain words in the verb's
 * place, as Claude Code and Cursor name a command, and the command's first
 * line after them as its preview, the whole of it in the row's body; or,
 * for a browser call, what it did (`browserCallWords`) before the tab's
 * title, which is words; or, for a pull request that was refused, that it
 * opened none, before the title it asked for.
 */
export function callLine(
  kind: CallKind,
  subject: string | undefined,
  description: string | undefined,
): CallLine {
  const words = CALL_WORDS[kind];

  if (description === undefined) return { verb: words.verb, subject, code: words.code };
  if (
    kind === CALL_KIND.BROWSER ||
    kind === CALL_KIND.COMPUTER ||
    kind === CALL_KIND.OPEN_PULL_REQUEST
  ) {
    return { verb: description, subject, code: false };
  }

  return {
    verb: description,
    subject: subject === undefined ? undefined : firstLine(subject),
    code: true,
  };
}

/** A command's first line of words, as a line too short for the rest previews it. */
function firstLine(text: string): string {
  return (
    text
      .split("\n")
      .find((line) => line.trim() !== "")
      ?.trim() ?? ""
  );
}

/**
 * The plain words a command's input says it is for, on one line, or nothing
 * where it says none, as an older call or another harness's does not. Note
 * that a break inside them is a space, because they are a row's one line and
 * a copied call's one bullet.
 */
export function commandDescription(description: string | undefined): string | undefined {
  const words = description?.replace(/\s+/gu, " ").trim();

  return words === undefined || words === "" ? undefined : words;
}

/** The kinds of call that name files, which a row names by the first one's chip. */
const FILE_CALLS: ReadonlySet<CallKind> = new Set([
  CALL_KIND.READ_FILE,
  CALL_KIND.WRITE_FILE,
  CALL_KIND.EDIT,
]);

/** The file a call's row names by its chip: the first it named, for a call that reads or writes files; none for any other. */
export function calledFile(
  kind: CallKind,
  files: readonly string[] | undefined,
): string | undefined {
  return FILE_CALLS.has(kind) ? files?.[0] : undefined;
}

/** How many files a call named past the first, which its row says after the first one's chip; none for one file. */
export function moreFiles(files: readonly string[] | undefined): string | undefined {
  return files === undefined || files.length < 2 ? undefined : `+${files.length - 1}`;
}

/** A web address, as a website chip reads one. */
const WEB_SCHEME = /^https?:\/\//iu;

/** The site a web address is of, as a website chip names it: its host without its `www.`; nothing for an address that is not the web's. */
export function siteName(href: string): string | undefined {
  if (!WEB_SCHEME.test(href) || !URL.canParse(href)) return undefined;

  return new URL(href).hostname.replace(/^www\./u, "");
}

/** A page's address as a reader names it: its host and path, without the scheme. */
export function pageName(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

/** What a block is to the fold. */
export const ROW_PART = {
  /** The model's words: they end a run of calls, and are never folded. */
  WORDS: "words",
  /** A call, which runs together with the calls beside it, and which a group counts. */
  CALL: "call",
  /** A call that stands on a row of its own, as an agent's to-do list does. */
  LONE_CALL: "lone-call",
  /** A subagent, which runs together with the calls beside it, and which a group counts apart from the calls. */
  SUBAGENT: "subagent",
  /** A call that started an agent, which runs together with the calls beside it as a call does, and which a group counts as a call. */
  AGENT: "agent",
  /** Reasoning, which runs with the calls beside it but is never counted, and stands on its own row where no call is beside it. */
  NOTE: "note",
  /** A message that reached the turn while it ran, from whoever sent it: it ends a run of calls, so it stands where it arrived. */
  ARRIVED: "arrived",
  /** A native notice at a pause, kept in place between stretches of work. */
  NOTICE: "notice",
} as const;

type RowPart = (typeof ROW_PART)[keyof typeof ROW_PART];

/** How a fold reads a tab's own blocks. */
export interface RowReading<B> {
  readonly key: (block: B, index: number) => string;
  readonly part: (block: B) => RowPart;
  /** Whether the block still moves, which a group of calls shimmers for. */
  readonly running: (block: B) => boolean;
}

/** The kinds of row a turn is drawn as. */
export const TURN_ROW = {
  BLOCK: "block",
  GROUP: "group",
} as const;

export type TurnRow<B> =
  | { readonly kind: typeof TURN_ROW.BLOCK; readonly key: string; readonly block: B }
  | {
      readonly kind: typeof TURN_ROW.GROUP;
      readonly key: string;
      readonly blocks: readonly B[];
      /** What its line says it holds. */
      readonly summary: string;
      /** Open while it is the turn's latest work and the turn still moves. */
      readonly open: boolean;
      readonly running: boolean;
    };

/**
 * Whether two values read alike, `depth` records deep: the same value;
 * arrays alike item by item; or records with the same keys, each value
 * alike one record less deep, where a record past the depth is alike only
 * as the same value. Note that it names no field, so a field added to a
 * shape it compares is compared with the rest, never missed, and that
 * arrays cost no depth, so a group's blocks inside a row are read as a
 * lone block is.
 */
export function readAlike<Value>(a: Value, b: Value, depth: number): boolean {
  if (Object.is(a, b)) return true;

  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, at) => readAlike(item, b[at], depth))
    );
  }

  if (depth <= 0 || !Predicate.isObject(a) || !Predicate.isObject(b)) return false;
  const keys = Object.keys(a);

  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && readAlike(a[key], b[key], depth - 1))
  );
}

/**
 * Whether two records hold the same values under the same keys, each the
 * same value unless `by` names how that key is read: a memoised component's
 * props, every one compared, so a prop added later is never missed.
 */
export function sameFieldsBy<T extends object>(
  a: T,
  b: T,
  by: { readonly [K in keyof T]?: (ours: T[K], theirs: T[K]) => boolean },
): boolean {
  // SAFETY: a component's props hold only the props T declares, so a's own keys are T's keys.
  const keys = Object.keys(a) as (keyof T)[];

  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => {
      const read = by[key];

      return (
        Object.hasOwn(b, key) &&
        (read === undefined ? Object.is(a[key], b[key]) : read(a[key], b[key]))
      );
    })
  );
}

/** How deep a turn's row is read: the row, each of its blocks, then each block's own fields, a part read again from the same stored part reading alike. */
export const TURN_ROW_DEPTH = 3;

/** Whether two of a turn's rows draw alike: every field of the row and its blocks' own fields (`readAlike`). */
export function sameTurnRow<B>(a: TurnRow<B>, b: TurnRow<B>): boolean {
  return readAlike(a, b, TURN_ROW_DEPTH);
}

/** What a run's blocks hold, as its group's line counts them. */
interface Held {
  readonly calls: number;
  readonly subagents: number;
  readonly startedAgents: number;
}

/** What a group's line says it holds: its calls, a coding agent's start among them, then its subagents, in the same words while the turn moves and once it has finished. */
function groupSummary({ calls, subagents, startedAgents }: Held): string {
  const tools = calls + startedAgents;

  const said = [
    ...(tools > 0 ? [countWords(tools, { one: "tool call", many: "tool calls" })] : []),
    ...(subagents > 0 ? [countWords(subagents, { one: "subagent", many: "subagents" })] : []),
  ];

  return said.join(", ");
}

/** Whether a block is work a group gathers: a call, a subagent, or a start of an agent. */
function isWork(part: RowPart): boolean {
  return part === ROW_PART.CALL || part === ROW_PART.SUBAGENT || part === ROW_PART.AGENT;
}

/** Whether a block runs together with the work beside it: that work, or a thought. */
function runsWithCalls(part: RowPart): boolean {
  return isWork(part) || part === ROW_PART.NOTE;
}

/** A block with the key its row is drawn under. */
interface Keyed<B> {
  readonly key: string;
  readonly block: B;
}

/**
 * A turn's blocks as the rows a tab draws: the words and lone calls as they
 * are, and calls and subagents next to one another grouped with the
 * thoughts between and beside them, the group open while it is the turn's
 * latest work on a turn that moves. A run of thoughts with no work in it
 * stands as its rows. A run of one call or subagent is its own row, unless
 * it is that latest work, which is drawn as a group so the work after it
 * joins it rather than redraw it.
 */
export function turnRows<B>(
  blocks: readonly B[],
  read: RowReading<B>,
  turn: {
    /** Whether the turn still moves, which keeps its latest group open. */
    readonly moving: boolean;
  },
): readonly TurnRow<B>[] {
  const rows: TurnRow<B>[] = [];
  let group: Keyed<B>[] = [];

  const flush = (trailing: boolean) => {
    const held = counted(group, read);
    const work = held.calls + held.subagents + held.startedAgents;
    const [first] = group;

    if (first === undefined) return;
    const open = trailing && turn.moving;

    if (work > 0 && (group.length > 1 || open)) {
      rows.push({
        kind: TURN_ROW.GROUP,
        key: first.key,
        blocks: group.map((each) => each.block),
        summary: groupSummary(held),
        open,
        running: group.some((each) => read.running(each.block)),
      });
    } else {
      rows.push(
        ...group.map((each) => ({ kind: TURN_ROW.BLOCK, key: each.key, block: each.block })),
      );
    }

    group = [];
  };

  for (const [index, block] of blocks.entries()) {
    const each = { key: read.key(block, index), block };

    if (runsWithCalls(read.part(block))) {
      group.push(each);
      continue;
    }

    flush(false);
    rows.push({ kind: TURN_ROW.BLOCK, key: each.key, block });
  }

  flush(true);

  return rows;
}

/** How many calls, subagents, and agents started a run's blocks hold. */
function counted<B>(blocks: readonly Keyed<B>[], read: RowReading<B>): Held {
  let calls = 0;
  let subagents = 0;
  let startedAgents = 0;

  for (const { block } of blocks) {
    const part = read.part(block);

    if (part === ROW_PART.CALL || part === ROW_PART.LONE_CALL) calls += 1;

    if (part === ROW_PART.SUBAGENT) subagents += 1;

    if (part === ROW_PART.AGENT) startedAgents += 1;
  }

  return { calls, subagents, startedAgents };
}
