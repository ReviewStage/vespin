/**
 * admin-catalog.ts -- the admin catalog: the coding agent's tools, the prompts, the service's own limits, and the turn pipeline, measured from the modules that hold them.
 *
 * It reads no database and counts no use: every figure is the running
 * deploy's code, so the answer says what an agent is offered, never what it
 * called. The coding agent's instructions are built as a sandbox agent on a
 * repository is handed them, with a placeholder repository and task and
 * every workspace experiment off, so their size is the template's and no
 * member's. Only prompts a module exports are listed; the title writer's
 * and the replay summary's stay private to their modules.
 */

import { RUNNER_HEARTBEAT, RUNNER_RECONNECT } from "@repo/agent-runner/protocol";
import {
  ADMIN_LIMIT_UNIT,
  ADMIN_TOOL_LOADING,
  ADMIN_TURN_PIPELINE,
  type AdminCatalog,
  type AdminCatalogLimit,
  type AdminCatalogPrompt,
  type AdminCatalogTool,
  type AdminPromptSection,
  type AdminTurnPipeline,
} from "@repo/features/admin-catalog-wire";
import { AGENT_BRIEF } from "@repo/features/agent-wire";
import { SANDBOX_IDLE } from "@repo/sandbox";
import { Clock, Duration, Effect, Option } from "effect";
import { AGENT_WAKEUP } from "../agents/coder-host/agent-wakeup-bounds.js";
import { CODER } from "../agents/coder-host/bounds.js";
import {
  CODER_HARNESS,
  type CoderHarness,
  coderInstructions,
} from "../agents/coder-host/instructions.js";
import { REPLAY_FIT } from "../agents/coder-host/replay-summary.js";
import { TURN_DELIVERY } from "../agents/coder-host/turn-delivery-bounds.js";
import { WAKEUP_DELAY } from "../agents/coder-host/wakeup-tool.js";
import { SANDBOX_RELEASE } from "../agents/sandbox-release-bounds.js";
import { TOOL_CATALOG } from "../agents/tool-catalog/catalog.js";
import { type AgentStanding, TOOL_GATE } from "../agents/tool-catalog/gates.js";
import { DEPLOYMENT_ENVIRONMENT } from "../auth/auth-deployment.js";
import { CHAPTERS_BOUNDS } from "../chapters/chapters-generator.js";
import { CHAPTERS_INSTRUCTIONS, REPAIR_INSTRUCTIONS } from "../chapters/chapters-prompt.js";
import { MAINTENANCE_SWEEP } from "../maintenance/maintenance-bounds.js";

/** The repository and task the instructions are built for, which stand in for any member's. */
const PLACEHOLDER_REPOSITORY = "acme/app";

const PLACEHOLDER_TASK = {
  link: "https://vespin.dev/acme/task/1",
  id: "00000000-0000-4000-8000-000000000000",
} as const;

/**
 * A sandbox agent on a repository in a workspace with Task descriptions on,
 * the settings' default, and every other gated experiment off. Note that it
 * names no agent's row, because the instructions read the gates it opens alone.
 */
const PLACEHOLDER_STANDING: AgentStanding = {
  agent: Option.none(),
  open: new Set([TOOL_GATE.REPOSITORY, TOOL_GATE.SANDBOX, TOOL_GATE.DESCRIPTIONS]),
  experiments: {
    descriptionsOn: true,
    memoryOn: false,
    turnEndOn: false,
    replyButtonsOn: false,
    computerUseOn: false,
  },
};

const HEADING_MARK = "## ";

/** How far a schema's levels are indented where it is printed for reading; its size is measured unprinted. */
const SCHEMA_INDENT = 2;

/** The environments whose turns ride Vercel Queues, as `turn-delivery.ts` decides it. */
const QUEUED_ENVIRONMENTS: ReadonlySet<string> = new Set([
  DEPLOYMENT_ENVIRONMENT.PRODUCTION,
  DEPLOYMENT_ENVIRONMENT.PREVIEW,
]);

const HARNESS_LABEL = {
  [CODER_HARNESS.CLAUDE_CODE]: "Coding agent instructions, Claude Code",
  [CODER_HARNESS.CODEX]: "Coding agent instructions, Codex",
} as const satisfies Record<CoderHarness, string>;

const ms = (duration: Duration.Duration) => Duration.toMillis(duration);

const span = (
  group: string,
  label: string,
  constant: string,
  value: number,
): AdminCatalogLimit => ({
  group,
  label,
  constant,
  unit: ADMIN_LIMIT_UNIT.DURATION_MS,
  value,
});

const count = (
  group: string,
  label: string,
  constant: string,
  value: number,
): AdminCatalogLimit => ({
  group,
  label,
  constant,
  unit: ADMIN_LIMIT_UNIT.COUNT,
  value,
});

const SECOND_MS = 1000;

/** The limits only the service holds, grouped as the Limits page draws them. */
function serviceLimits(): AdminCatalogLimit[] {
  const runners = "Runners";
  const sandboxes = "Sandboxes";
  const queues = "Queues and the sweep";
  const models = "Model calls";

  return [
    span(runners, "Lease on a runner", "CODER.RUNNER_LEASE.HOLD", ms(CODER.RUNNER_LEASE.HOLD)),
    span(runners, "Wait for a held lease", "CODER.RUNNER_LEASE.WAIT", ms(CODER.RUNNER_LEASE.WAIT)),
    span(runners, "A Mac runner kept warm", "CODER.RUNNER_WARM", ms(CODER.RUNNER_WARM)),
    span(runners, "Runner heartbeat", "RUNNER_HEARTBEAT.EVERY_MS", RUNNER_HEARTBEAT.EVERY_MS),
    span(
      runners,
      "Reconnect gives up after",
      "RUNNER_RECONNECT.GIVE_UP_MS",
      RUNNER_RECONNECT.GIVE_UP_MS,
    ),
    span(sandboxes, "Idle sandbox stops after", "SANDBOX_IDLE", ms(SANDBOX_IDLE)),
    span(
      sandboxes,
      "Unused sandbox released after",
      "SANDBOX_RELEASE.UNUSED_FOR",
      ms(SANDBOX_RELEASE.UNUSED_FOR),
    ),
    count(
      sandboxes,
      "Sandboxes released a sweep",
      "SANDBOX_RELEASE.SWEEP_LIMIT",
      SANDBOX_RELEASE.SWEEP_LIMIT,
    ),
    span(
      queues,
      "Shortest wakeup",
      "WAKEUP_DELAY.MIN_SECONDS",
      WAKEUP_DELAY.MIN_SECONDS * SECOND_MS,
    ),
    span(
      queues,
      "Longest wakeup",
      "WAKEUP_DELAY.MAX_SECONDS",
      WAKEUP_DELAY.MAX_SECONDS * SECOND_MS,
    ),
    span(
      queues,
      "A wakeup kept past due",
      "AGENT_WAKEUP.RETAINED_PAST_DUE",
      ms(AGENT_WAKEUP.RETAINED_PAST_DUE),
    ),
    span(queues, "A queued turn kept for", "TURN_DELIVERY.RETENTION", ms(TURN_DELIVERY.RETENTION)),
    span(
      queues,
      "Turn function's longest run",
      "TURN_DELIVERY.MAX_DURATION_SECONDS",
      TURN_DELIVERY.MAX_DURATION_SECONDS * SECOND_MS,
    ),
    span(
      queues,
      "Sweep's longest run",
      "MAINTENANCE_SWEEP.MAX_DURATION_SECONDS",
      MAINTENANCE_SWEEP.MAX_DURATION_SECONDS * SECOND_MS,
    ),
    span(models, "Agent title", "CODER.TITLE_TIMEOUT", ms(CODER.TITLE_TIMEOUT)),
    span(models, "Pull request chapters", "CHAPTERS_BOUNDS.TIMEOUT", ms(CHAPTERS_BOUNDS.TIMEOUT)),
    count(
      models,
      "Chapters' output tokens",
      "CHAPTERS_BOUNDS.MAX_OUTPUT_TOKENS",
      CHAPTERS_BOUNDS.MAX_OUTPUT_TOKENS,
    ),
    count(
      models,
      "Replay summary's output tokens",
      "REPLAY_FIT.SUMMARY_OUTPUT_TOKENS",
      REPLAY_FIT.SUMMARY_OUTPUT_TOKENS,
    ),
  ];
}

/** A prompt's `## ` sections, the text before its first heading standing first under none. */
function sectionsOf(text: string): AdminPromptSection[] {
  const sections: AdminPromptSection[] = [];

  let heading: string | null = null;
  let chars = 0;

  for (const line of text.split("\n")) {
    if (line.startsWith(HEADING_MARK)) {
      if (heading !== null || chars > 0) sections.push({ heading, chars });
      heading = line.slice(HEADING_MARK.length).trim();
      chars = 0;
    }

    chars += line.length + 1;
  }

  // Note that the last line carries no newline of its own, so the sections add up to the text.
  sections.push({ heading, chars: Math.max(0, chars - 1) });

  return sections;
}

function prompt(label: string, source: string, text: string): AdminCatalogPrompt {
  return { label, source, chars: text.length, sections: sectionsOf(text), text };
}

function prompts(): AdminCatalogPrompt[] {
  const instructions = Object.values(CODER_HARNESS).map((harness) =>
    prompt(
      HARNESS_LABEL[harness],
      "coderInstructions",
      coderInstructions(
        PLACEHOLDER_REPOSITORY,
        AGENT_BRIEF.DESCRIPTION,
        PLACEHOLDER_TASK,
        PLACEHOLDER_STANDING,
        undefined,
        null,
        false,
        harness,
      ),
    ),
  );

  return [
    ...instructions,
    prompt("Pull request chapters", "CHAPTERS_INSTRUCTIONS", CHAPTERS_INSTRUCTIONS),
    prompt("Chapters repair", "REPAIR_INSTRUCTIONS", REPAIR_INSTRUCTIONS),
  ];
}

function tools(): AdminCatalogTool[] {
  return [...TOOL_CATALOG.values()].map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: JSON.stringify(tool.inputSchema, null, SCHEMA_INDENT),
    definitionChars: tool.description.length + JSON.stringify(tool.inputSchema).length,
    loading: tool.alwaysLoad ? ADMIN_TOOL_LOADING.FIRST_TURN : ADMIN_TOOL_LOADING.SEARCH,
    gate: tool.gate ?? null,
  }));
}

/** The queue this deployment's turns ride, as its `VERCEL_ENV` decides it; undefined runs them in process. */
function turnPipelineOf(environment: string | undefined): AdminTurnPipeline {
  return environment !== undefined && QUEUED_ENVIRONMENTS.has(environment)
    ? ADMIN_TURN_PIPELINE.VERCEL_QUEUES
    : ADMIN_TURN_PIPELINE.IN_PROCESS;
}

/** The catalog as this deploy's code holds it, stamped `now`, its pipeline the one `environment` picks. */
export function buildAdminCatalog(now: number, environment: string | undefined): AdminCatalog {
  return {
    generatedAt: now,
    tools: tools(),
    prompts: prompts(),
    limits: serviceLimits(),
    pipeline: turnPipelineOf(environment),
  };
}

export interface AdminCatalogOptions {
  /** The catalog stamped at the instant given, read from the deploy's code alone. */
  readCatalog: (now: number) => Effect.Effect<AdminCatalog>;
}

/** The catalog read, which takes no query and is refused nothing past the gate. */
export function handleAdminCatalog(options: AdminCatalogOptions): Effect.Effect<AdminCatalog> {
  return Effect.flatMap(Clock.currentTimeMillis, options.readCatalog);
}
