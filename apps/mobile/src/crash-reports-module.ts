/**
 * crash-reports-module.ts -- the app's crash reports module (`modules/crash-reports/`) as JavaScript reads it: whether this device shares usage data, as last kept where Sentry's native start reads it as the app launches.
 *
 * The module is the app's own, autolinked from `modules/`, so it stands in
 * every build of the app, and is required here as Expo's local modules are.
 */

import { type NativeModule, requireNativeModule } from "expo";

declare class CrashReportsModule extends NativeModule {
  /** Whether this device shares usage data, as last kept; on where nothing is kept yet, as the switch is by default. */
  sharesUsageData(): boolean;
  /** Keeps whether this device shares usage data, for the next launch's native start to read. */
  keepSharesUsageData(shares: boolean): void;
}

/** The module. */
export const crashReportsModule = requireNativeModule<CrashReportsModule>("CrashReports");
