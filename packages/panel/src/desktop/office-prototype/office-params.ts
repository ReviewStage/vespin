/**
 * office-params.ts -- PROTOTYPE, throwaway: the office page's switch, read once from the address it loaded at (`?office=desks|floor|rooms&n=3|5|10`).
 */

const SEARCH = typeof window === "undefined" ? "" : window.location.search;
const PARAMS = new URLSearchParams(SEARCH);

export const OFFICE_VARIANT = {
  DESKS: "desks",
  FLOOR: "floor",
  ROOMS: "rooms",
  PHOTO: "photo",
  TABLE: "table",
  SENTENCES: "sentences",
  PRESENCE: "presence",
  SPOTLIGHT: "spotlight",
} as const;

/** The round-three ideas, calm: a face and one sentence each. */
export const CALM = new Set<string>(["photo", "table", "sentences", "spotlight"]);

export type OfficeVariant = (typeof OFFICE_VARIANT)[keyof typeof OFFICE_VARIANT];

function readVariant(): OfficeVariant | undefined {
  const asked = PARAMS.get("office");
  return Object.values(OFFICE_VARIANT).find((v) => v === asked);
}

/** The variant the address asks for, or none: the app as it is. */
export const OFFICE = readVariant();

/** How many Managers the office holds. */
export const OFFICE_SIZE = Number(PARAMS.get("n") ?? "5");
