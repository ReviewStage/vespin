/** usage-limit.ts -- the durable notice left where a native agent hit its usage limit: moved on to its next payer, paused, or stopped. */
import { Schema } from "effect";

export const USAGE_LIMIT_PART = "data-usage-limit";
export const USAGE_LIMIT_AGENT = { CLAUDE: "Claude", CODEX: "Codex" } as const;

export const UsageLimitNoticeSchema = Schema.Struct({
  agent: Schema.Literals(Object.values(USAGE_LIMIT_AGENT)),
  /** The reset this pause waits for, in epoch milliseconds; null when the turn stopped or moved on. */
  resetsAt: Schema.NullOr(Schema.Number),
  /** The plan or key that ran out and the one the turn went on with, as Settings named them; absent for a pause or a stop. */
  moved: Schema.optionalKey(Schema.Struct({ from: Schema.String, to: Schema.String })),
});
export type UsageLimitNotice = typeof UsageLimitNoticeSchema.Type;
export type UsageLimitMove = NonNullable<UsageLimitNotice["moved"]>;

/** A worker's call the plan's usage limit ended, as its answer carries it: the notice its row draws in its answer's place. */
export const UsageLimitAnswerSchema = Schema.Struct({ usageLimit: UsageLimitNoticeSchema });
export type UsageLimitAnswer = typeof UsageLimitAnswerSchema.Type;
