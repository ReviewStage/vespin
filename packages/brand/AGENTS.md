# `@repo/brand`

The product's brand: the design sources, the generators that cut every
committed copy from them, and what those copies are.

- `assets/` holds the SVG and PNG sources and the cut artwork: icon, mark,
  logo, wordmark, avatar, banner, DMG background, social card, download
  button. `README.md` is the asset sheet.
- `scripts/` holds the two generators (`pnpm --filter @repo/brand generate`),
  the brand's color table both read (`brand-palette.mjs`), and the DMG window
  layout the desktop's packaging reads.
- `src/` holds geometry and the generated mark art, brand palette, motion
  tokens, provider-mark paths, and Lucide symbol templates the apps draw
  from; the templates are outlined by `scripts/lucide-symbols.mjs` from the
  `lucide-react` `@repo/ui` resolves.

Regenerate the generated files (under `src/generated/`, `assets/`, and
`@repo/ui`'s `src/tokens/brand.css`, `identity.css`, and `motion-tokens.css`,
and `@repo/ui-native`'s `src/tokens/brand-colors.ts`, `identity-hues.ts`, and
`lucide-symbols.ts`)
from the sources rather than hand-editing (`pnpm --filter @repo/brand generate`).

This package draws nothing itself. `@repo/ui` is the shared React layer
that traces the generated artwork into the window (`ProductMark`), so the mark
and the glyphs have one implementation.
