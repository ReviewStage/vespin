/**
 * agent-machine.ts -- the machine a native coding agent runs on, as the one interface its launch and our doors to its files reach it through.
 *
 * A native agent's runner (`@repo/agent-runner`) runs on a machine we
 * open for it, today a cloud sandbox (`sandbox-machine.ts`). Its launch
 * (`../coder-host/runner-sessions.ts`) and the door our MCP tools read
 * a file through (`../workspace-mcp/sandbox-door.ts`) reach that machine here
 * and nowhere else, so a second kind of machine shares one launch path and
 * one door rather than a copy of each that drifts.
 *
 * The interface is pitched at intent and holds only what the launch and the
 * door use: where the agent's things stand on the machine (`layout`), open
 * the agent's place with its checkout, find it again and record the runner
 * it runs, set and take off what stands at its firewall, resume, stop,
 * and discard it, write files into it, launch the runner there and write
 * its stdin, read whether it ended, end it, read one file, and make an MP4
 * of a recording for a phone (`phone-video.ts`). A runner on a
 * machine whose layout says it reads its lines takes them from our store
 * instead (`../coder-host/runner-sessions.ts`), and its stdin carries only
 * its config. What a
 * machine keeps of its own beyond that (a sandbox's snapshots, the
 * Terminal, the browser) stays outside it until a second machine needs it.
 *
 * Two machines answer it: a cloud sandbox (`sandbox-machine.ts`) and the
 * starter's Mac (`device-machine.ts`), which the agent's row picks between
 * (`agent.machine`, `agent-machines.ts`).
 *
 * A place is named by our own runtime session id, which the conversation
 * records and every machine can find its place by, and by where the session
 * runs now, which is the machine's own and opaque to everyone else. A door
 * holds the session id alone, so a door's call names only that.
 *
 * What fails answers a sandbox's failure (`SandboxError`); a runner that has
 * ended answers `SandboxGone` to a write, which is how a caller tells it from
 * a machine that did not answer.
 */

import type { LaunchPath } from "@repo/agent-runner/protocol";
import type { DatabaseServices, StoreFailure } from "@repo/database/core/query";
import type { Agent } from "@repo/database/models/agent-store";
import type { TurnCheckoutSnapshot } from "@repo/database/models/turn-state";
import type { ConversationTarget } from "@repo/database/models/writer";
import type { AgentPermissionMode } from "@repo/features/agent-approval-wire";
import type { AgentMachineKind } from "@repo/features/agent-wire";
import type { CheckoutDiffRange } from "@repo/features/checkout-diff";
import type { CommandExit, SandboxError, SandboxFile } from "@repo/sandbox";
import {
  type Brand,
  Context,
  Data,
  type Duration,
  type Effect,
  type Option,
  type Redacted,
} from "effect";
import type { AgentImage, AgentImageMissing } from "../coder-host/agent-image.js";
import type {
  AgentRepositoryRead,
  CheckoutRefused,
  CheckoutServices,
} from "../coder-host/checkout.js";
import type {
  FirewallLaunch,
  FirewallSources,
  LaunchSwapKind,
  LaunchSwaps,
  PlaceholderSwap,
} from "../sandbox-firewall.js";
import type { KeyRefusal, PlanRefusal } from "../sessions/agent-sessions.js";
import type { AgentSandbox } from "../terminal/agent-sandbox.js";

/** Where a session runs now, as its machine names it: a sandbox's run, or a local agent's id on its Mac. Opaque to every caller but the machine. */
export type MachineRunning = string & Brand.Brand<"MachineRunning">;

/** What a machine's own lifecycle calls a place: a sandbox's name, or a local agent's id. Opaque to every caller but the machine. */
export type MachineName = string & Brand.Brand<"MachineName">;

/** What a machine keeps of a place it found, for its own later calls on it. Opaque to every caller but the machine. */
export type MachineKept = Brand.Brand<"MachineKept">;

/** One agent's place on a machine: which machine, our runtime session id, the place's lifecycle name, and where that session runs now. */
export interface MachinePlace {
  readonly machine: AgentMachineKind;
  readonly session: string;
  readonly name: MachineName;
  readonly running: MachineRunning;
}

/**
 * Where a machine keeps an agent's things, decided from the agent alone, so
 * a launch names them before the machine is asked anything: its checkout,
 * where the harness starts and the instructions name, where the member's
 * installed skills are installed and where they are written for that, none
 * on a machine whose agents are handed none, the folder a message's files are written under, the Claude Code CLI and the
 * Codex a launch runs, none where the harness's own default stands, and the
 * home Codex keeps its threads in.
 */
export interface MachineLayout {
  readonly checkoutPath: string;
  /** Where the member's installed skills are installed, which a launch's config names: a sandbox's; none on a device, whose harnesses find whatever skills the machine's own home holds. */
  readonly installedSkills: string | undefined;
  /** Where the member's installed skills are written for that; none where they are not installed. */
  readonly skillsUpload: string | undefined;
  readonly attachments: string;
  /** Where the agent saves a file the service reads back, a screenshot it shows or a page it posts: a folder the service's reads reach on that machine. */
  readonly sharedFiles: string;
  readonly claudeExecutable: string | undefined;
  /** The image's Codex in a sandbox, and on a Mac the one it checked against the pin; none on a Mac that checked none yet, which runs no Codex agent. */
  readonly codexExecutable: string | undefined;
  /** Where Codex keeps its threads (`CODEX_HOME`): a sandbox's home on its persisted disk; none on a Mac, whose Codex keeps its own default under the machine's home, which its runner finds by itself. */
  readonly codexHome: string | undefined;
  /**
   * Whether the runner reads its lines past its config from the service
   * (`@repo/agent-runner`'s `RUNNER_LINES`), as a sandbox's does, rather than
   * from its stdin, as a Mac's follower writes them to the runner its
   * release bundled.
   */
  readonly linesRead: boolean;
  /**
   * Whether the runner keeps the CLI's transcript at the service
   * (`@repo/agent-runner`'s `RUNNER_TRANSCRIPTS`), as a sandbox's does, so
   * a place made anew still resumes the CLI's session, and a continue or
   * fork elsewhere carries it; a Mac's whose release bundles a runner that
   * keeps it (`MAC_MACHINE.TRANSCRIPTS_SINCE`), and none on an older Mac,
   * whose CLI keeps its own files on the Mac alone.
   */
  readonly transcriptsKept: boolean;
  /**
   * Whether a session the store does not hold whole still resumes from the
   * CLI's own files where the place was not made anew, the store left out
   * of that launch: a Mac's, whose sessions begun before it kept
   * transcripts stand on its disk alone; a sandbox's such session is let go.
   */
  readonly diskSessions: boolean;
  /**
   * Whether the runner runs the agent in the mode its config names
   * (`@repo/agent-runner`'s `PERMISSION_MODE`): a sandbox's, and a device's
   * whose host registered that its runner does
   * (`DEVICE_CAPABILITY.PERMISSION_MODES`); an older device's runs every
   * agent with full access whatever mode it is handed.
   */
  readonly permissionModes: boolean;
}

/** What a later call reads of a launch: its first event number, and what it was started with, as a digest (`runner-sessions.ts`'s `launchFingerprint`). */
export interface RunnerMark {
  readonly firstSequence: number;
  /** None for a launch from before fingerprints were recorded. */
  readonly fingerprint?: string;
  /** The permission mode the launch runs its agent in; none for a launch from before it was recorded, and for a Mac's, whose sends never pass it by. */
  readonly permissionMode?: AgentPermissionMode;
  /** Whether the launch reads its lines from the service (`MachineLayout`'s `linesRead`); none for one the service writes them to the stdin of, a launch from before the read among them. */
  readonly linesRead?: boolean;
}

/** A runner as its machine recorded it: the handle a later call writes to, and its launch's mark. */
export interface RecordedRunner {
  readonly handle: RunnerHandle;
  readonly mark: RunnerMark;
}

/** What a place's record says of its runner. */
export const RUNNER_RECORD = {
  /** No runner, nor any launch to tell a late END by. */
  NONE: "none",
  /** A launch to tell a late END by, and no runner a call writes to. */
  LAUNCHED: "launched",
  /** A runner a call writes to. */
  RUNNING: "running",
} as const;

export type RunnerRecord =
  | { readonly kind: typeof RUNNER_RECORD.NONE }
  | { readonly kind: typeof RUNNER_RECORD.LAUNCHED; readonly mark: RunnerMark }
  | { readonly kind: typeof RUNNER_RECORD.RUNNING; readonly runner: RecordedRunner };

/** A place as a later call finds it by its session. */
export interface FoundPlace {
  readonly machine: AgentMachineKind;
  readonly session: string;
  /** The agent the place was opened for, where it names one. */
  readonly agentId: string | undefined;
  /** The place's lifecycle name, which its record is kept under. */
  readonly name: MachineName;
  /** Where the place runs now; none where it is stopped. */
  readonly running: MachinePlace | undefined;
  /** The runner recorded, where the place still runs in the session it was started in, whether or not it has exited since. */
  readonly runner: RecordedRunner | undefined;
  /** The launch recorded last, which a late END is told by; none where none is. */
  readonly launch: RunnerMark | undefined;
  readonly kept: MachineKept;
}

/**
 * A found place running again: where it runs now, and whether it was made
 * anew in place of one whose disk was lost (`created`), which holds nothing
 * the place kept on its disk, the harness's own session among it.
 */
interface ResumedPlace {
  readonly place: MachinePlace;
  readonly created: boolean;
}

/**
 * A running place's firewall, the account whose agent it is named beside
 * it: the whole policy written from the sources given and the swaps of the
 * launch kept for it; or a launch's swaps kept ahead of its first write
 * (`../sandbox-firewall.ts`). A machine with no firewall of ours does nothing.
 */
interface MachineFirewall {
  readonly write: (
    place: MachinePlace,
    userId: string,
    sources: FirewallSources,
  ) => Effect.Effect<void, SandboxError, DatabaseServices>;
  readonly keepLaunch: (
    place: MachinePlace,
    userId: string,
    launch: FirewallLaunch,
  ) => Effect.Effect<void, SandboxError, DatabaseServices>;
}

/**
 * A credential a launch declares for its runner, which the machine decides
 * how to hand over (`deliverCredentials`): the variable the runner reads it
 * in, its value, without its scheme, where the runner sends it (the domain,
 * and the path prefix where one is named), in which header, named in lower
 * case, behind which scheme (`Bearer ` or nothing), and the slot a
 * firewall holds it in. Each is fixed for its launch: a Mac hands it to the
 * runner, and a sandbox holds it at its firewall.
 */
export interface RunnerCredential {
  readonly variable: string;
  readonly value: Redacted.Redacted<string>;
  readonly target: Pick<PlaceholderSwap, "domain" | "path">;
  readonly header: string;
  readonly scheme: string;
  readonly slot: LaunchSwapKind;
}

/** Credentials as a machine hands them over: the variables the runner is started with, every one secret, and the swaps its place's firewall keeps for the launch, none on a machine with no firewall of ours. */
export interface DeliveredCredentials {
  readonly env: Readonly<Record<string, string>>;
  readonly swaps: LaunchSwaps;
}

/** What a checkout's restore came to: put back, the snapshot not in the checkout any more, a failure, or a machine that restores none, a Mac whose host predates the line. */
export const RESTORE_OUTCOME = {
  RESTORED: "restored",
  MISSING: "missing",
  FAILED: "failed",
  UNSUPPORTED: "unsupported",
} as const;

export type RestoreOutcome = (typeof RESTORE_OUTCOME)[keyof typeof RESTORE_OUTCOME];

/** What a diff of a session's checkout came to: diffed, a commit it was handed missing from the checkout, the diff failed, or a machine that diffs none. */
export const CHECKOUT_DIFF_OUTCOME = {
  DIFFED: "diffed",
  MISSING: "missing",
  FAILED: "failed",
  UNSUPPORTED: "unsupported",
} as const;

/** The outcome of a diff: the diff git printed where it diffed, and why not otherwise. */
export type CheckoutDiffOutcome =
  | { readonly outcome: typeof CHECKOUT_DIFF_OUTCOME.DIFFED; readonly diff: string }
  | {
      readonly outcome: Exclude<
        (typeof CHECKOUT_DIFF_OUTCOME)[keyof typeof CHECKOUT_DIFF_OUTCOME],
        typeof CHECKOUT_DIFF_OUTCOME.DIFFED
      >;
    };

/** A runner launched in a place: the place, and the machine's own id for the runner's process. */
export interface RunnerHandle extends MachinePlace {
  readonly command: string;
}

/** What a machine's calls reach of the caller's services: the store, GitHub, and the agents' image. */
type MachineServices = CheckoutServices | AgentImage;

/** A launch could not start: no agent, no credential, no snapshot, a model the harness cannot name, or the account's plan or API key refused. */
export class LaunchRefused extends Data.TaggedError("LaunchRefused")<{
  readonly reason: string;
  /** How the account's plan failed, where it is why. */
  readonly planRefusal?: PlanRefusal | undefined;
  /** How the account's API key failed, for an agent it pays for, where it is why. */
  readonly keyRefusal?: KeyRefusal | undefined;
  /** When a reached limit resets, in epoch milliseconds, where the provider said. */
  readonly planResetsAt?: number | undefined;
  /** Whether the agent's device is a host its account removed, which no message brings back. */
  readonly deviceRemoved?: true | undefined;
  /** Whether the agent's device has not beaten lately, so nothing it is sent would be taken until it is back. */
  readonly deviceAway?: true | undefined;
  /** Whether the agent's mode asks before it acts and its device's runner would run it with full access (`MachineLayout`'s `permissionModes`). */
  readonly modesUnsupported?: true | undefined;
}> {}

/** What an open asks: the session the place is opened under, the agent whose repository it checks out, and the reads run beside it. */
/**
 * The workspace's cloud setup scripts as an open hands them to a sandbox
 * it creates (Settings › Cloud environment): its install script and the agent's
 * repository's setup script, each where one is saved, and the workspace's
 * variables the setup script runs with, every one of them secret.
 */
export interface SandboxSetup {
  readonly install?: string | undefined;
  readonly repository?: string | undefined;
  readonly environment: Readonly<Record<string, string>>;
}

export interface MachineOpen<B, EB, RB> {
  readonly session: string;
  /** The account and conversation the open acts for: the agent's starter's. */
  readonly target: ConversationTarget;
  readonly agent: Agent;
  /** How the log names the agent's harness. */
  readonly harness: string;
  /** The caller's reads that need no place, run beside the open, whose result `use` is handed. */
  readonly beside: Effect.Effect<B, EB, RB>;
  /**
   * The agent's repository read on its write token, minted once for the
   * start and shared by whatever asks for it (`agentRepositoryRead`), none for
   * an agent with no repository: a sandbox's open starts it at once and
   * checks out on it; a device's open never asks for it.
   */
  readonly repositoryToken: Effect.Effect<AgentRepositoryRead | undefined, CheckoutRefused>;
  /** The workspace's cloud setup scripts, which a sandbox the open creates runs after its checkout; none where none is saved, and nothing on a machine that runs none, a device's. */
  readonly setup?: Effect.Effect<SandboxSetup | undefined> | undefined;
}

/** A place opened: where it stands, its lifecycle's own name for it, where the agent's checkout is, and what is left of the checkout to run beside the launch. */
export interface OpenedPlace {
  readonly place: MachinePlace;
  readonly name: MachineName;
  readonly checkoutPath: string;
  /** The checkout's last step, which the launch's `ready` runs: nothing where the open left nothing to do. */
  readonly finishCheckout: Effect.Effect<void, { readonly _tag: string }>;
  /** How the place came to stand, as the launch's trace names it; none on a machine that opens every place one way. */
  readonly path?: LaunchPath;
}

/** What a launch starts the runner with, and what it waits on before it does. */
export interface RunnerLaunch<A, E, R, EL, RL, ES = never, RS = never> {
  /**
   * The runner's environment beside the machine's own: every value is
   * secret, the harness's credential and the runner's bearer among them, and
   * is written nowhere but the runner's environment, never its argv, a file,
   * or a log.
   */
  readonly env: Readonly<Record<string, string>>;
  /** The account the runner's record is kept under: the agent's starter's. */
  readonly userId: string;
  /** The agent the runner is launched for, whose place's record names it. */
  readonly agentId: string;
  /** The place's lifecycle name, which the runner is recorded under. */
  readonly name: MachineName;
  /**
   * The caller's steps the runner's start itself waits on, such as its
   * record and the checkout it works in; none where its start waits on
   * nothing of the caller's. A machine that can start the runner before
   * handing it its first lines starts it once these are done, beside
   * `ready`.
   */
  readonly started?: Effect.Effect<void, ES, RS>;
  /** The caller's steps the runner waits on for its first lines, run beside the machine's own; their result is handed back. */
  readonly ready: Effect.Effect<A, E, R>;
  /**
   * The runner's first lines and its launch's mark, read once it started
   * and before it reads anything: the machine records the runner under the
   * mark before it hands the lines over, so a runner never takes a line
   * before a later call can find it. The lines go with the launch itself,
   * so a machine that seals the launch seals them with it.
   */
  readonly firstLines: (
    ready: A,
    handle: RunnerHandle,
  ) => Effect.Effect<{ readonly lines: string; readonly mark: RunnerMark }, EL, RL>;
  /** What the caller undoes where the runner started but never took its first lines, run once it is ended; a failure of it is let be. */
  readonly abandon: (ready: A) => Effect.Effect<void, { readonly _tag: string }, RL>;
}

/** How a file written for the agent under its attachments folder is kept: readable by every user, written by none but the machine's. */
export const ATTACHMENT_FILE_MODE = 0o644;

export interface AgentMachineService {
  /** Where the machine keeps the agent's things. */
  readonly layout: (
    agent: Agent,
  ) => Effect.Effect<MachineLayout, LaunchRefused | { readonly _tag: string }>;
  /**
   * The credentials a launch of the agent's runner declares, as the machine
   * hands them over: in a sandbox, each held at its firewall behind a
   * placeholder minted for the launch, which the variable carries in its
   * place, so no value enters the machine; on a Mac, which has no firewall
   * of ours, a fixed one in its variable and a renewed one not at all.
   */
  readonly deliverCredentials: (
    agent: Agent,
    credentials: readonly RunnerCredential[],
  ) => DeliveredCredentials;
  /**
   * The agent's place opened under the session, its repository checked out
   * there where it has one, and handed to `use`; a place `use` fails in is
   * left standing for the session's next message.
   */
  readonly open: <A, E, R, B, EB, RB>(
    ask: MachineOpen<B, EB, RB>,
    use: (opened: OpenedPlace, beside: B) => Effect.Effect<A, E, R>,
  ) => Effect.Effect<
    A,
    E | EB | LaunchRefused | { readonly _tag: string },
    R | RB | MachineServices
  >;
  /** The place opened under the account's session; none where none stands. */
  readonly findPlace: (
    userId: string,
    session: string,
  ) => Effect.Effect<Option.Option<FoundPlace>, SandboxError | StoreFailure, DatabaseServices>;
  /** What the place's record says of its runner, in place of whatever it said, kept under the account given. */
  readonly recordRunner: (
    place: {
      readonly machine: AgentMachineKind;
      readonly session: string;
      readonly name: MachineName;
      readonly userId: string;
      readonly agentId: string;
    },
    record: RunnerRecord,
  ) => Effect.Effect<void, SandboxError | StoreFailure, DatabaseServices>;
  /** The running place's firewall, every write to it composing what stands whole. */
  readonly firewall: MachineFirewall;
  /**
   * The agent's found place run again, where it is not, and where it runs
   * now: made anew on the machine's own terms where its disk is lost, the
   * workspace's cloud setup scripts run in it where it was made anew on a
   * checkout it kept (`setup`).
   */
  readonly resume: (
    found: FoundPlace,
    agent: Agent,
    setup?: Effect.Effect<SandboxSetup | undefined>,
  ) => Effect.Effect<
    ResumedPlace,
    SandboxError | CheckoutRefused | AgentImageMissing,
    AgentImage | DatabaseServices
  >;
  /** The running place stopped, its disk kept for a later resume. */
  readonly stop: (place: MachinePlace) => Effect.Effect<void, SandboxError>;
  /** The found place thrown away, with whatever runs in it and its record. */
  readonly discard: (
    found: FoundPlace,
  ) => Effect.Effect<void, SandboxError | StoreFailure, DatabaseServices>;
  /** Files written into the running place, as the machine's default user, before a later line names them; refused (`LaunchRefused`'s `deviceAway`) where they would go to a device that is away, as the line naming them would be. */
  readonly writeFiles: (
    place: MachinePlace,
    files: readonly SandboxFile[],
  ) => Effect.Effect<void, SandboxError | LaunchRefused>;
  /**
   * The agent's own checkout cloned before a relaunch where the running
   * place holds none, the workspace's cloud setup scripts run after that
   * clone (`setup`). Nothing on a machine that clones nothing for a
   * launch, a device's, nor for an agent with no repository.
   */
  readonly checkOutMissing: (
    place: MachinePlace,
    target: ConversationTarget,
    agent: Agent,
    setup?: Effect.Effect<SandboxSetup | undefined>,
  ) => Effect.Effect<void, CheckoutRefused | SandboxError, CheckoutServices>;
  /** The runner launched in the place once `started` is done, recorded, and handed its first lines once `ready` is; ended again where they were not taken, or where `ready` failed. */
  readonly launchRunner: <A, E, R, EL, RL, ES = never, RS = never>(
    place: MachinePlace,
    launch: RunnerLaunch<A, E, R, EL, RL, ES, RS>,
  ) => Effect.Effect<
    { readonly handle: RunnerHandle; readonly ready: A },
    E | EL | ES | SandboxError | { readonly _tag: string },
    R | RL | RS | MachineServices
  >;
  /**
   * Text appended to the runner's stdin after whatever it already took;
   * `SandboxGone` where the runner has ended, and refused
   * (`LaunchRefused`'s `deviceAway`) where a line that carries more than a
   * stop goes to a device that is away. Note that a line written
   * here is not sealed, and a Mac keeps its lines in the store until it
   * takes them, so no line may carry a secret: Codex asks the service for each
   * access token over HTTPS through the runner's token command
   * (`@repo/agent-runner`'s `codex-token.ts`) rather than taking it on stdin.
   * A machine whose runner reads its lines (`MachineLayout`'s `linesRead`),
   * as a sandbox's does, is never written to here.
   */
  readonly writeLine: (
    handle: RunnerHandle,
    text: string,
  ) => Effect.Effect<void, SandboxError | LaunchRefused>;
  /**
   * Whether the text given was written to the runner since its launch, as
   * one write, where the machine keeps what it wrote: a Mac keeps its lines
   * in the store. A sandbox keeps nothing of its runner's stdin, and its
   * runner reads its lines from the service, which its END hands on, so it answers
   * false.
   */
  readonly wrote: (handle: RunnerHandle, text: string) => Effect.Effect<boolean, SandboxError>;
  /**
   * The session's checkout put back to the snapshot its runner took before
   * a turn, by the one restore script both machines run
   * (`@repo/features/checkout-restore`), once the runner is ended: in a
   * sandbox, woken where it stopped; on a Mac, by a restore line its host
   * follows and settles with the script's exit. Refused (`LaunchRefused`)
   * where the Mac is away or removed, as a line to it is. A sandbox's
   * restore is a use of it, recorded in the store (`../sandbox-use.ts`).
   */
  readonly restoreCheckout: (
    session: string,
    snapshot: TurnCheckoutSnapshot,
  ) => Effect.Effect<RestoreOutcome, SandboxError | LaunchRefused, DatabaseServices | AgentSandbox>;
  /**
   * The diff of the session's checkout between two snapshots its runner
   * recorded, or one and the working tree, by the one diff script both
   * machines run (`@repo/features/checkout-diff`): in a sandbox, woken where
   * it stopped; on a Mac, asked of its host. Refused (`LaunchRefused`) where
   * the Mac is away or removed, as a line to it is. A sandbox's diff is a
   * use of it, recorded in the store (`../sandbox-use.ts`).
   */
  readonly diffCheckout: (
    session: string,
    range: CheckoutDiffRange,
  ) => Effect.Effect<
    CheckoutDiffOutcome,
    SandboxError | LaunchRefused,
    DatabaseServices | AgentSandbox
  >;
  /** The runner's exit code, null while it runs, or gone where the machine no longer knows it; waiting at most `within` for the exit. */
  readonly runnerExit: (
    handle: RunnerHandle,
    within?: Duration.Duration,
  ) => Effect.Effect<CommandExit, SandboxError>;
  /** Ends the runner; one already gone counts as ended. */
  readonly kill: (handle: RunnerHandle) => Effect.Effect<void, SandboxError>;
  /**
   * One file of the session's place, read as the agent's own user, never as
   * root: at most one byte past `bound`, so a caller still sees a file
   * larger than it; nothing where that user reads no such file.
   */
  readonly readFile: (
    session: string,
    path: string,
    bound: number,
  ) => Effect.Effect<Uint8Array | undefined, SandboxError>;
  /**
   * One file written into the session's place, under the folder a message's
   * files are written under (`MachineLayout`'s `attachments`) at the
   * relative path given, readable by the agent's own user, as a message's
   * file is (`ATTACHMENT_FILE_MODE`); answers where it stands there once it
   * does. Unavailable where the place is not up, and refused
   * (`LaunchRefused`'s `deviceAway`) where it would go to a Mac that is away.
   */
  readonly writeFile: (
    session: string,
    file: { readonly name: string; readonly contents: Uint8Array },
  ) => Effect.Effect<string, SandboxError | LaunchRefused>;
  /**
   * An H.264 MP4 of the WebM recording at the path, made on the session's
   * place as the agent's own user (`phone-video.ts`), for a player that
   * plays no WebM; nothing where the place has no encoder, as a Mac and a
   * sandbox on an older image have none, or the copy would not fit.
   */
  readonly phoneVideo: (
    session: string,
    path: string,
  ) => Effect.Effect<Uint8Array | undefined, SandboxError>;
}

/** What a machine does to a place it already opened: everything but where it keeps things, opening a place or running it again, checking out what the place does not hold yet, handing a runner its credentials, and launching a runner in it. */
export type MachineLifecycle = Omit<
  AgentMachineService,
  "layout" | "open" | "resume" | "checkOutMissing" | "deliverCredentials" | "launchRunner"
>;

export class AgentMachine extends Context.Service<AgentMachine, AgentMachineService>()(
  "AgentMachine",
) {}
