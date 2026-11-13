import type {
  ComputerApp,
  ComputerOutcome,
  MacComputerAction,
} from "@repo/features/mac-command-wire";
import {
  type Cause,
  type Duration,
  Effect,
  Exit,
  Option,
  Queue,
  Schema,
  Scope,
  Semaphore,
  Stream,
} from "effect";
import { ChildProcess, type ChildProcessSpawner } from "effect/process";

/**
 * computer-use-helper.ts -- the Mac's computer-use helper (`apps/desktop/native/macos/ComputerUse.swift`) as the host asks it: one long-lived process, one request at a time, each answer matched to its request by id.
 *
 * The helper keeps what an app's last read numbered, so it runs as one
 * process for as long as the host stands, started at the first request and
 * started again at the next one after it ended. Requests wait their turn,
 * since an action reads the state the read before it left. An answer the
 * helper did not give in time, or a helper that died mid-request, answers
 * that request as failed and ends the process, because what it was doing is
 * no longer known; the next request starts a fresh one, whose numbers are
 * empty, so an action asks for a fresh read.
 *
 * The helper speaks in its own spelling (`bundle_id`, `icon_png`); what it
 * answers is read through a Schema and handed on in the wire's
 * (`ComputerOutcome`).
 */

/** What the helper refuses or fails with, by its own words for why. */
export const COMPUTER_HELPER_FAILURE = {
  BAD_REQUEST: "bad_request",
  NOT_FOUND: "not_found",
  REFUSED: "refused",
  NO_PERMISSION: "no_permission",
  NO_WINDOW: "no_window",
  NO_STATE: "no_state",
  FAILED: "failed",
} as const;

/**
 * The requests beyond the agent's actions: one app named, without launching
 * it, so the developer can be asked about it; and the Mac's two grants,
 * read, or asked for by macOS's own prompts, for Settings to show.
 */
export const COMPUTER_HELPER_OP = {
  DESCRIBE_APP: "describe_app",
  PERMISSIONS: "permissions",
  REQUEST_PERMISSIONS: "request_permissions",
} as const;

export type ComputerHelperRequest =
  | MacComputerAction
  | { readonly op: typeof COMPUTER_HELPER_OP.DESCRIBE_APP; readonly app: string }
  | {
      readonly op:
        | typeof COMPUTER_HELPER_OP.PERMISSIONS
        | typeof COMPUTER_HELPER_OP.REQUEST_PERMISSIONS;
    };

/** Whether macOS lets the helper capture other apps' windows and post input to them. */
export interface ComputerPermissions {
  readonly screenRecording: boolean;
  readonly accessibility: boolean;
}

/** What one request came to: what the action did, the app described, or why the helper did nothing. */
export type ComputerHelperAnswer =
  | { readonly outcome: ComputerOutcome }
  | { readonly described: ComputerApp }
  | { readonly permissions: ComputerPermissions }
  | { readonly failure: string; readonly message: string };

export interface ComputerUseHelperSeam {
  /** One request answered within `within`, after every request asked before it. */
  readonly ask: (
    request: ComputerHelperRequest,
    within: Duration.Duration,
  ) => Effect.Effect<ComputerHelperAnswer>;
}

/** How the helper names one app. */
const helperAppSchema = Schema.Struct({
  name: Schema.String,
  bundle_id: Schema.optionalKey(Schema.String),
  icon_png: Schema.optionalKey(Schema.String),
  refused: Schema.Boolean,
});

/**
 * One line of the helper's, by its request's id. Note that a read's answer
 * comes before a description's, since a read names its app too, and the
 * Struct leaves out what it does not name.
 */
const helperLineSchema = Schema.fromJsonString(
  Schema.Union([
    Schema.Struct({
      id: Schema.Number,
      ok: Schema.Literal(false),
      error: Schema.Struct({ kind: Schema.String, message: Schema.String }),
    }),
    Schema.Struct({
      id: Schema.Number,
      ok: Schema.Literal(true),
      apps: Schema.Array(helperAppSchema),
    }),
    Schema.Struct({
      id: Schema.Number,
      ok: Schema.Literal(true),
      app: helperAppSchema,
      window: Schema.Struct({
        title: Schema.String,
        x: Schema.Number,
        y: Schema.Number,
        width: Schema.Number,
        height: Schema.Number,
      }),
      elements: Schema.String,
      truncated: Schema.Boolean,
      shots: Schema.Array(
        Schema.Struct({ width: Schema.Number, height: Schema.Number, jpeg: Schema.String }),
      ),
    }),
    Schema.Struct({ id: Schema.Number, ok: Schema.Literal(true), app: helperAppSchema }),
    Schema.Struct({
      id: Schema.Number,
      ok: Schema.Literal(true),
      screen_recording: Schema.Boolean,
      accessibility: Schema.Boolean,
    }),
    Schema.Struct({ id: Schema.Number, ok: Schema.Literal(true), done: Schema.String }),
  ]),
);

type HelperLine = typeof helperLineSchema.Type;

const readLine = Schema.decodeUnknownOption(helperLineSchema);

/** An app as the wire names it. */
function wireApp(app: typeof helperAppSchema.Type): ComputerApp {
  return {
    name: app.name,
    refused: app.refused,
    ...(app.bundle_id === undefined ? undefined : { bundleId: app.bundle_id }),
    ...(app.icon_png === undefined ? undefined : { iconPng: app.icon_png }),
  };
}

/** What a request came to, read off the helper's line for it. */
function answerOf(line: HelperLine): ComputerHelperAnswer {
  if (!line.ok) return { failure: line.error.kind, message: line.error.message };

  if ("apps" in line) return { outcome: { apps: line.apps.map(wireApp) } };

  if ("window" in line) {
    const { app, window, elements, truncated, shots } = line;

    return { outcome: { app: wireApp(app), window, elements, truncated, shots } };
  }

  if ("app" in line) return { described: wireApp(line.app) };

  if ("screen_recording" in line) {
    return {
      permissions: { screenRecording: line.screen_recording, accessibility: line.accessibility },
    };
  }

  return { outcome: { done: line.done } };
}

function failed(message: string): ComputerHelperAnswer {
  return { failure: COMPUTER_HELPER_FAILURE.FAILED, message };
}

/** The helper as one process is running it: where its requests go, and the lines it answered, ended as it exits. */
interface Running {
  readonly scope: Scope.Closeable;
  readonly requests: Queue.Queue<string>;
  readonly lines: Queue.Queue<string, Cause.Done>;
}

/** The answer to request `id`: the first line naming it, lines for any other passed over; none where the helper ended first. */
function answerFor(
  running: Running,
  id: number,
): Effect.Effect<Option.Option<ComputerHelperAnswer>> {
  return Effect.gen(function* () {
    for (;;) {
      const line = yield* Effect.option(Queue.take(running.lines));

      if (Option.isNone(line)) return Option.none();
      const read = readLine(line.value);

      if (Option.isSome(read) && read.value.id === id) return Option.some(answerOf(read.value));
    }
  });
}

/**
 * The helper at `binary`, as the seam the host asks, in the scope it is
 * built in: every process it starts is ended as that scope closes.
 */
export function computerUseHelperProcess(
  binary: string,
): Effect.Effect<
  ComputerUseHelperSeam,
  never,
  Scope.Scope | ChildProcessSpawner.ChildProcessSpawner
> {
  return Effect.gen(function* () {
    const outer = yield* Effect.scope;
    const spawner = yield* Effect.context<ChildProcessSpawner.ChildProcessSpawner>();
    const turn = yield* Semaphore.make(1);
    const encoder = new TextEncoder();
    let running: Running | undefined;
    let asked = 0;

    /** One process started, its lines read until it exits; none where it could not be. */
    const started = Effect.gen(function* () {
      const scope = yield* Scope.fork(outer);
      const requests = yield* Queue.unbounded<string>();
      const lines = yield* Queue.unbounded<string, Cause.Done>();

      const handle = yield* ChildProcess.make(binary, [], {
        stdin: {
          stream: Stream.fromQueue(requests).pipe(Stream.map((text) => encoder.encode(text))),
          endOnDone: false,
        },
        stderr: "ignore",
      }).pipe(Scope.provide(scope), Effect.provideContext(spawner), Effect.option);

      if (Option.isNone(handle)) {
        yield* Scope.close(scope, Exit.void);

        return Option.none<Running>();
      }

      yield* handle.value.stdout.pipe(
        Stream.decodeText(),
        Stream.splitLines,
        Stream.runForEach((line) => Queue.offer(lines, line)),
        Effect.ignore,
        Effect.ensuring(Queue.end(lines)),
        Effect.forkIn(scope),
      );

      return Option.some<Running>({ scope, requests, lines });
    });

    /** The process ended and forgotten, so the next request starts another. */
    const ended = (was: Running) =>
      Effect.suspend(() => {
        if (running === was) running = undefined;

        return Scope.close(was.scope, Exit.void);
      });

    const ask = (request: ComputerHelperRequest, within: Duration.Duration) =>
      turn.withPermit(
        Effect.gen(function* () {
          if (running === undefined) running = Option.getOrUndefined(yield* started);
          const current = running;

          if (current === undefined) return failed("The computer-use helper could not be started.");
          asked += 1;
          const id = asked;
          yield* Queue.offer(current.requests, `${JSON.stringify({ ...request, id })}\n`);
          const answer = yield* Effect.timeoutOption(answerFor(current, id), within);

          if (Option.isSome(answer) && Option.isSome(answer.value)) return answer.value.value;
          yield* ended(current);

          return failed(
            Option.isNone(answer)
              ? "The computer-use helper did not answer in time, so it was stopped."
              : "The computer-use helper stopped before it answered.",
          );
        }),
      );

    return { ask } satisfies ComputerUseHelperSeam;
  });
}
