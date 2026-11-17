/**
 * mac-skill-acts.ts -- the act that reads the skills this Mac's own coding agents keep, answered on the act port.
 *
 * Only a panel asks, as Settings › Skills' Bring in from your Mac opens, so
 * the procedure refuses any other window. The read itself is
 * `@repo/host`'s (`readMacSkills`), over the home folder main hands it.
 */

import { actPortFor, type PlatformActProcedures, refuseUnlessPanel } from "@repo/host/act-port";
import { MAC_SKILLS_ACT_KIND, type MacSkills } from "@repo/host/contract";
import type { Effect } from "effect";
import type { WebContents } from "electron";

type MacSkillsActKind = (typeof MAC_SKILLS_ACT_KIND)[keyof typeof MAC_SKILLS_ACT_KIND];

export interface MacSkillsActsDependencies {
  /** The skills the Mac's agents keep now; main's read of the home folder, or a test's. */
  read: Effect.Effect<MacSkills>;
}

const macSkillsPort = actPortFor<WebContents>();

export function macSkillsProcedures(
  dependencies: MacSkillsActsDependencies,
): Pick<PlatformActProcedures<WebContents>, MacSkillsActKind> {
  const { read } = dependencies;

  return {
    [MAC_SKILLS_ACT_KIND.MAC_SKILLS_READ]: macSkillsPort[
      MAC_SKILLS_ACT_KIND.MAC_SKILLS_READ
    ].effect(function* ({ context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());

      return yield* read;
    }),
  };
}
