// syntax-colors.ts -- the colors a diff's code is drawn in on the phone, GitHub's default light and dark themes, which the desktop's diff draws through Shiki, by the styles the native highlighter names.

/**
 * Each style the diff view's highlighter colors (`DiffHighlighter.swift`'s
 * `SyntaxStyle`), in that enum's order: a keyword, a string, a comment, a
 * function, a type, a constant, a property, a tag, and a Markdown heading.
 * Note that these are a third-party theme's own values rather than the
 * brand's, as the desktop's Shiki themes are, so a diff reads the same on
 * the Mac and the phone.
 */
export const SYNTAX_COLORS = {
  LIGHT: [
    "#cf222e",
    "#0a3069",
    "#59636e",
    "#8250df",
    "#953800",
    "#0550ae",
    "#0550ae",
    "#116329",
    "#0550ae",
  ],
  DARK: [
    "#ff7b72",
    "#a5d6ff",
    "#8b949e",
    "#d2a8ff",
    "#ffa657",
    "#79c0ff",
    "#79c0ff",
    "#7ee787",
    "#79c0ff",
  ],
} as const;
