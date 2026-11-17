import assert from "node:assert/strict";
import { test } from "vitest";
import { linkFace, saidSpanOf } from "./link-face.js";

/**
 * link-face.test.ts -- a bare address says itself whole but for its scheme,
 * and a labeled link says its label; an editor holding a bare address's
 * words shows the part its face says. Synthetic addresses.
 */

test("a link whose words are its address says it whole, without its scheme or trailing slash, however the words spell it", () => {
  const href = "https://www.example.com/account/ABC123/resources/devices/add?tab=ios#form";

  const face = {
    words: "www.example.com/account/ABC123/resources/devices/add?tab=ios#form",
    bare: true,
  };

  assert.deepEqual(linkFace(href, href), face);
  assert.deepEqual(linkFace(href, href.replace("https://", "")), face);
  assert.deepEqual(linkFace("https://example.com/", "https://example.com"), {
    words: "example.com",
    bare: true,
  });
});

test("a bare address says its steps decoded, an escaped slash kept", () => {
  const href = "https://example.com/docs/caf%C3%A9/a%2Fb";
  assert.deepEqual(linkFace(href, href), { words: "example.com/docs/café/a%2Fb", bare: true });
});

test("a labeled link, or an address that is not the web's, says its words", () => {
  assert.deepEqual(
    linkFace("https://example.com/guides/idempotent_requests", "idempotency guide"),
    {
      words: "idempotency guide",
      bare: false,
    },
  );
  assert.deepEqual(linkFace("file:///Users/someone/notes.md", "file:///Users/someone/notes.md"), {
    words: "file:///Users/someone/notes.md",
    bare: false,
  });
});

test("the part of a bare address's words its face says stands past the scheme and short of a trailing slash, and a labeled link has none", () => {
  const words = "https://example.com/guides/";

  assert.deepEqual(saidSpanOf(words, words), { start: 8, end: words.length - 1 });
  assert.deepEqual(saidSpanOf("https://example.com", "example.com"), { start: 0, end: 11 });
  assert.equal(saidSpanOf("https://example.com/guides", "the guides"), undefined);
  assert.equal(saidSpanOf("mailto:someone@example.com", "mailto:someone@example.com"), undefined);
});
