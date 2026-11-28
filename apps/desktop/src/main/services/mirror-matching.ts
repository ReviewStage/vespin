/**
 * mirror-matching.ts -- a mirror's files matched in a `utilityProcess` of main's own, rather than on main's event loop.
 *
 * What is asked and when, and the restart, are `@repo/host`'s
 * (`mirror-match-remote.ts`); this is only how the desktop starts the
 * process: the matching bundle built beside main (`dist/mirror-match.js`),
 * forked
 * (`utility-process-spawn.ts`) the first time a mirror is matched, talked to over its parent port,
 * and killed with the scope the launch builds it in.
 */
import { PRODUCT_NAME } from "@repo/features/product-name";
import { type MatchMirror, mirrorMatchInProcess } from "@repo/host/mirror-match-remote";
import type { Effect, Scope } from "effect";
import { utilityProcessSpawn } from "./utility-process-spawn";

/** The matching process's bundle, beside main's own in the build's directory. */
const ENTRY = "mirror-match.js";

/** What Activity Monitor names the process. */
const SERVICE_NAME = `${PRODUCT_NAME} Mirror Matching`;

/** The mirrors' matching, through a process forked from `resourceDirectory`'s bundle. */
export function matchMirrorsInUtilityProcess(
  resourceDirectory: string,
): Effect.Effect<MatchMirror, never, Scope.Scope> {
  return mirrorMatchInProcess(utilityProcessSpawn(resourceDirectory, ENTRY, SERVICE_NAME));
}
