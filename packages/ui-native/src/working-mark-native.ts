// working-mark-native.ts -- the working mark drawn and stepped by SwiftUI (`apps/mobile/modules/native-interactions`'s `WorkingMark.swift`), standing among @expo/ui's views, as JavaScript hands it its look and whether it stands still.

import type { ModifierConfig } from "@expo/ui/swift-ui/modifiers";
import { requireNativeView } from "expo";
import type { ComponentType } from "react";

/** A pixel that moves: a chaser or its tail, with the track cell it rests on. */
interface NativeWorkingDot {
  readonly restsOn: number;
  readonly tail: boolean;
}

/** What the native mark is handed: its ink, its measures in points, the track and the moving pixels, how faint each stands, whether it stands still, and its modifiers. */
interface NativeWorkingMarkProps {
  readonly ink: string;
  readonly side: number;
  readonly cell: number;
  readonly pitch: number;
  readonly inset: number;
  readonly track: readonly (readonly [number, number])[];
  readonly dots: readonly NativeWorkingDot[];
  readonly shades: { readonly track: number; readonly tail: number; readonly lead: number };
  readonly still: boolean;
  readonly modifiers?: ModifierConfig[] | undefined;
}

/** The native working mark. Note that a build whose native module lacks it draws nothing in its place, as a view an older binary does not register. */
export const NativeWorkingMark: ComponentType<NativeWorkingMarkProps> = requireNativeView(
  "NativeInteractions",
  "WorkingMarkView",
);
