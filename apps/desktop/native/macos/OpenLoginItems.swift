import ServiceManagement

/// Opens System Settings at Login Items, where a member allows the host's
/// agent that macOS holds until they do (`SMAppService.Status.requiresApproval`).
/// It calls the one way Apple names for it, `SMAppService`'s
/// `openSystemSettingsLoginItems()`, which Electron does not wrap, and exits.
@main
private struct OpenLoginItems {
    static func main() {
        SMAppService.openSystemSettingsLoginItems()
    }
}
