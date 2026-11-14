// XChaCha20-Poly1305 sealing in the format `@noble/ciphers`' `managedNonce(xchacha20poly1305)` writes: a 24-byte nonce, then the ciphertext, then the 16-byte Poly1305 tag, with no associated data.
//
// CryptoKit seals ChaCha20-Poly1305 with a 12-byte nonce only, so the
// extended nonce is taken as the XChaCha draft builds it
// (draft-irtf-cfrg-xchacha-03, section 2.3): HChaCha20 over the key and the
// nonce's first 16 bytes derives a subkey, and `ChaChaPoly` seals under it
// with a nonce of four zero bytes followed by the nonce's last 8. Every
// CryptoKit symbol here is from iOS 13, so the app's iOS 26 floor binds none
// it lacks.

import CryptoKit
import Foundation

/// The key's length, 256 bits.
let xChaChaKeyBytes = 32

/// The extended nonce's length, written in front of the sealed bytes.
let xChaChaNonceBytes = 24

/// Poly1305's tag length, written after the ciphertext.
private let tagBytes = 16

/// How much of the extended nonce HChaCha20 reads.
private let hChaChaNonceBytes = 16

enum XChaChaPolyError: Error {
  case keyLength
  case nonceLength
  case sealedLength
}

private func rotatedLeft(_ word: UInt32, _ count: UInt32) -> UInt32 {
  (word << count) | (word >> (32 - count))
}

private func quarterRound(_ state: inout [UInt32], _ a: Int, _ b: Int, _ c: Int, _ d: Int) {
  state[a] &+= state[b]; state[d] = rotatedLeft(state[d] ^ state[a], 16)
  state[c] &+= state[d]; state[b] = rotatedLeft(state[b] ^ state[c], 12)
  state[a] &+= state[b]; state[d] = rotatedLeft(state[d] ^ state[a], 8)
  state[c] &+= state[d]; state[b] = rotatedLeft(state[b] ^ state[c], 7)
}

/// The little-endian word of `bytes` at `offset`.
private func littleEndianWord(_ bytes: [UInt8], _ offset: Int) -> UInt32 {
  UInt32(bytes[offset]) | UInt32(bytes[offset + 1]) << 8 | UInt32(bytes[offset + 2]) << 16
    | UInt32(bytes[offset + 3]) << 24
}

/// HChaCha20 (draft-irtf-cfrg-xchacha-03, section 2.2): ChaCha20's 20 rounds
/// over the key and a 16-byte nonce, answering the state's first and last
/// rows, little-endian, with no feed-forward.
///
/// Checked against the draft's test vector (section 2.2.1):
///   key   00 01 02 … 1f
///   nonce 00 00 00 09 00 00 00 4a 00 00 00 00 31 41 59 27
///   subkey 82413b42 27b27bfe d30e4250 8a877d73 a0f9e4d5 8a74a853 c12ec413 26d3ecdc
func hChaCha20(key: [UInt8], nonce: [UInt8]) -> [UInt8] {
  precondition(key.count == xChaChaKeyBytes && nonce.count == hChaChaNonceBytes)
  var state: [UInt32] = [0x6170_7865, 0x3320_646e, 0x7962_2d32, 0x6b20_6574]
  state += (0..<8).map { littleEndianWord(key, $0 * 4) }
  state += (0..<4).map { littleEndianWord(nonce, $0 * 4) }

  for _ in 0..<10 {
    quarterRound(&state, 0, 4, 8, 12)
    quarterRound(&state, 1, 5, 9, 13)
    quarterRound(&state, 2, 6, 10, 14)
    quarterRound(&state, 3, 7, 11, 15)
    quarterRound(&state, 0, 5, 10, 15)
    quarterRound(&state, 1, 6, 11, 12)
    quarterRound(&state, 2, 7, 8, 13)
    quarterRound(&state, 3, 4, 9, 14)
  }

  return [0, 1, 2, 3, 12, 13, 14, 15].flatMap { word in
    (0..<4).map { UInt8(truncatingIfNeeded: state[word] >> (8 * UInt32($0))) }
  }
}

/// The ChaCha20-Poly1305 key and nonce an extended nonce stands for under `key`.
private func innerSealing(key: Data, nonce: [UInt8]) throws -> (SymmetricKey, ChaChaPoly.Nonce) {
  guard key.count == xChaChaKeyBytes else { throw XChaChaPolyError.keyLength }
  guard nonce.count == xChaChaNonceBytes else { throw XChaChaPolyError.nonceLength }
  let subkey = hChaCha20(key: [UInt8](key), nonce: Array(nonce[0..<hChaChaNonceBytes]))
  let inner = try ChaChaPoly.Nonce(data: [0, 0, 0, 0] + nonce[hChaChaNonceBytes...])
  return (SymmetricKey(data: subkey), inner)
}

/// `plain` sealed under `key` with the extended `nonce`, as nonce, ciphertext, and tag.
func xChaChaPolySeal(_ plain: Data, key: Data, nonce: [UInt8]) throws -> Data {
  let (subkey, inner) = try innerSealing(key: key, nonce: nonce)
  let box = try ChaChaPoly.seal(plain, using: subkey, nonce: inner)
  return Data(nonce) + box.ciphertext + box.tag
}

/// What `sealed`, as nonce, ciphertext, and tag, holds under `key`; throws where it does not open.
func xChaChaPolyOpen(_ sealed: Data, key: Data) throws -> Data {
  guard sealed.count >= xChaChaNonceBytes + tagBytes else { throw XChaChaPolyError.sealedLength }
  let bytes = [UInt8](sealed)
  let (subkey, inner) = try innerSealing(key: key, nonce: Array(bytes[0..<xChaChaNonceBytes]))
  let box = try ChaChaPoly.SealedBox(
    nonce: inner,
    ciphertext: bytes[xChaChaNonceBytes..<(bytes.count - tagBytes)],
    tag: bytes[(bytes.count - tagBytes)...]
  )
  return try ChaChaPoly.open(box, using: subkey)
}
