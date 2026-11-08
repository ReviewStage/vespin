# `@repo/ui-native`

The iOS app's design system, as `@repo/ui` is the DOM's: one rigid set of
React Native components every screen of `apps/mobile` composes, so no screen
builds a control of its own.

- **SwiftUI first.** A component wraps `@expo/ui`'s SwiftUI (`Host`, `List`,
  `Section`, swipe actions, `ContextMenu`, `NavigationSplitView`, the
  system's buttons and `ContentUnavailableView`) in the piece a screen asks
  for: `Screen`, `RowList` and `ListSection`, `ListRow`, `SplitView`,
  `EmptyState`, `PageHeader`, `Button` and `Chip`, `ChoiceList`, and the
  marks (`UnreadDot`, `TaskStatusMark`, `Avatar`). `GlassBar` is a composer's
  bar of Liquid Glass through `expo-glass-effect`.
- **React Native views only where SwiftUI has no piece**, such as the
  transcript's rows and message markdown. `Pressable`, `TextInput`, and the
  rest of React Native's controls appear only here.
- **This is the one workspace that imports `@expo/ui` or `expo-glass-effect`,
  or builds a control from React Native's pieces.** Everywhere else
  `anti-slop/no-raw-press-outside-ui-native` refuses them, and a press prop
  on a React Native primitive, with no disable comment allowed (root
  `AGENTS.md`'s Layout). When a screen needs a piece this package lacks, add
  the component or an `as const` variant here, named for what it does.
- **Colors come from `@repo/brand`.** `src/tokens/brand-colors.ts` is written
  by `packages/brand/scripts/generate-surface-shared.mjs` from the brand's one
  table, in the light theme and the dark; never edit it by hand, and
  `scripts/repository-checks.sh` fails when it drifts. `useColors()` picks the
  theme by the window's color scheme, since SwiftUI is handed plain values.
  Every other color is the system's own: a list's grounds, a label's
  hierarchy, a button's states.
- **Words match the panel's** (`docs/DESIGN.md`): a row's time is
  `@repo/features/time-format`'s, a status's name the panel's.
- **No DOM and no Electron.** React here is the `mobile` catalog's (React
  19.3, as React Native 0.88 is built against), so nothing from `@repo/ui` or
  `@repo/panel` is imported; a DOM-free view model both need moves to a
  package both can import.
- **Tests** cover the view models alone (`src/**/*.test.ts`, under vitest's
  `ui-native` project). The components are checked by the app's Maestro flows
  on the simulators, whose screenshots `apps/mobile/AGENTS.md` says how to
  read.
