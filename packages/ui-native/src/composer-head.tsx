// composer-head.tsx -- what stands over a composer's field: the pictures attached to the message as thumbnails and its pasted text files as chips by name and lines, each taken off by its ×, the skills a `/` offers and what an `@` offers as the system's list, the line saying the field holds a sent message's words to send in its place.

import {
  Button,
  HStack,
  Image,
  List,
  ScrollView,
  Section,
  Spacer,
  Text,
  useNativeState,
  VStack,
  ZStack,
} from "@expo/ui/swift-ui";
import * as SwiftModifiers from "@expo/ui/swift-ui/modifiers";
import {
  accessibilityHidden,
  accessibilityHint,
  accessibilityLabel,
  buttonStyle,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  tint,
  useScrollGeometryChange,
} from "@expo/ui/swift-ui/modifiers";
import { type ReactNode, useEffect, useState } from "react";
import { useAccessibilitySize, useScaledSize, useTextScale } from "./accessibility.js";
import { CHIP_MARK, type ChipMark } from "./chip-mark-model.js";
import { useOfferRoom } from "./glass-bar.js";
import { GLYPH, type Glyph, glyphImage } from "./glyph.js";
import { Avatar, AvatarPhoto, HarnessMark, MANAGER_FACE_SEAT, ManagerFace } from "./marks.js";
import { GoesMark, PUSH_ROW_GOES } from "./settings-form.js";
import { useSuggestionKeys } from "./suggestion-keys.js";
import { toneColor, useColors } from "./tokens/colors.js";
import { MARK_SIZE, PRESS_SIZE, SPACE } from "./tokens/space.js";
import { TYPE_ROLE } from "./tokens/type.js";

/** A picture's thumbnail over a composer's field, as Messages draws one: a square cropped from it, its corners rounded as a card's; a pasted text file stands as a tile of the same size. */
const THUMBNAIL = { SIZE: 56, CORNER: 10 } as const;

/** How large the × in a thumbnail's corner stands, the system's mini control, its mark small inside it. */
const DETACH_MARK = 9;

/** How far the × stands in from the thumbnail's corner. */
const DETACH_INSET = SPACE.TIGHT;

/** What a file's × is heard as, by the name it goes under ("Remove Picture 1", "Remove Pasted text 1.txt"). */
function detachWords(name: string): string {
  return `Remove ${name}`;
}

/** One file attached to the message, by the name the message carries it under ("Picture 1", "Pasted text 1.txt"): a picture with the address its thumbnail draws from, such as a `data:` address of its bytes, or a long paste taken as a text file, which has none and says what it holds under its name instead ("12 lines"). */
export type AttachedPicture = {
  readonly id: string;
  readonly name: string;
  readonly address?: string | undefined;
  readonly detail?: string | undefined;
};

/** How wide a file's chip stands at most, its name cut short past it, as the panel's chip cuts a long name. */
const FILE_CHIP_WIDTH = 200;

/** Does nothing, for a thumbnail's load and failure, which the composer has no use for: its own bytes are drawn, and the × stands either way. */
function ignore() {}

/** A pasted text file's chip, as tall as a thumbnail, as the panel's chip draws a file: the document glyph, then its name over what it holds ("12 lines"), on the well, room left at its trailing corner for its ×. */
function TextFileChip({
  name,
  detail,
}: {
  readonly name: string;
  readonly detail?: string | undefined;
}) {
  const colors = useColors();

  return (
    <HStack
      spacing={SPACE.TIGHT * 2}
      modifiers={[
        SwiftModifiers.padding({ leading: SPACE.ROW, trailing: SPACE.ROW + DETACH_MARK * 2 }),
        frame({
          minHeight: THUMBNAIL.SIZE,
          maxHeight: THUMBNAIL.SIZE,
          maxWidth: FILE_CHIP_WIDTH,
          alignment: "leading",
        }),
        SwiftModifiers.background(
          colors.WELL,
          SwiftModifiers.shapes.roundedRectangle({ cornerRadius: THUMBNAIL.CORNER }),
        ),
      ]}
    >
      <Image {...glyphImage(GLYPH.FILE_TEXT)} size={MARK_SIZE.LEAD} color={colors.TEXT_MUTED} />
      <VStack alignment="leading" spacing={0}>
        <Text
          modifiers={[
            font({ textStyle: TYPE_ROLE.ROW_LINE }),
            foregroundStyle(colors.TEXT),
            lineLimit(1),
          ]}
        >
          {name}
        </Text>
        {detail === undefined ? null : (
          <Text
            modifiers={[
              font({ textStyle: TYPE_ROLE.TIME }),
              foregroundStyle(colors.TEXT_MUTED),
              lineLimit(1),
            ]}
          >
            {detail}
          </Text>
        )}
      </VStack>
    </HStack>
  );
}

/**
 * The files attached to the message as a row of thumbnails, a pasted text
 * file as a chip as tall, by its name and how many lines it runs to, as the
 * panel's chip says a file, scrolling sideways where they outrun the
 * bar, as Messages and the panel show what a message carries before it
 * goes. Note that only the × in a thumbnail's corner takes the file off, so
 * a press meant to look at a picture never removes it; VoiceOver hears each
 * as its × alone, "Remove Picture 1", since the thumbnail says nothing a
 * reader could act on.
 */
export function AttachedPictures({
  pictures,
  onDetach,
}: {
  readonly pictures: readonly AttachedPicture[];
  readonly onDetach: (id: string) => void;
}) {
  const colors = useColors();

  if (pictures.length === 0) return null;

  return (
    <ScrollView axes="horizontal" showsIndicators={false}>
      <HStack spacing={SPACE.TIGHT * 2}>
        {pictures.map((picture) => (
          <ZStack
            key={picture.id}
            alignment="topTrailing"
            modifiers={
              picture.address === undefined
                ? []
                : [frame({ width: THUMBNAIL.SIZE, height: THUMBNAIL.SIZE })]
            }
          >
            {picture.address === undefined ? (
              <TextFileChip name={picture.name} detail={picture.detail} />
            ) : (
              <AvatarPhoto
                address={picture.address}
                size={THUMBNAIL.SIZE}
                corner={THUMBNAIL.CORNER}
                onFail={ignore}
              />
            )}
            <Button
              onPress={() => onDetach(picture.id)}
              modifiers={[
                buttonStyle("borderedProminent"),
                SwiftModifiers.buttonBorderShape("circle"),
                SwiftModifiers.controlSize("mini"),
                tint(colors.TEXT),
                foregroundStyle(colors.GROUND),
                SwiftModifiers.padding({ top: DETACH_INSET, trailing: DETACH_INSET }),
                accessibilityLabel(detachWords(picture.name)),
              ]}
            >
              <Image {...glyphImage(GLYPH.REMOVE)} size={DETACH_MARK} />
            </Button>
          </ZStack>
        ))}
      </HStack>
    </ScrollView>
  );
}

/** One skill a `/` offers: its word, and what it is for. */
export type SkillSuggestion = {
  readonly name: string;
  readonly word: string;
  readonly detail: string;
};

/** How tall a row of one line stands in the system's list at the default text size, a little over its 44 pt so the first guess errs tall, which the list's height is first reckoned from. */
const ROW_ONE_LINE = PRESS_SIZE + 4;

/** How tall a row of two lines, a name over a muted line, stands in the system's list at the default text size, erring tall. */
const ROW_TWO_LINES = 66;

/** How tall a section's header stands in the system's plain list at the default text size, erring tall. */
const SECTION_HEADER = 40;

/** What the list's height holds past its rows as the system measures them, so its last row's foot is never cut by a rounding. */
const LIST_SLACK = SPACE.TIGHT * 2;

/**
 * What a suggestion's row leads with, in a square the size of a row's
 * glyph, so the names line up whatever leads them: the mark of the entity
 * it names, as the chip a pick writes leads with it (`ChipMark`), a
 * person's photo or letters, a task's status ring in its tone, an agent's
 * harness or a Manager's face, a pull request's state, a thread's ask; else its kind's glyph in
 * the muted ink. It is never heard, since the name beside it is.
 */
function SuggestionMark({
  glyph,
  mark,
}: {
  readonly glyph: Glyph;
  readonly mark: ChipMark | undefined;
}) {
  const colors = useColors();
  const size = useScaledSize(MARK_SIZE.GLYPH);
  const square = frame({ width: size, height: size });

  switch (mark?.kind) {
    case CHIP_MARK.FACE:
      return (
        <ZStack modifiers={[square, accessibilityHidden()]}>
          <Avatar name={mark.name} picture={mark.picture} size={size} />
        </ZStack>
      );
    case CHIP_MARK.HARNESS:
      return <HarnessMark provider={mark.harness} size={size} />;
    case CHIP_MARK.MANAGER:
      return (
        <ManagerFace
          face={mark.face}
          size={size}
          working={mark.working}
          seat={MANAGER_FACE_SEAT.WORDS}
        />
      );
    case CHIP_MARK.GLYPH:
      return (
        <Image
          {...glyphImage(mark.glyph)}
          size={size}
          color={toneColor(colors, mark.tone)}
          modifiers={[square, accessibilityHidden()]}
        />
      );
    default:
      return (
        <Image
          {...glyphImage(glyph)}
          size={size}
          color={colors.TEXT_MUTED}
          modifiers={[square, accessibilityHidden()]}
        />
      );
  }
}

/**
 * One row the list a composer offers holds, as a `/` offers a skill and an
 * `@` a mention: the system's button in the system's list, which flashes
 * the row's gray while held, its mark centered in the column a row's lead
 * mark stands in, its title in the body style over a muted line in the
 * subheadline style; a kind's row ends in the chevron a row that goes on
 * ends in, as Settings' rows do. A row a hardware keyboard's arrows have
 * chosen stands on the selected row's fill, as a list's selected row does.
 * Note that at an accessibility size its words wrap rather than cut.
 */
function SuggestionRow({
  glyph,
  mark,
  title,
  detail,
  opens = false,
  place,
  chosen = false,
  onPress,
}: {
  readonly glyph: Glyph;
  readonly mark?: ChipMark | undefined;
  readonly title: string;
  readonly detail?: string | undefined;
  /** Whether a press opens a narrower list rather than writing the row, which its trailing chevron says, as a row that goes on does in iOS's lists. */
  readonly opens?: boolean | undefined;
  /** Where the row stands in its list, which a hardware keyboard's arrows scroll to (`useSuggestionKeys`). */
  readonly place: number;
  /** Whether a hardware keyboard's arrows have chosen the row, which Return picks. */
  readonly chosen?: boolean | undefined;
  readonly onPress: () => void;
}) {
  const large = useAccessibilitySize();
  const lines = large ? [] : [lineLimit(1)];
  const colors = useColors();
  const column = useScaledSize(MARK_SIZE.LEAD);

  return (
    <Button
      onPress={onPress}
      modifiers={[
        accessibilityLabel(title),
        SwiftModifiers.listRowBackground(chosen ? colors.SELECTED : "transparent"),
        SwiftModifiers.id(String(place)),
      ]}
    >
      <HStack spacing={SPACE.ROW}>
        <ZStack modifiers={[frame({ width: column })]}>
          <SuggestionMark glyph={glyph} mark={mark} />
        </ZStack>
        <VStack alignment="leading" spacing={1}>
          <Text
            modifiers={[
              font({ textStyle: TYPE_ROLE.ROW_TITLE }),
              foregroundStyle(colors.TEXT),
              ...lines,
            ]}
          >
            {title}
          </Text>
          {detail === undefined || detail === "" ? null : (
            <Text
              modifiers={[
                font({ textStyle: TYPE_ROLE.ROW_LINE }),
                foregroundStyle(colors.TEXT_MUTED),
                ...lines,
              ]}
            >
              {detail}
            </Text>
          )}
        </VStack>
        {opens ? (
          <>
            <Spacer />
            <GoesMark goes={PUSH_ROW_GOES.PAGE} />
          </>
        ) : null}
      </HStack>
    </Button>
  );
}

/** A row of the list saying it holds nothing, such as no result matching, in the muted ink, taking no press. */
function NoneRow({ words }: { readonly words: string }) {
  const colors = useColors();

  return (
    <Text
      modifiers={[
        font({ textStyle: TYPE_ROLE.ROW_LINE }),
        foregroundStyle(colors.TEXT_MUTED),
        SwiftModifiers.listRowBackground("transparent"),
      ]}
    >
      {words}
    </Text>
  );
}

/** What a narrowed `@` list's way back is heard as, the panel's words for every kind. */
const WIDEN_WORDS = "All kinds";

/**
 * The way back out of a narrowed `@` list, as the system's back reads: its
 * chevron and the kind's glyph and name, one row of the list a press on
 * which widens it to every kind again, heard as "All kinds".
 */
function MentionCrumbRow({ crumb }: { readonly crumb: MentionCrumb }) {
  const colors = useColors();
  const size = useScaledSize(MARK_SIZE.GLYPH);

  return (
    <Button
      onPress={crumb.onBack}
      modifiers={[
        accessibilityLabel(WIDEN_WORDS),
        accessibilityHint(crumb.name),
        SwiftModifiers.listRowBackground("transparent"),
      ]}
    >
      <HStack spacing={SPACE.TIGHT}>
        <Image {...glyphImage(GLYPH.BACK)} size={size} color={colors.TEXT_MUTED} />
        <Image {...glyphImage(crumb.glyph)} size={size} color={colors.TEXT_MUTED} />
        <Text
          modifiers={[
            font({ textStyle: TYPE_ROLE.ROW_TITLE, weight: "semibold" }),
            foregroundStyle(colors.TEXT),
          ]}
        >
          {crumb.name}
        </Text>
      </HStack>
    </Button>
  );
}

/** A narrowed `@` list's crumb: the kind's name and glyph, and the press back to every kind. */
export type MentionCrumb = {
  readonly name: string;
  readonly glyph: Glyph;
  readonly onBack: () => void;
};

/** One thing an `@` offers: its id, its kind's glyph, the mark of the entity it names where the app holds one, the name it goes under, and what its row says after the name. */
export type MentionSuggestion = {
  readonly id: string;
  readonly glyph: Glyph;
  readonly mark?: ChipMark | undefined;
  readonly name: string;
  readonly detail?: string | undefined;
  /** Whether it is a kind, whose press narrows the list to it rather than writing a mention. */
  readonly opens?: boolean | undefined;
};

/** A group of what an `@` offers, under the panel's heading, each row led by its kind's glyph, since Suggested holds several kinds. */
export type MentionSuggestionGroup = {
  readonly title: string;
  readonly rows: readonly MentionSuggestion[];
};

/** The rows a list holds, by how many lines each draws, and its sections' headers, which its height is reckoned from. */
interface ListRows {
  readonly oneLine: number;
  readonly twoLines: number;
  readonly headers: number;
}

/**
 * The one list a composer offers over its field, whatever it offers (a
 * `/`'s skills, an `@`'s mentions): the system's plain list, its rows in
 * its own metrics, separators and pressed gray, its groups under the
 * system's section headers, on the popover's own glass with no ground of
 * ours; or what stands where there are no rows, in the muted ink. Note that
 * the system's list takes all the room it is offered and has no height of
 * its own to hug, so it is handed the height of its rows as the list itself
 * measures them (its scroll geometry's content height), first guessed from
 * its rows at the reader's text size until it has measured, up to the room
 * over the keyboard (`useOfferRoom`), past which it scrolls; the row a
 * hardware keyboard's arrows choose is scrolled to.
 */
function SuggestionList({
  counted,
  empty,
  chosen,
  children,
}: {
  readonly counted: ListRows;
  /** What stands in the rows' place, such as no result matching; the rows stand where none is given. */
  readonly empty: string | undefined;
  /** The place of the row a hardware keyboard's arrows have chosen, which the list scrolls to; none while none is. */
  readonly chosen?: number | undefined;
  readonly children: ReactNode;
}) {
  const colors = useColors();
  const room = useOfferRoom();
  const scale = Math.min(Math.max(useTextScale(), 1), 2);
  const scrolled = useNativeState<string | null>(null);
  const [measured, setMeasured] = useState<number | undefined>(undefined);

  // Note that the height is taken again only as the rows' own height moves, never as they scroll.
  const geometry = useScrollGeometryChange(({ contentHeight }) => {
    const tall = Math.ceil(contentHeight) + LIST_SLACK;
    setMeasured((was) => (was === tall ? was : tall));
  });

  useEffect(() => {
    if (chosen !== undefined) scrolled.value = String(chosen);
  }, [chosen, scrolled]);

  if (empty !== undefined) {
    return (
      <Text
        modifiers={[
          font({ textStyle: TYPE_ROLE.ROW_LINE }),
          foregroundStyle(colors.TEXT_MUTED),
          frame({ minHeight: ROW_ONE_LINE, alignment: "leading" }),
          SwiftModifiers.padding({ horizontal: SPACE.EDGE }),
        ]}
      >
        {empty}
      </Text>
    );
  }

  const guessed =
    (counted.oneLine * ROW_ONE_LINE +
      counted.twoLines * ROW_TWO_LINES +
      counted.headers * SECTION_HEADER) *
    scale;

  const tall = measured ?? guessed;

  return (
    <List
      modifiers={[
        SwiftModifiers.listStyle("plain"),
        SwiftModifiers.scrollContentBackground("hidden"),
        SwiftModifiers.scrollDismissesKeyboard("never"),
        SwiftModifiers.scrollPosition(scrolled, { anchor: "center" }),
        ...(geometry === null ? [] : [geometry]),
        frame({ height: Math.min(Math.round(tall), room) }),
      ]}
    >
      {children}
    </List>
  );
}

/**
 * What an `@` being typed offers, as the panel's mention picker groups it:
 * each group a section of the system's list under its header, its rows led
 * by the mark of the entity each names, as the chip a pick writes leads
 * with it (a person's face, a task's status, an agent's harness, a pull
 * request's state, a thread's ask), else their kind's glyph, a person's
 * "You" or address and a task's key under the name, a kind's row ending in
 * the chevron, and the row picked written into the message; a narrowed
 * list stands under its way back; what stands where nothing matches said in
 * the muted ink. It stands in the system's popover over the composer
 * (`OfferPopover`).
 */
export function MentionSuggestions({
  groups,
  empty,
  crumb,
  onPick,
}: {
  readonly groups: readonly MentionSuggestionGroup[];
  /** What stands where nothing is offered, such as no result matching. */
  readonly empty: string | undefined;
  /** The kind the list is narrowed to, which it stands under; none for every kind. */
  readonly crumb?: MentionCrumb | undefined;
  readonly onPick: (group: string, id: string) => void;
}) {
  // Each row by its place in the whole list, which the arrows step through across its groups.
  const starts = groups.map((_, at) =>
    groups.slice(0, at).reduce((sum, group) => sum + group.rows.length, 0),
  );

  const rows = groups.flatMap((group) => group.rows.map((row) => ({ group: group.title, row })));

  const chosen = useSuggestionKeys(rows.length, (place) => {
    const picked = rows[place];

    if (picked !== undefined) onPick(picked.group, picked.row.id);
  });

  if (groups.length === 0 && empty === undefined && crumb === undefined) return null;

  const twoLines = rows.filter(({ row }) => row.detail !== undefined && row.detail !== "").length;

  // Note that a narrowed list finding nothing says so under its way back, as the list finding nothing says it in its place.
  const none = groups.length === 0 && crumb !== undefined ? empty : undefined;

  const counted = {
    oneLine: rows.length - twoLines + (crumb === undefined ? 0 : 1) + (none === undefined ? 0 : 1),
    twoLines,
    // Note that a narrowed list's crumb already names its one group, so its group stands with no header.
    headers: crumb === undefined ? groups.length : 0,
  };

  const back = crumb === undefined ? null : <MentionCrumbRow crumb={crumb} />;

  return (
    <SuggestionList
      counted={counted}
      empty={groups.length === 0 && crumb === undefined ? empty : undefined}
      chosen={chosen}
    >
      {back === null ? null : (
        <Section>
          {back}
          {none === undefined ? null : <NoneRow words={none} />}
        </Section>
      )}
      {groups.map((group, at) => (
        <Section key={group.title} {...(crumb === undefined && { title: group.title })}>
          {group.rows.map((row, index) => (
            <SuggestionRow
              key={row.id}
              glyph={row.glyph}
              mark={row.mark}
              title={row.name}
              detail={row.detail}
              opens={row.opens}
              place={(starts[at] ?? 0) + index}
              chosen={chosen === (starts[at] ?? 0) + index}
              onPress={() => onPick(group.title, row.id)}
            />
          ))}
        </Section>
      ))}
    </SuggestionList>
  );
}

/**
 * The skills a `/` being typed offers, in the same list what an `@` offers
 * stands in (`SuggestionList`), in the system's popover over the composer:
 * each its `/name` and a muted line of what it is for, written into the
 * message on a press; what stands in their place where there are none,
 * such as why they could not be read, said in the muted ink.
 */
export function SkillSuggestions({
  skills,
  empty,
  onPick,
}: {
  readonly skills: readonly SkillSuggestion[];
  /** What stands where no skill is offered: still reading, none matching, or why none were read. */
  readonly empty: string | undefined;
  readonly onPick: (name: string) => void;
}) {
  const chosen = useSuggestionKeys(skills.length, (place) => {
    const picked = skills[place];

    if (picked !== undefined) onPick(picked.name);
  });

  if (skills.length === 0 && empty === undefined) return null;

  return (
    <SuggestionList
      counted={{ oneLine: 0, twoLines: skills.length, headers: 0 }}
      empty={skills.length === 0 ? empty : undefined}
      chosen={chosen}
    >
      {skills.map((skill, place) => (
        <SuggestionRow
          key={skill.name}
          glyph={GLYPH.SKILL}
          title={skill.word}
          detail={skill.detail}
          place={place}
          chosen={chosen === place}
          onPress={() => onPick(skill.name)}
        />
      ))}
    </SuggestionList>
  );
}

/** What the line over a field holding a sent message's words says, and its Cancel. */
const EDITING_WORDS = { LINE: "Editing message", CANCEL: "Cancel" } as const;

/**
 * The line over the field while it holds one of the member's sent
 * messages' words, written again to go in that message's place, as the
 * panel's Edit opens the line where it stands: the message's Edit glyph
 * and "Editing message" in the muted ink, and Cancel at its end, which
 * gives the field back what it held.
 */
export function EditingLine({ onCancel }: { readonly onCancel: () => void }) {
  const colors = useColors();
  const glyph = useScaledSize(MARK_SIZE.GLYPH);

  return (
    <HStack spacing={SPACE.TIGHT * 2}>
      <Image {...glyphImage(GLYPH.EDIT_MESSAGE)} size={glyph} color={colors.TEXT_MUTED} />
      <Text
        modifiers={[
          font({ textStyle: TYPE_ROLE.ROW_LINE }),
          foregroundStyle(colors.TEXT_MUTED),
          frame({ maxWidth: Number.POSITIVE_INFINITY, alignment: "leading" }),
        ]}
      >
        {EDITING_WORDS.LINE}
      </Text>
      <Button onPress={onCancel} modifiers={[buttonStyle("plain")]}>
        {/* Note that the press's frame and its shape stand on the label, since a plain button takes a press only where its label is hit. */}
        <Text
          modifiers={[
            font({ textStyle: TYPE_ROLE.ROW_LINE, weight: "medium" }),
            foregroundStyle(colors.TEXT_BODY),
            frame({ minHeight: PRESS_SIZE }),
            SwiftModifiers.contentShape(SwiftModifiers.shapes.rectangle()),
          ]}
        >
          {EDITING_WORDS.CANCEL}
        </Text>
      </Button>
    </HStack>
  );
}
