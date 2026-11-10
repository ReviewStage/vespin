/**
 * mcp-parity.ts -- the `vespin` command that does what each member MCP tool does, or why there is none, so the CLI stays level with the member MCP server.
 *
 * The member MCP server and this command are two front ends over the same
 * hosted procedures (the service's `coverage.ts` names a tool's), one written
 * for a model and one for a terminal. Neither calls the other, so this table
 * is what keeps them level: every tool named in `MEMBER_MCP_TOOL` has a row,
 * and a tool added without one does not build. A row names the command path
 * as typed after `vespin`, which `mcp-parity.test.ts` holds to a command that
 * exists; a command may answer in other words and take several calls where
 * the tool takes one. A row with no command names why: `NOT_YET_BUILT` is the
 * backlog, reached today only through `vespin api`, and each leaf that adds
 * the command replaces its row. A reason by design, a tool that cannot make
 * sense in a terminal, is added to `MCP_CLI_GAP` with the first row it holds.
 */

import { MEMBER_MCP_TOOL, type MemberMcpToolName } from "@repo/features/member-mcp-tool";

/** Why a tool has no command of its own. */
export const MCP_CLI_GAP = {
  /** Not written yet: `vespin api` reaches its procedures until a typed command does. */
  NOT_YET_BUILT: "not-yet-built",
} as const;

export type McpCliGap = (typeof MCP_CLI_GAP)[keyof typeof MCP_CLI_GAP];

/** One tool's row: the command path after `vespin`, or why there is none. */
type McpCliRow = { readonly command: readonly [string, ...string[]] } | { readonly gap: McpCliGap };

/** Each tool's command, or its gap. */
export const MEMBER_MCP_CLI_PARITY = {
  [MEMBER_MCP_TOOL.LIST_WORKSPACES]: { command: ["workspace", "list"] },
  [MEMBER_MCP_TOOL.CREATE_WORKSPACE]: { command: ["workspace", "create"] },
  [MEMBER_MCP_TOOL.LIST_WORKSPACE_MEMBERS]: { command: ["workspace", "members"] },
  [MEMBER_MCP_TOOL.SET_WORKSPACE_SLUG]: { command: ["workspace", "slug"] },
  [MEMBER_MCP_TOOL.LIST_TASKS]: { command: ["task", "list"] },
  [MEMBER_MCP_TOOL.READ_TASK]: { command: ["task", "view"] },
  [MEMBER_MCP_TOOL.LIST_AGENTS]: { command: ["agent", "list"] },
  [MEMBER_MCP_TOOL.READ_AGENT]: { command: ["agent", "view"] },
  [MEMBER_MCP_TOOL.READ_AGENT_CHANGES]: { command: ["agent", "diff"] },
  [MEMBER_MCP_TOOL.READ_AGENT_TRANSCRIPT]: { command: ["agent", "logs"] },
  [MEMBER_MCP_TOOL.LIST_MODELS]: { command: ["models"] },
  [MEMBER_MCP_TOOL.UPDATE_PREFERENCES]: { command: ["preferences", "set"] },
  [MEMBER_MCP_TOOL.READ_PAGE]: { gap: MCP_CLI_GAP.NOT_YET_BUILT },
  [MEMBER_MCP_TOOL.READ_TASK_FILE]: { command: ["task", "cat"] },
  [MEMBER_MCP_TOOL.LIST_TASK_FOLDER]: { command: ["task", "ls"] },
  [MEMBER_MCP_TOOL.CREATE_TASK]: { command: ["task", "create"] },
  [MEMBER_MCP_TOOL.UPDATE_TASK]: { command: ["task", "update"] },
  [MEMBER_MCP_TOOL.EDIT_DESCRIPTION]: { command: ["description", "edit"] },
  [MEMBER_MCP_TOOL.LIST_DESCRIPTION_REVISIONS]: { command: ["description", "history"] },
  [MEMBER_MCP_TOOL.READ_DESCRIPTION_REVISION]: { command: ["description", "show"] },
  [MEMBER_MCP_TOOL.RESTORE_DESCRIPTION_REVISION]: { command: ["description", "restore"] },
  [MEMBER_MCP_TOOL.CREATE_SECTION]: { command: ["section", "create"] },
  [MEMBER_MCP_TOOL.DELETE_SECTION]: { command: ["section", "delete"] },
  [MEMBER_MCP_TOOL.START_AGENT]: { command: ["agent", "start"] },
  [MEMBER_MCP_TOOL.MESSAGE_AGENT]: { command: ["agent", "send"] },
  [MEMBER_MCP_TOOL.STOP_AGENT]: { command: ["agent", "stop"] },
  [MEMBER_MCP_TOOL.UPDATE_AGENT]: { command: ["agent", "update"] },
  [MEMBER_MCP_TOOL.LIST_AGENT_PORTS]: { command: ["agent", "ports"] },
  [MEMBER_MCP_TOOL.SHARE_AGENT_PORT]: { command: ["agent", "share"] },
  [MEMBER_MCP_TOOL.LIST_AGENT_BROWSER_TABS]: { command: ["agent", "tabs"] },
  [MEMBER_MCP_TOOL.OPEN_AGENT_BROWSER_TAB]: { command: ["agent", "tabs", "open"] },
  [MEMBER_MCP_TOOL.TAKE_OVER_AGENT_BROWSER_TAB]: { command: ["agent", "tabs", "take"] },
  [MEMBER_MCP_TOOL.HAND_BACK_AGENT_BROWSER_TAB]: { command: ["agent", "tabs", "hand-back"] },
  [MEMBER_MCP_TOOL.READ_INBOX]: { command: ["inbox", "list"] },
  [MEMBER_MCP_TOOL.ANSWER_ASK]: { command: ["inbox", "answer"] },
  [MEMBER_MCP_TOOL.REPLY_TO_THREAD]: { command: ["inbox", "reply"] },
  [MEMBER_MCP_TOOL.CLOSE_THREAD]: { command: ["inbox", "close"] },
  [MEMBER_MCP_TOOL.AGENT_PULL_REQUEST_ACTION]: { command: ["agent", "pr"] },
  [MEMBER_MCP_TOOL.READ_PULL_REQUEST]: { command: ["pr", "view"] },
  [MEMBER_MCP_TOOL.MARK_PULL_REQUEST_FILES_VIEWED]: { command: ["pr", "viewed"] },
  [MEMBER_MCP_TOOL.READ_PULL_REQUEST_CHAPTERS]: { command: ["pr", "chapters"] },
  [MEMBER_MCP_TOOL.GENERATE_PULL_REQUEST_CHAPTERS]: { command: ["pr", "chapters"] },
  [MEMBER_MCP_TOOL.READ_COMMENTS]: { gap: MCP_CLI_GAP.NOT_YET_BUILT },
  [MEMBER_MCP_TOOL.COMMENT_ON_DESCRIPTION]: { gap: MCP_CLI_GAP.NOT_YET_BUILT },
  [MEMBER_MCP_TOOL.REPLY_TO_COMMENT]: { gap: MCP_CLI_GAP.NOT_YET_BUILT },
  [MEMBER_MCP_TOOL.UPDATE_COMMENT]: { gap: MCP_CLI_GAP.NOT_YET_BUILT },
  [MEMBER_MCP_TOOL.SEARCH_MEMORY]: { command: ["memory", "search"] },
  [MEMBER_MCP_TOOL.SAVE_MEMORY]: { command: ["memory", "save"] },
  [MEMBER_MCP_TOOL.LIST_MEMORIES]: { command: ["memory", "list"] },
  [MEMBER_MCP_TOOL.FORGET_MEMORY]: { command: ["memory", "forget"] },
  [MEMBER_MCP_TOOL.LIST_AUTOMATIONS]: { command: ["automation", "list"] },
  [MEMBER_MCP_TOOL.CREATE_AUTOMATION]: { command: ["automation", "create"] },
  [MEMBER_MCP_TOOL.UPDATE_AUTOMATION]: { command: ["automation", "update"] },
  [MEMBER_MCP_TOOL.RUN_AUTOMATION]: { command: ["automation", "run"] },
  [MEMBER_MCP_TOOL.DELETE_AUTOMATION]: { command: ["automation", "delete"] },
  [MEMBER_MCP_TOOL.READ_SANDBOX_SETUP]: { command: ["setup", "show"] },
  [MEMBER_MCP_TOOL.EDIT_SANDBOX_SETUP]: { command: ["setup", "edit"] },
} as const satisfies Record<MemberMcpToolName, McpCliRow>;
