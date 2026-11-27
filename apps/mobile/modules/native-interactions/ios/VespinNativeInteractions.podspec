# VespinNativeInteractions.podspec -- the SwiftUI modifiers @expo/ui lacks (`NativeInteractionsModule.swift`): a list row's focus ring left off, a bar's subtitle, drag and drop, and a row's menu and swipes built from data (`RowMenu.swift`), and a chip's long press menu (`ContextMenuView.swift`). Expo's autolinking finds it under `modules/` and builds it into the app.
Pod::Spec.new do |s|
  s.name           = 'VespinNativeInteractions'
  s.version        = '0.1.0'
  s.summary        = "The focus ring, bar subtitle, drag, drop, and row menu modifiers Vespin's screens hand @expo/ui, and a chip's context menu view"
  s.license        = 'UNLICENSED'
  s.author         = 'Vespin'
  s.homepage       = 'https://vespin.dev'
  s.platforms      = { :ios => '26.0' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.dependency 'ExpoUI'
  s.frameworks = 'GameController'

  s.source_files = '*.swift'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
