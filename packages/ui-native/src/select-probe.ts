// select-probe.ts -- a probe, never merged: `-selProbe <variant>` switches one suspect for the iPad's bare ✓ in Select mode.
import { Settings } from "react-native";

export const SELECT_PROBE = {
  NONE: "none",
  NO_TINT: "notint",
  INSET: "inset",
  AUTOMATIC: "automatic",
  ROW_GROUND: "rowground",
  NO_RING: "noring",
} as const;

export type SelectProbe = (typeof SELECT_PROBE)[keyof typeof SELECT_PROBE];

const asked: unknown = Settings.get("selProbe");

/** The variant this launch asked for. */
export const selectProbe: string = typeof asked === "string" ? asked : SELECT_PROBE.NONE;

console.log(`[selprobe] variant=${selectProbe}`);
