// CrashReportsModule.swift -- whether this device shares usage data, kept where the app's launch reads it before any JavaScript runs.
//
// Sentry's native half starts as the app launches, before React Native loads,
// so a crash before the JavaScript bundle runs is reported on the next launch
// (`src/crash-reports.ts`). The choice itself lives in the host's settings
// file, which only the JavaScript reads, and only once the bundle runs; so the
// JavaScript keeps a copy of it here, in the app's standard defaults, each
// time it reads it, and the AppDelegate's start reads that copy
// (`withCrashReportsLaunch` in `app.config.ts`). Nothing kept yet, as on a
// first launch, reads as on, as the switch is by default. Note that the start
// itself stays in the AppDelegate, as Sentry's own plugin writes it, since
// only the app's target is handed Sentry's framework search paths.

import ExpoModulesCore
import Foundation

/// The key the choice is kept under in the app's standard defaults.
private let sharesUsageDataKey = "VespinSharesUsageData"

/// What the AppDelegate reads as the app launches.
public enum CrashReportsLaunch {
  /// Whether this device shares usage data, as the JavaScript last kept it; on where nothing is kept yet.
  public static func sharesUsageData() -> Bool {
    UserDefaults.standard.object(forKey: sharesUsageDataKey) as? Bool ?? true
  }
}

public final class CrashReportsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("CrashReports")

    Function("sharesUsageData") { () -> Bool in
      CrashReportsLaunch.sharesUsageData()
    }

    Function("keepSharesUsageData") { (shares: Bool) in
      UserDefaults.standard.set(shares, forKey: sharesUsageDataKey)
    }
  }
}
