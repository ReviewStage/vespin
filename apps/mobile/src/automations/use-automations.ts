/**
 * use-automations.ts -- a workspace's automations and one automation's runs on the phone, followed while a screen draws them, and the two writes it offers on them: Run now and the switch, the panel's reads and acts (`@repo/panel`'s `use-automations.ts`, `use-automation-runs.ts`) for Settings' Automations pages.
 *
 * Each read is held on the host while its page stands (`AUTOMATIONS_FOLLOW`),
 * which writes it into the document, read here by its id, so a run a press
 * started, its agent moving on, and a switch turned elsewhere reach the page
 * with no read of its own. A read that failed is asked again by Try again
 * (`AUTOMATIONS_RETRY`). A switch turned is drawn by the host the moment it
 * is asked and turned back where the service refuses it, so the page holds no
 * write of its own; each goes through `useWrite`, which says a refusal. A
 * Delete and a Take over go the same way, the list drawing each as it is
 * asked.
 */

import { AUTOMATION_FOLLOW } from "@repo/features/automation-view";
import type {
  AutomationRunSummary,
  AutomationSummary,
  AutomationWorkspaceRun,
} from "@repo/features/automation-wire";
import {
  AUTOMATION_DELETE_REFUSAL_WORDS,
  AUTOMATION_PHONE_WORDS,
  AUTOMATION_RUN_REFUSAL_WORDS,
  AUTOMATION_TAKE_OVER_WORDS,
  automationToggleRefusal,
} from "@repo/features/automation-words";
import { LINK_DESTINATION, linkOf } from "@repo/features/link-grammar";
import { LIVE_READ } from "@repo/features/live-wire";
import type { WorkspaceSentry } from "@repo/features/sentry-install-wire";
import { managesWorkspace } from "@repo/features/workspace-role";
import type { Workspace } from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import type { AppStateSnapshot } from "@repo/host/app-state";
import {
  selectAutomationRuns,
  selectWorkspaceAutomations,
  selectWorkspaceRuns,
} from "@repo/host/app-state-reads";
import { BUZZ, buzz, GLYPH, ROW_ACTION_TONE, type RowAction } from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import { setStringAsync } from "expo-clipboard";
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

/** Every run of one workspace's automations, newest fired first, followed while the caller is drawn; none while no workspace is named. */
export function useWorkspaceRuns(
  workspaceId: string | undefined,
): AutomationsRead<readonly AutomationWorkspaceRun[]> {
  const acts = useHostActs();
  useLiveFollow(workspaceId, (id) =>
    acts[ACT_KIND.AUTOMATIONS_FOLLOW]({ kind: AUTOMATION_FOLLOW.WORKSPACE_RUNS, id }),
  );

  const { data: held } = useQuery({
    ...appStateQuery,
    select: useMemo(() => selectWorkspaceRuns(workspaceId ?? ""), [workspaceId]),
  });

  const retry = useCallback(() => {
    if (workspaceId === undefined) return;
    acts[ACT_KIND.AUTOMATIONS_RETRY]({
      kind: AUTOMATION_FOLLOW.WORKSPACE_RUNS,
      id: workspaceId,
    }).catch(retryLost);
  }, [acts, workspaceId]);

  return { rows: held?.rows, failed: held?.failed === true, retry };
}

/** What the workspace's integrations say to the Automations pages: whether its Slack bot is connected, so a run's result may be sent on Slack, and its Sentry, through whose installation a Sentry trigger's events arrive; neither while the read is out or failed. */
export interface WorkspaceIntegrations {
  readonly slackBot: boolean;
  readonly sentry: WorkspaceSentry | undefined;
}

/** The workspace's integrations as the Automations pages read them, followed while the caller is drawn. */
export function useWorkspaceIntegrations(workspaceId: string): WorkspaceIntegrations {
  const acts = useHostActs();
  useLiveFollow(workspaceId, (id) =>
    acts[ACT_KIND.WORKSPACE_INTEGRATIONS_FOLLOW]({ workspaceId: id }),
  );

  const select = useMemo(
    () => (state: AppStateSnapshot) => state[LIVE_READ.WORKSPACE_INTEGRATIONS][workspaceId]?.rows,
    [workspaceId],
  );

  const rows = useQuery({ ...appStateQuery, select }).data;

  return { slackBot: rows?.slack.team !== undefined, sentry: rows?.sentry };
}

/** An automation's writes on the phone: Run now, its switch, Take over, and Delete. */
export interface AutomationActs {
  /** Runs it now; a Try again sends the same press's key, so the service never starts a second run for it. */
  readonly runNow: (automation: AutomationSummary) => void;
  /** Turns it on or off. */
  readonly turn: (automation: AutomationSummary, enabled: boolean) => void;
  /** Makes it the reader's, where its creator left; it stands off until they turn it on. */
  readonly takeOver: (automation: AutomationSummary) => void;
  /** Deletes it, once its question was answered. */
  readonly remove: (automation: AutomationSummary) => void;
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

  const takeOver = useCallback(
    (automation: AutomationSummary) =>
      void write(
        () =>
          acts[ACT_KIND.AUTOMATIONS_CHANGE]({
            automationId: automation.id,
            change: { takeOver: true },
          }),
        {
          refused: (answer) =>
            "failure" in answer ? AUTOMATION_TAKE_OVER_WORDS.REFUSED : undefined,
          retry: true,
          went: BUZZ.SUCCESS,
        },
      ),
    [acts, write],
  );

  const remove = useCallback(
    (automation: AutomationSummary) =>
      void write(() => acts[ACT_KIND.AUTOMATIONS_DELETE]({ automationId: automation.id }), {
        refused: (answer) =>
          "failure" in answer ? AUTOMATION_DELETE_REFUSAL_WORDS[answer.failure] : undefined,
        retry: true,
      }),
    [acts, write],
  );

  return useMemo(() => ({ runNow, turn, takeOver, remove }), [runNow, turn, takeOver, remove]);
}

/** Who made an automation, as its page says it: their name, and whether they left the workspace; none until the members are read, or where no creator is named. */
export interface AutomationMaker {
  readonly name: string;
  readonly left: boolean;
}

/** The members and the people who left of a workspace, as the host holds them for the tabs' follow, as a `select`. */
function heldMembers(workspaceId: string) {
  return (state: AppStateSnapshot) => state[LIVE_READ.WORKSPACE_MEMBERS][workspaceId]?.rows;
}

/**
 * Who made `automation`, read from the members the tabs follow for the
 * workspace the phone works in (`useMemberPicturesFollow`): a member by
 * their name, or someone who left by the name the read keeps of them.
 */
export function useAutomationMaker(
  automation: AutomationSummary,
  workspaceId: string,
): AutomationMaker | undefined {
  const { data: rows } = useQuery({
    ...appStateQuery,
    select: useMemo(() => heldMembers(workspaceId), [workspaceId]),
  });

  const creatorId = automation.creatorId;

  if (creatorId === undefined || rows === undefined) return undefined;
  const member = rows.members.find((each) => each.userId === creatorId);

  if (member !== undefined) return { name: member.name, left: false };
  const former = (rows.former ?? []).find((each) => each.userId === creatorId);

  return { name: former?.name ?? AUTOMATION_PHONE_WORDS.FORMER_MEMBER, left: true };
}

/** Whether the reader may take `automation` over: its creator left, and they own or run the workspace. */
export function takesOver(maker: AutomationMaker | undefined, workspace: Workspace): boolean {
  return maker?.left === true && managesWorkspace(workspace);
}

/** Copies an automation's address on vespin.dev to the pasteboard, as the panel's Copy link does, with the system's tap of success, or says on the console why it could not. */
export function copyAutomationLink(automation: AutomationSummary, workspace: Workspace): void {
  setStringAsync(
    linkOf(
      { kind: LINK_DESTINATION.AUTOMATION, automationId: automation.id },
      workspace.slug ?? workspace.id,
    ),
  )
    .then(() => buzz(BUZZ.SUCCESS))
    .catch((cause: unknown) => {
      console.error("The automation's link could not be copied.", cause);
      buzz(BUZZ.ERROR);
    });
}

/** Copies a webhook trigger's address to the pasteboard for its caller, with the system's tap of success, or says on the console why it could not. */
export function copyAutomationWebhookUrl(url: string): void {
  setStringAsync(url)
    .then(() => buzz(BUZZ.SUCCESS))
    .catch((cause: unknown) => {
      console.error("The webhook's address could not be copied.", cause);
      buzz(BUZZ.ERROR);
    });
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
