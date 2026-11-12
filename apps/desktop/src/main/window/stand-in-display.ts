/**
 * stand-in-display.ts -- one display, as Electron's screen describes it, for the window tests that stand Electron's doors in.
 */

import type { Display } from "electron";

/** A 1600×1000 built-in display at the origin, laid out whole for windows. */
export const STAND_IN_DISPLAY: Display = {
  accelerometerSupport: "unknown",
  bounds: { x: 0, y: 0, width: 1600, height: 1000 },
  colorDepth: 24,
  colorSpace: "srgb",
  depthPerComponent: 8,
  detected: true,
  displayFrequency: 60,
  id: 1,
  internal: true,
  label: "Built-in Display",
  maximumCursorSize: { width: 64, height: 64 },
  monochrome: false,
  nativeOrigin: { x: 0, y: 0 },
  rotation: 0,
  scaleFactor: 1,
  size: { width: 1600, height: 1000 },
  touchSupport: "unknown",
  workArea: { x: 0, y: 0, width: 1600, height: 1000 },
  workAreaSize: { width: 1600, height: 1000 },
};
