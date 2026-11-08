/**
 * txid.ts -- the writing transaction's id, as a statement returns it and a row decodes it.
 *
 * A write reads the id of the transaction it commits in from its own
 * `RETURNING`, as Neon's mutations guide does it, so a client following the
 * rows waits for that transaction to arrive on its live read before it
 * confirms the write (`sync/notification.ts`). A write that changed no row
 * returns none, so there is nothing to wait for. The id is 64 bits, so it
 * travels as a decimal string to stay exact.
 */

import { sql } from "drizzle-orm";
import { Schema } from "effect";

/** The id of the transaction the statement runs in, as text. */
export const CURRENT_TXID = sql<string>`pg_current_xact_id()::text`;

/** A `.returning()` shape answering the transaction's id alone. */
export const TXID_RETURNING = { txid: CURRENT_TXID };

/** A row holding the transaction's id alone, as `TXID_RETURNING` answers it. */
export const TxidRowSchema = Schema.Struct({ txid: Schema.String });
