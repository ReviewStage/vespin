// NewTaskControl.swift -- New task as a control: in Control Center, on the Lock Screen, and on the Action button, opening the app on New task with its field focused, by Start a task (`app-intents/StartTaskIntent.swift`), which iOS runs in the app's process.

import AppIntents
import SwiftUI
import WidgetKit

struct NewTaskControl: ControlWidget {
  static let kind = "dev.vespin.new-task"

  var body: some ControlWidgetConfiguration {
    StaticControlConfiguration(kind: Self.kind) {
      ControlWidgetButton(action: StartTaskIntent()) {
        Label("New Task", image: "SquarePen")
      }
    }
    .displayName("New Task")
    .description("Opens New task in Vespin.")
  }
}
