import AppKit
import ApplicationServices
import AVFoundation
import CoreMedia
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
///   post input, the second raising macOS's own prompts first and opening the
///   System Settings pane of the first grant still missing.
/// - `list_apps`: the running apps a person uses, each with its icon.
/// - `list_installed_apps`: the apps installed in the usual folders, by name
///   and bundle id, without icons, which `describe_app` draws one at a time.
/// - `describe_app {app}`: one app, running or installed, as `list_apps`
///   names each, launching nothing, so the developer can be asked about it.
/// - `get_app_state {app, shots}`: an app's frontmost window as a numbered
///   Accessibility tree and as screenshots, one per requested edge and
///   quality. Its numbers stand until the next `get_app_state` of that app.
/// - `click`, `type_text`, `press_key`, `scroll`, `drag`, `set_value`,
///   `perform_secondary_action`: act on the app by an element's number or by
///   a point in the first screenshot's pixels.
/// - `record {app, max_seconds, max_bytes}`: starts recording the app's
///   window as an H.264 MP4, the agent's cursor drawn over it, until
///   `stop_recording` or `max_seconds`, whichever comes first.
/// - `stop_recording`: stops it, makes it fit `max_bytes`, and answers its
///   length, size, and bytes; asked again, it answers the same recording
///   until the next one starts.
///
/// A read or an action may pin its app to the one the developer allowed,
/// by `pin_bundle_id`, or by `pin_pid` for an app with no bundle id, and is
/// refused where the app it finds no longer matches.
///
/// The agent's own cursor, the browser's pointer drawn over the app in a
/// window that takes no clicks, glides to each point an action
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
/// How many ancestors up the agent's cursor looks for a place to stand where an element has none.
private let MAX_CURSOR_ANCESTORS = 4
private let MAX_PAGES = 20.0
/// The most base64 characters of one screenshot, as the wire bounds it (`COMPUTER_BOUNDS.MAX_SHOT_CHARS`).
private let MAX_SHOT_CHARS = 1_600_000
/// The smallest edge a screenshot steps down to, as the wire bounds it (`COMPUTER_BOUNDS.MIN_SHOT_EDGE`).
private let MIN_SHOT_EDGE = 64
/// The quality a screenshot past the bound steps down by, to the least it steps to before it is made smaller instead.
private let SHOT_QUALITY_STEP = 0.15
private let MIN_SHOT_QUALITY = 0.4
/// How much smaller each step makes a screenshot still past the bound at the least quality.
private let SHOT_EDGE_STEP = 0.8

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
    failed: "failed",
    recordingNone: "recording_none",
    recordingRunning: "recording_running",
    recordingEmpty: "recording_empty",
    recordingEncoder: "recording_encoder",
    recordingTooLarge: "recording_too_large"
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

/// The Privacy & Security panes of System Settings where each grant is switched on.
private let SCREEN_RECORDING_PANE = "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"
private let ACCESSIBILITY_PANE = "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"

/// Asks macOS for the grants the app lacks, by its own prompts, which also list the app in each pane, then opens the pane of the first still missing, since macOS prompts only once and the switch is the developer's to flip there.
private func requestPermissions() -> [String: Any] {
    if !CGPreflightScreenCaptureAccess() { _ = CGRequestScreenCaptureAccess() }
    let prompt = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
    _ = AXIsProcessTrustedWithOptions([prompt: true] as CFDictionary)
    let missing = !CGPreflightScreenCaptureAccess() ? SCREEN_RECORDING_PANE : !AXIsProcessTrusted() ? ACCESSIBILITY_PANE : nil
    if let pane = missing, let url = URL(string: pane) { NSWorkspace.shared.open(url) }
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

/// An app's name as the developer reads it.
private func appName(_ app: NSRunningApplication) -> String {
    app.localizedName ?? app.bundleIdentifier ?? "App \(app.processIdentifier)"
}

private func describe(_ app: NSRunningApplication) -> [String: Any] {
    var described: [String: Any] = [
        "name": appName(app),
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

/// The folders an app not yet running is looked for in, by its name: the usual ones, the developer's own, and Xcode's tools.
private let APP_FOLDERS: [URL] =
    ["/Applications", "/System/Applications", "/System/Applications/Utilities",
     "/Applications/Utilities", "/Applications/Xcode.app/Contents/Developer/Applications",
     "/Applications/Xcode.app/Contents/Applications"]
    .map { URL(fileURLWithPath: $0) }
    + [FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Applications")]

/// Where an app not yet running is installed, found by its bundle id or by its name in the usual folders.
private func installedURL(_ name: String) -> URL? {
    if let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: name) { return url }
    let file = name.hasSuffix(".app") ? name : "\(name).app"
    return APP_FOLDERS
        .map { $0.appendingPathComponent(file) }
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

/// Refuses an app that is not the one the developer allowed, where the request pins it: by `pin_bundle_id`, or by `pin_pid` for an app with no bundle id.
private func requirePinned(_ request: [String: Any], _ app: NSRunningApplication) throws {
    let bundleMoved = (request["pin_bundle_id"] as? String).map { $0 != app.bundleIdentifier } ?? false
    let processMoved = integer(request, "pin_pid").map { pid_t($0) != app.processIdentifier } ?? false
    guard !bundleMoved, !processMoved else {
        throw HelperError(
            kind: ERROR_KIND.refused,
            message: "The app found is no longer the one the developer allowed; read it again with get_app_state.")
    }
}

/// The running app an action names. Note that an action never launches an app, because its numbers came from a state the app's exit has ended.
private func actedApp(_ request: [String: Any]) throws -> NSRunningApplication {
    let name = try string(request, "app")
    guard let running = try runningApp(name) else {
        throw HelperError(
            kind: ERROR_KIND.noState, message: "\(name) is not running; read it with get_app_state first.")
    }
    try requirePinned(request, running)
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

/// An installed app as `list_apps` names one, without its icon, which takes far longer to draw than the folders take to read.
private func describeInstalled(_ url: URL) -> [String: Any] {
    let bundleId = Bundle(url: url)?.bundleIdentifier
    var described: [String: Any] = [
        "name": FileManager.default.displayName(atPath: url.path).replacingOccurrences(of: ".app", with: ""),
        "refused": isRefused(bundleId),
    ]
    if let bundleId { described["bundle_id"] = bundleId }
    return described
}

/**
 The apps installed in the usual folders (`APP_FOLDERS`), each once by its
 bundle id, by name. Note that only each folder's own apps are read, not
 the folders inside it, so the list is read in a moment whatever the disk
 holds; an app filed deeper is still found by `describe_app` through its
 bundle id.
 */
private func listInstalledApps() -> [String: Any] {
    var seen = Set<String>()
    let urls = APP_FOLDERS.flatMap { folder in
        ((try? FileManager.default.contentsOfDirectory(
            at: folder, includingPropertiesForKeys: nil, options: [.skipsHiddenFiles])) ?? [])
            .filter { $0.pathExtension == "app" }
    }
    let apps = urls.map(describeInstalled).filter { app in
        seen.insert((app["bundle_id"] as? String) ?? (app["name"] as? String) ?? "").inserted
    }
    let sorted = apps.sorted {
        (($0["name"] as? String) ?? "").localizedCaseInsensitiveCompare(($1["name"] as? String) ?? "") == .orderedAscending
    }
    return ["apps": sorted]
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

/// One of an app's windows by an attribute that names one, where it does.
private func windowAttribute(_ app: AXUIElement, _ name: String) -> AXUIElement? {
    guard let window = attribute(app, name), CFGetTypeID(window) == AXUIElementGetTypeID() else { return nil }
    return (window as! AXUIElement)
}

/// Whether a window is in the Dock, which no capture reads without bringing it back, and bringing it back takes the developer's screen.
private func minimized(_ window: AXUIElement) -> Bool {
    (attribute(window, kAXMinimizedAttribute) as? Bool) == true
}

/**
 The window an agent reads of an app: its focused window, else its main
 one, else its first, passing over any in the Dock; none where it has no
 window. Note that an app whose every window is in the Dock is refused by
 name, so the agent can ask the developer to bring one back rather than
 read that the app has no window.
 */
private func focusedWindow(_ app: NSRunningApplication) throws -> AXUIElement? {
    let element = AXUIElementCreateApplication(app.processIdentifier)
    let named = [kAXFocusedWindowAttribute, kAXMainWindowAttribute].compactMap { windowAttribute(element, $0) }
    let candidates = named + ((attribute(element, kAXWindowsAttribute) as? [AXUIElement]) ?? [])
    if let shown = candidates.first(where: { !minimized($0) }) { return shown }
    guard candidates.isEmpty else {
        throw HelperError(
            kind: ERROR_KIND.noWindow,
            message:
                "\(appName(app))'s window is minimized, so it can't be read without bringing it back. Ask the developer to restore it; it can stay behind their other windows.")
    }
    return nil
}

// MARK: - Screenshots

private func jpegShot(_ image: CGImage, edge: Int, quality: Double) -> (width: Int, height: Int, base64: String)? {
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
    return (width, height, (data as Data).base64EncodedString())
}

/// A screenshot the wire carries: at the size and quality asked where it fits under `MAX_SHOT_CHARS`, else at a quality stepped down to `MIN_SHOT_QUALITY`, then a fifth smaller at a time, so a large window still sends a picture rather than one the service refuses.
private func jpegBase64(_ image: CGImage, edge: Int, quality: Double) -> [String: Any]? {
    var edge = edge
    var quality = quality
    while edge >= MIN_SHOT_EDGE {
        guard let shot = jpegShot(image, edge: edge, quality: quality) else { return nil }
        if shot.base64.utf8.count <= MAX_SHOT_CHARS {
            return ["width": shot.width, "height": shot.height, "jpeg": shot.base64]
        }
        if quality > MIN_SHOT_QUALITY {
            quality = max(MIN_SHOT_QUALITY, quality - SHOT_QUALITY_STEP)
        } else {
            edge = Int(Double(min(edge, max(image.width, image.height))) * SHOT_EDGE_STEP)
        }
    }
    return nil
}

/// The app's window to capture: the one its focused window is, else its largest on screen.
/// How far a window's frame may stand from its Accessibility frame, in points, and still be the same window.
private let FRAME_SLACK: CGFloat = 2

/// Whether two frames of a window, its capture's and its Accessibility one's, are the same window's.
private func sameFrame(_ one: CGRect, _ other: CGRect) -> Bool {
    abs(one.minX - other.minX) <= FRAME_SLACK && abs(one.minY - other.minY) <= FRAME_SLACK
        && abs(one.width - other.width) <= FRAME_SLACK && abs(one.height - other.height) <= FRAME_SLACK
}

/**
 The window to capture: the one at the frame of the window whose elements
 are numbered, so the screenshot and the numbers are of one window, or the
 app's largest where it has no such window, whose numbers are then none.
 Note that a window whose frame no capturable window matches is refused
 rather than another captured in its place, as when it stands on another
 Space, since the agent would then click by numbers of one window on a
 picture of another.
 */
private func captureWindow(_ app: NSRunningApplication, frame numbered: CGRect?) async throws -> SCWindow {
    let pid = app.processIdentifier
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
    if let numbered {
        // Note that two windows at one frame are refused too, since either could be the one numbered.
        let paired = windows.filter { sameFrame($0.frame, numbered) }
        guard paired.count <= 1 else {
            throw HelperError(
                kind: ERROR_KIND.noWindow,
                message:
                    "\(appName(app)) has two windows at the same place, so it can't tell which to capture. Ask the developer to move one of them.")
        }
        guard let paired = paired.first else {
            throw HelperError(
                kind: ERROR_KIND.noWindow,
                message:
                    "\(appName(app))'s window can't be captured as it stands, as when it is on another Space. Ask the developer to bring it onto this Space; it can stay behind their other windows.")
        }
        return paired
    }
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

    /// Where the agent's cursor glides for an element: its center, or where it has no place of its own, the nearest
    /// ancestor's that has one. Note that this places the cursor alone, never a click, which lands only on the element's own center.
    func cursorPoint(_ index: Int) -> CGPoint? {
        guard var element = try? element(index) else { return nil }
        for _ in 0...MAX_CURSOR_ANCESTORS {
            if let bounds = frame(element) { return CGPoint(x: bounds.midX, y: bounds.midY) }
            guard let parent = attribute(element, kAXParentAttribute), CFGetTypeID(parent) == AXUIElementGetTypeID()
            else { return nil }
            // SAFETY: the type id was checked just above.
            element = parent as! AXUIElement
        }
        return nil
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
    try requirePinned(request, app)
    let pid = app.processIdentifier
    let axWindow = try focusedWindow(app)
    let title = axWindow.flatMap { text($0, kAXTitleAttribute) }
    // Note that a window whose elements are numbered and that has no frame is refused too, since no capture could be paired with it.
    let numbered = try axWindow.map { element in
        guard let place = frame(element) else {
            throw HelperError(kind: ERROR_KIND.noWindow, message: "\(appName(app))'s window has no place on screen to capture.")
        }
        return place
    }
    let window = try await captureWindow(app, frame: numbered)
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

/// The pointer's copper over a light window and the brighter amber over a dark one: the brand's accent in either theme (`@repo/brand`'s `BRAND_PALETTE`), as the browser's pointer is drawn (`recording-cursor.ts`).
private let POINTER_LIGHT = NSColor(srgbRed: 0xa7 / 255, green: 0x61 / 255, blue: 0x1b / 255, alpha: 1)
private let POINTER_DARK = NSColor(srgbRed: 0xcf / 255, green: 0x7b / 255, blue: 0x26 / 255, alpha: 1)

/// The pointer's color for the Mac's appearance, which the windows under it follow.
private func pointerColor() -> NSColor {
    NSApp.effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? POINTER_DARK : POINTER_LIGHT
}

/**
 The agent's pointer as the browser's is drawn: the same rounded arrow in a
 16-point box, its tip at the box's top left, in the accent with a white
 edge and a soft shadow, and a ring that ripples out from its tip as a press
 lands.
 */
private final class AgentCursorView: NSView {
    override var isFlipped: Bool { true }

    /// The browser pointer's path (`recording-cursor.ts`), its tip at the origin.
    private static func arrow() -> NSBezierPath {
        let path = NSBezierPath()
        path.move(to: CGPoint(x: 0, y: 0))
        path.line(to: CGPoint(x: 12.07, y: 4.16))
        path.curve(to: CGPoint(x: 12.56, y: 5.58), controlPoint1: CGPoint(x: 13.49, y: 4.65), controlPoint2: CGPoint(x: 13.65, y: 5.12))
        path.line(to: CGPoint(x: 7.64, y: 7.64))
        path.line(to: CGPoint(x: 5.58, y: 12.56))
        path.curve(to: CGPoint(x: 4.16, y: 12.07), controlPoint1: CGPoint(x: 5.12, y: 13.65), controlPoint2: CGPoint(x: 4.65, y: 13.49))
        path.close()
        return path
    }

    override func draw(_ dirtyRect: NSRect) {
        let arrow = Self.arrow()
        arrow.transform(using: AffineTransform(translationByX: CURSOR_TIP.x, byY: CURSOR_TIP.y))
        arrow.lineJoinStyle = .round
        arrow.lineWidth = 2.4
        NSGraphicsContext.saveGraphicsState()
        let shadow = NSShadow()
        shadow.shadowOffset = NSSize(width: 0, height: -1)
        shadow.shadowBlurRadius = 1.5
        shadow.shadowColor = NSColor.black.withAlphaComponent(0.35)
        shadow.set()
        NSColor.white.setStroke()
        arrow.stroke()
        NSGraphicsContext.restoreGraphicsState()
        pointerColor().setFill()
        arrow.fill()
    }

    /// A ring rippling out from the tip, as the browser's pointer ripples as a press lands.
    func ripple() {
        wantsLayer = true
        guard let layer else { return }
        let ring = CAShapeLayer()
        ring.path = CGPath(ellipseIn: CGRect(x: -12, y: -12, width: 24, height: 24), transform: nil)
        ring.position = CURSOR_TIP
        ring.fillColor = nil
        ring.strokeColor = pointerColor().cgColor
        ring.lineWidth = 1.5
        layer.addSublayer(ring)
        CATransaction.begin()
        CATransaction.setCompletionBlock { ring.removeFromSuperlayer() }
        let grow = CABasicAnimation(keyPath: "transform.scale")
        grow.fromValue = 0.4
        grow.toValue = 1.4
        let fade = CABasicAnimation(keyPath: "opacity")
        fade.fromValue = 1
        fade.toValue = 0
        let both = CAAnimationGroup()
        both.animations = [grow, fade]
        both.duration = CURSOR_GLIDE_SECONDS * 1.6
        both.timingFunction = CAMediaTimingFunction(name: .easeOut)
        ring.opacity = 0
        ring.add(both, forKey: "ripple")
        CATransaction.commit()
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
    /// The press landing where the cursor stands, its ring rippling out.
    func press() {
        (panel?.contentView as? AgentCursorView)?.ripple()
    }

    /// The cursor's window ordered in, unseen where it stands nowhere yet, so a recording of the helper's windows finds it among them from the start.
    func standBy() {
        let panel = made()
        guard !panel.isVisible else { return }
        panel.alphaValue = 0
        panel.orderFrontRegardless()
    }

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

/// The agent's cursor glided to `point`, and a moment let pass so it has arrived as the action lands, which its ring ripples for.
private func cursorTo(_ point: CGPoint) async {
    await MainActor.run { agentCursor.glide(to: point) }
    try? await Task.sleep(nanoseconds: UInt64(CURSOR_GLIDE_SECONDS * 1_000_000_000))
    await MainActor.run { agentCursor.press() }
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
        if let point = current.cursorPoint(index) { await cursorTo(point) }
        // Note that a plain press goes through Accessibility, which needs no point and no focus, before an event is aimed at the element's center.
        if button == BUTTON.left, count == 1 {
            let pressed = AXUIElementPerformAction(element, kAXPressAction as CFString)
            if pressed == .success { return ["done": "pressed"] }
            // Note that only an element that offers no press is clicked at its center instead; any other failure may have pressed it already, so it is answered rather than pressed twice.
            guard pressed == .actionUnsupported else {
                throw HelperError(
                    kind: ERROR_KIND.failed,
                    message: "Element \(index) did not confirm its press (\(pressed.rawValue)); read the app again to see whether it took it.")
            }
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
    let current = try session(app)
    let index = integer(request, "element_index") ?? -1
    let element = try current.element(index)
    let value = (request["value"] as? String) ?? ""
    if let point = current.cursorPoint(index) { await cursorTo(point) }
    let result = AXUIElementSetAttributeValue(element, kAXValueAttribute as CFString, value as CFString)
    guard result == .success else {
        throw HelperError(kind: ERROR_KIND.failed, message: "The element did not take the value (\(result.rawValue)).")
    }
    return ["done": "set"]
}

private func performSecondaryAction(_ request: [String: Any]) async throws -> [String: Any] {
    try requireAccessibility()
    let app = try actedApp(request)
    let current = try session(app)
    let index = integer(request, "element_index") ?? -1
    let element = try current.element(index)
    let action = try string(request, "action")
    guard actions(element).contains(action) else {
        throw HelperError(kind: ERROR_KIND.badRequest, message: "The element offers no \(action) action.")
    }
    if let point = current.cursorPoint(index) { await cursorTo(point) }
    let result = AXUIElementPerformAction(element, action as CFString)
    guard result == .success else {
        throw HelperError(kind: ERROR_KIND.failed, message: "The element refused \(action) (\(result.rawValue)).")
    }
    return ["done": "performed"]
}

// MARK: - Recording

/// The most frames a second a recording keeps, as the window draws them: a still window draws none, and its last frame holds.
private let RECORDING_FPS = 15
/// A recording's longest edge in pixels, and its bit rate while it records.
private let RECORDING_EDGE = 1600
private let RECORDING_BIT_RATE = 2_500_000
/// How long the last frame is held past the last change, so the video does not end on the very frame that changed.
private let RECORDING_TAIL_SECONDS = 0.5
/// The longest edges a recording past its byte bound is made again at, each at the bit rate that bound leaves, until one fits.
private let RECORDING_SHRINK_EDGES = [1280, 960, 720]
/// The share of the byte bound a made-again recording aims at, leaving room for the bit rate to run over.
private let RECORDING_SHRINK_SHARE = 0.85

/// Where a recording is kept on this Mac: one folder, cleared as the next recording starts, so its frames and video stay on disk until then.
private let RECORDING_FOLDER = FileManager.default.temporaryDirectory
    .appendingPathComponent("vespin-computer-recording", isDirectory: true)
/// The video as captured, and as kept once it fits.
private let CAPTURED_URL = RECORDING_FOLDER.appendingPathComponent("captured.mp4")
private let KEPT_URL = RECORDING_FOLDER.appendingPathComponent("recording.mp4")
private let SMALLER_URL = RECORDING_FOLDER.appendingPathComponent("smaller.mp4")

/// An H.264 encoding at a size and bit rate, its index ahead of its media once written, as every player streams it.
private func h264Settings(width: Int, height: Int, bitRate: Int) -> [String: Any] {
    [
        AVVideoCodecKey: AVVideoCodecType.h264,
        AVVideoWidthKey: width,
        AVVideoHeightKey: height,
        AVVideoScalingModeKey: AVVideoScalingModeResizeAspect,
        AVVideoCompressionPropertiesKey: [
            AVVideoAverageBitRateKey: bitRate,
            AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
            AVVideoMaxKeyFrameIntervalDurationKey: 2,
            AVVideoAllowFrameReorderingKey: false,
            AVVideoExpectedSourceFrameRateKey: RECORDING_FPS,
        ],
    ]
}

/// A size fit inside `edge` on its longest side, each side even, as 4:2:0 H.264 needs.
private func evenSize(width: Double, height: Double, edge: Int) -> (width: Int, height: Int) {
    let scale = min(1, Double(edge) / max(width, height, 1))
    return (max(2, Int(width * scale) / 2 * 2), max(2, Int(height * scale) / 2 * 2))
}

/// Whether a frame ScreenCaptureKit handed over is one the window drew, rather than a note that nothing changed.
private func isDrawnFrame(_ buffer: CMSampleBuffer) -> Bool {
    guard
        let attachments = CMSampleBufferGetSampleAttachmentsArray(buffer, createIfNecessary: false)
            as? [[SCStreamFrameInfo: Any]],
        let raw = attachments.first?[SCStreamFrameInfo.status] as? Int,
        let status = SCFrameStatus(rawValue: raw)
    else { return false }
    return status == .complete
}

/// How a capture ended: the seconds it ran, or why it came to no video.
private enum CaptureEnd {
    case ran(Double)
    case empty
    case encoder
}

/**
 One recording as it runs: a stream of the display the window stands on,
 holding only the app's windows and the helper's own, which the agent's
 cursor stands in, cropped to the window, written frame by frame into an
 H.264 MP4. Note that every frame is handled on its own queue, which the
 end reads through, so a frame never lands in a writer being finished.
 */
private final class WindowRecorder: NSObject, SCStreamOutput {
    let width: Int
    let height: Int
    private let stream: SCStream
    private let writer: AVAssetWriter
    private let input: AVAssetWriterInput
    private let frames = DispatchQueue(label: "dev.vespin.computer-use.recording")
    private var first: CMTime?
    private var last: CMTime?
    private var ended = false

    init(filter: SCContentFilter, configuration: SCStreamConfiguration) throws {
        width = configuration.width
        height = configuration.height
        writer = try AVAssetWriter(outputURL: CAPTURED_URL, fileType: .mp4)
        writer.shouldOptimizeForNetworkUse = true
        input = AVAssetWriterInput(
            mediaType: .video, outputSettings: h264Settings(width: width, height: height, bitRate: RECORDING_BIT_RATE))
        input.expectsMediaDataInRealTime = true
        guard writer.canAdd(input) else {
            throw HelperError(kind: ERROR_KIND.recordingEncoder, message: "The recording could not be encoded.")
        }
        writer.add(input)
        stream = SCStream(filter: filter, configuration: configuration, delegate: nil)
        super.init()
        try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: frames)
    }

    func start() async throws {
        guard writer.startWriting() else {
            throw HelperError(kind: ERROR_KIND.recordingEncoder, message: "The recording could not be encoded.")
        }
        try await stream.startCapture()
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer buffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .screen, !ended, buffer.isValid, isDrawnFrame(buffer) else { return }
        let at = buffer.presentationTimeStamp
        if first == nil {
            writer.startSession(atSourceTime: at)
            first = at
        }
        guard input.isReadyForMoreMediaData, input.append(buffer) else { return }
        last = at
    }

    /// The capture stopped and its video written whole, the last frame held for the tail; how it ended.
    func finish() async -> CaptureEnd {
        try? await stream.stopCapture()
        let span: (first: CMTime, last: CMTime)? = frames.sync {
            ended = true
            guard let first, let last else { return nil }
            return (first, last)
        }
        guard let span else {
            writer.cancelWriting()
            return .empty
        }
        let tail = CMTime(seconds: RECORDING_TAIL_SECONDS, preferredTimescale: 600)
        input.markAsFinished()
        writer.endSession(atSourceTime: CMTimeAdd(span.last, tail))
        await writer.finishWriting()
        guard writer.status == .completed else { return .encoder }
        return .ran(CMTimeGetSeconds(CMTimeSubtract(span.last, span.first)) + RECORDING_TAIL_SECONDS)
    }
}

/**
 One copy of frames from a reader to a writer. Note that it is touched only
 on the writer's queue, which asks for frames one call at a time, so its
 parts and its flag are never read on two threads at once, which is what
 `@unchecked Sendable` vouches for.
 */
private final class FrameCopy: @unchecked Sendable {
    private let input: AVAssetWriterInput
    private let output: AVAssetReaderTrackOutput
    private var finished = false

    init(input: AVAssetWriterInput, output: AVAssetReaderTrackOutput) {
        self.input = input
        self.output = output
    }

    /// Moves every frame the writer takes now; true the one time the copy ends, at the last frame or the first the writer refuses, which its status then answers as failed.
    func moved() -> Bool {
        while !finished, input.isReadyForMoreMediaData {
            guard let buffer = output.copyNextSampleBuffer(), input.append(buffer) else {
                finished = true
                input.markAsFinished()
                return true
            }
        }
        return false
    }
}

/// The video at `source` made again at `target`, no longer than `edge` on its longest side, at `bitRate`; its size, or nothing where it could not be made.
private func madeSmaller(_ source: URL, to target: URL, edge: Int, bitRate: Int) async -> (width: Int, height: Int)? {
    try? FileManager.default.removeItem(at: target)
    let asset = AVURLAsset(url: source)
    guard
        let track = try? await asset.loadTracks(withMediaType: .video).first,
        let natural = try? await track.load(.naturalSize),
        let reader = try? AVAssetReader(asset: asset),
        let writer = try? AVAssetWriter(outputURL: target, fileType: .mp4)
    else { return nil }
    let size = evenSize(width: natural.width, height: natural.height, edge: edge)
    let output = AVAssetReaderTrackOutput(
        track: track,
        outputSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange])
    let input = AVAssetWriterInput(
        mediaType: .video, outputSettings: h264Settings(width: size.width, height: size.height, bitRate: bitRate))
    writer.shouldOptimizeForNetworkUse = true
    guard reader.canAdd(output), writer.canAdd(input) else { return nil }
    reader.add(output)
    writer.add(input)
    guard reader.startReading(), writer.startWriting() else { return nil }
    writer.startSession(atSourceTime: .zero)
    let queue = DispatchQueue(label: "dev.vespin.computer-use.recording-smaller")
    let copy = FrameCopy(input: input, output: output)
    await withCheckedContinuation { (done: CheckedContinuation<Void, Never>) in
        input.requestMediaDataWhenReady(on: queue) {
            if copy.moved() { done.resume() }
        }
    }
    await writer.finishWriting()
    guard reader.status == .completed, writer.status == .completed else { return nil }
    return size
}

private func fileBytes(_ url: URL) -> Int {
    ((try? FileManager.default.attributesOfItem(atPath: url.path))?[.size] as? Int) ?? 0
}

/// What a recording came to: its seconds and size, its video kept at `KEPT_URL`, or the helper's word for why there is none.
private enum RecordingOutcome {
    case recorded(seconds: Double, width: Int, height: Int)
    case failed(kind: String, message: String)
}

/**
 The captured video kept as one that fits `maxBytes`: as it was where it
 fits, else made again at ever smaller sizes at the bit rate the bound
 leaves for its length, until one fits.
 */
private func kept(_ recorder: WindowRecorder, maxBytes: Int) async -> RecordingOutcome {
    let encoder = RecordingOutcome.failed(kind: ERROR_KIND.recordingEncoder, message: "The recording could not be encoded.")
    let seconds: Double
    switch await recorder.finish() {
    case .empty:
        return .failed(kind: ERROR_KIND.recordingEmpty, message: "The app drew nothing while it was recorded.")
    case .encoder:
        return encoder
    case .ran(let ran):
        seconds = ran
    }
    var size = (width: recorder.width, height: recorder.height)
    var source = CAPTURED_URL
    if fileBytes(CAPTURED_URL) > maxBytes {
        let bitRate = Int(Double(maxBytes) * 8 * RECORDING_SHRINK_SHARE / max(seconds, 1))
        var fits = false
        for edge in RECORDING_SHRINK_EDGES where !fits {
            guard let made = await madeSmaller(CAPTURED_URL, to: SMALLER_URL, edge: edge, bitRate: bitRate) else {
                return encoder
            }
            size = made
            source = SMALLER_URL
            fits = fileBytes(SMALLER_URL) <= maxBytes
        }
        guard fits else {
            return .failed(
                kind: ERROR_KIND.recordingTooLarge, message: "The recording would not fit its bound even made small.")
        }
    }
    try? FileManager.default.removeItem(at: KEPT_URL)
    guard (try? FileManager.default.moveItem(at: source, to: KEPT_URL)) != nil else { return encoder }
    return .recorded(seconds: (seconds * 10).rounded() / 10, width: size.width, height: size.height)
}

/**
 The one recording this helper keeps: the one running, stopped by the
 agent or once its time runs out, and what the last one came to, which a
 stop asked again answers until the next recording starts. Note that a stop
 made while another is still finishing waits on that one, so a recording is
 finished once.
 */
private actor Recordings {
    private var running: WindowRecorder?
    private var maxBytes = 0
    private var stopping: Task<RecordingOutcome, Never>?
    private var timer: Task<Void, Never>?

    /// Whether a recording runs and is not yet being stopped.
    var isRunning: Bool { running != nil && stopping == nil }

    func begin(_ recorder: WindowRecorder, maxSeconds: Double, maxBytes: Int) {
        running = recorder
        self.maxBytes = maxBytes
        stopping = nil
        timer?.cancel()
        timer = Task {
            try? await Task.sleep(nanoseconds: UInt64(maxSeconds * 1_000_000_000))
            guard !Task.isCancelled else { return }
            _ = await self.stop()
        }
    }

    /// What the last recording came to, stopping it first where it runs; nothing where none ran since the helper started.
    func stop() async -> RecordingOutcome? {
        if let stopping { return await stopping.value }
        guard let running else { return nil }
        let bound = maxBytes
        let finishing = Task { await kept(running, maxBytes: bound) }
        stopping = finishing
        timer?.cancel()
        return await finishing.value
    }
}

private let recordings = Recordings()

/// The app's window to record: the one its last `get_app_state` read where it still stands, else its largest on screen.
private func recordedWindow(_ app: NSRunningApplication, in content: SCShareableContent) throws -> SCWindow {
    let pid = app.processIdentifier
    let windows = content.windows.filter {
        $0.owningApplication?.processID == pid && $0.windowLayer == 0 && $0.isOnScreen && $0.frame.width > 1
    }
    if let read = sessions[pid], let same = windows.first(where: { $0.windowID == read.windowID }) { return same }
    guard let largest = windows.max(by: { $0.frame.width * $0.frame.height < $1.frame.width * $1.frame.height })
    else {
        throw HelperError(
            kind: ERROR_KIND.noWindow,
            message:
                "\(appName(app)) has no window on screen to record, as when it is minimized or on another Space. Ask the developer to bring it onto this Space; it can stay behind their other windows.")
    }
    return largest
}

/**
 Starts recording the app's window: the display it stands on, holding the
 app's windows and the helper's own, so its menus and sheets and the
 agent's cursor are in the video while the developer's other windows and
 their own pointer never are, cropped to the window as it stood at the
 start. A recording that runs is left to run, and refused, as the browser's
 is.
 */
private func record(_ request: [String: Any]) async throws -> [String: Any] {
    let app = try await resolveApp(try string(request, "app"))
    try requirePinned(request, app)
    guard CGPreflightScreenCaptureAccess() else {
        throw HelperError(
            kind: ERROR_KIND.noPermission,
            message: "Screen Recording is not allowed for this app, so it cannot record other apps' windows.")
    }
    guard !(await recordings.isRunning) else {
        throw HelperError(
            kind: ERROR_KIND.recordingRunning, message: "A recording already runs: stop it with stop_recording first.")
    }
    let maxSeconds = Double(min(max(integer(request, "max_seconds") ?? 120, 1), 120))
    let maxBytes = max(integer(request, "max_bytes") ?? 0, 1)
    await MainActor.run { agentCursor.standBy() }
    // Note that every window is listed, not those on screen alone, so the helper is found by its cursor's window however it stands.
    let content = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: false)
    let window = try recordedWindow(app, in: content)
    guard
        let display = content.displays.max(by: {
            $0.frame.intersection(window.frame).width * $0.frame.intersection(window.frame).height
                < $1.frame.intersection(window.frame).width * $1.frame.intersection(window.frame).height
        }), display.frame.intersects(window.frame)
    else {
        throw HelperError(kind: ERROR_KIND.noWindow, message: "\(appName(app))'s window stands on no display.")
    }
    let own = getpid()
    let included = content.applications.filter { $0.processID == app.processIdentifier || $0.processID == own }
    let filter = SCContentFilter(display: display, including: included, exceptingWindows: [])
    let crop = window.frame.intersection(display.frame).offsetBy(dx: -display.frame.minX, dy: -display.frame.minY)
    let scale = Double(filter.pointPixelScale)
    let size = evenSize(width: crop.width * scale, height: crop.height * scale, edge: RECORDING_EDGE)
    let configuration = SCStreamConfiguration()
    configuration.sourceRect = crop
    configuration.width = size.width
    configuration.height = size.height
    configuration.pixelFormat = kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange
    configuration.minimumFrameInterval = CMTime(value: 1, timescale: CMTimeScale(RECORDING_FPS))
    configuration.showsCursor = false
    configuration.queueDepth = 6
    // Note that the last recording's video goes only now, as the browser's does, so a stop asked again could still read it until then.
    try? FileManager.default.removeItem(at: RECORDING_FOLDER)
    try FileManager.default.createDirectory(
        at: RECORDING_FOLDER, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    let recorder = try WindowRecorder(filter: filter, configuration: configuration)
    try await recorder.start()
    await recordings.begin(recorder, maxSeconds: maxSeconds, maxBytes: maxBytes)
    return ["done": "record"]
}

/// Stops the recording, or reads the last one again, and answers its length, size, and video as base64.
private func stopRecording(_ request: [String: Any]) async throws -> [String: Any] {
    guard let outcome = await recordings.stop() else {
        throw HelperError(kind: ERROR_KIND.recordingNone, message: "No recording runs: start one with record.")
    }
    switch outcome {
    case .failed(let kind, let message):
        throw HelperError(kind: kind, message: message)
    case .recorded(let seconds, let width, let height):
        guard let video = try? Data(contentsOf: KEPT_URL) else {
            throw HelperError(kind: ERROR_KIND.recordingNone, message: "No recording runs: start one with record.")
        }
        return [
            "recorded": [
                "seconds": seconds, "width": width, "height": height, "mp4": video.base64EncodedString(),
            ]
        ]
    }
}

// MARK: - Entry

private let OPERATIONS: [String: ([String: Any]) async throws -> [String: Any]] = [
    "permissions": { _ in permissions() },
    "request_permissions": { _ in requestPermissions() },
    "list_apps": { _ in listApps() },
    "list_installed_apps": { _ in listInstalledApps() },
    "describe_app": describeApp,
    "get_app_state": getAppState,
    "click": click,
    "type_text": typeText,
    "press_key": pressKey,
    "scroll": scroll,
    "drag": drag,
    "set_value": setValue,
    "perform_secondary_action": performSecondaryAction,
    "record": record,
    "stop_recording": stopRecording,
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
