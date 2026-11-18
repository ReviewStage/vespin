import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Schema } from "effect";

import { ACT_USE, PORT_ACT_USE } from "../../../../packages/host/src/contract/kinds.ts";
import type { Baseline } from "./baseline.ts";

/**
 * write-mutation-guard.ts -- what the `write-through-mutation` rule reads:
 * the kinds that write, as `@repo/host`'s `PORT_ACT_USE` declares them, the
 * port's senders, the calls a write is sent from inside as a TanStack
 * mutation, the port's own callers, and the baseline of files that still
 * send a write bare.
 */
export const WRITE_MUTATION_GUARD_RULE = "vespin/write-through-mutation";

const PLUGIN_DIRECTORY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The window's act port's own callers, which send every act for the factories that hold one as a mutation. */
const PORT_CALLERS: ReadonlySet<string> = new Set([
  "packages/panel/src/act.ts",
  "packages/panel/src/act-mutations.ts",
]);

/** The window's act port's senders (`act.ts`), whose first argument is the kind they send. */
export const ACT_SENDERS: ReadonlySet<string> = new Set([
  "askAct",
  "tellAct",
  "pressAct",
  "sendAct",
]);

/** TanStack's own options builder, whose arguments hold a mutation beside every call named for one. */
const MUTATION_OPTIONS = "mutationOptions";

/** A call named for a mutation: `useMutation`, and each factory that builds one around an act, as `actMutation` or `taskRenameMutation`. */
const MUTATION_NAMED = /Mutation$/u;

/** Whether a call by this name holds a mutation in its arguments. */
export function holdsMutation(callee: string): boolean {
  return callee === MUTATION_OPTIONS || MUTATION_NAMED.test(callee);
}

/** The kinds that write, by the name a call site spells. */
const WRITE_KINDS: ReadonlySet<string> = new Set(
  Object.entries(PORT_ACT_USE)
    .filter(([, use]) => use === ACT_USE.WRITE)
    .map(([name]) => name),
);

/** Whether an act kind writes, which a surface sends only as a mutation. */
export function isWriteKind(name: string): boolean {
  return WRITE_KINDS.has(name);
}

/** Whether a file is one of the port's own callers, which send what a mutation's factory asks of them. */
export function isPortCaller(file: string): boolean {
  return PORT_CALLERS.has(file);
}

const BaselineSchema = Schema.Record(
  Schema.NonEmptyString,
  Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
);

/**
 * The files that still send a write bare, each with how many: writes that
 * draw nothing of their own, as a tab opened or a stream attached, and
 * writes that predate the rule. It only shrinks (`shared/baseline.ts`).
 */
export const WRITE_MUTATION_BASELINE: Baseline = Schema.decodeUnknownSync(
  Schema.fromJsonString(BaselineSchema),
)(readFileSync(path.join(PLUGIN_DIRECTORY, "write-mutation-baseline.json"), "utf8"));
