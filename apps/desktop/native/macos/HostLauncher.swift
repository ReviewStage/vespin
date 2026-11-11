import Foundation

/// Starts Vespin's host daemon from inside Vespin.app, as the bundle's
/// LaunchAgent (`Contents/Library/LaunchAgents/dev.vespin.host.plist`) names
/// it by its `BundleProgram`. launchd resolves only that one path against the
/// bundle and hands `ProgramArguments` on as they stand, with `/` as the
/// working directory, so Node could not be handed its script by a path
/// relative to the bundle. This finds both from the bundle it stands in and
/// replaces itself with the bundle's Node running the daemon's script, with
/// its own arguments after it, so launchd follows the daemon under the
/// process it started. It does nothing else: no shell, and no change to the
/// environment.
private let NODE = "Contents/Helpers/node"
private let DAEMON = "Contents/Resources/host/lib/vespin-host.mjs"

@main
private struct HostLauncher {
    static func main() {
        let bundle = Bundle.main.bundleURL
        let node = bundle.appendingPathComponent(NODE).path
        let daemon = bundle.appendingPathComponent(DAEMON).path
        let arguments = [node, daemon] + CommandLine.arguments.dropFirst()
        let argv = arguments.map { strdup($0) } + [nil]
        execv(node, argv)
        // Note that execv returns only where it failed, so this is the launcher's one exit.
        let reason = String(cString: strerror(errno))
        FileHandle.standardError.write(Data("vespin-host: could not start \(node): \(reason)\n".utf8))
        exit(EX_OSERR)
    }
}
