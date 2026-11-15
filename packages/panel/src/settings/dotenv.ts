/**
 * dotenv.ts -- a `.env` file's words read as the variables it sets, as Add variables spreads a pasted or imported one a pair to a line.
 *
 * Each line that sets a name reads `NAME=value`, an `export ` before it
 * dropped, the space around the name and the value trimmed, and one pair of
 * matching quotes around the value taken off. A quoted value may run over
 * several lines, as a key's PEM does, and is read whole up to its closing
 * quote, its line breaks kept; one whose quote never closes sets nothing,
 * rather than a value cut short. A blank line, a `#` comment, and a line
 * with no `=` set nothing. A value is otherwise read as it stands, so a `#`
 * inside it and a quoted value's escapes are kept as written; whether a name
 * is one a variable may take is the form's to say.
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

/** The quotes a value may open with. */
const QUOTES = ["'", '"'] as const;

/** One line's name and the value its line holds, or nothing where it sets none. */
function lineOf(line: string): DotenvPair | undefined {
  const trimmed = line.trim();

  if (trimmed === "" || trimmed.startsWith("#")) return undefined;
  const bare = trimmed.replace(EXPORT, "");
  const at = bare.indexOf("=");

  if (at <= 0) return undefined;

  return { name: bare.slice(0, at).trim(), value: bare.slice(at + 1).trim() };
}

/** The quote a value opens and does not close on its own line, where it does. */
function openQuote(value: string): string | undefined {
  const quote = QUOTES.find((each) => value.startsWith(each));

  if (quote === undefined) return undefined;

  return value.length > 1 && value.endsWith(quote) ? undefined : quote;
}

/** The variables `text` sets, in the order its lines set them. */
export function parseDotenv(text: string): readonly DotenvPair[] {
  const lines = text.split(/\r?\n/u);
  const pairs: DotenvPair[] = [];
  let at = 0;

  while (at < lines.length) {
    const pair = lineOf(lines[at] ?? "");
    at += 1;

    if (pair === undefined) continue;
    const quote = openQuote(pair.value);

    if (quote === undefined) {
      pairs.push({ name: pair.name, value: pair.value.replace(QUOTED, "$2") });
      continue;
    }

    // Note that the value's next lines are read as they stand, its own line breaks, up to the line its quote closes on.
    const held = [pair.value.slice(1)];

    while (at < lines.length && !(lines[at] ?? "").trimEnd().endsWith(quote)) {
      held.push(lines[at] ?? "");
      at += 1;
    }

    // A quote that never closes sets nothing, rather than a value cut short.
    if (at >= lines.length) break;
    held.push((lines[at] ?? "").trimEnd().slice(0, -1));
    at += 1;
    pairs.push({ name: pair.name, value: held.join("\n") });
  }

  return pairs;
}
