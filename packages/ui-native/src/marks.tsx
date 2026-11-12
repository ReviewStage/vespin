// marks.tsx -- the small marks a row leads or ends with: the unread dot, a task's status, a person's avatar or photo, an agent's tile, the needs-you, working, and failed marks, and a glyph in its tone.

import {
  Circle,
  Image,
  ProgressView,
  RNHostView,
  RoundedRectangle,
  Text,
  ZStack,
} from "@expo/ui/swift-ui";
import {
  accessibilityHidden,
  accessibilityLabel,
  controlSize,
  font,
  foregroundStyle,
  frame,
  opacity,
  resizable,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import { accountPictureAt, pinnedPictureUrl } from "@repo/features/account-picture";
import { NEEDS_YOU } from "@repo/features/inbox-list-model";
import { MODEL_PROVIDER, type ModelProvider } from "@repo/features/models-wire";
import { TASK_STATUS_WORDS } from "@repo/features/task-standing-words";
import type { TaskStatus } from "@repo/features/task-wire";
import { useState } from "react";
import { Image as Photo, PixelRatio, View } from "react-native";
import { type Glyph, isLucideSymbol } from "./glyph.js";
import { monogramOf } from "./monogram.js";
import { STATUS_MARK_LOOK } from "./status-mark-model.js";
import { type StatusTone, toneColor, useColors } from "./tokens/colors.js";
import { MARK_SIZE } from "./tokens/space.js";
import { TYPE_ROLE } from "./tokens/type.js";

/** The share of an avatar's width its letters stand at. */
const MONOGRAM_SCALE = 0.42;

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
  return (
    <Circle
      modifiers={[
        frame({ width: MARK_SIZE.DOT, height: MARK_SIZE.DOT }),
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
 * an SF Symbol from the system, or one of Lucide's from the asset catalog's
 * symbol sets, which SwiftUI sizes, weighs, and sets on the baseline alike.
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
  const drawn = isLucideSymbol(glyph) ? { assetName: glyph } : { systemName: glyph };
  return (
    <Image
      {...drawn}
      color={toneColor(colors, tone)}
      modifiers={[font({ textStyle }), ...(hidden ? [accessibilityHidden()] : [])]}
    />
  );
}

/**
 * A task's status as its ring, in its tone's ink, heard as the status's
 * name: the one mark a status tone stands on.
 */
export function TaskStatusMark({ status }: { readonly status: TaskStatus }) {
  const colors = useColors();
  const look = STATUS_MARK_LOOK[status];
  return (
    <Image
      systemName={look.symbol}
      size={MARK_SIZE.GLYPH}
      color={toneColor(colors, look.tone)}
      modifiers={[accessibilityLabel(TASK_STATUS_WORDS[status])]}
    />
  );
}

/** A person as a mark draws them: their name, whose letters stand in for a picture, and their sign-in picture where one is known. */
export type Face = {
  readonly name: string;
  readonly picture?: string | undefined;
};

type AvatarProps = {
  /** The person's or agent's name, which the avatar draws the letters of and is heard as. */
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
  onLoad,
  onFail,
}: {
  readonly address: string;
  readonly size: number;
  /** How round its corners stand, in points; a circle's where none is given. */
  readonly corner?: number | undefined;
  /** Told once the photo has drawn, so the mark behind it can step aside. */
  readonly onLoad: () => void;
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
        <Photo source={{ uri: address }} onLoad={onLoad} onError={onFail} style={round} />
      </View>
    </RNHostView>
  );
}

/**
 * A person's face on the brand's avatar tile: their photo where a picture is
 * given, from a host `@repo/features/account-picture` lets a picture load
 * from and asked for at the size it is drawn, and their letters otherwise.
 * Note that the letters stand only until the photo has drawn, so they show
 * while it loads and once it fails, which takes the photo away, but never
 * through a photo's transparent pixels.
 */
export function Avatar({
  name,
  size = MARK_SIZE.AVATAR,
  picture,
}: AvatarProps & {
  /** The address of the person's photo, such as their sign-in picture; their letters alone where none is given. */
  readonly picture?: string | undefined;
}) {
  const colors = useColors();
  const pinned = pinnedPictureUrl(picture);
  const [failed, setFailed] = useState<string | undefined>(undefined);
  const [drawn, setDrawn] = useState<string | undefined>(undefined);
  const photoDrawn = pinned !== undefined && pinned === drawn && pinned !== failed;
  return (
    <ZStack modifiers={[frame({ width: size, height: size }), accessibilityLabel(name)]}>
      {photoDrawn ? null : (
        <>
          <Circle modifiers={[foregroundStyle(colors.AVATAR_TILE)]} />
          <Text
            modifiers={[
              font({ size: size * MONOGRAM_SCALE, weight: "semibold", design: "rounded" }),
              foregroundStyle(colors.AVATAR_INK),
              accessibilityHidden(),
            ]}
          >
            {monogramOf(name)}
          </Text>
        </>
      )}
      {pinned === undefined || pinned === failed ? null : (
        <AvatarPhoto
          address={accountPictureAt(pinned, size * PixelRatio.get())}
          size={size}
          onLoad={() => setDrawn(pinned)}
          onFail={() => setFailed(pinned)}
        />
      )}
    </ZStack>
  );
}

/** The share of an agent's or a workspace's tile its corners round by, a square softened as the panel's tiles are. */
export const TILE_ROUNDING = 0.28;

/** The share of an agent's tile its glyph stands at. */
const TILE_GLYPH_SCALE = 0.5;

/**
 * The share of an agent's tile its harness's mark stands at. Note that it
 * is larger than a glyph's, because a mark is a picture with its own margins
 * (Clawd is wider than tall, so its square canvas leaves room above and
 * below it), and at a glyph's share it read as a speck at a row's size.
 */
const TILE_MARK_SCALE = 0.72;

/**
 * The image sets each harness's mark is drawn from, which the app's config
 * writes into its asset catalog (`apps/mobile/app.config.ts`): Claude Code's
 * Clawd from the brand's path in its own clay, and Codex's picture from the
 * files the panel serves, each as the panel's `HarnessMark` draws it.
 */
const HARNESS_MARK_ASSET = {
  [MODEL_PROVIDER.ANTHROPIC]: "ClawdMark",
  [MODEL_PROVIDER.OPENAI]: "CodexMark",
} as const satisfies Record<ModelProvider, string>;

/**
 * An agent's tile, as the panel's messages lead an agent's words with it: a
 * rounded square on the brand's well, the mark of the harness the agent runs
 * in on it (Claude Code's Clawd, Codex's picture), or the ink's sparkles where
 * the harness is not known, heard as the agent's name, so an agent never
 * reads as a person.
 */
export function AgentTile({
  name,
  harness,
  size = MARK_SIZE.AVATAR,
}: AvatarProps & {
  /** The provider whose harness the agent runs in (`providerOf` its model); none where it is not known. */
  readonly harness?: ModelProvider | undefined;
}) {
  const colors = useColors();
  const glyph = size * TILE_GLYPH_SCALE;
  return (
    <ZStack modifiers={[frame({ width: size, height: size }), accessibilityLabel(name)]}>
      <RoundedRectangle
        cornerRadius={size * TILE_ROUNDING}
        modifiers={[foregroundStyle(colors.WELL)]}
      />
      {harness === undefined ? (
        <Image
          systemName="sparkles"
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
            accessibilityHidden(),
          ]}
        />
      )}
    </ZStack>
  );
}

/** The dot a row ends with where a thread of it waits on the reader, in the attention ink, heard as Needs you. */
export function NeedsYouDot() {
  const colors = useColors();
  return (
    <Circle
      modifiers={[
        frame({ width: MARK_SIZE.DOT, height: MARK_SIZE.DOT }),
        foregroundStyle(colors.ATTENTION),
        accessibilityLabel(NEEDS_YOU.LABEL),
      ]}
    />
  );
}

/** What a failed mark is heard as. */
const FAILED_WORDS = "Failed";

/** The mark a failed agent's row, or its task's, ends with: the filled alert in the danger ink, heard as Failed. */
export function FailedMark() {
  const colors = useColors();
  return (
    <Image
      systemName="exclamationmark.circle.fill"
      color={colors.DANGER}
      modifiers={[font({ textStyle: TYPE_ROLE.TIME }), accessibilityLabel(FAILED_WORDS)]}
    />
  );
}

/** What a working mark is heard as. */
const WORKING_WORDS = "Working";

/** The system's spinner, small and in the working ink, where an agent is at work. */
export function WorkingMark() {
  const colors = useColors();
  return (
    <ProgressView
      modifiers={[controlSize("mini"), tint(colors.WORKING), accessibilityLabel(WORKING_WORDS)]}
    />
  );
}
