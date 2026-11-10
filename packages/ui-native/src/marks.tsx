// marks.tsx -- the small marks a row leads with: the unread dot, a task's status, a person's avatar, and an agent's tile.

import { Circle, Image, RoundedRectangle, Text, ZStack } from "@expo/ui/swift-ui";
import {
  accessibilityHidden,
  accessibilityLabel,
  font,
  foregroundStyle,
  frame,
  opacity,
} from "@expo/ui/swift-ui/modifiers";
import type { TaskStatus } from "@repo/features/task-wire";
import { monogramOf } from "./monogram.js";
import { STATUS_MARK_LABEL, STATUS_MARK_LOOK } from "./status-mark-model.js";
import { toneColor, useColors } from "./tokens/colors.js";
import { MARK_SIZE } from "./tokens/space.js";

/** The share of an avatar's width its letters stand at. */
const MONOGRAM_SCALE = 0.42;

/** How faint a done row's dot stands, as the panel fades a done row's unread column. */
const FADED_OPACITY = 0.45;

/**
 * The accent dot an unread row leads with, in the accent's ink as the
 * panel's. Note that a read row draws it clear rather than not at all, so its
 * words stand in the same column as an unread row's.
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
        foregroundStyle(colors.ACCENT_TEXT),
        opacity(unread ? (faded ? FADED_OPACITY : 1) : 0),
        unread ? accessibilityLabel("Unread") : accessibilityHidden(),
      ]}
    />
  );
}

/** A task's status as its ring, in its tone's ink, heard as the status's name. */
export function TaskStatusMark({ status }: { readonly status: TaskStatus }) {
  const colors = useColors();
  const look = STATUS_MARK_LOOK[status];
  return (
    <Image
      systemName={look.symbol}
      size={MARK_SIZE.GLYPH}
      color={toneColor(colors, look.tone)}
      modifiers={[accessibilityLabel(STATUS_MARK_LABEL[status])]}
    />
  );
}

type AvatarProps = {
  /** The person's or agent's name, which the avatar draws the letters of and is heard as. */
  readonly name: string;
  /** Its width, in points; a row's where none is given. */
  readonly size?: number | undefined;
};

/** A person's letters on the brand's avatar tile, as GitHub shows the product's own. */
export function Avatar({ name, size = MARK_SIZE.AVATAR }: AvatarProps) {
  const colors = useColors();
  return (
    <ZStack modifiers={[frame({ width: size, height: size }), accessibilityLabel(name)]}>
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
    </ZStack>
  );
}

/** The share of an agent's tile its corners round by, a square softened as the panel's agent tiles are. */
const TILE_ROUNDING = 0.28;

/** The share of an agent's tile its glyph stands at. */
const TILE_GLYPH_SCALE = 0.5;

/**
 * An agent's tile, as the panel's messages lead an agent's words with it: a
 * rounded square on the brand's well, the agent's glyph on it in the ink,
 * heard as the agent's name, so an agent never reads as a person.
 */
export function AgentTile({ name, size = MARK_SIZE.AVATAR }: AvatarProps) {
  const colors = useColors();
  return (
    <ZStack modifiers={[frame({ width: size, height: size }), accessibilityLabel(name)]}>
      <RoundedRectangle
        cornerRadius={size * TILE_ROUNDING}
        modifiers={[foregroundStyle(colors.WELL)]}
      />
      <Image
        systemName="sparkles"
        size={size * TILE_GLYPH_SCALE}
        color={colors.TEXT}
        modifiers={[accessibilityHidden()]}
      />
    </ZStack>
  );
}
