import { Effect } from "effect";
import { markdownHtmlParserQuery } from "../markdown-html-parser.js";
import { testQueryClientNow } from "./copy-feedback.js";
import { landRead } from "./landed-reads.js";

/**
 * markdown.ts -- the HTML parser a reply's markdown is drawn through, landed as the panel lands it after its first paint.
 *
 * A reply drawn before the parser's chunk has landed is drawn again through
 * it once it has (`../markdown-html-parser.ts`). A test that reads a reply's
 * parsed markup at once runs this first, and every case of its file after has
 * it (`landed-reads.ts`); a test of a reply drawn before the parser lands
 * leaves it out.
 */

/** Loads the parser into the test's Query client and settles once it has landed. */
export const markdownHtmlParserLanded: Effect.Effect<void, Error> = Effect.suspend(() =>
  landRead(testQueryClientNow(), markdownHtmlParserQuery),
).pipe(Effect.asVoid);
