// MenuCommandsModule.swift -- the iPad menu bar as the app's JavaScript reads it: each command pressed, as an event, and what stands in front, which enables and words the commands.
//
// A command pressed while nothing listens is dropped, since the screens it
// would act on are not drawn yet.

import ExpoModulesCore
import Foundation

public class MenuCommandsModule: Module {
  private var observer: NSObjectProtocol?

  public func definition() -> ModuleDefinition {
    Name("MenuCommands")

    Events("onCommand")

    OnStartObserving("onCommand") {
      self.observer = NotificationCenter.default.addObserver(
        forName: menuCommandPosted, object: nil, queue: .main
      ) { [weak self] note in
        guard let command = note.userInfo?["command"] as? String else { return }
        self?.sendEvent("onCommand", ["command": command])
      }
    }

    OnStopObserving("onCommand") {
      if let observer = self.observer { NotificationCenter.default.removeObserver(observer) }
      self.observer = nil
    }

    // What stands in front: its kind, the commands that may act on it, and those that read toggled.
    Function("setState") { (subject: String, enabled: [String], toggled: [String]) -> Void in
      Task { @MainActor in MenuBar.update(subject: subject, enabled: enabled, toggled: toggled) }
    }
  }
}
