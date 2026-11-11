// interactions.ts -- the modifiers @expo/ui lacks, which the app's native module registers (`apps/mobile/modules/native-interactions`): an iPad pointer's hover effect, a view dragged out as its link, and pictures or a link dropped on a view.

import {
  createModifier,
  createModifierWithEventListener,
  type ModifierConfig,
} from "@expo/ui/swift-ui/modifiers";
import { isRecord, isWireNumber, isWireString, type UnparsedWireValue } from "@repo/wire";

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

/** What a drop of pictures carries: the addresses of the files it kept, in the order they were dropped, and how many it could not keep, read off the native event. */
function droppedPictures(event: UnparsedWireValue): {
  uris: readonly string[];
  unreadable: number;
} {
  if (!isRecord(event)) return { uris: [], unreadable: 0 };
  const uris = Array.isArray(event.uris) ? event.uris.filter(isWireString) : [];
  const dropped = isWireNumber(event.dropped) ? event.dropped : uris.length;
  return { uris, unreadable: Math.max(0, dropped - uris.length) };
}

/** Pictures dropped on a view, from Photos, Files, or another app, each kept as a JPEG and handed on by its file's address, with how many could not be kept, so the holder can say so. */
export function dropPictures(
  onDrop: (uris: readonly string[], unreadable: number) => void,
): ModifierConfig {
  return createModifierWithEventListener(MODIFIER.DROP_PICTURES, (event: UnparsedWireValue) => {
    const { uris, unreadable } = droppedPictures(event);
    if (uris.length + unreadable > 0) onDrop(uris, unreadable);
  });
}

/** A link dropped on a view, such as a task's row dragged onto a section, handed on by its address. */
export function dropLink(onDrop: (url: string) => void): ModifierConfig {
  return createModifierWithEventListener(MODIFIER.DROP_LINK, (event: UnparsedWireValue) => {
    if (isRecord(event) && isWireString(event.url)) onDrop(event.url);
  });
}
