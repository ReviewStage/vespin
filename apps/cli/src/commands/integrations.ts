/**
 * integrations.ts -- `vespin integrations list|connect|tools|rename|disconnect`: the account's own integrations, as Settings › Integrations reads, begins, lists the tools of, names, and ends them.
 *
 * Every command is a procedure of the hosted contract
 * (`contract/integrations.ts`), and an account is named by its connection
 * name as `list` prints it (`notion`, `notion-2`), which the wire's own
 * parser reads for its provider (`integrationConnectionOf`). `connect`
 * never signs in: it prints the address the service answers, and opens it
 * in the browser where stdout is a terminal, so the person finishes the
 * sign-in there; `list` reads where it then stands. `tools` reads the
 * tools one account's server offers the account's agents, or why it
 * listed none. No answer carries a token.
 */

import { HOSTED_API_ERROR } from "@repo/features";
import { CLI_EXIT } from "@repo/features/cli-exit";
import {
  INTEGRATION_GRANT,
  INTEGRATION_GRANT_OF,
  INTEGRATION_NAME,
  INTEGRATION_PROVIDER_LIST,
  INTEGRATION_QUERY,
  INTEGRATION_TOOLS_PROBLEM,
  type IntegrationProvider,
  integrationAccountInput,
  integrationAccountLabel,
  integrationAccountSchema,
  integrationConnectionOf,
} from "@repo/features/integration-wire";
import { Effect, Option, Schema, Stdio } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { openInBrowser } from "../browser.js";
import { answer, CommandFailed, columns, confirmOrYes, note } from "../output.js";
import { askService, session } from "../session.js";

/** The words a refusal of one account is told in. */
const ACCOUNT_REFUSAL = {
  [HOSTED_API_ERROR.NOT_FOUND]:
    "You hold no such account. vespin integrations list names yours by their connection.",
  [HOSTED_API_ERROR.UNAVAILABLE]:
    "That integration is not offered to you here, it holds as many accounts as it takes, it is GitHub, whose sign-in is your own, or it could not be reached just now.",
} as const;

/** The words a refusal of a tools read is told in: an account not connected among them, which connecting again mends. */
const TOOLS_REFUSAL = {
  [HOSTED_API_ERROR.NOT_FOUND]: ACCOUNT_REFUSAL[HOSTED_API_ERROR.NOT_FOUND],
  [HOSTED_API_ERROR.UNAVAILABLE]:
    "That integration is not offered to you here, the account is not connected (vespin integrations connect signs it in), or it could not be reached just now.",
} as const;

const decodeAccount = Schema.decodeUnknownOption(integrationAccountSchema);

/** The provider a connection name is an account at, or a usage failure where it names none. */
function accountOf(connection: string) {
  const named = integrationConnectionOf(connection);

  return named === undefined
    ? Effect.fail(
        new CommandFailed({
          exit: CLI_EXIT.USAGE,
          message: `${connection} is no connection name. vespin integrations list names yours, such as notion or notion-2.`,
        }),
      )
    : Effect.succeed(named.provider);
}

const connectionArgument = Argument.String("connection").pipe(
  Argument.withDescription("The account, by its connection name as list prints it, such as notion"),
);

const listCommand = Command.make("list", {}, () =>
  Effect.gen(function* () {
    const { hosted } = yield* session;
    const read = yield* askService(hosted.integrations.statuses, undefined);

    // Note that each account is read on its own, so one this build does not know hides none of the others.
    const accounts = (read.accounts ?? []).flatMap((account) =>
      Option.toArray(decodeAccount(account)),
    );

    yield* answer({
      json: { ...read, accounts },
      lines:
        accounts.length === 0
          ? ["No integration connected. vespin integrations connect <provider> begins one."]
          : columns(
              accounts.map((account) => [
                account.connection,
                account.status,
                `${INTEGRATION_NAME[account.provider]}: ${integrationAccountLabel(account)}`,
              ]),
            ),
      ids: accounts.map(({ connection }) => connection),
    });
  }),
).pipe(
  Command.withDescription("List your integrations' accounts, each by its connection name"),
  Command.withExamples([
    { command: "vespin integrations list", description: "Your accounts and where each stands" },
  ]),
);

const connectCommand = Command.make(
  "connect",
  {
    provider: Argument.Literals("provider", INTEGRATION_PROVIDER_LIST).pipe(
      Argument.withDescription("The provider to sign in to, such as notion or linear"),
    ),
    account: Flag.String("account").pipe(
      Flag.optional,
      Flag.withDescription("An account you hold, by its connection name, to sign it in again"),
    ),
    add: Flag.Boolean("add").pipe(
      Flag.withDefault(false),
      Flag.withDescription("Sign in another account at the provider, where it takes more than one"),
    ),
    noBrowser: Flag.Boolean("no-browser").pipe(
      Flag.withDefault(false),
      Flag.withDescription("Print the link without opening it"),
    ),
  },
  ({ provider, account, add, noBrowser }) =>
    Effect.gen(function* () {
      const { hosted } = yield* session;
      const connection = Option.getOrUndefined(account);

      if (connection !== undefined && (yield* accountOf(connection)) !== provider) {
        return yield* new CommandFailed({
          exit: CLI_EXIT.USAGE,
          message: `${connection} is no account at ${INTEGRATION_NAME[provider]}.`,
        });
      }

      const begun = yield* askService(
        hosted.integrations.connect,
        integrationAccountInput(provider, { connection, add }),
        undefined,
        ACCOUNT_REFUSAL,
      );

      const stdio = yield* Stdio.Stdio;
      const opens = !noBrowser && (yield* stdio.stdoutIsTerminal);

      if (opens) openInBrowser(begun.url);
      yield* note(
        `${opens ? "Opening" : "Open"} this link in your browser to sign in to ${INTEGRATION_NAME[provider]}; vespin integrations list reads where it stands after.`,
      );
      yield* answer({
        json: { provider, url: begun.url, connection: begun.connection },
        lines: [begun.url],
        ids: [begun.url],
      });
    }),
).pipe(
  Command.withDescription("Begin connecting an integration: prints the link to sign in at"),
  Command.withExamples([
    { command: "vespin integrations connect notion", description: "Sign in to Notion" },
    {
      command: "vespin integrations connect notion --add",
      description: "Sign in a second Notion account",
    },
  ]),
);

const toolsCommand = Command.make("tools", { connection: connectionArgument }, ({ connection }) =>
  Effect.gen(function* () {
    const provider = yield* accountOf(connection);
    const { hosted } = yield* session;

    const read = yield* askService(
      hosted.integrations.tools,
      { provider, [INTEGRATION_QUERY.CONNECTION]: connection },
      undefined,
      TOOLS_REFUSAL,
    );

    // Note that a server that listed none is an answer, why, rather than a failure.
    if ("problem" in read) {
      const said = read.problem.message === undefined ? "" : `: ${read.problem.message}`;

      // Only a refused grant is mended by signing in again, and GitHub's grant is the account's own sign-in.
      const mends =
        read.problem.reason === INTEGRATION_TOOLS_PROBLEM.REFUSED &&
        INTEGRATION_GRANT_OF[provider] === INTEGRATION_GRANT.CONNECT;

      const hint = mends
        ? ` vespin integrations connect ${provider} --account ${connection} signs it in again.`
        : "";

      return yield* answer({
        json: { connection, problem: read.problem },
        lines: [
          `${INTEGRATION_NAME[provider]}'s server listed no tools (${read.problem.reason}${said}).${hint}`,
        ],
        ids: [],
      });
    }

    yield* answer({
      json: { connection, tools: read.tools },
      lines:
        read.tools.length === 0
          ? [`${INTEGRATION_NAME[provider]}'s server offers no tools.`]
          : columns(read.tools.map((tool) => [tool.name, tool.description.split("\n")[0] ?? ""])),
      ids: read.tools.map(({ name }) => name),
    });
  }),
).pipe(
  Command.withDescription("List the tools one of your integration accounts offers your agents"),
  Command.withExamples([
    { command: "vespin integrations tools notion", description: "Notion's tools, by name" },
  ]),
);

const renameCommand = Command.make(
  "rename",
  {
    connection: connectionArgument,
    label: Argument.String("label").pipe(Argument.withDescription("What you call the account")),
  },
  ({ connection, label }) =>
    Effect.gen(function* () {
      const provider = yield* accountOf(connection);
      const { hosted } = yield* session;

      const renamed = yield* askService(
        hosted.integrations.rename,
        { ...integrationAccountInput(provider, { connection }), body: { label } },
        undefined,
        ACCOUNT_REFUSAL,
      );

      yield* answer({
        json: { account: renamed.account },
        lines: [`Renamed ${connection} ${integrationAccountLabel(renamed.account)}.`],
        ids: [connection],
      });
    }),
).pipe(
  Command.withDescription("Rename one of your integration accounts"),
  Command.withExamples([
    {
      command: 'vespin integrations rename notion-2 "Acme wiki"',
      description: "Name your second Notion account",
    },
  ]),
);

const disconnectCommand = Command.make(
  "disconnect",
  {
    connection: connectionArgument,
    yes: Flag.Boolean("yes").pipe(
      Flag.withAlias("y"),
      Flag.withDefault(false),
      Flag.withDescription("Disconnect without asking; required where stdin is no terminal"),
    ),
  },
  ({ connection, yes }) =>
    Effect.gen(function* () {
      const provider: IntegrationProvider = yield* accountOf(connection);
      yield* confirmOrYes(
        `Disconnect ${connection} from ${INTEGRATION_NAME[provider]}? Your agents lose its tools.`,
        yes,
      );
      const { hosted } = yield* session;

      const ended = yield* askService(
        hosted.integrations.disconnect,
        integrationAccountInput(provider, { connection }),
        undefined,
        ACCOUNT_REFUSAL,
      );

      yield* answer({
        json: { connection, status: ended.status },
        lines: [`Disconnected ${connection}.`],
        ids: [connection],
      });
    }),
).pipe(
  Command.withDescription("Disconnect one of your integration accounts and revoke its grant"),
  Command.withExamples([
    { command: "vespin integrations disconnect notion-2", description: "After you confirm" },
    { command: "vespin integrations disconnect notion-2 --yes", description: "From a script" },
  ]),
);

export const integrationsCommand = Command.make("integrations").pipe(
  Command.withDescription(
    "List, connect, rename, and disconnect your integrations, and list their tools",
  ),
  Command.withSubcommands([
    listCommand,
    connectCommand,
    toolsCommand,
    renameCommand,
    disconnectCommand,
  ]),
  Command.withExamples([
    { command: "vespin integrations list", description: "Your accounts and where each stands" },
  ]),
);
