/**
 * preferences.ts -- `vespin preferences` and `vespin preferences set`: the signed-in member's own preferences, their coding agents' default model, effort, and context window.
 *
 * The read is `account.preferences`, its coding-agent part decoded as
 * `vespin models` decodes it; the change is one `account.writePreferences`
 * naming that part alone, which the service checks as Settings' own write
 * (a choice the member is not offered, or one no credential of theirs pays
 * for, is refused) and answers with the snapshot as it then stands.
 */

import { HOSTED_API_ERROR } from "@repo/features";
import { CONTEXT_WINDOW } from "@repo/features/agent-wire";
import { CLI_EXIT } from "@repo/features/cli-exit";
import { type ModelChoice, modelChoiceSchema } from "@repo/features/models-wire";
import { Effect, Option, Schema } from "effect";
import { Command, Flag } from "effect/cli";
import { answer, CommandFailed } from "../output.js";
import { askService, session } from "../session.js";

const readModelChoice = Schema.decodeUnknownOption(modelChoiceSchema);

/** The coding-agent default a snapshot carries, as the answer prints it, or a failure where the service answered none that reads as one. */
const defaultOf = Effect.fnUntraced(function* (read: Option.Option<ModelChoice>) {
  if (Option.isSome(read)) return read.value;

  return yield* new CommandFailed({
    exit: CLI_EXIT.UNAVAILABLE,
    message: "The service did not answer with a default model.",
  });
});

/** The default's answer: JSON with the choice, a line a person reads, and the model's id. */
const answerDefault = Effect.fnUntraced(function* (choice: typeof modelChoiceSchema.Type) {
  const window = choice.contextWindow ?? CONTEXT_WINDOW.STANDARD;
  yield* answer({
    json: { default: choice },
    lines: [`Default: ${choice.model}  effort: ${choice.effort}  context window: ${window}`],
    ids: [choice.model],
  });
});

const setCommand = Command.make(
  "set",
  {
    model: Flag.String("model").pipe(
      Flag.withDescription("The default model, by its catalog id (vespin models lists them)"),
    ),
    effort: Flag.String("effort").pipe(
      Flag.withDescription("The default reasoning effort, as the model lists it"),
    ),
    contextWindow: Flag.Literals("context-window", Object.values(CONTEXT_WINDOW)).pipe(
      Flag.optional,
      Flag.withDescription("The default context window (default: standard)"),
    ),
  },
  ({ model, effort, contextWindow }) =>
    Effect.gen(function* () {
      const { hosted } = yield* session;

      const written = yield* askService(
        hosted.account.writePreferences,
        {
          agent: {
            model,
            effort,
            ...(Option.isSome(contextWindow) ? { contextWindow: contextWindow.value } : undefined),
          },
        },
        undefined,
        {
          [HOSTED_API_ERROR.INVALID_REQUEST]:
            "You are not offered that model and effort, or no credential of yours pays for that model; vespin models lists the choices.",
        },
      );

      yield* answerDefault(yield* defaultOf(readModelChoice(written.agent)));
    }),
).pipe(
  Command.withDescription(
    "Set the model, effort, and context window your agents start on where a start names none",
  ),
  Command.withExamples([
    {
      command: "vespin preferences set --model anthropic/claude-opus-5.5 --effort high",
      description: "Start agents on Opus at high effort by default",
    },
  ]),
);

/** The preferences group: the read itself, and set. */
export const preferencesCommand = Command.make("preferences", {}, () =>
  Effect.gen(function* () {
    const { hosted } = yield* session;
    const preferences = yield* askService(hosted.account.preferences, undefined);
    yield* answerDefault(yield* defaultOf(readModelChoice(preferences.agent)));
  }),
).pipe(
  Command.withDescription("Show your preferences: the model and effort your agents start on"),
  Command.withSubcommands([setCommand]),
  Command.withExamples([
    { command: "vespin preferences", description: "Your default model and effort" },
  ]),
);
