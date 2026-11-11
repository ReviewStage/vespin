// ShareTokenModule.swift -- the app's door to the share sheet's token: the app's JavaScript hands it the account's current access token as it changes, or none once the account signs out, and it keeps that in the Keychain item the share extension reads (`ShareToken.swift`).

import ExpoModulesCore

public final class ShareTokenModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ShareToken")

    Function("keep") { (token: String?) -> Bool in
      ShareToken.keep(token)
    }
  }
}
