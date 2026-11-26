// nested-text-model.test.ts -- a Text holding nested Texts is drawn anew exactly when what they draw changes.

import { createElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { nestedTextKey } from "./nested-text-model.js";

/** Stands in for a nested Text: the key reads an element's props, never its type. */
function Nested({
  children,
}: {
  readonly children?: ReactNode;
  readonly modifiers?: readonly object[];
}): ReactNode {
  return children;
}

/** A pull request's heading as its page nests it: the title, then its number muted. */
function heading(title: string): ReactNode {
  return [
    createElement(Nested, { key: "title" }, title),
    createElement(Nested, { key: "number", modifiers: [{ $type: "foregroundStyle" }] }, " #128"),
  ];
}

describe("nestedTextKey", () => {
  it("changes when a nested title is edited, and holds while it is not", () => {
    expect(nestedTextKey(heading("Invite teammates by email"))).not.toBe(
      nestedTextKey(heading("Invite a teammate by email")),
    );
    expect(nestedTextKey(heading("Invite a teammate by email"))).toBe(
      nestedTextKey(heading("Invite a teammate by email")),
    );
  });
});
