# VespinDiffView.podspec -- the app's view of a changed file's diff (`DiffViewModule.swift`), a collection view of one row per line, which Expo's autolinking finds under `modules/` and builds into the app.
Pod::Spec.new do |s|
  s.name           = 'VespinDiffView'
  s.version        = '0.1.0'
  s.summary        = "A changed file's diff drawn natively, one recycled row per line, its geometry worked out from the monospaced face alone"
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
