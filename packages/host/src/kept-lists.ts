/**
 * kept-lists.ts -- the names the seven kept reads' rows are kept under in the account's local database, each read by its own name and its rows by their kind's.
 *
 * Each pool read that is kept declares one of these as its `kept`
 * (`PoolRead.kept`), with its workspace where it reads one. A list that
 * stands on two kinds, as the task list stands on plans and agents, is two
 * reads, one for each kind. The names are stored, so each is kept as it
 * first shipped.
 */

/** The kind each kept row is stored under, by its entity. */
const KEPT_KIND = {
  PLAN: "plan",
  AGENT: "agent",
  TASK_SECTIONS: "taskSections",
  REPOSITORY_PIN: "repositoryPin",
  WORKSPACE: "workspace",
  WORKSPACE_PEOPLE: "workspacePeople",
  WORKSPACE_INVITATION: "workspaceInvitation",
  AUTOMATION: "automation",
  INBOX_ITEM: "inboxItem",
} as const;

/** Every kept read, by its stored name and the kind its rows are kept under. */
export const KEPT_LIST = {
  TASK_LIST_PLANS: { name: "taskList.plans", kind: KEPT_KIND.PLAN },
  TASK_LIST_AGENTS: { name: "taskList.agents", kind: KEPT_KIND.AGENT },
  SIDEBAR_SECTIONS: { name: "sidebar.sections", kind: KEPT_KIND.TASK_SECTIONS },
  SIDEBAR_PINS: { name: "sidebar.pins", kind: KEPT_KIND.REPOSITORY_PIN },
  WORKSPACES: { name: "workspaces", kind: KEPT_KIND.WORKSPACE },
  MEMBERS: { name: "members", kind: KEPT_KIND.WORKSPACE_PEOPLE },
  INVITATIONS: { name: "invitations", kind: KEPT_KIND.WORKSPACE_INVITATION },
  AUTOMATIONS: { name: "automations", kind: KEPT_KIND.AUTOMATION },
  INBOX: { name: "inbox", kind: KEPT_KIND.INBOX_ITEM },
} as const;
