import {
  DIAGRAM_ROLE,
  type DiagramRole,
  type DiagramThemeVariables,
  diagramThemeVariablesOf,
} from "@repo/features/mermaid-diagram";
import { DIAGRAM_APPEARANCE, type DiagramAppearance } from "@repo/ui/diagram-contract";

/**
 * diagram-theme.ts -- Mermaid's colors in an appearance, read off the window's palette as it draws them, as the terminal reads its own (`terminal/terminal-theme.ts`).
 *
 * Mermaid draws into a picture of its own, which reads no stylesheet of the
 * window's, so its colors are handed to it as values. Each role is read as
 * the color it resolves to on a probe wearing the window's profile and the
 * appearance asked for (`palettes.css`), so a diagram drawn in the dark
 * takes the dark palette even while the window still stands in the light,
 * and the stylesheet stays the one place a color is chosen. Mermaid mixes
 * its shades out of the colors it is handed and parses only the old sRGB
 * forms, so each is laid over the window's ground, the section a diagram is
 * drawn on, and handed over as an opaque `#rrggbb`.
 */

/** The palette's roles a diagram draws in (`@repo/features/mermaid-diagram`), by the token each is read from. */
const DIAGRAM_TOKENS = {
  [DIAGRAM_ROLE.GROUND]: "--ui-color-ground",
  [DIAGRAM_ROLE.WORDS]: "--ui-color-text",
  [DIAGRAM_ROLE.LINES]: "--ui-color-text-muted",
  [DIAGRAM_ROLE.BOX]: "--ui-color-chip",
  [DIAGRAM_ROLE.RAISED]: "--ui-color-chip-hover",
  [DIAGRAM_ROLE.EDGE]: "--ui-color-chip-edge-strong",
  [DIAGRAM_ROLE.GROUP]: "--ui-color-well",
  [DIAGRAM_ROLE.GROUP_EDGE]: "--ui-color-chip-edge",
} as const satisfies Record<DiagramRole, `--ui-color-${string}`>;

/** The attributes a surface wears its roles and its palette in (`@repo/ui`'s `surfaceAttributes`). */
const PROFILE_ATTRIBUTE = "data-ui-profile";
const THEME_ATTRIBUTE = "data-ui-theme";

/** An sRGB color as a computed style writes it: `rgb(r, g, b)`, or `rgba(r, g, b, a)` where it is translucent. */
const SRGB = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/u;

/** A color's channels, 0 to 255, and its alpha, 0 to 1. */
type Channels = readonly [red: number, green: number, blue: number, alpha: number];

/** A computed color's channels: read from its text where it is sRGB, and by a canvas painting it where it is not (an `oklch()` on the web). */
function channelsOf(color: string): Channels | undefined {
  const parsed = SRGB.exec(color);

  if (parsed !== null) {
    const [, red, green, blue, alpha] = parsed;

    return [Number(red), Number(green), Number(blue), alpha === undefined ? 1 : Number(alpha)];
  }

  const context = document.createElement("canvas").getContext("2d", { willReadFrequently: true });

  if (context === null) return undefined;
  context.fillStyle = color;
  context.fillRect(0, 0, 1, 1);
  const [red = 0, green = 0, blue = 0, alpha = 0] = context.getImageData(0, 0, 1, 1).data;

  return [red, green, blue, alpha / 255];
}

/** `color` laid over the opaque `ground`, as `#rrggbb`. */
function opaqueOver(color: Channels, ground: Channels): string {
  const alpha = color[3];

  const mixed = [0, 1, 2].map((at) =>
    Math.round((color[at] ?? 0) * alpha + (ground[at] ?? 0) * (1 - alpha)),
  );

  return `#${mixed.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Each role's color in `appearance` as the window's palette draws it,
 * opaque over its ground, or nothing for a role the stylesheet does not
 * reach, as in a document without the window's styles. A probe inside the
 * root is colored with each token in turn, because a computed color is a
 * resolved one, where the token's own text is still its `light-dark()` pair.
 */
function paletteIn(appearance: DiagramAppearance): Map<DiagramRole, string> {
  const root = document.documentElement;
  const probe = root.ownerDocument.createElement("span");
  const profile = root.getAttribute(PROFILE_ATTRIBUTE);

  if (profile !== null) probe.setAttribute(PROFILE_ATTRIBUTE, profile);
  probe.setAttribute(THEME_ATTRIBUTE, appearance);
  probe.hidden = true;
  root.appendChild(probe);
  const read = new Map<DiagramRole, Channels>();

  // SAFETY: DiagramRole is the keys of the literal DIAGRAM_TOKENS, which holds no others.
  for (const role of Object.keys(DIAGRAM_TOKENS) as DiagramRole[]) {
    const token = DIAGRAM_TOKENS[role];

    if (getComputedStyle(probe).getPropertyValue(token).trim() === "") continue;
    probe.style.color = `var(${token})`;
    const channels = channelsOf(getComputedStyle(probe).color);

    if (channels !== undefined) read.set(role, channels);
  }

  probe.remove();
  const ground = read.get(DIAGRAM_ROLE.GROUND);
  const palette = new Map<DiagramRole, string>();

  if (ground === undefined) return palette;

  for (const [role, channels] of read) palette.set(role, opaqueOver(channels, ground));

  return palette;
}

/**
 * Mermaid's colors in `appearance`, from the window's palette as it stands
 * now. A role the palette does not reach is left out, and Mermaid keeps its
 * own for it.
 */
export function diagramThemeVariables(appearance: DiagramAppearance): DiagramThemeVariables {
  const palette = paletteIn(appearance);

  return diagramThemeVariablesOf(
    (role) => palette.get(role),
    appearance === DIAGRAM_APPEARANCE.DARK,
  );
}
