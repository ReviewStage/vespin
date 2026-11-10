import {
  type AgentSandbox,
  SANDBOX_STATE,
  SANDBOX_STEP,
  type SandboxBootStep,
  type SandboxState,
  type SandboxStep,
} from "@repo/features/agent-sandbox-wire";
import {
  AGENT_SANDBOX_STOP_FAILURE,
  type AgentSandboxStopAnswerView,
  type AgentSandboxStopFailure,
} from "@repo/features/agent-view";
import { FAILURE_SURFACE, failureAboutOf } from "@repo/features/shown-failure";
import { agoText, dueText, workingTime } from "@repo/features/time-format";
import { ACT_KIND } from "@repo/host/acts";
import {
  BUTTON_SIZE,
  BUTTON_VARIANT,
  Button,
  HoverCardActs,
  HoverCardNote,
  type HoverCardStep,
  HoverCardSteps,
  STATUS_TONE,
  STEP_STATE,
  StatusGlyph,
  type StatusTone,
  useSecond,
} from "@repo/ui";
import { GLYPH } from "@repo/ui/icons";
import { Clock, Duration, Effect } from "effect";
import { useEffect, useReducer } from "react";
import { askAct, pressAct } from "../act.js";
import { rendererFork } from "../renderer-runtime.js";
import { useBusyPress } from "../settings/busy-press.js";
import { showToast, TOAST_HOLD } from "../toast.js";
import {
  type SandboxStanding,
  sandboxStandingAt,
  sandboxStandingEdge,
} from "./sandbox-standing.js";

/**
 * sandbox-place.tsx -- where a cloud agent's sandbox stands, as its Cloud chip and the chip's card say it: off, booting, or running.
 *
 * The chip's cloud glyph wears a dot in the state's tone, neutral while off,
 * working while it boots, and complete while it runs, and its words say the
 * state after "Cloud" in the muted ink. The record is read against the
 * window's clock (`sandbox-standing.ts`), and the chip draws again only at
 * the one moment that reading changes on its own, a running sandbox's stop
 * or a boot's stall, so nothing ticks while the chip stands at rest.
 *
 * The card says more under its head: while off, when it stopped and a Wake
 * now that sends the warm call opening the agent sends (`use-warm-agent.ts`),
 * marked as a wake, which lets go a member's hold on a sandbox stopped by
 * hand; while booting, each step of the boot with how long it took, the one
 * under way counting each second, and the steps still to come; while
 * running, how long it has been up and when it stops unless kept on, and,
 * while no turn runs, a Stop now that stops it at once and holds it off, so
 * the warm call an agent on screen sends leaves it stopped until its next
 * message or a Wake now. The card's own
 * clock ticks each second only while the card stands, since only it counts
 * a step's time.
 */

/** The state's word, after "Cloud" on the chip and at the head of the card's line. */
const STATE_WORDS = {
  [SANDBOX_STATE.OFF]: "Off",
  [SANDBOX_STATE.BOOTING]: "Booting",
  [SANDBOX_STATE.RUNNING]: "Running",
} as const satisfies Record<SandboxState, string>;

/** The tone the state's dot is drawn in. */
const STATE_TONE = {
  [SANDBOX_STATE.OFF]: STATUS_TONE.NEUTRAL,
  [SANDBOX_STATE.BOOTING]: STATUS_TONE.WORKING,
  [SANDBOX_STATE.RUNNING]: STATUS_TONE.COMPLETE,
} as const satisfies Record<SandboxState, StatusTone>;

/** Each boot step as the card lists it. */
const STEP_WORDS = {
  [SANDBOX_STEP.CREATING]: "Creating the sandbox",
  [SANDBOX_STEP.RESUMING]: "Resuming from its snapshot",
  [SANDBOX_STEP.CLONING]: "Cloning the repository",
  [SANDBOX_STEP.SETTING_UP]: "Running setup scripts",
  [SANDBOX_STEP.STARTING_AGENT]: "Starting the agent",
} as const satisfies Record<SandboxStep, string>;

/**
 * The steps a boot that began with a step still takes after it, in order.
 * Note that setup scripts are left out, because a boot runs them only where
 * the workspace saved some, which the card cannot know until the step begins.
 */
const STEPS_AFTER = {
  [SANDBOX_STEP.CREATING]: [SANDBOX_STEP.CLONING, SANDBOX_STEP.STARTING_AGENT],
  [SANDBOX_STEP.RESUMING]: [SANDBOX_STEP.STARTING_AGENT],
} as const satisfies Partial<Record<SandboxStep, readonly SandboxStep[]>>;

/** Every step in the order a boot takes them, which places a step to come after the one under way. */
const STEP_ORDER: readonly SandboxStep[] = Object.values(SANDBOX_STEP);

/** What the card says under its line, by state. */
const STATE_NOTE = {
  OFF: "Its disk is kept. Sending a message wakes it.",
  RUNNING_UNTIL: (until: string) =>
    `Stops at ${until} unless a turn or an open window keeps it on. Its disk is kept.`,
} as const;

/** Wake now's and Stop now's words, and what the steps list is called. */
const WAKE_NOW = "Wake now";
const STOP_NOW = "Stop now";
const STOPPING = "Stopping";
const WAKING = "Waking";
const BOOT_STEPS = "Boot steps";

/** Why a Stop now did not stop the sandbox, as its toast says it. */
const STOP_REFUSED_WORDS = {
  [AGENT_SANDBOX_STOP_FAILURE.SANDBOX_IN_USE]:
    "The agent is working, so its sandbox was not stopped.",
  [AGENT_SANDBOX_STOP_FAILURE.NOT_PERMITTED]: "Only the agent's starter can stop its sandbox.",
  [AGENT_SANDBOX_STOP_FAILURE.NOT_FOUND]: "This agent has no sandbox to stop.",
  [AGENT_SANDBOX_STOP_FAILURE.UPSTREAM_ERROR]:
    "The sandbox did not answer, so it was not stopped. Try again.",
  [AGENT_SANDBOX_STOP_FAILURE.UNANSWERED]: "Could not stop the sandbox.",
} as const satisfies Record<AgentSandboxStopFailure, string>;

/**
 * Where `sandbox` stands now, drawn again at the moment the reading would
 * change on its own (`sandboxStandingEdge`) rather than on a tick. Note that
 * the time is read at each draw, so a new record lands against the time it
 * lands at.
 */
export function useSandboxStanding(sandbox: AgentSandbox | undefined): SandboxStanding {
  const [, redraw] = useReducer((count: number) => count + 1, 0);
  const now = Date.now();
  const edge = sandboxStandingEdge(sandbox, now);
  useEffect(() => {
    if (edge === undefined) return undefined;
    return rendererFork(
      Effect.flatMap(Clock.currentTimeMillis, (at) =>
        Effect.andThen(Effect.sleep(Duration.millis(Math.max(0, edge - at))), Effect.sync(redraw)),
      ),
    );
  }, [edge]);
  return sandboxStandingAt(sandbox, now);
}

/** The state's word, as the chip says it after "Cloud". */
export function sandboxWords(standing: SandboxStanding): string {
  return STATE_WORDS[standing.state];
}

/** The cloud glyph wearing the state's dot, said as the state's word. */
export function SandboxGlyph({ standing }: { standing: SandboxStanding }): React.JSX.Element {
  return (
    <StatusGlyph tone={STATE_TONE[standing.state]} label={STATE_WORDS[standing.state]}>
      <GLYPH.CLOUD aria-hidden="true" />
    </StatusGlyph>
  );
}

/** The card's line under "Cloud": the state's word, and when it stopped, how long it has booted, or how long it has been up. */
function sandboxLine(standing: SandboxStanding, now: number): string {
  const words = STATE_WORDS[standing.state];
  switch (standing.state) {
    case SANDBOX_STATE.OFF:
      return standing.since === undefined
        ? words
        : `${words} · stopped ${agoText(standing.since, now)}`;
    case SANDBOX_STATE.BOOTING:
      return `${words} · ${workingTime(now - standing.since)}`;
    case SANDBOX_STATE.RUNNING:
      return `${words} · up ${workingTime(now - standing.since)}`;
  }
}

/** The boot's steps as the card lists them: each begun, done but the last, then the steps still to come. */
function bootSteps(steps: readonly SandboxBootStep[], now: number): HoverCardStep[] {
  const begun = steps.map((step, at): HoverCardStep => {
    const next = steps[at + 1];
    return {
      key: step.step,
      label: STEP_WORDS[step.step],
      state: next === undefined ? STEP_STATE.CURRENT : STEP_STATE.DONE,
      end: workingTime((next?.at ?? now) - step.at),
    };
  });
  const first = steps[0]?.step;
  const current = steps.at(-1)?.step;
  if (first === undefined || current === undefined) return begun;
  const after: readonly SandboxStep[] =
    first === SANDBOX_STEP.CREATING || first === SANDBOX_STEP.RESUMING ? STEPS_AFTER[first] : [];
  const toCome = after
    .filter((step) => STEP_ORDER.indexOf(step) > STEP_ORDER.indexOf(current))
    .map(
      (step): HoverCardStep => ({ key: step, label: STEP_WORDS[step], state: STEP_STATE.TO_DO }),
    );
  return [...begun, ...toCome];
}

/** The card's line under "Cloud", counted on the card's own second. */
export function SandboxLine({ sandbox }: { sandbox: AgentSandbox | undefined }): React.JSX.Element {
  const now = useSecond();
  return <>{sandboxLine(sandboxStandingAt(sandbox, now), now)}</>;
}

/** A Stop now refused, said in a FAILED toast with why, as a refused press is. */
function stopRefused(
  agentId: string,
  answer:
    | Exclude<AgentSandboxStopAnswerView, { readonly stopped: true }>
    | { readonly error: unknown },
): void {
  const failure = "failure" in answer ? answer.failure : AGENT_SANDBOX_STOP_FAILURE.UNANSWERED;
  showToast({
    words: STOP_REFUSED_WORDS[failure],
    tone: STATUS_TONE.DANGER,
    hold: TOAST_HOLD.FAILED,
    failure: {
      surface: FAILURE_SURFACE.ACT,
      act: ACT_KIND.AGENTS_SANDBOX_STOP,
      cause: answer,
      about: failureAboutOf({ agentId }),
    },
  });
}

/** The sandbox stopped and held off; the record that it stopped arrives on the task list. */
async function stoppedNow(agentId: string): Promise<void> {
  const answer = await askAct(ACT_KIND.AGENTS_SANDBOX_STOP, { agentId }).catch(
    (error: unknown) => ({ error }),
  );
  if (!("stopped" in answer)) stopRefused(agentId, answer);
}

/** Stop now, busy until the service answers. */
function StopNow({ agentId }: { agentId: string }): React.JSX.Element {
  const stopping = useBusyPress(() => stoppedNow(agentId));
  return (
    <Button
      variant={BUTTON_VARIANT.OUTLINE}
      size={BUTTON_SIZE.COMPACT}
      busy={stopping.busy}
      busyLabel={STOPPING}
      onClick={stopping.onPress}
    >
      {STOP_NOW}
    </Button>
  );
}

/** Wake now: the warm call marked as a wake, letting go a member's hold, busy until it is taken. */
function WakeNow({ agentId }: { agentId: string }): React.JSX.Element {
  const waking = useBusyPress(() => pressAct(ACT_KIND.AGENTS_WARM, { agentId, wake: true }));
  return (
    <Button
      variant={BUTTON_VARIANT.OUTLINE}
      size={BUTTON_SIZE.COMPACT}
      busy={waking.busy}
      busyLabel={WAKING}
      onClick={waking.onPress}
    >
      {WAKE_NOW}
    </Button>
  );
}

/**
 * What the card says of the sandbox under its note, counted on the card's
 * own second: off, why it is kept and Wake now; booting, its steps;
 * running, when it stops, and Stop now while no turn runs (`atWork`).
 */
export function SandboxStatus({
  agentId,
  sandbox,
  atWork,
}: {
  agentId: string;
  sandbox: AgentSandbox | undefined;
  /** Whether a turn of the agent's runs or is starting, which a stop would cut short. */
  atWork: boolean;
}): React.JSX.Element | null {
  const now = useSecond();
  const standing = sandboxStandingAt(sandbox, now);
  switch (standing.state) {
    case SANDBOX_STATE.OFF:
      return (
        <>
          <HoverCardNote>{STATE_NOTE.OFF}</HoverCardNote>
          <HoverCardActs>
            <WakeNow agentId={agentId} />
          </HoverCardActs>
        </>
      );
    case SANDBOX_STATE.BOOTING:
      return standing.steps.length === 0 ? null : (
        <HoverCardSteps label={BOOT_STEPS} steps={bootSteps(standing.steps, now)} />
      );
    case SANDBOX_STATE.RUNNING:
      return (
        <>
          <HoverCardNote>
            {STATE_NOTE.RUNNING_UNTIL(dueText(standing.runsUntil, now))}
          </HoverCardNote>
          {atWork ? null : (
            <HoverCardActs>
              <StopNow agentId={agentId} />
            </HoverCardActs>
          )}
        </>
      );
  }
}
