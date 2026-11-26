import { emojiSchema } from "@repo/features/emoji-wire";
import { noMatchWords, readingWords } from "@repo/features/words";
import { queryOptions, type UseQueryResult, useQuery } from "@tanstack/react-query";
import { Schema } from "effect";
import { memo, type ReactNode } from "react";
import { type EmojiGroup, emojiGroups, findEmoji } from "../../section-icon-model.js";
import { NOTE_LINE_LOOK, NoteLine } from "../note-line/note-line.js";
import { IconPickerChoice, IconPickerGroup } from "./icon-picker.js";

/**
 * icon-picker-emoji.tsx -- the icon picker's emoji: every emoji by category, loaded the first time they are shown, and the emoji a search finds, an emoji typed or pasted into it first.
 *
 * The emoji are `unicode-emoji-json`'s, a chunk of their own loaded once
 * per window the first time a picker reads them (`useEmojiGroups`, which
 * the picker's owner calls where it shows them or a search looks in them),
 * so no window parses them before. With nothing
 * searched, `IconPickerEmoji` draws every emoji under its category's name,
 * the one chosen, or else the first, the grid's tab stop. A search draws
 * an emoji typed or picked into it (⌃⌘Space) first, so one newer than the
 * grid's still can be chosen, then whatever the owner's own set found
 * beside the emoji (`beside`, as a section's glyphs), then the emoji whose
 * name it matches; the first drawn is the tab stop. Where nothing is
 * found, the grid says why: the owner's set still loading or failed, the
 * emoji's, or that nothing matched. An owner whose emoji is picked in a
 * color, as a Manager's face is, hands `colors`, and a press then floats the
 * emoji's colors from it (`IconPickerChoice`'s flyout) rather than choosing it.
 */

/** The emoji's query, a key no other read of the window's takes. */
const EMOJI_KEY = ["icon-picker-emoji"] as const;

/** What the picker says where the emoji could not be loaded. */
const EMOJI_FAILED = "The emoji could not be loaded.";

/** What the picker says while the emoji load. */
const EMOJI_READING = readingWords("emoji");

/** What the picker says where a search found no emoji. */
const NO_EMOJI_MATCH = noMatchWords({ one: "emoji", many: "emoji" });

/** What an emoji typed into the search is offered under, and the emoji found by name where none was typed. */
const TYPED_EMOJI = "Emoji";

/** What the emoji found by name are offered under after one typed. */
const MORE_EMOJI = "More emoji";

/** Whether a search, trimmed, is one emoji. */
const isOneEmoji = Schema.is(emojiSchema);

/** Every emoji by category, loaded once per window the first time a picker shows them. */
const emojiQuery = queryOptions({
  queryKey: EMOJI_KEY,
  queryFn: (): Promise<EmojiGroup[]> =>
    import("unicode-emoji-json/data-by-group.json").then(
      (module) => emojiGroups(module.default),
      () => Promise.reject(new Error(EMOJI_FAILED)),
    ),
  staleTime: Number.POSITIVE_INFINITY,
  gcTime: Number.POSITIVE_INFINITY,
  retry: false,
});

/** One emoji and the name a reader hears it by. */
interface EmojiOne {
  readonly emoji: string;
  readonly name: string;
}

/** What an owner's own set found beside the emoji a search found, as a section's glyphs. */
export interface IconPickerEmojiBeside {
  /** Draws what the owner's set found, the grid's tab stop where `stop`; none where it found nothing. */
  readonly found: ((stop: boolean) => ReactNode) | undefined;
  /** Why the owner's set has nothing to find yet, as it loads or failed to; none once it has loaded. */
  readonly unloaded: string | undefined;
  /** What the grid says where neither the owner's set nor the emoji found anything. */
  readonly noMatch: string;
}

/**
 * How an owner whose emoji is picked in a color draws the one chosen and
 * floats each one's colors, as a Manager's face does, rather than an emoji
 * pressed being chosen at once; the rest are drawn bare. Note that it is held across presses (`useMemo`), since
 * every cell is drawn again where it changes.
 */
export interface IconPickerEmojiColors {
  /** The emoji chosen drawn in its cell, in the color it was chosen in. */
  readonly chosen: (emoji: string) => ReactNode;
  /** The emoji's colors (`IconPickerColors`), floated from its cell while they stand open. */
  readonly colors: (emoji: string) => ReactNode;
  /** Hears the colors put away, by Escape or a press away. */
  readonly onClose: () => void;
}

/** Every emoji by category, as TanStack Query keeps them, read the first time a picker asks. */
export function useEmojiGroups(): UseQueryResult<EmojiGroup[]> {
  return useQuery(emojiQuery);
}

/** An emoji as a cell of the grid draws it, bare, in the text's own ink. */
function EmojiFace({ emoji }: { emoji: string }): React.JSX.Element {
  return <span className="ui-icon-picker-emoji text-foreground">{emoji}</span>;
}

/** One emoji's choice in the grid, pressed while it is the one chosen. */
export function IconPickerEmojiChoice({
  emoji,
  label,
  pressed,
  stop,
  onPress,
}: {
  emoji: string;
  /** What a reader hears it as: its Unicode name, or the emoji itself where none is known. */
  label: string;
  pressed: boolean;
  stop: boolean;
  onPress: () => void;
}): React.JSX.Element {
  return (
    <IconPickerChoice
      label={label}
      pressed={pressed}
      stop={stop}
      face={<EmojiFace emoji={emoji} />}
      onPress={onPress}
    />
  );
}

/** How the grid's emoji cells are pressed: chosen at once, or floating their colors, and which emoji's stand open. */
interface EmojiPress {
  readonly onEmoji: (emoji: string) => void;
  readonly colors: IconPickerEmojiColors | undefined;
  readonly opened: string | undefined;
}

/**
 * One emoji's cell: chosen at once, or, where its owner picks it in a color,
 * floating its colors while they stand open. Note that it is drawn again only
 * where what it shows changed, so opening one emoji's colors draws that
 * cell and not some two thousand around it.
 */
const EmojiCell = memo(function EmojiCell({
  emoji,
  label,
  pressed,
  stop,
  open,
  onEmoji,
  colors,
}: {
  emoji: string;
  label: string;
  pressed: boolean;
  stop: boolean;
  open: boolean;
  onEmoji: (emoji: string) => void;
  colors: IconPickerEmojiColors | undefined;
}): React.JSX.Element {
  if (colors === undefined) {
    return (
      <IconPickerEmojiChoice
        emoji={emoji}
        label={label}
        pressed={pressed}
        stop={stop}
        onPress={() => onEmoji(emoji)}
      />
    );
  }

  return (
    <IconPickerChoice
      label={label}
      pressed={pressed}
      stop={stop}
      face={pressed ? colors.chosen(emoji) : <EmojiFace emoji={emoji} />}
      popup
      flyout={
        open
          ? { label: `${label} color`, content: colors.colors(emoji), onClose: colors.onClose }
          : undefined
      }
      onPress={() => onEmoji(emoji)}
    />
  );
});

/** The emoji as an owner hands them: every one by category once loaded, none until then, and whether the load failed. */
interface EmojiLoaded {
  readonly groups: readonly EmojiGroup[] | undefined;
  readonly failed: boolean;
}

/** What the grid says in the emoji's place while they load, failed to, or hold nothing the search found. */
function emojiNote({ groups, failed }: EmojiLoaded): string {
  if (failed) return EMOJI_FAILED;

  return groups === undefined ? EMOJI_READING : NO_EMOJI_MATCH;
}

/** The emoji with nothing searched: every one under its category's name; the one chosen, or the first, is the grid's tab stop. */
function EmojiGroups({
  loaded,
  chosen,
  press,
}: {
  loaded: EmojiLoaded;
  chosen: string | undefined;
  press: EmojiPress;
}): React.JSX.Element {
  const groups = loaded.groups;

  if (groups === undefined || groups.length === 0) {
    return <NoteLine look={NOTE_LINE_LOOK.LIST}>{emojiNote(loaded)}</NoteLine>;
  }

  const all = groups.flatMap((group) => group.emojis);
  const stop = all.find((one) => one.emoji === chosen) ?? all[0];

  return (
    <>
      {groups.map((group) => (
        <IconPickerGroup key={group.name} name={group.name}>
          {group.emojis.map((one) => (
            <EmojiCell
              key={one.emoji}
              emoji={one.emoji}
              label={one.name}
              pressed={one.emoji === chosen}
              stop={one === stop}
              open={one.emoji === press.opened}
              onEmoji={press.onEmoji}
              colors={press.colors}
            />
          ))}
        </IconPickerGroup>
      ))}
    </>
  );
}

/**
 * What a search found: an emoji typed into it first, then what the owner's
 * set found (`beside`), then the emoji whose name it matches. The first
 * found is the grid's tab stop.
 */
function FoundEmoji({
  loaded,
  query,
  chosen,
  press,
  beside,
}: {
  loaded: EmojiLoaded;
  query: string;
  chosen: string | undefined;
  press: EmojiPress;
  beside: IconPickerEmojiBeside | undefined;
}): React.JSX.Element {
  const typed = query.trim();
  const typedOne: readonly EmojiOne[] = isOneEmoji(typed) ? [{ emoji: typed, name: typed }] : [];
  const groups = loaded.groups === undefined ? [] : findEmoji(loaded.groups, query);
  const named = groups.flatMap((group) => group.emojis).filter((one) => one.emoji !== typed);
  const besideFound = beside?.found;

  if (besideFound === undefined && typedOne.length === 0 && named.length === 0) {
    // Note that nothing found says why where a set did not load, rather than that nothing matched.
    const words =
      beside?.unloaded ??
      (loaded.groups === undefined ? emojiNote(loaded) : (beside?.noMatch ?? NO_EMOJI_MATCH));

    return <NoteLine look={NOTE_LINE_LOOK.LIST}>{words}</NoteLine>;
  }

  const firstEmoji = typedOne.length > 0;

  const choice = (one: EmojiOne, stop: boolean) => (
    <EmojiCell
      key={one.emoji}
      emoji={one.emoji}
      label={one.name}
      pressed={one.emoji === chosen}
      stop={stop}
      open={one.emoji === press.opened}
      onEmoji={press.onEmoji}
      colors={press.colors}
    />
  );

  return (
    <>
      {firstEmoji ? (
        <IconPickerGroup name={TYPED_EMOJI}>
          {typedOne.map((one) => choice(one, true))}
        </IconPickerGroup>
      ) : null}
      {besideFound?.(!firstEmoji)}
      {named.length === 0 ? null : (
        <IconPickerGroup name={firstEmoji ? MORE_EMOJI : TYPED_EMOJI}>
          {named.map((one, at) =>
            choice(one, !firstEmoji && besideFound === undefined && at === 0),
          )}
        </IconPickerGroup>
      )}
    </>
  );
}

/**
 * The picker's emoji; see the module's head. With nothing searched it
 * draws every emoji, and with a search what it found, beside what the
 * owner's own set found where it hands one. The emoji are its owner's to
 * read (`useEmojiGroups`), and one pressed is handed to `onEmoji`, which
 * opens its colors (`opened`) where the owner hands `colors`. Note
 * that it is drawn again only where what it shows changed, so a press
 * elsewhere in the picker walks none of its some two thousand cells.
 */
export const IconPickerEmoji = memo(function IconPickerEmoji({
  groups,
  failed,
  query,
  chosen,
  onEmoji,
  beside,
  colors,
  opened,
}: {
  /** Every emoji by category; none while they load or where they failed to. */
  groups: readonly EmojiGroup[] | undefined;
  /** Whether the emoji could not be loaded. */
  failed: boolean;
  /** The search, nothing searched where blank. */
  query: string;
  /** The emoji chosen, pressed; none where the choice is no emoji. */
  chosen: string | undefined;
  onEmoji: (emoji: string) => void;
  /** What the owner's own set found beside the emoji, which a search alone draws. */
  beside?: IconPickerEmojiBeside | undefined;
  /** How an emoji picked in a color is drawn and asks its colors; none where a press chooses it at once. */
  colors?: IconPickerEmojiColors | undefined;
  /** The emoji whose colors stand open, where `colors` is handed; none where none do. */
  opened?: string | undefined;
}): React.JSX.Element {
  const loaded = { groups, failed };
  const press = { onEmoji, colors, opened };

  if (query.trim() === "") return <EmojiGroups loaded={loaded} chosen={chosen} press={press} />;

  return <FoundEmoji loaded={loaded} query={query} chosen={chosen} press={press} beside={beside} />;
});
