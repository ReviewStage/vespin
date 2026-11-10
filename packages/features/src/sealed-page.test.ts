import { describe, expect, it } from "vitest";
import { PAGE_THEME_SCHEME, type PageTheme } from "./page-theme.js";
import { sealedPageDocument } from "./sealed-page.js";

const THEME: PageTheme = {
  scheme: PAGE_THEME_SCHEME.LIGHT,
  variables: {} as PageTheme["variables"],
  inset: "16px",
  narrowInset: "16px",
};

describe("sealedPageDocument", () => {
  it("seals a page ahead of a script that a comment closed by --!> leaves standing before its doctype", () => {
    const sealed = sealedPageDocument(
      "<!-- a --!><script>leak()</script><!-- b --><!doctype html><p>Hi</p>",
      THEME,
    );
    expect(sealed.indexOf("Content-Security-Policy")).toBeLessThan(
      sealed.indexOf("<script>leak()"),
    );
  });
});
