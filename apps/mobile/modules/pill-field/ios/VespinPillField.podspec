# VespinPillField.podspec -- the app's text field that draws mentions and files' markers as pills inside its words (`PillFieldModule.swift`), which Expo's autolinking finds under `modules/` and builds into the app.
Pod::Spec.new do |s|
  s.name           = 'VespinPillField'
  s.version        = '0.1.0'
  s.summary        = "A growing text field on TextKit 2 whose mentions and files' markers stand as pills, each written back as the Markdown it was handed"
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
