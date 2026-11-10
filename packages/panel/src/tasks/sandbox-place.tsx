import {
  type AgentSandbox,
  SANDBOX_STATE,
  type SandboxState,
} from "@repo/features/agent-sandbox-wire";
import { STATUS_TONE, StatusGlyph, type StatusTone, StatusWords } from "@repo/ui";
import { GLYPH } from "@repo/ui/icons";
import { Clock, Duration, Effect } from "effect";
import { useEffect, useReducer } from "react";
import { rendererFork } from "../renderer-runtime.js";
import { sandboxStandingAt, sandboxStandingEdge } from "./sandbox-standing.js";

/**
 * sandbox-place.tsx -- where a cloud agent's sandbox stands, as its Cloud chip draws it: off, booting, or running.
 *
 * The chip's cloud glyph wears a dot in the state's tone, neutral while off,
 * starting while it boots, and complete while it runs, and the chip's
 * popover says the state in words beside the same dot. The record is read
 * against the window's clock (`sandbox-standing.ts`), and the chip draws
 * again only at the one moment that reading changes on its own, a running
 * sandbox's stop or a boot's stall, so nothing ticks while it stands.
 */

/** The state's word, as the popover's Status says it and a reader hears it after "Cloud". */
export const SANDBOX_STATE_WORDS = {
  [SANDBOX_STATE.OFF]: "Off",
  [SANDBOX_STATE.BOOTING]: "Booting",
  [SANDBOX_STATE.RUNNING]: "Running",
} as const satisfies Record<SandboxState, string>;

/** The tone the state's dot is drawn in. */
const STATE_TONE = {
  [SANDBOX_STATE.OFF]: STATUS_TONE.NEUTRAL,
  [SANDBOX_STATE.BOOTING]: STATUS_TONE.STARTING,
  [SANDBOX_STATE.RUNNING]: STATUS_TONE.COMPLETE,
} as const satisfies Record<SandboxState, StatusTone>;

/**
 * Where `sandbox` stands now, drawn again at the moment the reading would
 * change on its own (`sandboxStandingEdge`) rather than on a tick. Note that
 * the time is read at each draw, so a new record lands against the time it
 * lands at.
 */
export function useSandboxState(sandbox: AgentSandbox | undefined): SandboxState {
  const [, redraw] = useReducer((count: number) => count + 1, 0);
  const now = Date.now();
  const edge = sandboxStandingEdge(sandbox, now);
  useEffect(() => {
    if (edge === undefined) return undefined;
    // Note that we read the clock again on waking, because a timer may fire a
    // moment early, and a draw before the edge would find the same edge and
    // arm nothing more.
    const until: Effect.Effect<void> = Effect.flatMap(Clock.currentTimeMillis, (at) =>
      at >= edge
        ? Effect.sync(redraw)
        : Effect.andThen(
            Effect.sleep(Duration.millis(edge - at)),
            Effect.suspend(() => until),
          ),
    );
    return rendererFork(until);
  }, [edge]);
  return sandboxStandingAt(sandbox, now);
}

/** The cloud glyph wearing the state's dot, said as the state's word. */
export function SandboxStateGlyph({ state }: { state: SandboxState }): React.JSX.Element {
  return (
    <StatusGlyph tone={STATE_TONE[state]} label={SANDBOX_STATE_WORDS[state]} hinted={false}>
      <GLYPH.CLOUD aria-hidden="true" />
    </StatusGlyph>
  );
}

/** The state's word led by its dot, as the popover's Status says it. */
export function SandboxStateWords({ state }: { state: SandboxState }): React.JSX.Element {
  return <StatusWords tone={STATE_TONE[state]}>{SANDBOX_STATE_WORDS[state]}</StatusWords>;
}
