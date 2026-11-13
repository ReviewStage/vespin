// MenuBar.swift -- the iPad's menu bar: Vespin's commands placed in the system's menus in the HIG's order, each enabled as JavaScript says, and the press of one handed on to it.
//
// The menu is configured once, as the app finishes launching
// (`MenuCommandsAppDelegate`), through iPadOS 26's main menu system, and
// rebuilt each time JavaScript says what stands in front
// (`MenuCommandsModule`'s `setState`), so a command is disabled while
// nothing it acts on is focused and never hidden, and a toggle reads as what
// it would do (Mark as Read or Mark as Unread, Pin or Unpin). Every command
// is a key command whose action is one method on `UIApplication`, the end of
// the responder chain, which posts its id for the module to send to
// JavaScript, Show or Hide Sidebar among them, since the split views' first
// column is JavaScript's to stand (`sidebar-shown.ts`). Note that the words
// are the menu bar's, in the title case every Mac and iPad menu is set in
// (`docs/DESIGN.md`).

import UIKit

/// What a command's id is posted under, for the module to send on.
let menuCommandPosted = Notification.Name("dev.vespin.menu-commands.command")

/// The menu each command of Vespin's own stands in.
private enum Place {
  case application, file, view, sidebar, subject, remind, help
}

/// One of Vespin's commands: its id, which JavaScript routes it by, and how the menu draws it.
private struct Command {
  let id: String
  let place: Place
  let title: String
  /// What it reads as while JavaScript says it is toggled: Mark as Read on an unread thread, Unpin on a pinned task.
  var toggledTitle: String? = nil
  /// The glyph it leads with, the panel's own Lucide symbol from the asset catalog; none where the panel draws none.
  let symbol: String?
  var toggledSymbol: String? = nil
  var input: String? = nil
  var modifiers: UIKeyModifierFlags = .command
  /// A command whose act cannot be taken back with another press, which holding its keys never repeats.
  var nonRepeatable = false
}

/// A glyph by its name: the asset catalog's symbol of that name, as the app's Lucide glyphs are, else an SF Symbol's.
/// Note that the catalog is asked first, because every name here but Expand Page's pair is a Lucide one, and a system lookup should never stand in for it; that pair is iOS's own, as Mail draws it.
private func glyph(_ name: String?) -> UIImage? {
  guard let name else { return nil }
  return UIImage(named: name) ?? UIImage(systemName: name)
}

/// What a command takes no key for: one pressed rarely, or one inside a submenu.
private let noKey: String? = nil

private let commands: [Command] = [
  Command(
    id: "settings", place: .application, title: "Vespin Settings…", symbol: "Settings",
    input: ",", nonRepeatable: true),
  Command(
    id: "signOut", place: .application, title: "Sign Out…",
    symbol: "LogOut", input: noKey, nonRepeatable: true),
  Command(
    id: "newTask", place: .file, title: "New Task", symbol: "SquarePen", input: "n",
    nonRepeatable: true),
  Command(
    id: "newAgent", place: .file, title: "New Agent", symbol: "Plus", input: "n",
    modifiers: [.command, .shift], nonRepeatable: true),
  Command(id: "inbox", place: .view, title: "Inbox", symbol: "Inbox", input: "1"),
  Command(id: "tasks", place: .view, title: "Tasks", symbol: "ListTodo", input: "2"),
  Command(id: "search", place: .view, title: "Search", symbol: "Search", input: "3"),
  Command(
    id: "sidebar", place: .sidebar, title: "Hide Sidebar", toggledTitle: "Show Sidebar",
    symbol: "PanelLeft", input: "s", modifiers: [.command, .control]),
  Command(
    id: "detailOnly", place: .sidebar, title: "Expand Page", toggledTitle: "Collapse Page",
    symbol: "arrow.up.left.and.arrow.down.right", toggledSymbol: "arrow.down.right.and.arrow.up.left",
    input: "f", modifiers: [.command, .control]),
  Command(
    id: "markDone", place: .subject, title: "Mark Done", symbol: "Check", input: "d",
    modifiers: [.command, .shift], nonRepeatable: true),
  Command(
    id: "resolve", place: .subject, title: "Resolve", symbol: "CircleCheck", input: "a",
    modifiers: [.command, .control], nonRepeatable: true),
  Command(
    id: "stopAgent", place: .subject, title: "Stop", symbol: "CircleStop", input: ".",
    nonRepeatable: true),
  Command(
    id: "toggleRead", place: .subject, title: "Mark as Unread", toggledTitle: "Mark as Read",
    symbol: "Mail", toggledSymbol: "MailOpen", input: "u",
    modifiers: [.command, .shift]),
  Command(
    id: "pin", place: .subject, title: "Pin", toggledTitle: "Unpin", symbol: "Pin",
    toggledSymbol: "PinOff", input: "p", modifiers: [.command, .shift]),
  Command(id: "remindHour", place: .remind, title: "In 1 Hour", symbol: nil),
  Command(id: "remindTomorrow", place: .remind, title: "Tomorrow", symbol: nil),
  Command(id: "remindNextWeek", place: .remind, title: "Next Week", symbol: nil),
  Command(id: "remindClear", place: .remind, title: "Clear Reminder", symbol: "Inbox"),
  Command(
    id: "openInBrowser", place: .subject, title: "Open in Browser", symbol: "ExternalLink", input: "o",
    modifiers: [.command, .alternate]),
  Command(id: "help", place: .help, title: "Vespin Help", symbol: nil),
  Command(id: "feedback", place: .help, title: "Send Feedback", symbol: "MessageSquare"),
]

/// The app's own menu, named for what stands in front, which JavaScript names by its kind.
private let subjectTitles = ["thread": "Thread", "task": "Task", "agent": "Agent"]
private let subjectMenu = UIMenu.Identifier("dev.vespin.menu.subject")
private let settingsGroup = UIMenu.Identifier("dev.vespin.menu.settings")
private let workspacesGroup = UIMenu.Identifier("dev.vespin.menu.workspaces")

/// The id Switch Workspace's items are posted under, beside the workspace's place in the list.
let switchWorkspaceCommand = "switchWorkspace"
/// How many workspaces take a key, ⌥⌘1 through ⌥⌘9; the rest are listed with none.
private let keyedWorkspaces = 9

@MainActor
enum MenuBar {
  /// The ids JavaScript says may act now, and those it says read toggled; none until it first says.
  private static var enabled: Set<String> = []
  private static var toggled: Set<String> = []
  private static var subject = ""
  /// The account's workspaces by name, in the switcher's order, and which is chosen.
  private static var workspaces: [String] = []
  private static var chosenWorkspace = -1

  /// Configures the main menu once, on iPadOS 26 and later, where the system has a menu bar to draw it in.
  static func install() {
    guard #available(iOS 26.0, *) else { return }
    let configuration = UIMainMenuSystem.Configuration()
    configuration.newScenePreference = .removed
    configuration.documentPreference = .removed
    configuration.printingPreference = .removed
    configuration.toolbarPreference = .removed
    configuration.inspectorPreference = .removed
    configuration.textFormattingPreference = .removed
    // Note that the sidebar's item is Vespin's own, since the system's acts on a UIKit split view controller and the split views here are SwiftUI's, standing their first column as JavaScript says.
    configuration.sidebarPreference = .removed
    configuration.findingPreference = .included
    configuration.findingConfiguration.style = .search
    UIMainMenuSystem.shared.setBuildConfiguration(configuration) { builder in
      MainActor.assumeIsolated { build(builder) }
    }
  }

  /// What JavaScript says stands in front: its kind, the commands that may act on it, and those that read toggled.
  static func update(
    subject: String, enabled: [String], toggled: [String], workspaces: [String], chosenWorkspace: Int
  ) {
    self.subject = subject
    self.workspaces = workspaces
    self.chosenWorkspace = chosenWorkspace
    self.enabled = Set(enabled)
    self.toggled = Set(toggled)
    guard #available(iOS 26.0, *) else { return }
    UIMainMenuSystem.shared.setNeedsRebuild()
    UIMainMenuSystem.shared.setNeedsRevalidate()
  }

  /// Words and enables a command as it is shown or pressed, so it reads as what stands in front now rather than when the menu was built.
  static func validate(_ command: UICommand, id: String) {
    guard let known = commands.first(where: { $0.id == id }) else { return }
    let shown = look(of: known)
    command.title = shown.title
    command.image = shown.image
    command.attributes = shown.enabled ? [] : .disabled
  }

  /// Whether a command may act now: one JavaScript said may.
  static func mayAct(_ id: String) -> Bool {
    enabled.contains(id)
  }

  private static func build(_ builder: UIMenuBuilder) {
    // The application menu: About and the system's Settings, then Vespin Settings… on ⌘, and Sign Out.
    let mine = elements(.application)
    let settings = mine.filter { ($0 as? UICommand)?.propertyList as? String == "settings" }
    let system = builder.menu(for: .preferences).map { withoutKeys($0.children) } ?? []
    let settingsMenu = UIMenu(
      identifier: settingsGroup, options: .displayInline, children: system + settings)
    if system.isEmpty {
      builder.insertSibling(settingsMenu, afterMenu: .about)
    } else {
      builder.replace(menu: .preferences, with: settingsMenu)
    }
    builder.insertSibling(
      UIMenu(identifier: workspacesGroup, options: .displayInline, children: [switchWorkspace()]),
      afterMenu: settingsGroup)
    builder.insertSibling(inline(mine.filter { !settings.contains($0) }), afterMenu: workspacesGroup)

    insert(elements(.file), atStartOf: .file, title: "File", after: .application, into: builder)
    insert(
      [inline(elements(.view)), inline(elements(.sidebar))], atStartOf: .view, title: "View",
      after: .edit, into: builder)

    let remind = UIMenu(
      title: "Remind Me", image: glyph("Clock"), children: elements(.remind))
    let subjectCommands = elements(.subject)
    let menu = UIMenu(
      title: subjectTitles[subject] ?? "Task", identifier: subjectMenu,
      children: [inline(Array(subjectCommands.prefix(3))), remind, inline(Array(subjectCommands.dropFirst(3)))])
    builder.insertSibling(showingImages(menu), afterMenu: .view)

    insert(elements(.help), atStartOf: .help, title: "Help", after: .window, into: builder)
  }

  /// Switch Workspace ▸: every workspace of the account's, the chosen one checked, the first nine on ⌥⌘1–9.
  private static func switchWorkspace() -> UIMenu {
    let action = #selector(UIApplication.vespinSwitchWorkspace(_:))
    let items = workspaces.enumerated().map { index, name -> UIMenuElement in
      let item: UICommand =
        index < keyedWorkspaces
        ? UIKeyCommand(
          title: name, action: action, input: String(index + 1), modifierFlags: [.command, .alternate],
          propertyList: index)
        : UICommand(title: name, action: action, propertyList: index)
      lookWorkspace(item, index: index)
      return item
    }
    return showingImages(
      UIMenu(
        title: "Switch Workspace", image: glyph("BuildingComplex"), children: items))
  }

  /// Checks the chosen workspace and enables the list while JavaScript says it may be switched.
  static func lookWorkspace(_ command: UICommand, index: Int) {
    command.state = index == chosenWorkspace ? .on : .off
    command.attributes = enabled.contains(switchWorkspaceCommand) ? [] : .disabled
  }

  /// Whether a workspace may be switched to now.
  static func maySwitchWorkspace(_ index: Int) -> Bool {
    enabled.contains(switchWorkspaceCommand) && workspaces.indices.contains(index)
  }

  /// Puts `children` at the start of a system menu, or in a menu of that name where the system left none.
  private static func insert(
    _ children: [UIMenuElement], atStartOf identifier: UIMenu.Identifier, title: String,
    after sibling: UIMenu.Identifier, into builder: UIMenuBuilder
  ) {
    if builder.menu(for: identifier) != nil {
      builder.insertChild(showingImages(inline(children)), atStartOfMenu: identifier)
    } else {
      builder.insertSibling(
        showingImages(UIMenu(title: title, identifier: identifier, children: children)),
        afterMenu: sibling)
    }
  }

  /// The commands of a place as the menu draws them now.
  private static func elements(_ place: Place) -> [UIMenuElement] {
    commands.filter { $0.place == place }.map(element)
  }

  private static func element(_ command: Command) -> UIMenuElement {
    let shown = look(of: command)
    let action = #selector(UIApplication.vespinMenuCommand(_:))
    let made: UICommand
    if let input = command.input {
      made = UIKeyCommand(
        title: shown.title, image: shown.image, action: action, input: input,
        modifierFlags: command.modifiers, propertyList: command.id)
    } else {
      made = UICommand(
        title: shown.title, image: shown.image, action: action, propertyList: command.id)
    }
    if !shown.enabled { made.attributes = .disabled }
    if command.nonRepeatable, #available(iOS 26.0, *) { made.repeatBehavior = .nonRepeatable }
    return made
  }

  /// How a command reads now: toggled as JavaScript says, and enabled where it may act.
  private static func look(of command: Command) -> (title: String, image: UIImage?, enabled: Bool) {
    let on = toggled.contains(command.id)
    let title = on ? command.toggledTitle ?? command.title : command.title
    let image = glyph(on ? command.toggledSymbol ?? command.symbol : command.symbol)
    return (title, image, mayAct(command.id))
  }

  /// The system's own items with their keys taken off, so ⌘, opens Vespin's Settings rather than the app's page in the Settings app.
  private static func withoutKeys(_ children: [UIMenuElement]) -> [UIMenuElement] {
    children.map { child in
      guard let command = child as? UIKeyCommand, let action = command.action else { return child }
      return UICommand(
        title: command.title, image: command.image, action: action,
        propertyList: command.propertyList, alternates: command.alternates)
    }
  }

  private static func inline(_ children: [UIMenuElement]) -> UIMenu {
    UIMenu(options: .displayInline, children: children)
  }

  /// A menu whose items keep their symbols where iPadOS 27 would hide them.
  private static func showingImages(_ menu: UIMenu) -> UIMenu {
    if #available(iOS 27.0, *) { menu.preferredImageVisibility = .visible }
    return menu
  }
}

extension UIApplication {
  /// The action of every command of Vespin's, which reaches here at the end of the responder chain whatever is focused.
  @objc func vespinMenuCommand(_ sender: UICommand) {
    guard let id = sender.propertyList as? String, MenuBar.mayAct(id) else { return }
    NotificationCenter.default.post(name: menuCommandPosted, object: nil, userInfo: ["command": id])
  }

  /// A workspace picked from Switch Workspace, by its place in the account's list.
  @objc func vespinSwitchWorkspace(_ sender: UICommand) {
    guard let index = sender.propertyList as? Int, MenuBar.maySwitchWorkspace(index) else { return }
    NotificationCenter.default.post(
      name: menuCommandPosted, object: nil,
      userInfo: ["command": switchWorkspaceCommand, "index": index])
  }

  /// Each of Vespin's commands worded and enabled as it is shown or pressed; every other command as UIKit validates it.
  override public func validate(_ command: UICommand) {
    if command.action == #selector(vespinSwitchWorkspace(_:)), let index = command.propertyList as? Int {
      return MenuBar.lookWorkspace(command, index: index)
    }
    guard command.action == #selector(vespinMenuCommand(_:)), let id = command.propertyList as? String
    else { return super.validate(command) }
    MenuBar.validate(command, id: id)
  }

  /// Edit's Search ⌘F, the system's own item in its search style, which opens Search.
  override public func find(_ sender: Any?) {
    NotificationCenter.default.post(
      name: menuCommandPosted, object: nil, userInfo: ["command": "search"])
  }
}
