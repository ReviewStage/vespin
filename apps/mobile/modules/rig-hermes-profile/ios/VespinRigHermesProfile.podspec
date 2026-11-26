# VespinRigHermesProfile.podspec -- the rig's Hermes sampling profile of a launch, started at load under `-hermesProfileSeconds <n>` and written beside the busy account's answers (`VespinRigHermesProfile.mm`); a probe of the rig alone, never shipped.
Pod::Spec.new do |s|
  s.name           = 'VespinRigHermesProfile'
  s.version        = '0.1.0'
  s.summary        = "The rig's Hermes sampling profile of a launch"
  s.license        = 'UNLICENSED'
  s.author         = 'Vespin'
  s.homepage       = 'https://vespin.dev'
  s.platforms      = { :ios => '26.0' }
  s.source         = { git: '' }
  s.static_framework = true

  s.source_files = '*.{h,mm}'
  s.dependency 'hermes-engine'
  s.dependency 'React-jsi'
  s.pod_target_xcconfig = {
    'CLANG_CXX_LANGUAGE_STANDARD' => 'c++20'
  }
end
