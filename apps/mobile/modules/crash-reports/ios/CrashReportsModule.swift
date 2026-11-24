// CrashReportsModule.swift -- whether this device shares usage data, kept where the app's launch reads it, and Sentry's native start as the app launches, made only where it does.
//
// Sentry's native half starts as the app launches, before React Native loads,
// so a crash before the JavaScript bundle runs is reported on the next launch
// (`src/crash-reports.ts`). The choice itself lives in the host's settings
// file, which only the JavaScript reads, and only once the bundle runs; so the
// JavaScript keeps a copy of it here, in the app's standard defaults, each
// time it reads it, and the launch reads that copy. Nothing kept yet, as on a
// first launch, reads as on, as the switch is by default.
//
// The start is `RNSentrySDK.start()` from the options file Sentry's config
// plugin copies into the bundle, the start its plugin would write into the
// AppDelegate (`useNativeInit`), made here as an app delegate subscriber
// instead so it can be held to the choice. A build that names no DSN says so
// in its Info.plist (`VespinSentryLaunch`, from `app.config.ts`), since the
// SDK's start faults on an empty DSN.

import ExpoModulesCore
import RNSentry
import UIKit

/// The key the choice is kept under in the app's standard defaults.
private let sharesUsageDataKey = "VespinSharesUsageData"

/// The Info.plist key that says the build names a DSN to start Sentry on.
private let sentryLaunchKey = "VespinSentryLaunch"

/// Whether this device shares usage data, as the JavaScript last kept it; on where nothing is kept yet.
private func sharesUsageData() -> Bool {
  UserDefaults.standard.object(forKey: sharesUsageDataKey) as? Bool ?? true
}

public final class CrashReportsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("CrashReports")

    Function("sharesUsageData") { () -> Bool in
      sharesUsageData()
    }

    Function("keepSharesUsageData") { (shares: Bool) in
      UserDefaults.standard.set(shares, forKey: sharesUsageDataKey)
    }
  }
}

/// Note that the start runs as the app finishes launching, before the bundle does, as the plugin's own start would.
public class CrashReportsAppDelegate: ExpoAppDelegateSubscriber {
  public func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let launches = Bundle.main.object(forInfoDictionaryKey: sentryLaunchKey) as? Bool ?? false

    if launches && sharesUsageData() { RNSentrySDK.start() }
    return true
  }
}
