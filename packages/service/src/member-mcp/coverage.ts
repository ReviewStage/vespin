/**
 * coverage.ts -- the hosted procedures that do what each member MCP tool does, and why every other procedure has no tool, so the hosted API and an outside agent reach the same things.
 *
 * The member MCP server and the hosted API are two front ends over the
 * service's operations: the tools are written for a model, the procedures
 * for the desktop, the web app, and the command-line tool. Neither calls the
 * other, so these two tables are what keep them level, and both are held by
 * the type checker in both directions.
 *
 * Every tool named in `MEMBER_MCP_TOOL` has a row in `MEMBER_MCP_COVERAGE`,
 * and a tool added without one does not build; each row names the
 * procedures, by their resource and their name in the contract, that
 * together do what the tool does, a read a write needs among them, such as
 * the description a comment is anchored in. A procedure may answer in other
 * words and shapes than its tool, and may take several calls where the tool
 * takes one, but no tool may do what no procedure reaches. Where a procedure
 * the tool needs does not exist, it is added to the contract before the
 * tool's row can name it.
 *
 * Every procedure of `hostedContract` that no row names is in
 * `MEMBER_MCP_EXCLUSIONS` with its reason, and only those: a procedure added
 * to the contract in neither table does not build, nor does one a row names
 * that is still excluded. A `NOT_YET_BUILT` row is the backlog: the PR that
 * adds its tool names the procedure in the tool's row and deletes the
 * exclusion in the same change.
 */

import type { hostedContract } from "@repo/features/contract";
import { MEMBER_MCP_TOOL, type MemberMcpToolName } from "./tools.js";

type HostedContract = typeof hostedContract;
type HostedResource = keyof HostedContract;

/** Some procedures of the hosted contract, by resource and then by name: at least one under each resource named. */
type HostedProcedureNames = {
  readonly [Resource in HostedResource]?: readonly [
    keyof HostedContract[Resource],
    ...(keyof HostedContract[Resource])[],
  ];
};

/** Why a procedure has no member MCP tool. */
export const MEMBER_MCP_EXCLUSION_REASON = {
  /** It feeds a window: a live stream, a frame, a picker's options, or a composer's state. */
  SCREEN_ONLY: "screen-only",
  /** A sign-in or connect flow that finishes in a browser, or a link only a person opens; a disconnect is no such flow. */
  NEEDS_BROWSER: "needs-browser",
  /** It reads or writes a secret, which no tool ever carries: a provider key or the GitHub token goes in through the CLI's stdin alone. */
  SECRET: "secret",
  /** It hands a person trust in the account, a decision the member makes in the app alone and never through an agent. */
  SECURITY: "security",
  /** It cannot be undone and stays in the app and the CLI alone, by design. */
  DESTRUCTIVE: "destructive",
  /** Pairing, devices, the admin dashboard, and the service's own bookkeeping: no member's work. */
  INTERNAL: "internal",
  /** A member could use a tool for it, and none exists yet. */
  NOT_YET_BUILT: "not-yet-built",
} as const;

export type MemberMcpExclusionReason =
  (typeof MEMBER_MCP_EXCLUSION_REASON)[keyof typeof MEMBER_MCP_EXCLUSION_REASON];

const { SCREEN_ONLY, NEEDS_BROWSER, SECRET, SECURITY, DESTRUCTIVE, INTERNAL, NOT_YET_BUILT } =
  MEMBER_MCP_EXCLUSION_REASON;

/** Each tool's procedures: at least one, so no row stands empty. */
export const MEMBER_MCP_COVERAGE = {
  [MEMBER_MCP_TOOL.LIST_WORKSPACES]: { workspaces: ["list"] },
  [MEMBER_MCP_TOOL.LIST_WORKSPACE_MEMBERS]: { workspaces: ["members"] },
  [MEMBER_MCP_TOOL.SET_WORKSPACE_SLUG]: { workspaces: ["setSlug"] },
  [MEMBER_MCP_TOOL.LIST_TASKS]: { plans: ["list"], taskSections: ["list"] },
  [MEMBER_MCP_TOOL.READ_TASK]: { plans: ["open"] },
  [MEMBER_MCP_TOOL.LIST_AGENTS]: { agents: ["listOfWorkspace", "listOfTask"] },
  [MEMBER_MCP_TOOL.READ_AGENT]: {
    agents: ["read"],
    agentPullRequests: ["pullRequest"],
    messages: ["agentNewest", "agent"],
  },
  [MEMBER_MCP_TOOL.READ_AGENT_CHANGES]: { agentPullRequests: ["pullRequest"], agents: ["changes"] },
  [MEMBER_MCP_TOOL.READ_AGENT_TRANSCRIPT]: {
    messages: [
      "agent",
      "agentNewest",
      "agentWorker",
      "agentWorkerNewest",
      "agentPart",
      "agentWorkerPart",
    ],
  },
  [MEMBER_MCP_TOOL.LIST_MODELS]: { models: ["list"], account: ["preferences"] },
  [MEMBER_MCP_TOOL.READ_PAGE]: { taskFiles: ["pages", "page"], agentPages: ["list", "version"] },
  [MEMBER_MCP_TOOL.READ_TASK_FILE]: { taskFiles: ["file"] },
  [MEMBER_MCP_TOOL.LIST_TASK_FOLDER]: { taskFiles: ["tree"] },
  [MEMBER_MCP_TOOL.CREATE_TASK]: { plans: ["create", "editDescription"] },
  [MEMBER_MCP_TOOL.UPDATE_TASK]: { plans: ["update", "parent", "block"], taskSections: ["write"] },
  [MEMBER_MCP_TOOL.EDIT_DESCRIPTION]: { plans: ["open", "editDescription"] },
  [MEMBER_MCP_TOOL.LIST_DESCRIPTION_REVISIONS]: { plans: ["descriptionRevisions"] },
  [MEMBER_MCP_TOOL.READ_DESCRIPTION_REVISION]: { plans: ["descriptionRevision"] },
  [MEMBER_MCP_TOOL.RESTORE_DESCRIPTION_REVISION]: { plans: ["restoreDescription"] },
  [MEMBER_MCP_TOOL.CREATE_SECTION]: { taskSections: ["write"] },
  [MEMBER_MCP_TOOL.DELETE_SECTION]: { taskSections: ["write"] },
  [MEMBER_MCP_TOOL.START_AGENT]: { agents: ["start", "startFrom"], plans: ["create"] },
  [MEMBER_MCP_TOOL.MESSAGE_AGENT]: { messages: ["send"] },
  [MEMBER_MCP_TOOL.STOP_AGENT]: { agents: ["stop"] },
  [MEMBER_MCP_TOOL.UPDATE_AGENT]: { agents: ["change"] },
  [MEMBER_MCP_TOOL.LIST_AGENT_PORTS]: { agentPorts: ["list", "shared"] },
  [MEMBER_MCP_TOOL.SHARE_AGENT_PORT]: { agentPorts: ["share", "unshare"] },
  [MEMBER_MCP_TOOL.READ_INBOX]: { inbox: ["account", "task", "agent"] },
  [MEMBER_MCP_TOOL.ANSWER_ASK]: { inbox: ["message"] },
  [MEMBER_MCP_TOOL.REPLY_TO_THREAD]: { inbox: ["message"] },
  [MEMBER_MCP_TOOL.CLOSE_THREAD]: { inbox: ["close"] },
  [MEMBER_MCP_TOOL.AGENT_PULL_REQUEST_ACTION]: { agentPullRequests: ["action"] },
  [MEMBER_MCP_TOOL.READ_COMMENTS]: { descriptionComments: ["read"] },
  [MEMBER_MCP_TOOL.COMMENT_ON_DESCRIPTION]: { plans: ["open"], descriptionComments: ["start"] },
  [MEMBER_MCP_TOOL.REPLY_TO_COMMENT]: { descriptionComments: ["act"] },
  [MEMBER_MCP_TOOL.UPDATE_COMMENT]: { descriptionComments: ["act"] },
  [MEMBER_MCP_TOOL.SEARCH_MEMORY]: { account: ["searchMemories"] },
  [MEMBER_MCP_TOOL.SAVE_MEMORY]: { account: ["saveMemory"] },
  [MEMBER_MCP_TOOL.LIST_MEMORIES]: { account: ["memories"] },
  [MEMBER_MCP_TOOL.FORGET_MEMORY]: { account: ["forgetMemory"] },
  [MEMBER_MCP_TOOL.LIST_AUTOMATIONS]: { automations: ["list", "read", "runs"] },
  [MEMBER_MCP_TOOL.CREATE_AUTOMATION]: { automations: ["create"] },
  [MEMBER_MCP_TOOL.UPDATE_AUTOMATION]: { automations: ["read", "change"] },
  [MEMBER_MCP_TOOL.RUN_AUTOMATION]: { automations: ["run"] },
  [MEMBER_MCP_TOOL.DELETE_AUTOMATION]: { automations: ["remove"] },
} as const satisfies Record<MemberMcpToolName, HostedProcedureNames>;

type Coverage = typeof MEMBER_MCP_COVERAGE;

/** The names of one resource's procedures that some tool's row names. */
type CoveredProcedure<Resource extends HostedResource> = {
  [Tool in keyof Coverage]: Resource extends keyof Coverage[Tool]
    ? Coverage[Tool][Resource] extends readonly (infer Name)[]
      ? Name
      : never
    : never;
}[keyof Coverage];

/** The names of one resource's procedures that no tool's row names. */
type UncoveredProcedure<Resource extends HostedResource> = Exclude<
  keyof HostedContract[Resource],
  CoveredProcedure<Resource>
>;

/**
 * Exactly the procedures no row names, each with its reason: a resource
 * whose every procedure a row names has no entry, a procedure missing here
 * fails as a missing key, and one a row names fails as an excess one.
 */
type MemberMcpExclusions = {
  readonly [Resource in HostedResource as [UncoveredProcedure<Resource>] extends [never]
    ? never
    : Resource]: { readonly [Name in UncoveredProcedure<Resource>]: MemberMcpExclusionReason };
};

/** Every procedure no tool reaches, and why. */
export const MEMBER_MCP_EXCLUSIONS = {
  account: {
    access: INTERNAL,
    active: INTERNAL,
    writePreferences: NOT_YET_BUILT,
    providerKeys: SECRET,
    saveProviderKey: SECRET,
    setProviderKeyForAgents: SECRET,
    renameSubscription: SECRET,
    reorderSubscriptions: SECRET,
    removeProviderKey: SECRET,
    startChatGptDeviceLogin: NEEDS_BROWSER,
    pollChatGptDeviceLogin: NEEDS_BROWSER,
    cancelChatGptDeviceLogin: NEEDS_BROWSER,
  },
  admin: {
    cost: INTERNAL,
    day: INTERNAL,
    favorite: INTERNAL,
    metrics: INTERNAL,
    reliability: INTERNAL,
    unfavorite: INTERNAL,
    user: INTERNAL,
    users: INTERNAL,
    workspace: INTERNAL,
    workspaces: INTERNAL,
  },
  agentBrowserTabs: {
    list: NOT_YET_BUILT,
    agentList: NOT_YET_BUILT,
    agentOpen: NOT_YET_BUILT,
    open: NOT_YET_BUILT,
    takeOver: NOT_YET_BUILT,
    handBack: NOT_YET_BUILT,
  },
  agentPages: { frame: SCREEN_ONLY },
  agentPullRequests: {
    viewed: NOT_YET_BUILT,
    overviewPullRequest: NOT_YET_BUILT,
    overviewChecks: NOT_YET_BUILT,
    overviewConversation: NOT_YET_BUILT,
  },
  agents: {
    delete: NOT_YET_BUILT,
    warm: NOT_YET_BUILT,
    rewind: NOT_YET_BUILT,
    reviewOptions: SCREEN_ONLY,
    workspaceTools: SCREEN_ONLY,
    sandboxResume: NOT_YET_BUILT,
    // Note that a Terminal tab is interactive, so the CLI's `vespin agent shell` reaches it and no tool does.
    terminals: SCREEN_ONLY,
    openTerminal: SCREEN_ONLY,
    renameTerminal: SCREEN_ONLY,
    endTerminal: SCREEN_ONLY,
  },
  dictation: { transcribe: SCREEN_ONLY },
  events: { record: INTERNAL },
  github: {
    connect: NEEDS_BROWSER,
    claim: NEEDS_BROWSER,
    connection: NOT_YET_BUILT,
    disconnect: NOT_YET_BUILT,
    repositories: NOT_YET_BUILT,
    tokenRepositories: NOT_YET_BUILT,
    setTokenRepository: NOT_YET_BUILT,
    repositoryFile: NOT_YET_BUILT,
    repositoryTree: NOT_YET_BUILT,
    repositorySkills: NOT_YET_BUILT,
    repositoryPullRequest: NOT_YET_BUILT,
    repositoryIssue: NOT_YET_BUILT,
  },
  githubToken: { read: SECRET, save: SECRET, remove: SECRET },
  hosts: {
    list: INTERNAL,
    presence: INTERNAL,
    remove: INTERNAL,
    readPairing: INTERNAL,
    approvePairing: INTERNAL,
    denyPairing: INTERNAL,
  },
  inbox: {
    home: SCREEN_ONLY,
    answer: NOT_YET_BUILT,
    start: NOT_YET_BUILT,
    markItemRead: NOT_YET_BUILT,
    markItemUnread: NOT_YET_BUILT,
    remindItem: NOT_YET_BUILT,
    snoozeItem: NOT_YET_BUILT,
    markAllRead: NOT_YET_BUILT,
  },
  installedSkills: {
    list: NOT_YET_BUILT,
    read: NOT_YET_BUILT,
    preview: NOT_YET_BUILT,
    install: NOT_YET_BUILT,
    remove: NOT_YET_BUILT,
  },
  integrations: {
    statuses: NOT_YET_BUILT,
    settle: NEEDS_BROWSER,
    github: NEEDS_BROWSER,
    connect: NEEDS_BROWSER,
    tools: NOT_YET_BUILT,
    cancel: NEEDS_BROWSER,
    disconnect: NOT_YET_BUILT,
    rename: NOT_YET_BUILT,
  },
  live: {
    inbox: SCREEN_ONLY,
    inboxItems: SCREEN_ONLY,
    taskRecord: SCREEN_ONLY,
    taskPages: SCREEN_ONLY,
    agentPages: SCREEN_ONLY,
    agentOrigin: SCREEN_ONLY,
    taskHistory: SCREEN_ONLY,
    taskComments: SCREEN_ONLY,
    taskBrowserTabs: SCREEN_ONLY,
    agentBrowserTabs: SCREEN_ONLY,
    tasks: SCREEN_ONLY,
    automations: SCREEN_ONLY,
    automationWorkspaceRuns: SCREEN_ONLY,
    automationRuns: SCREEN_ONLY,
    agentTranscript: SCREEN_ONLY,
    macCommands: SCREEN_ONLY,
    taskInbox: SCREEN_ONLY,
    agentInbox: SCREEN_ONLY,
    sidebar: SCREEN_ONLY,
    workspaces: SCREEN_ONLY,
    workspaceMembers: SCREEN_ONLY,
    workspaceInvitations: SCREEN_ONLY,
    hosts: SCREEN_ONLY,
    workspaceMemories: SCREEN_ONLY,
    installedSkills: SCREEN_ONLY,
    workspaceIntegrations: SCREEN_ONLY,
    pullRequestChapters: SCREEN_ONLY,
    integrationStatuses: SCREEN_ONLY,
    accountPreferences: SCREEN_ONLY,
  },
  deviceAgents: {
    startPairing: INTERNAL,
    pollPairing: INTERNAL,
    enrollOwn: INTERNAL,
    leave: INTERNAL,
    register: INTERNAL,
    beat: INTERNAL,
    liveAgents: INTERNAL,
    lines: INTERNAL,
    claimLine: INTERNAL,
    lineStep: INTERNAL,
    settleLine: INTERNAL,
    requests: INTERNAL,
    claimRequest: INTERNAL,
    answerRequest: INTERNAL,
  },
  macCommands: { waiting: INTERNAL, settle: INTERNAL, claim: INTERNAL, listening: INTERNAL },
  mcpClients: { list: NOT_YET_BUILT, revoke: NOT_YET_BUILT },
  messages: {
    queue: NOT_YET_BUILT,
  },
  plans: {
    find: NOT_YET_BUILT,
    relation: NOT_YET_BUILT,
    delete: NOT_YET_BUILT,
  },
  pullRequestChapters: {
    read: NOT_YET_BUILT,
    generate: NOT_YET_BUILT,
    repositoryRead: NOT_YET_BUILT,
    repositoryGenerate: NOT_YET_BUILT,
  },
  pullRequests: {
    pullRequest: NOT_YET_BUILT,
    changes: NOT_YET_BUILT,
    action: NOT_YET_BUILT,
    viewed: NOT_YET_BUILT,
    reviewOptions: SCREEN_ONLY,
    overviewPullRequest: NOT_YET_BUILT,
    overviewChecks: NOT_YET_BUILT,
    overviewConversation: NOT_YET_BUILT,
  },
  pushDevices: { register: INTERNAL, unregister: INTERNAL, status: INTERNAL, notify: INTERNAL },
  repositoryPins: { list: NOT_YET_BUILT, set: NOT_YET_BUILT },
  supportAccess: { grant: SECURITY, revoke: SECURITY },
  taskFiles: {
    skills: SCREEN_ONLY,
    keepPicture: SCREEN_ONLY,
    pageFrame: SCREEN_ONLY,
  },
  workspaceEnvironment: { list: NOT_YET_BUILT, put: NOT_YET_BUILT, delete: NOT_YET_BUILT },
  workspaceSandboxSetup: {
    read: NOT_YET_BUILT,
    putInstall: NOT_YET_BUILT,
    putRepository: NOT_YET_BUILT,
  },
  workspaceGithub: { connect: NEEDS_BROWSER, disconnect: NOT_YET_BUILT },
  workspaceInvitations: {
    list: NOT_YET_BUILT,
    invite: NOT_YET_BUILT,
    cancel: NOT_YET_BUILT,
    offer: NEEDS_BROWSER,
  },
  workspaceSentry: {
    install: NEEDS_BROWSER,
    installations: NOT_YET_BUILT,
    disconnect: NOT_YET_BUILT,
  },
  workspaceSlackBot: {
    read: NOT_YET_BUILT,
    connect: NEEDS_BROWSER,
    disconnect: NOT_YET_BUILT,
    notifications: NOT_YET_BUILT,
    repository: NOT_YET_BUILT,
    channel: NOT_YET_BUILT,
  },
  workspaces: {
    create: NOT_YET_BUILT,
    rename: NOT_YET_BUILT,
    setPhoto: NOT_YET_BUILT,
    setExperiment: INTERNAL,
    removeMember: NOT_YET_BUILT,
    changeRole: NOT_YET_BUILT,
    transfer: DESTRUCTIVE,
    leave: DESTRUCTIVE,
    delete: DESTRUCTIVE,
  },
} as const satisfies MemberMcpExclusions;
