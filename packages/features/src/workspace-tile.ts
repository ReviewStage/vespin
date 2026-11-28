/**
 * workspace-tile.ts -- what a workspace's tile and its switcher's rows say, read alike by the desktop's and the phone's: the hue a letter stands on, the letter, who shares the workspace, and the switcher's words.
 *
 * A tile is a workspace's photo, its owner's picture on a personal one, or
 * the first character of its name on one of six hues. The hue is read off
 * the id rather than the name, so a rename keeps the mark the members know
 * it by, and two workspaces of one name still read apart more often than
 * not; a person's letter disc reads its hue the same way. The hues themselves
 * are each client's own colors, `@repo/ui`'s `--ui-color-identity-*` and
 * `@repo/ui-native`'s `IDENTITY_HUE`, both generated from `@repo/brand`'s
 * one table.
 */

/** How many hues an identity's letter is drawn on. */
const IDENTITY_HUE_COUNT = 6;

/** Splits a name into the characters a reader sees, an emoji's parts as one; made on its first use, since the phone installs `Intl.Segmenter` only as it is first read. */
let characters: Intl.Segmenter | undefined;

/** The switcher's words, as the panel's menu says them. */
export const WORKSPACE_SWITCHER_WORDS = {
  /** What the menu of every workspace is heard as. */
  MENU: "Workspaces",
  NEW_WORKSPACE: "New workspace",
  WORKSPACE_SETTINGS: "Workspace settings",
  ADMIN: "Admin",
  /** What the account's own first workspace says in place of a count, while no one else is in it. */
  PERSONAL: "Personal workspace",
  /** What the switcher's button is heard as beside the workspace while another workspace holds a thread that waits on the reader. */
  WAITING_ELSEWHERE: "Waiting in another workspace",
} as const;

/** What joins who shares a workspace and how many threads wait there, on its row's one line. */
const LINE_JOIN = " · ";

/**
 * The hue an identity is drawn in, from 1, read off its id alone, so a
 * rename keeps the mark its members know it by: a workspace's tile and a
 * person's letter alike.
 */
export function identityHue(id: string): number {
  let hash = 0;

  for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;

  return (hash % IDENTITY_HUE_COUNT) + 1;
}

/** A name's first character as a reader sees it, an emoji's whole, upper-cased; none for a blank name. */
export function identityLetter(name: string): string {
  characters ??= new Intl.Segmenter(undefined, { granularity: "grapheme" });
  const [first] = characters.segment(name.trim());

  return first === undefined ? "" : first.segment.toUpperCase();
}

/**
 * Who shares a workspace in words: "Personal workspace" for the account's
 * own first workspace while no one else is in it, its members counted
 * otherwise, a team made a moment ago and joined by no one yet included;
 * nothing from a service that does not count them.
 */
export function workspaceSharedWords(
  count: number | undefined,
  personal: boolean,
): string | undefined {
  if (count === undefined) return undefined;

  if (count <= 1) return personal ? WORKSPACE_SWITCHER_WORDS.PERSONAL : "1 member";

  return `${count} members`;
}

/** How many threads wait on the reader in a workspace, as its switcher row says it: "3 waiting". */
export function waitingWords(count: number): string {
  return `${count} waiting`;
}

/** What waits on the reader in each workspace as the switcher shows it: each one's count, in the order its ids were handed, and whether any other than the chosen one holds a thread. */
export interface WaitingInOthers {
  readonly counts: readonly number[];
  readonly elsewhere: boolean;
}

/**
 * What waits on the reader in each workspace as the switcher shows it, in
 * the order of `ids`: each other workspace's count of threads waiting on
 * them (`totalOf`, the Inbox's Open count of that workspace), the chosen
 * one's none, since its own Inbox counts it; and whether any other holds
 * one, which marks the switcher's own button, so a thread waiting elsewhere
 * is seen without opening it while the app's badge counts every workspace.
 */
export function waitingInOthers(
  ids: readonly string[],
  chosenId: string,
  totalOf: (id: string) => number,
): WaitingInOthers {
  const counts = ids.map((id) => (id === chosenId ? 0 : totalOf(id)));

  return { counts, elsewhere: counts.some((count) => count > 0) };
}

/** A workspace's line under its name in the switcher: who shares it, then how many threads wait there where any do, as "5 members · 3 waiting"; none where neither says anything. */
export function workspaceSwitcherLine(
  shared: string | undefined,
  waiting: number,
): string | undefined {
  const parts = [shared, waiting > 0 ? waitingWords(waiting) : undefined].filter(
    (part) => part !== undefined,
  );

  return parts.length === 0 ? undefined : parts.join(LINE_JOIN);
}
