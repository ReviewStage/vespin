/**
 * code-pane-look.ts -- the ground a pane that is all code stands on: a File tab, a tab's Files changed, a page's source.
 *
 * Note that such a pane stands on the window's own ground, the transcript's
 * beside it, rather than on the code ground a code card sets into a
 * conversation, because a pane is no inset: on the code ground it read as a
 * second, darker window. The diffs and files drawn in it read their ground
 * from `--code-ground` (`styles/base.css`), which the pane sets to its own.
 */

/** A code pane's ground, which the code drawn in it takes as well. */
export const CODE_PANE_GROUND_CLASS = "bg-ground [--code-ground:var(--ui-color-ground)]";
