/**
 * conductor-import-procedures.ts -- an import from Conductor as the settings form calls it: check a key, run the import, and read the run's progress.
 *
 * Every procedure resolves the caller (`accountMiddleware`, on the resource
 * so it runs before an input is read) and runs the one operation behind it
 * (`conductor-import.ts`), which answers a workspace the caller is not in as
 * not found. The key is made a `Redacted` the moment it is read, and the run
 * seals it under the deployment's ring (`keyRingMiddleware`, so a deployment
 * holding none answers the run unavailable); nothing answers or logs it.
 */

import { Redacted } from "effect";
import type { UserIdResolver } from "../../http/http-effect.js";
import { accountMiddleware, hosted, keyRingMiddleware } from "../../orpc/base.js";
import {
  checkConductorImport,
  conductorImportProgress,
  runConductorImport,
} from "./conductor-import.js";

export interface ConductorImportProcedureSeams {
  resolveUserId: UserIdResolver;
}

/** The Conductor import resource: every procedure to a signed-in caller, the run on a deployment that holds a ring. */
export function conductorImportProcedures(seams: ConductorImportProcedureSeams) {
  const signedIn = hosted.conductorImport.use(accountMiddleware(seams.resolveUserId));
  const keyed = signedIn.use(keyRingMiddleware);

  return {
    check: signedIn.check.effect(function* ({ input, context: { userId } }) {
      return yield* checkConductorImport(userId, input.workspaceId, Redacted.make(input.apiKey));
    }),

    run: keyed.run.effect(function* ({ input, context: { userId } }) {
      return yield* runConductorImport(userId, input.workspaceId, Redacted.make(input.apiKey));
    }),

    progress: signedIn.progress.effect(function* ({ input, context: { userId } }) {
      return yield* conductorImportProgress(userId, input.workspaceId);
    }),
  };
}
