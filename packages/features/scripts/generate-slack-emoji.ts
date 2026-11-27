// generate-slack-emoji.ts -- writes `src/slack-emoji-names.ts`, every emoji by the names Slack gives it, which a reaction is kept and sent by.

import { readFile, writeFile } from "node:fs/promises";
import { argv, exit } from "node:process";
import { fileURLToPath } from "node:url";

/**
 * Slack names its emoji by iamcal's emoji-data (MIT), published as the
 * `emoji-datasource` package, whose tarball carries sprite sheets no build
 * needs, so it is no dependency: its `emoji.json` is read once here and
 * written into a module of each emoji and its Slack names alone. A picker
 * reads the app's one table of emoji (`emoji-data.ts`, `emoji-model.ts`);
 * this one only turns a pick into the name a reaction is kept under, and a
 * name the service or `chat_react` is handed back into its emoji. Run it
 * again where Slack names new emoji:
 *
 *   npm pack emoji-datasource@16.0.0 && tar xzf emoji-datasource-16.0.0.tgz package/emoji.json
 *   node packages/features/scripts/generate-slack-emoji.ts package/emoji.json
 *
 * An emoji newer than every macOS a Mac may run draws is left out, as the
 * pickers leave it out, and so are the skin tones' swatches, which no one
 * reacts with alone.
 */

/** The emoji-datasource release read, which the module names. */
const SOURCE = "emoji-datasource 16.0.0";

/** The newest emoji version written: one newer is not yet drawn by every macOS a Mac may run. */
const NEWEST_EMOJI_VERSION = 15.1;

/** The category of the skin tones' swatches. */
const COMPONENT = "Component";

/** Where the module is written. */
const OUT = fileURLToPath(new URL("../src/slack-emoji-names.ts", import.meta.url));

/** An emoji as `emoji.json` lists it, of which only these keys are read. */
interface DatasourceEmoji {
  readonly unified: string;
  readonly short_names: readonly string[];
  readonly category: string;
  readonly sort_order: number;
  readonly added_in: string;
}

/** The emoji a `unified` code point list spells. */
function emojiOf(unified: string): string {
  return String.fromCodePoint(...unified.split("-").map((point) => Number.parseInt(point, 16)));
}

/** The module: every emoji in Unicode's order, each with its Slack names, Slack's own first. */
function moduleOf(emoji: readonly DatasourceEmoji[]): string {
  const rows = emoji
    .filter((one) => one.category !== COMPONENT && Number(one.added_in) <= NEWEST_EMOJI_VERSION)
    .toSorted((a, b) => a.sort_order - b.sort_order)
    .map((one) => `  ${JSON.stringify([emojiOf(one.unified), ...one.short_names])},`);

  return [
    "/**",
    ` * slack-emoji-names.ts -- every emoji by the names Slack gives it, Slack's own first, which a reaction is kept and sent by: written by \`scripts/generate-slack-emoji.ts\` from ${SOURCE} (iamcal's emoji-data, MIT), never by hand.`,
    " */",
    "",
    'import type { SlackEmojiTable } from "./slack-emoji.js";',
    "",
    "/** Each emoji, then its Slack names, Slack's own first. */",
    "export const SLACK_EMOJI_NAMES: SlackEmojiTable = [",
    ...rows,
    "];",
    "",
  ].join("\n");
}

const path = argv[2];

if (path === undefined) {
  console.error("Usage: node generate-slack-emoji.ts <emoji.json>");
  exit(1);
}

// SAFETY: the file is emoji-datasource's own `emoji.json`, whose every entry carries the keys `DatasourceEmoji` names.
const emoji = JSON.parse(await readFile(path, "utf8")) as readonly DatasourceEmoji[];

await writeFile(OUT, moduleOf(emoji));
