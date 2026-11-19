/** agent-moved.ts -- the durable mark left where a coding agent moved between the cloud and one of its starter's Macs in the same agent, the messages above it run at the place it left. */
import { Schema } from "effect";

export const AGENT_MOVED_PART = "data-agent-moved";

/** A place an agent ran at: one of its starter's Macs, by its id and the name it had as the agent moved, or the cloud, which names no device. */
const MovedPlaceSchema = Schema.Struct({
  deviceId: Schema.optionalKey(Schema.String),
  name: Schema.optionalKey(Schema.String),
});

export type MovedPlace = typeof MovedPlaceSchema.Type;

export const AgentMovedMarkSchema = Schema.Struct({
  /** When the agent moved, in epoch milliseconds. */
  at: Schema.Number,
  from: MovedPlaceSchema,
  to: MovedPlaceSchema,
});

export type AgentMovedMark = typeof AgentMovedMarkSchema.Type;
