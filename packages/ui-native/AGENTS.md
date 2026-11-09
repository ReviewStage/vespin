# `@repo/ui-native`

The iOS app's design system, as `@repo/ui` is the DOM's: one rigid set of
React Native components every screen of `apps/mobile` composes, so no screen
builds a control of its own.

- **SwiftUI first.** A component wraps `@expo/ui`'s SwiftUI (`Host`, `List`,
  `Section`, swipe actions, `ContextMenu`, `NavigationSplitView`, the
  system's buttons and `ContentUnavailableView`) in the piece a screen asks
  for: `Screen`, `RowList` and `ListSection`, `ListRow` and `TaskRow`, `SplitView`,
  `EmptyState`, `PageHeader`, `Button` and `Chip`, `ChoiceList`, `AuthPage`
  and `ProviderButton`, `SettingsForm` and its rows, and the marks
  (`UnreadDot`, `TaskStatusMark`, `Avatar`, and `BrandMark`, the Keel mark the
  app's asset catalog holds).
  `GlassBar` is a composer's bar of Liquid Glass through `expo-glass-effect`.
- **React Native views only where SwiftUI has no piece**, such as the
  transcript's rows and message markdown. `Pressable`, `TextInput`, and the
  rest of React Native's controls appear only here.
- **Markdown** is drawn by `Markdown` in React Native views, and a page of
  it by `MarkdownPage`, which hosts them in SwiftUI's scroller through
  `RNHostView`. Its words are parsed by `@repo/features/markdown-tree`, the
  parse the panel's other readers share, and read into blocks by
  `markdown-model.ts`, which reads each link as the panel's chip does
  (`linkMention`, `readLink`): a `vespin.dev` place goes to the screen's
  `onOpenPlace`, any other web address to Safari.
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
  The app reads as Vespin beside the desktop, not as iOS's defaults: a
  screen, a list, and a sidebar stand on the brand's `GROUND` and `SIDEBAR`,
  never the system's grays; lists stand plain, as the panel's do, never as
  inset cards; and the tint is the brand's copper, never the system's blue.
  Only a control's states and a label's hierarchy are the system's.
- **Rows are the panel's rows.** `ListRow` is the panel's Inbox row (the
  unread dot, the task's status ring and name with the time, the thread's
  title, and the glyph of what it asks with its words), and `TaskRow` the
  phone's task row; an avatar stands only where the panel's row has one. A
  glyph is the SF Symbol closest to the panel's lucide glyph for the same
  thing (`inbox-line-model.ts`, `status-mark-model.ts`), in the panel's ink.
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
