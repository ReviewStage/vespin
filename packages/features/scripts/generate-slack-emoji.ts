// generate-slack-emoji.ts -- writes `src/slack-emoji-data.ts`, the app's one table of emoji: every emoji by category, its Unicode name, and the names Slack gives it.

import { readFile, writeFile } from "node:fs/promises";
import { argv, exit } from "node:process";
import { fileURLToPath } from "node:url";

/**
 * Slack names its emoji by iamcal's emoji-data (MIT), published as the
 * `emoji-datasource` package, whose tarball carries sprite sheets no build
 * needs, so it is no dependency: its `emoji.json` is read once here and
 * written into a module of the emoji, their categories, and their names
 * alone. Each emoji's name a reader hears and a search finds is Unicode's
 * (CLDR's), from `unicode-emoji-json` (MIT), or emoji-data's own where that
 * lists none. Every picker of emoji reads the module, a section's icon, a
 * Manager's face, and a reaction alike, and a reaction is kept by its
 * Slack name. Run it again where Slack names new emoji:
 *
 *   npm pack emoji-datasource@16.0.0 unicode-emoji-json@0.9.0
 *   tar xzf emoji-datasource-16.0.0.tgz package/emoji.json
 *   tar xzf unicode-emoji-json-0.9.0.tgz package/data-by-emoji.json
 *   node packages/features/scripts/generate-slack-emoji.ts package/emoji.json package/data-by-emoji.json
 *
 * An emoji newer than every macOS a Mac may run draws is left out, as the
 * icon picker leaves it out (`@repo/ui`'s `section-icon-model.ts`), and so
 * are the skin tones' swatches, which no one reacts with alone.
 */

/** The emoji-datasource release read, which the module names. */
const SOURCE = "emoji-datasource 16.0.0";

/** The unicode-emoji-json release whose names are read. */
const LABELS = "unicode-emoji-json 0.9.0";

/** The newest emoji version written: one newer is not yet drawn by every macOS a Mac may run. */
const NEWEST_EMOJI_VERSION = 15.1;

/** The category of the skin tones' swatches. */
const COMPONENT = "Component";

/** Where the module is written. */
const OUT = fileURLToPath(new URL("../src/slack-emoji-data.ts", import.meta.url));

/** An emoji as `emoji.json` lists it, of which only these keys are read. */
interface DatasourceEmoji {
  readonly name: string | null;
  readonly unified: string;
  readonly short_names: readonly string[];
  readonly category: string;
  readonly sort_order: number;
  readonly added_in: string;
}

/** An emoji as `unicode-emoji-json`'s `data-by-emoji.json` names it, of which only its name is read. */
interface UnicodeEmoji {
  readonly name: string;
}

/** The variation selector that asks for an emoji's colored face, which the two tables' spellings of one emoji may differ by. */
const VARIATION_SELECTOR = /\uFE0F/gu;

/** The emoji a `unified` code point list spells. */
function emojiOf(unified: string): string {
  return String.fromCodePoint(...unified.split("-").map((point) => Number.parseInt(point, 16)));
}

/** The module: every emoji by category in Unicode's order, each with its Unicode name and its Slack names, Slack's own first. */
function moduleOf(
  emoji: readonly DatasourceEmoji[],
  named: Readonly<Record<string, UnicodeEmoji>>,
): string {
  const unicode = new Map(
    Object.entries(named).map(([face, one]) => [face.replace(VARIATION_SELECTOR, ""), one.name]),
  );

  const groups = new Map<string, string[]>();

  for (const one of emoji
    .filter((each) => each.category !== COMPONENT && Number(each.added_in) <= NEWEST_EMOJI_VERSION)
    .toSorted((a, b) => a.sort_order - b.sort_order)) {
    const face = emojiOf(one.unified);

    const label =
      unicode.get(face.replace(VARIATION_SELECTOR, "")) ?? one.name?.toLowerCase() ?? face;

    const rows = groups.get(one.category) ?? [];
    rows.push(`      ${JSON.stringify([face, label, ...one.short_names])},`);
    groups.set(one.category, rows);
  }

  return [
    "/**",
    ` * slack-emoji-data.ts -- the app's one table of emoji: every emoji by category, its Unicode name, and the names Slack gives it, written by \`scripts/generate-slack-emoji.ts\` from ${SOURCE} (iamcal's emoji-data, MIT) and ${LABELS} (MIT), never by hand.`,
    " */",
    "",
    'import type { SlackEmojiGroup } from "./slack-emoji.js";',
    "",
    "/** Each category, and each emoji in it: the emoji, its Unicode name, then its Slack names, Slack's own first. */",
    "export const SLACK_EMOJI: readonly SlackEmojiGroup[] = [",
    ...[...groups].flatMap(([name, rows]) => [
      `  { name: ${JSON.stringify(name)}, emojis: [`,
      ...rows,
      "  ] },",
    ]),
    "];",
    "",
  ].join("\n");
}

const [path, labels] = [argv[2], argv[3]];

if (path === undefined || labels === undefined) {
  console.error("Usage: node generate-slack-emoji.ts <emoji.json> <data-by-emoji.json>");
  exit(1);
}

// SAFETY: the file is emoji-datasource's own `emoji.json`, whose every entry carries the keys `DatasourceEmoji` names.
const emoji = JSON.parse(await readFile(path, "utf8")) as readonly DatasourceEmoji[];

// SAFETY: the file is unicode-emoji-json's own `data-by-emoji.json`, every emoji keyed to an entry carrying its `name`.
const named = JSON.parse(await readFile(labels, "utf8")) as Readonly<Record<string, UnicodeEmoji>>;

await writeFile(OUT, moduleOf(emoji, named));
