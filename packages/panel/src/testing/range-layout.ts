/**
 * range-layout.ts -- the line boxes a range reads, which jsdom lacks, answered as a page with no layout would: none.
 *
 * jsdom lays nothing out and gives a `Range` no `getClientRects`, so a
 * module that measures the first line of some words (the description's
 * comments, `description-comments.tsx`'s `firstLineIn`) would find nothing to
 * call. Here a range has no line boxes, as an element jsdom draws has none; a
 * test that needs some stubs `getClientRects` itself. Installed for every test
 * file by the suite's setup wherever the environment has a `Range` without one.
 */

if (typeof Range !== "undefined" && !Reflect.has(Range.prototype, "getClientRects")) {
  Range.prototype.getClientRects = () => document.createElement("span").getClientRects();
}
