// swift-tools-version: 5.9
// Package.swift -- the diff view's syntax coloring as a plain Swift package, with no React Native or UIKit, so `swift build && swift test` checks it on a Mac in minutes. The app's pod (`../VespinDiffView.podspec`) compiles these same sources and depends on the same grammars, pinned alike.

import PackageDescription

let package = Package(
  name: "DiffHighlight",
  platforms: [.macOS(.v13), .iOS(.v17)],
  products: [.library(name: "DiffHighlight", targets: ["DiffHighlight"])],
  dependencies: [
    .package(url: "https://github.com/tree-sitter/swift-tree-sitter", exact: "0.10.0"),
    .package(url: "https://github.com/tree-sitter/tree-sitter-bash", exact: "0.25.1"),
    .package(url: "https://github.com/tree-sitter/tree-sitter-css", exact: "0.23.2"),
    .package(url: "https://github.com/tree-sitter/tree-sitter-go", exact: "0.25.0"),
    .package(url: "https://github.com/tree-sitter/tree-sitter-html", exact: "0.23.2"),
    .package(url: "https://github.com/tree-sitter/tree-sitter-javascript", exact: "0.23.1"),
    .package(url: "https://github.com/tree-sitter/tree-sitter-json", exact: "0.24.8"),
    .package(url: "https://github.com/tree-sitter-grammars/tree-sitter-markdown", exact: "0.5.4"),
    .package(url: "https://github.com/tree-sitter/tree-sitter-python", exact: "0.23.6"),
    .package(url: "https://github.com/tree-sitter/tree-sitter-rust", exact: "0.24.2"),
    // Note that Python's, CSS's, and YAML's newest manifests look for their scanner relative to the directory the build runs in, which leaves it out where they are a dependency, so each is pinned to the last tag that names its scanner outright.
    // Note that Swift's and SQL's grammars commit their generated parsers only on a branch of their own, so each is pinned to a commit of it.
    .package(url: "https://github.com/DerekStride/tree-sitter-sql", revision: "2d088525f3f986108d969dab526a0d7129281e24"),
    .package(url: "https://github.com/alex-pinkus/tree-sitter-swift", revision: "82bb3a533e0801fd2bbaa11dc49676e10bf41948"),
    .package(url: "https://github.com/tree-sitter/tree-sitter-typescript", exact: "0.23.2"),
    .package(url: "https://github.com/tree-sitter-grammars/tree-sitter-yaml", exact: "0.7.0"),
  ],
  targets: [
    .target(
      name: "DiffHighlight",
      dependencies: [
        .product(name: "SwiftTreeSitter", package: "swift-tree-sitter"),
        .product(name: "TreeSitterBash", package: "tree-sitter-bash"),
        .product(name: "TreeSitterCSS", package: "tree-sitter-css"),
        .product(name: "TreeSitterGo", package: "tree-sitter-go"),
        .product(name: "TreeSitterHTML", package: "tree-sitter-html"),
        .product(name: "TreeSitterJavaScript", package: "tree-sitter-javascript"),
        .product(name: "TreeSitterJSON", package: "tree-sitter-json"),
        .product(name: "TreeSitterMarkdown", package: "tree-sitter-markdown"),
        .product(name: "TreeSitterPython", package: "tree-sitter-python"),
        .product(name: "TreeSitterRust", package: "tree-sitter-rust"),
        .product(name: "TreeSitterSql", package: "tree-sitter-sql"),
        .product(name: "TreeSitterSwift", package: "tree-sitter-swift"),
        .product(name: "TreeSitterTypeScript", package: "tree-sitter-typescript"),
        .product(name: "TreeSitterYAML", package: "tree-sitter-yaml"),
      ],
      resources: [.copy("queries")]
    ),
    .testTarget(name: "DiffHighlightTests", dependencies: ["DiffHighlight"]),
  ]
)
