import AppKit
import ApplicationServices
import Foundation
import ImageIO
import ScreenCaptureKit
import UniformTypeIdentifiers

/// Lets an agent see and use one app on this Mac at a time, without taking
/// the developer's cursor or focus. The app spawns it as its own child, so
/// macOS holds the Screen Recording and Accessibility grants against the app
/// itself, and asks for them in the app's name.
///
/// It reads one JSON request per line on stdin and writes one JSON answer per
/// line on stdout, each answer carrying its request's `id`:
///
/// - `permissions`, `request_permissions`: whether it may capture windows and
///   post input, the second raising macOS's own prompts first.
/// - `list_apps`: the running apps a person uses, each with its icon.
/// - `describe_app {app}`: one app, running or installed, as `list_apps`
///   names each, launching nothing, so the developer can be asked about it.
/// - `get_app_state {app, shots}`: an app's frontmost window as a numbered
///   Accessibility tree and as screenshots, one per requested edge and
///   quality. Its numbers stand until the next `get_app_state` of that app.
/// - `click`, `type_text`, `press_key`, `scroll`, `drag`, `set_value`,
///   `perform_secondary_action`: act on the app by an element's number or by
///   a point in the first screenshot's pixels.
///
/// The agent's own cursor, a small arrow of its own color drawn over the
/// app in a window that takes no clicks, glides to each point an action
/// lands on just before it lands, and fades once the agent rests, so the
/// developer sees where it works without losing their own cursor. It stands
/// in no screenshot, since a read captures the app's window alone.
///
/// Note that input is never posted to the system's event stream: an element
/// is pressed through Accessibility, and a point is clicked by an event posted
/// to the app's own process aimed at its window, so the developer keeps the
/// cursor and whatever app they are typing into. Terminals, password
/// managers, System Settings, the login and security prompts, and the app
/// itself are refused whatever the request says.

private let MAX_ELEMENTS = 600
private let MAX_DEPTH = 40
private let MAX_TEXT = 200
private let ICON_EDGE = 64
private let LAUNCH_WAIT_SECONDS = 8.0
private let LINES_PER_PAGE = 12
private let MAX_CLICKS = 3
private let MAX_PAGES = 20.0

private let REFUSED_BUNDLE_IDS: Set<String> = [
    "com.apple.Terminal",
    "com.googlecode.iterm2",
    "dev.warp.Warp-Stable",
    "com.mitchellh.ghostty",
    "net.kovidgoyal.kitty",
    "org.alacritty",
    "com.github.wez.wezterm",
    "co.zeit.hyper",
    "com.1password.1password",
    "com.agilebits.onepassword7",
    "com.bitwarden.desktop",
    "com.lastpass.LastPass",
    "com.dashlane.Dashlane",
    "com.apple.Passwords",
    "com.apple.keychainaccess",
    "com.apple.systempreferences",
    "com.apple.SecurityAgent",
    "com.apple.loginwindow",
    "com.apple.LocalAuthentication.UIAgent",
]

/// The app's own identifiers, every instance included, which no request may name.
private let REFUSED_BUNDLE_PREFIX = "dev.vespin."

private let ERROR_KIND = (
    badRequest: "bad_request",
    notFound: "not_found",
    refused: "refused",
    noPermission: "no_permission",
    noWindow: "no_window",
    noState: "no_state",
    failed: "failed"
)

private struct HelperError: Error {
    let kind: String
    let message: String
}

// MARK: - Answers

private func write(_ answer: [String: Any]) {
    guard
        let data = try? JSONSerialization.data(withJSONObject: answer, options: [.withoutEscapingSlashes]),
        var line = String(data: data, encoding: .utf8)
    else { return }
    line.append("\n")
    FileHandle.standardOutput.write(Data(line.utf8))
}

private func answered(_ id: Any, _ body: [String: Any]) -> [String: Any] {
    var answer = body
    answer["id"] = id
    answer["ok"] = true
    return answer
}

private func failed(_ id: Any, _ error: HelperError) -> [String: Any] {
    ["id": id, "ok": false, "error": ["kind": error.kind, "message": error.message]]
}

// MARK: - Request fields

private func string(_ request: [String: Any], _ key: String) throws -> String {
    guard let value = request[key] as? String, !value.isEmpty else {
        throw HelperError(kind: ERROR_KIND.badRequest, message: "`\(key)` must be a non-empty string.")
    }
    return value
}

private func number(_ request: [String: Any], _ key: String) -> Double? {
    (request[key] as? NSNumber)?.doubleValue
}

/// A whole number in a request, or nothing where the value is not one a request could mean, so no conversion traps.
private func integer(_ request: [String: Any], _ key: String) -> Int? {
    guard let value = number(request, key), value.isFinite, abs(value) <= Double(Int32.max) else { return nil }
    return Int(exactly: value.rounded())
}

// MARK: - Permissions

private func permissions() -> [String: Any] {
    ["screen_recording": CGPreflightScreenCaptureAccess(), "accessibility": AXIsProcessTrusted()]
}

private func requestPermissions() -> [String: Any] {
    if !CGPreflightScreenCaptureAccess() { _ = CGRequestScreenCaptureAccess() }
    let prompt = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
    _ = AXIsProcessTrustedWithOptions([prompt: true] as CFDictionary)
    return permissions()
}

private func requireAccessibility() throws {
    guard AXIsProcessTrusted() else {
        throw HelperError(
            kind: ERROR_KIND.noPermission,
            message: "Accessibility is not allowed for this app, so it cannot read or use other apps."
        )
    }
}

// MARK: - Apps

/// The app that spawned this helper, which is refused whatever its identifier, as a development build's is.
private let parentBundleId = NSRunningApplication(processIdentifier: getppid())?.bundleIdentifier

private func isRefused(_ bundleId: String?) -> Bool {
    guard let bundleId else { return false }
    return REFUSED_BUNDLE_IDS.contains(bundleId) || bundleId.hasPrefix(REFUSED_BUNDLE_PREFIX)
        || bundleId == parentBundleId
}

private func pngBase64(_ image: NSImage, edge: Int) -> String? {
    guard
        let bitmap = NSBitmapImageRep(
            bitmapDataPlanes: nil, pixelsWide: edge, pixelsHigh: edge, bitsPerSample: 8,
            samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
            bytesPerRow: 0, bitsPerPixel: 0)
    else { return nil }
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
    image.draw(in: NSRect(x: 0, y: 0, width: edge, height: edge))
    NSGraphicsContext.restoreGraphicsState()
    return bitmap.representation(using: .png, properties: [:])?.base64EncodedString()
}

private func describe(_ app: NSRunningApplication) -> [String: Any] {
    var described: [String: Any] = [
        "name": app.localizedName ?? app.bundleIdentifier ?? "App \(app.processIdentifier)",
        "pid": Int(app.processIdentifier),
        "active": app.isActive,
        "refused": isRefused(app.bundleIdentifier),
    ]
    if let bundleId = app.bundleIdentifier { described["bundle_id"] = bundleId }
    if let icon = app.icon, let png = pngBase64(icon, edge: ICON_EDGE) { described["icon_png"] = png }
    return described
}

private func runningApps() -> [NSRunningApplication] {
    NSWorkspace.shared.runningApplications.filter { $0.activationPolicy == .regular && !$0.isTerminated }
}

private func listApps() -> [String: Any] {
    ["apps": runningApps().map(describe)]
}

/// Where an app not yet running is installed, found by its bundle id or by its name in the usual folders.
private func installedURL(_ name: String) -> URL? {
    if let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: name) { return url }
    let folders = ["/Applications", "/System/Applications", "/System/Applications/Utilities",
                   "/Applications/Utilities", "/Applications/Xcode.app/Contents/Developer/Applications"]
    let file = name.hasSuffix(".app") ? name : "\(name).app"
    return folders
        .map { URL(fileURLWithPath: $0).appendingPathComponent(file) }
        .first { FileManager.default.fileExists(atPath: $0.path) }
}

/// Whether `name` names the app, by its bundle id or by its name, with or without its `.app`.
private func namesApp(_ app: NSRunningApplication, _ name: String) -> Bool {
    let lowered = name.lowercased()
    let bare = lowered.hasSuffix(".app") ? String(lowered.dropLast(4)) : lowered
    return app.bundleIdentifier?.lowercased() == lowered || app.localizedName?.lowercased() == bare
}

/// The running app `name` names, or nothing where none runs.
private func runningApp(_ name: String) throws -> NSRunningApplication? {
    let running = runningApps().first { namesApp($0, name) }
    guard let running else { return nil }
    guard !isRefused(running.bundleIdentifier) else {
        throw HelperError(kind: ERROR_KIND.refused, message: "\(name) is never offered to agents.")
    }
    return running
}

/// The running app an action names. Note that an action never launches an app, because its numbers came from a state the app's exit has ended.
private func actedApp(_ request: [String: Any]) throws -> NSRunningApplication {
    let name = try string(request, "app")
    guard let running = try runningApp(name) else {
        throw HelperError(
            kind: ERROR_KIND.noState, message: "\(name) is not running; read it with get_app_state first.")
    }
    return running
}

/// The running app `name` names, launched behind the developer's windows when it is not running.
private func resolveApp(_ name: String) async throws -> NSRunningApplication {
    if let running = try runningApp(name) { return running }
    guard let url = installedURL(name) else {
        throw HelperError(kind: ERROR_KIND.notFound, message: "No app named \(name) is running or installed.")
    }
    guard !isRefused(Bundle(url: url)?.bundleIdentifier) else {
        throw HelperError(kind: ERROR_KIND.refused, message: "\(name) is never offered to agents.")
    }
    let configuration = NSWorkspace.OpenConfiguration()
    // Note that it opens behind, because the developer may be typing into another app.
    configuration.activates = false
    let launched = try await NSWorkspace.shared.openApplication(at: url, configuration: configuration)
    let deadline = Date().addingTimeInterval(LAUNCH_WAIT_SECONDS)
    while Date() < deadline, !launched.isFinishedLaunching {
        try await Task.sleep(nanoseconds: 200_000_000)
    }
    return launched
}

/// One app named, running or installed, as `list_apps` names each, without launching it.
private func describeApp(_ request: [String: Any]) throws -> [String: Any] {
    let name = try string(request, "app")
    if let running = runningApps().first(where: { namesApp($0, name) }) { return ["app": describe(running)] }
    guard let url = installedURL(name) else {
        throw HelperError(kind: ERROR_KIND.notFound, message: "No app named \(name) is running or installed.")
    }
    let bundle = Bundle(url: url)
    var described: [String: Any] = [
        "name": FileManager.default.displayName(atPath: url.path).replacingOccurrences(of: ".app", with: ""),
        "refused": isRefused(bundle?.bundleIdentifier),
    ]
    if let bundleId = bundle?.bundleIdentifier { described["bundle_id"] = bundleId }
    if let png = pngBase64(NSWorkspace.shared.icon(forFile: url.path), edge: ICON_EDGE) { described["icon_png"] = png }
    return ["app": described]
}

// MARK: - Accessibility tree

private func attribute(_ element: AXUIElement, _ name: String) -> AnyObject? {
    var value: AnyObject?
    guard AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success else { return nil }
    return value
}

private func text(_ element: AXUIElement, _ name: String) -> String? {
    let value = attribute(element, name)
    let words: String?
    if let string = value as? String {
        words = string
    } else if let number = value as? NSNumber {
        words = number.stringValue
    } else {
        words = nil
    }
    guard let words, !words.isEmpty else { return nil }
    let flat = words.replacingOccurrences(of: "\n", with: " ")
    return flat.count > MAX_TEXT ? String(flat.prefix(MAX_TEXT)) + "…" : flat
}

private func children(_ element: AXUIElement) -> [AXUIElement] {
    (attribute(element, kAXChildrenAttribute) as? [AXUIElement]) ?? []
}

private func actions(_ element: AXUIElement) -> [String] {
    var names: CFArray?
    guard AXUIElementCopyActionNames(element, &names) == .success else { return [] }
    // Note that an app's own custom actions describe themselves in debug words across lines, so only the system's AX actions are offered.
    return ((names as? [String]) ?? []).filter { $0.hasPrefix("AX") && !$0.contains("\n") }
}

private func isSettable(_ element: AXUIElement) -> Bool {
    var settable = DarwinBoolean(false)
    return AXUIElementIsAttributeSettable(element, kAXValueAttribute as CFString, &settable) == .success
        && settable.boolValue
}

private func frame(_ element: AXUIElement) -> CGRect? {
    guard
        let position = attribute(element, kAXPositionAttribute),
        let size = attribute(element, kAXSizeAttribute)
    else { return nil }
    var point = CGPoint.zero
    var extent = CGSize.zero
    // Note that both reads are checked, because an AXValue of another type leaves the out value untouched.
    guard
        CFGetTypeID(position) == AXValueGetTypeID(), CFGetTypeID(size) == AXValueGetTypeID(),
        AXValueGetValue(position as! AXValue, .cgPoint, &point),
        AXValueGetValue(size as! AXValue, .cgSize, &extent)
    else { return nil }
    return CGRect(origin: point, size: extent)
}

/// Walks a window's tree into numbered lines, leaving out a wrapper that says nothing and holds one child, so the model reads what a person would.
private struct TreeWalk {
    var elements: [AXUIElement] = []
    var lines: [String] = []

    mutating func walk(_ element: AXUIElement, depth: Int) {
        guard elements.count < MAX_ELEMENTS, depth < MAX_DEPTH else { return }
        let role = text(element, kAXRoleAttribute) ?? "AXUnknown"
        let label = text(element, kAXTitleAttribute) ?? text(element, kAXDescriptionAttribute)
        let value = text(element, kAXValueAttribute)
        let pressable = actions(element).filter { $0 != kAXShowMenuAction as String }
        let settable = isSettable(element)
        let kids = children(element)
        let silent = label == nil && value == nil && pressable.isEmpty && !settable
        if silent && kids.count == 1 && (role == kAXGroupRole || role == kAXUnknownRole) {
            walk(kids[0], depth: depth)
            return
        }
        let index = elements.count
        elements.append(element)
        var line = String(repeating: "  ", count: depth) + "[\(index)] \(role)"
        if let subrole = text(element, kAXSubroleAttribute) { line += " (\(subrole))" }
        if let label { line += " \"\(label)\"" }
        if let value, value != label { line += " value=\"\(value)\"" }
        if (attribute(element, kAXEnabledAttribute) as? Bool) == false { line += " disabled" }
        if (attribute(element, kAXFocusedAttribute) as? Bool) == true { line += " focused" }
        if settable { line += " settable" }
        let secondary = pressable.filter { $0 != kAXPressAction as String }
        if !secondary.isEmpty { line += " actions=[\(secondary.joined(separator: ", "))]" }
        lines.append(line)
        for kid in kids { walk(kid, depth: depth + 1) }
    }
}

private func focusedWindow(_ pid: pid_t) -> AXUIElement? {
    let app = AXUIElementCreateApplication(pid)
    if let window = attribute(app, kAXFocusedWindowAttribute), CFGetTypeID(window) == AXUIElementGetTypeID() {
        return (window as! AXUIElement)
    }
    if let window = attribute(app, kAXMainWindowAttribute), CFGetTypeID(window) == AXUIElementGetTypeID() {
        return (window as! AXUIElement)
    }
    return (attribute(app, kAXWindowsAttribute) as? [AXUIElement])?.first
}

// MARK: - Screenshots

private func jpegBase64(_ image: CGImage, edge: Int, quality: Double) -> [String: Any]? {
    let scale = min(1.0, Double(edge) / Double(max(image.width, image.height)))
    let width = max(1, Int((Double(image.width) * scale).rounded()))
    let height = max(1, Int((Double(image.height) * scale).rounded()))
    guard
        let context = CGContext(
            data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
            space: CGColorSpace(name: CGColorSpace.sRGB)!,
            bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)
    else { return nil }
    context.interpolationQuality = .high
    context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
    guard let resized = context.makeImage() else { return nil }
    let data = NSMutableData()
    guard
        let destination = CGImageDestinationCreateWithData(data, UTType.jpeg.identifier as CFString, 1, nil)
    else { return nil }
    CGImageDestinationAddImage(
        destination, resized, [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary)
    guard CGImageDestinationFinalize(destination) else { return nil }
    return ["width": width, "height": height, "jpeg": (data as Data).base64EncodedString()]
}

/// The app's window to capture: the one its focused window is, else its largest on screen.
private func captureWindow(_ pid: pid_t, title: String?) async throws -> SCWindow {
    guard CGPreflightScreenCaptureAccess() else {
        throw HelperError(
            kind: ERROR_KIND.noPermission,
            message: "Screen Recording is not allowed for this app, so it cannot see other apps' windows."
        )
    }
    let content = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: true)
    let windows = content.windows.filter {
        $0.owningApplication?.processID == pid && $0.windowLayer == 0 && $0.frame.width > 1
    }
    if let title, let titled = windows.first(where: { $0.title == title }) { return titled }
    guard let largest = windows.max(by: { $0.frame.width * $0.frame.height < $1.frame.width * $1.frame.height })
    else {
        throw HelperError(kind: ERROR_KIND.noWindow, message: "The app has no window on screen to look at.")
    }
    return largest
}

private func capture(_ window: SCWindow) async throws -> CGImage {
    let filter = SCContentFilter(desktopIndependentWindow: window)
    let configuration = SCStreamConfiguration()
    let scale = CGFloat(filter.pointPixelScale)
    configuration.width = Int(window.frame.width * scale)
    configuration.height = Int(window.frame.height * scale)
    configuration.showsCursor = false
    configuration.ignoreShadowsSingleWindow = true
    return try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: configuration)
}

// MARK: - Sessions

/// What one `get_app_state` left for the actions after it: its numbered elements, and how its first screenshot's pixels map onto the screen.
private struct AppSession {
    let pid: pid_t
    let windowID: CGWindowID
    let windowFrame: CGRect
    let shotSize: CGSize
    let elements: [AXUIElement]

    func point(x: Double, y: Double) -> CGPoint {
        CGPoint(
            x: windowFrame.minX + x * windowFrame.width / shotSize.width,
            y: windowFrame.minY + y * windowFrame.height / shotSize.height)
    }

    func element(_ index: Int) throws -> AXUIElement {
        guard elements.indices.contains(index) else {
            throw HelperError(
                kind: ERROR_KIND.noState,
                message: "Element \(index) is not in the app's last state; read it again with get_app_state.")
        }
        return elements[index]
    }

    func center(_ index: Int) throws -> CGPoint {
        guard let bounds = frame(try element(index)) else {
            throw HelperError(kind: ERROR_KIND.failed, message: "Element \(index) has no place on screen.")
        }
        return CGPoint(x: bounds.midX, y: bounds.midY)
    }
}

private var sessions: [pid_t: AppSession] = [:]

private func session(_ app: NSRunningApplication) throws -> AppSession {
    guard let found = sessions[app.processIdentifier] else {
        throw HelperError(
            kind: ERROR_KIND.noState, message: "Read the app with get_app_state before acting on it.")
    }
    return found
}

private func getAppState(_ request: [String: Any]) async throws -> [String: Any] {
    try requireAccessibility()
    let app = try await resolveApp(try string(request, "app"))
    let pid = app.processIdentifier
    let axWindow = focusedWindow(pid)
    let title = axWindow.flatMap { text($0, kAXTitleAttribute) }
    let window = try await captureWindow(pid, title: title)
    let image = try await capture(window)
    let asked = (request["shots"] as? [[String: Any]]) ?? [["edge": 1280, "quality": 0.7]]
    let shots = asked.compactMap { shot in
        jpegBase64(
            image, edge: min(max(integer(shot, "edge") ?? 1280, 64), 4096),
            quality: min(max(number(shot, "quality") ?? 0.7, 0.1), 1))
    }
    guard let first = shots.first, let width = first["width"] as? Int, let height = first["height"] as? Int
    else { throw HelperError(kind: ERROR_KIND.failed, message: "The window could not be encoded.") }
    var walk = TreeWalk()
    if let axWindow { walk.walk(axWindow, depth: 0) }
    sessions[pid] = AppSession(
        pid: pid, windowID: window.windowID, windowFrame: window.frame,
        shotSize: CGSize(width: width, height: height), elements: walk.elements)
    return [
        "app": describe(app),
        "window": [
            "title": window.title ?? title ?? "",
            "x": window.frame.minX, "y": window.frame.minY,
            "width": window.frame.width, "height": window.frame.height,
        ],
        "elements": walk.lines.joined(separator: "\n"),
        "truncated": walk.elements.count >= MAX_ELEMENTS,
        "shots": shots,
    ]
}

// MARK: - The agent's cursor

/// How long the cursor takes to glide to a point, and how long it rests there before the action lands.
private let CURSOR_GLIDE_SECONDS = 0.25
/// How long the cursor stands after the agent's last action before it fades.
private let CURSOR_REST_SECONDS = 2.5
/// The cursor's box, and where in it the arrow's tip stands.
private let CURSOR_BOX = CGSize(width: 36, height: 36)
private let CURSOR_TIP = CGPoint(x: 8, y: 6)

/// The arrow the agent's cursor draws: the system's shape, in a color of its own, ringed so it reads on any window.
private final class AgentCursorView: NSView {
    override func draw(_ dirtyRect: NSRect) {
        let tip = CGPoint(x: CURSOR_TIP.x, y: bounds.height - CURSOR_TIP.y)
        let halo = NSBezierPath(ovalIn: NSRect(x: tip.x - 6, y: tip.y - 26, width: 26, height: 26))
        NSColor.systemPurple.withAlphaComponent(0.18).setFill()
        halo.fill()
        let arrow = NSBezierPath()
        arrow.move(to: tip)
        arrow.line(to: CGPoint(x: tip.x, y: tip.y - 20))
        arrow.line(to: CGPoint(x: tip.x + 5, y: tip.y - 15))
        arrow.line(to: CGPoint(x: tip.x + 9, y: tip.y - 23))
        arrow.line(to: CGPoint(x: tip.x + 12, y: tip.y - 21.5))
        arrow.line(to: CGPoint(x: tip.x + 8, y: tip.y - 14))
        arrow.line(to: CGPoint(x: tip.x + 14, y: tip.y - 14))
        arrow.close()
        NSColor.systemPurple.setFill()
        arrow.fill()
        NSColor.white.setStroke()
        arrow.lineWidth = 1.5
        arrow.stroke()
    }
}

/// The window the agent's cursor stands in: borderless, clear, over every app, taking no clicks, on every space.
@MainActor
private final class AgentCursor {
    private var panel: NSPanel?
    private var fade: Task<Void, Never>?

    private func made() -> NSPanel {
        if let panel { return panel }
        let made = NSPanel(
            contentRect: NSRect(origin: .zero, size: CURSOR_BOX), styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered, defer: false)
        made.isOpaque = false
        made.backgroundColor = .clear
        made.hasShadow = false
        made.ignoresMouseEvents = true
        made.level = .statusBar
        made.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle, .fullScreenAuxiliary]
        made.contentView = AgentCursorView(frame: NSRect(origin: .zero, size: CURSOR_BOX))
        panel = made
        return made
    }

    /// The cursor glided to a point on the screen, in the window server's coordinates, its top left the main display's.
    func glide(to point: CGPoint) {
        let panel = made()
        let height = NSScreen.screens.first?.frame.height ?? 0
        let origin = CGPoint(x: point.x - CURSOR_TIP.x, y: height - point.y - CURSOR_BOX.height + CURSOR_TIP.y)
        fade?.cancel()
        if !panel.isVisible || panel.alphaValue < 1 {
            panel.setFrameOrigin(origin)
            panel.alphaValue = 1
            panel.orderFrontRegardless()
        } else {
            NSAnimationContext.runAnimationGroup { context in
                context.duration = CURSOR_GLIDE_SECONDS
                panel.animator().setFrameOrigin(origin)
            }
        }
        fade = Task { @MainActor in
            try? await Task.sleep(nanoseconds: UInt64(CURSOR_REST_SECONDS * 1_000_000_000))
            guard !Task.isCancelled else { return }
            // Note that the completion is named, because inside a task the bare form is the one that awaits.
            NSAnimationContext.runAnimationGroup({ context in
                context.duration = CURSOR_GLIDE_SECONDS
                panel.animator().alphaValue = 0
            }, completionHandler: nil)
        }
    }
}

@MainActor private let agentCursor = AgentCursor()

/// The agent's cursor glided to `point`, and a moment let pass so it has arrived as the action lands.
private func cursorTo(_ point: CGPoint) async {
    await MainActor.run { agentCursor.glide(to: point) }
    try? await Task.sleep(nanoseconds: UInt64(CURSOR_GLIDE_SECONDS * 1_000_000_000))
}

// MARK: - Input

private let BUTTON = (left: "left", right: "right", middle: "middle")

private func mouseTypes(_ button: String) -> (down: CGEventType, up: CGEventType, drag: CGEventType, button: CGMouseButton) {
    switch button {
    case BUTTON.right: return (.rightMouseDown, .rightMouseUp, .rightMouseDragged, .right)
    case BUTTON.middle: return (.otherMouseDown, .otherMouseUp, .otherMouseDragged, .center)
    default: return (.leftMouseDown, .leftMouseUp, .leftMouseDragged, .left)
    }
}

// Note that these are the window fields a window server event carries, which aim it at one window rather than whatever lies under the point.
private let WINDOW_UNDER_POINTER = CGEventField(rawValue: 91)!
private let WINDOW_THAT_HANDLES = CGEventField(rawValue: 92)!

/// Sets where in its window an event lands. Note that this is the window server's own call, exported by CoreGraphics but not declared in its headers, and that an app in the background drops a mouse event posted to it without it.
@_silgen_name("CGEventSetWindowLocation")
private func setWindowLocation(_ event: CGEvent, _ point: CGPoint)

private func post(_ event: CGEvent?, to session: AppSession) {
    guard let event else { return }
    event.setIntegerValueField(WINDOW_UNDER_POINTER, value: Int64(session.windowID))
    event.setIntegerValueField(WINDOW_THAT_HANDLES, value: Int64(session.windowID))
    let global = event.location
    setWindowLocation(event, CGPoint(x: global.x - session.windowFrame.minX, y: global.y - session.windowFrame.minY))
    event.postToPid(session.pid)
}

private let source = CGEventSource(stateID: .privateState)

private func appKitType(_ type: CGEventType) -> NSEvent.EventType {
    switch type {
    case .leftMouseDown: return .leftMouseDown
    case .leftMouseUp: return .leftMouseUp
    case .rightMouseDown: return .rightMouseDown
    case .rightMouseUp: return .rightMouseUp
    case .otherMouseDown: return .otherMouseDown
    case .otherMouseUp: return .otherMouseUp
    case .leftMouseDragged: return .leftMouseDragged
    case .rightMouseDragged: return .rightMouseDragged
    default: return .otherMouseDragged
    }
}

private var eventNumber = 0

/// A mouse event as AppKit builds one for a window: aimed at the window by its number, at a point in its own coordinates.
private func mouseEvent(_ type: CGEventType, at point: CGPoint, session: AppSession, clicks: Int) -> CGEvent? {
    eventNumber += 1
    let frame = session.windowFrame
    let inWindow = NSPoint(x: point.x - frame.minX, y: frame.height - (point.y - frame.minY))
    let event = NSEvent.mouseEvent(
        with: appKitType(type), location: inWindow, modifierFlags: [],
        timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: Int(session.windowID), context: nil,
        eventNumber: eventNumber, clickCount: clicks, pressure: type == .leftMouseUp ? 0 : 1)?.cgEvent
    event?.location = point
    return event
}

private func clickPoint(_ point: CGPoint, session: AppSession, button: String, count: Int) {
    let types = mouseTypes(button)
    for click in 1...max(1, count) {
        for type in [types.down, types.up] {
            let event = mouseEvent(type, at: point, session: session, clicks: click)
            event?.setIntegerValueField(.mouseEventClickState, value: Int64(click))
            post(event, to: session)
        }
    }
}

private func click(_ request: [String: Any]) async throws -> [String: Any] {
    try requireAccessibility()
    let app = try actedApp(request)
    let current = try session(app)
    let button = (request["mouse_button"] as? String) ?? BUTTON.left
    let count = min(max(integer(request, "click_count") ?? 1, 1), MAX_CLICKS)
    if let index = integer(request, "element_index") {
        let element = try current.element(index)
        if let center = try? current.center(index) { await cursorTo(center) }
        // Note that a plain press goes through Accessibility, which needs no point and no focus, before an event is aimed at the element's center.
        if button == BUTTON.left, count == 1,
           AXUIElementPerformAction(element, kAXPressAction as CFString) == .success {
            return ["done": "pressed"]
        }
        clickPoint(try current.center(index), session: current, button: button, count: count)
        return ["done": "clicked"]
    }
    guard let x = number(request, "x"), let y = number(request, "y") else {
        throw HelperError(kind: ERROR_KIND.badRequest, message: "Give an element_index, or x and y.")
    }
    let point = current.point(x: x, y: y)
    await cursorTo(point)
    clickPoint(point, session: current, button: button, count: count)
    return ["done": "clicked"]
}

private func typeText(_ request: [String: Any]) async throws -> [String: Any] {
    try requireAccessibility()
    let app = try actedApp(request)
    let current = try session(app)
    let words = try string(request, "text")
    for character in words {
        let units = Array(String(character).utf16)
        for down in [true, false] {
            let event = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: down)
            event?.keyboardSetUnicodeString(stringLength: units.count, unicodeString: units)
            post(event, to: current)
        }
    }
    return ["done": "typed"]
}

private let KEY_CODES: [String: CGKeyCode] = [
    "a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7, "c": 8, "v": 9, "b": 11,
    "q": 12, "w": 13, "e": 14, "r": 15, "y": 16, "t": 17, "1": 18, "2": 19, "3": 20, "4": 21,
    "6": 22, "5": 23, "=": 24, "9": 25, "7": 26, "-": 27, "8": 28, "0": 29, "]": 30, "o": 31,
    "u": 32, "[": 33, "i": 34, "p": 35, "l": 37, "j": 38, "'": 39, "k": 40, ";": 41, "\\": 42,
    ",": 43, "/": 44, "n": 45, "m": 46, ".": 47, "`": 50,
    "return": 36, "enter": 36, "kp_enter": 76, "tab": 48, "space": 49, "backspace": 51,
    "delete": 117, "escape": 53, "esc": 53, "left": 123, "right": 124, "down": 125, "up": 126,
    "home": 115, "end": 119, "page_up": 116, "prior": 116, "page_down": 121, "next": 121,
    "f1": 122, "f2": 120, "f3": 99, "f4": 118, "f5": 96, "f6": 97, "f7": 98, "f8": 100,
    "f9": 101, "f10": 109, "f11": 103, "f12": 111,
]

private let MODIFIER_FLAGS: [String: CGEventFlags] = [
    "super": .maskCommand, "cmd": .maskCommand, "command": .maskCommand, "meta": .maskCommand,
    "ctrl": .maskControl, "control": .maskControl,
    "alt": .maskAlternate, "option": .maskAlternate,
    "shift": .maskShift, "fn": .maskSecondaryFn,
]

/// Reads an xdotool-style chord, such as `super+c`, `shift+Tab`, or `Return`, into a key and its modifiers.
private func chord(_ name: String) throws -> (key: CGKeyCode, flags: CGEventFlags) {
    var parts = name.split(separator: "+").map { $0.lowercased() }
    guard let last = parts.popLast(), let key = KEY_CODES[last] else {
        throw HelperError(kind: ERROR_KIND.badRequest, message: "\(name) is not a key this helper knows.")
    }
    var flags: CGEventFlags = []
    for part in parts {
        guard let flag = MODIFIER_FLAGS[part] else {
            throw HelperError(kind: ERROR_KIND.badRequest, message: "\(part) is not a modifier this helper knows.")
        }
        flags.insert(flag)
    }
    return (key, flags)
}

private func pressKey(_ request: [String: Any]) async throws -> [String: Any] {
    try requireAccessibility()
    let app = try actedApp(request)
    let current = try session(app)
    let pressed = try chord(try string(request, "key"))
    for down in [true, false] {
        let event = CGEvent(keyboardEventSource: source, virtualKey: pressed.key, keyDown: down)
        event?.flags = pressed.flags
        post(event, to: current)
    }
    return ["done": "pressed"]
}

private let DIRECTION = (up: "up", down: "down", left: "left", right: "right")

private func scroll(_ request: [String: Any]) async throws -> [String: Any] {
    try requireAccessibility()
    let app = try actedApp(request)
    let current = try session(app)
    let index = integer(request, "element_index")
    let point: CGPoint
    if let index {
        point = try current.center(index)
    } else {
        point = CGPoint(x: current.windowFrame.midX, y: current.windowFrame.midY)
    }
    let direction = (request["direction"] as? String) ?? DIRECTION.down
    let pages = min(max(number(request, "pages") ?? 1, 0), MAX_PAGES)
    let lines = Int32(max(1, (pages.isFinite ? pages : 1) * Double(LINES_PER_PAGE)))
    let vertical: Int32 = direction == DIRECTION.up ? lines : direction == DIRECTION.down ? -lines : 0
    let horizontal: Int32 = direction == DIRECTION.left ? lines : direction == DIRECTION.right ? -lines : 0
    await cursorTo(point)
    let event = CGEvent(
        scrollWheelEvent2Source: source, units: .line, wheelCount: 2, wheel1: vertical, wheel2: horizontal,
        wheel3: 0)
    event?.location = point
    post(event, to: current)
    return ["done": "scrolled"]
}

private func drag(_ request: [String: Any]) async throws -> [String: Any] {
    try requireAccessibility()
    let app = try actedApp(request)
    let current = try session(app)
    guard
        let fromX = number(request, "from_x"), let fromY = number(request, "from_y"),
        let toX = number(request, "to_x"), let toY = number(request, "to_y")
    else { throw HelperError(kind: ERROR_KIND.badRequest, message: "Give from_x, from_y, to_x, and to_y.") }
    let from = current.point(x: fromX, y: fromY)
    let to = current.point(x: toX, y: toY)
    let types = mouseTypes(BUTTON.left)
    await cursorTo(from)
    post(mouseEvent(types.down, at: from, session: current, clicks: 1), to: current)
    let steps = 12
    for step in 1...steps {
        let along = Double(step) / Double(steps)
        let point = CGPoint(x: from.x + (to.x - from.x) * along, y: from.y + (to.y - from.y) * along)
        await MainActor.run { agentCursor.glide(to: point) }
        post(mouseEvent(types.drag, at: point, session: current, clicks: 1), to: current)
        try await Task.sleep(nanoseconds: 10_000_000)
    }
    post(mouseEvent(types.up, at: to, session: current, clicks: 1), to: current)
    return ["done": "dragged"]
}

private func setValue(_ request: [String: Any]) async throws -> [String: Any] {
    try requireAccessibility()
    let app = try actedApp(request)
    let element = try session(app).element(integer(request, "element_index") ?? -1)
    let value = (request["value"] as? String) ?? ""
    let result = AXUIElementSetAttributeValue(element, kAXValueAttribute as CFString, value as CFString)
    guard result == .success else {
        throw HelperError(kind: ERROR_KIND.failed, message: "The element did not take the value (\(result.rawValue)).")
    }
    return ["done": "set"]
}

private func performSecondaryAction(_ request: [String: Any]) async throws -> [String: Any] {
    try requireAccessibility()
    let app = try actedApp(request)
    let element = try session(app).element(integer(request, "element_index") ?? -1)
    let action = try string(request, "action")
    guard actions(element).contains(action) else {
        throw HelperError(kind: ERROR_KIND.badRequest, message: "The element offers no \(action) action.")
    }
    let result = AXUIElementPerformAction(element, action as CFString)
    guard result == .success else {
        throw HelperError(kind: ERROR_KIND.failed, message: "The element refused \(action) (\(result.rawValue)).")
    }
    return ["done": "performed"]
}

// MARK: - Entry

private let OPERATIONS: [String: ([String: Any]) async throws -> [String: Any]] = [
    "permissions": { _ in permissions() },
    "request_permissions": { _ in requestPermissions() },
    "list_apps": { _ in listApps() },
    "describe_app": describeApp,
    "get_app_state": getAppState,
    "click": click,
    "type_text": typeText,
    "press_key": pressKey,
    "scroll": scroll,
    "drag": drag,
    "set_value": setValue,
    "perform_secondary_action": performSecondaryAction,
]

private func handle(_ line: String) async -> [String: Any] {
    guard
        let data = line.data(using: .utf8),
        let request = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    else { return failed(NSNull(), HelperError(kind: ERROR_KIND.badRequest, message: "The line is not a JSON object.")) }
    let id = request["id"] ?? NSNull()
    guard let op = request["op"] as? String, let operation = OPERATIONS[op] else {
        return failed(id, HelperError(kind: ERROR_KIND.badRequest, message: "Unknown op."))
    }
    do {
        return answered(id, try await operation(request))
    } catch let error as HelperError {
        return failed(id, error)
    } catch {
        return failed(id, HelperError(kind: ERROR_KIND.failed, message: error.localizedDescription))
    }
}

@main
struct ComputerUse {
    static func main() {
        // Note that the shared application opens the window server connection that launching an app, capturing a window, and drawing the agent's cursor need; as an accessory it stands in neither the Dock nor the app switcher.
        let app = NSApplication.shared
        app.setActivationPolicy(.accessory)
        // Note that requests are read on a thread of their own and answered one at a time, in order, because an action reads the state the read before it left, while the main thread runs the cursor's window; stdin closing, as the app quits, ends the helper.
        Thread.detachNewThread {
            while let line = readLine(strippingNewline: true) {
                if line.trimmingCharacters(in: .whitespaces).isEmpty { continue }
                let answered = DispatchSemaphore(value: 0)
                Task {
                    write(await handle(line))
                    answered.signal()
                }
                answered.wait()
            }
            exit(0)
        }
        app.run()
    }
}
