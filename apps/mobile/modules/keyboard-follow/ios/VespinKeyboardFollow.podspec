# VespinKeyboardFollow.podspec -- the app's keyboard follower (`KeyboardFollowModule.swift`), which Expo's autolinking finds under `modules/` and builds into the app.
Pod::Spec.new do |s|
  s.name           = 'VespinKeyboardFollow'
  s.version        = '0.1.0'
  s.summary        = "A composer's dock lifted with the keyboard on every frame, its interactive dismissal included"
  s.license        = 'UNLICENSED'
  s.author         = 'Vespin'
  s.homepage       = 'https://vespin.dev'
  s.platforms      = { :ios => '26.0' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'UIKit', 'QuartzCore'

  s.source_files = '*.swift'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
