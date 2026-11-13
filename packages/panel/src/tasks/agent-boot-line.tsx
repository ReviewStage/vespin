/**
 * agent-boot-line.tsx -- what an agent's empty transcript says while its first launch stands: where it is starting and how long, the agent starting once its machine is up, or a machine that never came up, with Retry.
 *
 * An agent's first launch boots its machine before any turn opens, its
 * first message waiting in its queue (`@repo/features/agent-boot`), so its
 * transcript stands empty meanwhile, and says how the boot stands
 * (`bootLineOf`). While it is under way, that is the transcript's own
 * working line at the log's top, where the first line will land: a cloud
 * sandbox or the agent's Mac starting, counting from when the boot began,
 * then the agent itself once the machine is up, uncounted, or ready,
 * standing still, while an edit holds the first message. A boot that
 * failed says why in the transcript's centered line, with Retry where the
 * reader may message the agent.
 */

import { type AgentBoot, BOOT_PHASE, type BootFailure } from "@repo/features/agent-boot";
import {
  BOOT_WORDS,
  bootFailedWords,
  bootReadyWords,
  bootStartingWords,
} from "@repo/features/agent-boot-words";
import type { AgentMachineKind } from "@repo/features/agent-wire";
import { ACT_KIND } from "@repo/host/acts";
import {
  ANNOUNCE,
  BUTTON_SIZE,
  BUTTON_VARIANT,
  Button,
  RetryIcon,
  TEXT_TONE,
  Text,
} from "@repo/ui";
import { useMutation } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { pressMutation } from "../act-mutations.js";
import { useAnnounceShown } from "../use-announce-shown.js";
import { WorkingLine } from "./working-time.js";

/** What the empty transcript says of a first launch. */
export const BOOT_LINE = {
  /** The machine boots, since when. */
  STARTING: "starting",
  /** The machine is up and the first message is on its way, uncounted: a moment, unless an edit held it, whose wait is no start. */
  HANDING_OFF: "handing-off",
  /** The machine is up and waits on an edit to the first message, which the hand-off stops at. */
  READY: "ready",
  /** The machine never came up. */
  FAILED: "failed",
} as const;

export type BootLine =
  | { readonly kind: typeof BOOT_LINE.STARTING; readonly since: number }
  | { readonly kind: typeof BOOT_LINE.HANDING_OFF }
  | { readonly kind: typeof BOOT_LINE.READY; readonly byReader: boolean }
  | { readonly kind: typeof BOOT_LINE.FAILED; readonly failure: BootFailure | undefined };

/** An edit the queue's first message stands held for, and whether the reader's own box makes it. */
export interface FirstHeld {
  readonly byReader: boolean;
}

/**
 * What the empty transcript says of the boot the page carries; none where
 * it carries none or the boot's first message went. A machine up whose
 * first message is held for an edit reads as ready rather than starting,
 * since nothing moves until the edit ends.
 */
export function bootLineOf(
  boot: AgentBoot | undefined,
  held: FirstHeld | undefined,
): BootLine | undefined {
  if (boot === undefined) return undefined;

  switch (boot.phase) {
    case BOOT_PHASE.STARTING:
      return { kind: BOOT_LINE.STARTING, since: boot.since };
    case BOOT_PHASE.HANDING_OFF:
      // Note that the hand-off is not counted, since the boot keeps when it began and an edit that held its first message would be counted as starting.
      return held === undefined
        ? { kind: BOOT_LINE.HANDING_OFF }
        : { kind: BOOT_LINE.READY, byReader: held.byReader };
    case BOOT_PHASE.FAILED:
      return { kind: BOOT_LINE.FAILED, failure: boot.failure };
    case BOOT_PHASE.READY:
      return undefined;
    default:
      throw new Error(`unhandled boot phase: ${JSON.stringify(boot.phase satisfies never)}`);
  }
}

/**
 * The ready line, standing still while an edit holds the first message, and
 * said politely as it is drawn, since it takes the place of a working line
 * that said itself and says nothing of its own.
 */
function ReadyLine({ byReader }: { byReader: boolean }): ReactNode {
  const words = bootReadyWords(!byReader);
  useAnnounceShown(ANNOUNCE.POLITE, words);

  return <Text tone={TEXT_TONE.MUTED}>{words}</Text>;
}

/** The empty transcript's line while the agent's first launch stands, as `line` says it. */
export function AgentBootLine({
  line,
  machine,
  host,
  retry,
}: {
  line: BootLine;
  /** Where the agent's machine boots, which the line names while it does. */
  machine: AgentMachineKind;
  /** The Mac a local agent boots on, by its own name; none for a sandbox, and where the summary does not name it. */
  host: string | undefined;
  /** The agent Retry boots again, where the reader may, as only one who may message it may; none where they may not, and before the agent is made. */
  retry: string | undefined;
}): ReactNode {
  const { mutate: boot, isPending } = useMutation(pressMutation(ACT_KIND.AGENTS_BOOT));

  switch (line.kind) {
    case BOOT_LINE.STARTING:
      return <WorkingLine startedAt={line.since} words={bootStartingWords(machine, host)} />;
    case BOOT_LINE.HANDING_OFF:
      return <WorkingLine startedAt={undefined} words={BOOT_WORDS.HANDING_OFF} />;
    case BOOT_LINE.READY:
      // Note that it neither shimmers nor counts, because nothing runs until the edit ends.
      return <ReadyLine byReader={line.byReader} />;
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
