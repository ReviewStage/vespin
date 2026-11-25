/**
 * store-failure.ts -- a store read the service could not make, written down where its cause is known.
 *
 * A statement the pool refused or a row that would not decode is not a
 * defect of this service: the database is unreachable, and the request or
 * the tool call it was made for cannot finish. What is written down here is
 * the failure's own kind and, for a `SqlError`, the code its driver's error
 * carries, and never a value it carried, since a Schema failure's issue may
 * quote the row and a statement's sentence can quote the key a constraint
 * refused. A route carries the failure onward as the unavailable refusal,
 * which its caller may try again, unless the failure is one the same write
 * meets every time (`isDataException`), which a route may pass over instead.
 */

import type { StoreFailure } from "@repo/database/core/query";
import { failureCode, failureDetail, failureKind } from "@repo/runtime/effect";
import { Effect, Option } from "effect";

/** The SQLSTATE class of a data exception (`22P02`, `22P05`, `22021`, `22003`): a value the statement carried that no column of its type takes. */
const DATA_EXCEPTION_CLASS = "22";

/**
 * The failure as one warning line of kinds alone: a `SqlError` by the kind of
 * its reason (a connection refused, a statement timed out) and the code its
 * driver's error carries (`SqlError: UnknownError (code 57P01)`, or
 * `(cause Error)` where it carries none), a Schema failure by the kind of its
 * issue. Neither's sentence is written, because a Schema issue's message
 * renders the value that would not decode, and a statement's can quote the
 * key a constraint refused. The procedure that asked is the log line's own
 * annotation (`orpc/base.ts`).
 */
export function logStoreFailure(failure: StoreFailure): Effect.Effect<void> {
  return Effect.logWarning(`Hosted store unavailable: ${storeFailureWords(failure)}`);
}

/** The failure in the words `logStoreFailure` writes it in: its kinds, and its driver's code where it carries one. */
export function storeFailureWords(failure: StoreFailure): string {
  const detail = Option.match(failureDetail(failure), {
    onNone: () => "",
    onSome: (said) => ` (${said})`,
  });

  return `${failureKind(failure)}${detail}`;
}

/**
 * Whether the statement failed on a value it carried, a SQLSTATE of class
 * 22 (half a character in a JSON value, a number out of range), which the
 * database refuses each time the same write is made, unlike a connection
 * lost or a statement timed out, which a later try may get past.
 */
export function isDataException(failure: StoreFailure): boolean {
  return Option.exists(failureCode(failure), (code) => code.startsWith(DATA_EXCEPTION_CLASS));
}
