// address-words-model.ts -- an address, a link or an identifier as a line of text draws it: breaking only after "@" and before "." or "/", never hyphenated.

/** Unicode's zero-width space: a place the line may break, drawn as nothing (UAX #14's ZW). */
const MAY_BREAK = "\u200B";

/** Unicode's word joiner: forbids a break, and so a hyphen, where it stands, drawn as nothing (UAX #14's WJ). */
const NO_BREAK = "\u2060";

/** Where an address may break: after "@", and before "." or "/", as Mail and Safari break one. */
const PARTS = /(?<=@)|(?=[./])/u;

/** Words with a space in them, which are a sentence rather than an address, and break as words do. */
const SPACED = /\s/u;

/** `part` with a word joiner between each of its characters, so no line breaks or hyphenates inside it. */
function joined(part: string): string {
  return [...part].join(NO_BREAK);
}

/**
 * `address` as a SwiftUI `Text` draws it, since neither SwiftUI nor
 * `@expo/ui` sets a text's hyphenation: breaking only after "@" and before
 * "." or "/", and never hyphenating, as iOS's own fields break an email or
 * a link. Note that both marks are drawn as nothing and VoiceOver reads past
 * them, but a caller still hands the plain address to what is heard. Words
 * with a space in them, such as why a person can't be picked, are left as
 * they are, so they still wrap between words.
 */
export function addressWords(address: string): string {
  if (SPACED.test(address)) return address;

  return address.split(PARTS).map(joined).join(MAY_BREAK);
}
