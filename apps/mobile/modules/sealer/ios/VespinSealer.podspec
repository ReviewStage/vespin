# VespinSealer.podspec -- the app's sealer (`SealerModule.swift`, `XChaChaPoly.swift`), which Expo's autolinking finds under `modules/` and builds into the app.
Pod::Spec.new do |s|
  s.name           = 'VespinSealer'
  s.version        = '0.1.0'
  s.summary        = "XChaCha20-Poly1305 sealing and opening of the host's kept files in CryptoKit, in the format the JavaScript cipher writes"
  s.license        = 'UNLICENSED'
  s.author         = 'Vespin'
  s.homepage       = 'https://vespin.dev'
  s.platforms      = { :ios => '26.0' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'CryptoKit', 'Security'

  s.source_files = '*.swift'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
