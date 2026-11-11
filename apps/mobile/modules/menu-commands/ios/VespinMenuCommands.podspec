# VespinMenuCommands.podspec -- the app's iPad menu bar (`MenuBar.swift`), which Expo's autolinking finds under `modules/` and builds into the app.
Pod::Spec.new do |s|
  s.name           = 'VespinMenuCommands'
  s.version        = '0.1.0'
  s.summary        = "Vespin's iPad menu bar, its commands handed to the app's JavaScript"
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
