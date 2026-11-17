import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { readMacSkills } from "@repo/host";
import type { MacSkills } from "@repo/host/contract";
import { Effect, Layer } from "effect";
import { app } from "electron";

/**
 * mac-skills.ts -- the skills this Mac's own coding agents keep, read from the signed-in user's home folder as Settings › Skills asks.
 *
 * The read is `@repo/host`'s (`readMacSkills`); main hands it the home
 * folder Electron names and Node's file system, read afresh on each ask.
 */

/** What the read runs on. */
const services = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);

/** The skills the Mac's agents keep now, in their skills folders under the home folder. */
export const readThisMacSkills: Effect.Effect<MacSkills> = Effect.suspend(() =>
  readMacSkills(app.getPath("home")),
).pipe(Effect.provide(services));
