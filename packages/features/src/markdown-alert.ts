// markdown-alert.ts -- GitHub's alerts (`> [!NOTE]`, `> [!TIP]`, `> [!IMPORTANT]`, `> [!WARNING]`, `> [!CAUTION]`) as every client reads them: their kinds, the marker a quote opens on, and the title each is headed by.

/** The kinds of alert GitHub draws, by the word its marker names. */
export const ALERT_KIND = {
  NOTE: "note",
  TIP: "tip",
  IMPORTANT: "important",
  WARNING: "warning",
  CAUTION: "caution",
} as const;

export type AlertKind = (typeof ALERT_KIND)[keyof typeof ALERT_KIND];

/** The marker an alert opens on, alone on its line, in any case, as GitHub reads it. */
export const ALERT_MARKER = /^\s*\[!(note|tip|important|warning|caution)\][^\S\n]*(?:\n|$)/iu;

/** The title each kind is headed by, in GitHub's own words. */
export const ALERT_TITLE = {
  [ALERT_KIND.NOTE]: "Note",
  [ALERT_KIND.TIP]: "Tip",
  [ALERT_KIND.IMPORTANT]: "Important",
  [ALERT_KIND.WARNING]: "Warning",
  [ALERT_KIND.CAUTION]: "Caution",
} as const satisfies Record<AlertKind, string>;

export function isAlertKind(word: string): word is AlertKind {
  return Object.values(ALERT_KIND).some((kind) => kind === word);
}

/** The marker words open on: its kind, and how much of the words it takes; none where they open on no marker. */
export function alertMarkerOf(
  words: string,
): { readonly kind: AlertKind; readonly length: number } | undefined {
  const marker = ALERT_MARKER.exec(words);
  const kind = marker?.[1]?.toLowerCase();

  if (marker === null || kind === undefined || !isAlertKind(kind)) return undefined;

  return { kind, length: marker[0].length };
}
