/**
 * member-mcp-tool.ts -- the name of every tool the member MCP server offers an outside agent acting for a member.
 *
 * The tools themselves are declared in the service
 * (`packages/service/src/member-mcp/tools.ts`); their names stand here, below
 * both the service and the command-line tool, because two tables are keyed
 * by them: the service's `coverage.ts`, which names the hosted procedures
 * that do what each tool does, and the CLI's `mcp-parity.ts`, which names the
 * `vespin` command that does it, or why there is none. A tool named here
 * without a row in either does not build.
 */

import { AGENT_TOOL } from "./agent-tools.js";

/** The tools by name, each the name a model calls it by. */
export const MEMBER_MCP_TOOL = {
  LIST_WORKSPACES: "list_workspaces",
  LIST_WORKSPACE_MEMBERS: "list_workspace_members",
  SET_WORKSPACE_SLUG: "set_workspace_slug",
  LIST_TASKS: AGENT_TOOL.LIST_TASKS,
  READ_TASK: AGENT_TOOL.READ_TASK,
  LIST_AGENTS: AGENT_TOOL.LIST_AGENTS,
  READ_AGENT: AGENT_TOOL.READ_AGENT,
  READ_AGENT_CHANGES: "read_agent_changes",
  READ_AGENT_TRANSCRIPT: "read_agent_transcript",
  LIST_MODELS: AGENT_TOOL.LIST_MODELS,
  UPDATE_PREFERENCES: "update_preferences",
  READ_PAGE: AGENT_TOOL.READ_PAGE,
  READ_TASK_FILE: "read_task_file",
  LIST_TASK_FOLDER: "list_task_folder",
  CREATE_TASK: AGENT_TOOL.CREATE_TASK,
  UPDATE_TASK: AGENT_TOOL.UPDATE_TASK,
  DELETE_TASK: "delete_task",
  EDIT_DESCRIPTION: AGENT_TOOL.EDIT_DESCRIPTION,
  LIST_DESCRIPTION_REVISIONS: "list_description_revisions",
  READ_DESCRIPTION_REVISION: "read_description_revision",
  RESTORE_DESCRIPTION_REVISION: "restore_description_revision",
  CREATE_SECTION: AGENT_TOOL.CREATE_SECTION,
  DELETE_SECTION: AGENT_TOOL.DELETE_SECTION,
  START_AGENT: AGENT_TOOL.START_AGENT,
  MESSAGE_AGENT: AGENT_TOOL.MESSAGE_AGENT,
  STOP_AGENT: AGENT_TOOL.STOP_AGENT,
  UPDATE_AGENT: AGENT_TOOL.UPDATE_AGENT,
  REWIND_AGENT: "rewind_agent",
  DELETE_AGENT: "delete_agent",
  WAKE_AGENT: "wake_agent",
  LIST_AGENT_PORTS: "list_agent_ports",
  SHARE_AGENT_PORT: "share_agent_port",
  LIST_AGENT_BROWSER_TABS: "list_agent_browser_tabs",
  OPEN_AGENT_BROWSER_TAB: "open_agent_browser_tab",
  TAKE_OVER_AGENT_BROWSER_TAB: "take_over_agent_browser_tab",
  HAND_BACK_AGENT_BROWSER_TAB: "hand_back_agent_browser_tab",
  READ_INBOX: "read_inbox",
  ANSWER_ASK: "answer_ask",
  REPLY_TO_THREAD: "reply_to_thread",
  CLOSE_THREAD: "close_thread",
  AGENT_PULL_REQUEST_ACTION: "agent_pull_request_action",
  READ_PULL_REQUEST: "read_pull_request",
  MARK_PULL_REQUEST_FILES_VIEWED: "mark_pull_request_files_viewed",
  READ_PULL_REQUEST_CHAPTERS: "read_pull_request_chapters",
  GENERATE_PULL_REQUEST_CHAPTERS: "generate_pull_request_chapters",
  READ_COMMENTS: AGENT_TOOL.READ_COMMENTS,
  COMMENT_ON_DESCRIPTION: "comment_on_description",
  REPLY_TO_COMMENT: AGENT_TOOL.REPLY_TO_COMMENT,
  UPDATE_COMMENT: AGENT_TOOL.UPDATE_COMMENT,
  SEARCH_MEMORY: AGENT_TOOL.SEARCH_MEMORY,
  SAVE_MEMORY: AGENT_TOOL.SAVE_MEMORY,
  LIST_MEMORIES: "list_memories",
  FORGET_MEMORY: "forget_memory",
  LIST_AUTOMATIONS: AGENT_TOOL.LIST_AUTOMATIONS,
  CREATE_AUTOMATION: AGENT_TOOL.CREATE_AUTOMATION,
  UPDATE_AUTOMATION: AGENT_TOOL.UPDATE_AUTOMATION,
  RUN_AUTOMATION: AGENT_TOOL.RUN_AUTOMATION,
  DELETE_AUTOMATION: AGENT_TOOL.DELETE_AUTOMATION,
  READ_SANDBOX_SETUP: "read_sandbox_setup",
  EDIT_SANDBOX_SETUP: "edit_sandbox_setup",
  LIST_INTEGRATIONS: "list_integrations",
  CONNECT_INTEGRATION: "connect_integration",
  RENAME_INTEGRATION: "rename_integration",
  DISCONNECT_INTEGRATION: "disconnect_integration",
  LIST_MCP_CLIENTS: "list_mcp_clients",
  LIST_SENTRY_INSTALLATIONS: "list_sentry_installations",
  DISCONNECT_SENTRY: "disconnect_sentry",
} as const;

export type MemberMcpToolName = (typeof MEMBER_MCP_TOOL)[keyof typeof MEMBER_MCP_TOOL];
