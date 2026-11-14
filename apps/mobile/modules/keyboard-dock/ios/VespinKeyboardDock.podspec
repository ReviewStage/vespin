# VespinKeyboardDock.podspec -- the dock that lifts a composer with the keyboard (`KeyboardDockModule.swift`), which Expo's autolinking finds under `modules/` and builds into the app.
Pod::Spec.new do |s|
  s.name           = 'VespinKeyboardDock'
  s.version        = '0.1.0'
  s.summary        = "A screen's foot that lifts its bar with the system's keyboard, frame by frame, through UIKit's keyboard layout guide"
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
