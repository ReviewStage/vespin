/**
 * calm-data.ts -- PROTOTYPE, throwaway: the team as one plain sentence per Manager, for the calm Office ideas.
 */

import {
  MANAGER_FACE_CHARACTER,
  MANAGER_FACE_COLOR,
  type ManagerFace,
} from "@repo/features/manager-face";

export interface CalmManager {
  readonly id: string;
  readonly name: string;
  readonly face: ManagerFace;
  /** What it is doing, as the rest of "Frontend is …". */
  readonly doing: string;
  /** What it needs of you, as the rest of "Needs you: …"; none while it needs nothing. */
  readonly ask?: string;
  readonly resting?: boolean;
}

const TEN: readonly CalmManager[] = [
  {
    id: "product",
    name: "Product",
    face: { character: MANAGER_FACE_CHARACTER.GHOST, color: MANAGER_FACE_COLOR.PINK },
    doing: "writing the onboarding copy",
    ask: "pick the onboarding headline",
  },
  {
    id: "frontend",
    name: "Frontend",
    face: { character: MANAGER_FACE_CHARACTER.CAT, color: MANAGER_FACE_COLOR.YELLOW },
    doing: "finishing the PR hover card",
  },
  {
    id: "performance",
    name: "Performance",
    face: { character: MANAGER_FACE_CHARACTER.PLANET, color: MANAGER_FACE_COLOR.BLUE },
    doing: "getting the app to open in under 400 ms",
  },
  {
    id: "gpt-live",
    name: "GPT Live",
    face: { character: MANAGER_FACE_CHARACTER.SPEECH_BUBBLE, color: MANAGER_FACE_COLOR.PURPLE },
    doing: "letting a call start an agent",
    ask: "approve the Blob cleanup",
  },
  {
    id: "mobile",
    name: "Mobile",
    face: { character: MANAGER_FACE_CHARACTER.BACKPACK, color: MANAGER_FACE_COLOR.GREEN },
    doing: "bringing Manager faces to the iPhone",
  },
  {
    id: "infra",
    name: "Infra",
    face: { character: MANAGER_FACE_CHARACTER.PLANET, color: MANAGER_FACE_COLOR.GREEN },
    doing: "making sandboxes boot in 3 seconds",
  },
  {
    id: "design",
    name: "Design",
    face: { character: MANAGER_FACE_CHARACTER.MUG, color: MANAGER_FACE_COLOR.PEACH },
    doing: "choosing chart colors for dark mode",
  },
  {
    id: "billing",
    name: "Billing",
    face: { character: MANAGER_FACE_CHARACTER.MUG, color: MANAGER_FACE_COLOR.BLUE },
    doing: "adding usage meters",
    ask: "approve the new Team price",
  },
  {
    id: "docs",
    name: "Docs",
    face: { character: MANAGER_FACE_CHARACTER.BACKPACK, color: MANAGER_FACE_COLOR.YELLOW },
    doing: "resting: the CLI docs are done",
    resting: true,
  },
  {
    id: "security",
    name: "Security",
    face: { character: MANAGER_FACE_CHARACTER.GHOST, color: MANAGER_FACE_COLOR.PURPLE },
    doing: "scanning for leaked keys",
  },
];

export function calmTeam(n: number): readonly CalmManager[] {
  return TEN.slice(0, n);
}

/** The one sentence a Manager says of itself. */
export function sentenceOf(m: CalmManager): string {
  if (m.ask !== undefined) return `Needs you: ${m.ask}`;
  return m.doing.charAt(0).toUpperCase() + m.doing.slice(1);
}

/** The same, said of it: "Frontend is finishing the PR hover card." */
export function saidOf(m: CalmManager): string {
  if (m.ask !== undefined) return `${m.name} needs you to ${m.ask}.`;
  if (m.resting === true) return `${m.name} is resting.`;
  return `${m.name} is ${m.doing}.`;
}

/** The page's one answer to "does anything need me?". */
export function answerOf(team: readonly CalmManager[]): string {
  const asking = team.filter((m) => m.ask !== undefined);
  if (asking.length === 0) return "Nothing needs you";
  const names = asking.map((m) => m.name);
  const listed =
    names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  return `${listed} ${asking.length === 1 ? "needs" : "need"} you`;
}
