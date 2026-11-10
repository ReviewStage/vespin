/**
 * mac-resources.ts -- what this Mac spends on the app, as a procedure: each of the app's processes and its children's, with the CPU and memory each uses now.
 *
 * Main answers it itself (`apps/desktop/src/main/ipc/mac-resources-acts.ts`),
 * reading the Mac's process table, and a browser tab and the iOS app refuse
 * it. A process names its parent where that is one of the app's own, so a
 * reader draws them as a tree; its own figures never count its children's.
 */

import { Schema as EffectSchema } from "effect";
import { actProcedure, exactInput } from "./base.js";
import { MAC_RESOURCES_ACT_KIND } from "./kinds.js";

/** What a process is to the app: one of Electron's own, the host that runs local agents, or a child either of them started. */
export const MAC_PROCESS_KIND = {
  MAIN: "main",
  RENDERER: "renderer",
  GPU: "gpu",
  UTILITY: "utility",
  HOST: "host",
  CHILD: "child",
} as const;

export type MacProcessKind = (typeof MAC_PROCESS_KIND)[keyof typeof MAC_PROCESS_KIND];

const pidSchema = EffectSchema.Int.check(EffectSchema.isGreaterThan(0));

const macProcessSchema = EffectSchema.Struct({
  pid: pidSchema,
  /** The process that started it, where that is one of those answered. */
  parent: EffectSchema.optionalKey(pidSchema),
  kind: EffectSchema.Literals(Object.values(MAC_PROCESS_KIND)),
  /** What the system or Electron calls it: a utility's service, or a child's executable. */
  name: EffectSchema.String,
  /** Its CPU now, in percent of one core, so a process busy on several cores passes 100. */
  cpu: EffectSchema.Number.check(EffectSchema.isGreaterThanOrEqualTo(0)),
  /** Its resident memory, in bytes. */
  memory: EffectSchema.Number.check(EffectSchema.isGreaterThanOrEqualTo(0)),
});

export type MacProcess = typeof macProcessSchema.Type;

/** The app's processes, every one under its parent's in the order the system lists them. */
const macResourcesSchema = EffectSchema.Struct({
  processes: EffectSchema.Array(macProcessSchema),
});

export type MacResources = typeof macResourcesSchema.Type;

export const macResourcesActsContract = {
  [MAC_RESOURCES_ACT_KIND.MAC_RESOURCES_READ]: actProcedure("Could not read this Mac’s processes.")
    .input(exactInput(EffectSchema.Undefined))
    .output(macResourcesSchema),
};
