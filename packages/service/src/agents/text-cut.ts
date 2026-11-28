/**
 * text-cut.ts -- a text cut to a bound, never inside a surrogate pair, its end marked with an ellipsis where it was cut.
 */

/** A text cut to the bound as it stands, never inside a surrogate pair, ending in an ellipsis where it was cut. */
export function cutText(text: string, maximumChars: number): string {
  if (text.length <= maximumChars) return text;
  const end = Math.max(0, maximumChars - 1);
  const code = text.charCodeAt(end - 1);
  // Note that a high surrogate left alone would be no character a store keeps.
  const safe = code >= 0xd800 && code <= 0xdbff ? end - 1 : end;

  return `${text.slice(0, safe)}…`;
}
