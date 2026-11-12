// monogram.ts -- the one or two letters an avatar draws for a name it has no picture for.

/** What an avatar draws for a name with no letter in it. */
const NO_LETTER = "?";

/** A word's first letter or digit, whole even where it is two code units. */
function firstLetter(word: string): string | undefined {
  return word.match(/[\p{L}\p{N}]/u)?.[0];
}

/**
 * The first letter of a name's first word and of its last, upper-cased:
 * "Ada Lovelace" is "AL", "Ada" is "A", and a name with no letter, an
 * emoji's alone, is "?".
 */
export function monogramOf(name: string): string {
  const words = name.trim().split(/\s+/u);

  const letters = [words[0], words.length > 1 ? words.at(-1) : undefined].flatMap((word) =>
    word === undefined ? [] : (firstLetter(word) ?? []),
  );

  return letters.length === 0 ? NO_LETTER : letters.join("").toLocaleUpperCase("en-US");
}
