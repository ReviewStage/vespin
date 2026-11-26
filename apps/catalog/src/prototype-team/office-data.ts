/**
 * office-data.ts -- PROTOTYPE, throwaway: the team at 3, 5, or 10 Managers for the office variants, each with a role and a status.
 */

import { MANAGER_FACE_CHARACTER, MANAGER_FACE_COLOR } from "@repo/features/manager-face";
import {
  AGENT_STATE,
  HANDOFFS,
  type Handoff,
  MANAGERS,
  PR_STATE,
  type TeamManager,
} from "./fixture";

export const MANAGER_STATUS = {
  WAITING: "waiting",
  WORKING: "working",
  IDLE: "idle",
} as const;

export type ManagerStatus = (typeof MANAGER_STATUS)[keyof typeof MANAGER_STATUS];

export interface OfficeManager extends TeamManager {
  readonly role: string;
}

const ROLES: Record<string, string> = {
  product: "Product lead",
  frontend: "Frontend lead",
  performance: "Performance engineer",
  "gpt-live": "Voice lead",
  mobile: "iOS lead",
  design: "Design systems",
  infra: "Infrastructure",
  billing: "Billing",
  docs: "Docs writer",
  security: "Security",
};

const MORE: readonly TeamManager[] = [
  {
    id: "infra",
    name: "Infra",
    face: { character: MANAGER_FACE_CHARACTER.PLANET, color: MANAGER_FACE_COLOR.GREEN },
    working: true,
    focus: "Sandbox boot under 3 s",
    headline: "",
    yesterday: "",
    agents: [
      { name: "Warm sandbox pool", state: AGENT_STATE.WORKING, doing: "" },
      { name: "Image layer cache", state: AGENT_STATE.WORKING, doing: "" },
      { name: "Boot trace", state: AGENT_STATE.REVIEW, doing: "" },
    ],
    pullRequests: [
      {
        number: 11030,
        title: "perf(sandbox): warm pool",
        state: PR_STATE.CHECKS,
        additions: 90,
        deletions: 12,
      },
    ],
    asks: [{ title: "Raise the sandbox memory limit?", detail: "4 GB → 8 GB, +$40/mo", age: "1h" }],
    mergedThisWeek: 6,
  },
  {
    id: "design",
    name: "Design",
    face: { character: MANAGER_FACE_CHARACTER.MUG, color: MANAGER_FACE_COLOR.PEACH },
    working: true,
    focus: "Dark mode tokens for charts",
    headline: "",
    yesterday: "",
    agents: [
      { name: "Chart palette", state: AGENT_STATE.WORKING, doing: "" },
      { name: "Token audit", state: AGENT_STATE.DONE, doing: "" },
    ],
    pullRequests: [],
    asks: [],
    mergedThisWeek: 2,
  },
  {
    id: "billing",
    name: "Billing",
    face: { character: MANAGER_FACE_CHARACTER.MUG, color: MANAGER_FACE_COLOR.BLUE },
    working: true,
    focus: "Usage meters on Account",
    headline: "",
    yesterday: "",
    agents: [
      { name: "Meter component", state: AGENT_STATE.WORKING, doing: "" },
      { name: "Price change", state: AGENT_STATE.NEEDS_YOU, doing: "" },
    ],
    pullRequests: [],
    asks: [{ title: "Approve the Stripe price change", detail: "Team plan $20 → $24", age: "4h" }],
    mergedThisWeek: 1,
  },
  {
    id: "docs",
    name: "Docs",
    face: { character: MANAGER_FACE_CHARACTER.BACKPACK, color: MANAGER_FACE_COLOR.YELLOW },
    working: false,
    focus: "CLI docs for 0.25",
    headline: "",
    yesterday: "",
    agents: [{ name: "CLI reference", state: AGENT_STATE.IDLE, doing: "" }],
    pullRequests: [],
    asks: [],
    mergedThisWeek: 3,
  },
  {
    id: "security",
    name: "Security",
    face: { character: MANAGER_FACE_CHARACTER.GHOST, color: MANAGER_FACE_COLOR.PURPLE },
    working: true,
    focus: "Secret scan in repo checks",
    headline: "",
    yesterday: "",
    agents: [{ name: "Credential patterns", state: AGENT_STATE.WORKING, doing: "" }],
    pullRequests: [],
    asks: [],
    mergedThisWeek: 1,
  },
];

const MORE_HANDOFFS: readonly Handoff[] = [
  { from: "design", to: "frontend", what: "Chart tokens for dark mode", age: "2h" },
  { from: "infra", to: "performance", what: "Sandbox boot trace", age: "4h" },
  { from: "billing", to: "product", what: "Usage meter copy", age: "6h" },
];

/** The first `n` Managers of the ten, with their roles. */
export function teamOf(n: number): readonly OfficeManager[] {
  const order = [
    "product",
    "frontend",
    "performance",
    "gpt-live",
    "mobile",
    "infra",
    "design",
    "billing",
    "docs",
    "security",
  ];
  const all = [...MANAGERS, ...MORE];
  const three = ["product", "frontend", "gpt-live"];
  const ids = n === 3 ? three : order.slice(0, n);
  return ids.map((id) => {
    const m = all.find((each) => each.id === id);
    if (m === undefined) throw new Error(id);
    return { ...m, role: ROLES[id] ?? "" };
  });
}

export function handoffsOf(team: readonly OfficeManager[]): readonly Handoff[] {
  const ids = new Set(team.map((m) => m.id));
  return [...HANDOFFS, ...MORE_HANDOFFS].filter((h) => ids.has(h.from) && ids.has(h.to));
}

export function statusOf(m: TeamManager): ManagerStatus {
  if (m.asks.length > 0) return MANAGER_STATUS.WAITING;
  return m.working ? MANAGER_STATUS.WORKING : MANAGER_STATUS.IDLE;
}

export function asksOf(team: readonly OfficeManager[]) {
  return team.flatMap((m) => m.asks.map((ask) => ({ m, ask })));
}

export function byId(team: readonly OfficeManager[], id: string): OfficeManager {
  const m = team.find((each) => each.id === id);
  if (m === undefined) throw new Error(id);
  return m;
}
