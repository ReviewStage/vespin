// MenuCommandsAppDelegate.swift -- configures the iPad's menu bar as the app finishes launching, through Expo's app delegate subscribers.

import ExpoModulesCore
import UIKit

/// Note that the main menu is configured once, as early as UIKit allows, as `UIMainMenuSystem` asks; each later change is a rebuild of it (`MenuBar.update`).
public class MenuCommandsAppDelegate: ExpoAppDelegateSubscriber {
  public func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    MainActor.assumeIsolated { MenuBar.install() }
    return true
  }
}
