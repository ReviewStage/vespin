/**
 * use-automations.ts -- a workspace's automations and one automation's runs on the phone, followed while a screen draws them, and the two writes it offers on them: Run now and the switch, the panel's reads and acts (`@repo/panel`'s `use-automations.ts`, `use-automation-runs.ts`) for Settings' Automations pages.
 *
 * Each read is held on the host while its page stands (`AUTOMATIONS_FOLLOW`),
 * which writes it into the document, read here by its id, so a run a press
 * started, its agent moving on, and a switch turned elsewhere reach the page
 * with no read of its own. A read that failed is asked again by Try again
 * (`AUTOMATIONS_RETRY`). A switch turned is drawn by the host the moment it
 * is asked and turned back where the service refuses it, so the page holds no
 * write of its own; each goes through `useWrite`, which says a refusal.
 */

import { AUTOMATION_FOLLOW } from "@repo/features/automation-view";
import type { AutomationRunSummary, AutomationSummary } from "@repo/features/automation-wire";
import {
  AUTOMATION_PHONE_WORDS,
  AUTOMATION_RUN_REFUSAL_WORDS,
  automationToggleRefusal,
} from "@repo/features/automation-words";
import { ACT_KIND } from "@repo/host/acts";
import { selectAutomationRuns, selectWorkspaceAutomations } from "@repo/host/app-state-reads";
import { BUZZ, GLYPH, ROW_ACTION_TONE, type RowAction } from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import { randomUUID } from "expo-crypto";
import { useCallback, useMemo } from "react";
import { appStateQuery } from "../host/app-state-query.js";
import { useHostActs } from "../host/host-provider.js";
import { useLiveFollow } from "../host/live-follow.js";
import { useWrite, WRITE_SUBJECT } from "../use-write.js";

/** A held read as a page draws it: its rows once read, whether it failed before it ever answered, and its Try again. */
export interface AutomationsRead<Rows> {
  readonly rows: Rows | undefined;
  readonly failed: boolean;
  readonly retry: () => void;
}

/** Says on the console a read asked again that did not go; the page still says the read failed. */
function retryLost(cause: unknown): void {
  console.error("Reading the automations again did not go.", cause);
}

/** One workspace's automations, newest made first, followed while the caller is drawn; none while no workspace is named. */
export function useWorkspaceAutomations(
  workspaceId: string | undefined,
): AutomationsRead<readonly AutomationSummary[]> {
  const acts = useHostActs();
  useLiveFollow(workspaceId, (id) =>
    acts[ACT_KIND.AUTOMATIONS_FOLLOW]({ kind: AUTOMATION_FOLLOW.WORKSPACE, id }),
  );

  const { data: held } = useQuery({
    ...appStateQuery,
    select: useMemo(() => selectWorkspaceAutomations(workspaceId ?? ""), [workspaceId]),
  });

  const retry = useCallback(() => {
    if (workspaceId === undefined) return;
    acts[ACT_KIND.AUTOMATIONS_RETRY]({ kind: AUTOMATION_FOLLOW.WORKSPACE, id: workspaceId }).catch(
      retryLost,
    );
  }, [acts, workspaceId]);

  return { rows: held?.rows, failed: held?.failed === true, retry };
}

/** One automation's runs, newest fired first, followed while the caller is drawn; none while no automation is named. */
export function useAutomationRuns(
  automationId: string | undefined,
): AutomationsRead<readonly AutomationRunSummary[]> {
  const acts = useHostActs();
  useLiveFollow(automationId, (id) =>
    acts[ACT_KIND.AUTOMATIONS_FOLLOW]({ kind: AUTOMATION_FOLLOW.RUNS, id }),
  );

  const { data: held } = useQuery({
    ...appStateQuery,
    select: useMemo(() => selectAutomationRuns(automationId ?? ""), [automationId]),
  });

  const retry = useCallback(() => {
    if (automationId === undefined) return;
    acts[ACT_KIND.AUTOMATIONS_RETRY]({ kind: AUTOMATION_FOLLOW.RUNS, id: automationId }).catch(
      retryLost,
    );
  }, [acts, automationId]);

  return { rows: held?.rows, failed: held?.failed === true, retry };
}

/** An automation's two writes on the phone: Run now, and its switch. */
export interface AutomationActs {
  /** Runs it now; a Try again sends the same press's key, so the service never starts a second run for it. */
  readonly runNow: (automation: AutomationSummary) => void;
  /** Turns it on or off. */
  readonly turn: (automation: AutomationSummary, enabled: boolean) => void;
}

/** The writes an automation's row and page offer, each saying a refusal in the failure notice with Try again. */
export function useAutomationActs(): AutomationActs {
  const acts = useHostActs();
  const write = useWrite();

  const runNow = useCallback(
    (automation: AutomationSummary) => {
      // Note that the key is minted once per press, so the notice's Try again asks for the same run rather than a second.
      const idempotencyKey = randomUUID();
      void write(
        () => acts[ACT_KIND.AUTOMATIONS_RUN]({ automationId: automation.id, idempotencyKey }),
        {
          refused: (answer) =>
            "failure" in answer ? AUTOMATION_RUN_REFUSAL_WORDS[answer.failure] : undefined,
          retry: true,
          went: BUZZ.SUCCESS,
        },
      );
    },
    [acts, write],
  );

  const turn = useCallback(
    (automation: AutomationSummary, enabled: boolean) =>
      void write(
        () =>
          acts[ACT_KIND.AUTOMATIONS_CHANGE]({ automationId: automation.id, change: { enabled } }),
        {
          refused: (answer) => automationToggleRefusal(answer, enabled),
          retry: true,
          subject: { kind: WRITE_SUBJECT.AUTOMATION_SWITCH, id: automation.id },
        },
      ),
    [acts, write],
  );

  return useMemo(() => ({ runNow, turn }), [runNow, turn]);
}

/** The acts an automation's row offers behind its swipe and long press: Run now, then its switch turned the other way. */
export function automationRowActs(
  automation: AutomationSummary,
  acts: AutomationActs,
): readonly RowAction[] {
  return [
    {
      label: AUTOMATION_PHONE_WORDS.RUN_NOW,
      symbol: GLYPH.RUN,
      tone: ROW_ACTION_TONE.NEUTRAL,
      onPress: () => acts.runNow(automation),
    },
    {
      label: automation.enabled ? AUTOMATION_PHONE_WORDS.TURN_OFF : AUTOMATION_PHONE_WORDS.TURN_ON,
      symbol: automation.enabled ? GLYPH.PAUSE : GLYPH.PLAY,
      tone: ROW_ACTION_TONE.NEUTRAL,
      onPress: () => acts.turn(automation, !automation.enabled),
    },
  ];
}
