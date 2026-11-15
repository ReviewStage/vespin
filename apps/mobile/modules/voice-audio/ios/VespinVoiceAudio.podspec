# VespinVoiceAudio.podspec -- the app's voice call audio route (`VoiceAudioModule.swift`), which Expo's autolinking finds under `modules/` and builds into the app.
Pod::Spec.new do |s|
  s.name           = 'VespinVoiceAudio'
  s.version        = '0.1.0'
  s.summary        = "A voice call's voice played from the speaker, or from headphones while any are connected"
  s.license        = 'UNLICENSED'
  s.author         = 'Vespin'
  s.homepage       = 'https://vespin.dev'
  s.platforms      = { :ios => '26.0' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  # The WebRTC framework react-native-webrtc links, whose audio session this sets.
  s.dependency 'JitsiWebRTC', '~> 155.0.0'
  s.frameworks = 'AVFoundation'

  s.source_files = '*.swift'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
