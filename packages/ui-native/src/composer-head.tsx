// composer-head.tsx -- what stands over a composer's field inside its glass: the pictures attached to the message as thumbnails and its pasted text files as chips by name and lines, each taken off by its ×, the skills a `/` offers, the line saying the field holds a sent message's words to send in its place.

import {
  Button,
  HStack,
  Image,
  ScrollView,
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
} from "@expo/ui/swift-ui/modifiers";
import { type ReactNode, useEffect } from "react";
import { useAccessibilitySize, useScaledSize } from "./accessibility.js";
import { CHIP_MARK, type ChipMark } from "./chip-mark-model.js";
import { useFloatRoom } from "./glass-bar.js";
import { GLYPH, type Glyph, glyphImage } from "./glyph.js";
import { Avatar, AvatarPhoto, HarnessMark } from "./marks.js";
import { useSuggestionKeys } from "./suggestion-keys.js";
import { toneColor, useColors } from "./tokens/colors.js";
import { MARK_SIZE, PRESS_SIZE, RADIUS, SPACE } from "./tokens/space.js";
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

/** How tall one suggestion stands at least, in points: a list row's, as iOS's rows stand. */
const SUGGESTION_HEIGHT = PRESS_SIZE;

/** How far a chosen row's fill reaches past its words on either side, into the list's inset. */
const CHOSEN_REACH = SPACE.TIGHT * 2;

/** How far a suggestion's words stand from its top and bottom, so a row of two lines stands as Mail's recipient suggestions do and one of a line stands a list row's 44 pt. */
const SUGGESTION_VERTICAL = 6;

/**
 * What a suggestion's row leads with, in a square the size of a row's
 * glyph, so the names line up whatever leads them: the mark of the entity
 * it names, as the chip a pick writes leads with it (`ChipMark`), a
 * person's photo or letters, a task's status ring in its tone, an agent's
 * harness, a pull request's state, a thread's ask; else its kind's glyph in
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
 * One row a composer offers over the field, as a `/` offers a skill and an
 * `@` a mention, in a list row's metrics: its mark centered in the column
 * a row's lead mark stands in, its title in the body style over a muted
 * line in the subheadline style, as Mail's recipient suggestions stand, at
 * least a row's 44 pt, the row's whole width taking the press, which dims
 * it while held as the system's plain buttons dim. Note that at an
 * accessibility size its words wrap rather than cut.
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
  /** Whether a hardware keyboard's arrows have chosen the row, which Return picks: it stands on the selected row's rounded fill, as the desktop's highlight does. */
  readonly chosen?: boolean | undefined;
  readonly onPress: () => void;
}) {
  const large = useAccessibilitySize();
  const lines = large ? [] : [lineLimit(1)];
  const colors = useColors();
  const column = useScaledSize(MARK_SIZE.LEAD);

  return (
    <Button onPress={onPress} modifiers={[buttonStyle("plain"), accessibilityLabel(title)]}>
      {/* Note that the shape stands on the row's full-width frame, not on the button, so a press past the row's words still picks it. */}
      <HStack
        spacing={SPACE.ROW}
        modifiers={[
          SwiftModifiers.padding({ vertical: SUGGESTION_VERTICAL }),
          frame({
            minHeight: SUGGESTION_HEIGHT,
            maxWidth: Number.POSITIVE_INFINITY,
            alignment: "leading",
          }),
          SwiftModifiers.contentShape(SwiftModifiers.shapes.rectangle()),
          // Note that the chosen row's fill reaches past its words into the list's inset, as a selected row's fill stands round its words, and every row carries it, clear where not chosen, so a key moving the choice redraws no row's shape.
          SwiftModifiers.padding({ horizontal: CHOSEN_REACH }),
          SwiftModifiers.background(
            chosen ? colors.SELECTED : "transparent",
            SwiftModifiers.shapes.roundedRectangle({ cornerRadius: RADIUS.SIDEBAR_ROW }),
          ),
          SwiftModifiers.padding({ horizontal: -CHOSEN_REACH }),
          SwiftModifiers.id(String(place)),
        ]}
      >
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

/** How far a float's list stands in from its glass's edges, where the bar's field stands its words. */
const SUGGESTION_INSET = { horizontal: SPACE.ROW + 2 } as const;

/** How far apart the groups an `@` offers stand, as a grouped list's sections stand apart, their headings over them. */
const MENTION_GROUP_GAP = SPACE.ROW;

/**
 * The one list a composer floats over its field, whatever it offers (a
 * `/`'s skills, an `@`'s mentions): what heads it standing still, such as
 * a narrowed list's crumb, over its rows, or over what stands where there
 * are none in the muted ink. Note that its rows stand in one scroll whose
 * frame caps it at the room over the keyboard (`useFloatRoom`) and whose
 * fixed size stands it as tall as its rows below that, in SwiftUI's own
 * layout, so a short list hugs its rows and a long one scrolls, the float
 * shrinking and growing in the frame the words land in, never a frame
 * later, and never swapped for a view of another kind, which drew every
 * row anew; a drag over it scrolls the rows and leaves the keyboard
 * standing, as Messages' suggestions do.
 */
function SuggestionPanel({
  head,
  empty,
  chosen,
  children,
}: {
  readonly head?: ReactNode;
  /** What stands in the rows' place, such as no result matching; the rows stand where none is given. */
  readonly empty: string | undefined;
  /** The place of the row a hardware keyboard's arrows have chosen, which the scroll brings into sight; none while none is. */
  readonly chosen?: number | undefined;
  readonly children: ReactNode;
}) {
  const colors = useColors();
  const room = useFloatRoom();
  const scrolled = useNativeState<string | null>(null);

  // Note that the scroll follows the row the arrows choose, so the choice never moves out of sight past the float's room.
  useEffect(() => {
    if (chosen !== undefined) scrolled.value = String(chosen);
  }, [chosen, scrolled]);

  return (
    <VStack alignment="leading" spacing={0} modifiers={[SwiftModifiers.padding(SUGGESTION_INSET)]}>
      {head}
      {empty === undefined ? (
        <ScrollView
          modifiers={[
            SwiftModifiers.scrollDismissesKeyboard("never"),
            SwiftModifiers.scrollPosition(scrolled, { anchor: "center" }),
            frame({ maxWidth: Number.POSITIVE_INFINITY, maxHeight: room, alignment: "topLeading" }),
            SwiftModifiers.fixedSize({ horizontal: false, vertical: true }),
          ]}
        >
          <VStack alignment="leading" spacing={0} modifiers={[SwiftModifiers.scrollTargetLayout()]}>
            {children}
          </VStack>
        </ScrollView>
      ) : (
        <Text
          modifiers={[
            font({ textStyle: TYPE_ROLE.ROW_LINE }),
            foregroundStyle(colors.TEXT_MUTED),
            frame({ minHeight: SUGGESTION_HEIGHT, alignment: "leading" }),
          ]}
        >
          {empty}
        </Text>
      )}
    </VStack>
  );
}

/**
 * What an `@` being typed offers, as the panel's mention picker groups it:
 * each group under its small muted heading, its rows led by the mark of
 * the entity each names, as the chip a pick writes leads with it (a
 * person's face, a task's status, an agent's harness, a pull request's
 * state, a thread's ask), else their kind's glyph, a person's "You" or
 * address and a task's key under the name, and the row picked written into
 * the message; what stands where nothing matches said in the muted ink. It
 * floats over the composer in a glass of its own (`BarFloat`), as Messages,
 * Slack and the panel's popover float theirs, in the one list a composer
 * floats (`SuggestionPanel`), a narrowed list's crumb standing still over
 * its rows.
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

  // Each row by its place in the whole list, which the arrows step through across its groups.
  const starts = groups.map((_, at) =>
    groups.slice(0, at).reduce((sum, group) => sum + group.rows.length, 0),
  );

  const rows = groups.flatMap((group) => group.rows.map((row) => ({ group: group.title, row })));

  const chosen = useSuggestionKeys(rows.length, (place) => {
    const picked = rows[place];

    if (picked !== undefined) onPick(picked.group, picked.row.id);
  });

  if (groups.length === 0 && empty === undefined) return head;

  return (
    <SuggestionPanel head={head} empty={groups.length === 0 ? empty : undefined} chosen={chosen}>
      <VStack alignment="leading" spacing={MENTION_GROUP_GAP}>
        {groups.map((group, at) => (
          <VStack key={group.title} alignment="leading" spacing={0}>
            {/* Note that a narrowed list's crumb already names its one group. */}
            {crumb === undefined ? (
              <Text
                modifiers={[
                  font({ textStyle: TYPE_ROLE.GROUP_HEADER, weight: "semibold" }),
                  foregroundStyle(colors.TEXT_MUTED),
                  SwiftModifiers.padding({ top: SPACE.TIGHT }),
                  SwiftModifiers.accessibilityAddTraits(["isHeader"]),
                ]}
              >
                {group.title}
              </Text>
            ) : null}
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
          </VStack>
        ))}
      </VStack>
    </SuggestionPanel>
  );
}

/**
 * The skills a `/` being typed offers, floating over the composer as what
 * an `@` offers floats (`SuggestionPanel`), as Messages offers its
 * suggestions: each its `/name` and a muted line of what it is for,
 * written into the message on a press; what stands in their place where
 * there are none, such as why they could not be read, said in the muted
 * ink. Its rows scroll inside it past the room over the keyboard.
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
    <SuggestionPanel empty={skills.length === 0 ? empty : undefined} chosen={chosen}>
      <VStack alignment="leading" spacing={0}>
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
      </VStack>
    </SuggestionPanel>
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
