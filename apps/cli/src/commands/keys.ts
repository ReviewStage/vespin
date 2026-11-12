/**
 * keys.ts -- `vespin keys list`, `set`, `remove`, and `for-agents`: the signed-in member's own Anthropic and OpenAI keys and plans, which pay for their coding agents.
 *
 * A key is a secret, so it only ever goes in: `set` reads it from stdin
 * (`readSecret`), never from an argument a shell keeps in its history, and
 * no answer carries it back. The service's answer names a key's hint, its
 * first and last characters, and this command prints not even that: `list`
 * names each provider, whether it holds a key or a plan, and each one's
 * status and id. Each command is one `account` procedure
 * (`@repo/features/provider-key-wire`), whose answer is the account's keys
 * as they then stand. A plan is the provider's subscription credential, a
 * Claude setup-token or a ChatGPT sign-in; a ChatGPT plan connects through
 * its device login in the app alone, so `set --plan` takes a Claude one.
 */

import { CLI_EXIT } from "@repo/features/cli-exit";
import {
  PROVIDER_KEY_KIND,
  PROVIDER_KEY_PROVIDER,
  PROVIDER_KEY_REJECTION,
  type ProviderKeyProvider,
  type ProviderKeyRejection,
  type ProviderKeysAnswer,
  pastedKeyFits,
} from "@repo/features/provider-key-wire";
import { Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { answer, CommandFailed, columns, confirmOrYes, note, readSecret } from "../output.js";
import { askService, session } from "../session.js";

/** Each provider's plan, the one subscription kind it takes. */
const PLAN_KIND = {
  [PROVIDER_KEY_PROVIDER.ANTHROPIC]: PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN,
  [PROVIDER_KEY_PROVIDER.OPENAI]: PROVIDER_KEY_KIND.CHATGPT_OAUTH,
} as const satisfies Record<ProviderKeyProvider, string>;

/** How each provider's key and plan are named in a sentence. */
const PROVIDER_WORDS = {
  [PROVIDER_KEY_PROVIDER.ANTHROPIC]: { key: "Anthropic API key", plan: "Claude plan" },
  [PROVIDER_KEY_PROVIDER.OPENAI]: { key: "OpenAI API key", plan: "ChatGPT plan" },
} as const satisfies Record<ProviderKeyProvider, { key: string; plan: string }>;

/** The word for on and off that `for-agents` takes. */
const SWITCH = { ON: "on", OFF: "off" } as const;

/** Why a save kept nothing, in the words a person reads; never the provider's, which may quote the key. */
function rejectionWords(provider: ProviderKeyProvider, plan: boolean, why: ProviderKeyRejection) {
  const name = plan ? PROVIDER_WORDS[provider].plan : PROVIDER_WORDS[provider].key;

  switch (why) {
    case PROVIDER_KEY_REJECTION.INVALID:
      return plan
        ? "That is not a Claude setup-token. Run claude setup-token and pipe in what it prints."
        : `The provider did not accept this ${name}. Nothing was saved.`;
    case PROVIDER_KEY_REJECTION.WRONG_PROVIDER:
      return `This is not an ${name}; it looks like the other provider's. Nothing was saved.`;
    case PROVIDER_KEY_REJECTION.UNREACHABLE:
      return `The provider could not be reached to check this ${name}. Try again.`;
    case PROVIDER_KEY_REJECTION.TOO_MANY_TRIES:
      return "Too many keys tried in the last hour. Try again later.";
  }
}

/** One stored key or plan as every answer prints it: what it is and how it stands, never the key or its hint. */
interface Credential {
  readonly kind: string;
  readonly id: string | null;
  readonly status: string;
  readonly label: string | null;
  readonly forAgents: boolean | null;
}

/** The account's keys and plans by provider, each provider listed whether it holds any or not. */
function providersJson(keys: ProviderKeysAnswer) {
  return Object.values(PROVIDER_KEY_PROVIDER).map((provider) => {
    const credentials: Credential[] = [
      ...keys.keys
        .filter((key) => key.provider === provider)
        .map((key) => ({
          kind: PROVIDER_KEY_KIND.API_KEY,
          id: key.id ?? null,
          status: key.status,
          label: key.label ?? null,
          forAgents: null,
        })),
      ...(keys.subscriptions ?? [])
        .filter((plan) => plan.provider === provider)
        .map((plan) => ({
          kind: plan.kind,
          id: plan.id,
          status: plan.status,
          label: plan.label ?? null,
          // Note that a service predating the default answers none, which reads as on.
          forAgents: plan.forAgents ?? true,
        })),
    ];

    return { provider, set: credentials.length > 0, credentials };
  });
}

/** The lines a person reads of the account's keys: each provider, then each key and plan under it. */
function providersLines(providers: ReturnType<typeof providersJson>): string[] {
  return providers.flatMap(({ provider, set, credentials }) => [
    `${provider}  ${set ? "set" : "not set"}`,
    ...columns(
      credentials.map((credential) => [
        " ",
        credential.kind,
        credential.status,
        credential.forAgents === true ? "for agents" : "",
        credential.id ?? "",
        credential.label ?? "",
      ]),
    ),
  ]);
}

/** The account's keys as an answer: the providers, with the ids of those that hold any for `-q`. */
function keysAnswer(keys: ProviderKeysAnswer, lines?: readonly string[]) {
  const providers = providersJson(keys);

  return answer({
    json: { providers },
    lines: lines ?? providersLines(providers),
    ids: providers.filter(({ set }) => set).map(({ provider }) => provider),
  });
}

/** Whether the account holds the provider's key (or plan), the one an id names where it names one. */
function holds(
  keys: ProviderKeysAnswer,
  provider: ProviderKeyProvider,
  plan: boolean,
  id: string | undefined,
) {
  const credentials = providersJson(keys).find((row) => row.provider === provider)?.credentials;
  const kind = plan ? PLAN_KIND[provider] : PROVIDER_KEY_KIND.API_KEY;

  return (credentials ?? []).some(
    (credential) => credential.kind === kind && (id === undefined || credential.id === id),
  );
}

/** A usage failure naming the key or plan the account does not hold. */
function notHeld(provider: ProviderKeyProvider, plan: boolean, id: string | undefined) {
  const name = plan ? PROVIDER_WORDS[provider].plan : PROVIDER_WORDS[provider].key;

  return new CommandFailed({
    exit: CLI_EXIT.REFUSED,
    message:
      id === undefined
        ? `No ${name} is set. vespin keys list shows what is.`
        : `No ${name} has the id ${id}. vespin keys list shows the ids.`,
  });
}

const providerArgument = Argument.Literals("provider", Object.values(PROVIDER_KEY_PROVIDER)).pipe(
  Argument.withDescription("anthropic or openai"),
);

const planFlag = Flag.Boolean("plan").pipe(
  Flag.withDefault(false),
  Flag.withDescription(
    "The provider's plan (a Claude setup-token or a ChatGPT sign-in), not its API key",
  ),
);

const idFlag = Flag.String("id").pipe(
  Flag.optional,
  Flag.withDescription(
    "Which one, by the id keys list prints, where several are set (default: the first)",
  ),
);

const listCommand = Command.make("list", {}, () =>
  Effect.gen(function* () {
    const { hosted } = yield* session;
    const keys = yield* askService(hosted.account.providerKeys, undefined);
    yield* keysAnswer(keys);
  }),
).pipe(
  Command.withDescription(
    "List each provider, whether a key or plan of yours is set, and each one's status; never a key",
  ),
  Command.withExamples([
    { command: "vespin keys list", description: "Your keys and plans" },
    { command: "vespin keys list -q", description: "The providers with a key or plan set" },
  ]),
);

const setCommand = Command.make(
  "set",
  { provider: providerArgument, plan: planFlag },
  ({ provider, plan }) =>
    Effect.gen(function* () {
      if (plan && provider !== PROVIDER_KEY_PROVIDER.ANTHROPIC) {
        return yield* new CommandFailed({
          exit: CLI_EXIT.USAGE,
          message:
            "A ChatGPT plan connects through its sign-in in the app's Settings, never a pasted key.",
        });
      }

      const name = plan ? PROVIDER_WORDS[provider].plan : PROVIDER_WORDS[provider].key;

      const key = yield* readSecret(
        plan ? "Paste what claude setup-token printed:" : `Paste your ${name}:`,
      );

      if (!pastedKeyFits(key)) {
        return yield* new CommandFailed({
          exit: CLI_EXIT.USAGE,
          message: `That is too short or too long to be an ${name}. Nothing was saved.`,
        });
      }

      const { hosted } = yield* session;

      const saved = yield* askService(hosted.account.saveProviderKey, {
        provider,
        key,
        ...(plan ? { kind: PLAN_KIND[provider] } : undefined),
      });

      if (saved.rejected !== undefined) {
        return yield* new CommandFailed({
          exit: CLI_EXIT.REFUSED,
          message: rejectionWords(provider, plan, saved.rejected),
        });
      }

      yield* keysAnswer(saved, [plan ? `Saved your ${name}.` : `Added your ${name}.`]);
    }),
).pipe(
  Command.withDescription(
    "Save a key from stdin, checked with the provider first; --plan saves a Claude setup-token instead",
  ),
  Command.withExamples([
    {
      command: "vespin keys set anthropic",
      description: "Paste an Anthropic API key at the prompt",
    },
    {
      command: "pbpaste | vespin keys set openai",
      description: "An OpenAI API key from the clipboard",
    },
    {
      command: "pbpaste | vespin keys set anthropic --plan",
      description:
        "Your Claude plan, as claude setup-token printed it, for coding agents to run on",
    },
  ]),
);

const removeCommand = Command.make(
  "remove",
  {
    provider: providerArgument,
    plan: planFlag,
    id: idFlag,
    yes: Flag.Boolean("yes").pipe(
      Flag.withAlias("y"),
      Flag.withDefault(false),
      Flag.withDescription("Remove without asking; required where stdin is no terminal"),
    ),
  },
  ({ provider, plan, id, yes }) =>
    Effect.gen(function* () {
      const { hosted } = yield* session;
      const named = Option.getOrUndefined(id);
      const before = yield* askService(hosted.account.providerKeys, undefined);

      if (!holds(before, provider, plan, named)) return yield* notHeld(provider, plan, named);
      const name = plan ? PROVIDER_WORDS[provider].plan : PROVIDER_WORDS[provider].key;
      yield* confirmOrYes(`Remove your ${name}? Agents it pays for stop running on it.`, yes);

      const removed = yield* askService(hosted.account.removeProviderKey, {
        query: {
          provider,
          ...(plan ? { kind: PLAN_KIND[provider] } : undefined),
          ...(named === undefined ? undefined : { subscriptionId: named }),
        },
      });

      if (removed.revocationUnconfirmed === true) {
        yield* note(
          "OpenAI did not confirm the sign-in revoked; disconnect the app in ChatGPT's settings to end it there.",
        );
      }

      yield* keysAnswer(removed, [`Removed your ${name}.`]);
    }),
).pipe(
  Command.withDescription("Remove a key or plan of yours; asks first, or takes --yes"),
  Command.withExamples([
    { command: "vespin keys remove openai", description: "Remove your OpenAI API key" },
    {
      command: "vespin keys remove anthropic --plan --yes",
      description: "Disconnect your Claude plan, from a script",
    },
  ]),
);

const forAgentsCommand = Command.make(
  "for-agents",
  {
    provider: providerArgument,
    turned: Argument.Literals("on|off", Object.values(SWITCH)).pipe(
      Argument.withDescription(
        "on to pay for your coding agents with the plan by default, off not to",
      ),
    ),
    id: idFlag,
  },
  ({ provider, turned, id }) =>
    Effect.gen(function* () {
      const { hosted } = yield* session;
      const named = Option.getOrUndefined(id);

      const set = yield* askService(hosted.account.setProviderKeyForAgents, {
        provider,
        kind: PLAN_KIND[provider],
        forAgents: turned === SWITCH.ON,
        ...(named === undefined ? undefined : { subscriptionId: named }),
      });

      // Note that a plan the account does not hold changes nothing, and the answer shows it absent.
      if (!holds(set, provider, true, named)) return yield* notHeld(provider, true, named);
      const name = PROVIDER_WORDS[provider].plan;
      yield* keysAnswer(set, [
        turned === SWITCH.ON
          ? `Your coding agents run on your ${name} unless you pick another when you start one.`
          : `Your coding agents no longer run on your ${name} unless you pick it when you start one.`,
      ]);
    }),
).pipe(
  Command.withDescription(
    "Turn whether your plan pays for your coding agents by default on or off",
  ),
  Command.withExamples([
    {
      command: "vespin keys for-agents anthropic on",
      description: "Run agents on your Claude plan",
    },
    { command: "vespin keys for-agents openai off", description: "Stop defaulting to ChatGPT" },
  ]),
);

/** The keys group: list, set, remove, and for-agents. */
export const keysCommand = Command.make("keys").pipe(
  Command.withDescription(
    "Your own Anthropic and OpenAI keys and plans: list them, set one from stdin, remove one",
  ),
  Command.withSubcommands([listCommand, setCommand, removeCommand, forAgentsCommand]),
  Command.withExamples([
    { command: "vespin keys list", description: "Which keys and plans are set" },
  ]),
);
