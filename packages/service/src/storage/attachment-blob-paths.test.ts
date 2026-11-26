/**
 * attachment-blob-paths.test.ts -- an attachment's objects stand where stored rows and the store's sweep expect them, and an id that is no UUID names nothing.
 */

import { expect, test } from "vitest";
import { ATTACHMENT_BLOB_VARIANT, attachmentBlobPath } from "./attachment-blob-paths.js";

const ID = "0b6f9f0e-5a3c-4f7e-9d2a-1c8e4b7a6d10";

test("names an attachment's bytes and its phone copy under the attachments folder", () => {
  expect(attachmentBlobPath(ID)).toBe(`attachments/${ID}`);
  expect(attachmentBlobPath(ID, ATTACHMENT_BLOB_VARIANT.PHONE)).toBe(`attachments/${ID}/phone`);
});

test("refuses an id that would name an object outside the attachment's own", () => {
  expect(() => attachmentBlobPath(`${ID}/../other`)).toThrow();
});
