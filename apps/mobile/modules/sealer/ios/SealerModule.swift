// SealerModule.swift -- the host's sealing of its kept files in native code: text sealed under the Keychain's key and answered as base64, and base64 opened back to text, in the format `@noble/ciphers`' `managedNonce(xchacha20poly1305)` writes (`XChaChaPoly.swift`), so a file sealed in JavaScript opens here and one sealed here opens there.
//
// The app's JavaScript reads the key from the Keychain and hands it in, as
// base64, with each call (`@repo/host/xchacha-cipher`). Note that the calls
// are synchronous, as the host's cipher is, and that sealing a file of
// megabytes here takes milliseconds where Hermes took a second and more for
// the cipher and the base64 together.

import ExpoModulesCore
import Foundation
import Security

enum SealerError: Error {
  case keyNotBase64
  case sealedNotBase64
  case noRandomNonce
}

/// The key handed in as base64, as the Keychain keeps it.
private func keyData(_ key: String) throws -> Data {
  guard let data = Data(base64Encoded: key) else { throw SealerError.keyNotBase64 }
  return data
}

/// A fresh random extended nonce from the system's generator.
private func randomNonce() throws -> [UInt8] {
  var nonce = [UInt8](repeating: 0, count: xChaChaNonceBytes)
  guard SecRandomCopyBytes(kSecRandomDefault, nonce.count, &nonce) == errSecSuccess else {
    throw SealerError.noRandomNonce
  }
  return nonce
}

public final class SealerModule: Module {
  public func definition() -> ModuleDefinition {
    Name("Sealer")

    Function("seal") { (key: String, plainText: String) throws -> String in
      try xChaChaPolySeal(Data(plainText.utf8), key: keyData(key), nonce: randomNonce())
        .base64EncodedString()
    }

    Function("open") { (key: String, sealedText: String) throws -> String in
      guard let sealed = Data(base64Encoded: sealedText) else { throw SealerError.sealedNotBase64 }
      return try String(decoding: xChaChaPolyOpen(sealed, key: keyData(key)), as: UTF8.self)
    }
  }
}
