/**
 * literals-reading-unknown.ts -- a fixed vocabulary as an answer's reader decodes it, a word this build does not know read as one it does.
 *
 * A service may write one more word than a released build knows: a status
 * it gained, a kind it added. Refusing the whole answer over that one word
 * leaves the build with nothing, so a reader takes the unknown word as the
 * member given, and the answer still reads. A write still names a word of
 * the vocabulary alone, so an input keeps a plain `Literals`.
 */

import { Predicate, Schema, SchemaTransformation } from "effect";

/**
 * A literal set that reads any word, one outside `values` as `unknown`, and
 * writes only `values`. Note that its encoded side is typed as `values`
 * alone, because a write never names a word outside it, so an answer's
 * encoded type stays the one its callers hold; its guard lets any word in
 * only for the decode to read it.
 */
export function literalsReadingUnknown<const Values extends ReadonlyArray<string>>(
  values: Values,
  unknown: Values[number],
) {
  const known: ReadonlySet<string> = new Set(values);

  return Schema.declare((input: unknown): input is Values[number] =>
    Predicate.isString(input),
  ).pipe(
    Schema.decodeTo(
      Schema.Literals(values),
      SchemaTransformation.transform({
        decode: (word): Values[number] => (known.has(word) ? word : unknown),
        encode: (word): Values[number] => word,
      }),
    ),
  );
}
