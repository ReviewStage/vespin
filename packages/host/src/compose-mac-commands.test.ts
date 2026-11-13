import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { MAC_COMMAND_CALL_FAILURE, MAC_COMMAND_NOT_CLAIMED } from "@repo/features";
import { LIVE_POLL_URL, LIVE_SIGNED_OUT } from "@repo/features/live-wire";
import type { MacCommandsLiveAnswer } from "@repo/features/mac-command-live";
import {
  COMPUTER_ACTION,
  COMPUTER_PERMISSION,
  type ComputerApp,
  MAC_COMMAND_KIND,
  type MacCommand,
  type MacCommandKind,
  type MacCommandResult,
  macCommandKindsRead,
  storedMacCommandText,
} from "@repo/features/mac-command-wire";
import { GATEWAY_EVENT, type GatewayEventKind } from "@repo/gateway";
import { MAC_COMMAND_MODE, type MacCommandMode } from "@repo/settings";
import { isRecord, type WireValue } from "@repo/wire";
import { noNetwork } from "@repo/wire/testing";
import { ConfigProvider, Duration, Effect, Layer, Predicate, PubSub, Stream } from "effect";
import { TestClock } from "effect/testing";
import {
  composeMacCommands,
  type MacCommandClient,
  type MacCommandsDependencies,
} from "./compose-mac-commands.js";
import {
  COMPUTER_HELPER_FAILURE,
  COMPUTER_HELPER_OP,
  type ComputerHelperRequest,
  type ComputerPermissions,
  type ComputerUseHelperSeam,
} from "./computer-use-helper.js";
import { Environment, reporterLayer } from "./effect/seams.js";
import { MAC_COMMAND_DECISION, type MacCommandDecision } from "./mac-command-ask.js";
import { scriptedSpawner } from "./testing/scripted-spawner.js";

/**
 * The concern that runs on this Mac what the account's agents queue for it,
 * against a scripted service and spawner: the live read answered polled and
 * held until the rows move. With the setting on Never, or no account, the
 * service is never read; otherwise every read names the account and the
 * kinds this Mac runs, each command waiting is claimed by its id, the
 * earliest first, and run or refused by its kind, one queued later is heard
 * within the poll's hold, and the Mac says it listens every fifteen
 * seconds until the setting is switched to Never. Under Always allow a
 * command runs as claimed; under Ask every time it is told as an ask and
 * runs only once the developer allows it, Always allow writing the setting
 * too, while Deny, or no answer before the command's own timeout, answers
 * the call as not run, and one ask holds up neither the follow nor another.
 *
 * Synthetic commands and accounts throughout.
 */

/** The account signed in, which every live read names. */
const ACCOUNT = "user-mac";

const NOW = 1_800_000_000_000;

const COMMAND: MacCommand = {
  id: "2f6a1c7e-9b3d-4e8f-a5c1-7d2e9b4f6a03",
  kind: MAC_COMMAND_KIND.SHELL,
  command: "node --version",
  timeoutSeconds: 60,
};

const SECOND: MacCommand = {
  id: "7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f",
  kind: MAC_COMMAND_KIND.SHELL,
  command: "pnpm --version",
  timeoutSeconds: 30,
};

const LATER: MacCommand = {
  id: "0e9d8c7b-6a5f-4e3d-9c2b-1a0f9e8d7c6b",
  kind: MAC_COMMAND_KIND.SHELL,
  command: "git status",
  timeoutSeconds: 30,
};

const AGENT = "5b1e0c2d-3f4a-4b5c-9d6e-7f8a9b0c1d2e";
const OTHER_AGENT = "9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b";

const SIMULATOR: ComputerApp = {
  name: "Simulator",
  bundleId: "com.apple.iphonesimulator",
  iconPng: "iVBORw0KGgo=",
  refused: false,
};

const TERMINAL: ComputerApp = { name: "Terminal", bundleId: "com.apple.Terminal", refused: true };

/** An action an agent asks of an app, as the service queues it. */
const computerCommand = (id: string, conversationId: string, app: string): MacCommand => ({
  id,
  kind: MAC_COMMAND_KIND.COMPUTER,
  conversationId,
  action: { op: COMPUTER_ACTION.CLICK, app, element_index: 3 },
  timeoutSeconds: 60,
});

/** Both of the Mac's grants, as a Mac set up for computer use holds them. */
const GRANTED: ComputerPermissions = { screenRecording: true, accessibility: true };

/** The requests that are no action on an app: naming one, and reading the Mac's grants. */
const NO_ACTION: readonly string[] = [
  COMPUTER_HELPER_OP.DESCRIBE_APP,
  COMPUTER_HELPER_OP.PERMISSIONS,
];

/** The helper as a script: the apps it names, the grants it reads, every request it was asked, and each action answered done. */
function scriptedHelper(apps: readonly ComputerApp[], permissions = GRANTED) {
  const asked: ComputerHelperRequest[] = [];

  const helper: ComputerUseHelperSeam = {
    ask: (request) =>
      Effect.sync(() => {
        asked.push(request);

        if (request.op === COMPUTER_HELPER_OP.PERMISSIONS) {
          return { permissions };
        }

        if (request.op !== COMPUTER_HELPER_OP.DESCRIBE_APP) return { outcome: { done: "pressed" } };
        const app = apps.find((each) => each.name === request.app || each.bundleId === request.app);

        return app === undefined
          ? { failure: COMPUTER_HELPER_FAILURE.NOT_FOUND, message: "No such app." }
          : { described: app };
      }),
  };

  return { helper, asked };
}

/** How often the scripted service looks again while it holds a poll, as the service does. */
const HOLD_LOOK = Duration.seconds(1);

/** Let every fiber the step woke run to where it waits. */
const settled = Effect.repeat(Effect.yieldNow, { times: 200 });

/**
 * The service with Realtime off, as a script: the commands still waiting,
 * each with when it was queued, answered polled, and a poll past where they
 * stood held until they move; a claim granted once per command; and every
 * read, presence, and result the Mac sent, as the service would observe it.
 */
function scriptedService(
  options: {
    readonly signedOut?: boolean;
    readonly unansweredClaims?: number;
    /** What happens as a claim is made, before the service grants it, such as the setting being switched off. */
    readonly duringClaim?: Effect.Effect<void>;
  } = {},
) {
  let unanswered = options.unansweredClaims ?? 0;
  const waiting: (MacCommand & { readonly queuedAt: number })[] = [];
  let version = 0;
  const reads: { readonly userId: string; readonly kinds: readonly MacCommandKind[] }[] = [];
  const claims: string[] = [];
  const beats: (readonly MacCommandKind[])[] = [];
  const settledResults = new Map<string, MacCommandResult>();

  const answer = (rows: boolean): MacCommandsLiveAnswer => ({
    url: LIVE_POLL_URL,
    queries: {
      commands: {
        capability: "",
        queryFingerprint: "",
        // A polled read is answered already expired, its expiry the service's now.
        expiresAt: NOW,
        digest: String(version),
        // A row is what the queue keeps: what a command asks, as one text.
        ...(rows
          ? {
              rows: waiting.map((command) => ({
                id: command.id,
                kind: command.kind,
                command: storedMacCommandText(command),
                timeoutSeconds: command.timeoutSeconds,
                queuedAt: command.queuedAt,
              })),
            }
          : undefined),
      },
    },
  });

  const client: MacCommandClient = {
    // SAFETY: the Mac's commands are the one live read the client is asked for, answering the script's rows.
    liveRead: (<Read>(
      _read: Read,
      { userId, kinds }: { readonly userId: string; readonly kinds?: string },
      poll?: { readonly after?: string | undefined },
    ) =>
      Effect.gen(function* () {
        const after = poll?.after;
        reads.push({ userId, kinds: macCommandKindsRead(kinds) });

        if (options.signedOut === true) return LIVE_SIGNED_OUT;

        for (let held = 0; after === String(version) && held < 25; held += 1) {
          yield* Effect.sleep(HOLD_LOOK);
        }

        return answer(after !== String(version));
      })) as MacCommandClient["liveRead"],
    claim: (id) =>
      Effect.andThen(
        options.duringClaim ?? Effect.void,
        Effect.sync(() => {
          claims.push(id);

          // A claim lost on its way, as a network fault loses one, reaches nothing.
          if (unanswered > 0) {
            unanswered -= 1;

            return { failure: MAC_COMMAND_CALL_FAILURE.UNANSWERED };
          }

          const at = waiting.findIndex((command) => command.id === id);

          if (at < 0) return MAC_COMMAND_NOT_CLAIMED;
          const [claimed] = waiting.splice(at, 1);
          version += 1;

          if (claimed === undefined) return MAC_COMMAND_NOT_CLAIMED;
          const { queuedAt: _queuedAt, ...command } = claimed;

          return { command };
        }),
      ),
    listening: (kinds) =>
      Effect.sync(() => {
        beats.push(kinds);

        return { listening: true } as const;
      }),
    settle: (id, result) =>
      Effect.sync(() => {
        settledResults.set(id, result);

        return { settled: true } as const;
      }),
  };

  return {
    client,
    reads,
    claims,
    beats,
    settledResults,
    /** A command queued for the account, as an agent's call queues it. */
    queue: (command: MacCommand, queuedAt: number) => {
      waiting.push({ ...command, queuedAt });
      version += 1;
    },
  };
}

const machine = (spawner: ReturnType<typeof scriptedSpawner>, reported: string[]) =>
  Layer.mergeAll(
    Layer.succeed(
      Environment,
      ConfigProvider.fromEnvRecord({ HOME: "/Users/developer", SHELL: "/bin/bash" }),
    ),
    reporterLayer((line) => {
      reported.push(line);
    }),
    spawner.layer,
    noNetwork,
  );

/** The gate as a test holds it: the setting, whether an account is signed in, and which. */
interface Gate {
  mode: MacCommandMode;
  signedIn: boolean;
  account?: string;
  /** Whether the prompt's Allow all commands fails to keep the setting, as a file that cannot be written does. */
  saveFails?: boolean;
  /** The computer-use helper this Mac ships, its switch, and the apps allowed without asking; none ships no helper. */
  computer?: { helper: ComputerUseHelperSeam; enabled: boolean; allowed: string[] };
}

/**
 * The concern composed over the scripted service, the gate as `gate` holds
 * it, with the asks it tells, as the panel would hear them, the modes the
 * prompt's Allow all commands wrote, one ask answered as the panel answers it,
 * and `moved`, which tells it the gate changed, as a setting written or an
 * account switched does.
 */
const subject = (
  service: ReturnType<typeof scriptedService>,
  spawner: ReturnType<typeof scriptedSpawner>,
  gate: Gate,
) => {
  type ToldAsk =
    | { readonly id: string; readonly command: string }
    | { readonly id: string; readonly app: string };

  const told: ToldAsk[][] = [];
  const written: MacCommandMode[] = [];
  const reported: string[] = [];

  const emit = (kind: GatewayEventKind, payload: WireValue) => {
    if (kind !== GATEWAY_EVENT.MAC_COMMAND_ASKS_CHANGED || !isRecord(payload)) return;
    const asks = Array.isArray(payload.asks) ? payload.asks : [];
    told.push(
      asks.flatMap((ask): ToldAsk[] => {
        if (!isRecord(ask) || !Predicate.isString(ask.id)) return [];

        if (Predicate.isString(ask.command)) return [{ id: ask.id, command: ask.command }];

        return isRecord(ask.app) && Predicate.isString(ask.app.name)
          ? [{ id: ask.id, app: ask.app.name }]
          : [];
      }),
    );
  };

  return Effect.gen(function* () {
    const moves = yield* PubSub.unbounded<void>();

    const dependencies: MacCommandsDependencies = {
      kernel: { runMode: { sendsNetwork: true }, now: () => NOW, emit },
      account: { capabilitiesActive: () => gate.signedIn },
      accountId: () => gate.account ?? ACCOUNT,
      mode: Effect.sync(() => gate.mode),
      changed: Effect.map(PubSub.subscribe(moves), Stream.fromSubscription),
      allowAlways: Effect.sync(() => {
        if (gate.saveFails === true) return false;
        written.push(MAC_COMMAND_MODE.ALWAYS);
        gate.mode = MAC_COMMAND_MODE.ALWAYS;

        return true;
      }),
      client: service.client,
    };

    if (gate.computer !== undefined) {
      dependencies.computer = {
        helper: gate.computer.helper,
        enabled: Effect.sync(() => gate.computer?.enabled === true),
        allowedApps: Effect.sync(() => [...(gate.computer?.allowed ?? [])]),
        allowApp: (app: string) =>
          Effect.sync(() => {
            gate.computer?.allowed.push(app);

            return true;
          }),
      };
    }

    const composer = yield* composeMacCommands(dependencies).pipe(
      Effect.provide(machine(spawner, reported)),
    );

    return {
      composer,
      told,
      written,
      reported,
      moved: Effect.asVoid(PubSub.publish(moves, undefined)),
      /** The asks waiting as last told. */
      asks: () => told.at(-1) ?? [],
      answer: (id: string, decision: MacCommandDecision) =>
        composer.acts.MAC_COMMAND_ANSWER({ id, decision }),
    };
  });
};

it.effect("with the setting on Never, or no account signed in, the service is never read", () =>
  Effect.gen(function* () {
    for (const gate of [
      { mode: MAC_COMMAND_MODE.NEVER, signedIn: true },
      { mode: MAC_COMMAND_MODE.ALWAYS, signedIn: false },
    ]) {
      const spawner = scriptedSpawner(() => ({ exitCode: 0 }));
      const service = scriptedService();
      service.queue(COMMAND, NOW);
      const { composer } = yield* subject(service, spawner, gate);

      yield* Effect.scoped(Effect.andThen(composer.lifetime, TestClock.adjust("1 minute")));

      assert.deepEqual(service.reads, [], JSON.stringify(gate));
      assert.deepEqual(service.beats, [], JSON.stringify(gate));
      assert.deepEqual(spawner.spawned, []);
    }
  }),
);

it.effect(
  "over the held poll, each waiting command is claimed by its id, the earliest first, and run, one queued later is heard within a second or so, and every read names the account and shell alone",
  () =>
    Effect.gen(function* () {
      const spawner = scriptedSpawner(() => ({ stdout: "v24.0.0\n", exitCode: 0 }));
      const service = scriptedService();
      service.queue(SECOND, NOW - 1_000);
      service.queue(COMMAND, NOW - 2_000);

      const { composer } = yield* subject(service, spawner, {
        mode: MAC_COMMAND_MODE.ALWAYS,
        signedIn: true,
      });

      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* composer.lifetime;
          yield* settled;
          assert.deepEqual(service.claims, [COMMAND.id, SECOND.id]);

          service.queue(LATER, NOW);
          yield* TestClock.adjust("2 seconds");
          yield* settled;
          assert.deepEqual(service.claims, [COMMAND.id, SECOND.id, LATER.id]);
        }),
      );

      assert.ok(service.reads.length > 0);

      for (const read of service.reads) {
        assert.deepEqual(read, { userId: ACCOUNT, kinds: [MAC_COMMAND_KIND.SHELL] });
      }

      assert.deepEqual(service.settledResults.get(COMMAND.id), {
        exitCode: 0,
        stdout: "v24.0.0\n",
        stderr: "",
        truncated: false,
        timedOut: false,
      });
      assert.ok(service.settledResults.has(SECOND.id), "the second command ran");
      assert.ok(service.settledResults.has(LATER.id), "the later command ran");
    }),
);

it.effect(
  "the Mac says it listens for shell at once and every fifteen seconds, well inside the service's forty-five, and once the setting is switched to Never it stops",
  () =>
    Effect.gen(function* () {
      const spawner = scriptedSpawner(() => ({ exitCode: 0 }));
      const service = scriptedService();
      const gate: Gate = { mode: MAC_COMMAND_MODE.ALWAYS, signedIn: true };
      const { composer, moved } = yield* subject(service, spawner, gate);

      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* composer.lifetime;
          yield* settled;
          assert.equal(service.beats.length, 1, "said at once");
          yield* TestClock.adjust("45 seconds");
          yield* settled;
          assert.equal(service.beats.length, 4);

          for (const kinds of service.beats) assert.deepEqual(kinds, [MAC_COMMAND_KIND.SHELL]);

          gate.mode = MAC_COMMAND_MODE.NEVER;
          yield* moved;
          yield* settled;
          const reads = service.reads.length;
          yield* TestClock.adjust("1 minute");
          yield* settled;
          assert.equal(service.beats.length, 4, "a Mac switched off says nothing");
          assert.equal(service.reads.length, reads, "nor reads");
        }),
      );
    }),
);

it.effect("a read the service signs out follows nothing, and is asked again after a pause", () =>
  Effect.gen(function* () {
    const spawner = scriptedSpawner(() => ({ exitCode: 0 }));
    const service = scriptedService({ signedOut: true });
    service.queue(COMMAND, NOW);

    const { composer } = yield* subject(service, spawner, {
      mode: MAC_COMMAND_MODE.ALWAYS,
      signedIn: true,
    });

    yield* Effect.scoped(
      Effect.gen(function* () {
        yield* composer.lifetime;
        yield* settled;
        assert.equal(service.reads.length, 1);
        yield* TestClock.adjust("5 seconds");
        yield* settled;
        assert.equal(service.reads.length, 2);
      }),
    );

    assert.deepEqual(service.claims, []);
    assert.deepEqual(service.beats, []);
  }),
);

it.effect("a claim the service never heard is asked again, and the command runs", () =>
  Effect.gen(function* () {
    const spawner = scriptedSpawner(() => ({ exitCode: 0 }));
    const service = scriptedService({ unansweredClaims: 2 });
    service.queue(COMMAND, NOW);

    const { composer } = yield* subject(service, spawner, {
      mode: MAC_COMMAND_MODE.ALWAYS,
      signedIn: true,
    });

    yield* Effect.scoped(
      Effect.gen(function* () {
        yield* composer.lifetime;
        yield* settled;
        yield* TestClock.adjust("3 seconds");
        yield* settled;
      }),
    );

    assert.deepEqual(service.claims, [COMMAND.id, COMMAND.id, COMMAND.id]);
    assert.ok(service.settledResults.has(COMMAND.id), "it ran once the claim got through");
  }),
);

it.effect(
  "a command granted as the setting is switched to Never is answered as not run, though the follow ends mid-claim",
  () =>
    Effect.gen(function* () {
      const spawner = scriptedSpawner(() => ({ exitCode: 0 }));
      const gate: Gate = { mode: MAC_COMMAND_MODE.ALWAYS, signedIn: true };

      const service = scriptedService({
        // The setting goes off as the claim leaves, and the service is slow to grant it, so a beat sees the gate shut first.
        duringClaim: Effect.andThen(
          Effect.sync(() => {
            gate.mode = MAC_COMMAND_MODE.NEVER;
          }),
          Effect.sleep("20 seconds"),
        ),
      });

      service.queue(COMMAND, NOW);
      const { composer } = yield* subject(service, spawner, gate);

      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* composer.lifetime;
          yield* settled;
          yield* TestClock.adjust("30 seconds");
          yield* settled;
        }),
      );

      const answered = service.settledResults.get(COMMAND.id);
      assert.ok(answered !== undefined && "stderr" in answered, "the call hears it was not run");
      assert.match(answered.stderr, /switched off/u);
      assert.deepEqual(spawner.spawned, []);
    }),
);

it.effect(
  "an account switched ends the follow and stops the commands it ran, and the next names the new account",
  () =>
    Effect.gen(function* () {
      const spawner = scriptedSpawner(() => ({ exitCode: 0, after: "1 minute" }));
      const service = scriptedService();
      service.queue(COMMAND, NOW);
      const gate: Gate = { mode: MAC_COMMAND_MODE.ALWAYS, signedIn: true, account: ACCOUNT };
      const { composer, moved } = yield* subject(service, spawner, gate);

      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* composer.lifetime;
          yield* settled;
          assert.equal(spawner.spawned[0]?.ended, "running");
          gate.account = "user-other";
          yield* moved;
          yield* settled;
          assert.notEqual(spawner.spawned[0]?.ended, "running", "the first account's command");
        }),
      );

      assert.equal(service.reads[0]?.userId, ACCOUNT);
      assert.ok(service.reads.some((read) => read.userId === "user-other"));
    }),
);

it.effect(
  "a claim still waiting on the service holds up no read for the account signed in next",
  () =>
    Effect.gen(function* () {
      const spawner = scriptedSpawner(() => ({ exitCode: 0 }));
      // The service is slow to grant the first account's claim.
      const service = scriptedService({ duringClaim: Effect.sleep("20 seconds") });
      service.queue(COMMAND, NOW);
      const gate: Gate = { mode: MAC_COMMAND_MODE.ALWAYS, signedIn: true, account: ACCOUNT };
      const { composer, moved } = yield* subject(service, spawner, gate);

      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* composer.lifetime;
          yield* settled;
          gate.account = "user-other";
          yield* moved;
          yield* settled;
          assert.ok(
            service.reads.some((read) => read.userId === "user-other"),
            "the next account is read before the claim is answered",
          );
          yield* TestClock.adjust("20 seconds");
          yield* settled;
        }),
      );

      const answered = service.settledResults.get(COMMAND.id);
      assert.ok(
        answered !== undefined && "stderr" in answered,
        "the claim granted late is answered",
      );
      assert.match(answered.stderr, /switched off/u);
      assert.deepEqual(spawner.spawned, []);
    }),
);

/** The ask a claimed command is told as, under Ask every time, once the follow has claimed it. */
const askedFor = (
  service: ReturnType<typeof scriptedService>,
  spawner: ReturnType<typeof scriptedSpawner>,
  commands: readonly MacCommand[],
  gate: Gate = { mode: MAC_COMMAND_MODE.ASK, signedIn: true },
) =>
  Effect.gen(function* () {
    for (const command of commands) service.queue(command, NOW);
    const built = yield* subject(service, spawner, gate);
    yield* built.composer.lifetime;
    yield* settled;

    return built;
  });

it.effect(
  "under Ask every time, a claimed command is told as an ask and runs only once the developer allows it once",
  () =>
    Effect.gen(function* () {
      const spawner = scriptedSpawner(() => ({ stdout: "v24.0.0\n", exitCode: 0 }));
      const service = scriptedService();
      yield* Effect.scoped(
        Effect.gen(function* () {
          const built = yield* askedFor(service, spawner, [COMMAND]);
          assert.deepEqual(built.asks(), [{ id: COMMAND.id, command: COMMAND.command }]);
          assert.deepEqual(spawner.spawned, [], "nothing runs before the answer");
          yield* TestClock.adjust("30 seconds");
          yield* settled;
          assert.deepEqual(spawner.spawned, [], "nor while the ask waits inside the timeout");

          yield* built.answer(COMMAND.id, MAC_COMMAND_DECISION.ALLOW_ONCE);
          yield* settled;
          assert.deepEqual(built.asks(), [], "the ask goes as it is answered");
          assert.deepEqual(built.written, [], "allowing once writes no setting");
          assert.equal(spawner.spawned.length, 1);
          assert.deepEqual(service.settledResults.get(COMMAND.id), {
            exitCode: 0,
            stdout: "v24.0.0\n",
            stderr: "",
            truncated: false,
            timedOut: false,
          });
        }),
      );
    }),
);

it.effect("Always allow writes the setting, runs the command, and the next runs unasked", () =>
  Effect.gen(function* () {
    const spawner = scriptedSpawner(() => ({ exitCode: 0 }));
    const service = scriptedService();
    yield* Effect.scoped(
      Effect.gen(function* () {
        const built = yield* askedFor(service, spawner, [COMMAND]);
        yield* built.answer(COMMAND.id, MAC_COMMAND_DECISION.ALLOW_ALWAYS);
        yield* settled;
        assert.deepEqual(built.written, [MAC_COMMAND_MODE.ALWAYS]);
        assert.ok(service.settledResults.has(COMMAND.id), "the command asked for ran");

        service.queue(SECOND, NOW);
        yield* TestClock.adjust("2 seconds");
        yield* settled;
        assert.ok(service.settledResults.has(SECOND.id), "the next ran");
        assert.equal(built.told.length, 2, "nothing was asked for it");
        assert.equal(spawner.spawned.length, 2);
      }),
    );
  }),
);

it.effect("Deny answers the call as not run, declined, and runs nothing", () =>
  Effect.gen(function* () {
    const spawner = scriptedSpawner(() => ({ exitCode: 0 }));
    const service = scriptedService();
    yield* Effect.scoped(
      Effect.gen(function* () {
        const built = yield* askedFor(service, spawner, [COMMAND]);
        yield* built.answer(COMMAND.id, MAC_COMMAND_DECISION.DENY);
        yield* settled;
        assert.deepEqual(built.asks(), []);
        // An answer after the ask went runs nothing (below).
        yield* built.answer(COMMAND.id, MAC_COMMAND_DECISION.ALLOW_ONCE);
        yield* settled;
      }),
    );
    const answered = service.settledResults.get(COMMAND.id);
    assert.ok(answered !== undefined && "refused" in answered, "the call hears it was not run");
    assert.match(answered.refused, /declined/u);
    assert.deepEqual(spawner.spawned, []);
  }),
);

it.effect(
  "no answer by the command's own timeout answers the call as not run, and the ask goes",
  () =>
    Effect.gen(function* () {
      const spawner = scriptedSpawner(() => ({ exitCode: 0 }));
      const service = scriptedService();
      yield* Effect.scoped(
        Effect.gen(function* () {
          const built = yield* askedFor(service, spawner, [SECOND]);
          yield* TestClock.adjust(Duration.seconds(SECOND.timeoutSeconds - 1));
          yield* settled;
          assert.deepEqual(built.asks(), [{ id: SECOND.id, command: SECOND.command }]);
          yield* TestClock.adjust("1 second");
          yield* settled;
          assert.deepEqual(built.asks(), []);
        }),
      );
      const answered = service.settledResults.get(SECOND.id);
      assert.ok(answered !== undefined && "refused" in answered, "the call hears it was not run");
      assert.match(answered.refused, /did not answer/u);
      assert.deepEqual(spawner.spawned, []);
    }),
);

it.effect(
  "an ask waiting holds up neither another ask nor the follow, and each is answered on its own",
  () =>
    Effect.gen(function* () {
      const spawner = scriptedSpawner(() => ({ exitCode: 0 }));
      const service = scriptedService();
      yield* Effect.scoped(
        Effect.gen(function* () {
          const built = yield* askedFor(service, spawner, [COMMAND, SECOND]);
          assert.deepEqual(
            built.asks().map((ask) => ask.id),
            [COMMAND.id, SECOND.id],
          );

          service.queue(LATER, NOW);
          yield* TestClock.adjust("2 seconds");
          yield* settled;
          assert.deepEqual(
            built.asks().map((ask) => ask.id),
            [COMMAND.id, SECOND.id, LATER.id],
            "a command queued later is claimed and asked for while the first still waits",
          );

          yield* built.answer(SECOND.id, MAC_COMMAND_DECISION.ALLOW_ONCE);
          yield* settled;
          assert.deepEqual(
            built.asks().map((ask) => ask.id),
            [COMMAND.id, LATER.id],
          );
          assert.ok(service.settledResults.has(SECOND.id), "the one allowed ran");
          assert.equal(service.settledResults.has(COMMAND.id), false, "the first still waits");
        }),
      );
    }),
);

it.effect(
  "a command allowed late runs in what is left of its timeout, so its result still reaches the call",
  () =>
    Effect.gen(function* () {
      // A command that would run for twenty seconds, allowed with ten left of its sixty.
      const spawner = scriptedSpawner(() => ({ exitCode: 0, after: "20 seconds" }));
      const service = scriptedService();
      yield* Effect.scoped(
        Effect.gen(function* () {
          const built = yield* askedFor(service, spawner, [COMMAND]);
          yield* TestClock.adjust("50 seconds");
          yield* settled;
          yield* built.answer(COMMAND.id, MAC_COMMAND_DECISION.ALLOW_ONCE);
          yield* settled;
          assert.equal(spawner.spawned.length, 1, "it runs");
          yield* TestClock.adjust("15 seconds");
          yield* settled;
        }),
      );
      const answered = service.settledResults.get(COMMAND.id);
      assert.ok(answered !== undefined && "timedOut" in answered, "the call hears what it did");
      assert.equal(answered.timedOut, true, "killed as the command's own timeout ran out");
      assert.notEqual(spawner.spawned[0]?.ended, "running");
    }),
);

it.effect(
  "an Always allow the setting could not keep still runs the command, and is reported",
  () =>
    Effect.gen(function* () {
      const spawner = scriptedSpawner(() => ({ exitCode: 0 }));
      const service = scriptedService();
      yield* Effect.scoped(
        Effect.gen(function* () {
          const built = yield* askedFor(service, spawner, [COMMAND], {
            mode: MAC_COMMAND_MODE.ASK,
            signedIn: true,
            saveFails: true,
          });

          yield* built.answer(COMMAND.id, MAC_COMMAND_DECISION.ALLOW_ALWAYS);
          yield* settled;
          assert.deepEqual(built.written, []);
          assert.ok(service.settledResults.has(COMMAND.id), "the command allowed ran");
          assert.ok(built.reported.some((line) => line.includes("Always allow")));
        }),
      );
    }),
);

it.effect(
  "an ask of an account that signed out is withdrawn, and an answer after the switch runs nothing",
  () =>
    Effect.gen(function* () {
      const spawner = scriptedSpawner(() => ({ exitCode: 0 }));
      const service = scriptedService();
      const gate: Gate = { mode: MAC_COMMAND_MODE.ASK, signedIn: true, account: ACCOUNT };
      yield* Effect.scoped(
        Effect.gen(function* () {
          const built = yield* askedFor(service, spawner, [COMMAND], gate);
          assert.equal(built.asks().length, 1);
          gate.account = "user-other";
          // The change ends the follow, and the next turn lets the ask go.
          yield* built.moved;
          yield* settled;
          assert.deepEqual(built.asks(), []);
          yield* built.answer(COMMAND.id, MAC_COMMAND_DECISION.ALLOW_ONCE);
          yield* settled;
        }),
      );
      assert.deepEqual(spawner.spawned, []);
      assert.equal(service.settledResults.has(COMMAND.id), false);
    }),
);

it.effect(
  "an action on an app not yet allowed is asked about by the app, Always allow adds the app and runs the action, and another agent's action on it then asks nothing; every read names computer too",
  () =>
    Effect.gen(function* () {
      const scripted = scriptedHelper([SIMULATOR]);

      const gate: Gate = {
        // Note that shell commands' Always allow lets no app go unasked.
        mode: MAC_COMMAND_MODE.ALWAYS,
        signedIn: true,
        computer: { helper: scripted.helper, enabled: true, allowed: [] },
      };

      const service = scriptedService();
      const first = computerCommand(COMMAND.id, AGENT, "Simulator");
      service.queue(first, NOW);

      const { composer, asks, answer } = yield* subject(
        service,
        scriptedSpawner(() => ({ exitCode: 0 })),
        gate,
      );

      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* composer.lifetime;
          yield* settled;
          assert.deepEqual(asks(), [{ id: first.id, app: "Simulator" }]);
          assert.equal(
            service.settledResults.has(first.id),
            false,
            "nothing runs before an answer",
          );

          yield* answer(first.id, MAC_COMMAND_DECISION.ALLOW_ALWAYS);
          yield* settled;
          assert.deepEqual(gate.computer?.allowed, ["com.apple.iphonesimulator"]);
          assert.deepEqual(service.settledResults.get(first.id), {
            computer: { done: "pressed", app: SIMULATOR },
          });

          const second = computerCommand(SECOND.id, OTHER_AGENT, "Simulator");
          service.queue(second, NOW);
          yield* TestClock.adjust("2 seconds");
          yield* settled;
          assert.deepEqual(asks(), []);
          assert.deepEqual(service.settledResults.get(second.id), {
            computer: { done: "pressed", app: SIMULATOR },
          });
        }),
      );

      for (const read of service.reads) {
        assert.deepEqual(read.kinds, [MAC_COMMAND_KIND.SHELL, MAC_COMMAND_KIND.COMPUTER]);
      }
    }),
);

it.effect(
  "an app agents are never offered, or any app with the switch off, is answered not run without asking, and the helper acts on nothing",
  () =>
    Effect.gen(function* () {
      for (const enabled of [true, false]) {
        const scripted = scriptedHelper([TERMINAL]);
        const service = scriptedService();
        const command = computerCommand(COMMAND.id, AGENT, "Terminal");
        service.queue(command, NOW);

        const { composer, told } = yield* subject(
          service,
          scriptedSpawner(() => ({ exitCode: 0 })),
          {
            mode: MAC_COMMAND_MODE.ALWAYS,
            signedIn: true,
            computer: { helper: scripted.helper, enabled, allowed: [] },
          },
        );

        yield* Effect.scoped(Effect.andThen(composer.lifetime, settled));

        const result = service.settledResults.get(command.id);
        assert.ok(result !== undefined && "refused" in result, `enabled: ${String(enabled)}`);
        assert.deepEqual(told, [], "nothing was asked");
        assert.ok(
          scripted.asked.every((request) => NO_ACTION.includes(request.op)),
          "no action reached the helper",
        );
      }
    }),
);

it.effect(
  "an action the Mac lacks a grant for is refused at once naming it, without asking about the app, and never reaches the helper",
  () =>
    Effect.gen(function* () {
      const scripted = scriptedHelper([SIMULATOR], { screenRecording: false, accessibility: true });
      const service = scriptedService();

      const command: MacCommand = {
        id: COMMAND.id,
        kind: MAC_COMMAND_KIND.COMPUTER,
        conversationId: AGENT,
        timeoutSeconds: 60,
        action: {
          op: COMPUTER_ACTION.GET_APP_STATE,
          app: "Simulator",
          shots: [{ edge: 1280, quality: 0.7 }],
        },
      };

      service.queue(command, NOW);

      const { composer, told } = yield* subject(
        service,
        scriptedSpawner(() => ({ exitCode: 0 })),
        {
          mode: MAC_COMMAND_MODE.ASK,
          signedIn: true,
          computer: { helper: scripted.helper, enabled: true, allowed: [] },
        },
      );

      yield* Effect.scoped(Effect.andThen(composer.lifetime, settled));

      const result = service.settledResults.get(command.id);
      assert.ok(result !== undefined && "refused" in result);
      assert.deepEqual(result.missingPermissions, [COMPUTER_PERMISSION.SCREEN_RECORDING]);
      assert.match(result.refused, /Screen Recording/);
      assert.doesNotMatch(result.refused, /Accessibility/);
      assert.deepEqual(told, [], "the developer was asked nothing");
      assert.deepEqual(
        scripted.asked.map((request) => request.op),
        [COMPUTER_HELPER_OP.PERMISSIONS],
      );
    }),
);

it.effect(
  "Settings reads the Mac's grants and names each app allowed without asking as the helper does, one it no longer finds by its bundle id",
  () =>
    Effect.gen(function* () {
      const scripted = scriptedHelper([SIMULATOR], {
        screenRecording: true,
        accessibility: false,
      });

      const { composer } = yield* subject(
        scriptedService(),
        scriptedSpawner(() => ({ exitCode: 0 })),
        {
          mode: MAC_COMMAND_MODE.ASK,
          signedIn: true,
          computer: {
            helper: scripted.helper,
            enabled: true,
            allowed: ["com.apple.iphonesimulator", "com.example.Gone"],
          },
        },
      );

      const status = yield* composer.acts.COMPUTER_USE_STATUS({});

      assert.deepEqual(status, {
        permissions: { screenRecording: true, accessibility: false },
        apps: [
          { bundleId: "com.apple.iphonesimulator", name: "Simulator", iconPng: "iVBORw0KGgo=" },
          { bundleId: "com.example.Gone", name: "com.example.Gone" },
        ],
      });
    }),
);
