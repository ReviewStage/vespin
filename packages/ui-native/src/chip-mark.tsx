// chip-mark.tsx -- the mark a chip in a line of words leads with for the entity it names, as the panel's `entity-mark.tsx` draws it: a task's status, an agent's harness, a person's face, a thread's ask, a workspace's tile.

import { accountPictureAt, pinnedPictureUrl } from "@repo/features/account-picture";
import { identityLetter } from "@repo/features/workspace-tile";
import { SymbolView } from "expo-symbols";
import { createContext, type ReactNode, useContext, useState } from "react";
import { Image as Photo, PixelRatio, Text, useColorScheme, View } from "react-native";
import { CHIP_MARK, type ChipMark, type ChipMarkOf } from "./chip-mark-model.js";
import { type Glyph, glyphSymbol } from "./glyph.js";
import { HARNESS_MARK_ASSET, MONOGRAM_SCALE, TILE_ROUNDING } from "./marks.js";
import { monogramOf } from "./monogram.js";
import { type BrandColors, toneColor } from "./tokens/colors.js";
import { ON_IDENTITY } from "./tokens/identity-hues.js";
import { tileHue } from "./workspace-tile-model.js";

const NO_MARKS: ChipMarkOf = () => undefined;

const ChipMarkContext = createContext<ChipMarkOf>(NO_MARKS);

/**
 * Hands every line of words under it what the app holds of the entities its
 * chips name, so a chip in a message, a transcript, or a description leads
 * with its entity's own mark wherever it stands, from one reading of the
 * app's state rather than one per chip.
 */
export function ChipMarkProvider({
  markOf,
  children,
}: {
  readonly markOf: ChipMarkOf;
  readonly children: ReactNode;
}) {
  return <ChipMarkContext value={markOf}>{children}</ChipMarkContext>;
}

/** The marks the app holds for the entities chips name; none outside a `ChipMarkProvider`. */
export function useChipMarkOf(): ChipMarkOf {
  return useContext(ChipMarkContext);
}

/** A glyph in a `size`-point square, through the system's symbol view, which reads the app's Lucide symbols too, so a chip costs no SwiftUI host of its own. */
export function ChipSymbol({
  glyph,
  size,
  color,
}: {
  readonly glyph: Glyph;
  readonly size: number;
  readonly color: string;
}) {
  return (
    <SymbolView
      name={glyphSymbol(glyph)}
      size={size}
      tintColor={color}
      accessibilityElementsHidden
    />
  );
}

/** A picture over the letters it stands in for, which give way once it has drawn and come back where it fails. */
function PictureOverLetters({
  address,
  size,
  corner,
  ground,
  ink,
  letters,
  letterScale,
}: {
  readonly address: string | undefined;
  readonly size: number;
  readonly corner: number;
  readonly ground: string;
  readonly ink: string;
  readonly letters: string;
  readonly letterScale: number;
}) {
  const [drawn, setDrawn] = useState<string | undefined>(undefined);
  const [failed, setFailed] = useState<string | undefined>(undefined);
  const shown = address !== undefined && address !== failed;
  const box = { width: size, height: size, borderRadius: corner, overflow: "hidden" } as const;
  // Note that the letters take no text scale of their own, since `size` already carries the reader's.

  return (
    <View
      style={[box, { alignItems: "center", justifyContent: "center" }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {shown && address === drawn ? null : (
        <>
          <View style={[box, { position: "absolute", backgroundColor: ground }]} />
          <Text
            allowFontScaling={false}
            style={{ fontSize: size * letterScale, fontWeight: "600", color: ink }}
          >
            {letters}
          </Text>
        </>
      )}
      {shown ? (
        <Photo
          source={{ uri: address }}
          onLoad={() => setDrawn(address)}
          onError={() => setFailed(address)}
          style={[box, { position: "absolute" }]}
        />
      ) : null}
    </View>
  );
}

/** The share of a tile its letter stands at, as `WorkspaceTile`'s. */
const TILE_LETTER_SCALE = 0.5;

/** A chip's mark at `size` points, as the panel's chip draws its entity's. */
export function ChipMarkView({
  mark,
  size,
  colors,
}: {
  readonly mark: ChipMark;
  readonly size: number;
  readonly colors: BrandColors;
}) {
  const dark = useColorScheme() === "dark";

  const scaled = (address: string | undefined) =>
    address === undefined ? undefined : accountPictureAt(address, size * PixelRatio.get());

  switch (mark.kind) {
    case CHIP_MARK.GLYPH:
      return <ChipSymbol glyph={mark.glyph} size={size} color={toneColor(colors, mark.tone)} />;
    case CHIP_MARK.FACE:
      return (
        <PictureOverLetters
          address={scaled(pinnedPictureUrl(mark.picture))}
          size={size}
          corner={size / 2}
          ground={colors.AVATAR_TILE}
          ink={colors.AVATAR_INK}
          letters={monogramOf(mark.name)}
          letterScale={MONOGRAM_SCALE}
        />
      );
    case CHIP_MARK.HARNESS:
      return (
        <Photo
          source={{ uri: HARNESS_MARK_ASSET[mark.harness] }}
          style={{ width: size, height: size }}
          resizeMode="contain"
          accessibilityElementsHidden
        />
      );
    case CHIP_MARK.TILE:
      return (
        <PictureOverLetters
          address={mark.workspace.photo ?? scaled(pinnedPictureUrl(mark.workspace.picture))}
          size={size}
          corner={size * TILE_ROUNDING}
          ground={tileHue(mark.workspace.id, dark)}
          ink={ON_IDENTITY}
          letters={identityLetter(mark.workspace.name)}
          letterScale={TILE_LETTER_SCALE}
        />
      );
  }
}
