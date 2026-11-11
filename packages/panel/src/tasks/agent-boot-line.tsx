/**
 * agent-boot-line.tsx -- what an agent's empty transcript says while its first launch stands: Starting… with how long, or a machine that never came up, with Retry.
 *
 * An agent's first launch boots its machine before any turn opens, its
 * first message waiting in its queue (`@repo/features/agent-boot`), so its
 * transcript stands empty meanwhile, and its centered line says how the
 * boot stands in place of the starting line (`bootLineOf`). Starting…
 * stands still beside how long, counted as the working line counts; a boot
 * that failed says why, with Retry where the reader may message the agent.
 */

import { type AgentBoot, BOOT_PHASE, type BootFailure } from "@repo/features/agent-boot";
import { BOOT_WORDS, bootFailedWords } from "@repo/features/agent-boot-words";
import { ACT_KIND } from "@repo/host/acts";
import { BUTTON_SIZE, BUTTON_VARIANT, Button, RetryIcon, TEXT_TONE, Text } from "@repo/ui";
import { useMutation } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { pressMutation } from "../act-mutations.js";
import { WorkingTime } from "./working-time.js";

/** What the empty transcript says of a first launch. */
export const BOOT_LINE = {
  /** The machine boots, or its first message is on its way, since when. */
  STARTING: "starting",
  /** The machine never came up. */
  FAILED: "failed",
} as const;

export type BootLine =
  | { readonly kind: typeof BOOT_LINE.STARTING; readonly since: number }
  | { readonly kind: typeof BOOT_LINE.FAILED; readonly failure: BootFailure | undefined };

/**
 * What the empty transcript says of the boot the page carries; none where
 * it carries none or the boot's first message went. Note that a boot
 * handing its first message off still reads as starting, since nothing has
 * run on it yet.
 */
export function bootLineOf(boot: AgentBoot | undefined): BootLine | undefined {
  if (boot === undefined) return undefined;
  switch (boot.phase) {
    case BOOT_PHASE.STARTING:
    case BOOT_PHASE.HANDING_OFF:
      return { kind: BOOT_LINE.STARTING, since: boot.since };
    case BOOT_PHASE.FAILED:
      return { kind: BOOT_LINE.FAILED, failure: boot.failure };
    case BOOT_PHASE.READY:
      return undefined;
    default:
      throw new Error(`unhandled boot phase: ${JSON.stringify(boot.phase satisfies never)}`);
  }
}

/** The empty transcript's centered line while the agent's first launch stands, as `line` says it. */
export function AgentBootLine({
  line,
  retry,
}: {
  line: BootLine;
  /** The agent Retry boots again, where the reader may, as only one who may message it may; none where they may not, and before the agent is made. */
  retry: string | undefined;
}): ReactNode {
  const { mutate: boot, isPending } = useMutation(pressMutation(ACT_KIND.AGENTS_BOOT));
  switch (line.kind) {
    case BOOT_LINE.STARTING:
      return (
        <Text tone={TEXT_TONE.MUTED}>
          {BOOT_WORDS.STARTING}
          <WorkingTime startedAt={line.since} />
        </Text>
      );
    case BOOT_LINE.FAILED:
      return (
        <>
          <Text tone={TEXT_TONE.MUTED}>{bootFailedWords(line.failure)}</Text>
          {retry === undefined ? null : (
            <Button
              size={BUTTON_SIZE.COMPACT}
              variant={BUTTON_VARIANT.OUTLINE}
              icon={<RetryIcon />}
              disabled={isPending}
              onClick={() => boot({ agentId: retry })}
            >
              {BOOT_WORDS.RETRY}
            </Button>
          )}
        </>
      );
    default:
      throw new Error(`unhandled boot line: ${JSON.stringify(line satisfies never)}`);
  }
}
