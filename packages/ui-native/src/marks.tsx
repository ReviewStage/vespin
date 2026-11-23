// marks.tsx -- the small marks a row leads or ends with: the unread dot, a task's status, a person's avatar or photo, an agent's tile, the needs-you, working, and failed marks and a glyph in its tone.

import {
  Circle,
  Gauge,
  HStack,
  Image,
  RNHostView,
  RoundedRectangle,
  Text,
  ZStack,
} from "@expo/ui/swift-ui";
import {
  accessibilityHidden,
  accessibilityLabel,
  fixedSize,
  font,
  foregroundStyle,
  frame,
  gaugeStyle,
  lineLimit,
  monospacedDigit,
  offset,
  opacity,
  resizable,
  scaleEffect,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import { accountPictureAt, pinnedPictureUrl } from "@repo/features/account-picture";
import { GLYPH_STATE, GLYPH_STATE_WORDS } from "@repo/features/glyph-state";
import { NEEDS_YOU } from "@repo/features/inbox-list-model";
import type { IntegrationProvider } from "@repo/features/integration-wire";
import type { ModelProvider } from "@repo/features/models-wire";
import {
  TASK_PRIORITY_WORDS,
  TASK_STATUS_TONE,
  TASK_STATUS_WORDS,
} from "@repo/features/task-standing-words";
import type { TaskPriority, TaskStatus } from "@repo/features/task-wire";
import { repositoryOwnerPictureUrl } from "@repo/features/tasks-model";
import { identityLetter } from "@repo/features/workspace-tile";
import { memo, useState, useSyncExternalStore } from "react";
import { Image as Photo, PixelRatio, useColorScheme, View } from "react-native";
import { useReduceMotion, useScaledSize } from "./accessibility.js";
import { GLYPH, type Glyph, glyphImage, UNASSIGNED_UNDER } from "./glyph.js";
import { INTEGRATION_MARK_ASSET } from "./integration-marks.js";
import {
  HARNESS_MARK_ASSET,
  LETTER_SCALE,
  TILE_GLYPH_SCALE,
  TILE_MARK_SCALE,
  TILE_ROUNDING,
  WORKING_CELL,
  WORKING_DOTS,
  WORKING_INSET,
  WORKING_OPACITY,
  WORKING_PITCH,
  WORKING_SIDE,
  WORKING_TRACK,
} from "./mark-look.js";
import {
  PRIORITY_MARK_SYMBOL,
  PRIORITY_MARK_TONE,
  priorityMarkUnder,
  STATUS_MARK_SYMBOL,
} from "./status-mark-model.js";
import { type StatusTone, toneColor, useColors } from "./tokens/colors.js";
import { ON_IDENTITY } from "./tokens/identity-hues.js";
import { MARK_SIZE, SPACE } from "./tokens/space.js";
import { TYPE_ROLE } from "./tokens/type.js";
import { readWorkingBeat, subscribeWorkingBeat } from "./working-beat.js";
import { tileHue } from "./workspace-tile-model.js";

/** How faint a done row's dot stands, as the panel fades a done row's unread column. */
const FADED_OPACITY = 0.45;

/**
 * The copper dot an unread row carries in its margin, one of the few things
 * drawn in the accent, since it wants you. Note that a read row draws it
 * clear rather than not at all, so its mark and words stand in the same
 * columns as an unread row's.
 */
export function UnreadDot({
  unread,
  faded = false,
}: {
  readonly unread: boolean;
  readonly faded?: boolean;
}) {
  const colors = useColors();
  const dot = useScaledSize(MARK_SIZE.UNREAD);

  return (
    <Circle
      modifiers={[
        frame({ width: dot, height: dot }),
        foregroundStyle(colors.ACCENT),
        opacity(unread ? (faded ? FADED_OPACITY : 1) : 0),
        unread ? accessibilityLabel("Unread") : accessibilityHidden(),
      ]}
    />
  );
}

/**
 * A glyph in a tone's ink at a text style's size, the caption's unless
 * another is named, so it grows with Dynamic Type beside the words it leads:
 * one of Lucide's from the asset catalog's symbol sets, or an SF Symbol from
 * the system, which SwiftUI sizes, weighs, and sets on the baseline alike.
 * A glyph whose words beside it say what it marks is never heard.
 */
export function ToneGlyph({
  glyph,
  tone,
  textStyle = TYPE_ROLE.TIME,
  hidden = false,
}: {
  readonly glyph: Glyph;
  readonly tone: StatusTone;
  readonly textStyle?: (typeof TYPE_ROLE)[keyof typeof TYPE_ROLE];
  readonly hidden?: boolean;
}) {
  const colors = useColors();

  return (
    <Image
      {...glyphImage(glyph)}
      color={toneColor(colors, tone)}
      modifiers={[font({ textStyle }), ...(hidden ? [accessibilityHidden()] : [])]}
    />
  );
}

/**
 * A task's status as its ring, in its tone's ink, heard as the status's
 * name: the one mark a status tone stands on. Note that it is drawn again
 * only as its status, the theme, or the text size moves, since every task's
 * row, chip, and preview holds one and a list's change draws its rows again.
 */
export const TaskStatusMark = memo(function TaskStatusMark({
  status,
}: {
  readonly status: TaskStatus;
}) {
  const colors = useColors();
  const size = useScaledSize(MARK_SIZE.GLYPH);

  return (
    <Image
      {...glyphImage(STATUS_MARK_SYMBOL[status])}
      size={size}
      color={toneColor(colors, TASK_STATUS_TONE[status])}
      modifiers={[accessibilityLabel(TASK_STATUS_WORDS[status])]}
    />
  );
});

/** How round a repository's picture stands, of its size: a tile's, as the panel draws a repository's owner, not a person's circle. */
const REPOSITORY_CORNER = 0.25;

/**
 * A repository as the panel's sidebar marks it (`@repo/ui`'s
 * `RepositoryPicture`): its owner's GitHub picture on a tile's rounded
 * corners, with the repository's glyph standing in, in the muted ink, only
 * once the picture fails, never while it loads. It is never heard, since the words
 * beside it name the repository.
 */
export function RepositoryPicture({
  repository,
  size,
}: {
  /** The repository, `owner/name`. */
  readonly repository: string;
  /** Its width, in points, which its caller scales with Dynamic Type. */
  readonly size: number;
}) {
  const colors = useColors();
  const address = repositoryOwnerPictureUrl(repository);
  const [failed, setFailed] = useState<string | undefined>(undefined);
  const shown = address !== failed;

  return (
    <ZStack modifiers={[frame({ width: size, height: size }), accessibilityHidden()]}>
      {shown ? null : (
        <Image {...glyphImage(GLYPH.REPOSITORY)} size={size} color={colors.TEXT_MUTED} />
      )}
      {shown ? (
        <AvatarPhoto
          address={address}
          size={size}
          corner={size * REPOSITORY_CORNER}
          onFail={() => setFailed(address)}
        />
      ) : null}
    </ZStack>
  );
}

/**
 * A task's priority as its bars, as the panel marks it: the lit bars in its
 * ink over every bar it can light, drawn faint, urgent's square in the
 * attention ink, heard as the priority's name. Note that the faint bars are
 * a symbol of their own beneath the lit ones, each in one ink, since a
 * palette of two layers drew the whole mark black on iOS.
 */
export function TaskPriorityMark({ priority }: { readonly priority: TaskPriority }) {
  const colors = useColors();
  const size = useScaledSize(MARK_SIZE.GLYPH);
  const ink = toneColor(colors, PRIORITY_MARK_TONE[priority]);

  const lit = (
    <Image
      {...glyphImage(PRIORITY_MARK_SYMBOL[priority])}
      size={size}
      color={ink}
      modifiers={[accessibilityLabel(TASK_PRIORITY_WORDS[priority])]}
    />
  );

  // Note that the faint bars are the ones a priority's menu draws under its lit ones too (`priorityMarkUnder`), so the chip and the menu stand one mark.
  const under = priorityMarkUnder(priority);

  if (under === undefined) return lit;

  return (
    <ZStack>
      <Image
        {...glyphImage(under.glyph)}
        size={size}
        color={ink}
        modifiers={[opacity(under.opacity), accessibilityHidden()]}
      />
      {lit}
    </ZStack>
  );
}

/**
 * No one, where a place says who is on something and nobody is, as the
 * panel's `UnassignedAvatar` draws it at a face's size: its ring of eight
 * long dashes over its seat drawn faint, so the outline leads, in the muted
 * ink. It is never heard, since the words beside it say No assignee.
 */
export function UnassignedMark({ size }: { readonly size: number }) {
  const colors = useColors();

  return (
    <ZStack>
      <Image
        {...glyphImage(UNASSIGNED_UNDER.glyph)}
        size={size}
        color={colors.TEXT_MUTED}
        modifiers={[opacity(UNASSIGNED_UNDER.opacity), accessibilityHidden()]}
      />
      <Image
        {...glyphImage(GLYPH.UNASSIGNED)}
        size={size}
        color={colors.TEXT_MUTED}
        modifiers={[accessibilityHidden()]}
      />
    </ZStack>
  );
}

/** What a face is of, which its shape says: a person, in a circle, or an App or its bot, in the rounded square the panel and GitHub draw one in. */
export const FACE_KIND = {
  PERSON: "person",
  APP: "app",
} as const;

export type FaceKind = (typeof FACE_KIND)[keyof typeof FACE_KIND];

/** A person as a mark draws them: their name, whose first letter stands in for a picture, and their sign-in picture where one is known. */
export type Face = {
  readonly name: string;
  /** What its letter's hue is read off, such as a member's id, as the panel keys a person's disc, so they wear one color on every client; their name where none is given. */
  readonly id?: string | undefined;
  readonly picture?: string | undefined;
  /** What it is of, a person where none is given. */
  readonly kind?: FaceKind | undefined;
  /** Whether it is an App's bot on GitHub, whose name wears the bot tag after it (`BotTag`), as the panel's does; an App that runs a check wears none. */
  readonly bot?: boolean | undefined;
};

type AvatarProps = {
  /** The person's or agent's name, which the avatar draws the first letter of and is heard as. */
  readonly name: string;
  /** Its width, in points; a row's where none is given. */
  readonly size?: number | undefined;
};

/**
 * A photo clipped to its mark's shape, a person's circle unless a corner
 * is given, such as a workspace's tile, in a React Native view SwiftUI
 * hosts at the mark's size, as a thread's pictures are drawn, since
 * SwiftUI's own image reads a local file alone. It is never heard, since the
 * mark it stands in is heard as the name.
 */
export function AvatarPhoto({
  address,
  size,
  corner = size / 2,
  onFail,
}: {
  readonly address: string;
  readonly size: number;
  /** How round its corners stand, in points; a circle's where none is given. */
  readonly corner?: number | undefined;
  readonly onFail: () => void;
}) {
  const round = { width: size, height: size, borderRadius: corner, overflow: "hidden" } as const;

  return (
    <RNHostView>
      <View
        style={round}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Photo source={{ uri: address }} onError={onFail} style={round} />
      </View>
    </RNHostView>
  );
}

/**
 * A person's face: their photo where a picture is
 * given, from a host `@repo/features/account-picture` lets a picture load
 * from and asked for at the size it is drawn, and their name's first letter
 * otherwise, as the panel's avatar draws one (`identityLetter`).
 * An App, or its bot, stands in a rounded square rather than a circle, as
 * the panel and GitHub tell one from a person. The letter stands on the
 * identity hue read off its id, or its name where none is given, as the panel's `Avatar` draws a person's letter, so
 * a face holds its edge on the dark ground too. Note that the letter stands
 * only where there is no photo or it failed, never while one loads, so a
 * face with a photo never shows its letter first, nor through the photo's
 * transparent pixels.
 */
export function Avatar({
  name,
  size = MARK_SIZE.AVATAR,
  picture,
  kind = FACE_KIND.PERSON,
  id = name,
}: AvatarProps & {
  /** The address of the person's photo, such as their sign-in picture; their letter alone where none is given. */
  readonly picture?: string | undefined;
  readonly kind?: FaceKind | undefined;
  /** What its letter's hue is read off, such as a member's id; its name where none is given. */
  readonly id?: string | undefined;
}) {
  const dark = useColorScheme() === "dark";
  const pinned = pinnedPictureUrl(picture);
  const [failed, setFailed] = useState<string | undefined>(undefined);
  const photographed = pinned !== undefined && pinned !== failed;
  const corner = kind === FACE_KIND.APP ? size * TILE_ROUNDING : size / 2;

  return (
    <ZStack modifiers={[frame({ width: size, height: size }), accessibilityLabel(name)]}>
      {photographed ? null : (
        <>
          <RoundedRectangle
            cornerRadius={corner}
            modifiers={[foregroundStyle(tileHue(id, dark))]}
          />
          <Text
            modifiers={[
              font({ size: size * LETTER_SCALE, weight: "semibold", design: "rounded" }),
              foregroundStyle(ON_IDENTITY),
              accessibilityHidden(),
            ]}
          >
            {identityLetter(name)}
          </Text>
        </>
      )}
      {photographed ? (
        <AvatarPhoto
          address={accountPictureAt(pinned, size * PixelRatio.get())}
          size={size}
          corner={corner}
          onFail={() => setFailed(pinned)}
        />
      ) : null}
    </ZStack>
  );
}

/**
 * An agent's tile, as the panel's messages lead an agent's words with it: a
 * rounded square on the brand's well, the mark of the harness the agent runs
 * in on it (Claude Code's Clawd, Codex's picture), or the ink's hard hat where
 * the harness is not known, so an agent never reads as a person. It is never
 * heard, since it always stands beside the name it leads, as `HarnessMark`
 * is: heard as the name too, it read the name twice, and in an agent's row
 * stood as a stop of its own that a tap on it did not open (j9642t).
 */
export function AgentTile({
  harness,
  size = MARK_SIZE.AVATAR,
}: {
  /** The provider whose harness the agent runs in (`providerOf` its model); none where it is not known. */
  readonly harness?: ModelProvider | undefined;
  /** Its width, in points; a row's where none is given. */
  readonly size?: number | undefined;
}) {
  const colors = useColors();
  const glyph = size * TILE_GLYPH_SCALE;

  return (
    <ZStack modifiers={[frame({ width: size, height: size }), accessibilityHidden()]}>
      <RoundedRectangle
        cornerRadius={size * TILE_ROUNDING}
        modifiers={[foregroundStyle(colors.WELL)]}
      />
      {harness === undefined ? (
        <Image
          {...glyphImage(GLYPH.AGENT)}
          size={glyph}
          color={colors.TEXT}
          modifiers={[accessibilityHidden()]}
        />
      ) : (
        <Image
          assetName={HARNESS_MARK_ASSET[harness]}
          modifiers={[
            resizable(),
            frame({ width: size * TILE_MARK_SCALE, height: size * TILE_MARK_SCALE }),
            foregroundStyle(colors.TEXT),
            accessibilityHidden(),
          ]}
        />
      )}
    </ZStack>
  );
}

/** The mark of the harness a model runs in, as the panel leads a model's name with it: Claude Code's Clawd or Codex's picture, in its own colors, at `size`, unheard beside the name it leads. */
export function HarnessMark({
  provider,
  size = MARK_SIZE.FACE,
}: {
  readonly provider: ModelProvider;
  readonly size?: number | undefined;
}) {
  const colors = useColors();

  // Note that the text's ink reaches Cursor's cube alone, a template; Clawd and Codex's picture keep their own colors.
  return (
    <Image
      assetName={HARNESS_MARK_ASSET[provider]}
      modifiers={[
        resizable(),
        frame({ width: size, height: size }),
        foregroundStyle(colors.TEXT),
        accessibilityHidden(),
      ]}
    />
  );
}

/** An integration's mark, as the panel leads a call of its tool with it: the provider's own vector at `size`, a template mark in `ink`, unheard beside the words it leads. */
export function IntegrationMark({
  provider,
  size,
  ink,
}: {
  readonly provider: IntegrationProvider;
  readonly size: number;
  readonly ink: string;
}) {
  return (
    <Image
      assetName={INTEGRATION_MARK_ASSET[provider]}
      modifiers={[
        resizable(),
        frame({ width: size, height: size }),
        foregroundStyle(ink),
        accessibilityHidden(),
      ]}
    />
  );
}

/** The dot a row ends with where a thread of it waits on the reader, in the attention ink, heard as Needs you. */
export function NeedsYouDot() {
  const colors = useColors();
  const dot = useScaledSize(MARK_SIZE.DOT);

  return (
    <Circle
      modifiers={[
        frame({ width: dot, height: dot }),
        foregroundStyle(colors.ATTENTION),
        accessibilityLabel(NEEDS_YOU.LABEL),
      ]}
    />
  );
}

/** The mark a failed agent's row, or its task's, ends with: the filled alert in the danger ink, heard as Failed. */
export function FailedMark() {
  const colors = useColors();

  return (
    <Image
      {...glyphImage(GLYPH.FAILED)}
      color={colors.DANGER}
      modifiers={[
        font({ textStyle: TYPE_ROLE.TIME }),
        accessibilityLabel(GLYPH_STATE_WORDS[GLYPH_STATE.FAILED]),
      ]}
    />
  );
}

/** A beat that never moves, for a mark held still. */
function holdBeat(): () => void {
  return () => undefined;
}

/** The beat a mark steps on: the one shared beat, or its resting frame where the reader reduces motion. */
function useBeat(still: boolean): number {
  return useSyncExternalStore(still ? holdBeat : subscribeWorkingBeat, () =>
    still ? 0 : readWorkingBeat(),
  );
}

/**
 * The one mark an agent at work wears, the panel's own (`@repo/ui`'s
 * `WorkingMark`): two pixels chasing each other round the edge of a 3×3 grid
 * of 3 pt cells 2 pt apart, in the muted ink, each tailed by a fainter one,
 * stepping a cell on the one 200 ms beat every mark on screen shares
 * (`working-beat.ts`), so the eight cells lap in 1.6 s and every mark steps
 * together. Its 16 pt side grows with the reader's text size. Where the
 * reader reduces motion it holds its resting frame, chosen mid-lap so a
 * still mark lights four cells and reads as working. Note that only the
 * mark itself draws again on a step, never the row it stands in, since it
 * reads the beat alone. It is heard as Working.
 */
export function WorkingMark() {
  const colors = useColors();
  const side = useScaledSize(WORKING_SIDE);
  const scale = side / WORKING_SIDE;
  const beat = useBeat(useReduceMotion());
  const cell = WORKING_CELL * scale;

  const square = (index: number, shade: number, key: string) => {
    const [column, row] = WORKING_TRACK[index % WORKING_TRACK.length] ?? WORKING_TRACK[0];

    return (
      <RoundedRectangle
        key={key}
        cornerRadius={cell / 4}
        modifiers={[
          frame({ width: cell, height: cell }),
          foregroundStyle(colors.TEXT_MUTED),
          opacity(shade),
          offset({
            x: (WORKING_INSET + column * WORKING_PITCH) * scale,
            y: (WORKING_INSET + row * WORKING_PITCH) * scale,
          }),
        ]}
      />
    );
  };

  return (
    <ZStack
      alignment="topLeading"
      modifiers={[
        frame({ width: side, height: side, alignment: "topLeading" }),
        accessibilityLabel(GLYPH_STATE_WORDS[GLYPH_STATE.WORKING]),
      ]}
    >
      {WORKING_TRACK.map((_, index) => square(index, WORKING_OPACITY.TRACK, `track-${index}`))}
      {WORKING_DOTS.map(({ restsOn, tail }) =>
        square(
          restsOn + beat,
          tail ? WORKING_OPACITY.TAIL : WORKING_OPACITY.LEAD,
          `dot-${restsOn}`,
        ),
      )}
    </ZStack>
  );
}

/** The size SwiftUI's circular capacity gauge stands at on its own, which the progress ring is scaled down from to the mark's size. */
const GAUGE_SIDE = 58;

/** What a sub-task count is heard as, in place of its ring and figures. */
export function subTasksHeard(done: number, total: number): string {
  return `${done} of ${total} sub-tasks finished`;
}

/**
 * How many of a task's sub-tasks are finished, of all of them, as the
 * panel's rows say it (`ProgressCount`): a small ring filled to that share
 * in the working blue from twelve o'clock, then "2/5" in the muted ink and
 * tabular figures, whole on one line, so a narrow row cuts its name rather
 * than wrapping the count. The ring is SwiftUI's own circular capacity gauge, scaled
 * to a mark's size, since a shape here takes no trim. Hidden from VoiceOver,
 * since its row says the count in words (`subTasksHeard`).
 */
export function SubTaskProgress({
  done,
  total,
}: {
  readonly done: number;
  readonly total: number;
}) {
  const colors = useColors();
  const size = useScaledSize(MARK_SIZE.GLYPH - 2);

  return (
    <HStack spacing={SPACE.TIGHT} modifiers={[accessibilityHidden(true)]}>
      <Gauge
        value={total > 0 ? done / total : 0}
        modifiers={[
          gaugeStyle("circularCapacity"),
          tint(colors.WORKING),
          scaleEffect(size / GAUGE_SIDE),
          frame({ width: size, height: size }),
        ]}
      />
      <Text
        modifiers={[
          font({ textStyle: TYPE_ROLE.TIME }),
          monospacedDigit(),
          foregroundStyle(colors.TEXT_MUTED),
          lineLimit(1),
          fixedSize(),
        ]}
      >
        {`${done}/${total}`}
      </Text>
    </HStack>
  );
}
