/** connection-lost.ts -- the durable notice left where a native agent lost its connection to the model's provider and waited for it. */
import { Schema } from "effect";

export const CONNECTION_LOST_PART = "data-connection-lost";

/** The provider the connection was lost to, by the name the notice says. */
export const CONNECTION_LOST_PROVIDER = { ANTHROPIC: "Anthropic", OPENAI: "OpenAI" } as const;

export const ConnectionLostNoticeSchema = Schema.Struct({
  provider: Schema.Literals(Object.values(CONNECTION_LOST_PROVIDER)),
  /** When the provider's host answered again, in epoch milliseconds; null while the runner still waits, or where it gave up. */
  restoredAt: Schema.NullOr(Schema.Number),
});
export type ConnectionLostNotice = typeof ConnectionLostNoticeSchema.Type;
