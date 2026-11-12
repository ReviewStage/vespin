/** compacted.ts -- the durable notice left where a native agent's harness compacted its session, on its own or asked to. */
import { Schema } from "effect";

export const COMPACTED_PART = "data-compacted";

export const CompactedNoticeSchema = Schema.Struct({
  /** The tokens the session held before the fold, as the harness counted them; null where it did not say, never zero. */
  tokensBefore: Schema.NullOr(Schema.Number),
});

export type CompactedNotice = typeof CompactedNoticeSchema.Type;
