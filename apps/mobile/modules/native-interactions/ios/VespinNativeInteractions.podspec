# VespinNativeInteractions.podspec -- the SwiftUI modifiers @expo/ui lacks (`NativeInteractionsModule.swift`): an iPad pointer's hover, and drag and drop. Expo's autolinking finds it under `modules/` and builds it into the app.
Pod::Spec.new do |s|
  s.name           = 'VespinNativeInteractions'
  s.version        = '0.1.0'
  s.summary        = "The hover effect, drag, and drop modifiers Vespin's screens hand @expo/ui"
  s.license        = 'UNLICENSED'
  s.author         = 'Vespin'
  s.homepage       = 'https://vespin.dev'
  s.platforms      = { :ios => '26.0' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.dependency 'ExpoUI'

  s.source_files = '*.swift'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
