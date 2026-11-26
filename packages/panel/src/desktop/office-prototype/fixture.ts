/**
 * fixture.ts -- PROTOTYPE, throwaway: five Managers as a team, on made-up data, for the team-view variants.
 */

import {
  MANAGER_FACE_CHARACTER,
  MANAGER_FACE_COLOR,
  type ManagerFace,
} from "@repo/features/manager-face";

export const AGENT_STATE = {
  WORKING: "working",
  NEEDS_YOU: "needs-you",
  REVIEW: "review",
  DONE: "done",
  IDLE: "idle",
} as const;

export type AgentState = (typeof AGENT_STATE)[keyof typeof AGENT_STATE];

export const PR_STATE = {
  OPEN: "open",
  CHECKS: "checks",
  REVIEW: "review",
  MERGED: "merged",
} as const;

export type PrState = (typeof PR_STATE)[keyof typeof PR_STATE];

export interface Agent {
  readonly name: string;
  readonly state: AgentState;
  readonly doing: string;
}

export interface PullRequest {
  readonly number: number;
  readonly title: string;
  readonly state: PrState;
  readonly additions: number;
  readonly deletions: number;
}

export interface Ask {
  readonly title: string;
  readonly detail: string;
  readonly age: string;
}

export interface TeamManager {
  readonly id: string;
  readonly name: string;
  readonly face: ManagerFace;
  readonly working: boolean;
  readonly focus: string;
  readonly headline: string;
  readonly yesterday: string;
  readonly agents: readonly Agent[];
  readonly pullRequests: readonly PullRequest[];
  readonly asks: readonly Ask[];
  readonly mergedThisWeek: number;
}

export interface Handoff {
  readonly from: string;
  readonly to: string;
  readonly what: string;
  readonly age: string;
}

export interface FeedEntry {
  readonly manager: string;
  readonly at: string;
  readonly text: string;
  readonly kind: "merged" | "ask" | "handoff" | "started" | "finished";
}

export const ME = { name: "Charles Pan" } as const;

export const MANAGERS: readonly TeamManager[] = [
  {
    id: "product",
    name: "Product",
    face: { character: MANAGER_FACE_CHARACTER.GHOST, color: MANAGER_FACE_COLOR.PINK },
    working: true,
    focus: "Spec for a team home page",
    headline: "Product drafts the team home, wants your call on scope",
    yesterday: "Wrote up seven team-view prototypes and the onboarding copy.",
    agents: [
      { name: "Team view prototypes", state: AGENT_STATE.WORKING, doing: "Drawing 7 variants" },
      { name: "Onboarding copy pass", state: AGENT_STATE.NEEDS_YOU, doing: "Asks which headline" },
    ],
    pullRequests: [
      {
        number: 11031,
        title: "docs: onboarding copy, plain and short",
        state: PR_STATE.REVIEW,
        additions: 42,
        deletions: 61,
      },
    ],
    asks: [
      { title: "Pick the onboarding headline", detail: "Three options, one line each", age: "12m" },
    ],
    mergedThisWeek: 4,
  },
  {
    id: "frontend",
    name: "Frontend",
    face: { character: MANAGER_FACE_CHARACTER.CAT, color: MANAGER_FACE_COLOR.YELLOW },
    working: true,
    focus: "Removing motion app-wide",
    headline: "Frontend strips the last press pulses from the app",
    yesterday: "Merged the Button press sink removal and 👍/👎 on chat messages.",
    agents: [
      { name: "Drop fold motion", state: AGENT_STATE.WORKING, doing: "Running the catalog shots" },
      {
        name: "Skeleton flash on Tasks",
        state: AGENT_STATE.WORKING,
        doing: "Bisecting the first paint",
      },
      { name: "Toast entrance", state: AGENT_STATE.REVIEW, doing: "PR waiting on CI" },
      { name: "Sidebar row hover", state: AGENT_STATE.DONE, doing: "Merged" },
    ],
    pullRequests: [
      {
        number: 11024,
        title: "refactor(ui): drop fold motion from disclosures",
        state: PR_STATE.CHECKS,
        additions: 18,
        deletions: 140,
      },
      {
        number: 11019,
        title: "fix(ui): toast enters without a slide",
        state: PR_STATE.OPEN,
        additions: 9,
        deletions: 37,
      },
      {
        number: 11017,
        title: "feat(panel,ui): 👍 and 👎 on Manager chat",
        state: PR_STATE.MERGED,
        additions: 212,
        deletions: 14,
      },
    ],
    asks: [],
    mergedThisWeek: 9,
  },
  {
    id: "performance",
    name: "Performance",
    face: { character: MANAGER_FACE_CHARACTER.PLANET, color: MANAGER_FACE_COLOR.BLUE },
    working: true,
    focus: "Panel cold start under 400 ms",
    headline: "Cold start down to 520 ms; Performance asks to drop a font",
    yesterday: "Lazy-loaded Kawaii and the diff view; cold start 610 → 520 ms.",
    agents: [
      {
        name: "Trace cold start",
        state: AGENT_STATE.WORKING,
        doing: "Profiling the bundle loader",
      },
      {
        name: "Drop the display font",
        state: AGENT_STATE.NEEDS_YOU,
        doing: "Asks to remove Bricolage",
      },
      { name: "Lazy diff view", state: AGENT_STATE.DONE, doing: "Merged" },
    ],
    pullRequests: [
      {
        number: 11012,
        title: "perf(panel): lazy-load the diff view",
        state: PR_STATE.MERGED,
        additions: 34,
        deletions: 12,
      },
      {
        number: 11028,
        title: "perf(web): preload the panel chunk",
        state: PR_STATE.OPEN,
        additions: 21,
        deletions: 3,
      },
    ],
    asks: [
      {
        title: "Drop Bricolage from the web app?",
        detail: "Saves 48 KB on first paint",
        age: "40m",
      },
    ],
    mergedThisWeek: 5,
  },
  {
    id: "gpt-live",
    name: "GPT Live",
    face: { character: MANAGER_FACE_CHARACTER.SPEECH_BUBBLE, color: MANAGER_FACE_COLOR.PURPLE },
    working: false,
    focus: "Voice calls that hand off to agents",
    headline: "GPT Live waits on you before a call can start an agent",
    yesterday: "Shipped call transcripts into the agent's conversation.",
    agents: [
      {
        name: "Call → agent handoff",
        state: AGENT_STATE.NEEDS_YOU,
        doing: "Needs an OpenAI key scope",
      },
      { name: "Transcript lines", state: AGENT_STATE.DONE, doing: "Merged" },
    ],
    pullRequests: [
      {
        number: 11002,
        title: "feat(service): a call's words land as messages",
        state: PR_STATE.MERGED,
        additions: 388,
        deletions: 41,
      },
    ],
    asks: [
      {
        title: "Grant the realtime key scope",
        detail: "Settings › Integrations › OpenAI",
        age: "2h",
      },
      {
        title: "Is a call allowed to start an agent?",
        detail: "Yes / only on my own tasks / no",
        age: "3h",
      },
    ],
    mergedThisWeek: 2,
  },
  {
    id: "mobile",
    name: "Mobile",
    face: { character: MANAGER_FACE_CHARACTER.BACKPACK, color: MANAGER_FACE_COLOR.GREEN },
    working: true,
    focus: "Manager faces on iOS",
    headline: "Mobile ports Manager faces to iPhone and iPad",
    yesterday: "Got the iPhone Duo layout passing its Maestro flows.",
    agents: [
      {
        name: "ManagerFace in ui-native",
        state: AGENT_STATE.WORKING,
        doing: "Wrapping Kawaii for SwiftUI",
      },
      { name: "iPad sidebar width", state: AGENT_STATE.REVIEW, doing: "PR waiting on review" },
      { name: "TestFlight 0.25", state: AGENT_STATE.IDLE, doing: "Queued for tonight" },
    ],
    pullRequests: [
      {
        number: 11026,
        title: "feat(ui-native): ManagerFace",
        state: PR_STATE.CHECKS,
        additions: 160,
        deletions: 2,
      },
      {
        number: 11021,
        title: "fix(mobile): iPad sidebar keeps its width",
        state: PR_STATE.REVIEW,
        additions: 12,
        deletions: 8,
      },
    ],
    asks: [],
    mergedThisWeek: 3,
  },
];

export const HANDOFFS: readonly Handoff[] = [
  { from: "product", to: "frontend", what: "Team home spec v1", age: "25m" },
  { from: "performance", to: "frontend", what: "Skeleton flash on Tasks", age: "1h" },
  { from: "frontend", to: "mobile", what: "ManagerFace API", age: "3h" },
  { from: "gpt-live", to: "product", what: "Call transcripts in descriptions", age: "5h" },
];

export const FEED: readonly FeedEntry[] = [
  { manager: "product", at: "12m", text: "asked you to pick the onboarding headline", kind: "ask" },
  {
    manager: "frontend",
    at: "18m",
    text: "opened #11024 drop fold motion from disclosures",
    kind: "started",
  },
  { manager: "product", at: "25m", text: "handed Frontend the team home spec v1", kind: "handoff" },
  {
    manager: "performance",
    at: "40m",
    text: "asked whether to drop Bricolage from the web app",
    kind: "ask",
  },
  {
    manager: "performance",
    at: "1h",
    text: "handed Frontend the skeleton flash on Tasks",
    kind: "handoff",
  },
  {
    manager: "frontend",
    at: "1h",
    text: "merged #11017 👍 and 👎 on Manager chat",
    kind: "merged",
  },
  { manager: "gpt-live", at: "2h", text: "asked you to grant the realtime key scope", kind: "ask" },
  { manager: "mobile", at: "2h", text: "finished iPhone Duo layout; flows pass", kind: "finished" },
  {
    manager: "performance",
    at: "3h",
    text: "merged #11012 lazy-load the diff view",
    kind: "merged",
  },
  { manager: "frontend", at: "3h", text: "handed Mobile the ManagerFace API", kind: "handoff" },
];

export function managerById(id: string): TeamManager {
  const found = MANAGERS.find((m) => m.id === id);
  if (found === undefined) throw new Error(`No manager ${id}`);
  return found;
}

export function countAgents(m: TeamManager, state: AgentState): number {
  return m.agents.filter((a) => a.state === state).length;
}

export function openPrs(m: TeamManager): readonly PullRequest[] {
  return m.pullRequests.filter((p) => p.state !== PR_STATE.MERGED);
}

export const TOTAL_ASKS = MANAGERS.reduce((n, m) => n + m.asks.length, 0);
