# VespinDiffView.podspec -- the app's view of a changed file's diff (`DiffViewModule.swift`), a collection view of one row per line colored by tree-sitter (`DiffHighlight/`), which Expo's autolinking finds under `modules/` and builds into the app.
#
# The highlighter's sources are a plain Swift package of their own
# (`DiffHighlight/Package.swift`), so `swift test` checks them on a Mac
# without the app; the pod compiles the same sources into the view's module,
# carries their highlight queries as a resource bundle, and depends on the
# same grammars through Swift Package Manager (React Native's `spm_dependency`),
# each pinned exactly as the package pins it. Keep the two lists alike.

# The grammars and the binding, as `DiffHighlight/Package.swift` pins them: each repository, its pin, and its product.
DIFF_HIGHLIGHT_PACKAGES = [
  ['https://github.com/tree-sitter/swift-tree-sitter', { kind: 'exactVersion', version: '0.10.0' }, 'SwiftTreeSitter'],
  ['https://github.com/tree-sitter/tree-sitter-bash', { kind: 'exactVersion', version: '0.25.1' }, 'TreeSitterBash'],
  ['https://github.com/tree-sitter/tree-sitter-css', { kind: 'exactVersion', version: '0.23.2' }, 'TreeSitterCSS'],
  ['https://github.com/tree-sitter/tree-sitter-go', { kind: 'exactVersion', version: '0.25.0' }, 'TreeSitterGo'],
  ['https://github.com/tree-sitter/tree-sitter-html', { kind: 'exactVersion', version: '0.23.2' }, 'TreeSitterHTML'],
  ['https://github.com/tree-sitter/tree-sitter-javascript', { kind: 'exactVersion', version: '0.23.1' }, 'TreeSitterJavaScript'],
  ['https://github.com/tree-sitter/tree-sitter-json', { kind: 'exactVersion', version: '0.24.8' }, 'TreeSitterJSON'],
  ['https://github.com/tree-sitter-grammars/tree-sitter-markdown', { kind: 'exactVersion', version: '0.5.4' }, 'TreeSitterMarkdown'],
  ['https://github.com/tree-sitter/tree-sitter-python', { kind: 'exactVersion', version: '0.23.6' }, 'TreeSitterPython'],
  ['https://github.com/tree-sitter/tree-sitter-rust', { kind: 'exactVersion', version: '0.24.2' }, 'TreeSitterRust'],
  ['https://github.com/alex-pinkus/tree-sitter-swift', { kind: 'revision', revision: '82bb3a533e0801fd2bbaa11dc49676e10bf41948' }, 'TreeSitterSwift'],
  ['https://github.com/tree-sitter/tree-sitter-typescript', { kind: 'exactVersion', version: '0.23.2' }, 'TreeSitterTypeScript'],
  ['https://github.com/tree-sitter-grammars/tree-sitter-yaml', { kind: 'exactVersion', version: '0.7.0' }, 'TreeSitterYAML'],
]

Pod::Spec.new do |s|
  s.name           = 'VespinDiffView'
  s.version        = '0.1.0'
  s.summary        = "A changed file's diff drawn natively, one recycled row per line, its geometry worked out from the monospaced face alone and its code colored by tree-sitter"
  s.license        = 'UNLICENSED'
  s.author         = 'Vespin'
  s.homepage       = 'https://vespin.dev'
  s.platforms      = { :ios => '26.0' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = ['*.swift', 'DiffHighlight/Sources/DiffHighlight/*.swift']
  s.resource_bundles = { 'VespinDiffViewQueries' => ['DiffHighlight/Sources/DiffHighlight/queries/*.scm'] }
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  DIFF_HIGHLIGHT_PACKAGES.each do |url, requirement, product|
    spm_dependency(s, url: url, requirement: requirement, products: [product])
  end
end
