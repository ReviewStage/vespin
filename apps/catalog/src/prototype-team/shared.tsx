/**
 * shared.tsx -- PROTOTYPE, throwaway: the bits every team-view variant draws a Manager and its agents with.
 */

import { Badge, STATUS_TONE, type StatusTone } from "@repo/ui";
import { MANAGER_FACE_SIZE, ManagerFace } from "@repo/ui/manager-face";
import { AGENT_STATE, type AgentState, PR_STATE, type PrState, type TeamManager } from "./fixture";

export const AGENT_LOOK: Record<AgentState, { tone: StatusTone; words: string; ink: string }> = {
  [AGENT_STATE.WORKING]: {
    tone: STATUS_TONE.WORKING,
    words: "Working",
    ink: "var(--ui-color-working)",
  },
  [AGENT_STATE.NEEDS_YOU]: {
    tone: STATUS_TONE.ATTENTION,
    words: "Needs you",
    ink: "var(--ui-color-attention)",
  },
  [AGENT_STATE.REVIEW]: {
    tone: STATUS_TONE.STARTING,
    words: "In review",
    ink: "var(--ui-color-merged)",
  },
  [AGENT_STATE.DONE]: {
    tone: STATUS_TONE.COMPLETE,
    words: "Done",
    ink: "var(--ui-color-complete)",
  },
  [AGENT_STATE.IDLE]: {
    tone: STATUS_TONE.NEUTRAL,
    words: "Queued",
    ink: "var(--ui-color-text-muted)",
  },
};

export const PR_LOOK: Record<PrState, { tone: StatusTone; words: string }> = {
  [PR_STATE.OPEN]: { tone: STATUS_TONE.NEUTRAL, words: "Open" },
  [PR_STATE.CHECKS]: { tone: STATUS_TONE.WORKING, words: "Checks" },
  [PR_STATE.REVIEW]: { tone: STATUS_TONE.ATTENTION, words: "Review" },
  [PR_STATE.MERGED]: { tone: STATUS_TONE.MERGED, words: "Merged" },
};

/** A Manager's own soft color, as its face wears it. */
export function faceInk(m: TeamManager): string {
  return `var(--ui-color-manager-face-${m.face.color})`;
}

export function Face({ m, big }: { m: TeamManager; big?: "l" | "xl" | "xxl" }): React.JSX.Element {
  const face = <ManagerFace face={m.face} size={MANAGER_FACE_SIZE.MESSAGE} working={m.working} />;
  return big === undefined ? face : <span className={`pt-face-${big}`}>{face}</span>;
}

export function RowFace({ m }: { m: TeamManager }): React.JSX.Element {
  return <ManagerFace face={m.face} size={MANAGER_FACE_SIZE.ROW} working={m.working} />;
}

export function WordsFace({ m }: { m: TeamManager }): React.JSX.Element {
  return <ManagerFace face={m.face} size={MANAGER_FACE_SIZE.WORDS} />;
}

export function AgentBadge({ state }: { state: AgentState }): React.JSX.Element {
  const look = AGENT_LOOK[state];
  return <Badge tone={look.tone}>{look.words}</Badge>;
}

export function PrBadge({ state }: { state: PrState }): React.JSX.Element {
  const look = PR_LOOK[state];
  return <Badge tone={look.tone}>{look.words}</Badge>;
}

export function ManagerBadge({ m }: { m: TeamManager }): React.JSX.Element {
  if (m.asks.length > 0)
    return <Badge tone={STATUS_TONE.ATTENTION}>{`Needs you · ${m.asks.length}`}</Badge>;
  return m.working ? <Badge tone={STATUS_TONE.WORKING}>Working</Badge> : <Badge>Resting</Badge>;
}
