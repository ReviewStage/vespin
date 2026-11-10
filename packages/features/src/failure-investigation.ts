/**
 * failure-investigation.ts -- what an agent started on a failure the app showed is handed: the task's name and a prompt holding the failure, where it was shown, the build and platform it was shown on, and the open route, asking it to find the cause and fix it.
 *
 * Investigate stands beside a failure's Copy details for a team working on
 * the product's own repository (`INVESTIGATION_REPOSITORY`), so a failure
 * met while working with the app becomes a task on its own code. What the
 * agent is handed is what Copy details copies (`shownFailureDetails`), which
 * names no word a person wrote, and beside it the cause's stack as an issue
 * sends it (`shownFailureStack`), the app's version, build, platform, and
 * the route's pattern, which names no value. Every part read from text
 * passes the credential redaction (`credential-redaction.ts`): the details
 * and the stack as they are read, and the build's branch here. Note that the
 * route's path is left out, because on the web it is whatever address was
 * typed, and that the prompt is not redacted whole, because
 * the redaction takes any run of 32 characters for a credential, which would
 * take the ids, the Sentry event and trace, and the commit the agent needs.
 */

import { redactCredentials } from "./credential-redaction.js";
import { PRODUCT_NAME } from "./product-name.js";
import { type ShownFailureReport, shownFailureCode, shownFailureStack } from "./shown-failure.js";

/** The product's own repository, whose workspace's members are offered Investigate and whose task it starts. */
export const INVESTIGATION_REPOSITORY = "ReviewStage/vespin";

/** The GitHub account the product's own repository stands under, which a workspace's installation must be on to reach it. */
export const INVESTIGATION_OWNER = "ReviewStage";

/** How long a task's name may be, as the service keeps one (`TASK_BOUNDS.MAX_NAME_CHARS`). */
const NAME_BOUND = 200;

/** The build a failure was shown in, as the run names its commit. */
export interface InvestigatedBuild {
  readonly sha: string;
  readonly dirty: boolean;
  readonly branch?: string | undefined;
}

/** Where in the window a failure was shown: the pattern of the route that stood, as `/$workspace/task/$taskId`. */
export interface InvestigatedRoute {
  readonly pattern: string;
}

/** What an investigation is handed beside the failure's report: its copied details, and the run and window it was shown in. */
export interface FailureInvestigationContext {
  /** What Copy details copies of the failure (`shownFailureDetails`). */
  readonly details: string;
  /** The app's platform as the run names it (`RUN_PLATFORM`), or another desktop's. */
  readonly platform: string;
  readonly version?: string | undefined;
  readonly build?: InvestigatedBuild | undefined;
  /** Whether the run is a packaged release rather than a development build. */
  readonly packaged: boolean;
  readonly route?: InvestigatedRoute | undefined;
}

/** What an investigation starts: the task's name and its agent's prompt. */
export interface FailureInvestigation {
  readonly name: string;
  readonly prompt: string;
}

/** The platforms a run names that the prompt calls by name: the desktop app on a Mac, and the web app. */
export const RUN_PLATFORM = {
  MAC: "darwin",
  WEB: "web",
} as const;

export type RunPlatform = (typeof RUN_PLATFORM)[keyof typeof RUN_PLATFORM];

/** What each platform a run names is called in the prompt. */
const PLATFORM_WORDS: Readonly<Record<string, string>> = {
  [RUN_PLATFORM.MAC]: "macOS desktop app",
  [RUN_PLATFORM.WEB]: "web app",
} satisfies Record<RunPlatform, string>;

/** What the run's platform is called in the prompt, or the desktop app on the platform it names. */
function platformWords(platform: string): string {
  return PLATFORM_WORDS[platform] ?? `desktop app (${platform})`;
}

/** The build line: its version, release or development, and its commit where the run names one. */
function buildWords(context: FailureInvestigationContext): string {
  const version = context.version ?? "unknown version";
  const kind = context.packaged ? "release" : "development build";
  const { build } = context;
  if (build === undefined) return `${version} (${kind})`;
  const branch = build.branch === undefined ? "" : ` on ${redactCredentials(build.branch)}`;
  const dirty = build.dirty ? ", with uncommitted changes" : "";
  return `${version} (${kind}, commit ${build.sha}${branch}${dirty})`;
}

/**
 * The task and prompt an agent investigating `report` is started with: the
 * failure, where it was shown, the run and route, and what to do, each part
 * read from text with its credential-shaped runs replaced.
 */
export function failureInvestigation(
  report: ShownFailureReport,
  context: FailureInvestigationContext,
): FailureInvestigation {
  const code = shownFailureCode(report);
  const stack = shownFailureStack(report);
  const act = report.act === undefined ? "" : `, answering the act \`${report.act}\``;
  const route = context.route === undefined ? "unknown" : `\`${context.route.pattern}\``;
  const prompt = [
    `A member of our team pressed Investigate on an error ${PRODUCT_NAME} showed them. Find its cause, fix it, and open a pull request.`,
    "",
    "## The error",
    "",
    "```",
    context.details,
    "```",
    ...(stack === undefined ? [] : ["", "## Stack", "", "```", stack, "```"]),
    "",
    "## Where it was shown",
    "",
    `- Surface: \`${report.surface}\` (\`FAILURE_SURFACE\` in \`packages/features/src/shown-failure.ts\`)${act}`,
    `- Platform: ${platformWords(context.platform)}`,
    `- Version: ${buildWords(context)}`,
    `- Route: ${route}`,
    "",
    "## What to do",
    "",
    "1. Find the code that shows this failure on that surface, and trace it back to what failed.",
    "2. Where Sentry is connected, look up the event or trace above for its breadcrumbs and the service's log lines.",
    "3. Fix the cause, with the one test that reproduces it as `AGENTS.md` asks, and open a pull request.",
    "4. Where the cause is outside the product (the network, GitHub, or a provider), say so and open no pull request.",
  ].join("\n");
  const name = `Investigate ${report.surface}: ${code}`;
  return { name: name.length > NAME_BOUND ? name.slice(0, NAME_BOUND) : name, prompt };
}
