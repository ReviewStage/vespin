/**
 * launch-arguments-module.ts -- the app's launch-arguments module (`modules/launch-arguments/`) as JavaScript reads it: the extras of the intent that started the Android app, where Maestro's `launchApp` arguments arrive.
 *
 * The module is the app's own, autolinked from `modules/` on Android alone,
 * so it is required optionally: an iOS build holds none, and reads its
 * arguments from `Settings` instead (`launch-arguments.ts`).
 */

import { type NativeModule, requireOptionalNativeModule } from "expo";

/** A launch argument's value as either platform hands it over: a text, a number, or a truth value. */
export type LaunchExtra = string | number | boolean;

declare class LaunchArgumentsModule extends NativeModule {
  /** The extras of the intent the activity was started with, by key; none before an activity stands. */
  read(): Readonly<Record<string, LaunchExtra>>;
}

const launchArgumentsModule = requireOptionalNativeModule<LaunchArgumentsModule>("LaunchArguments");

/** This launch's extras, read once, since a launch's arguments are its own and never change while it runs; none where the module stands in no build. */
let read: Readonly<Record<string, LaunchExtra>> | undefined;

/** The launch intent's extra named `key`, as it was put; none where the launch named none or the build holds no module. */
export function launchExtra(key: string): LaunchExtra | undefined {
  read ??= launchArgumentsModule?.read() ?? {};

  return read[key];
}
