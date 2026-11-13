// workspace-tile-model.ts -- the hue a workspace's tile stands its letter on.

import { identityHue } from "@repo/features/workspace-tile";
import { IDENTITY_HUE } from "./tokens/identity-hues.js";

/** The hue a workspace's letter stands on, read off its id, in the light theme or the dark. */
export function tileHue(id: string, dark: boolean): string {
  const hues = dark ? IDENTITY_HUE.DARK : IDENTITY_HUE.LIGHT;

  return hues[identityHue(id) - 1] ?? hues[0];
}
