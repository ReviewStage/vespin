// StartTaskIntent.swift -- New task from outside the app: Siri, Spotlight, Shortcuts, and the Action button through a shortcut, each opening the app on New task, prefilled with the prompt where one was given, else empty with its field focused; and a second intent Siri asks a prompt for, to dictate the task.
//
// Each intent opens the app and then New task's route (`vespin://start-task`,
// `?prompt=` its words), as the share sheet's draft and the finder's Start a
// task open it, so nothing starts without the member pressing Start there.
// Note that a prompt is the member's own words and nothing else: no
// credential, token, or account ever goes into a parameter or a donation.
// `app.config.ts` builds this file into the app's own target, where iOS
// reads its App Shortcuts from.

import AppIntents
import UIKit

/// New task's route in the app, with `prompt` as its words where there are any.
private func newTaskURL(prompt: String?) -> URL {
  var components = URLComponents()
  components.scheme = "vespin"
  components.host = "start-task"
  let words = prompt?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
  if !words.isEmpty { components.queryItems = [URLQueryItem(name: "prompt", value: words)] }
  return components.url!
}

/// Opens New task in the app, prefilled with `prompt` where one was given.
@MainActor
private func openNewTask(prompt: String?) {
  UIApplication.shared.open(newTaskURL(prompt: prompt))
}

/// Start a task: New task, with an optional prompt, which a shortcut can hand it from anything.
struct StartTaskIntent: AppIntent {
  static let title: LocalizedStringResource = "Start a Task"
  static let description = IntentDescription(
    "Opens New task in Vespin, with the words you give as the agent's prompt.")
  static let openAppWhenRun = true

  @Parameter(title: "Prompt") var prompt: String?

  init() {}

  func perform() async throws -> some IntentResult {
    await openNewTask(prompt: prompt)
    return .result()
  }
}

/// Dictate a task: Siri asks what the agent should do, then opens New task with the words said.
struct DictateTaskIntent: AppIntent {
  static let title: LocalizedStringResource = "Dictate a Task"
  static let description = IntentDescription(
    "Asks what the agent should do, then opens New task in Vespin with your words.")
  static let openAppWhenRun = true

  @Parameter(title: "Prompt", requestValueDialog: "What should the agent do?") var prompt: String

  init() {}

  func perform() async throws -> some IntentResult {
    await openNewTask(prompt: prompt)
    return .result()
  }
}

/// The phrases Siri and Spotlight offer from the moment the app is installed.
struct VespinShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(
      intent: StartTaskIntent(),
      phrases: [
        "Start a task in \(.applicationName)",
        "New \(.applicationName) task",
      ],
      shortTitle: "New Task",
      systemImageName: "square.and.pencil"
    )
    AppShortcut(
      intent: DictateTaskIntent(),
      phrases: [
        "Dictate a task in \(.applicationName)",
        "Tell \(.applicationName) what to do",
      ],
      shortTitle: "Dictate a Task",
      systemImageName: "mic"
    )
  }
}
