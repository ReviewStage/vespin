// DeviceLogModule.swift -- a line the app writes to the device's own log through os_log, which a release build keeps and a simulator's log capture shows, as React Native's console does not where nothing gathers it.
//
// Each line is written under the app's subsystem, `dev.vespin.ios`, in the
// `app` category, at the error level, its words public so the capture shows
// them rather than `<private>`. It carries what the app chose to say, such
// as which read failed and why, and never a credential.

import ExpoModulesCore
import os

public final class DeviceLogModule: Module {
  /// The app's own log, under its bundle identifier.
  private static let log = Logger(subsystem: "dev.vespin.ios", category: "app")

  public func definition() -> ModuleDefinition {
    Name("DeviceLog")

    // Writes `message` to the device's log at the error level.
    Function("error") { (message: String) in
      Self.log.error("\(message, privacy: .public)")
    }
  }
}
