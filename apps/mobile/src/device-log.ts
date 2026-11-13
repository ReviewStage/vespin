/**
 * device-log.ts -- a line written to the device's own log through the app's device-log module (`modules/device-log/`), at the error level under `dev.vespin.ios`, where a release build keeps it and a simulator's log capture shows it.
 *
 * React Native's console reaches the device's log only through its own
 * logger, which a flow's log capture has not been seen to show, so a line a
 * flow must read goes through os_log instead. The line is said on the
 * console too, for a debug build's Metro. A build without the module, such
 * as Expo Go, says it on the console alone.
 */

import { type NativeModule, requireOptionalNativeModule } from "expo";

declare class DeviceLogModule extends NativeModule {
  /** Writes `message` to the device's log at the error level. */
  error(message: string): void;
}

const deviceLogModule = requireOptionalNativeModule<DeviceLogModule>("DeviceLog");

/** Writes `message` to the device's log at the error level, and to the console. */
export function deviceLogError(message: string): void {
  deviceLogModule?.error(message);
  console.error(message);
}
