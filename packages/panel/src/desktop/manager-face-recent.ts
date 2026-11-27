/**
 * manager-face-recent.ts -- the faces this window picked last for a Manager, kept in the window's storage as a section's recent icons are, which every face picker offers under Recent.
 */

import { managerFaceSchema } from "@repo/features/manager-face";
import type { ManagerFaceRecent } from "@repo/ui/manager-face-picker";
import { Schema } from "effect";
import { readKept, writeKept } from "../kept-storage.js";

/** Where the window keeps the faces it picked last. */
const RECENT_KEY = "app.recentManagerFaces";

/** The faces picked last as the window keeps them, as JSON. */
const keptRecent = Schema.fromJsonString(Schema.Array(managerFaceSchema));

/** The faces this window picked last, read as a picker opens and written as it picks; a refused write keeps Recent as it stood. */
export const RECENT_MANAGER_FACES: ManagerFaceRecent = {
  read: () => readKept(RECENT_KEY, keptRecent, []),
  write: (faces) => {
    writeKept(RECENT_KEY, keptRecent, faces);
  },
};
