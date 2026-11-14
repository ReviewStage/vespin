// VoiceAudioModule.swift -- a voice call's voice from the iPhone's speaker, as ChatGPT's voice mode plays it, or from headphones or a Bluetooth headset while one is connected.
//
// WebRTC sets the audio session itself each time a call's audio starts, from
// the configuration it holds for that (`RTCAudioSessionConfiguration`), so
// the speaker is asked for there rather than on the session, which WebRTC
// would set over. Its own configuration is kept whole, play and record in
// the voice chat mode, whose echo cancellation keeps the voice out of the
// microphone, and the speaker is added as the route where no headphones are
// connected. A route the person picks in Control Center still wins.

import AVFoundation
import ExpoModulesCore
import WebRTC

public final class VoiceAudioModule: Module {
  public func definition() -> ModuleDefinition {
    Name("VoiceAudio")

    // Plays every call's voice from the speaker, where no headphones are connected, from the next time its audio starts.
    Function("preferSpeaker") {
      let configuration = RTCAudioSessionConfiguration.webRTC()
      configuration.category = AVAudioSession.Category.playAndRecord.rawValue
      configuration.mode = AVAudioSession.Mode.voiceChat.rawValue
      configuration.categoryOptions = [.defaultToSpeaker, .allowBluetoothHFP]
      RTCAudioSessionConfiguration.setWebRTC(configuration)
    }
  }
}
