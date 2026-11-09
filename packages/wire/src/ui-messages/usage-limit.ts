/** usage-limit.ts -- the durable notice left where a native agent exhausted its payers. */
import { Schema } from "effect";

export const USAGE_LIMIT_PART = "data-usage-limit";
export const USAGE_LIMIT_AGENT = { CLAUDE: "Claude", CODEX: "Codex" } as const;

export const UsageLimitNoticeSchema = Schema.Struct({
  agent: Schema.Literals(Object.values(USAGE_LIMIT_AGENT)),
  /** The reset this pause waits for, in epoch milliseconds; null when the turn stopped. */
  resetsAt: Schema.NullOr(Schema.Number),
});
export type UsageLimitNotice = typeof UsageLimitNoticeSchema.Type;
