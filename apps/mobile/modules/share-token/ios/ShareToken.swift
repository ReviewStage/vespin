// ShareToken.swift -- the one Keychain item the app and its share extension share: the account's current access token and when it stops being worth sending, which the share sheet starts a task with.
//
// The app writes it on sign-in and on every renewal, and deletes it on
// sign-out (`ShareTokenModule.swift`, `@repo/host`'s `issued-token-account-source.ts`).
// The share extension only reads it, and reads a token past its expiry as
// none, so a dead token never goes out. It holds the access token alone,
// never the refresh token, which rotates on every use, so a second process
// using it would revoke the account's tokens and sign the phone out. The
// item is readable once the phone has been unlocked after a restart, stays
// on this device, never syncs, and lives in a Keychain group only the app
// and the share extension are entitled to, named by each bundle's
// Info.plist (`VespinShareKeychainGroup`), never spelled here. This file is
// built into the app's module and copied into the share extension.

import Foundation
import Security

enum ShareToken {
  /// The Info.plist key naming the shared Keychain group, which each target reads its group from.
  private static let groupKey = "VespinShareKeychainGroup"
  private static let service = "dev.vespin.ios.share"
  private static let account = "access-token"

  /// What the item holds: the token, and the instant, in epoch milliseconds, after which it is not sent.
  private struct Kept: Codable {
    let token: String
    let expiresAt: Double
  }

  /// The item's query, in the group this bundle names; none where the bundle names none.
  private static func query() -> [String: Any]? {
    guard let group = Bundle.main.object(forInfoDictionaryKey: groupKey) as? String, !group.isEmpty
    else { return nil }
    return [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
      kSecAttrAccessGroup as String: group,
      kSecAttrSynchronizable as String: false,
    ]
  }

  /// Keeps `token`, good until `expiresAt` (epoch milliseconds), as the item in place of what it held, or deletes the item where `token` is none; answers whether the Keychain took it.
  @discardableResult
  static func keep(_ token: String?, expiresAt: Double?) -> Bool {
    guard let query = query() else { return false }
    let deleted = SecItemDelete(query as CFDictionary)
    guard let token, let expiresAt else { return deleted == errSecSuccess || deleted == errSecItemNotFound }
    guard let data = try? JSONEncoder().encode(Kept(token: token, expiresAt: expiresAt)) else {
      return false
    }
    var item = query
    item[kSecValueData as String] = data
    item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    return SecItemAdd(item as CFDictionary, nil) == errSecSuccess
  }

  /// The token the app kept, or none where it kept none, it has expired, or the Keychain refuses this bundle.
  static func read() -> String? {
    guard var query = query() else { return nil }
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var found: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &found) == errSecSuccess,
      let data = found as? Data, let kept = try? JSONDecoder().decode(Kept.self, from: data),
      kept.expiresAt > Date().timeIntervalSince1970 * 1000
    else { return nil }
    return kept.token
  }
}
