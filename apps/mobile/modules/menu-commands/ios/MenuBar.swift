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
// JavaScript; Show or Hide Sidebar alone is answered here, on the tab bar
// controller's own sidebar. Note that the words are the menu bar's, in the
// title case every Mac and iPad menu is set in (`docs/DESIGN.md`).

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
  let symbol: String
  var toggledSymbol: String? = nil
  var input: String? = nil
  var modifiers: UIKeyModifierFlags = .command
  /// A command whose act cannot be taken back with another press, which holding its keys never repeats.
  var nonRepeatable = false
}

/// What a command takes no key for: one pressed rarely, or one inside a submenu.
private let noKey: String? = nil

private let commands: [Command] = [
  Command(
    id: "settings", place: .application, title: "Vespin Settings…", symbol: "gearshape",
    input: ","),
  Command(
    id: "signOut", place: .application, title: "Sign Out…",
    symbol: "rectangle.portrait.and.arrow.right", input: noKey, nonRepeatable: true),
  Command(id: "newTask", place: .file, title: "New Task", symbol: "square.and.pencil", input: "n"),
  Command(
    id: "newAgent", place: .file, title: "New Agent", symbol: "plus.bubble", input: "n",
    modifiers: [.command, .shift]),
  Command(id: "inbox", place: .view, title: "Inbox", symbol: "tray", input: "1"),
  Command(id: "tasks", place: .view, title: "Tasks", symbol: "checklist", input: "2"),
  Command(id: "search", place: .view, title: "Search", symbol: "magnifyingglass", input: "3"),
  Command(
    id: "sidebar", place: .sidebar, title: "Hide Sidebar", toggledTitle: "Show Sidebar",
    symbol: "sidebar.left", input: "s", modifiers: [.command, .control]),
  Command(
    id: "markDone", place: .subject, title: "Mark Done", symbol: "checkmark.circle", input: "d",
    modifiers: [.command, .shift], nonRepeatable: true),
  Command(
    id: "toggleRead", place: .subject, title: "Mark as Unread", toggledTitle: "Mark as Read",
    symbol: "envelope.badge", toggledSymbol: "envelope.open", input: "u",
    modifiers: [.command, .shift]),
  Command(
    id: "pin", place: .subject, title: "Pin", toggledTitle: "Unpin", symbol: "pin",
    toggledSymbol: "pin.slash", input: "p", modifiers: [.command, .shift]),
  Command(id: "remindHour", place: .remind, title: "In 1 Hour", symbol: "clock"),
  Command(id: "remindTomorrow", place: .remind, title: "Tomorrow", symbol: "sun.max"),
  Command(id: "remindNextWeek", place: .remind, title: "Next Week", symbol: "calendar"),
  Command(id: "remindClear", place: .remind, title: "Clear Reminder", symbol: "clock.badge.xmark"),
  Command(
    id: "openInBrowser", place: .subject, title: "Open in Browser", symbol: "safari", input: "o",
    modifiers: [.command, .alternate]),
  Command(id: "help", place: .help, title: "Vespin Help", symbol: "questionmark.circle"),
  Command(id: "feedback", place: .help, title: "Send Feedback", symbol: "envelope"),
]

/// The app's own menu, named for what stands in front, which JavaScript names by its kind.
private let subjectTitles = ["thread": "Thread", "task": "Task", "agent": "Agent"]
private let subjectMenu = UIMenu.Identifier("dev.vespin.menu.subject")
private let settingsGroup = UIMenu.Identifier("dev.vespin.menu.settings")

@MainActor
enum MenuBar {
  /// The ids JavaScript says may act now, and those it says read toggled; none until it first says.
  private static var enabled: Set<String> = []
  private static var toggled: Set<String> = []
  private static var subject = ""

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
    // Note that the sidebar's item is Vespin's own, since the system's acts on a split view controller the tab bar's sidebar is not.
    configuration.sidebarPreference = .removed
    configuration.findingPreference = .included
    configuration.findingConfiguration.style = .search
    UIMainMenuSystem.shared.setBuildConfiguration(configuration) { builder in
      MainActor.assumeIsolated { build(builder) }
    }
  }

  /// What JavaScript says stands in front: its kind, the commands that may act on it, and those that read toggled.
  static func update(subject: String, enabled: [String], toggled: [String]) {
    self.subject = subject
    self.enabled = Set(enabled)
    self.toggled = Set(toggled)
    guard #available(iOS 26.0, *) else { return }
    UIMainMenuSystem.shared.setNeedsRebuild()
    UIMainMenuSystem.shared.setNeedsRevalidate()
  }

  /// Shows or hides the tab bar's sidebar, where the window stands one.
  static func toggleSidebar() {
    guard let tabs = sidebarTabs() else { return }
    tabs.sidebar.isHidden.toggle()
  }

  /// Words and enables a command as it is shown or pressed, so it reads as what stands in front now rather than when the menu was built.
  static func validate(_ command: UICommand, id: String) {
    guard let known = commands.first(where: { $0.id == id }) else { return }
    let look = look(of: known)
    command.title = look.title
    command.image = look.image
    command.attributes = look.enabled ? [] : .disabled
  }

  /// Whether a command may act now: one JavaScript said may, or the sidebar's where the window stands one.
  static func mayAct(_ id: String) -> Bool {
    id == "sidebar" ? sidebarTabs() != nil : enabled.contains(id)
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
    builder.insertSibling(inline(mine.filter { !settings.contains($0) }), afterMenu: settingsGroup)

    insert(elements(.file), atStartOf: .file, title: "File", after: .application, into: builder)
    insert(
      [inline(elements(.view)), inline(elements(.sidebar))], atStartOf: .view, title: "View",
      after: .edit, into: builder)

    let remind = UIMenu(
      title: "Remind Me", image: UIImage(systemName: "clock"), children: elements(.remind))
    let subjectCommands = elements(.subject)
    let menu = UIMenu(
      title: subjectTitles[subject] ?? "Task", identifier: subjectMenu,
      children: [inline(Array(subjectCommands.prefix(3))), remind, inline(Array(subjectCommands.dropFirst(3)))])
    builder.insertSibling(showingImages(menu), afterMenu: .view)

    insert(elements(.help), atStartOf: .help, title: "Help", after: .window, into: builder)
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
    let look = look(of: command)
    let action = #selector(UIApplication.vespinMenuCommand(_:))
    let made: UICommand
    if let input = command.input {
      made = UIKeyCommand(
        title: look.title, image: look.image, action: action, input: input,
        modifierFlags: command.modifiers, propertyList: command.id)
    } else {
      made = UICommand(title: look.title, image: look.image, action: action, propertyList: command.id)
    }
    if !look.enabled { made.attributes = .disabled }
    if command.nonRepeatable, #available(iOS 26.0, *) { made.repeatBehavior = .nonRepeatable }
    return made
  }

  /// How a command reads now: toggled as JavaScript says, the sidebar's as the sidebar stands, and enabled where it may act.
  private static func look(of command: Command) -> (title: String, image: UIImage?, enabled: Bool) {
    let on =
      command.id == "sidebar" ? sidebarTabs()?.sidebar.isHidden ?? true : toggled.contains(command.id)
    let title = on ? command.toggledTitle ?? command.title : command.title
    let image = UIImage(systemName: on ? command.toggledSymbol ?? command.symbol : command.symbol)
    return (title, image, mayAct(command.id))
  }

  /// The tab bar controller of the window in front, where it stands a sidebar: a regular window's, never a compact one's bottom bar.
  private static func sidebarTabs() -> UITabBarController? {
    guard let tabs = frontTabs(), tabs.mode != .tabBar,
      tabs.traitCollection.horizontalSizeClass == .regular
    else { return nil }
    return tabs
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

  /// The tab bar controller of the window in front, which stands the app's sidebar.
  private static func frontTabs() -> UITabBarController? {
    let window = UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .filter { $0.activationState == .foregroundActive }
      .flatMap(\.windows)
      .first(where: \.isKeyWindow)
    var stack = [window?.rootViewController].compactMap { $0 }
    while let controller = stack.popLast() {
      if let tabs = controller as? UITabBarController { return tabs }
      stack.append(contentsOf: controller.children)
      if let presented = controller.presentedViewController { stack.append(presented) }
    }
    return nil
  }
}

extension UIApplication {
  /// The action of every command of Vespin's, which reaches here at the end of the responder chain whatever is focused.
  @objc func vespinMenuCommand(_ sender: UICommand) {
    guard let id = sender.propertyList as? String, MenuBar.mayAct(id) else { return }
    if id == "sidebar" {
      MenuBar.toggleSidebar()
      return
    }
    NotificationCenter.default.post(name: menuCommandPosted, object: nil, userInfo: ["command": id])
  }

  /// Each of Vespin's commands worded and enabled as it is shown or pressed; every other command as UIKit validates it.
  override public func validate(_ command: UICommand) {
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
