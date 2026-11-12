/**
 * pr-viewed.ts -- `vespin pr viewed`: files of any pull request marked viewed, or unmarked, on GitHub as you, as GitHub's own Viewed box does.
 *
 * The pull request is named as `vespin pr view` names it, a repository's or
 * an agent's. Each path is one change through `pullRequests.action`, or
 * `agentPullRequests.action` for an agent's, made in turn on your own
 * GitHub sign-in, and the command stops at the first GitHub did
 * not take, saying which were marked before it. `vespin pr view --stat`
 * reads the marks back.
 */

import { CLI_EXIT } from "@repo/features/cli-exit";
import { PRODUCT_NAME } from "@repo/features/product-name";
import {
  PULL_REQUEST_ACTION,
  PULL_REQUEST_WRITE_OUTCOME,
} from "@repo/features/pull-request-write-wire";
import { Effect } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { answer, CommandFailed } from "../output.js";
import { askService, session } from "../session.js";
import { agentNumberFlag, NAMED_BY, pullRequestArgument, pullRequestNamed } from "./pr-view.js";

export const viewedCommand = Command.make(
  "viewed",
  {
    pr: pullRequestArgument,
    number: agentNumberFlag,
    paths: Argument.String("path").pipe(
      Argument.atLeast(1),
      Argument.withDescription("The files, by their paths from the repository's root"),
    ),
    unmark: Flag.Boolean("unmark").pipe(
      Flag.withDefault(false),
      Flag.withDescription("Unmark them instead"),
    ),
  },
  ({ pr, number, paths, unmark }) =>
    Effect.gen(function* () {
      const { hosted } = yield* session;
      const named = yield* pullRequestNamed(pr, number);

      const action = unmark
        ? PULL_REQUEST_ACTION.UNMARK_FILE_VIEWED
        : PULL_REQUEST_ACTION.MARK_FILE_VIEWED;

      const done: string[] = [];

      for (const path of paths) {
        const body = { action, path };

        const written =
          named.by === NAMED_BY.REPOSITORY
            ? yield* askService(hosted.pullRequests.action, { query: named.query, body })
            : yield* askService(hosted.agentPullRequests.action, {
                params: { id: named.id },
                query: named.number === undefined ? {} : { number: named.number },
                body,
              });

        if (written.outcome !== PULL_REQUEST_WRITE_OUTCOME.DONE) {
          const why =
            written.outcome === PULL_REQUEST_WRITE_OUTCOME.REFUSED
              ? `GitHub refused ${path}: ${written.words}`
              : `GitHub needs you to sign in again: sign in with GitHub in ${PRODUCT_NAME}, then run this again.`;

          const before = done.length === 0 ? "" : `\nMarked before it: ${done.join(", ")}`;

          return yield* new CommandFailed({ exit: CLI_EXIT.REFUSED, message: `${why}${before}` });
        }

        done.push(path);
      }

      yield* answer({
        json: { paths: done, viewed: !unmark },
        lines: done.map((path) => `${unmark ? "Unmarked" : "Marked viewed"}: ${path}`),
        ids: done,
      });
    }),
).pipe(
  Command.withDescription("Mark files of a pull request viewed on GitHub as you, or unmark them"),
  Command.withExamples([
    {
      command: "vespin pr viewed acme/relay#42 src/a.ts src/b.ts",
      description: "Mark two files viewed",
    },
    {
      command: "vespin pr viewed acme/relay#42 src/a.ts --unmark",
      description: "Unmark one",
    },
    {
      command: "vespin pr viewed <agent-id> src/a.ts",
      description: "Mark a file of the agent's own pull request viewed",
    },
  ]),
);
