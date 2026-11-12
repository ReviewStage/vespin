// interactions.ts -- the modifiers @expo/ui lacks, which the app's native module registers (`apps/mobile/modules/native-interactions`): an iPad pointer's hover effect, a view dragged out as its link, and pictures or a link dropped on a view.

import {
  createModifier,
  createModifierWithEventListener,
  type ModifierConfig,
} from "@expo/ui/swift-ui/modifiers";
import { flow, Option, Schema } from "effect";

/** The names the native module registers each modifier under, which its Swift names too. */
const MODIFIER = {
  HOVER_EFFECT: "vespinHoverEffect",
  DRAG_LINK: "vespinDragLink",
  DROP_PICTURES: "vespinDropPictures",
  DROP_LINK: "vespinDropLink",
} as const;

/** How the pointer meets a view on an iPad: a highlight behind it, as a row or a bar's button takes it, or the view lifted under it, as a small capsule takes it. */
export const HOVER_EFFECT = {
  HIGHLIGHT: "highlight",
  LIFT: "lift",
} as const;

export type HoverEffect = (typeof HOVER_EFFECT)[keyof typeof HOVER_EFFECT];

/** The pointer's hover over a view, which also shapes the pointer to it. */
export function hoverEffect(effect: HoverEffect): ModifierConfig {
  return createModifier(MODIFIER.HOVER_EFFECT, { effect });
}

/** A view dragged out as its link: another app takes it as a URL, and a place here that takes a link reads it back. */
export function dragLink(url: string): ModifierConfig {
  return createModifier(MODIFIER.DRAG_LINK, { url });
}

/** What a drop of pictures sends: the addresses of the files it kept, in the order they were dropped, and how many were dropped, which an older build leaves out. */
const DroppedPicturesSchema = Schema.Struct({
  uris: Schema.Array(Schema.String),
  dropped: Schema.optionalKey(Schema.Number),
});

/** What a drop of a link sends: its address. */
const DroppedLinkSchema = Schema.Struct({ url: Schema.String });

const decodeDroppedPictures = Schema.decodeUnknownOption(DroppedPicturesSchema);
const decodeDroppedLink = Schema.decodeUnknownOption(DroppedLinkSchema);

/** Pictures dropped on a view, from Photos, Files, or another app, each kept as a JPEG and handed on by its file's address, with how many could not be kept, so the holder can say so; an event of no shape this reads is passed over. */
export function dropPictures(
  onDrop: (uris: readonly string[], unreadable: number) => void,
): ModifierConfig {
  return createModifierWithEventListener(
    MODIFIER.DROP_PICTURES,
    flow(
      decodeDroppedPictures,
      Option.match({
        onNone: () => undefined,
        onSome: ({ uris, dropped }) => {
          const unreadable = Math.max(0, (dropped ?? uris.length) - uris.length);

          if (uris.length + unreadable > 0) onDrop(uris, unreadable);
        },
      }),
    ),
  );
}

/** A link dropped on a view, such as a task's row dragged onto a section, handed on by its address. */
export function dropLink(onDrop: (url: string) => void): ModifierConfig {
  return createModifierWithEventListener(
    MODIFIER.DROP_LINK,
    flow(
      decodeDroppedLink,
      Option.map(({ url }) => onDrop(url)),
    ),
  );
}
