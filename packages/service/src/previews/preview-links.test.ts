import assert from "node:assert/strict";
import { PAGE_SANDBOX_ORIGIN } from "@repo/features/page-frame";
import { Redacted } from "effect";
import { describe, it } from "vitest";
import type { PageSandbox } from "../pages/page-links.js";
import {
  mintPreviewHandoff,
  mintPreviewSession,
  PREVIEW_NAME_KIND,
  previewNameOf,
  previewNameOfHost,
  previewOrigin,
  previewReturnPath,
  readPreviewHandoff,
  readPreviewSession,
} from "./preview-links.js";

/**
 * A shared preview's tokens and host: a session cookie admits only the
 * member and agent it was minted for, until it lapses, and a handoff never
 * stands in for one; an agent's preview host is named by its task's key and
 * the head of its id, reads back as that, and no other host does; and a return after sign-in never leaves the preview's own site.
 * Synthetic keys, accounts, and agents throughout.
 */

const SANDBOX: PageSandbox = {
  origin: PAGE_SANDBOX_ORIGIN,
  key: Redacted.make("synthetic-preview-key-for-tests-only-00000"),
  appOrigins: ["https://app.test"],
};

const MEMBER = { userId: "user-1", agentId: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21" };
const NOW = 1_000_000;

describe("preview links", () => {
  it("admits the member a session was minted for, and nothing a handoff, another key, or time changed", () => {
    const session = mintPreviewSession(SANDBOX, MEMBER, NOW);
    assert.deepEqual(readPreviewSession(SANDBOX, session, NOW + 1), MEMBER);
    const otherKey = { ...SANDBOX, key: Redacted.make("another-synthetic-preview-key-000000000") };
    assert.equal(readPreviewSession(otherKey, session, NOW + 1), undefined);
    assert.equal(readPreviewSession(SANDBOX, session, NOW + 9 * 60 * 60 * 1000), undefined);
    const handoff = mintPreviewHandoff(SANDBOX, MEMBER, NOW);
    assert.equal(readPreviewSession(SANDBOX, handoff, NOW + 1), undefined);
    assert.deepEqual(readPreviewHandoff(SANDBOX, handoff, NOW + 1), MEMBER);
  });

  it("names an agent's preview host by its task's key, and reads no preview from any other host", () => {
    const name = previewNameOf("acme-labs", 2617, MEMBER.agentId);
    const { host } = new URL(previewOrigin(SANDBOX, name));
    assert.equal(host, "acme-labs-2617-8c1a6a.vespin.page");
    assert.deepEqual(previewNameOfHost(SANDBOX, host), {
      kind: PREVIEW_NAME_KIND.TASK,
      slug: "acme-labs",
      number: 2617,
      agentHead: "8c1a6a",
    });
    assert.deepEqual(previewNameOfHost(SANDBOX, `${host}.`), name);

    for (const other of [
      "vespin.page",
      "app.test",
      "x.vespin.page",
      "acme-0-8c1a6a.vespin.page",
      "acme-2617-8c1a6.vespin.page",
      `${host}.evil.test`,
    ]) {
      assert.equal(previewNameOfHost(SANDBOX, other), undefined, other);
    }
  });

  it("names a preview by its agent's id where its task's name would not fit in a DNS label", () => {
    const long = `personal-${"a".repeat(32)}-${"b".repeat(36)}`;
    const name = previewNameOf(long, 1, MEMBER.agentId);
    const { host } = new URL(previewOrigin(SANDBOX, name));
    assert.equal(host, "8c1a6a4f3d2e4d8b8b666f4c7a2e3b21.vespin.page");
    assert.deepEqual(previewNameOfHost(SANDBOX, host), {
      kind: PREVIEW_NAME_KIND.AGENT,
      agentId: MEMBER.agentId,
    });
  });

  it("returns only to a path of the preview's own", () => {
    assert.equal(previewReturnPath("/docs?x=1"), "/docs?x=1");

    for (const offSite of [
      "//evil.test",
      "/\\evil.test",
      "/\t/evil.test",
      "https://evil.test",
      null,
    ]) {
      assert.equal(previewReturnPath(offSite), "/", String(offSite));
    }
  });
});
