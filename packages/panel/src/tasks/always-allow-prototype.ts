/**
 * always-allow-prototype.ts -- the development-only `&aa=a|b|c` switch between the mockups of an Always allow that outlasts its session, and the fixture it stands on.
 *
 * A prototype for choosing how a rule kept by Always allow is offered,
 * shown once answered, and listed in Settings, drawn over a fixture run
 * (`?fixture=agent-pull-request` for the agent, `?fixture=settings-agents`
 * for the list):
 *
 * - `a`, each harness's own scope: a Claude Code rule kept for the
 *   repository, as Claude Code keeps it in the project's local settings,
 *   and a Codex rule kept for every repository, as Codex keeps a prefix
 *   rule under `CODEX_HOME`;
 * - `b`, one scope for both: every rule kept for the repository;
 * - `c`, the scope chosen at the press: Always allow's menu offers this
 *   agent, this repository, or every repository.
 *
 * `&aa-step=ask|answered` stages the held call waiting or answered, and
 * `&aa-harness=claude|codex` the agent's harness. With no switch the
 * window draws what ships. Note that the gate is Vite's own `DEV`, so a
 * production build never reads the address.
 */

import {
  AGENT_PERMISSION_MODE,
  type AgentPendingApproval,
} from "@repo/features/agent-approval-wire";
import { AGENT_RUNTIME, type AgentSummary } from "@repo/features/agent-wire";

/** The harnesses that ask, which the staged agent stands on. */
type AskingRuntime = NonNullable<AgentSummary["runtime"]>;

/** Which mockup the window draws. */
export const ALWAYS_ALLOW_UI = {
  CURRENT: "current",
  HARNESS: "a",
  REPOSITORY: "b",
  CHOOSE: "c",
  ACCOUNT: "d",
} as const;

export type AlwaysAllowUi = (typeof ALWAYS_ALLOW_UI)[keyof typeof ALWAYS_ALLOW_UI];

/** Where the staged call stands. */
export const ALWAYS_ALLOW_STEP = {
  ASK: "ask",
  ANSWERED: "answered",
} as const;

export type AlwaysAllowStep = (typeof ALWAYS_ALLOW_STEP)[keyof typeof ALWAYS_ALLOW_STEP];

/** The harnesses the switch stages. */
export const ALWAYS_ALLOW_HARNESS = {
  CLAUDE: "claude",
  CODEX: "codex",
} as const;

export type AlwaysAllowHarness = (typeof ALWAYS_ALLOW_HARNESS)[keyof typeof ALWAYS_ALLOW_HARNESS];

/** Where a kept rule applies. */
export const RULE_SCOPE = {
  AGENT: "agent",
  REPOSITORY: "repository",
  EVERYWHERE: "everywhere",
} as const;

export type RuleScope = (typeof RULE_SCOPE)[keyof typeof RULE_SCOPE];

/** The query parameters the switch reads. */
const PARAMETER = {
  UI: "aa",
  STEP: "aa-step",
  HARNESS: "aa-harness",
  SCOPE: "aa-scope",
  MENU: "aa-menu",
} as const;

/** Whether this is a development build, as Vite says. */
function development(): boolean {
  return (import.meta as { env?: { DEV?: boolean } }).env?.DEV === true;
}

/**
 * The address's parameters as the tab opened on them, in a development
 * build alone. Note that they are read once, as the module loads, because
 * the panel's router moves the address to its place at launch and drops them.
 */
const OPENED_ON =
  development() && typeof window !== "undefined"
    ? new URLSearchParams(window.location.search)
    : new URLSearchParams();

function pick<T extends string>(name: string, values: Record<string, T>, fallback: T): T {
  const named = OPENED_ON.get(name);
  return Object.values(values).find((each) => each === named) ?? fallback;
}

/** The mockup the address names; what ships where it names none. */
export function alwaysAllowUi(): AlwaysAllowUi {
  return pick(PARAMETER.UI, ALWAYS_ALLOW_UI, ALWAYS_ALLOW_UI.CURRENT);
}

/** Whether a mockup is drawn. */
export function mocksAlwaysAllow(): boolean {
  return alwaysAllowUi() !== ALWAYS_ALLOW_UI.CURRENT;
}

/** Where the staged call stands. */
export function alwaysAllowStep(): AlwaysAllowStep {
  return pick(PARAMETER.STEP, ALWAYS_ALLOW_STEP, ALWAYS_ALLOW_STEP.ASK);
}

/** The staged agent's harness. */
export function alwaysAllowHarness(): AlwaysAllowHarness {
  return pick(PARAMETER.HARNESS, ALWAYS_ALLOW_HARNESS, ALWAYS_ALLOW_HARNESS.CLAUDE);
}

/** The scope the answered call was kept for, under `c`. */
export function answeredScope(): RuleScope {
  return pick(PARAMETER.SCOPE, RULE_SCOPE, RULE_SCOPE.REPOSITORY);
}

/** Whether Always allow's scope menu is staged open, under `c`. */
export function scopeMenuOpen(): boolean {
  return OPENED_ON.get(PARAMETER.MENU) === "open";
}

/** The repository the fixture's agent works in. */
export const FIXTURE_REPOSITORY = "relay";

/** The staged call: `pnpm test src/members`, which both harnesses ask about in an asking mode. */
export const FIXTURE_HELD: AgentPendingApproval = {
  id: "00000000-0000-4000-8000-0000000000a1",
  toolUseId: "fixture-always-allow-test",
  toolName: "bash",
  title: "Run pnpm test src/members",
  description: "Run the members tests",
  input: { command: "pnpm test src/members", description: "Run the members tests" },
  askedAt: Date.parse("2026-10-07T16:47:00Z"),
};

/** The rule each harness suggests for the staged call, in its own terms. */
export const SUGGESTED_RULE = {
  [ALWAYS_ALLOW_HARNESS.CLAUDE]: "pnpm test *",
  [ALWAYS_ALLOW_HARNESS.CODEX]: "pnpm test",
} as const satisfies Record<AlwaysAllowHarness, string>;

/** The runtime the fixture's agent stands on, by the staged harness. */
export function fixtureRuntime(): AskingRuntime {
  return alwaysAllowHarness() === ALWAYS_ALLOW_HARNESS.CODEX
    ? AGENT_RUNTIME.CODEX
    : AGENT_RUNTIME.CLAUDE_CODE;
}

/** What the fixture's agent carries under a mockup: its harness, an asking mode, and the held call while it waits. */
export function fixtureAgentFields(): {
  runtime: AskingRuntime;
  permissionMode: typeof AGENT_PERMISSION_MODE.ASK;
  pendingApprovals: readonly AgentPendingApproval[];
  runStartedAt: number;
  model: string;
} {
  const codex = alwaysAllowHarness() === ALWAYS_ALLOW_HARNESS.CODEX;
  return {
    runtime: fixtureRuntime(),
    permissionMode: AGENT_PERMISSION_MODE.ASK,
    pendingApprovals: [FIXTURE_HELD],
    // Note that the run started moments ago, so the working line counts minutes rather than the weeks since the fixture's day.
    runStartedAt: Date.now() - 6 * 60 * 1000,
    model: codex ? "openai/gpt-6.1-sol" : "anthropic/claude-opus-5.5",
  };
}

/** One kept rule as the Settings list draws it. */
export interface KeptRule {
  readonly id: string;
  readonly harness: AlwaysAllowHarness;
  /** What it lets through, as its harness's rule names it. */
  readonly rule: string;
  /** What kind of call it lets through. */
  readonly says: string;
  readonly scope: RuleScope;
  /** The repository it applies in, where its scope is one. */
  readonly repository?: string;
  readonly addedAt: number;
  /** The agent whose Always allow kept it. */
  readonly from: string;
}

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.now();

/** The command prefixes the fixture's member keeps under `d`, one list for every harness and repository. */
const ACCOUNT_RULES: readonly KeptRule[] = [
  ["a1", "pnpm test", 2 * 60 * 60 * 1000, "Add teammate invitations", ALWAYS_ALLOW_HARNESS.CLAUDE],
  ["a2", "gh pr view", DAY, "Send the weekly digest", ALWAYS_ALLOW_HARNESS.CODEX],
  ["a3", "pnpm db:generate", 3 * DAY, "Build teammate invitations", ALWAYS_ALLOW_HARNESS.CLAUDE],
  ["a4", "cargo test", 9 * DAY, "Usage alerts", ALWAYS_ALLOW_HARNESS.CODEX],
].map(([id, rule, ago, from, harness]) => ({
  id: id as string,
  harness: harness as AlwaysAllowHarness,
  rule: rule as string,
  says: "Commands that start with",
  scope: RULE_SCOPE.EVERYWHERE,
  addedAt: NOW - (ago as number),
  from: from as string,
}));

/** The rules the fixture's member keeps, in each mockup's scopes. */
export function keptRules(ui: AlwaysAllowUi): readonly KeptRule[] {
  if (ui === ALWAYS_ALLOW_UI.ACCOUNT) return ACCOUNT_RULES;
  const codexScope = ui === ALWAYS_ALLOW_UI.HARNESS ? RULE_SCOPE.EVERYWHERE : RULE_SCOPE.REPOSITORY;
  const codexRepository = ui === ALWAYS_ALLOW_UI.HARNESS ? undefined : { repository: "relay" };
  return [
    {
      id: "r1",
      harness: ALWAYS_ALLOW_HARNESS.CLAUDE,
      rule: "pnpm test *",
      says: "Command",
      scope: RULE_SCOPE.REPOSITORY,
      repository: "relay",
      addedAt: NOW - 2 * 60 * 60 * 1000,
      from: "Add teammate invitations",
    },
    {
      id: "r2",
      harness: ALWAYS_ALLOW_HARNESS.CLAUDE,
      rule: "pnpm db:generate *",
      says: "Command",
      scope: RULE_SCOPE.REPOSITORY,
      repository: "relay",
      addedAt: NOW - 3 * DAY,
      from: "Build teammate invitations",
    },
    {
      id: "r3",
      harness: ALWAYS_ALLOW_HARNESS.CLAUDE,
      rule: "docs.stripe.com",
      says: "Web fetch",
      // Note that under `c` this one was kept for every repository, so the list shows a choice made.
      ...(ui === ALWAYS_ALLOW_UI.CHOOSE
        ? { scope: RULE_SCOPE.EVERYWHERE }
        : { scope: RULE_SCOPE.REPOSITORY, repository: "ledger" }),
      addedAt: NOW - 6 * DAY,
      from: "Fix ledger rounding",
    },
    {
      id: "r4",
      harness: ALWAYS_ALLOW_HARNESS.CODEX,
      rule: "gh pr view",
      says: "Command prefix",
      scope: codexScope,
      ...codexRepository,
      addedAt: NOW - 1 * DAY,
      from: "Send the weekly digest",
    },
    {
      id: "r5",
      harness: ALWAYS_ALLOW_HARNESS.CODEX,
      rule: "cargo test",
      says: "Command prefix",
      scope: codexScope,
      ...codexRepository,
      addedAt: NOW - 9 * DAY,
      from: "Usage alerts",
    },
  ];
}
