// interactions.ts -- the modifiers @expo/ui lacks, which the app's native module registers (`apps/mobile/modules/native-interactions`): the keyboard focus's ring left off a list's row, a bar's subtitle under its title, a list followed by the stack's large title, a list's rows set in from its sides, a view dragged out as its link, pictures or a link dropped on a view, a view's VoiceOver Actions, and a row's long press menu and swipes built from data.

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
  STACK_SCROLL_EDGE: "vespinStackScrollEdge",
  SIDE_MARGINS: "vespinSideMargins",
  DRAG_LINK: "vespinDragLink",
  DROP_PICTURES: "vespinDropPictures",
  DROP_LINK: "vespinDropLink",
  HEARD_ACTS: "vespinHeardActs",
  ROW_MENU: "vespinRowMenu",
  ROW_SWIPES: "vespinRowSwipes",
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
export function barSubtitle(
  bar: BarKind,
  subtitle: string | undefined,
  leading = false,
): ModifierConfig {
  return createModifier(
    bar === BAR_KIND.COLUMN ? MODIFIER.COLUMN_SUBTITLE : MODIFIER.STACK_SUBTITLE,
    { subtitle: subtitle ?? "", leading },
  );
}

/**
 * A list the native stack's bar follows as it scrolls, so a tab root's large
 * title collapses into the bar as Mail's does, which UIKit never finds on
 * its own inside a hosting controller. Note that it acts only under a stack
 * bar standing a large title, so every list may carry it, a pushed page's
 * and a split view's column standing as before.
 */
export function stackScrollEdge(): ModifierConfig {
  return createModifier(MODIFIER.STACK_SCROLL_EDGE, {});
}

/** A scroll view's content set in from its sides by `length` points, SwiftUI's `contentMargins` for its scroll content, while the scroll view keeps its whole width, so the ground beside the content still scrolls it. */
export function sideMargins(length: number): ModifierConfig {
  return createModifier(MODIFIER.SIDE_MARGINS, { length });
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

/** What a press in a row's menu or on its swipe sends: the item's place, its group or edge's first, then its place in each menu within. */
const PressedPlaceSchema = Schema.Struct({ path: Schema.Array(Schema.Number) });

const decodePressedPlace = Schema.decodeUnknownOption(PressedPlaceSchema);

/** What an Action VoiceOver ran sends: its place among the names the view was given. */
const HeardActSchema = Schema.Struct({ index: Schema.Number });

const decodeHeardAct = Schema.decodeUnknownOption(HeardActSchema);

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

/**
 * A view's VoiceOver Actions, the rotor's list a person flicks through, each
 * by its name, in order: the press of the one VoiceOver ran is handed on to
 * it. Note that they stand as the view's own `accessibilityActions`, so a
 * view that ignores its children's accessibility offers these and no others.
 */
export function heardActions(
  acts: readonly { readonly name: string; readonly onPress: () => void }[],
): ModifierConfig {
  return createModifierWithEventListener(
    MODIFIER.HEARD_ACTS,
    flow(
      decodeHeardAct,
      Option.map(({ index }) => acts[index]?.onPress()),
    ),
    { names: acts.map((act) => act.name) },
  );
}

/**
 * A row's long press menu, SwiftUI's own, which the native module builds from
 * `menu`, the row's menu tree as JSON (`menuTree`, and its preview's,
 * `previewTree`, where `previewed`), only as a long press opens it, so a row holds no view of
 * an item or a preview nobody opened. A press hands on the place of the item
 * pressed (`menuPressAt`). Note that it stands on the row's content inside
 * its frame, so the menu lifts the row's words as the system's own does.
 */
export function rowMenu(
  menu: string,
  previewed: boolean,
  onPress: (path: readonly number[]) => void,
): ModifierConfig {
  return createModifierWithEventListener(
    MODIFIER.ROW_MENU,
    flow(
      decodePressedPlace,
      Option.map(({ path }) => onPress(path)),
    ),
    { menu, previewed },
  );
}

/**
 * A row's swipes from either edge, SwiftUI's own swipe actions, which the
 * native module builds from `swipes`, the trees of both edges as JSON
 * (`swipeTree`): a press hands on the place of the item pressed, its edge's
 * first, trailing then leading. Note that it stands on the row's frame, the
 * list's row itself, since a list reads swipes off its row alone.
 */
export function rowSwipes(
  swipes: string,
  onPress: (path: readonly number[]) => void,
): ModifierConfig {
  return createModifierWithEventListener(
    MODIFIER.ROW_SWIPES,
    flow(
      decodePressedPlace,
      Option.map(({ path }) => onPress(path)),
    ),
    { swipes },
  );
}
