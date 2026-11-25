import { searchHit } from "@repo/features/search-score";
import { noMatchWords, TERM } from "@repo/features/words";
import { Command } from "cmdk";
import { Predicate } from "effect";
import { memo, type ReactNode, type Ref, useLayoutEffect, useRef, useState } from "react";
import { cn } from "../../cn.js";
import { SearchIcon } from "../../icons/lucide-glyphs.js";
import { ReplayWords } from "../../session-replay-marks.js";
import { COMBOBOX_HEADING } from "../../shadcn/combobox.js";
import { DialogContent, Dialog as ShadcnDialog } from "../../shadcn/dialog.js";
import {
  COMBOBOX_LIST_HEIGHT,
  ComboboxListBox,
  type ComboboxOption,
  ComboboxOptionItem,
} from "../combobox/combobox.js";
import { closesCard } from "../dialog/close-chord.js";
import { useHeldFocus } from "../dialog/held-focus.js";
import { NoteLine } from "../note-line/note-line.js";
import { TEXT_ELEMENT, TEXT_VARIANT, Text } from "../text/text.js";
import { TEXT_BUTTON_LINES, TEXT_BUTTON_TONE, TextButton } from "../text-button/text-button.js";
import { Tooltip } from "../tooltip/hint.js";

/**
 * command-dialog.tsx -- a search field over a list of commands in a card over the dimmed window, found by typing and chosen with the arrows and Return: ⌘K's frame, and every palette's.
 *
 * It is the one place cmdk is drawn, so no caller imports it: the field
 * and the list's keys (↑ and ↓ wrapping, Home and End, Return choosing) are
 * cmdk's, and everything seen is this component's. The rows are narrowed
 * here by the one tiered scorer every search ranks by (`search-score.ts`), each group in
 * the caller's order with its rows best first, so a group's note stays
 * after its rows, and stays when none of them match. shadcn/ui's command pattern is the reference: cmdk's root
 * inside shadcn's dialog (`../../shadcn/dialog.tsx`, on Base UI), which
 * traps focus, hears Escape and a press on the dimmed window as asking the
 * dialog away, and hands focus back to whatever held it once it has gone.
 * The card stands high in the window rather than in its middle, so the
 * field stays where it is while the rows under it come and go, and it
 * fades out over `--ui-duration-exit` as it closes, inert while it does,
 * as every dialog does.
 * In a narrow room, a phone's, the card spans the screen but for a margin
 * on every side, clear of a phone's notch and status bar, and stands near
 * the top, so the keyboard leaves its rows the room under it. Under a
 * finger its foot, whose keys are none to press, is not drawn.
 *
 * Drawn as a page (`COMMAND_PRESENTATION.PAGE`), as a phone's Search tab
 * is, it fills the screen on the page's own ground with no scrim, under a
 * head of its owner's (the page's title), its field in a well under the
 * head, and its foot drawn under a finger too, where its owner stands the
 * screen's way between places; a group may end its heading in a press of
 * its own (`act`), such as Show all.
 *
 * Each row is a menu's row (`ComboboxOptionItem`), its lead, its glyph,
 * its name and detail fading where they are cut, its hint (a chord) and its
 * end marks, lit by the `aria-selected` cmdk sets as the arrows or the
 * pointer move; one with a card hangs it beside the row while the pointer
 * rests on it. Rows stand in groups under a heading, each with a note after
 * its rows (a source still reading, or one that failed), and where no row
 * stands the list says so, or says it is reading.
 *
 * A row is matched by its `words`, never its `id`: cmdk writes the id into
 * an attribute, which the session recording does not mask
 * (`packages/panel/src/session-replay.ts`), so an id is the caller's key and
 * never words a reader would see. A caller that ranks its own rows, as ⌘K
 * does, turns the matching off (`COMMAND_FILTER.NONE`) and hands the rows
 * already narrowed. Choosing a row runs its `onSelect` and nothing else:
 * whether the dialog closes, or opens a further list in place, is the
 * caller's. No key pressed in the card goes on to the window.
 */

/** Whether the dialog narrows its rows to the words typed, or shows them as the caller handed them. */
export const COMMAND_FILTER = {
  /** The dialog matches each row's words against the field and ranks what matches. */
  WORDS: "words",
  /** The caller narrows and ranks its rows itself, from the query it is told. */
  NONE: "none",
} as const;

type CommandFilter = (typeof COMMAND_FILTER)[keyof typeof COMMAND_FILTER];

/** How the list stands: a card over the dimmed window, as ⌘K, or a page filling the screen, as a phone's Search tab. */
export const COMMAND_PRESENTATION = {
  DIALOG: "dialog",
  PAGE: "page",
} as const;

type CommandPresentation = (typeof COMMAND_PRESENTATION)[keyof typeof COMMAND_PRESENTATION];

/** A press at the end of a group's heading: its words, what a reader hears where they say less, and the press. */
export interface CommandGroupAct {
  readonly label: string;
  readonly heard?: string | undefined;
  readonly onPress: () => void;
}

/** One command: a menu row, the words typing finds it by, and what choosing it does. */
export interface CommandItem extends ComboboxOption {
  /** What typing is matched against: the row's name and any words it is known by. */
  readonly words: string;
  /** Further words that find the row and are never drawn, such as a setting's older name. */
  readonly keywords?: readonly string[] | undefined;
  /** Choosing it, by Return or a press. */
  readonly onSelect: () => void;
  /** Whether its words name a person's thing, a task's title or a repository's name, kept masked in a screen recording even in a palette that unmasks its own (`replayUnmasked`). */
  readonly replayMasked?: boolean | undefined;
}

/** A run of commands under a heading, or under none, and what is said after them. */
export interface CommandGroup {
  /** The caller's own key for the group, stable while it stands. */
  readonly id: string;
  /** The heading over the run, which names it to a reader too. */
  readonly label?: string | undefined;
  readonly items: readonly CommandItem[];
  /** Said after the group's rows: that more are being read, or why they could not be. */
  readonly note?: ReactNode;
  /** A press at the heading's end, such as Show all or Clear; none for a heading that does nothing. */
  readonly act?: CommandGroupAct | undefined;
}

/** The dimmed window: the card stands a fifth of the way down it rather than in its middle; in a narrow room, a margin in from its edges and below a phone's notch and status bar. Its one column is the window's width and no more, since an auto track would grow to the widest row and push the card past the screen. */
const ROOM =
  "grid-cols-[minmax(0,1fr)] items-start pt-dialog-command-top room-narrow:p-ui-12 room-narrow:pt-[max(var(--ui-space-12),env(safe-area-inset-top,0px))]";

/** The card: the palette's measure, unpadded, its field, band, list, and foot edge to edge; in a narrow room, the screen's width inside the window's margin. */
const CARD =
  "w-dialog-command max-h-dialog-command-room gap-0 overflow-clip p-0 focus:outline-none room-narrow:w-full room-narrow:max-h-dialog-command-sheet";

/** cmdk's root: a column that gives way to the card's height, so the list scrolls inside it. */
const ROOT = "flex min-h-0 flex-1 flex-col outline-none";

/** The search row: a magnifier, then the field, over a hairline. */
const SEARCH =
  "flex h-touch flex-none items-center gap-icon-gap border-b border-border px-ui-16 text-muted-foreground [&_svg]:size-menu-glyph [&_svg]:flex-none";

/** The field: borderless and ringless, since it always holds the caret, at the body's size. */
const FIELD =
  "h-full min-w-0 flex-1 border-0 bg-transparent p-0 font-sans text-body text-foreground outline-none placeholder:text-muted-foreground";

/** A band under the field the caller fills, such as a row of filters. */
const BAND = "min-w-0 flex-none border-b border-border px-ui-12 py-ui-8";

/** The foot the caller fills, such as the keys' hints, in a caption's words; not drawn under a finger, which has no keys to press. */
const FOOT =
  "flex min-w-0 flex-none items-center gap-ui-16 border-t border-border px-ui-16 py-ui-8 text-caption text-muted-foreground [@media(hover:none)_and_(pointer:coarse)]:hidden";

/** A page's room: the whole screen, below a phone's notch and status bar, on the page's own ground rather than a scrim. */
const PAGE_ROOM =
  "grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)] place-items-stretch bg-ground p-0 pt-[env(safe-area-inset-top,0px)] animate-none";

/** A page's card: the room's whole width and height, flat on the ground, with no corner or shadow of a card. */
const PAGE_CARD =
  "h-full w-full max-h-none gap-0 overflow-clip rounded-none border-0 bg-ground p-0 shadow-none animate-none focus:outline-none";

/** A page's search row: the field in a well under the head, as a phone's search field stands, drawn as a list's search well is (`search-field.tsx`). */
const PAGE_SEARCH =
  "mx-ui-12 mb-ui-8 box-border flex h-control flex-none items-center gap-icon-gap rounded-control border border-border bg-muted pr-ui-2 pl-search-lead text-muted-foreground [&_svg]:size-control-icon [&_svg]:flex-none";

/** A page's band: under the field, its rows' inset, with no rule, since the field's well already sets it apart. */
const PAGE_BAND = "min-w-0 flex-none px-ui-12 pb-ui-8";

/** A page's foot: drawn under a finger too, as it is the screen's way between places, edge to edge. */
const PAGE_FOOT = "min-w-0 flex-none";

/** A heading that ends in a press: the words, then the press at the row's end. */
const HEADING_WITH_ACT = "flex items-center justify-between gap-ui-8 pr-row-inset";

/** A group's note after its rows: a quiet caption at the rows' inset. */
const NOTE = "px-row-inset pt-ui-4 pb-ui-8 text-caption text-muted-foreground";

/** Where a group's heading stands, as a list's group heading does. */
const HEADING = cn("block", COMBOBOX_HEADING);

/**
 * The `groups` narrowed to the rows whose words match `typed`, best first
 * within each group, by the tiered scorer over each row's words and
 * keywords; every row where nothing is typed.
 * Note that the groups keep the caller's order, each its note.
 */
function matching(groups: readonly CommandGroup[], typed: string): readonly CommandGroup[] {
  if (typed === "") return groups;

  return groups.map((group) => ({
    ...group,
    items: group.items
      .map((item) => ({
        item,
        score: searchHit({ label: item.words, keywords: item.keywords }, typed)?.score ?? 0,
      }))
      .filter((scored) => scored.score > 0)
      .sort((first, second) => second.score - first.score)
      .map((scored) => scored.item),
  }));
}

/**
 * One row, handed through cmdk's item, hanging its card beside it where it
 * has one. Note that it is drawn again only when it is handed another item,
 * because the dialog draws again for each key typed and each row the arrows
 * or the pointer light, and cmdk lights a row from its own store.
 */
const CommandRow = memo(function CommandRow({
  item,
  unmasked,
}: {
  item: CommandItem;
  /** Whether the palette unmasks its own words in a screen recording. */
  unmasked: boolean;
}): React.JSX.Element {
  const marked = (words: ReactNode) =>
    words === undefined ? undefined : (
      <ReplayWords unmasked={unmasked} masked={item.replayMasked}>
        {words}
      </ReplayWords>
    );

  const option =
    unmasked || item.replayMasked === true
      ? {
          ...item,
          label: marked(item.label),
          detail: marked(item.detail),
          detailWords: Predicate.isString(item.detail) ? item.detail : undefined,
          hint: marked(item.hint),
        }
      : item;

  const row = (
    <Command.Item
      asChild
      value={item.id}
      {...(item.keywords === undefined ? {} : { keywords: [...item.keywords] })}
      disabled={item.disabled === true}
      onSelect={item.onSelect}
      // Note that a press on a row leaves the focus in the field, as a combobox's option does, so a phone's keyboard stays up and the one tap chooses the row.
      onMouseDown={(event) => event.preventDefault()}
    >
      <ComboboxOptionItem option={option} />
    </Command.Item>
  );

  if (item.card === undefined) return row;

  return (
    <Tooltip label={item.words} card={item.card} cardBeside>
      {row}
    </Tooltip>
  );
});

/** A group's heading, ending in its press where it has one. */
function GroupHeading({
  label,
  act,
  replayUnmasked,
}: {
  label: string;
  act: CommandGroupAct | undefined;
  replayUnmasked: boolean;
}): React.JSX.Element {
  const words = (
    <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.GROUP} className={HEADING}>
      <ReplayWords unmasked={replayUnmasked}>{label}</ReplayWords>
    </Text>
  );

  if (act === undefined) return words;

  return (
    <span className={HEADING_WITH_ACT}>
      {words}
      <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.GROUP}>
        <ReplayWords unmasked={replayUnmasked}>
          <TextButton
            tone={TEXT_BUTTON_TONE.ACCENT}
            lines={TEXT_BUTTON_LINES.WHOLE}
            aria-label={act.heard}
            keepFocus
            onClick={act.onPress}
          >
            {act.label}
          </TextButton>
        </ReplayWords>
      </Text>
    </span>
  );
}

/**
 * Brings a phone's keyboard up for the field a press is about to open the
 * palette on. iOS raises its keyboard only for a focus taken within a
 * press, and the palette's field takes focus a render after it opens, so
 * the press focuses a stand-in field at once and the keyboard stays up as
 * the palette's field takes the focus from it. The stand-in goes as it
 * loses the focus. Its text is 16px, the least iOS does not zoom to.
 */
export function raiseKeyboard(): void {
  const standIn = document.createElement("input");
  standIn.className = "ui-visually-hidden";
  standIn.style.fontSize = "16px";
  standIn.setAttribute("aria-hidden", "true");
  standIn.tabIndex = -1;
  standIn.addEventListener("blur", () => standIn.remove(), { once: true });
  document.body.append(standIn);
  standIn.focus({ preventScroll: true });
}

/** What a command dialog is told: whether it stands, what it lists, and what it says around the list. */
export interface CommandDialogProps {
  open: boolean;
  /** Escape, a press on the dimmed window, or the owner's own close: the owner sets `open`. */
  onOpenChange: (open: boolean) => void;
  /** The card's accessible name, what it is for: "Command palette". */
  label: string;
  /** The field's placeholder, what typing finds. */
  placeholder: string;
  groups: readonly CommandGroup[];
  /** Whether the dialog narrows the rows to the words typed; the caller's own ranking turns it off. */
  filter?: CommandFilter | undefined;
  /** The words typed, where the owner holds them; the dialog holds its own where none are given, cleared each time it opens. */
  query?: string | undefined;
  onQueryChange?: ((query: string) => void) | undefined;
  /** The row lit, by its id, where the owner holds it. */
  selected?: string | undefined;
  onSelectedChange?: ((id: string) => void) | undefined;
  /** What the list says where no row stands. */
  empty?: string | undefined;
  /** What the list says while its rows are still read, in place of `empty`: "Reading tasks". */
  loading?: string | undefined;
  /** Drawn under the field, such as a row of filters. */
  band?: ReactNode;
  /** Drawn along the card's foot, such as the keys' hints. */
  foot?: ReactNode;
  /** Whether it stands as a card over the dimmed window or as a page filling the screen; a card where none is said. */
  presentation?: CommandPresentation | undefined;
  /** Drawn over the field on a page, such as its title; a card draws none. */
  head?: ReactNode;
  /** The field, for an owner that moves the caret or focus back to it. */
  inputRef?: Ref<HTMLInputElement> | undefined;
  /** The owner's own keys, heard before cmdk's, which a key the owner prevents never reaches. */
  onKeyDown?: ((event: React.KeyboardEvent<HTMLDivElement>) => void) | undefined;
  /**
   * Whether its own words are the app's, which a screen recording shows as
   * they read: its groups' headings, what its list says while empty or
   * reading, and its rows' words, but for a row that is `replayMasked`; its
   * band, foot, and groups' notes are its owner's to mark
   * (`@repo/ui/session-replay-marks`).
   */
  replayUnmasked?: boolean | undefined;
  /**
   * Whether the card stays drawn, hidden, while the dialog is shut, so opening it again only
   * shows it: for an owner whose props stand still while it is shut, since the hidden card
   * draws again whenever one changes.
   */
  keepMounted?: boolean | undefined;
}

/**
 * The palette: the dimmed window, the card high in it, the field taking
 * focus as it opens, an optional band, the `groups` of rows, and an
 * optional foot. Note that the dialog stays mounted while closed, so it
 * can fade out; Base UI draws its card only while it stands or leaves,
 * unless `keepMounted` holds it drawn and hidden in between.
 */
export function CommandDialog({
  open,
  onOpenChange,
  label,
  placeholder,
  groups,
  filter = COMMAND_FILTER.WORDS,
  query,
  onQueryChange,
  selected,
  onSelectedChange,
  empty = noMatchWords(TERM.RESULT),
  loading,
  band,
  foot,
  presentation = COMMAND_PRESENTATION.DIALOG,
  head,
  inputRef,
  onKeyDown,
  keepMounted = false,
  replayUnmasked = false,
}: CommandDialogProps): React.JSX.Element {
  const page = presentation === COMMAND_PRESENTATION.PAGE;
  const field = useRef<HTMLInputElement | null>(null);
  // Note that the card stands a render after the dialog opens, because Base UI's portal makes its node first, so the field takes focus once it does.
  const [drawn, setDrawn] = useState(false);
  useHeldFocus(field, open && drawn);
  // What held focus as the palette opened, which takes it back as the palette closes, if it still stands.
  const invoker = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (open) {
      invoker.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;

      return;
    }

    if (invoker.current?.isConnected) invoker.current.focus({ preventScroll: true });
    invoker.current = null;
  }, [open]);
  const [ownQuery, setOwnQuery] = useState("");
  // Note that the words the dialog holds itself are cleared each time it opens, so a palette opens on every row.
  const [wasOpen, setWasOpen] = useState(open);

  if (open !== wasOpen) {
    setWasOpen(open);

    if (open) setOwnQuery("");
  }

  const words = query ?? ownQuery;

  const changeQuery = (next: string) => {
    setOwnQuery(next);
    onQueryChange?.(next);
  };

  const shown = filter === COMMAND_FILTER.WORDS ? matching(groups, words.trim()) : groups;
  // Note that a group's note stands whatever is typed, so a source that failed or is still reading is never taken for no match.
  const standing = shown.filter((group) => group.items.length > 0 || group.note !== undefined);
  const rows = groups.reduce((count, group) => count + group.items.length, 0);

  return (
    <ShadcnDialog
      open={open}
      modal="trap-focus"
      onOpenChange={(next) => {
        if (next !== open) onOpenChange(next);
      }}
    >
      <DialogContent
        ref={(node: HTMLDivElement | null) => setDrawn(node !== null)}
        keepMounted={keepMounted}
        className={page ? PAGE_CARD : CARD}
        aria-label={label}
        initialFocus={field}
        // Note that focus goes back to what opened the palette as it starts to close, not once its fade ends.
        finalFocus={false}
        // Note that no key pressed in the card goes on to the window, as no dialog's does, and ⌘W closes it as a dialog's does.
        onKeyDown={(event) => {
          event.stopPropagation();

          if (!closesCard(event)) return;
          event.preventDefault();
          onOpenChange(false);
        }}
        viewport={{
          className: page ? PAGE_ROOM : ROOM,
          // Note that a press goes no further than the dialog, because the surface that opened it is its parent in React's tree and may take presses of its own.
          onClick: (event) => event.stopPropagation(),
        }}
      >
        <Command
          label={label}
          className={ROOT}
          // Note that the rows are matched here rather than by cmdk, which would hide a group's note with its rows and move rows past it in the page.
          shouldFilter={false}
          {...(selected === undefined ? {} : { value: selected })}
          {...(onSelectedChange === undefined ? {} : { onValueChange: onSelectedChange })}
          loop
          onKeyDown={(event) => {
            // A key an input method is composing with is the method's, not the list's.
            if (event.nativeEvent.isComposing) return;
            onKeyDown?.(event);
          }}
        >
          {page && head !== undefined ? <div className="flex-none">{head}</div> : null}
          <div className={page ? PAGE_SEARCH : SEARCH}>
            <SearchIcon />
            <Command.Input
              ref={(node) => {
                field.current = node;

                if (Predicate.isFunction(inputRef)) inputRef(node);
                else if (inputRef !== undefined && inputRef !== null) inputRef.current = node;
              }}
              className={FIELD}
              placeholder={placeholder}
              autoCorrect="off"
              autoCapitalize="off"
              enterKeyHint="search"
              spellCheck={false}
              value={words}
              onValueChange={changeQuery}
            />
          </div>
          {band === undefined ? null : <div className={page ? PAGE_BAND : BAND}>{band}</div>}
          <Command.List asChild label={label}>
            <ComboboxListBox height={COMBOBOX_LIST_HEIGHT.FILL}>
              {loading !== undefined && rows === 0 ? (
                <NoteLine status>
                  <ReplayWords unmasked={replayUnmasked}>{loading}</ReplayWords>
                </NoteLine>
              ) : standing.length === 0 ? (
                <NoteLine>
                  <ReplayWords unmasked={replayUnmasked}>{empty}</ReplayWords>
                </NoteLine>
              ) : null}
              {standing.map((group) => (
                <Command.Group
                  key={group.id}
                  heading={
                    group.label === undefined ? undefined : (
                      <GroupHeading
                        label={group.label}
                        act={group.act}
                        replayUnmasked={replayUnmasked}
                      />
                    )
                  }
                >
                  {group.items.map((item) => (
                    <CommandRow key={item.id} item={item} unmasked={replayUnmasked} />
                  ))}
                  {group.note === undefined ? null : <div className={NOTE}>{group.note}</div>}
                </Command.Group>
              ))}
            </ComboboxListBox>
          </Command.List>
          {foot === undefined ? null : <div className={page ? PAGE_FOOT : FOOT}>{foot}</div>}
        </Command>
      </DialogContent>
    </ShadcnDialog>
  );
}
