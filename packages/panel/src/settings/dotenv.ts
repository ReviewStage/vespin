/**
 * dotenv.ts -- a `.env` file's words read as the variables it sets, as Add variables spreads a pasted or imported one a pair to a line.
 *
 * Each line that sets a name reads `NAME=value`, an `export ` before it
 * dropped, the space around the name and the value trimmed, and one pair of
 * matching quotes around the value taken off. A blank line, a `#` comment,
 * and a line with no `=` set nothing. A value is read as it stands, so a
 * `#` inside it, a quoted value's escapes, and a value running over several
 * lines are kept as written, the last two cut at the line's end; whether a
 * name is one a variable may take is the form's to say.
 */

/** One variable a `.env` sets. */
export interface DotenvPair {
  readonly name: string;
  readonly value: string;
}

/** A value's one pair of matching quotes, single or double, around all of it. */
const QUOTED = /^(['"])(.*)\1$/su;

/** An `export ` leading the line, as a shell's own file writes one. */
const EXPORT = /^export\s+/u;

/** One line read as the pair it sets, or nothing where it sets none. */
function pairOf(line: string): DotenvPair | undefined {
  const trimmed = line.trim();

  if (trimmed === "" || trimmed.startsWith("#")) return undefined;
  const bare = trimmed.replace(EXPORT, "");
  const at = bare.indexOf("=");

  if (at <= 0) return undefined;
  const value = bare.slice(at + 1).trim();

  return { name: bare.slice(0, at).trim(), value: value.replace(QUOTED, "$2") };
}

/** The variables `text` sets, in the order its lines set them. */
export function parseDotenv(text: string): readonly DotenvPair[] {
  return text.split(/\r?\n/u).flatMap((line) => {
    const pair = pairOf(line);

    return pair === undefined ? [] : [pair];
  });
}
