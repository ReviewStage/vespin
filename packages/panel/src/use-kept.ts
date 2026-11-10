import { Schema, SchemaTransformation } from "effect";
import { useCallback, useEffect, useRef, useState } from "react";
import { readKept, readKeptText, writeKept } from "./kept-storage.js";

/**
 * use-kept.ts -- a view choice this window remembers across launches (a fold, a filter, a sort, where a list stood scrolled), read and written through one hook.
 *
 * A view choice is this window's alone, so it is kept in the renderer's own
 * storage (`kept-storage.ts`) rather than on the account. Each is declared
 * once as a `KeptKey` (`keptKey`), beside the surface that keeps it, in an
 * `as const` set of its keys: the name it is kept under and the Schema its
 * value reads and writes through, so the value `useKept` answers is the
 * type the key was declared with. A key is one fixed name, never one put
 * together from an id: a choice kept for each task, or each group, is one
 * value kept under one key, a record or a list by that id.
 */

/** Where a view choice is kept, and how its value reads and writes there. */
export interface KeptKey<A> {
  /** The name it is kept under in the window's storage. */
  readonly name: string;
  readonly schema: Schema.Codec<A, string>;
}

/** A view choice's key: kept under `name`, its value read and written through `schema`. */
export function keptKey<A>(name: string, schema: Schema.Codec<A, string>): KeptKey<A> {
  return { name, schema };
}

/** A flag kept as the word `true` or `false`; any other word no longer reads, and the flag stands at its initial value. */
export const keptFlag = Schema.Literals(["true", "false"]).pipe(
  Schema.decodeTo(
    Schema.Boolean,
    SchemaTransformation.transform({
      decode: (kept) => kept === "true",
      encode: (flag) => (flag ? "true" : "false"),
    }),
  ),
);

/** The keys whose last write storage refused, so what a surface draws is newer than what storage holds, each with the text storage held then and the choice drawn. */
const UNWRITTEN = new Map<string, { readonly text: string | null; readonly drawn: unknown }>();

/** Whether storage refused the last write under `name` and holds what it held then, so the choice drawn is newer than it. */
function refusedNow(name: string): boolean {
  const unwritten = UNWRITTEN.get(name);
  return unwritten !== undefined && unwritten.text === readKeptText(name);
}

/** The surfaces drawn now that hold each key, so a choice made in one is drawn in every other. */
const HOLDERS = new Map<string, Set<(kept: unknown) => void>>();

/**
 * The choice kept under `key`, or `initial` where none was kept, it no
 * longer reads, or storage refuses the read; the door that chooses another
 * and keeps it; and the door that changes the choice over what is kept now.
 * Note that it is read once, as the surface is first drawn, so a surface
 * drawn again after it went opens at the choice it last kept, or the one
 * drawn where storage refused it (`keptNow`); that a choice
 * made through any surface holding the same key is drawn at once in every
 * other; that the doors are the same doors across draws, so a row handed
 * one draws again only when the choice does; and that `change` hands its
 * function what storage holds now, so another window's choice for another
 * id of a record is kept over this one's own, and an answer that is what it
 * was handed keeps and says nothing.
 */
export function useKept<A>(
  key: KeptKey<A>,
  initial: A,
): readonly [A, (next: A) => void, (change: (kept: A) => A) => void] {
  const [value, setValue] = useState<A>(() => keptNow(key, initial));
  // What this surface draws, for the doors, which outlive a draw.
  const drawn = useRef(value);
  useEffect(() => {
    const held = (next: unknown) => {
      // Note that what a holder is told was kept through this key's own schema, so it is this key's type.
      const kept = next as A;
      drawn.current = kept;
      setValue(kept);
    };
    const holders = HOLDERS.get(key.name) ?? new Set();
    holders.add(held);
    HOLDERS.set(key.name, holders);
    return () => {
      holders.delete(held);
    };
  }, [key.name]);
  const choose = useCallback(
    (next: A) => {
      drawn.current = next;
      setValue(next);
      if (writeKept(key.name, key.schema, next)) UNWRITTEN.delete(key.name);
      else UNWRITTEN.set(key.name, { text: readKeptText(key.name), drawn: next });
      for (const holder of HOLDERS.get(key.name) ?? []) holder(next);
    },
    [key],
  );
  const change = useCallback(
    (changed: (kept: A) => A) => {
      // Note that where storage refused the last write, the choice drawn is newer than the one it holds, so it is changed instead, unless another window has kept one since.
      const was = refusedNow(key.name)
        ? drawn.current
        : readKept(key.name, key.schema, drawn.current);
      const next = changed(was);
      if (!Object.is(next, was)) choose(next);
    },
    [key, choose],
  );
  return [value, choose, change];
}

/**
 * The choice kept under `key` now, or `initial` where none was kept, it no
 * longer reads, or storage refuses the read, for a caller outside React
 * that reads it as it acts, as a failure's Investigate asks which workspace
 * is chosen as the failure is shown. Note that where storage refused the
 * last write, the choice drawn is answered, since it is newer than what
 * storage holds, as `useKept`'s `change` reads it.
 */
export function keptNow<A>(key: KeptKey<A>, initial: A): A {
  // Note that what was drawn was chosen through this key's own schema, so it is this key's type.
  if (refusedNow(key.name)) return UNWRITTEN.get(key.name)?.drawn as A;
  return readKept(key.name, key.schema, initial);
}
