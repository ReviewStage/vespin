# VespinShareExtension.podspec -- the share extension's door from its JavaScript to its view controller (`ShareExtensionModule.swift`), which Expo's autolinking finds under `modules/` and the Podfile builds into the share extension alone (`app.config.ts`).
Pod::Spec.new do |s|
  s.name           = 'VespinShareExtension'
  s.version        = '0.1.0'
  s.summary        = "The share extension's page's door to what was shared, the snapshot, the token at send time, the draft, and the notification"
  s.license        = 'UNLICENSED'
  s.author         = 'Vespin'
  s.homepage       = 'https://vespin.dev'
  s.platforms      = { :ios => '26.0' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '*.swift'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
