// SealerVectors.swift -- the XChaCha draft's test vectors run through the sealer's own code (`XChaChaPoly.swift`), which a launch's seal check (`-sealCheck true`, `src/host/seal-check.ts`) reports on a device or simulator, so the code that ships is checked where it runs.

import Foundation

/// The bytes a hex string spells, its spaces ignored.
private func hexBytes(_ hex: String) -> [UInt8] {
  let digits = Array(hex.filter { $0 != " " })
  return stride(from: 0, to: digits.count, by: 2).map { UInt8(String(digits[$0...$0 + 1]), radix: 16)! }
}

/// HChaCha20 over draft-irtf-cfrg-xchacha-03's section 2.2.1 vector.
private func hChaCha20Passes() -> Bool {
  let subkey = hChaCha20(key: Array(0..<32), nonce: hexBytes("000000090000004a0000000031415927"))
  return subkey
    == hexBytes("82413b42 27b27bfe d30e4250 8a877d73 a0f9e4d5 8a74a853 c12ec413 26d3ecdc")
}

/// AEAD_XChaCha20_Poly1305 over the draft's section A.3.1 vector: sealed to its ciphertext and tag, and opened back.
private func aeadPasses() -> Bool {
  let plain = Data(hexBytes(
    "4c616469657320616e642047656e746c656d656e206f662074686520636c6173"
      + "73206f66202739393a204966204920636f756c64206f6666657220796f75206f"
      + "6e6c79206f6e652074697020666f7220746865206675747572652c2073756e73"
      + "637265656e20776f756c642062652069742e"))
  let key = Data(hexBytes("808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9f"))
  let nonce = hexBytes("404142434445464748494a4b4c4d4e4f5051525354555657")
  let aad = Data(hexBytes("50515253c0c1c2c3c4c5c6c7"))
  let sealed = Data(nonce + hexBytes(
    "bd6d179d3e83d43b9576579493c0e939572a1700252bfaccbed2902c21396cbb"
      + "731c7f1b0b4aa6440bf3a82f4eda7e39ae64c6708c54c216cb96b72e1213b452"
      + "2f8c9ba40db5d945b11b69b982c1bb9e3f3fac2bc369488f76b2383565d3fff9"
      + "21f9664c97637da9768812f615c68b13b52e"
      + "c0875924c1c7987947deafd8780acf49"))
  guard
    let ours = try? xChaChaPolySeal(plain, key: key, nonce: nonce, authenticating: aad),
    let opened = try? xChaChaPolyOpen(sealed, key: key, authenticating: aad)
  else { return false }
  return ours == sealed && opened == plain
}

/// One line for each vector: `PASS` or `FAIL`, then the vector's name.
func sealerVectorLines() -> [String] {
  [
    (hChaCha20Passes(), "HChaCha20 (draft-irtf-cfrg-xchacha-03 2.2.1)"),
    (aeadPasses(), "AEAD_XChaCha20_Poly1305 seal and open (draft-irtf-cfrg-xchacha-03 A.3.1)"),
  ].map { "\($0.0 ? "PASS" : "FAIL") \($0.1)" }
}
