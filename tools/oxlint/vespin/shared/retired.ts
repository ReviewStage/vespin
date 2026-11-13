import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Schema } from "effect";

import type { Baseline } from "./baseline.ts";
import { isLucideModule } from "./lucide-guard.ts";
import { scanCss } from "./style-guard.ts";

/**
 * retired.ts -- the retired guard as data: what phase 2 took out of the code
 * and keeps out. Each JSON file under `tools/oxlint/vespin/retired/` is one kind's
 * list of class names, `@repo/ui/icons` glyphs, and code patterns (a JSX prop
 * or an import), each refused outside the paths it allows and each with an
 * optional baseline of what files still hold, which may only shrink. A kind
 * guards itself by adding its own file, never by editing another's, so its
 * guard PR collides with no other. Read by the `retired` rule (TypeScript),
 * by the style guard (CSS selectors), and by the suppression check beside them.
 */
export const RETIRED_GUARD_RULE = "vespin/retired";

/** What a retired file names: a class, a glyph, a JSX prop, or an import. */
export const RETIRED_KIND = {
  CLASS: "class",
  GLYPH: "glyph",
  PROP: "prop",
  IMPORT: "import",
} as const;
type RetiredKind = (typeof RETIRED_KIND)[keyof typeof RETIRED_KIND];

const PLUGIN_DIRECTORY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RETIRED_DIRECTORY = path.join(PLUGIN_DIRECTORY, "retired");

/** A class name ending in this matches every class it starts: `desktop-toolbar*`. */
const PREFIX_MARK = "*";

/** The icon door, by its package name and by the folder a relative import reaches. */
const ICON_DOOR_MODULE = "@repo/ui/icons";
const ICON_DOOR_DIRECTORY = "packages/ui/src/icons/";

/** The extensions a relative import may spell its module with, which a retired import's repository path leaves off. */
const SOURCE_EXTENSION = /\.(?:[cm]?js|jsx|tsx?)$/u;

/** The registry of concepts the door exports, `GLYPH.BACK` among them. */
export const GLYPH_REGISTRY = "GLYPH";

// ---------------------------------------------------------------- the schema

const NonEmpty = Schema.NonEmptyString;

const BaselineSchema = Schema.Record(NonEmpty, Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)));

/** Every entry names the paths it stays in (prefixes from the repository's root) and may carry a baseline. */
const PLACE_FIELDS = {
  allow: Schema.Array(NonEmpty),
  baseline: Schema.optionalKey(BaselineSchema),
};

const ClassEntry = Schema.Struct({ class: NonEmpty, ...PLACE_FIELDS });
const GlyphEntry = Schema.Struct({ glyph: NonEmpty, ...PLACE_FIELDS });
const PropEntry = Schema.Struct({ prop: NonEmpty, ...PLACE_FIELDS });
const ImportEntry = Schema.Struct({
  import: NonEmpty,
  names: Schema.optionalKey(Schema.Array(NonEmpty)),
  ...PLACE_FIELDS,
});

const RetiredFileSchema = Schema.Struct({
  instead: NonEmpty,
  classes: Schema.optionalKey(Schema.Array(ClassEntry)),
  glyphs: Schema.optionalKey(Schema.Array(GlyphEntry)),
  patterns: Schema.optionalKey(Schema.Array(Schema.Union([PropEntry, ImportEntry]))),
});

const decodeRetiredFile = Schema.decodeUnknownSync(Schema.fromJsonString(RetiredFileSchema), {
  onExcessProperty: "error",
});

// ---------------------------------------------------------------- the catalog

/** One thing a retired file keeps out, flattened from its list. */
export interface Retirement {
  readonly kind: RetiredKind;
  /** The class, glyph, prop, or module it names. */
  readonly name: string;
  /** For an import, the imported names it refuses; every import of the module where empty. */
  readonly names: readonly string[];
  readonly allow: readonly string[];
  readonly baseline: Baseline;
  /** The retired file it comes from, and what to use instead. */
  readonly file: string;
  readonly instead: string;
}

/**
 * One retired file's retirements, read from its JSON. A file that is no JSON,
 * misses a field, or carries one the schema does not know throws, naming the
 * file, so a typo fails the lint rather than guarding nothing.
 */
export function parseRetiredFile(file: string, text: string): readonly Retirement[] {
  let decoded: typeof RetiredFileSchema.Type;
  try {
    decoded = decodeRetiredFile(text);
  } catch (cause) {
    throw new Error(`tools/oxlint/vespin/retired/${file} is not a retired file: ${String(cause)}`);
  }
  const shared = { file, instead: decoded.instead };
  const place = (entry: { allow: readonly string[]; baseline?: Baseline }) => ({
    allow: entry.allow,
    baseline: entry.baseline ?? {},
    names: [],
    ...shared,
  });
  return [
    ...(decoded.classes ?? []).map((entry) => ({
      ...place(entry),
      kind: RETIRED_KIND.CLASS,
      name: entry.class,
    })),
    ...(decoded.glyphs ?? []).map((entry) => ({
      ...place(entry),
      kind: RETIRED_KIND.GLYPH,
      name: entry.glyph,
    })),
    ...(decoded.patterns ?? []).map((entry) =>
      "prop" in entry
        ? { ...place(entry), kind: RETIRED_KIND.PROP, name: entry.prop }
        : {
            ...place(entry),
            kind: RETIRED_KIND.IMPORT,
            name: entry.import,
            names: entry.names ?? [],
          },
    ),
  ];
}

/** Every retirement in `directory`'s JSON files, in file order. */
export function readRetired(directory: string = RETIRED_DIRECTORY): readonly Retirement[] {
  return readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .flatMap((name) => parseRetiredFile(name, readFileSync(path.join(directory, name), "utf8")));
}

export const RETIRED: readonly Retirement[] = readRetired();

// ---------------------------------------------------------------- matching

/** Whether `file`, a repository path, is one a retirement still stands in. */
export function isAllowed(retirement: Retirement, file: string): boolean {
  return retirement.allow.some((prefix) => file.startsWith(prefix));
}

export function matchesClass(retirement: Retirement, token: string): boolean {
  if (retirement.kind !== RETIRED_KIND.CLASS) return false;
  if (!retirement.name.endsWith(PREFIX_MARK)) return token === retirement.name;
  return token.startsWith(retirement.name.slice(0, -PREFIX_MARK.length));
}

/** A Lucide glyph by its bare name: `ArrowLeft` for `ArrowLeftIcon` and `LucideArrowLeft` alike. */
function bareGlyph(name: string): string {
  return name.replace(/^Lucide(?=[A-Z])/u, "").replace(/(?<=.)Icon$/u, "");
}

/** Whether a name imported from the door, or a `GLYPH.KEY` read off it, is a retired glyph. */
export function matchesGlyph(retirement: Retirement, name: string): boolean {
  if (retirement.kind !== RETIRED_KIND.GLYPH) return false;
  if (retirement.name.startsWith(`${GLYPH_REGISTRY}.`)) return name === retirement.name;
  return bareGlyph(name) === bareGlyph(retirement.name);
}

/** Whether an import from `specifier`, in the file at repository path `file`, reaches the icon door. */
export function isIconDoor(specifier: string, file: string): boolean {
  if (specifier === ICON_DOOR_MODULE) return true;
  if (!specifier.startsWith(".")) return false;
  const reached = path.posix.join(path.posix.dirname(file), specifier);
  return `${reached}/`.startsWith(ICON_DOOR_DIRECTORY);
}

/**
 * Whether an import from `specifier` binds Lucide's glyphs by their names:
 * the icon door's, or `lucide-react`'s own, which the lucide guard counts by
 * the import statement alone, so a glyph added to an import it already
 * holds is caught here.
 */
export function bindsGlyphs(specifier: string, file: string): boolean {
  return isIconDoor(specifier, file) || isLucideModule(specifier);
}

/**
 * Whether a module specifier, in the file at repository path `file`, is a
 * retired import's module or one of its subpaths. A retired import names a
 * package (`cmdk`) or a module of the repository by its path from the root,
 * its extension left off (`packages/panel/src/tasks/tab-look`), which a
 * relative import reaches as `./tab-look.js` does, or a relative specifier
 * as written.
 */
export function matchesModule(retirement: Retirement, specifier: string, file: string): boolean {
  if (retirement.kind !== RETIRED_KIND.IMPORT) return false;
  const names = (module: string) =>
    module === retirement.name || module.startsWith(`${retirement.name}/`);
  // Note that a relative specifier is matched as written too, because older entries name one so.
  if (!specifier.startsWith(".")) return names(specifier);
  const reached = path.posix
    .join(path.posix.dirname(file), specifier)
    .replace(SOURCE_EXTENSION, "");
  return names(specifier) || names(reached);
}

/**
 * Whether `text` spells anything a retirement names, so a disable directive
 * in it could silence the guard. Note that we ask of the raw text, because a
 * file that never spells a retired name has nothing to silence.
 */
export function namesRetired(text: string, retirements: readonly Retirement[] = RETIRED): boolean {
  return retirements.some((retirement) => {
    const name = retirement.name.endsWith(PREFIX_MARK)
      ? retirement.name.slice(0, -PREFIX_MARK.length)
      : retirement.name;
    // Note that an import narrowed to names is spelled by those names, because its module is spelled by every file that never imports them.
    if (retirement.kind === RETIRED_KIND.IMPORT && retirement.names.length > 0) {
      return retirement.names.some((imported) => text.includes(imported));
    }
    if (retirement.kind === RETIRED_KIND.GLYPH) return spellsGlyph(text, name);
    return text.includes(name);
  });
}

/**
 * Whether `text` spells a glyph: a registry concept as a member read off
 * the registry or a name it was imported as, and a
 * Lucide glyph as a whole identifier, its aliases alike. Note that a
 * word holding the name (`Bottom` for `Bot`) or another table's member of
 * the same key (`SHOT.TASK`) spells nothing, because short concepts such
 * as `GLYPH.TASK` are spelled that way by files that draw no glyph at all.
 */
function spellsGlyph(text: string, name: string): boolean {
  if (name.startsWith(`${GLYPH_REGISTRY}.`)) {
    const key = name.slice(GLYPH_REGISTRY.length + 1);
    // Note that the member is read off the registry itself or a name it was imported as, never off any receiver, so a file reading GLYPH.SETTINGS and SHOT.TASK spells no GLYPH.TASK.
    const aliases = [
      ...text.matchAll(new RegExp(`\\b${GLYPH_REGISTRY}\\s+as\\s+(\\w+)`, "gu")),
    ].map((match) => match[1] ?? GLYPH_REGISTRY);
    const receivers = [GLYPH_REGISTRY, ...aliases].join("|");
    // Note that the read may be spaced or optional (`GLYPH .TASK`, `GLYPH?.TASK`), as the rule reads it off the syntax tree whatever its spelling.
    return new RegExp(`\\b(?:${receivers})\\s*\\??\\.\\s*${key}\\b`, "u").test(text);
  }
  return new RegExp(`\\b(?:Lucide)?${bareGlyph(name)}(?:Icon)?\\b`, "u").test(text);
}

// ---------------------------------------------------------------- CSS

/** Class names a selector spells, its strings and attribute selectors aside. */
function selectorClasses(selector: string): readonly string[] {
  const bare = selector
    .replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/gu, '""')
    .replace(/\[[^\]]*\]/gu, "[]");
  return [...bare.matchAll(/\.(-?[_a-zA-Z\\](?:\\.|[\w-])*)/gu)].map((match) =>
    (match[1] ?? "").replace(/\\(.)/gu, "$1"),
  );
}

export interface RetiredPlace {
  readonly retirement: Retirement;
  readonly line: number;
  readonly excerpt: string;
}

/**
 * Every place a stylesheet's selectors name a retired class outside the
 * paths it allows: one per class a selector names, so `.a, .a:hover` is two.
 */
export function retiredCssPlaces(
  file: string,
  text: string,
  retirements: readonly Retirement[] = RETIRED,
): readonly RetiredPlace[] {
  const places: RetiredPlace[] = [];
  const classes = retirements.filter(
    (retirement) => retirement.kind === RETIRED_KIND.CLASS && !isAllowed(retirement, file),
  );
  if (classes.length === 0) return places;
  for (const block of scanCss(text).blocks) {
    const selector = block.preludes.at(-1);
    if (selector === undefined || selector.startsWith("@")) continue;
    for (const token of selectorClasses(selector)) {
      for (const retirement of classes) {
        if (matchesClass(retirement, token))
          places.push({ retirement, line: block.line, excerpt: selector });
      }
    }
  }
  return places;
}
