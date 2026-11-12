/**
 * value-kind.ts -- a thrown value named by its JavaScript kind alone, never by what it holds.
 *
 * A thrown value that is not an `Error` may be anything, and its words or
 * fields may quote whatever it was handed, so a log line or a refusal names
 * it by kind: the word `typeof` would answer, read through guards.
 */
import { Predicate } from "effect";

/** Each kind a value may be, as `typeof` words it. */
const VALUE_KIND = {
  STRING: "string",
  NUMBER: "number",
  BOOLEAN: "boolean",
  BIGINT: "bigint",
  SYMBOL: "symbol",
  UNDEFINED: "undefined",
  FUNCTION: "function",
  OBJECT: "object",
} as const;

type ValueKind = (typeof VALUE_KIND)[keyof typeof VALUE_KIND];

/** The value's kind, as `typeof` words it: `null` and arrays are objects. */
export function valueKind(value: unknown): ValueKind {
  if (Predicate.isString(value)) return VALUE_KIND.STRING;

  if (Predicate.isNumber(value)) return VALUE_KIND.NUMBER;

  if (Predicate.isBoolean(value)) return VALUE_KIND.BOOLEAN;

  if (Predicate.isBigInt(value)) return VALUE_KIND.BIGINT;

  if (Predicate.isSymbol(value)) return VALUE_KIND.SYMBOL;

  if (Predicate.isUndefined(value)) return VALUE_KIND.UNDEFINED;

  if (Predicate.isFunction(value)) return VALUE_KIND.FUNCTION;

  return VALUE_KIND.OBJECT;
}
