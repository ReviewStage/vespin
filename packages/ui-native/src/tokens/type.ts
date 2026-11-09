// type.ts -- the sizes words are drawn at where React Native draws them, the system's text styles at the default Dynamic Type size, which React Native scales by the reader's own.

/** The system's text styles, in points at the Large Dynamic Type size; React Native scales each by the reader's setting. */
export const TEXT_SIZE = {
  TITLE_2: 22,
  TITLE_3: 20,
  HEADLINE: 17,
  BODY: 17,
  CALLOUT: 16,
  SUBHEADLINE: 15,
  FOOTNOTE: 13,
} as const;

/** The system's monospaced face, which code is drawn in. */
export const MONOSPACE_FONT = "Menlo";
