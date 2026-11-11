/**
 * menu-commands-module.ts -- the app's native menu bar module (`modules/menu-commands/`) as JavaScript reads it: each command pressed, and what stands in front, told to it.
 *
 * The module is the app's own, autolinked from `modules/`, so it stands in
 * every build of the app. It is optional here all the same, so a build
 * without it, such as Expo Go, runs with no menu bar rather than failing to
 * start.
 */

import type { MenuCommand, MenuSubject } from "@repo/features/ios-menu-commands";
import { type NativeModule, requireOptionalNativeModule } from "expo";

/** What the module hands on, as an event. */
type MenuCommandsEvents = {
  /** A command was pressed in the menu bar or by its keys. */
  readonly onCommand: (event: { readonly command: MenuCommand }) => void;
};

declare class MenuCommandsModule extends NativeModule<MenuCommandsEvents> {
  /** What stands in front: its kind, which names the app's own menu, the commands that may act on it, and those that read toggled, every other command disabled. */
  setState(
    subject: MenuSubject,
    enabled: readonly MenuCommand[],
    toggled: readonly MenuCommand[],
  ): void;
}

/** The module, or none in a build that lacks it. */
export const menuCommandsModule = requireOptionalNativeModule<MenuCommandsModule>("MenuCommands");
