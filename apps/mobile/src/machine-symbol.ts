// machine-symbol.ts -- the glyph a machine stands under, by its platform, as the panel draws a Mac and a server: on Settings › Machines' rows and on a pairing's question.

import { DEVICE_PLATFORM, type DevicePlatform } from "@repo/features/device-agent-wire";
import { GLYPH, type Glyph } from "@repo/ui-native";

/** The glyph a machine's row leads with, by its platform. */
export const PLATFORM_SYMBOL = {
  [DEVICE_PLATFORM.DARWIN]: GLYPH.MAC,
  [DEVICE_PLATFORM.LINUX]: GLYPH.HOST,
} as const satisfies Record<DevicePlatform, Glyph>;
