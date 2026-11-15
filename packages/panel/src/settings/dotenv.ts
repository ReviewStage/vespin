/**
 * dotenv.ts -- a `.env` file's words read as the variables it sets, as Add variables spreads a pasted or imported one a pair to a line.
 *
 * Each line that sets a name reads `NAME=value`, an `export ` before it
 * dropped, the space around the name and the value trimmed, and one pair of
 * matching quotes around the value taken off. A quoted value ends at its
 * closing quote, a comment after it left out, and may run over several
 * lines, as a key's PEM does, read whole up to that quote, its line breaks
 * kept; one whose quote never closes sets nothing, rather than a value cut
 * short. A blank line, a `#` comment, and a line
 * with no `=` set nothing. A value is otherwise read as it stands, so a `#`
 * inside it and a quoted value's escapes are kept as written; whether a name
 * is one a variable may take is the form's to say.
 */

/** One variable a `.env` sets. */
export interface DotenvPair {
  readonly name: string;
  readonly value: string;
}

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

/** The quote a value opens with, where it opens with one. */
function openingQuote(value: string): string | undefined {
  return QUOTES.find((each) => value.startsWith(each));
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
    const quote = openingQuote(pair.value);

    if (quote === undefined) {
      pairs.push(pair);
      continue;
    }

    // Note that a value closing on its own line ends at its quote, whatever follows it, a comment among it.
    const closes = pair.value.indexOf(quote, 1);

    if (closes > 0) {
      pairs.push({ name: pair.name, value: pair.value.slice(1, closes) });
      continue;
    }

    // Note that the value's next lines are read as they stand, its own line breaks, up to the line its quote closes on.
    const held = [pair.value.slice(1)];

    while (at < lines.length && !(lines[at] ?? "").includes(quote)) {
      held.push(lines[at] ?? "");
      at += 1;
    }

    // A quote that never closes sets nothing, rather than a value cut short.
    if (at >= lines.length) break;
    const last = lines[at] ?? "";
    held.push(last.slice(0, last.indexOf(quote)));
    at += 1;
    pairs.push({ name: pair.name, value: held.join("\n") });
  }

  return pairs;
}
