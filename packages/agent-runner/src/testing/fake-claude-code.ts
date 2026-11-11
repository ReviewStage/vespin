/**
 * fake-claude-code.ts -- a scripted CLI for the runner's tests: it plays a recorded turn once the service's first message arrives, and keeps what the runner handed it.
 *
 * It stands at the process boundary the runner drives the real CLI across,
 * so a test sees what the CLI would have: the options it was started with,
 * every prompt in order, the interrupts, the model, effort, and fast mode
 * changes, the host's answer to each tool call it asked about, and
 * whether it was closed. It runs the runner's own Stop hook where the CLI
 * would, before the `result` it precedes.
 */

import type {
  Options,
  PermissionResult,
  SDKMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { Deferred, Effect, Exit, Layer, Queue, Stream } from "effect";
import { ClaudeCode, type ClaudeCodeSession, type StartedClaudeCode } from "../claude-code.js";
import type { PermissionAsk, Step, StopReport } from "./recorded-stream.js";

/** An effort the CLI was set to, as `applyFlagSettings` takes it. */
type EffortSetting = Parameters<ClaudeCodeSession["applyFlagSettings"]>[0]["effortLevel"];

/** What the fake CLI was handed, in the order it was handed it. */
interface CliRecord {
  options: Options | undefined;
  readonly prompts: SDKUserMessage[];
  interrupts: number;
  readonly models: (string | undefined)[];
  readonly efforts: EffortSetting[];
  /** Each fast mode the flag settings were set to. */
  readonly fastModes: (boolean | null | undefined)[];
  /** The host's answer to each tool call the CLI asked about. */
  readonly permissions: (PermissionResult | null)[];
  closed: boolean;
}

/** The runner's Stop hook, as the CLI calls it. */
function stopHookOf(options: Options) {
  const hook = options.hooks?.Stop?.[0]?.hooks[0];
  if (hook === undefined) throw new Error("the runner registered no Stop hook");
  return hook;
}

/**
 * A fake CLI that plays `steps` once, from the service's first message. `prompted`
 * holds each prompt as the CLI reads it, for a test that must wait on one.
 * Each `result` names the prompts its turn took, as the CLI's does, but one
 * whose step says it names none. `chain`
 * is the stored session's entries, which every session it is asked for
 * reads as, or none where the read is refused; a resumed session drops a
 * prompt under a uuid its entries hold, answering nothing, as the CLI
 * (2.1.304) does. A CLI that stops `answering` records each control request
 * (a model change, an interrupt) and never answers it.
 */
export const fakeClaudeCode = Effect.fn("agent-runner/fakeClaudeCode")(function* (
  steps: readonly Step[],
  chain: readonly string[] | null = [],
  answering = true,
) {
  const prompted = yield* Queue.unbounded<SDKUserMessage>();
  const unread = yield* Queue.unbounded<string>();
  const released = yield* Deferred.make<void>();
  const interrupted = yield* Deferred.make<void>();
  const closing = yield* Deferred.make<void>();
  const record: CliRecord = {
    options: undefined,
    prompts: [],
    interrupts: 0,
    models: [],
    efforts: [],
    fastModes: [],
    permissions: [],
    closed: false,
  };

  const query = (params: {
    readonly prompt: AsyncIterable<SDKUserMessage>;
    readonly options: Options;
  }): ClaudeCodeSession => {
    // The prompts the running turn has taken, which its `result` names.
    const taken: string[] = [];
    const held = new Set(params.options.resume === undefined ? [] : (chain ?? []));

    // Note that the prompts are read for as long as the service sends them, as the
    // CLI reads its stdin, while the script plays beside them.
    const prompts = Stream.fromAsyncIterable(params.prompt, (cause) => cause).pipe(
      Stream.filter((prompt) => prompt.uuid === undefined || !held.has(prompt.uuid)),
      Stream.tap((prompt) =>
        Effect.sync(() => record.prompts.push(prompt)).pipe(
          Effect.andThen(Queue.offer(prompted, prompt)),
          Effect.andThen(Queue.offer(unread, prompt.uuid ?? "")),
        ),
      ),
      Stream.drain,
    );
    const runHook = (report: StopReport) => {
      const hook = stopHookOf(params.options);
      return Effect.promise((signal) =>
        hook(
          {
            hook_event_name: "Stop",
            session_id: "fake",
            transcript_path: "/home/agent/.claude/projects/fake.jsonl",
            cwd: params.options.cwd ?? "",
            stop_hook_active: false,
            ...report,
          },
          undefined,
          { signal },
        ),
      );
    };
    // The CLI asks its host where its mode would, through the callback it was handed, and goes
    // on once the host answers. A stop withdraws the ask, as the CLI cancels its request on an
    // interrupt, aborting the call's signal; the host's answer is still awaited, so a test reads it.
    const askHost = (ask: PermissionAsk) =>
      Effect.gen(function* () {
        if (params.options.permissionMode === "bypassPermissions") return;
        const canUseTool = params.options.canUseTool;
        if (canUseTool === undefined)
          return yield* Effect.die("canUseTool callback is not provided.");
        const answer = yield* Deferred.make<PermissionResult | null>();
        const asked = Effect.callback<void>((resume, signal) => {
          void canUseTool(ask.toolName, { ...ask.input }, { ...ask, signal }).then((result) => {
            Deferred.doneUnsafe(answer, Exit.succeed(result));
            resume(Effect.void);
          });
        });
        yield* Effect.raceFirst(asked, Deferred.await(interrupted));
        record.permissions.push(yield* Deferred.await(answer));
      });
    const play = (step: Step): Stream.Stream<SDKMessage> => {
      if ("askPermission" in step)
        return Stream.drain(Stream.fromEffect(askHost(step.askPermission)));
      if ("emit" in step) {
        // Note that the message crosses as a line of JSON, which the SDK takes
        // as an `SDKMessage` unchecked, just as it reads the CLI's stdout.
        const message: SDKMessage = JSON.parse(JSON.stringify(step.emit));
        if (message.type === "result" && step.namesNoPrompt !== true) {
          message.user_message_uuids = taken.splice(0);
        }
        return Stream.make(message);
      }
      if ("awaitPrompt" in step) {
        return Stream.drain(
          Stream.fromEffect(Effect.map(Queue.take(unread), (uuid) => taken.push(uuid))),
        );
      }
      if ("untilInterrupted" in step)
        return Stream.drain(Stream.fromEffect(Deferred.await(interrupted)));
      if ("untilReleased" in step) return Stream.drain(Stream.fromEffect(Deferred.await(released)));
      return Stream.drain(Stream.fromEffect(runHook(step.stopHook)));
    };
    // The CLI starts its first turn on the service's first message.
    const script = Stream.fromIterable<Step>([{ awaitPrompt: true }, ...steps]).pipe(
      Stream.flatMap(play),
    );
    const messages = Stream.toAsyncIterable(
      Stream.merge(script, prompts).pipe(Stream.interruptWhen(Deferred.await(closing))),
    );
    // Note that the SDK hands out its own generator, whose return waits on the read under way,
    // which a quiet CLI answers only once it writes again or is closed; so does this one.
    async function* read() {
      for await (const message of messages) yield message;
    }
    const sdkMessages = read();

    // A request recorded, then answered, or held for good by a CLI that stopped answering: a race
    // of nothing never settles.
    const answer = (): Promise<undefined> =>
      answering ? Promise.resolve(undefined) : Promise.race([]);
    return {
      [Symbol.asyncIterator]: () => sdkMessages,
      interrupt: () => {
        record.interrupts += 1;
        if (answering) Deferred.doneUnsafe(interrupted, Exit.void);
        return answer();
      },
      setModel: (model) => {
        record.models.push(model);
        return answer();
      },
      applyFlagSettings: (settings) => {
        if ("effortLevel" in settings) record.efforts.push(settings.effortLevel);
        if ("fastMode" in settings) record.fastModes.push(settings.fastMode);
        return answer();
      },
      close: () => {
        record.closed = true;
        Deferred.doneUnsafe(closing, Exit.void);
      },
    };
  };

  // Started as the SDK starts the CLI: on its options, then handed its prompts once.
  const startup = async (options: Options): Promise<StartedClaudeCode> => {
    record.options = options;
    return { query: (prompt) => query({ prompt, options }) };
  };

  /** Lets a script held at `untilReleased` go on. */
  const release = Deferred.succeed(released, undefined);
  const sessionChain = async () => {
    if (chain === null) throw new Error("the session could not be read");
    return chain;
  };
  return {
    layer: Layer.succeed(ClaudeCode, { startup, sessionChain }),
    record,
    prompted,
    release,
  };
});
