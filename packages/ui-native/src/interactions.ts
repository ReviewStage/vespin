// interactions.ts -- the modifiers @expo/ui lacks, which the app's native module registers (`apps/mobile/modules/native-interactions`): the keyboard focus's ring left off a list's row, a bar's subtitle under its title, a view dragged out as its link, and pictures or a link dropped on a view.

import {
  createModifier,
  createModifierWithEventListener,
  type ModifierConfig,
} from "@expo/ui/swift-ui/modifiers";
import { flow, Option, Schema } from "effect";

/** The names the native module registers each modifier under, which its Swift names too. */
const MODIFIER = {
  CELL_FOCUS_RING_OFF: "vespinCellFocusRingOff",
  COLUMN_SUBTITLE: "vespinColumnSubtitle",
  STACK_SUBTITLE: "vespinStackSubtitle",
  DRAG_LINK: "vespinDragLink",
  DROP_PICTURES: "vespinDropPictures",
  DROP_LINK: "vespinDropLink",
} as const;

/** Which bar a subtitle stands under: a split view column's, SwiftUI's own, or the native stack's a compact screen is pushed under. */
export const BAR_KIND = { COLUMN: "column", STACK: "stack" } as const;

export type BarKind = (typeof BAR_KIND)[keyof typeof BAR_KIND];

/** A list's row whose cell draws no keyboard focus ring, such as a row of a list that keeps a selection, which its own fill already shows; the views inside the row keep their own focus effects. */
export function cellFocusRingOff(): ModifierConfig {
  return createModifier(MODIFIER.CELL_FOCUS_RING_OFF, {});
}

/**
 * A bar's subtitle under its title, as Mail names its filter under Inbox:
 * SwiftUI's own, for a split view's column, or the native stack's, for a
 * compact screen, whose bar no SwiftUI modifier reaches. Note that a view
 * takes it whether or not it has a subtitle, an empty one drawing none,
 * since adding or removing a modifier redraws everything under the view.
 */
export function barSubtitle(bar: BarKind, subtitle: string | undefined): ModifierConfig {
  return createModifier(
    bar === BAR_KIND.COLUMN ? MODIFIER.COLUMN_SUBTITLE : MODIFIER.STACK_SUBTITLE,
    {
      subtitle: subtitle ?? "",
    },
  );
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
