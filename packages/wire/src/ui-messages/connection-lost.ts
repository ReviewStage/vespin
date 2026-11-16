/** connection-lost.ts -- the durable notice left where a native agent lost its connection to the model's provider and waited for it. */
import { Schema } from "effect";

export const CONNECTION_LOST_PART = "data-connection-lost";

/** The provider the connection was lost to, by the name the notice says. A client from before a name reads the notice as a part it does not know, and draws nothing. */
export const CONNECTION_LOST_PROVIDER = {
  ANTHROPIC: "Anthropic",
  OPENAI: "OpenAI",
  CURSOR: "Cursor",
} as const;

export type ConnectionLostProvider =
  (typeof CONNECTION_LOST_PROVIDER)[keyof typeof CONNECTION_LOST_PROVIDER];

export const ConnectionLostNoticeSchema = Schema.Struct({
  provider: Schema.Literals(Object.values(CONNECTION_LOST_PROVIDER)),
  /** When the provider's host answered again, in epoch milliseconds; null while the runner still waits, or where it gave up. */
  restoredAt: Schema.NullOr(Schema.Number),
});

export type ConnectionLostNotice = typeof ConnectionLostNoticeSchema.Type;
