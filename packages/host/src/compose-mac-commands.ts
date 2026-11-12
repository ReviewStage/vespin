import { type HostedMacCommandClient, MAC_COMMAND_CALL_FAILURE } from "@repo/features";
import {
  MAC_COMMANDS_READ,
  type MacCommandsLiveAnswer,
  macCommandsOfLiveRows,
} from "@repo/features/mac-command-live";
import {
  COMPUTER_ACTION,
  type ComputerApp,
  isMacComputerCommand,
  isMacShellCommand,
  MAC_COMMAND_KIND,
  type MacCommandKind,
  type MacCommandRead,
  type MacCommandRefusal,
  type MacCommandResult,
  type MacComputerCommand,
  type MacShellResult,
  macCommandKindsQuery,
} from "@repo/features/mac-command-wire";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { carried, GATEWAY_EVENT } from "@repo/gateway";
import { MAC_COMMAND_MODE, type MacCommandMode } from "@repo/settings";
import {
  Clock,
  Config,
  Deferred,
  Duration,
  Effect,
  FiberSet,
  Option,
  Schedule,
  type Scope,
  Stream,
  SubscriptionRef,
} from "effect";
import * as HttpClient from "effect/http/HttpClient";
import type { ChildProcessSpawner } from "effect/process";
import type { AccountComposer } from "./compose-account.js";
import type { Composer } from "./composer.js";
import {
  COMPUTER_HELPER_OP,
  type ComputerHelperAnswer,
  type ComputerUseHelperSeam,
} from "./computer-use-helper.js";
import type { MAC_COMMAND_ACTS } from "./contract/index.js";
import { Environment, Reporter } from "./effect/seams.js";
import type { HostActTable } from "./host-acts.js";
import type { HOST_PLATFORM_CONCERN, PlatformConcernMethods } from "./host-concerns.js";
import type { HostKernel } from "./host-kernel.js";
import { decodedLiveRows, LIVE_RESTART, waitOrRegained } from "./live-follow.js";
import {
  MAC_COMMAND_DECISION,
  type MacAppAsk,
  type MacCommandAsk,
  type MacCommandDecision,
} from "./mac-command-ask.js";
import { type MacShell, runMacCommand } from "./mac-command-runner.js";
import type { RunMode } from "./run-mode.js";

/**
 * compose-mac-commands.ts -- runs on this Mac the commands the account's agents queue for it, for as long as an account is signed in and Settings lets agents run commands here, asking the developer first where Settings says to.
 *
 * Settings › This Mac decides (`@repo/settings`'s `MAC_COMMAND_MODE`): Ask
 * every time, the default, shows the developer each shell command before
 * it runs; Always allow runs any command of the account's agents without
 * asking; Never is the brake, under which nothing is read. While the gate
 * stands, the commands no Mac has
 * claimed, of the kinds this Mac runs, are followed through the live layer
 * (`live-follow.ts`: a poll the service holds until the rows move), and
 * each one
 * heard of is claimed by its id; the service grants a claim once, so when
 * two Macs of one account follow, only the one it granted runs it. Each
 * claimed command runs on a fiber of its own in the concern's scope, by its
 * kind: a shell command in the login shell from the home folder
 * (`mac-command-runner.ts`), and a command of a kind this Mac cannot run
 * answered with a refusal. Its result is posted back, so a long command
 * holds up neither the follow nor the others.
 *
 * Under Ask every time, a claimed shell command is held as an ask
 * (`mac-command-ask.ts`) on the same fiber, so one waiting holds up neither
 * the follow nor another ask: the asks waiting are told as
 * `MAC_COMMAND_ASKS_CHANGED` each time one is asked or answered, the panel
 * draws them, and its answer comes back as `MAC_COMMAND_ANSWER` by the
 * ask's id. Allow once runs the command; Allow all commands writes the setting to
 * Always allow and runs it; Deny, or no answer before the command's own
 * timeout has passed since it was asked, answers the call as not run, in
 * words the agent can act on, through the same refusal a command of a kind
 * this Mac cannot run is answered with.
 *
 * An action on an app (`MAC_COMMAND_KIND.COMPUTER`) is taken only where the
 * desktop ships the computer-use helper (`computer-use-helper.ts`), and runs
 * through it under Settings › Let agents use apps on this Mac, whatever the
 * shell commands' setting says. The helper names the app first, launching
 * nothing: one agents are never offered is refused, one the developer
 * answered Always allow for, or allowed for this agent's conversation before, runs, and any
 * other is asked about as an app (`MacAppAsk`), on the same terms as a shell
 * command's ask. Allow once holds the app for the conversation that asked until the
 * gate moves; Always allow adds it to the apps agents use without asking.
 * Listing the apps names none, so it asks nothing.
 *
 * A live read writes nothing, so the Mac says it listens for its kinds
 * itself, every `LISTENING_EVERY`, well inside the service's freshness
 * window: the one timer that remains, because presence is a fact about this
 * process that no row change can carry.
 *
 * The gate is a value that changes rather than one read again on a timer:
 * the account it stands open for, worked out afresh each time a setting or
 * the account changes (`MacCommandsDependencies.changed`). The setting
 * switched off, a sign-out, or another account signing in ends the follow
 * and the beats at once, the agents' calls are told no Mac listens, and
 * every command still running is stopped, its process group killed; a gate
 * shut waits for it to open, reading nothing. Every read names the account
 * the follow started for, so one the service signs out ends the follow.
 * Quitting closes the scope, which kills every command still running with
 * its process group.
 */

/** How long the follow rests after a turn that died, before it tries again. */
const DIED_REST = Duration.seconds(5);

/** How often a Mac following its commands says it listens: a third of the service's forty-five-second freshness window. */
const LISTENING_EVERY = Duration.seconds(15);

/**
 * How a claim the service did not answer is asked again: a second apart, a
 * few times, well inside the service's thirty-second claim window, since
 * the rows that named it may not change again to say so.
 */
const CLAIM_RETRY = { every: Duration.seconds(1), times: 5 } as const;

/** The login shell when the environment names none: macOS's own default. */
const DEFAULT_SHELL = "/bin/zsh";

const VARIABLE = { HOME: "HOME", SHELL: "SHELL" } as const;

/** How long the helper has to name an app before it is asked about, apart from the action's own time. */
const DESCRIBE_WITHIN = Duration.seconds(10);

/** The service's side of the commands, as this concern asks it. */
export type MacCommandClient = Pick<
  HostedMacCommandClient,
  "liveRead" | "claim" | "listening" | "settle"
>;

export interface MacCommandsDependencies {
  kernel: Pick<HostKernel, "emit" | "now"> & { runMode: Pick<RunMode, "sendsNetwork"> };
  account: Pick<AccountComposer, "capabilitiesActive">;
  /** The account signed in now, by its id, which every live read names; none where nobody is. */
  accountId: () => string | undefined;
  /** How Settings lets agents run commands on this Mac, read as the gate is worked out and as each claimed command is about to run. */
  mode: Effect.Effect<MacCommandMode>;
  /**
   * Subscribes, for as long as the subscriber's scope stands, to every
   * change that may move the gate: a setting written, or the account
   * signed in, out, or switched. What each carries is not read: the gate is
   * worked out afresh from `mode`, `account`, and `accountId` on each.
   */
  changed: Effect.Effect<Stream.Stream<unknown>, never, Scope.Scope>;
  /** Writes the setting to Always allow, answering whether the write landed: the prompt's Allow all commands, which also runs the command asked. */
  allowAlways: Effect.Effect<boolean>;
  client: MacCommandClient;
  /** The computer-use helper and its settings, where this Mac ships one; none takes no action on an app. */
  computer?: MacComputerUse;
}

/** What actions on apps run through and under: the helper, and the settings that let them. */
export interface MacComputerUse {
  readonly helper: ComputerUseHelperSeam;
  /** Whether Settings lets agents use apps on this Mac, read as each action arrives. */
  readonly enabled: Effect.Effect<boolean>;
  /** The apps the developer answered Always allow for, by bundle id, or by name where an app has none. */
  readonly allowedApps: Effect.Effect<readonly string[]>;
  /** Adds an app to them, answering whether the write landed: an app's Always allow. */
  readonly allowApp: (app: string) => Effect.Effect<boolean>;
}

export interface MacCommandsComposer extends Composer {
  readonly acts: HostActTable<typeof MAC_COMMAND_ACTS>;
}

/** What a command taken as the setting was switched off, or the account signed out, answers. */
const SWITCHED_OFF: MacShellResult = {
  exitCode: null,
  stdout: "",
  stderr: "Not run: commands on this Mac were switched off as it arrived.",
  truncated: false,
  timedOut: false,
};

/** What a command the developer declined answers. */
const DECLINED: MacCommandRefusal = {
  refused: "Not run: the developer declined this command.",
};

/** What a command the developer did not answer for answers: not run, since its timeout had passed before it could start. */
const UNANSWERED: MacCommandRefusal = {
  refused:
    "Not run: the developer did not answer in time whether to allow this command on their Mac.",
};

/** What a command asked under an account that signed out before it was answered answers. */
const ACCOUNT_CHANGED: MacCommandRefusal = {
  refused: "Not run: the account signed in on the developer's Mac changed before it was allowed.",
};

/** What an action answers where Settings has agents use no apps on this Mac. */
const APPS_SWITCHED_OFF: MacCommandRefusal = {
  refused:
    "Not run: the developer switched off Settings › Let agents use apps on this Mac, so no app can be used.",
};

/** What an action on an app the developer declined answers. */
const APP_DECLINED: MacCommandRefusal = {
  refused: "Not run: the developer declined to let agents use this app.",
};

/** What an action on an app the developer did not answer for in time answers. */
const APP_UNANSWERED: MacCommandRefusal = {
  refused: "Not run: the developer did not answer in time whether agents may use this app.",
};

/** What an action on an app agents are never offered answers, by the app's name. */
function neverOffered(app: string): MacCommandRefusal {
  return {
    refused: `Not run: agents are never offered ${app}, as with terminals, password managers, System Settings, and ${PRODUCT_NAME}.`,
  };
}

/** What an action came to, as the helper answered it. */
function computerResult(answer: ComputerHelperAnswer, app?: ComputerApp): MacCommandResult {
  if ("outcome" in answer) {
    // Note that a done action names the app it acted on, which the helper's own answer does not.
    const outcome =
      "done" in answer.outcome && app !== undefined ? { ...answer.outcome, app } : answer.outcome;

    return { computer: outcome };
  }

  if ("failure" in answer) return { refused: `Not run: ${answer.message}` };

  return { refused: "Not run: the computer-use helper answered something else." };
}

/** What a command of a kind this Mac cannot run answers, such as one a newer service queued. */
const CANNOT_RUN: MacCommandRefusal = {
  refused:
    `Not run: ${PRODUCT_NAME} on the developer's Mac cannot run this kind of command; updating ${PRODUCT_NAME} there ` +
    "may let it.",
};

/** What a command answers where the environment names no home folder to run it from. */
const NO_HOME: MacShellResult = {
  exitCode: null,
  stdout: "",
  stderr: "Could not start the command: this Mac names no home folder.",
  truncated: false,
  timedOut: false,
};

/** Where commands run, from the environment the host was handed; nothing where it names no home. */
const macShell = Effect.gen(function* () {
  const environment = yield* Environment;
  const home = yield* Effect.orDie(Config.option(Config.String(VARIABLE.HOME)).parse(environment));

  const shell = yield* Effect.orDie(
    Config.withDefault(Config.String(VARIABLE.SHELL), DEFAULT_SHELL).parse(environment),
  );

  return Option.map(home, (folder): MacShell => ({ path: shell, home: folder }));
});

export function composeMacCommands(
  dependencies: MacCommandsDependencies,
): Effect.Effect<
  MacCommandsComposer,
  never,
  Environment | Reporter | ChildProcessSpawner.ChildProcessSpawner | HttpClient.HttpClient
> {
  return Effect.gen(function* () {
    const { report } = yield* Reporter;
    const shell = yield* macShell;
    const services = yield* Effect.context<ChildProcessSpawner.ChildProcessSpawner>();
    const http = yield* HttpClient.HttpClient;
    const { kernel, account, mode, allowAlways, client, computer } = dependencies;

    /** The kinds of command this Mac runs, which every read names: actions on apps only where it ships the helper. */
    const runs: readonly MacCommandKind[] =
      computer === undefined
        ? [MAC_COMMAND_KIND.SHELL]
        : [MAC_COMMAND_KIND.SHELL, MAC_COMMAND_KIND.COMPUTER];

    /** The apps each agent's conversation was allowed once, by its id, until the gate moves. */
    const allowedOnce = new Map<string, Set<string>>();

    /** The asks waiting on the developer, by the command's id, the earliest asked first, each with the account it was claimed for. */
    const asks = new Map<
      string,
      { ask: MacCommandAsk; userId: string; decided: Deferred.Deferred<MacCommandDecision> }
    >();

    const tellAsks = () =>
      kernel.emit(
        GATEWAY_EVENT.MAC_COMMAND_ASKS_CHANGED,
        carried({ asks: [...asks.values()].map((held) => held.ask) }),
      );

    /**
     * The developer's answer to one ask, a claimed shell command or an app
     * an action names, asked of the panel and waited for until `deadline`, the command's own timeout
     * past the claim; no answer by then is a denial of its own kind. The
     * ask is withdrawn however the wait ends, an interruption included, so
     * a prompt never outlives its command.
     */
    const consent = (
      ask: MacCommandAsk,
      userId: string,
      deadline: number,
    ): Effect.Effect<MacCommandDecision | undefined> =>
      Effect.gen(function* () {
        const decided = yield* Deferred.make<MacCommandDecision>();
        asks.set(ask.id, { ask, userId, decided });
        tellAsks();
        const now = yield* Clock.currentTimeMillis;

        return yield* Deferred.await(decided).pipe(
          Effect.timeoutOption(Duration.millis(Math.max(0, deadline - now))),
          Effect.map(Option.getOrUndefined),
          Effect.ensuring(
            Effect.sync(() => {
              asks.delete(ask.id);
              tellAsks();
            }),
          ),
        );
      });

    /** The asks of any account but the one signed in, let go: their prompts come down, and their calls hear nothing from this Mac. */
    const withdrawOtherAccounts = Effect.gen(function* () {
      const signedIn = dependencies.accountId();

      for (const held of asks.values()) {
        if (held.userId !== signedIn) yield* Deferred.interrupt(held.decided);
      }
    });

    const asked = <A>(call: Effect.Effect<A, never, HttpClient.HttpClient>) =>
      Effect.provideService(call, HttpClient.HttpClient, http);

    /** What one command comes to, by its kind: a shell command run, and any other kind refused. */
    const ran = (command: MacCommandRead): Effect.Effect<MacCommandResult> => {
      if (!isMacShellCommand(command)) return Effect.succeed(CANNOT_RUN);

      return Option.match(shell, {
        onNone: () => Effect.succeed(NO_HOME),
        onSome: (where) => runMacCommand(command, where),
      }).pipe(Effect.provideContext(services));
    };

    /** One result posted back; one the service did not take is let go, its call already given up. */
    const settled = (id: string, result: MacCommandResult) =>
      Effect.asVoid(asked(client.settle(id, result)));

    /** One command run and its result posted back. */
    const run = (command: MacCommandRead) =>
      Effect.flatMap(ran(command), (result) => settled(command.id, result));

    /**
     * One claimed command as the setting now says: run, or under Ask every
     * time, a shell command run only once the developer allows it, and
     * answered as declined or unanswered otherwise. The command's own
     * timeout is one deadline from the claim, over the wait for the answer
     * and the run together, so a command allowed late runs in what is left
     * of it, because the service waits for the result only that long past
     * queueing and a result after that is lost. Note that the wait for the
     * answer is interruptible inside the claim's uninterruptible region,
     * because a gate shut meanwhile, or the quit, must not hold on a prompt
     * nobody will answer; the service answers the call on its own clock
     * then. An Always allow the setting could not keep still runs the
     * command, which the developer allowed, and is reported, since the next
     * command asks again.
     */
    const decided = (command: MacCommandRead, userId: string) =>
      Effect.gen(function* () {
        if (isMacComputerCommand(command)) return yield* used(command, userId);

        // Note that a kind this Mac cannot run is refused without asking, since nothing would run.
        if ((yield* mode) !== MAC_COMMAND_MODE.ASK || !isMacShellCommand(command)) {
          return yield* run(command);
        }

        const deadline =
          (yield* Clock.currentTimeMillis) +
          Duration.toMillis(Duration.seconds(command.timeoutSeconds));

        const decision = yield* Effect.interruptible(
          consent(
            { id: command.id, command: command.command, askedAt: kernel.now() },
            userId,
            deadline,
          ),
        );

        if (decision === undefined) return yield* settled(command.id, UNANSWERED);

        if (decision === MAC_COMMAND_DECISION.DENY) return yield* settled(command.id, DECLINED);

        if (dependencies.accountId() !== userId) return yield* settled(command.id, ACCOUNT_CHANGED);

        if (decision === MAC_COMMAND_DECISION.ALLOW_ALWAYS && !(yield* allowAlways)) {
          report("the Always allow setting could not be saved; the next command asks again");
        }

        const left = Math.ceil((deadline - (yield* Clock.currentTimeMillis)) / 1000);

        if (left < 1) return yield* settled(command.id, UNANSWERED);
        yield* run({ ...command, timeoutSeconds: Math.min(command.timeoutSeconds, left) });
      });

    /**
     * Whether the agent may use the app its action names: the app named by
     * the helper, launching nothing, then refused, allowed already, or asked
     * about until `deadline`. Answers why not, or the app as the helper
     * named it where it may.
     */
    const appAllowed = (
      use: MacComputerUse,
      command: MacComputerCommand & { readonly action: { readonly app: string } },
      userId: string,
      deadline: number,
    ): Effect.Effect<MacCommandRefusal | { readonly app: ComputerApp }> =>
      Effect.gen(function* () {
        const named = yield* use.helper.ask(
          { op: COMPUTER_HELPER_OP.DESCRIBE_APP, app: command.action.app },
          DESCRIBE_WITHIN,
        );

        if ("failure" in named) return { refused: `Not run: ${named.message}` };

        if (!("described" in named)) {
          return { refused: "Not run: the computer-use helper answered something else." };
        }

        const app = named.described;

        if (app.refused) return neverOffered(app.name);
        const key = app.bundleId ?? app.name;
        const allowed = yield* use.allowedApps;

        if (allowed.includes(key) || allowedOnce.get(command.conversationId)?.has(key) === true) {
          return { app };
        }

        const asked: MacAppAsk = {
          id: command.id,
          app: {
            name: app.name,
            ...(app.bundleId === undefined ? undefined : { bundleId: app.bundleId }),
            ...(app.iconPng === undefined ? undefined : { iconPng: app.iconPng }),
          },
          askedAt: kernel.now(),
        };

        const decision = yield* Effect.interruptible(consent(asked, userId, deadline));

        if (decision === undefined) return APP_UNANSWERED;

        if (decision === MAC_COMMAND_DECISION.DENY) return APP_DECLINED;

        if (dependencies.accountId() !== userId) return ACCOUNT_CHANGED;

        if (decision === MAC_COMMAND_DECISION.ALLOW_ALWAYS && !(yield* use.allowApp(key))) {
          report("an app's Always allow could not be saved; the next agent asks again");
        }

        allowedOnce.set(
          command.conversationId,
          new Set([...(allowedOnce.get(command.conversationId) ?? []), key]),
        );

        return { app };
      });

    /**
     * One claimed action on an app as Settings now says: refused where agents
     * use no apps here, the app allowed or asked about where the action names
     * one, and run through the helper in what is left of the command's own
     * timeout from the claim, on the same terms as a shell command allowed
     * late.
     */
    const used = (command: MacComputerCommand, userId: string) =>
      Effect.gen(function* () {
        if (computer === undefined) return yield* settled(command.id, CANNOT_RUN);

        if (!(yield* computer.enabled)) return yield* settled(command.id, APPS_SWITCHED_OFF);

        const deadline =
          (yield* Clock.currentTimeMillis) +
          Duration.toMillis(Duration.seconds(command.timeoutSeconds));

        const { action } = command;
        let app: ComputerApp | undefined;

        if (action.op !== COMPUTER_ACTION.LIST_APPS) {
          const allowed = yield* appAllowed(computer, { ...command, action }, userId, deadline);

          if ("refused" in allowed) return yield* settled(command.id, allowed);
          app = allowed.app;
        }

        const left = deadline - (yield* Clock.currentTimeMillis);

        if (left < 1000) return yield* settled(command.id, APP_UNANSWERED);
        const answer = yield* computer.helper.ask(action, Duration.millis(left));
        yield* settled(command.id, computerResult(answer, app));
      });

    /** Whether the Mac takes commands now: an account signed in, a run that sends, and the setting not Never. */
    const gateOpen = Effect.map(
      mode,
      (how) =>
        how !== MAC_COMMAND_MODE.NEVER &&
        kernel.runMode.sendsNetwork &&
        account.capabilitiesActive(),
    );

    /** The gate as last worked out: the account the Mac takes commands for, none while it is shut. */
    const gate = yield* SubscriptionRef.make<string | undefined>(undefined);
    const gateFor = Effect.map(gateOpen, (open) => (open ? dependencies.accountId() : undefined));
    /** How many times the gate has moved: shut, opened, or opened for another account. */
    let moves = 0;

    const gateMoved = Effect.flatMap(gateFor, (userId) =>
      Effect.map(SubscriptionRef.getAndSet(gate, userId), (was) => {
        if (was !== userId) moves += 1;
      }),
    );

    /** Waits until the gate stands open, for whichever account. */
    const opened = SubscriptionRef.changes(gate).pipe(
      Stream.filter((userId) => userId !== undefined),
      Stream.runHead,
    );

    /** Waits until the gate no longer stands open for `userId`: shut, or open for another account. */
    const left = (userId: string) =>
      SubscriptionRef.changes(gate).pipe(
        Stream.filter((now) => now !== userId),
        Stream.runHead,
      );

    /**
     * One command heard of, claimed by its id and, once granted, run on a
     * fiber of its own; with the gate shut since, answered as not run
     * instead. A claim the service did not answer is asked again a few times
     * (`CLAIM_RETRY`), since the rows that named it may not change again to
     * say so. Note that the claim and its answer are uninterruptible and run
     * on a set of the concern's own (`claims`), never cleared, rather than the
     * follow's fiber or the set of commands running, because a command the
     * service granted is this Mac's alone to answer, a follow ended mid-claim
     * would otherwise leave its call waiting out its time, and a clear of the
     * commands running would wait out the claim, holding up the next
     * account's follow past its own commands' claim window.
     */
    const claimed = (running: FiberSet.FiberSet, userId: string, command: MacCommandRead) =>
      Effect.gen(function* () {
        const answer = yield* asked(client.claim(command.id)).pipe(
          Effect.repeat({
            schedule: Schedule.spaced(CLAIM_RETRY.every),
            times: CLAIM_RETRY.times,
            until: (granted) =>
              !("failure" in granted) || granted.failure !== MAC_COMMAND_CALL_FAILURE.UNANSWERED,
          }),
        );

        // A claim refused, or never answered, runs nothing: the command is another Mac's, or its call has given up.
        if ("failure" in answer) return;
        const { command: granted } = answer;

        if (!(yield* gateOpen) || dependencies.accountId() !== userId) {
          yield* asked(client.settle(granted.id, SWITCHED_OFF));

          return;
        }

        yield* FiberSet.run(running, decided(granted, userId));
      }).pipe(Effect.uninterruptible);

    /** The unclaimed commands of this Mac's kinds, their rows inline, held past `after` where it names one, for the account `userId` names. */
    const seal = (userId: string, poll: boolean, after?: string) =>
      asked(
        client.liveRead(
          MAC_COMMANDS_READ,
          { userId, kinds: macCommandKindsQuery(runs) },
          poll ? { after } : undefined,
        ),
      );

    /**
     * That this Mac listens for its kinds, said every `LISTENING_EVERY` for
     * as long as the follow stands, which ends as the gate leaves its
     * account.
     */
    const presence = Effect.gen(function* () {
      for (;;) {
        yield* asked(client.listening(runs));
        yield* Effect.sleep(LISTENING_EVERY);
      }
    });

    /**
     * The unclaimed commands followed (`live-follow.ts`, which polls the
     * service, held) until the gate leaves the account or the session signs
     * out, each new one claimed by its id, the earliest queued first
     * (`claimed`). A command is claimed once per follow, and forgotten once
     * it leaves the rows, so the ids this keeps are only those still
     * waiting. A follow ends where the gate shuts, the session signs out, or
     * the account signed in changes.
     */
    const followed = (
      running: FiberSet.FiberSet,
      claims: FiberSet.FiberSet,
      userId: string,
      first: MacCommandsLiveAnswer,
    ) =>
      Effect.suspend(() => {
        let tried = new Set<string>();

        const claimNew = (commands: readonly MacCommandRead[]) =>
          Effect.gen(function* () {
            const fresh = commands.filter((command) => !tried.has(command.id));
            tried = new Set(commands.map((command) => command.id));

            for (const command of fresh) {
              yield* FiberSet.run(claims, claimed(running, userId, command));
            }
          });

        const rows = decodedLiveRows(
          { poll: (after) => seal(userId, true, after) },
          first,
          MAC_COMMANDS_READ.rows,
        );

        const following = Stream.runForEach(rows, (read) => claimNew(macCommandsOfLiveRows(read)));

        const follow = Effect.raceFirst(following, presence).pipe(
          Effect.catch(() => waitOrRegained(LIVE_RESTART)),
        );

        return Effect.raceFirst(follow, Effect.asVoid(left(userId)));
      });

    /** How many times the gate had moved when the running set was last cleared. */
    let clearedAt = 0;

    /**
     * One turn of the loop: the commands followed until the gate leaves the
     * account, the read asked again after a pause, or as soon as the service
     * answers again, where it did not answer it or signed the session out;
     * with the gate moved since the commands running were claimed, every
     * one of them stopped (its process group killed as its scope closes),
     * though it opened again for the same account; with it shut, a wait for
     * it to open.
     * Every turn begins by letting go of the asks of any account but the one
     * signed in, since a follow ends as the account changes.
     */
    const turn = (running: FiberSet.FiberSet, claims: FiberSet.FiberSet) =>
      Effect.gen(function* () {
        yield* withdrawOtherAccounts;

        if (moves !== clearedAt) {
          clearedAt = moves;
          allowedOnce.clear();
          yield* FiberSet.clear(running);

          // Note that the clear waits out any claim under way, during which the gate may have moved again, so the next turn starts from where it stands now.
          if (moves !== clearedAt) return;
        }

        // The account the follow starts for, which every read names, so one under another's session is refused as signed out.
        const userId = yield* SubscriptionRef.get(gate);

        if (userId === undefined) return yield* Effect.asVoid(opened);
        const sealed = yield* seal(userId, false);

        if ("failure" in sealed) {
          return yield* Effect.raceFirst(waitOrRegained(LIVE_RESTART), Effect.asVoid(left(userId)));
        }

        yield* followed(running, claims, userId, sealed);
      });

    const lifetime = Effect.gen(function* () {
      const running = yield* FiberSet.make();
      const claims = yield* FiberSet.make();
      // Note that the changes are subscribed to before the gate is first worked out, so one that lands meanwhile is heard rather than lost.
      const changes = yield* dependencies.changed;
      yield* gateMoved;
      yield* Effect.forkScoped(Stream.runForEach(changes, () => gateMoved));

      // A turn that died is reported and the reads rest before the next.
      const guarded = Effect.catchDefect(turn(running, claims), () =>
        Effect.andThen(
          Effect.sync(() => report("the Mac command read failed")),
          Effect.sleep(DIED_REST),
        ),
      );

      yield* Effect.forkScoped(Effect.forever(guarded));
    });

    const methods: PlatformConcernMethods<typeof HOST_PLATFORM_CONCERN.MAC_COMMANDS> = {};

    const acts: HostActTable<typeof MAC_COMMAND_ACTS> = {
      /** The developer's answer to one ask, by its id; one no longer waiting, answered or timed out, is answered all the same, since the prompt goes with it. */
      MAC_COMMAND_ANSWER: ({ id, decision }) =>
        Effect.gen(function* () {
          const held = asks.get(id);

          if (held === undefined) return;
          yield* Deferred.succeed(held.decided, decision);
        }),
    };

    return { methods, acts, lifetime } satisfies MacCommandsComposer;
  });
}
