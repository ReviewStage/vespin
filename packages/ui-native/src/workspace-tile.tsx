// workspace-tile.tsx -- a workspace's tile, as the panel's is: its photo, its owner's picture on a personal one, or its letter on its hue.

import { RoundedRectangle, Text, ZStack } from "@expo/ui/swift-ui";
import { accessibilityHidden, font, foregroundStyle, frame } from "@expo/ui/swift-ui/modifiers";
import { accountPictureAt, pinnedPictureUrl } from "@repo/features/account-picture";
import { identityLetter } from "@repo/features/workspace-tile";
import { useState } from "react";
import { PixelRatio, useColorScheme } from "react-native";
import { AvatarPhoto, TILE_ROUNDING } from "./marks.js";
import { ON_IDENTITY } from "./tokens/identity-hues.js";
import { MARK_SIZE } from "./tokens/space.js";
import { tileHue } from "./workspace-tile-model.js";

/** The share of a tile its letter stands at. */
const LETTER_SCALE = 0.5;

/** A workspace as its tile and the switcher's rows draw it. */
export type SwitcherWorkspace = {
  readonly id: string;
  readonly name: string;
  /** Who shares it, "5 members" or "Personal workspace", under its name; none from a service that does not count them. */
  readonly line?: string | undefined;
  /** Its photo as the host holds it, a `data:` address, where an owner set one. */
  readonly photo?: string | undefined;
  /** Its owner's sign-in picture, which a personal workspace with no photo stands. */
  readonly picture?: string | undefined;
};

/** The picture a tile draws over its letter: the photo as held, else the owner's picture asked for at the tile's size; none while the letter stands alone. */
function tilePicture(workspace: SwitcherWorkspace, size: number): string | undefined {
  if (workspace.photo !== undefined) return workspace.photo;
  const pinned = pinnedPictureUrl(workspace.picture);

  return pinned === undefined ? undefined : accountPictureAt(pinned, size * PixelRatio.get());
}

/**
 * A workspace's tile, as the panel's is: its photo, its owner's picture on a
 * personal one, or the first character of its name on one of six hues read
 * off its id, on a softened square, since a square says a team as a circle
 * says a person. Note that the hue and the letter stand only until the
 * picture has drawn, so they show while it loads and once it fails, which
 * takes the picture away, but never through a picture's transparent pixels.
 * It is never heard, since the name beside it says the workspace.
 */
export function WorkspaceTile({
  workspace,
  size = MARK_SIZE.AVATAR,
}: {
  readonly workspace: SwitcherWorkspace;
  /** Its width, in points; an avatar's where none is given. */
  readonly size?: number | undefined;
}) {
  const dark = useColorScheme() === "dark";
  const picture = tilePicture(workspace, size);
  const [failed, setFailed] = useState<string | undefined>(undefined);
  const [drawn, setDrawn] = useState<string | undefined>(undefined);
  const pictureDrawn = picture !== undefined && picture === drawn && picture !== failed;
  const corner = size * TILE_ROUNDING;

  return (
    <ZStack modifiers={[frame({ width: size, height: size }), accessibilityHidden()]}>
      {pictureDrawn ? null : (
        <>
          <RoundedRectangle
            cornerRadius={corner}
            modifiers={[foregroundStyle(tileHue(workspace.id, dark))]}
          />
          <Text
            modifiers={[
              font({ size: size * LETTER_SCALE, weight: "semibold", design: "rounded" }),
              foregroundStyle(ON_IDENTITY),
            ]}
          >
            {identityLetter(workspace.name)}
          </Text>
        </>
      )}
      {picture === undefined || picture === failed ? null : (
        <AvatarPhoto
          address={picture}
          size={size}
          corner={corner}
          onLoad={() => setDrawn(picture)}
          onFail={() => setFailed(picture)}
        />
      )}
    </ZStack>
  );
}
