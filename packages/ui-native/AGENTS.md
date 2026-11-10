# `@repo/ui-native`

The iOS app's design system, as `@repo/ui` is the DOM's: one rigid set of
React Native components every screen of `apps/mobile` composes, so no screen
builds a control of its own.

- **SwiftUI first.** A component wraps `@expo/ui`'s SwiftUI (`Host`, `List`,
  `Section`, swipe actions, `ContextMenu`, `NavigationSplitView`, the
  system's buttons and `ContentUnavailableView`) in the piece a screen asks
  for: `Screen`, `RowList` and `ListSection`, `ListRow` and `TaskRow` (a
  task on one line, its sub-tasks folded under the panel's chevron), a task
  page's rows (`TaskHead`, `AgentRow`, `RelationRow`, `GroupRow`, `LinkRow`,
  and `WordsRow` for its description), `SplitView` (two columns or three, its
  sidebar's bar holding an act, a `BarMenu` such as the ⋯ menu, and a
  search, and its detail's bar the page's path and a `BarMenu` such as a
  task's ⋯), `EmptyState`, `PageHeader`, `ThreadPage`, `Button`, `Chip` and
  `ScopePills`, `FieldChip` and `StatusChip`, the ask's cards (`ChoiceList`
  for a decide, `StepList` for a do with its `AskActs`, `AnswerFields` for an
  answer's fields, and `AskNote` for what a send that did not go said),
  `PullRequestCard`, a pull request's page (`PullRequestHead`, `MarkRow`
  for its checks and reviewers, `WriteNoteRow`), `ConfirmAsk` (the system's
  alert an act asks first in), `AuthPage` and `ProviderButton`, `SettingsForm` and its
  rows, with `WordsField` and `MenuPickRow` for a sheet that starts work,
  `AccountButton`, and the marks (`UnreadDot`, `NeedsYouDot`,
  `WorkingMark`, `FailedMark`, `TaskStatusMark`, `Avatar`, a person's photo
  or their letters, `AgentTile`, and `BrandMark`, the Keel mark the app's
  asset catalog holds). `GlassBar` is a bar of Liquid
  Glass through `expo-glass-effect`, `GlassDock` the screen that pins one
  over its foot above the keyboard, and `Composer` the rounded field a
  thread or a transcript ends with, in one, or `ComposerFoot`, the same
  field at a SwiftUI column's foot in the system's own glass, where no React
  Native bar can stand, such as a split view's detail. Its round button is
  Send, or, with nothing typed, Stop while an agent works, and its head,
  inside the same glass, holds an agent's `QueuedLines` (Steer and Delete),
  its `AttachedPictures`, and an `AskNote`.
- **React Native views only where SwiftUI has no piece**, such as the
  transcript's rows, message markdown, a message's `Picture` that opens full
  screen and zooms, and its `Video` in the system's player through
  `expo-video`, which says so in its place where the player cannot read the
  file. An agent's transcript is `AgentTranscript`, the app's one React
  Native list (a lazy `FlatList`, drawn newest last and anchored there, with
  Jump to latest once the reader scrolls back), under `AgentHead`; its rows
  are read by `transcript-model.ts` from the panel's own parts, folds, and
  call lines (`@repo/features/agent-parts`, `turn-rows`, `tool-call-model`),
  the agent's thinking left out, and each call leads with the glyph for its
  kind, as the rows' glyphs are chosen (`transcript-look.ts`). A pull
  request an agent opened stands under its call as `PullRequestCard`, as the
  task list holds it now. A page an agent showed is `SealedPage`, the app's
  one web view, handed the page's HTML sealed by `@repo/features/sealed-page`. `Pressable`,
  `TextInput`, and the rest of React Native's controls appear only here.
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
- **Rows carry the panel's facts.** `ListRow` is an Inbox thread (the task's
  status ring, the thread's title and time, and the glyph and words of what
  it asks, then the task's name), `TaskRow` a task on one line (its status
  ring, its name, and at its end a thread that needs you, a failed agent,
  one at work, or its pull request, then its key), and `AgentRow` an agent
  on a task's page; an avatar stands only where the panel's row has one. A
  glyph is the SF Symbol closest to the panel's Lucide glyph for the same
  thing (`inbox-line-model.ts`, `status-mark-model.ts`), except a mark of ours that
  SF Symbols has no drawing of (a pull request in each state, a branch, a
  decide ask), which is Lucide's own (`glyph.ts`'s `Glyph`, drawn by
  `ToneGlyph`): `@repo/brand`'s generator outlines it, at the `lucide-react`
  `@repo/ui` pins, into a custom symbol template, and the app's config writes
  it into the asset catalog as a symbol set, so it sizes with Dynamic Type
  and weighs with its words as an SF Symbol does. Tabs, menus, swipe
  actions, and every generic glyph stay SF Symbols.

## Vespin's look

Denser and quieter than iOS's defaults, drawn from Linear, Cursor,
Conductor, Claude and Codex (the developer, Nov 10, 2026), on iOS's own
navigation, tab bar, swipes, menus, sheets and glass.

- **Type scale** (`tokens/type.ts`'s `TYPE_ROLE`), each role a Dynamic Type
  text style, never a fixed size: a row's title 15 pt (`subheadline`),
  medium while unread and regular once read, over a 13 pt muted line
  (`footnote`); a time 12 pt (`caption`); a group header 13 pt muted; a
  screen's title 17 pt semibold, inline in its bar; and a page's heading,
  a thread's or a task's title, 20 pt semibold (`title3`, the style nearest
  21). React Native's words, Markdown's, take `PROSE_SIZE`, 15 pt, which
  React Native scales by the reader's setting. The navigation bar's words are
  the system's fixed sizes (`BAR_TITLE`), as its own titles stand.
- **Inline titles, no large titles.** A tab's root shows its name small and
  inline. A pushed page shows its path (task › agent, repository › key) small
  and muted in the bar, `PATH_PART` joining it, with the page's own heading
  under it; a split view's detail column draws the same path in its bar.
- **Glass header buttons.** Back, search, filter and ⋯ are the system's own
  bar items (`Stack.Toolbar`, `Stack.SearchBar` with `integratedButton`, a
  split view's `ToolbarItem`s), which iOS 26 draws as round glass; the back
  button is the chevron alone. The account's photo leads each tab's root bar
  and opens Settings (`AccountButton`, `SplitView`'s `sidebarAccount`): the
  system stands it in the same round glass, the photo clipped to a circle
  inside. Nothing draws a copy of glass.
- **Rows** stand plain and edge to edge on `GROUND`, never as cards: the
  unread dot in the margin, a 14 pt leading mark in an 18 pt column (the
  status ring, or the ask's glyph on an agent's own thread), the words from
  `ROW_INSET.TEXT`, and a hairline in `CHIP_EDGE` that starts under the
  words.
- **Group headers** (`ListSection`) are small and muted with a count; a
  `foldable` one folds in place on a press, its chevron on the left.
- **Color.** Glyphs stand in the muted ink. Copper is only for what wants
  you: the unread dot, an ask's glyph and words, the selected tab and the
  Inbox count, a picked option, and a primary `Button`. Status tones stand
  on the status marks alone: a task's ring, and a pull request's state.
- **Capsules.** `ScopePills` are a list's scopes in a row under its title,
  the chosen one filled with the ink, and `Chip` one of them; `FieldChip`
  and `StatusChip` read a task's status, priority and assignee. Each stands
  on `SURFACE` inside a hairline.
- **Cards** are kept for what a person acts on: the ask (`ChoiceList`, radio
  rows, a "Recommended" tag and a detail line; `StepList`, a toggle per step,
  with Mark done and Couldn't do it under it; `AnswerFields`, a row per
  field: a text or number field under its label, a select's menu picker, a
  boolean's toggle, the rows a SwiftUI `Form` holds, drawn in a card because
  a `Form` scrolls on its own inside the thread's scroll) and the pull request
  (`PullRequestCard`: its state's glyph, its title, its lines in green and
  red, and its acts as pills; a press on it opens its own page), each on
  `SURFACE` inside a hairline.
- **A pull request's page** reads as the panel's Pull request tab, from the
  same model (`@repo/features/pull-request-model`): its state as a chip in
  GitHub's color, the merge queue's in the attention ink with its place
  ("Queued #2"), its branches, and GitHub's sentence of whether it merges;
  its checks and reviewers as rows, each glyph the SF Symbol closest to the
  panel's (`pull-request-look.ts`); and its acts in the bar, an act that
  asks first asking in `ConfirmAsk`.
- **The tab bar** is `NativeTabs`: icons alone in a compact window, through
  its `Label`'s own `hidden`, the Inbox count in copper, and the round + for
  New task; a regular window's sidebar keeps its labels.

## Words

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
