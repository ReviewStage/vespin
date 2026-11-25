// composer-head.tsx -- what stands over a composer's field inside its glass: the pictures attached to the message as thumbnails and its pasted text files as chips by name and lines, each taken off by its ×, the skills a `/` offers, the line saying the field holds a sent message's words to send in its place, and a note of what a send does, such as denying a call waiting.

import { Button, HStack, Image, ScrollView, Spacer, Text, VStack, ZStack } from "@expo/ui/swift-ui";
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
} from "@expo/ui/swift-ui/modifiers";
import { useAccessibilitySize, useScaledSize } from "./accessibility.js";
import { CHIP_MARK, type ChipMark } from "./chip-mark-model.js";
import { GLYPH, type Glyph, glyphImage } from "./glyph.js";
import { Avatar, AvatarPhoto, HarnessMark, MANAGER_FACE_SEAT, ManagerFace } from "./marks.js";
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

/** The most suggestions the head stands at once before it scrolls them, so the field stays in sight over the keyboard. */
const SUGGESTIONS_SHOWN = 4;

/** How tall one suggestion stands, in points: a press's least, as Apple's guidelines ask. */
const SUGGESTION_HEIGHT = PRESS_SIZE + 6;

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
 * One row a composer's head offers over the field, as a `/` offers a skill
 * and an `@` a mention: its glyph, its words, and a muted line after them,
 * the row's whole width taking the press. Note that at an accessibility
 * size its words wrap rather than cut.
 */
function SuggestionRow({
  glyph,
  mark,
  title,
  detail,
  opens = false,
  onPress,
}: {
  readonly glyph: Glyph;
  readonly mark?: ChipMark | undefined;
  readonly title: string;
  readonly detail?: string | undefined;
  /** Whether a press opens a narrower list rather than writing the row, which its trailing chevron says, as a row that goes on does in iOS's lists. */
  readonly opens?: boolean | undefined;
  readonly onPress: () => void;
}) {
  const large = useAccessibilitySize();
  const lines = large ? [] : [lineLimit(1)];
  const colors = useColors();

  return (
    <Button onPress={onPress} modifiers={[buttonStyle("plain"), accessibilityLabel(title)]}>
      {/* Note that the shape stands on the row's full-width frame, not on the button, so a press past the row's words still picks it. */}
      <HStack
        spacing={SPACE.ROW}
        modifiers={[
          frame({
            minHeight: SUGGESTION_HEIGHT,
            maxWidth: Number.POSITIVE_INFINITY,
            alignment: "leading",
          }),
          SwiftModifiers.contentShape(SwiftModifiers.shapes.rectangle()),
        ]}
      >
        <SuggestionMark glyph={glyph} mark={mark} />
        <VStack alignment="leading" spacing={1}>
          <Text
            modifiers={[
              font({ textStyle: TYPE_ROLE.ROW_TITLE, weight: "medium" }),
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
            <Image
              {...glyphImage(GLYPH.DISCLOSURE)}
              color={colors.TEXT_MUTED}
              modifiers={[font({ textStyle: TYPE_ROLE.TIME }), accessibilityHidden()]}
            />
          </>
        ) : null}
      </HStack>
    </Button>
  );
}

/** What a narrowed `@` list's way back is heard as, the panel's words for every kind. */
const WIDEN_WORDS = "All kinds";

/**
 * The crumb a narrowed `@` list stands under, as the panel's: the back
 * chevron iOS draws, then the kind's glyph and name, the whole of it one
 * press that widens the list to every kind again, heard as "All kinds".
 */
function MentionCrumbRow({ crumb }: { readonly crumb: MentionCrumb }) {
  const colors = useColors();
  const size = useScaledSize(MARK_SIZE.GLYPH);

  return (
    <Button
      onPress={crumb.onBack}
      modifiers={[
        buttonStyle("plain"),
        accessibilityLabel(WIDEN_WORDS),
        accessibilityHint(crumb.name),
      ]}
    >
      <HStack
        spacing={SPACE.TIGHT}
        modifiers={[
          frame({
            minHeight: PRESS_SIZE,
            maxWidth: Number.POSITIVE_INFINITY,
            alignment: "leading",
          }),
          SwiftModifiers.contentShape(SwiftModifiers.shapes.rectangle()),
        ]}
      >
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

/**
 * What an `@` being typed offers, as the panel's mention picker groups it:
 * each group under its small muted heading, its rows led by the mark of
 * the entity each names, as the chip a pick writes leads with it (a
 * person's face, a task's status, an agent's harness, a pull request's
 * state, a thread's ask), else their kind's glyph, a person's "You" or
 * address and a task's key after the name, and
 * the row picked written into the message; what stands where nothing
 * matches said in the muted ink. It stands over the field inside the
 * composer's glass, as Messages and Slack stand theirs right over the
 * keyboard, its rows scrolling with the head they stand in, so the field
 * stays in sight.
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
  const colors = useColors();
  const head = crumb === undefined ? null : <MentionCrumbRow crumb={crumb} />;

  if (groups.length === 0) {
    if (empty === undefined) return head;

    return (
      <VStack alignment="leading" spacing={0}>
        {head}
        <Text
          modifiers={[font({ textStyle: TYPE_ROLE.ROW_LINE }), foregroundStyle(colors.TEXT_MUTED)]}
        >
          {empty}
        </Text>
      </VStack>
    );
  }

  // Note that the rows scroll with the composer's head, its one scroller (`BarHead`), never in a scroller of their own inside it, which cut a row through and scrolled inside a scroll; a narrowed list's crumb stands over them.
  return (
    <VStack alignment="leading" spacing={0}>
      {head}
      <VStack alignment="leading" spacing={SPACE.TIGHT}>
        {groups.map((group) => (
          <VStack key={group.title} alignment="leading" spacing={0}>
            {/* Note that a narrowed list's crumb already names its one group. */}
            {crumb === undefined ? (
              <Text
                modifiers={[
                  font({ textStyle: TYPE_ROLE.GROUP_HEADER }),
                  foregroundStyle(colors.TEXT_MUTED),
                  SwiftModifiers.accessibilityAddTraits(["isHeader"]),
                ]}
              >
                {group.title}
              </Text>
            ) : null}
            {group.rows.map((row) => (
              <SuggestionRow
                key={row.id}
                glyph={row.glyph}
                mark={row.mark}
                title={row.name}
                detail={row.detail}
                opens={row.opens}
                onPress={() => onPick(group.title, row.id)}
              />
            ))}
          </VStack>
        ))}
      </VStack>
    </VStack>
  );
}

/**
 * The skills a `/` being typed offers, as a list over the field inside the
 * composer's glass, right above the keyboard, as Messages offers its
 * suggestions: each its `/name` and a muted line of what it is for, written
 * into the message on a press; what stands in their place where there are
 * none, such as why they could not be read, said in the muted ink. It
 * scrolls past a few, so the field stays in sight.
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
  const colors = useColors();
  // Note that at an accessibility size the list stands whole, since four rows of a fixed height showed about two.
  const large = useAccessibilitySize();

  if (skills.length === 0) {
    if (empty === undefined) return null;

    return (
      <Text
        modifiers={[font({ textStyle: TYPE_ROLE.ROW_LINE }), foregroundStyle(colors.TEXT_MUTED)]}
      >
        {empty}
      </Text>
    );
  }

  const rows = (
    <VStack alignment="leading" spacing={0}>
      {skills.map((skill) => (
        <SuggestionRow
          key={skill.name}
          glyph={GLYPH.SKILL}
          title={skill.word}
          detail={skill.detail}
          onPress={() => onPick(skill.name)}
        />
      ))}
    </VStack>
  );

  if (large || skills.length <= SUGGESTIONS_SHOWN) return rows;

  return (
    <ScrollView modifiers={[frame({ height: SUGGESTION_HEIGHT * SUGGESTIONS_SHOWN })]}>
      {rows}
    </ScrollView>
  );
}

/**
 * A note over the field of what a message sent now does, in the muted ink,
 * as the panel's box says it in a line over its field: "Sending a message
 * denies the waiting approval." Note that it is no refusal, so it is never
 * drawn as a problem (`AskNote`), and VoiceOver reads it where it stands.
 */
export function HeadNote({ words }: { readonly words: string }) {
  const colors = useColors();

  return (
    <Text
      modifiers={[
        font({ textStyle: TYPE_ROLE.ROW_LINE }),
        foregroundStyle(colors.TEXT_MUTED),
        frame({ maxWidth: Number.POSITIVE_INFINITY, alignment: "leading" }),
      ]}
    >
      {words}
    </Text>
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
