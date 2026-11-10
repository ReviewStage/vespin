import { STARTING_GRACE_MILLIS } from "@repo/features/agent-status";
import { GITHUB_TOKEN_REFRESH } from "@repo/features/host-wire";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { Duration } from "effect";
import { REPOSITORY_SANDBOX_CONTRACT } from "../repository-sandbox-contract.js";

/**
 * bounds.ts -- the bounds and names the coding-agent host runs under.
 *
 * A coding agent is one native harness's session over a `coding_agent`
 * conversation, run by the runner we launch on its machine
 * (`runner-sessions.ts`). What differs is named here (how large its sandbox
 * is, `@repo/features/sandbox-size`, aside): how often the repository credential at its firewall is renewed, where
 * its checkout stands, how a transcript read waits, how full its context
 * grows before its harness compacts it, and how much a worker it delegates to
 * may spend. How long an idle sandbox lives is `@repo/sandbox`'s
 * (`SANDBOX_IDLE`).
 */
export const CODER = {
  /** An installation token is good for an hour from its mint; the one at the firewall is renewed this long after, inside that hour, as a host renews its agents' (`@repo/features/host-wire`). */
  GITHUB_TOKEN_REFRESH,
  /** The context window the session is told where the catalog names none for the model. */
  FALLBACK_CONTEXT_WINDOW_TOKENS: 200_000,
  /**
   * The share of the context window past which the retired runtime compacted
   * a session, read by the agent's tab as the line a Codex agent's or a
   * retired runtime agent's context ring turns red at, and by a replay as the
   * room it fits into. It was the retired runtime's own default; no harness is told it now.
   */
  COMPACTION_THRESHOLD_SHARE: 0.9,
  /**
   * What Claude Code holds back from the window before it compacts: the
   * output it reserves, the lesser of the model's most output and 20K, which
   * every model we offer it outputs more than, and its 13K buffer past
   * that. Its own constants, read from the pinned binary; no harness is told
   * them, so a bump of `CLAUDE_CODE_PIN` checks them again.
   */
  CLAUDE_CODE_COMPACTION_RESERVE_TOKENS: 20_000 + 13_000,
  /** Where the agent's checkout stands in its sandbox, which is where the brain's checkout stands too. */
  CHECKOUT_PATH: REPOSITORY_SANDBOX_CONTRACT.PATH.CHECKOUT,
  /** The branches an agent works on; an instruction to the model, enforced by nothing, and how a pull request is told as an agent's (`isAgentBranch`). */
  BRANCH_PREFIX: "agent/",
  /**
   * The prefix agents worked on before `BRANCH_PREFIX`, still read as an
   * agent's, because pull requests opened on it stand open and their
   * reviews, comments, and checks must still wake their agents.
   */
  LEGACY_BRANCH_PREFIX: "luke/",
  /** The most times an agent fixes a failing check on its pull request and pushes again before it stops and says so; an instruction to the model, enforced by nothing. */
  CI_FIX_ROUNDS: 3,
  /** How long a transcript read is held open for a new message while the agent runs, inside the function's own duration. */
  MESSAGES_HOLD: Duration.seconds(20),
  /** How often a held transcript read looks for a new message. */
  MESSAGES_POLL: Duration.millis(500),
  /**
   * How many of a transcript read's independent queries run at once. The
   * function's pool holds five connections (`db/index.ts`), so one read
   * takes at most four and leaves one for the request's other reads.
   */
  READ_CONCURRENCY: 4,
  /**
   * How often a held read of what waits across the account looks for a
   * change. Slower than `MESSAGES_POLL`, because a desktop holds that read
   * for as long as it is signed in, and an item heard a moment later costs
   * the developer nothing.
   */
  ACCOUNT_INBOX_POLL: Duration.seconds(2),
  /**
   * How long a title call may take before its agent or worker goes untitled
   * (`title.ts`), which is also how long after a delegation a read of an
   * ended agent, or of the worker, waits for the worker's title to land.
   */
  TITLE_TIMEOUT: Duration.seconds(20),
  /** The turns an agent is titled in (`title.ts`), past which an untitled agent keeps the model's name and a read waits for no title of its own. */
  TITLE_TURNS: 3,
  /** How long one instance keeps what an agent published before asking GitHub again; a tab asks beside every page of a held read. */
  PUBLISHED_TTL: Duration.seconds(30),
  /** How long what a read of GitHub wrote on an agent's row answers a tab's read on any instance in GitHub's place (`published.ts`). */
  PUBLISHED_ROW_FRESH: Duration.seconds(60),
  /** How long an ended agent's closed pull request on its row answers in GitHub's place, since it may reopen where no webhook says so. */
  PUBLISHED_CLOSED_FRESH: Duration.minutes(10),
  /**
   * How long after its Start an agent with no turn row yet still reads as
   * starting. The Start writes its first line with the turn it queues; an
   * agent still without one past this is read as failed, so nothing reads
   * starting forever and no transcript read is held for it.
   */
  STARTING_GRACE: Duration.millis(STARTING_GRACE_MILLIS),
  /**
   * The lease one call holds on a native agent's runner across reading
   * whether it runs and writing to it or launching it
   * (`runner-sessions.ts`). `HOLD` is how long a lease stands before
   * another call may take it over: past the platform's default function
   * duration of five minutes, so a holder killed mid-launch lets go by
   * then, and longer than a launch with its checkout takes. `WAIT` is how
   * long a call waits behind another's lease before it fails as
   * unavailable, checking every `POLL`. `SEND_WAIT` is that wait for a
   * message handed on in its request: the send runs inside the store's
   * thirty-second dispatch deadline (`AWAITING_LINE_DISPATCH_DEADLINE`),
   * which interrupts it as not taken, so it gives up on a busy lease with
   * ten seconds left for its write and is answered unavailable as such.
   */
  RUNNER_LEASE: {
    HOLD: Duration.minutes(5),
    WAIT: Duration.minutes(2),
    SEND_WAIT: Duration.seconds(20),
    POLL: Duration.millis(250),
  },
  /**
   * How long a Mac's runner stays warm once its turn is over, for the next
   * message to reach it as a line rather than through a relaunched CLI: thirty
   * minutes, because nothing is billed on a host, and every message within it
   * goes into the running session rather than through a relaunched CLI, a new
   * GitHub token, and the last runner's grace. The runner is handed its
   * window, past which it ends itself (`warmForMs`, `@repo/agent-runner`'s
   * `RUNNER_WARM`), `RUNNER_WARM_SLACK` later. Past it, a message we send ends
   * the runner under the lease and relaunches (`sendHolding`), so none is
   * written to a runner about to end itself; a host waiting to switch release
   * has its runner retired at its IDLE (`runnerIdled`), and retires its own
   * warm runners while it waits (`@repo/host`'s `compose-local-agents.ts`).
   *
   * A sandbox's runner has no window of its own: it is launched warm and
   * lives until its sandbox stops, three idle minutes after its last touch
   * (`@repo/sandbox`'s `SANDBOX_IDLE`), bounded only by the runner's own cap
   * (`RUNNER_WARM.IDLE_CAP_MS`).
   */
  RUNNER_WARM: Duration.minutes(30),
  /**
   * How much longer than its window a Mac's warm runner waits before it ends
   * itself: the window runs from the turn's settle, which we stamp after
   * the runner's IDLE, and a message sent just inside it reaches the runner
   * only once its host claims the line, so the runner outlasts both rather
   * than ending under a message on its way.
   */
  RUNNER_WARM_SLACK: Duration.minutes(2),
  /**
   * How long a Stop, a retire, or a reap waits on the exit of a runner that
   * reads its lines, its liveness in place of the 404 a write to an exited
   * command's stdin answers: a command that exited answers within one round
   * trip, and one that runs answers nothing, so the wait is all it costs.
   * A message reads no exit: it is queued for the runner its place records.
   */
  RUNNER_EXIT_READ: Duration.seconds(1),
  /**
   * How long a rewind waits for a native agent's runner to end on its Stop
   * before ending its command: a turn interrupted mid-step settles in a
   * second or two, and a runner that never does is ended rather than left
   * to write to the session the rewind cuts.
   */
  RUNNER_HALT: Duration.seconds(15),
  /**
   * How long a native agent's turn has to end on its Stop once the stop line
   * is written (`runner-sessions.ts`'s `forcedStop`) before its runner is
   * ended and the turn settled canceled. A turn interrupted mid-step ends in
   * a second or two, and the runner ends an interrupt its CLI never answers
   * within `RUNNER_CONTROL.ANSWER_MS`, so one still running past this has a
   * runner that will not end it: ask, wait briefly, then force, rather than
   * leaving it running until its lease runs out.
   */
  STOP_CONFIRM: Duration.seconds(10),
  /**
   * How a resume past a message's answer that meets its sandbox still
   * stopping or being snapshotted (Vercel's 422 `sandbox_stopping` or
   * `sandbox_snapshotting`) is tried again: every `SPACING`, at most `TRIES`
   * times, about a minute, which a turn's stop and its snapshot end within,
   * and well under the five minutes work past an answer may run. A resume
   * inside a request tries once more at once instead, since a wait there
   * would outlast the store's dispatch deadline.
   */
  RESUME_WHILE_ENDING: { SPACING: Duration.seconds(2), TRIES: 30 },
} as const;

/** Why the host refused a session's standing or a step, in words a log or a failed turn can carry. */
export const CODER_REFUSAL = {
  NO_AGENT: "Not run: this conversation is no agent's.",
  NO_REPOSITORY: "Not run: the agent works in no repository.",
  /** No step is refused this way since Fast runs on an account's own key; kept for the turns that were refused so before, which still read as this. */
  FAST_ON_OWN_KEY: `Not run: Fast isn't available on your own API key; ${PRODUCT_NAME} runs Fast on its own Anthropic key alone. Choose the model with Fast off.`,
  /** No step fails this way since a refused fast call runs at standard speed; kept for the turns that failed so before, which still read as this. */
  FAST_NOT_ENABLED:
    "Not run: Fast mode isn't enabled for this Anthropic organization. Choose the model with Fast off.",
  /** No step is refused for its own key this way since agents left the retired runtime, whose steps ran on it; kept with the two below for the turns refused so before, which still read as these. */
  ACCOUNT_KEY_UNREADABLE:
    "Not run: your own API key for the agent's model provider cannot be read. Replace it in Settings.",
  ACCOUNT_KEY_REFUSED:
    "Not run: the provider refused your own API key for the agent's model. Replace it in Settings.",
  ACCOUNT_KEY_NO_QUOTA:
    "Not run: the provider refused the work for your own API key's billing or quota.",
  NOT_REACHABLE:
    "Not run: the agent's repository is not reachable through the GitHub installation connected to its task's workspace.",
  GITHUB_UNAVAILABLE: "Not run: GitHub could not be asked for the repository's credential.",
} as const;

export type CoderRefusal = (typeof CODER_REFUSAL)[keyof typeof CODER_REFUSAL];

/** Whether a branch is one an agent works on, under today's prefix or the one before it. */
export function isAgentBranch(branch: string): boolean {
  return branch.startsWith(CODER.BRANCH_PREFIX) || branch.startsWith(CODER.LEGACY_BRANCH_PREFIX);
}
