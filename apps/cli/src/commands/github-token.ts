/**
 * github-token.ts -- `vespin github token show`, `set`, and `remove`: the signed-in member's own classic GitHub personal access token.
 *
 * A token is a secret, so it only ever goes in: `set` reads it from stdin
 * (`readSecret`), never from an argument a shell keeps in its history, and
 * no answer carries it back. The service's answer names the token's hint,
 * its prefix and last four characters, and this command prints not even
 * that: `show` names the GitHub login it belongs to, its status, and when it
 * expires. Each command is one `githubToken` procedure
 * (`@repo/features/github-token-wire`), whose answer is the token as it then
 * stands.
 */

import { CLI_EXIT } from "@repo/features/cli-exit";
import {
  GITHUB_TOKEN_CREATE_URL,
  GITHUB_TOKEN_REJECTION,
  type GitHubTokenAnswer,
  type GitHubTokenRejection,
  pastedTokenFits,
} from "@repo/features/github-token-wire";
import { Effect } from "effect";
import { Command, Flag } from "effect/cli";
import { answer, CommandFailed, confirmOrYes, readSecret } from "../output.js";
import { askService, session } from "../session.js";

/** Why a save kept nothing, in the words a person reads. */
const REJECTION_WORDS = {
  [GITHUB_TOKEN_REJECTION.FINE_GRAINED]: `That is a fine-grained token, and only a classic one is taken. Create one: ${GITHUB_TOKEN_CREATE_URL}`,
  [GITHUB_TOKEN_REJECTION.INVALID]: "GitHub did not accept this token. Nothing was saved.",
  [GITHUB_TOKEN_REJECTION.NO_REPO_SCOPE]: `This token lacks the repo scope. Create one with repo ticked: ${GITHUB_TOKEN_CREATE_URL}`,
  [GITHUB_TOKEN_REJECTION.UNREACHABLE]:
    "GitHub could not be reached to check this token. Try again.",
  [GITHUB_TOKEN_REJECTION.TOO_MANY_TRIES]:
    "Too many tokens tried in the last hour. Try again later.",
} as const satisfies Record<GitHubTokenRejection, string>;

/** The token as every answer prints it: whose it is and how it stands, never the token or its hint. */
function tokenJson(answered: GitHubTokenAnswer) {
  const { token } = answered;
  if (token === null) return { set: false } as const;
  return {
    set: true,
    login: token.login,
    status: token.status,
    addedAt: new Date(token.addedAt).toISOString(),
    expiresAt: token.expiresAt === null ? null : new Date(token.expiresAt).toISOString(),
  } as const;
}

/** The token as an answer, its login for `-q`, with the lines a person reads in place of the default where given. */
function tokenAnswer(answered: GitHubTokenAnswer, lines?: readonly string[]) {
  const found = tokenJson(answered);
  return answer({
    json: found,
    lines:
      lines ??
      (found.set
        ? [
            `${found.login}  ${found.status}  ${found.expiresAt === null ? "no expiry" : `expires ${found.expiresAt}`}`,
          ]
        : ["No GitHub token is set."]),
    ids: found.set ? [found.login] : [],
  });
}

const showCommand = Command.make("show", {}, () =>
  Effect.gen(function* () {
    const { hosted } = yield* session;
    yield* tokenAnswer(yield* askService(hosted.githubToken.read, undefined));
  }),
).pipe(
  Command.withDescription(
    "Whether your GitHub token is set: the login it belongs to, its status, and its expiry",
  ),
  Command.withExamples([
    { command: "vespin github token show", description: "Your token's state" },
  ]),
);

const setCommand = Command.make("set", {}, () =>
  Effect.gen(function* () {
    const token = yield* readSecret("Paste your classic GitHub token:");
    if (!pastedTokenFits(token)) {
      return yield* new CommandFailed({
        exit: CLI_EXIT.USAGE,
        message: "That is not shaped like a GitHub token. Nothing was saved.",
      });
    }
    const { hosted } = yield* session;
    const saved = yield* askService(hosted.githubToken.save, { token });
    if (saved.rejected !== undefined) {
      return yield* new CommandFailed({
        exit: CLI_EXIT.REFUSED,
        message: REJECTION_WORDS[saved.rejected],
      });
    }
    const found = tokenJson(saved);
    yield* tokenAnswer(saved, [
      found.set ? `Saved your GitHub token, for ${found.login}.` : "Saved your GitHub token.",
    ]);
  }),
).pipe(
  Command.withDescription(
    "Save your classic GitHub token from stdin, replacing the one set; GitHub checks it first",
  ),
  Command.withExamples([
    { command: "vespin github token set", description: "Paste a token at the prompt" },
    { command: "pbpaste | vespin github token set", description: "A token from the clipboard" },
  ]),
);

const removeCommand = Command.make(
  "remove",
  {
    yes: Flag.Boolean("yes").pipe(
      Flag.withAlias("y"),
      Flag.withDefault(false),
      Flag.withDescription("Remove without asking; required where stdin is no terminal"),
    ),
  },
  ({ yes }) =>
    Effect.gen(function* () {
      const { hosted } = yield* session;
      const before = yield* askService(hosted.githubToken.read, undefined);
      if (before.token === null) {
        return yield* new CommandFailed({
          exit: CLI_EXIT.REFUSED,
          message: "No GitHub token is set.",
        });
      }
      yield* confirmOrYes(`Remove your GitHub token for ${before.token.login}?`, yes);
      const removed = yield* askService(hosted.githubToken.remove, undefined);
      yield* tokenAnswer(removed, ["Removed your GitHub token."]);
    }),
).pipe(
  Command.withDescription("Remove your GitHub token; asks first, or takes --yes"),
  Command.withExamples([
    { command: "vespin github token remove --yes", description: "Remove it from a script" },
  ]),
);

/** The token group under `vespin github`: show, set, and remove. */
export const githubTokenCommand = Command.make("token").pipe(
  Command.withDescription(
    "Your own classic GitHub token: show whose it is, set one from stdin, remove it",
  ),
  Command.withSubcommands([showCommand, setCommand, removeCommand]),
  Command.withExamples([
    { command: "vespin github token show", description: "Whether one is set" },
  ]),
);
