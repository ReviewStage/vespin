// ShareTokenModule.swift -- the app's door to the share sheet's token: the app's JavaScript hands it the account's access token and its expiry as each is issued, or none once the account signs out, and it keeps that in the Keychain item the share extension reads (`ShareToken.swift`).

import ExpoModulesCore

public final class ShareTokenModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ShareToken")

    Function("keep") { (token: String?, expiresAt: Double?) -> Bool in
      ShareToken.keep(token, expiresAt: expiresAt)
    }
  }
}
