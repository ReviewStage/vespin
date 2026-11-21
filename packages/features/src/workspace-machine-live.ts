import { Schema } from "effect";
import { refuses } from "./contract/base.js";
import {
  LIVE_MODE,
  LIVE_PARAM,
  type LiveReadAnswer,
  liveRead,
  liveRows,
  ORDER,
} from "./live-read.js";
import { LIVE_READ, LIVE_USER_QUERY } from "./live-wire.js";
import { HOSTED_SERVICE_PATH } from "./service-paths.js";
import { HOSTED_API_ERROR } from "./service-wire.js";

/**
 * workspace-machine-live.ts -- the machines one workspace owns as Settings › Machines follows them over the service's held poll: the read declared.
 *
 * The service answers one statement, every machine the workspace owns that
 * was not removed, by name and then id, to a member of it alone; a
 * workspace the reader is not in is answered not found. Each row says what
 * the section draws: the machine's name, its platform and architecture as
 * strings, so a kind this build does not know hides none of the others, who
 * connected it, null once that account is gone, which networks its agents
 * may reach, where its setup stands, whether its host program has called
 * in since it joined, whether its beat went past fresh, and, for one whose
 * box has yet to collect its secret, when the pairing that made it lapses,
 * from which instant the reader leaves it out, since a live statement reads
 * no clock (`host-live.ts`'s hosts alike).
 */

/** The machines one workspace owns: one part, every machine of it not removed, by name and then id. */
export const WORKSPACE_MACHINES_READ = liveRead({
  name: LIVE_READ.WORKSPACE_MACHINES,
  path: HOSTED_SERVICE_PATH.LIVE_WORKSPACE_MACHINES,
  params: { [LIVE_USER_QUERY]: LIVE_PARAM.USER, workspaceId: LIVE_PARAM.TEXT },
  mode: LIVE_MODE.SNAPSHOT,
  parts: {
    machines: liveRows({
      row: Schema.Struct({
        id: Schema.String,
        name: Schema.String,
        platform: Schema.String,
        arch: Schema.String,
        connectedBy: Schema.NullOr(Schema.String),
        network: Schema.String,
        /** Where its setup stands (`DEVICE_SETUP`), null once it is ready. */
        setup: Schema.NullOr(Schema.String),
        /** Whether its host program has registered since it joined. */
        calledIn: Schema.Boolean,
        /** Whether its beat went past fresh since it last beat, as the scheduled sweep found it. */
        away: Schema.Boolean,
        /** When the pairing that made it lapses, in epoch milliseconds, while its box has yet to collect its secret; null once it has. */
        pairingLapsesAt: Schema.NullOr(Schema.Number),
      }),
      key: "id",
      order: [
        ["name", ORDER.ASC],
        ["id", ORDER.ASC],
      ],
    }),
  },
  refuses: refuses(HOSTED_API_ERROR.NOT_FOUND),
});

export type WorkspaceMachinesLiveAnswer = LiveReadAnswer<typeof WORKSPACE_MACHINES_READ>;
