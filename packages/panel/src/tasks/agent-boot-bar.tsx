/**
 * agent-boot-bar.tsx -- the strip over an agent's transcript while its first launch boots: Starting… and Running scripts… with how long, a setup that failed, and a machine that never came up with Retry.
 *
 * An agent's first launch boots its machine before any turn opens, its
 * first message waiting in its queue (`@repo/features/agent-boot`), so what
 * it is doing then is said here, over the transcript, rather than as the
 * transcript's working line, which stands only once a turn does. The strip
 * reads the page's word on the boot alone (`bootBarOf`): it goes once the
 * boot's first message went, unless the setup scripts failed, which it
 * keeps saying for the rest of that first turn, and it turns into the
 * failure, with Retry, where the machine never came up.
 */

import { type AgentBoot, BOOT_PHASE, type BootFailure } from "@repo/features/agent-boot";
import { BOOT_WORDS, bootFailedWords, setupFailedWords } from "@repo/features/agent-boot-words";
import { ACT_KIND } from "@repo/host/acts";
import {
  AlertIcon,
  BANNER_LOOK,
  Banner,
  BUTTON_SIZE,
  BUTTON_VARIANT,
  Button,
  RetryIcon,
  Shimmer,
  SPINNER_SIZE,
  SpinnerRing,
  STATUS_TONE,
} from "@repo/ui";
import { useMutation } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { pressMutation } from "../act-mutations.js";
import { WorkingTime } from "./working-time.js";

/** What the strip says of a first launch. */
export const BOOT_BAR = {
  /** The machine boots, since when. */
  STARTING: "starting",
  /** A cloud sandbox runs the workspace's setup scripts, since when. */
  RUNNING_SCRIPTS: "running-scripts",
  /** The machine came up, its setup scripts having ended on a failure. */
  SETUP_FAILED: "setup-failed",
  /** The machine never came up. */
  FAILED: "failed",
} as const;

export type BootBar =
  | { readonly kind: typeof BOOT_BAR.STARTING; readonly since: number }
  | { readonly kind: typeof BOOT_BAR.RUNNING_SCRIPTS; readonly since: number }
  | { readonly kind: typeof BOOT_BAR.SETUP_FAILED; readonly exitCode: number }
  | { readonly kind: typeof BOOT_BAR.FAILED; readonly failure: BootFailure | undefined };

/**
 * What the strip says of the boot the page carries; none where it carries
 * none or the boot handed its first message off with its setup scripts
 * fine. Note that a boot handing its first message off still reads as
 * starting, since nothing has run on it yet.
 */
export function bootBarOf(boot: AgentBoot | undefined): BootBar | undefined {
  if (boot === undefined) return undefined;
  switch (boot.phase) {
    case BOOT_PHASE.STARTING:
      return { kind: BOOT_BAR.STARTING, since: boot.since };
    case BOOT_PHASE.RUNNING_SCRIPTS:
      return { kind: BOOT_BAR.RUNNING_SCRIPTS, since: boot.since };
    case BOOT_PHASE.FAILED:
      return { kind: BOOT_BAR.FAILED, failure: boot.failure };
    case BOOT_PHASE.HANDING_OFF:
    case BOOT_PHASE.READY:
      if (boot.setupExit !== undefined && boot.setupExit !== 0) {
        return { kind: BOOT_BAR.SETUP_FAILED, exitCode: boot.setupExit };
      }
      return boot.phase === BOOT_PHASE.HANDING_OFF
        ? { kind: BOOT_BAR.STARTING, since: boot.since }
        : undefined;
    default:
      throw new Error(`unhandled boot phase: ${JSON.stringify(boot.phase satisfies never)}`);
  }
}

/** A phase under way, shimmering, with how long it has taken. */
function UnderWay({ words, since }: { words: string; since: number }): ReactNode {
  return (
    <>
      <Shimmer>{words}</Shimmer>
      <WorkingTime startedAt={since} />
    </>
  );
}

/** The strip over the agent's transcript while its first launch stands, as `bar` says it; nothing where it says nothing. */
export function AgentBootBar({
  bar,
  retry,
}: {
  bar: BootBar | undefined;
  /** The agent Retry boots again, where the reader may, as only one who may message it may; none where they may not, and before the agent is made. */
  retry: string | undefined;
}): ReactNode {
  const { mutate: boot, isPending } = useMutation(pressMutation(ACT_KIND.AGENTS_BOOT));
  if (bar === undefined) return null;
  switch (bar.kind) {
    case BOOT_BAR.STARTING:
      return (
        <Banner
          look={BANNER_LOOK.STRIP}
          tone={STATUS_TONE.STARTING}
          glyph={<SpinnerRing size={SPINNER_SIZE.SMALL} />}
        >
          <UnderWay words={BOOT_WORDS.STARTING} since={bar.since} />
        </Banner>
      );
    case BOOT_BAR.RUNNING_SCRIPTS:
      return (
        <Banner
          look={BANNER_LOOK.STRIP}
          tone={STATUS_TONE.STARTING}
          glyph={<SpinnerRing size={SPINNER_SIZE.SMALL} />}
        >
          <UnderWay words={BOOT_WORDS.RUNNING_SCRIPTS} since={bar.since} />
        </Banner>
      );
    case BOOT_BAR.SETUP_FAILED:
      return (
        <Banner look={BANNER_LOOK.STRIP} tone={STATUS_TONE.ATTENTION} glyph={<AlertIcon />}>
          {setupFailedWords(bar.exitCode)}
        </Banner>
      );
    case BOOT_BAR.FAILED:
      return (
        <Banner
          look={BANNER_LOOK.STRIP}
          tone={STATUS_TONE.DANGER}
          glyph={<AlertIcon />}
          actions={
            retry !== undefined ? (
              <Button
                size={BUTTON_SIZE.COMPACT}
                variant={BUTTON_VARIANT.OUTLINE}
                icon={<RetryIcon />}
                disabled={isPending}
                onClick={() => boot({ agentId: retry })}
              >
                {BOOT_WORDS.RETRY}
              </Button>
            ) : undefined
          }
        >
          {bootFailedWords(bar.failure)}
        </Banner>
      );
    default:
      throw new Error(`unhandled boot bar: ${JSON.stringify(bar satisfies never)}`);
  }
}
