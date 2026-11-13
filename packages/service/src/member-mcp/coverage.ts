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
  /** It reads or writes a secret no tool carries: a provider key or the GitHub token goes in through the CLI's stdin alone. A workspace environment variable's value is the one secret a tool takes, `set_environment_variable`'s input, and no tool ever answers one. */
  SECRET: "secret",
  /** It hands a person trust in the account, or takes a way into it away under a fresh session, a decision the member makes in the app alone and never through an agent. */
  SECURITY: "security",
  /** It cannot be undone and stays in the app and the CLI alone, by design. */
  DESTRUCTIVE: "destructive",
  /** Pairing, devices, the admin dashboard, and the service's own bookkeeping: no member's work. */
  INTERNAL: "internal",
  /** It refuses every caller, and stands only for an older client that still sends it. */
  RETIRED: "retired",
  /** A member could use a tool for it, and none exists yet. */
  NOT_YET_BUILT: "not-yet-built",
  /** Who follows a task, and whose machines its agents may use, is a member's own choice in the app: an agent reads followers and never adds, removes, or switches one. */
  MEMBER_ONLY: "member-only",
} as const;

export type MemberMcpExclusionReason =
  (typeof MEMBER_MCP_EXCLUSION_REASON)[keyof typeof MEMBER_MCP_EXCLUSION_REASON];

const {
  SCREEN_ONLY,
  NEEDS_BROWSER,
  SECRET,
  SECURITY,
  DESTRUCTIVE,
  INTERNAL,
  RETIRED,
  NOT_YET_BUILT,
  MEMBER_ONLY,
} = MEMBER_MCP_EXCLUSION_REASON;

/** Each tool's procedures: at least one, so no row stands empty. */
export const MEMBER_MCP_COVERAGE = {
  [MEMBER_MCP_TOOL.LIST_WORKSPACES]: { workspaces: ["list"] },
  [MEMBER_MCP_TOOL.CREATE_WORKSPACE]: { workspaces: ["create"] },
  [MEMBER_MCP_TOOL.LIST_WORKSPACE_MEMBERS]: { workspaces: ["members"] },
  [MEMBER_MCP_TOOL.SET_WORKSPACE_SLUG]: { workspaces: ["setSlug"] },
  [MEMBER_MCP_TOOL.RENAME_WORKSPACE]: { workspaces: ["rename"] },
  [MEMBER_MCP_TOOL.REMOVE_WORKSPACE_MEMBER]: { workspaces: ["removeMember"] },
  [MEMBER_MCP_TOOL.CHANGE_WORKSPACE_MEMBER_ROLE]: { workspaces: ["changeRole"] },
  [MEMBER_MCP_TOOL.LIST_WORKSPACE_INVITATIONS]: { workspaceInvitations: ["list"] },
  [MEMBER_MCP_TOOL.INVITE_TO_WORKSPACE]: { workspaceInvitations: ["invite"] },
  [MEMBER_MCP_TOOL.CANCEL_WORKSPACE_INVITATION]: { workspaceInvitations: ["cancel"] },
  [MEMBER_MCP_TOOL.SET_WORKSPACE_PHOTO]: { workspaces: ["setPhoto"] },
  [MEMBER_MCP_TOOL.LIST_TASKS]: { plans: ["list"], taskSections: ["list"] },
  [MEMBER_MCP_TOOL.READ_TASK]: { plans: ["open"] },
  [MEMBER_MCP_TOOL.FIND_TASK]: { plans: ["find", "open"] },
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
  [MEMBER_MCP_TOOL.UPDATE_PREFERENCES]: { account: ["writePreferences"] },
  [MEMBER_MCP_TOOL.READ_PAGE]: { taskFiles: ["pages", "page"], agentPages: ["list", "version"] },
  [MEMBER_MCP_TOOL.READ_TASK_FILE]: { taskFiles: ["file"] },
  [MEMBER_MCP_TOOL.LIST_TASK_FOLDER]: { taskFiles: ["tree"] },
  [MEMBER_MCP_TOOL.CREATE_TASK]: { plans: ["create", "editDescription"] },
  [MEMBER_MCP_TOOL.UPDATE_TASK]: { plans: ["update", "parent", "block"], taskSections: ["write"] },
  [MEMBER_MCP_TOOL.CHANGE_TASK_RELATION]: { plans: ["relation"] },
  [MEMBER_MCP_TOOL.DELETE_TASK]: { plans: ["delete"] },
  [MEMBER_MCP_TOOL.EDIT_DESCRIPTION]: { plans: ["open", "editDescription"] },
  [MEMBER_MCP_TOOL.LIST_DESCRIPTION_REVISIONS]: { plans: ["descriptionRevisions"] },
  [MEMBER_MCP_TOOL.READ_DESCRIPTION_REVISION]: { plans: ["descriptionRevision"] },
  [MEMBER_MCP_TOOL.RESTORE_DESCRIPTION_REVISION]: { plans: ["restoreDescription"] },
  [MEMBER_MCP_TOOL.CREATE_SECTION]: { taskSections: ["write"] },
  [MEMBER_MCP_TOOL.DELETE_SECTION]: { taskSections: ["write"] },
  [MEMBER_MCP_TOOL.START_AGENT]: { agents: ["start", "startFrom"], plans: ["create"] },
  [MEMBER_MCP_TOOL.MESSAGE_AGENT]: { messages: ["send", "queue"] },
  [MEMBER_MCP_TOOL.CHANGE_AGENT_QUEUE]: { messages: ["queue"] },
  [MEMBER_MCP_TOOL.STOP_AGENT]: { agents: ["stop"] },
  [MEMBER_MCP_TOOL.UPDATE_AGENT]: { agents: ["change"] },
  [MEMBER_MCP_TOOL.REWIND_AGENT]: { agents: ["rewind"] },
  [MEMBER_MCP_TOOL.DELETE_AGENT]: { agents: ["delete"] },
  [MEMBER_MCP_TOOL.WAKE_AGENT]: { agents: ["sandboxResume", "warm"] },
  [MEMBER_MCP_TOOL.LIST_AGENT_PORTS]: { agentPorts: ["list", "shared"] },
  [MEMBER_MCP_TOOL.SHARE_AGENT_PORT]: { agentPorts: ["share", "unshare"] },
  [MEMBER_MCP_TOOL.LIST_REPOSITORIES]: { github: ["repositories", "tokenRepositories"] },
  [MEMBER_MCP_TOOL.SET_TOKEN_REPOSITORY]: { github: ["setTokenRepository"] },
  [MEMBER_MCP_TOOL.READ_REPOSITORY_FILE]: { github: ["repositoryFile"] },
  [MEMBER_MCP_TOOL.LIST_REPOSITORY_FOLDER]: { github: ["repositoryTree"] },
  [MEMBER_MCP_TOOL.LIST_REPOSITORY_SKILLS]: { github: ["repositorySkills"] },
  [MEMBER_MCP_TOOL.READ_GITHUB_ISSUE]: { github: ["repositoryPullRequest", "repositoryIssue"] },
  [MEMBER_MCP_TOOL.READ_GITHUB_CONNECTION]: { github: ["connection"] },
  [MEMBER_MCP_TOOL.LIST_AGENT_BROWSER_TABS]: { agentBrowserTabs: ["agentList", "list"] },
  [MEMBER_MCP_TOOL.OPEN_AGENT_BROWSER_TAB]: { agentBrowserTabs: ["agentOpen", "open"] },
  [MEMBER_MCP_TOOL.TAKE_OVER_AGENT_BROWSER_TAB]: {
    agentBrowserTabs: ["agentTakeOver", "takeOver"],
  },
  [MEMBER_MCP_TOOL.HAND_BACK_AGENT_BROWSER_TAB]: {
    agentBrowserTabs: ["agentHandBack", "handBack"],
  },
  [MEMBER_MCP_TOOL.READ_INBOX]: { inbox: ["account", "task", "agent"] },
  [MEMBER_MCP_TOOL.ANSWER_ASK]: { inbox: ["message"] },
  [MEMBER_MCP_TOOL.ACKNOWLEDGE_THREAD]: { inbox: ["answer"] },
  [MEMBER_MCP_TOOL.REPLY_TO_THREAD]: { inbox: ["message"] },
  [MEMBER_MCP_TOOL.CLOSE_THREAD]: { inbox: ["close"] },
  [MEMBER_MCP_TOOL.MARK_THREAD_READ]: { inbox: ["markItemRead", "markItemUnread"] },
  [MEMBER_MCP_TOOL.MARK_INBOX_READ]: { inbox: ["markAllRead"] },
  // `snoozeItem` is `remindItem` under the path an older desktop still calls.
  [MEMBER_MCP_TOOL.REMIND_THREAD]: { inbox: ["remindItem", "snoozeItem"] },
  [MEMBER_MCP_TOOL.START_THREAD]: { inbox: ["start"] },
  [MEMBER_MCP_TOOL.AGENT_PULL_REQUEST_ACTION]: { agentPullRequests: ["action"] },
  [MEMBER_MCP_TOOL.READ_PULL_REQUEST]: {
    agentPullRequests: [
      "pullRequest",
      "overviewPullRequest",
      "overviewChecks",
      "overviewConversation",
      "viewed",
    ],
    agents: ["changes"],
    pullRequests: [
      "pullRequest",
      "overviewPullRequest",
      "overviewChecks",
      "overviewConversation",
      "changes",
      "viewed",
    ],
  },
  [MEMBER_MCP_TOOL.MARK_PULL_REQUEST_FILES_VIEWED]: {
    agentPullRequests: ["pullRequest", "action"],
    pullRequests: ["action"],
  },
  [MEMBER_MCP_TOOL.READ_PULL_REQUEST_CHAPTERS]: {
    agentPullRequests: ["pullRequest"],
    pullRequestChapters: ["read", "repositoryRead"],
  },
  [MEMBER_MCP_TOOL.GENERATE_PULL_REQUEST_CHAPTERS]: {
    pullRequestChapters: ["generate", "repositoryGenerate"],
  },
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
  [MEMBER_MCP_TOOL.LIST_ENVIRONMENT_VARIABLES]: { workspaceEnvironment: ["list"] },
  [MEMBER_MCP_TOOL.SET_ENVIRONMENT_VARIABLE]: { workspaceEnvironment: ["put"] },
  [MEMBER_MCP_TOOL.DELETE_ENVIRONMENT_VARIABLE]: { workspaceEnvironment: ["delete"] },
  [MEMBER_MCP_TOOL.LIST_INSTALLED_SKILLS]: { installedSkills: ["list"] },
  [MEMBER_MCP_TOOL.READ_INSTALLED_SKILL]: { installedSkills: ["read"] },
  [MEMBER_MCP_TOOL.PREVIEW_SKILL_INSTALL]: { installedSkills: ["preview"] },
  [MEMBER_MCP_TOOL.INSTALL_SKILL]: { installedSkills: ["install"] },
  [MEMBER_MCP_TOOL.REMOVE_INSTALLED_SKILL]: { installedSkills: ["remove"] },
  [MEMBER_MCP_TOOL.READ_SANDBOX_SETUP]: { workspaceSandboxSetup: ["read"] },
  [MEMBER_MCP_TOOL.EDIT_SANDBOX_SETUP]: { workspaceSandboxSetup: ["putInstall", "putRepository"] },
  // Note that a whole list is saved one action at a time, so the edit also does what a put of the list does.
  [MEMBER_MCP_TOOL.EDIT_RUN_ACTION]: { workspaceSandboxSetup: ["editRunAction", "putRunActions"] },
  [MEMBER_MCP_TOOL.RUN_ACTION]: { agents: ["runAction"] },
  [MEMBER_MCP_TOOL.STOP_RUN_ACTION]: { agents: ["stopRunAction"] },
  [MEMBER_MCP_TOOL.LIST_INTEGRATIONS]: { integrations: ["statuses", "settle"] },
  [MEMBER_MCP_TOOL.CONNECT_INTEGRATION]: { integrations: ["connect"] },
  [MEMBER_MCP_TOOL.LIST_INTEGRATION_TOOLS]: { integrations: ["tools"] },
  [MEMBER_MCP_TOOL.RENAME_INTEGRATION]: { integrations: ["rename"] },
  [MEMBER_MCP_TOOL.DISCONNECT_INTEGRATION]: { integrations: ["disconnect"] },
  [MEMBER_MCP_TOOL.LIST_MCP_CLIENTS]: { mcpClients: ["list"] },
  [MEMBER_MCP_TOOL.REVOKE_MCP_CLIENT]: { mcpClients: ["revoke"] },
  [MEMBER_MCP_TOOL.LIST_SENTRY_INSTALLATIONS]: { workspaceSentry: ["installations"] },
  [MEMBER_MCP_TOOL.DISCONNECT_SENTRY]: { workspaceSentry: ["disconnect"] },
  [MEMBER_MCP_TOOL.READ_SLACK_BOT]: { workspaceSlackBot: ["read"] },
  [MEMBER_MCP_TOOL.UPDATE_SLACK_BOT]: {
    workspaceSlackBot: ["read", "notifications", "repository", "channel"],
  },
  [MEMBER_MCP_TOOL.DISCONNECT_SLACK_BOT]: { workspaceSlackBot: ["disconnect"] },
  [MEMBER_MCP_TOOL.LIST_REPOSITORY_PINS]: { repositoryPins: ["list"] },
  [MEMBER_MCP_TOOL.PIN_REPOSITORY]: { repositoryPins: ["set"] },
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
    sound: SCREEN_ONLY,
    addSound: SCREEN_ONLY,
    renameSound: SCREEN_ONLY,
    removeSound: SCREEN_ONLY,
    chooseSound: SCREEN_ONLY,
    allowedCommands: NOT_YET_BUILT,
    // Note that an agent never widens what its member's agents run unasked; only the member does, in the app.
    addAllowedCommand: SECURITY,
    editAllowedCommand: SECURITY,
    removeAllowedCommand: NOT_YET_BUILT,
    providerKeys: SECRET,
    saveProviderKey: SECRET,
    setProviderKeyForAgents: SECRET,
    useResetCredit: SECRET,
    renameSubscription: SECRET,
    reorderSubscriptions: SECRET,
    removeProviderKey: SECRET,
    startChatGptDeviceLogin: NEEDS_BROWSER,
    pollChatGptDeviceLogin: NEEDS_BROWSER,
    cancelChatGptDeviceLogin: NEEDS_BROWSER,
  },
  admin: {
    catalog: INTERNAL,
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
  agentPages: { frame: SCREEN_ONLY },
  agents: {
    // Note that an ask is held for a person's own answer, so no agent answers one for them.
    answerApproval: SECURITY,
    // Note that Retry is the bar's press over a failed first launch, which a person reads before pressing.
    boot: SCREEN_ONLY,
    reviewOptions: SCREEN_ONLY,
    turnChanges: SCREEN_ONLY,
    workspaceTools: SCREEN_ONLY,
    // Note that a Terminal tab is interactive, so the CLI's `vespin agent shell` reaches it and no tool does.
    terminals: SCREEN_ONLY,
    openTerminal: SCREEN_ONLY,
    renameTerminal: SCREEN_ONLY,
    endTerminal: SCREEN_ONLY,
    clear: NOT_YET_BUILT,
    // A button in an agent's reply is drawn and pressed in its transcript; a member's agent starts or messages one with its own tools.
    readButton: SCREEN_ONLY,
    pressButton: SCREEN_ONLY,
  },
  dictation: { transcribe: SCREEN_ONLY },
  // A call's lines are recorded by the window holding the call, as GPT-Live hears them; a member's agent messages an agent with its own tools.
  messages: { recordVoiceLine: SCREEN_ONLY },
  events: { record: INTERNAL },
  github: {
    connect: NEEDS_BROWSER,
    claim: NEEDS_BROWSER,
    // Note that Better Auth's unlink asks a fresh session, which no OAuth token is, so it stays the app's.
    disconnect: SECURITY,
  },
  githubToken: { read: SECRET, save: SECRET, remove: SECRET },
  hosts: {
    list: INTERNAL,
    presence: INTERNAL,
    // The apps a member's machines always allow are offered in an agent's `@` list; a member's agent reads its own machine's with `computer`.
    allowedApps: SCREEN_ONLY,
    remove: INTERNAL,
    readPairing: INTERNAL,
    approvePairing: INTERNAL,
    denyPairing: INTERNAL,
  },
  inbox: {
    home: SCREEN_ONLY,
    takeBack: NOT_YET_BUILT,
  },
  integrations: {
    github: NEEDS_BROWSER,
    cancel: NEEDS_BROWSER,
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
  liveActivities: { startToken: INTERNAL, activityToken: INTERNAL, ended: INTERNAL },
  machineCommands: {
    waiting: INTERNAL,
    settle: INTERNAL,
    recording: INTERNAL,
    claim: INTERNAL,
    listening: INTERNAL,
    join: INTERNAL,
    saveDeviceSettings: INTERNAL,
    saveDeviceAppLooks: INTERNAL,
  },
  pullRequests: { reviewOptions: SCREEN_ONLY },
  pushDevices: { register: INTERNAL, unregister: INTERNAL, status: INTERNAL, notify: INTERNAL },
  // A page the member hovers, read for their own screen: an agent reads a page with its own tools.
  linkPreviews: { read: SCREEN_ONLY },
  supportAccess: { grant: SECURITY, revoke: SECURITY },
  taskFiles: {
    skills: SCREEN_ONLY,
    keepPicture: SCREEN_ONLY,
    pageFrame: SCREEN_ONLY,
  },
  taskFollowers: {
    follow: MEMBER_ONLY,
    unfollow: MEMBER_ONLY,
    setMachines: MEMBER_ONLY,
    add: MEMBER_ONLY,
    remove: MEMBER_ONLY,
  },
  workspaceGithub: { connect: NEEDS_BROWSER, disconnect: RETIRED },
  workspaceInvitations: { offer: NEEDS_BROWSER },
  workspaceMergeQueue: { read: NOT_YET_BUILT },
  workspaceSentry: { install: NEEDS_BROWSER },
  // A call's session is the panel's own, which holds the microphone and the WebRTC peer.
  voice: { open: SCREEN_ONLY },
  workspaceSlackBot: { connect: NEEDS_BROWSER },
  workspaces: {
    setExperiment: INTERNAL,
    transfer: DESTRUCTIVE,
    leave: DESTRUCTIVE,
    delete: DESTRUCTIVE,
  },
} as const satisfies MemberMcpExclusions;
