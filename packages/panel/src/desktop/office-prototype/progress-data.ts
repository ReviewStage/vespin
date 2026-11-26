/**
 * progress-data.ts -- PROTOTYPE, throwaway: what each Manager is working toward and what moved today, from the week's real work on main.
 */

import {
  MANAGER_FACE_CHARACTER,
  MANAGER_FACE_COLOR,
  type ManagerFace,
} from "@repo/features/manager-face";

/** One step toward a goal, at the hour it landed (24h, fractional), and whether it landed since the reader last looked. */
export interface Step {
  readonly at: number;
  readonly what: string;
  readonly pr?: number;
}

export interface GoalManager {
  readonly id: string;
  readonly name: string;
  readonly face: ManagerFace;
  readonly goal: string;
  /** Steps toward the goal: done and planned in all. */
  readonly done: number;
  readonly total: number;
  readonly steps: readonly Step[];
  readonly next?: string;
  readonly waiting?: string;
  /** How a person would catch you up on it, new bits marked `**…**`. */
  readonly letter: string;
}

/** When the reader last looked, and now, as hours of today. */
export const LOOKED = 9 + 40 / 60;
export const NOW = 18 + 30 / 60;
export const LOOKED_WORDS = "9:40 AM";

export const TEAM: readonly GoalManager[] = [
  {
    id: "frontend",
    name: "Frontend",
    face: { character: MANAGER_FACE_CHARACTER.CAT, color: MANAGER_FACE_COLOR.YELLOW },
    goal: "Remove the app's animations",
    done: 7,
    total: 10,
    steps: [
      { at: 8.25, what: "Button press sink", pr: 10855 },
      { at: 11.1, what: "Shimmer", pr: 11149 },
      { at: 14.3, what: "Working mark", pr: 11151 },
      { at: 16.2, what: "Press pulse", pr: 10861 },
    ],
    next: "fold motion in disclosures",
    letter:
      "**Frontend** took out **the shimmer, the working mark's chase, and the press pulse**, so the app is three steps closer to having no animations at all. Fold motion in disclosures is next.",
  },
  {
    id: "chat",
    name: "Chat",
    face: { character: MANAGER_FACE_CHARACTER.SPEECH_BUBBLE, color: MANAGER_FACE_COLOR.PURPLE },
    goal: "Make Manager chat feel like Slack",
    done: 6,
    total: 9,
    steps: [
      { at: 10.5, what: "Edit in place", pr: 11118 },
      { at: 13.25, what: "Mark unread", pr: 11109 },
      { at: 15.8, what: "Threads beside chat", pr: 11130 },
    ],
    next: "an emoji picker for reactions",
    letter:
      "**Chat** shipped **editing a message in place, marking one unread, and opening a thread beside the chat**. Reactions get an emoji picker next.",
  },
  {
    id: "mobile",
    name: "Mobile",
    face: { character: MANAGER_FACE_CHARACTER.BACKPACK, color: MANAGER_FACE_COLOR.GREEN },
    goal: "Bring the pull request page to iPhone",
    done: 8,
    total: 10,
    steps: [
      { at: 8.9, what: "Folding description", pr: 10957 },
      { at: 10.2, what: "Reviewers as faces", pr: 10961 },
      { at: 15.0, what: "Checks and Files rows", pr: 10963 },
    ],
    next: "TestFlight 0.25 tonight",
    letter:
      "**Mobile** added **reviewers as faces and the Checks and Files rows** to the iPhone's pull request page. It cuts TestFlight 0.25 tonight.",
  },
  {
    id: "performance",
    name: "Performance",
    face: { character: MANAGER_FACE_CHARACTER.PLANET, color: MANAGER_FACE_COLOR.BLUE },
    goal: "Make the desktop feel instant",
    done: 4,
    total: 8,
    steps: [
      { at: 12.7, what: "One warm connection", pr: 11110 },
      { at: 17.4, what: "Lighter profiling", pr: 11153 },
    ],
    next: "trace the cold start",
    letter:
      "**Performance** now sends **every host call on one warm connection**, and **profiles one window in ten** instead of all of them. Tracing the cold start is next.",
  },
  {
    id: "reviews",
    name: "Reviews",
    face: { character: MANAGER_FACE_CHARACTER.GHOST, color: MANAGER_FACE_COLOR.PINK },
    goal: "A hover card on every pull request link",
    done: 3,
    total: 4,
    steps: [
      { at: 9.0, what: "Card from the tab" },
      { at: 11.75, what: "Card matches its tab", pr: 11121 },
    ],
    next: "show checks in the card",
    letter:
      "**Reviews** made **the pull request hover card match its tab**. One step left: showing its checks.",
  },
  {
    id: "storage",
    name: "Storage",
    face: { character: MANAGER_FACE_CHARACTER.MUG, color: MANAGER_FACE_COLOR.BLUE },
    goal: "Move attachments to Blob",
    done: 5,
    total: 7,
    steps: [{ at: 8.6, what: "Copy finished" }],
    waiting: "approve the Blob cleanup",
    letter:
      "**Storage** finished copying every attachment to Blob this morning, before you looked. It's waiting on you to approve deleting the old copies.",
  },
  {
    id: "design",
    name: "Design",
    face: { character: MANAGER_FACE_CHARACTER.MUG, color: MANAGER_FACE_COLOR.PEACH },
    goal: "Choose the app's density",
    done: 2,
    total: 5,
    steps: [{ at: 13.5, what: "Three densities drawn" }],
    waiting: "pick a density",
    letter: "**Design** drew **three densities side by side**, and needs you to pick one.",
  },
  {
    id: "media",
    name: "Media",
    face: { character: MANAGER_FACE_CHARACTER.GHOST, color: MANAGER_FACE_COLOR.PURPLE },
    goal: "GIFs in chat and descriptions",
    done: 1,
    total: 4,
    steps: [],
    next: "a GIF picker",
    letter: "",
  },
];

export function newSteps(m: GoalManager): readonly Step[] {
  return m.steps.filter((s) => s.at > LOOKED);
}

/** "Shimmer, Working mark and Press pulse" → a sentence's list. */
export function listed(words: readonly string[]): string {
  const lower = words.map((w, i) => (i === 0 ? w : w.charAt(0).toLowerCase() + w.slice(1)));
  if (lower.length <= 1) return lower.join("");
  return `${lower.slice(0, -1).join(", ")} and ${lower.at(-1)}`;
}

export function hourWords(at: number): string {
  const h = Math.floor(at);
  const m = Math.round((at - h) * 60);
  const suffix = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}
