/**
 * automation.ts -- `vespin automation list`, `view`, `create`, `update`, `run`, and `delete`: the workspace's automations, one read whole with its newest runs, one made or changed, one run now, and one deleted.
 *
 * Each goes through the procedures the app's automations page sends
 * (`automations.*`), so who may change, run, or delete which, whether a
 * schedule reads, and whether a repository is reached are the service's to
 * refuse. A trigger is named by `--cron`, `--github`, or `--sentry`, or
 * whole as JSON with `--trigger`, decoded by the wire's own schema. A
 * webhook trigger is never made or set here, as the member MCP server
 * makes none: its secret is shown once, in the window that minted it
 * (`AGENTS.md`), and stdout is no such window. A change to the prompt or
 * the model keeps the rest of the action as it stands, read first.
 */

import { randomUUID } from "node:crypto";
import {
  AUTOMATION_ACTION,
  AUTOMATION_SCOPE,
  AUTOMATION_TRIGGER,
  type AutomationRunSummary,
  type AutomationSummary,
  type AutomationTrigger,
  automationTriggerSchema,
  GITHUB_TRIGGER_EVENT,
} from "@repo/features/automation-wire";
import { CLI_EXIT } from "@repo/features/cli-exit";
import { SENTRY_TRIGGER_EVENT, TRIGGER_PROVIDER } from "@repo/features/trigger-catalog";
import { Effect, Option, Schema } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { answer, CommandFailed, columns, readInput } from "../output.js";
import { askService, session } from "../session.js";
import { resolveTaskId } from "../tasks.js";
import { resolveWorkspace } from "../workspace.js";

/** Why a webhook trigger is refused here. */
const WEBHOOK_REFUSAL =
  "A webhook trigger is made only on the automations page in the app, which shows its secret once.";

const automationArgument = Argument.String("automation").pipe(
  Argument.withDescription("The automation's id, as automation list prints it"),
);

/** The flags that name a trigger, one way at most. */
const TRIGGER_FLAGS = {
  cron: Flag.String("cron").pipe(
    Flag.optional,
    Flag.withDescription("Fire on a five-field cron schedule, such as '0 9 * * 1'"),
  ),
  timezone: Flag.String("timezone").pipe(
    Flag.optional,
    Flag.withDescription("The IANA time zone --cron is read in (default: this machine's)"),
  ),
  github: Flag.Literals("github", Object.values(GITHUB_TRIGGER_EVENT)).pipe(
    Flag.optional,
    Flag.withDescription("Fire on a GitHub event of the automation's repositories"),
  ),
  label: Flag.String("label").pipe(
    Flag.atLeast(0),
    Flag.withDescription("With --github: only events with this label; repeat for more"),
  ),
  branch: Flag.String("branch").pipe(
    Flag.atLeast(0),
    Flag.withDescription("With --github: only events on this branch; repeat for more"),
  ),
  sentry: Flag.Literals("sentry", Object.values(SENTRY_TRIGGER_EVENT)).pipe(
    Flag.optional,
    Flag.withDescription("Fire on an event of the workspace's Sentry integration"),
  ),
  trigger: Flag.String("trigger").pipe(
    Flag.optional,
    Flag.withDescription("The whole trigger as JSON, for what the flags above do not name"),
  ),
};

/** The flags that name what a run starts and where. */
const ACTION_FLAGS = {
  prompt: Flag.String("prompt").pipe(
    Flag.optional,
    Flag.withDescription("Each run's prompt, from a file or - for stdin"),
  ),
  model: Flag.String("model").pipe(
    Flag.optional,
    Flag.withDescription("The model runs take, by its catalog id, with --effort"),
  ),
  effort: Flag.String("effort").pipe(
    Flag.optional,
    Flag.withDescription("The reasoning effort, with --model"),
  ),
  repository: Flag.String("repository").pipe(
    Flag.withAlias("R"),
    Flag.atLeast(0),
    Flag.withDescription("owner/name a run works in, the first where it starts; repeat for more"),
  ),
  scope: Flag.Literals("scope", Object.values(AUTOMATION_SCOPE)).pipe(
    Flag.optional,
    Flag.withDescription("Yours alone (personal) or the workspace's"),
  ),
};

/** What the trigger flags parsed to. */
interface TriggerFlags {
  readonly cron: Option.Option<string>;
  readonly timezone: Option.Option<string>;
  readonly github: Option.Option<(typeof GITHUB_TRIGGER_EVENT)[keyof typeof GITHUB_TRIGGER_EVENT]>;
  readonly label: readonly string[];
  readonly branch: readonly string[];
  readonly sentry: Option.Option<(typeof SENTRY_TRIGGER_EVENT)[keyof typeof SENTRY_TRIGGER_EVENT]>;
  readonly trigger: Option.Option<string>;
}

/** A usage failure in the words given. */
function usage(message: string): CommandFailed {
  return new CommandFailed({ exit: CLI_EXIT.USAGE, message });
}

/** The trigger the flags name, none where they name none, or why they do not read. */
const triggerOf = Effect.fnUntraced(function* (flags: TriggerFlags) {
  const named = [flags.cron, flags.github, flags.sentry, flags.trigger].filter(Option.isSome);
  if (named.length > 1) {
    return yield* usage("Name one trigger: --cron, --github, --sentry, or --trigger.");
  }
  if (Option.isSome(flags.cron)) {
    const timezone = Option.getOrElse(
      flags.timezone,
      () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    );
    return Option.some<AutomationTrigger>({
      kind: AUTOMATION_TRIGGER.SCHEDULE,
      cron: flags.cron.value,
      timezone,
    });
  }
  if (Option.isSome(flags.github)) {
    return Option.some<AutomationTrigger>({
      kind: AUTOMATION_TRIGGER.GITHUB,
      event: flags.github.value,
      ...(flags.label.length === 0 ? undefined : { labels: flags.label }),
      ...(flags.branch.length === 0 ? undefined : { branches: flags.branch }),
    });
  }
  if (Option.isSome(flags.sentry)) {
    return Option.some<AutomationTrigger>({
      kind: AUTOMATION_TRIGGER.INTEGRATION,
      provider: TRIGGER_PROVIDER.SENTRY,
      event: flags.sentry.value,
    });
  }
  if (Option.isNone(flags.trigger)) return Option.none<AutomationTrigger>();
  const decoded = Schema.decodeUnknownOption(Schema.fromJsonString(automationTriggerSchema))(
    flags.trigger.value,
  );
  if (Option.isNone(decoded)) return yield* usage("--trigger is no trigger as JSON.");
  if (decoded.value.kind === AUTOMATION_TRIGGER.WEBHOOK) return yield* usage(WEBHOOK_REFUSAL);
  return decoded;
});

/** The model and effort named, both or neither, or why not. */
const choiceOf = Effect.fnUntraced(function* (
  model: Option.Option<string>,
  effort: Option.Option<string>,
) {
  if (Option.isSome(model) !== Option.isSome(effort)) {
    return yield* usage("Name --model and --effort together (vespin models lists them).");
  }
  return Option.isSome(model) && Option.isSome(effort)
    ? Option.some({ model: model.value, effort: effort.value })
    : Option.none();
});

/** A trigger in brief, as a list prints it. */
function triggerWords(trigger: AutomationTrigger): string {
  switch (trigger.kind) {
    case AUTOMATION_TRIGGER.SCHEDULE:
      return `${trigger.cron} (${trigger.timezone})`;
    case AUTOMATION_TRIGGER.GITHUB:
      return `github ${trigger.event}`;
    case AUTOMATION_TRIGGER.WEBHOOK:
      return "webhook";
    case AUTOMATION_TRIGGER.INTEGRATION:
      return `${trigger.provider} ${trigger.event}`;
  }
}

/** An automation's summary line: its id, whether it is on, its trigger, and its name. */
function automationRow(automation: AutomationSummary): string[] {
  return [
    automation.id,
    automation.enabled ? "on" : "off",
    triggerWords(automation.trigger),
    automation.name,
  ];
}

/** A run's row: when it fired, where it stands and why, and the agent it started. */
function runRow(run: AutomationRunSummary): string[] {
  return [
    new Date(run.firedAt).toISOString(),
    run.reason === null ? run.status : `${run.status} (${run.reason})`,
    run.agent === null ? "" : `agent ${run.agent.id}`,
  ];
}

/** An automation read whole, as a person reads it. */
function automationLines(
  automation: AutomationSummary,
  runs: readonly AutomationRunSummary[],
): string[] {
  const { action } = automation;
  return [
    `${automation.name}  [${automation.enabled ? "on" : "off"}]  ${automation.id}`,
    `Trigger: ${triggerWords(automation.trigger)}`,
    ...(action.choice === undefined
      ? []
      : [`Model: ${action.choice.model} (${action.choice.effort})`]),
    ...(automation.repositories === undefined || automation.repositories.length === 0
      ? []
      : [`Repositories: ${automation.repositories.join(", ")}`]),
    ...(automation.nextRunAt === null
      ? []
      : [`Next run: ${new Date(automation.nextRunAt).toISOString()}`]),
    "",
    ...action.prompt.split("\n").map((line) => `  ${line}`),
    "",
    ...(runs.length === 0 ? ["No runs."] : ["Runs:", ...columns(runs.map(runRow))]),
  ];
}

/** An automation a write left, as each reader takes it. */
function written(automation: AutomationSummary, line: string) {
  return answer({ json: { automation }, lines: [line], ids: [automation.id] });
}

const listCommand = Command.make(
  "list",
  {
    task: Flag.String("task").pipe(
      Flag.optional,
      Flag.withDescription("Only the automations made on this task, by its id, number, or key"),
    ),
  },
  ({ task }) =>
    Effect.gen(function* () {
      const { hosted } = yield* session;
      const query = Option.isSome(task)
        ? { planId: yield* resolveTaskId(task.value) }
        : { workspaceId: (yield* resolveWorkspace).workspace.id };
      const { automations } = yield* askService(hosted.automations.list, query);
      yield* answer({
        json: { automations },
        lines:
          automations.length === 0 ? ["No automations."] : columns(automations.map(automationRow)),
        ids: automations.map(({ id }) => id),
      });
    }),
).pipe(
  Command.withDescription("List the workspace's automations you may read, newest first"),
  Command.withExamples([
    { command: "vespin automation list", description: "Every automation of the workspace" },
  ]),
);

const viewCommand = Command.make("view", { automation: automationArgument }, ({ automation }) =>
  Effect.gen(function* () {
    const { hosted } = yield* session;
    const read = yield* askService(hosted.automations.read, { id: automation });
    const { runs } = yield* askService(hosted.automations.runs, { id: automation });
    yield* answer({
      json: { automation: read.automation, runs },
      lines: automationLines(read.automation, runs),
      ids: [read.automation.id],
    });
  }),
).pipe(
  Command.withDescription("Show an automation: its trigger, prompt, and newest runs"),
  Command.withExamples([
    { command: "vespin automation view <automation>", description: "Read one whole" },
  ]),
);

const createCommand = Command.make(
  "create",
  {
    name: Argument.String("name").pipe(Argument.withDescription("The automation's name")),
    task: Flag.String("task").pipe(
      Flag.optional,
      Flag.withDescription(
        "Make it on a task, whose repository it takes, by its id, number, or key",
      ),
    ),
    ...TRIGGER_FLAGS,
    ...ACTION_FLAGS,
  },
  ({ name, task, prompt, model, effort, repository, scope, ...flags }) =>
    Effect.gen(function* () {
      const trigger = yield* triggerOf(flags);
      if (Option.isNone(trigger)) {
        return yield* usage("Name a trigger: --cron, --github, --sentry, or --trigger.");
      }
      if (Option.isNone(prompt)) return yield* usage("Give each run's prompt with --prompt.");
      const choice = yield* choiceOf(model, effort);
      const words = (yield* readInput(prompt.value)).trim();
      const { hosted } = yield* session;
      const where = Option.isSome(task)
        ? { planId: yield* resolveTaskId(task.value) }
        : { workspaceId: (yield* resolveWorkspace).workspace.id };
      const made = yield* askService(hosted.automations.create, {
        ...where,
        name,
        trigger: trigger.value,
        action: {
          kind: AUTOMATION_ACTION.AGENT,
          prompt: words,
          ...(Option.isSome(choice) ? { choice: choice.value } : undefined),
        },
        ...(repository.length === 0 ? undefined : { repositories: repository }),
        ...(Option.isSome(scope) ? { scope: scope.value } : undefined),
      });
      yield* written(made.automation, `Made automation ${made.automation.id}.`);
    }),
).pipe(
  Command.withDescription(
    "Make an automation that starts an agent on its prompt each time it fires",
  ),
  Command.withExamples([
    {
      command:
        "echo 'Triage the new issues.' | vespin automation create Triage --cron '0 9 * * 1-5' -R acme/app --prompt -",
      description: "Every weekday at nine",
    },
    {
      command:
        "vespin automation create Review --github pull-request-updated -R acme/app --prompt review.md",
      description: "On each pull request ready for review",
    },
  ]),
);

const updateCommand = Command.make(
  "update",
  {
    automation: automationArgument,
    name: Flag.String("name").pipe(Flag.optional, Flag.withDescription("Its new name")),
    enable: Flag.Boolean("enable").pipe(Flag.withDefault(false), Flag.withDescription("Resume it")),
    disable: Flag.Boolean("disable").pipe(
      Flag.withDefault(false),
      Flag.withDescription("Pause it"),
    ),
    ...TRIGGER_FLAGS,
    ...ACTION_FLAGS,
  },
  ({ automation, name, enable, disable, prompt, model, effort, repository, scope, ...flags }) =>
    Effect.gen(function* () {
      if (enable && disable) return yield* usage("Name --enable or --disable, not both.");
      const trigger = yield* triggerOf(flags);
      const choice = yield* choiceOf(model, effort);
      const words = Option.isSome(prompt)
        ? Option.some((yield* readInput(prompt.value)).trim())
        : Option.none<string>();
      const { hosted } = yield* session;
      // Note that an action is changed whole, so the one standing is read for what is not named.
      const action =
        Option.isSome(words) || Option.isSome(choice)
          ? {
              ...(yield* askService(hosted.automations.read, { id: automation })).automation.action,
              ...(Option.isSome(words) ? { prompt: words.value } : undefined),
              ...(Option.isSome(choice) ? { choice: choice.value } : undefined),
            }
          : undefined;
      const body = {
        ...(Option.isSome(name) ? { name: name.value } : undefined),
        ...(enable || disable ? { enabled: enable } : undefined),
        ...(Option.isSome(trigger) ? { trigger: trigger.value } : undefined),
        ...(action === undefined ? undefined : { action }),
        ...(repository.length === 0 ? undefined : { repositories: repository }),
        ...(Option.isSome(scope) ? { scope: scope.value } : undefined),
      };
      if (Object.keys(body).length === 0) return yield* usage("Name something to change.");
      const changed = yield* askService(hosted.automations.change, {
        params: { id: automation },
        body,
      });
      yield* written(changed.automation, `Changed automation ${changed.automation.id}.`);
    }),
).pipe(
  Command.withDescription("Change an automation: what you leave out stands"),
  Command.withExamples([
    { command: "vespin automation update <automation> --disable", description: "Pause it" },
    {
      command: "vespin automation update <automation> --cron '0 8 * * 1'",
      description: "Move its schedule",
    },
  ]),
);

const runCommand = Command.make("run", { automation: automationArgument }, ({ automation }) =>
  Effect.gen(function* () {
    const { hosted } = yield* session;
    const ran = yield* askService(hosted.automations.run, {
      params: { id: automation },
      body: { idempotencyKey: randomUUID() },
    });
    const { run } = ran.body;
    yield* answer({
      json: { run },
      lines: [
        run.agent === null
          ? `Run ${run.id} ${run.status}${run.reason === null ? "" : ` (${run.reason})`}.`
          : `Run ${run.id} started agent ${run.agent.id}.`,
      ],
      ids: run.agent === null ? [] : [run.agent.id],
    });
  }),
).pipe(
  Command.withDescription("Run an automation now, through the guards a firing takes"),
  Command.withExamples([
    {
      command: "vespin agent wait $(vespin automation run <automation> -q)",
      description: "Run it and wait on the agent it starts",
    },
  ]),
);

const deleteCommand = Command.make("delete", { automation: automationArgument }, ({ automation }) =>
  Effect.gen(function* () {
    const { hosted } = yield* session;
    yield* askService(hosted.automations.remove, { id: automation });
    yield* answer({
      json: { deleted: automation },
      lines: [`Deleted automation ${automation}.`],
      ids: [automation],
    });
  }),
).pipe(
  Command.withDescription("Delete an automation and its runs' history; the agents it started stay"),
  Command.withExamples([
    { command: "vespin automation delete <automation>", description: "Delete one" },
  ]),
);

export const automationCommand = Command.make("automation").pipe(
  Command.withDescription("Make, change, and run automations that start agents on a trigger"),
  Command.withSubcommands([
    listCommand,
    viewCommand,
    createCommand,
    updateCommand,
    runCommand,
    deleteCommand,
  ]),
  Command.withExamples([
    { command: "vespin automation list", description: "The workspace's automations" },
  ]),
);
