// identity-hues.ts -- the six hues a workspace's letter stands on, by the hue `@repo/features/workspace-tile`'s `identityHue` reads off its id, in the light theme and the dark.

/**
 * The same six muted hues `@repo/ui`'s `palettes.css` names
 * `--ui-color-identity-1` through `-6`, each holding its white letter at AA
 * on either ground, none of them copper so no tile reads as attention. Note
 * that they are written here as values rather than generated, because
 * `@repo/brand`'s table holds the brand's roles alone and the identity hues
 * stay `@repo/ui`'s; a change to one side is made to the other in the same
 * change.
 */
export const IDENTITY_HUE = {
  LIGHT: ["#4a5fc0", "#23766f", "#237293", "#a8435f", "#6a4fbd", "#3f7434"],
  DARK: ["#4f63b8", "#2b7f78", "#2a7899", "#a24a63", "#6c55b3", "#477a3a"],
} as const;

/** The letter's ink on every hue. */
export const ON_IDENTITY = "#ffffff";
