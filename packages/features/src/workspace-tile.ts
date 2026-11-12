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

/** Splits a name into the characters a reader sees, an emoji's parts as one. */
const CHARACTERS = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** The switcher's words, as the panel's menu says them. */
export const WORKSPACE_SWITCHER_WORDS = {
  /** What the menu of every workspace is heard as. */
  MENU: "Workspaces",
  NEW_WORKSPACE: "New workspace",
  WORKSPACE_SETTINGS: "Workspace settings",
  ADMIN: "Admin",
  /** What the account's own first workspace says in place of a count, while no one else is in it. */
  PERSONAL: "Personal workspace",
} as const;

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
  const [first] = CHARACTERS.segment(name.trim());

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
