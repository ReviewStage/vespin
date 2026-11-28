# `@repo/ui-native`

The iOS app's design system, as `@repo/ui` is the DOM's: one rigid set of
React Native components every screen of `apps/mobile` composes, so no screen
builds a control of its own.

- **SwiftUI first.** A component wraps `@expo/ui`'s SwiftUI (`Host`, `List`,
  `Section`, swipe actions, `ContextMenu`, `NavigationSplitView`, the
  system's buttons and `ContentUnavailableView`) in the piece a screen asks
  for: `Screen`, `RowList` and `ListSection`, `ListRow` and `TaskRow` (a
  task on one line, its sub-tasks folded under SwiftUI's own disclosure), each
  row's acts behind a swipe from either edge, a full swipe running the
  first, and in its long press menu, which lifts the row's preview
  (`threadPreview`, `taskPreview`, `agentPreview`) and leads with Open,
  and a row's link, which an iPad drags out of it (`interactions.ts`, the
  drag and drop modifiers the app's native module registers), a
  task page's rows (`TaskHead`, `AgentRow`, `RelationRow`, `LinkRow`, and
  `WordsRow` for its description), `SplitView` (a tab's list
  and its detail beside the system's tab sidebar, each column under its own
  `ColumnBar`: its title, large under the list's bar, what leads it such as the workspace
  switcher, its `lead` glyphs such as compose,
  a path, a page's main acts as glyphs in the bar's one glass before its ⋯
  (two or three, dimmed rather than gone with nothing picked, the rest left
  in ⋯ by `menuWithout`), a
  `BarMenu` such as the ⋯ menu, an
  act, a search, and the acts at its foot, the list shown or hidden as its
  caller says), `EmptyState`, `PageHeader`, `ThreadPage`, `Button`, `Chip` and
  `ScopePicker` (a list's scopes as the system's segmented control, or its menu picker in a split view's narrow list column), `FieldChip` and `StatusChip`, the ask's cards (`ChoiceList`
  for a decide, `StepList` for a do with its `AskActs`, `AnswerFields` for an
  answer's fields, each with no press handed it standing as an answer left
  it, its picks checked, at the head of the reply that answered it, as the
  panel's answered card, `ResolvableAsk` standing an open card's × Resolve at
  its top end, as the panel's question stands it, and `AskNote` for what a
  send that did not go said),
  `PullRequestCard`, a pull request's page (`PullRequestHead`, `MarkRow`
  for its checks and reviewers, `WriteNoteRow`, `MergeActRow` for its
  merge under its heading), `ConfirmAsk` (the question
  an act asks first: the system's action sheet in a compact window, its act
  first and Cancel below it, which iOS 26 stands centered since no view of
  ours raised it, and its alert in a regular one or where words must be
  typed), `WordsAsk` (the system's alert words are typed in,
  such as an invitation's address), `AuthPage` and `ProviderButton`, `SettingsForm` and its
  rows, with `WordsField` (its `SECRET` look the system's secure field, for a key or
  a token pasted), `AttachRow`, and `MenuPickRow` for a form's words,
  pictures and choices, `StartPage` for a page that starts work, as a new
  conversation starts in Messages, ChatGPT and Claude (an empty page over
  the agent page's own `Composer`, docked on the keyboard, with the + and
  the `MenuChip` capsule menus in a row under its field inside the same
  glass, so the keyboard never covers them, each capsule led by the
  panel's glyph or a model's harness mark),
  `ToggleRow` for a setting or an agent's option, `askForName` (the system's alert a name is
  typed in, its act preferred, for a task and an agent alike), `ScriptRow` (a script read whole in the monospaced
  face),
  `AccountButton`, `PermissionAsk` (a row heading a list, its `RowList`'s
  `lead`, that asks in place for what the app lacks, as Apple asks: why in
  one line, the act that raises the system's own prompt or, once refused,
  opens Settings, never worded "Allow", and Not Now), `FailureNoticeProvider` (the app's one notice that a
  write did not go: a banner of Liquid Glass in one fixed place, dropping in
  under the top bar inside the safe area as the system's banners drop in,
  below an iPad's floating tab bar and a tab's column bars, which the tab
  in front tells it of (`FailureNoticeBars`), swiped up to let go, with the refusal's words and Try again, said aloud by
  VoiceOver, faded rather than slid where the reader reduces motion, standing
  over the app's root view or the sheet on top (`FailureNoticeLayer`; not a
  `FullWindowOverlay`, whose window never drew on iOS 27.2), and said once
  for a stretch offline, `failure-notice-model.ts`),
  and the marks (`UnreadDot`, `NeedsYouDot`,
  `WorkingMark`, the panel's own two pixels chasing round a 3×3 grid on the
  one 200 ms beat every mark shares (`working-beat.ts`), held mid-lap where
  the reader reduces motion, wherever an agent is at work, the system's
  spinner kept for a read in flight, `FailedMark`, `TaskStatusMark`, `Avatar`, a person's photo
  or their letters, `AgentTile`, and `BrandMark`, the Keel mark the app's
  asset catalog holds). `GlassBar` is a bar of the
  system's Liquid Glass (`BAR_GLASS`, SwiftUI's `glassEffect`), `GlassDock` the screen that pins one
  over its foot above the keyboard, and `Composer` the rounded field a
  thread or a transcript ends with, in one, or `ComposerFoot`, the same
  field at a SwiftUI column's foot in the system's own glass, where no React
  Native bar can stand, such as a split view's detail. Its round button is
  Send, or, with nothing typed, Stop while an agent works; its + is one act
  or a native menu (`ComposerMenu`: an agent's Photos and MCP servers, as
  the desktop's + holds them); where it holds capsules it stands as the
  desktop composer does, its field on top, one line until its words wrap,
  and under it one row of the + and the capsules saying where the
  message runs, then at its end the model chip (`trailing`, whose sheet
  holds the model, effort, Fast and the permission mode, each once, a
  popover from the chip in a regular window, `ModelChoicePopover`),
  Dictate, and Send, a dictation under way standing its strip in the row's
  place (✕, how long it has run, ✓, then Transcribing), as the desktop's;
  and over it stands one row of capsules (`DockChips`, the
  developer's pick, Nov 21, 2026), each the system's glass button with a
  count and a noun, copper only on a count that waits on the reader: an
  agent's calls waiting ("Approval 1", which scrolls to the call's row, or
  opens the `HeldCallBanner` of a call no row draws, such as a subagent's,
  in a `DockPanel` under the row, VoiceOver hearing that a message sent now
  denies them), its Inbox threads ("Inbox 7", the panel's threads dock,
  opening the thread it names), its pull request ("#128", opening its
  page), and its queue ("2 queued", opening its `QueuedLines`, with Steer
  and Delete, under the row, held open while one is edited), the row
  scrolling sideways where it outruns the column and stepping aside while
  a `/` or an `@` offers its list; and its head, inside the same glass,
  holds the `SkillSuggestions` a `/` offers, the `MentionSuggestions` an `@`
  offers (the panel's groups and words, each row led by the mark its pill
  wears, a bare `@` listing Suggested then Browse, a row per kind with
  iOS's chevron, and a list narrowed to one kind, `@people:`, standing
  under its crumb, whose ‹ widens it), its `AttachedPictures`, an `EditingLine` with Cancel while the field
  holds a sent message's words to send in its place (the panel's Edit, the field
  taking the keyboard through `focusAsk`), an `AskNote`, and an agent's
  `ContinueLine` (why its turn failed and Continue in new agent, where only a
  new agent goes on, as the panel's failed end line offers it). While the
  agent is archived, `ArchivedBar` stands in the composer's place, in the
  same glass, saying so beside Unarchive, as the panel's note stands in its
  box's.
- **`PillField`** is the one field whose words hold pills: each mention and
  each marker of a held file drawn as the chip it becomes once sent
  (`pill-look.ts`), selected and deleted as one, copied as its Markdown,
  in the app's native pill field (`pill-field-native.ts`, UIKit's text view
  on TextKit 2), its value the wire's Markdown read through
  `@repo/features/pill-words`. It grows from one line to `maxLines` and then
  scrolls, tells the `@` word the caret stands in (`onAtWord`), and puts a
  picked pill in that word's place (`pick`). A held picture's pill wears its
  thumbnail in its glyph's place (`thumbnails`, the file the app writes each
  picture's bytes to, which the Swift draws through SDWebImage, expo-image's
  own engine, decoded at the pill's size into expo-image's cache), as the
  panel's box draws a picture's chip,
  and a press on it opens the picture full screen (`onPicturePress`) where
  any other pill's press places the caret.
- **React Native views only where SwiftUI has no piece**, such as the
  transcript's rows, message markdown, a message's `Picture` that opens full
  screen and zooms, a picture its words name by its marker ("[Picture 1]")
  standing where they name it as its chip, its thumbnail and name, as the
  panel's `AttachmentRef` does, opening the same viewer, so only the pictures
  its words name none of stand over its bubble, and its `Video` in the system's player through
  `expo-video`, which says so in its place where the player cannot read the
  file. A long press on a picture, a recording, a file's chip, or a message
  opens SwiftUI's own menu over it (`HeldMenu`, hosting the views back inside
  it): Copy, Save to Photos, and Share… as `keep-model.ts` offers each kind,
  the picture viewer's share button holding the same, and on a message's
  words Copy message, Copy link where it has an address, Select text (its
  words selected in the bubble itself, in the system's text view with its
  handles and edit menu, as Messages does, `MessageWords`; a message SwiftUI
  draws offers none) and Share, a
  sent line's menu headed by its time (`MessageMenu`), as Messages and
  ChatGPT head one; an agent's finished turn ends on a standing row of the
  panel's glyphs, Copy, Copy link and Share, with a ⋯ for what else it
  offers (`TurnActs`), since a phone has no hover to show the panel's; the
  app answers them through `KeepingProvider`. A
  mention's chip, which stands inside a line of words where no SwiftUI menu
  can wrap it, opens UIKit's own context menu instead (`ContextMenu`, from
  the same tree), Open link and Copy link, as the panel's link menu offers
  them; UIKit gives a hold to the innermost menu, so the chip's wins over
  the message's own, as a link held in a Messages bubble does. An agent's transcript is `AgentTranscript`, the app's one React
  Native list (FlashList's chat list, drawn newest last, opening at its
  newest row and keeping it in view as rows land, its `maintainVisibleContentPosition`
  rather than timers of ours, with
  Jump to latest once the reader scrolls back, and its older pages read as
  the reader scrolls up to its oldest row, which holds its place as they
  land); a call the agent holds for an answer says so under its line with
  Deny, Always allow and Allow; its rows
  are read by `transcript-model.ts` from the panel's own parts, folds, and
  call lines (`@repo/features/agent-parts`, `turn-rows`, `tool-call-model`),
  the agent's thinking left out, and each call leads with the glyph for its
  kind, as the rows' glyphs are chosen (`transcript-look.ts`). A pull
  request an agent opened stands in its call's place as `PullRequestCard`, as the
  task list holds it now. A page an agent showed is `SealedPage`, the app's
  one web view a reader sees, handed the page's HTML sealed by `@repo/features/sealed-page`;
  a description's Mermaid fences are drawn by `DiagramRenderer`, Mermaid
  run in a hidden sealed web view only while words with a fence stand, each
  diagram handed back as a picture (`DiagramBlock`). `Pressable`,
  `TextInput`, and the rest of React Native's controls appear only here. SwiftUI standing inside those views, such as a message's long press
  menu, a call's glyph, or a pull request card in a transcript, stands in
  `InlineHost`, which ignores the window's safe area, so a row scrolled
  under the bar or over the keyboard draws where the row is.
- **Markdown** is drawn by `Markdown` in React Native views, and a page of
  it by `MarkdownPage`, which hosts them in SwiftUI's scroller through
  `RNHostView`. Its words are parsed by `@repo/features/markdown-tree`, the
  parse the panel's other readers share, and read into blocks by
  `markdown-model.ts`, which reads each link as the panel's chip does
  (`linkMention`, `readLink`): a `vespin.dev` place goes to the screen's
  `onOpenPlace`, any other web address to Safari.
- **This is the one workspace that imports `@expo/ui`, or builds a control from React Native's pieces.** Everywhere else
  `vespin/no-raw-press-outside-ui-native` refuses them, and a press prop
  on a React Native primitive, with no disable comment allowed (root
  `AGENTS.md`'s Layout). When a screen needs a piece this package lacks, add
  the component or an `as const` variant here, named for what it does.
- **Colors come from `@repo/brand`.** `src/tokens/brand-colors.ts` is written
  by `packages/brand/scripts/generate-surface-shared.mjs` from the brand's one
  table, in the light theme and the dark; never edit it by hand, and
  `scripts/repository-checks.sh` fails when it drifts. `useColors()` picks the
  theme by the window's color scheme, since SwiftUI is handed plain values.
  The app reads as Vespin beside the desktop, not as iOS's defaults: a
  screen and a list stand on the brand's `GROUND` and `SIDEBAR`, never the
  system's grays, and so do a split view's list and detail columns
  themselves (`containerBackground`) and a sheet or popover to its edge
  (`presentationBackground`), every sheet and popover, an iPhone's card as
  much as an iPad's form sheet, lifted in dark onto the panel's dialog fill
  (`useColors`'s lifted theme, under `ElevatedGround` or `useColors(true)`),
  every ground in it included, as iOS lifts presented content, so it never
  stands as black as the page behind it. The one exception is a short route
  sheet at half height in a compact window, which iOS floats as Liquid Glass
  and which stands on that glass alone, unlifted (see Grouped forms), unless
  the reader reduces transparency; a split view's sidebar paints nothing, so it
  stands clear on the system's floating glass pane, as Mail's does; lists stand plain, as the panel's do, never as
  inset cards (a page of one thing's sections, such as a task's, stands
  `LIST_LOOK.DETAIL`, the system's grouped list, so its headers scroll away
  rather than pin under the bar, its rows still clear on the ground); and the tint is the brand's copper, never the system's blue.
  Only a control's states and a label's hierarchy are the system's.
- **Rows carry the panel's facts.** `ListRow` is an Inbox thread in the
  panel's three lines (the task's status ring and name, then the thread's
  title and time, then the glyph and words of what it asks; an agent's own
  thread, with no task, in two), `TaskRow` a task on one line, as the
  panel's sidebar row draws it (its status ring; its name,
  set in semibold while it has news with no unread dot; and at its end the
  stop sign of a blocked task, a thread that needs you, its sub-tasks as a
  ring and "2/5", one mark for its agents, the face of who is on it where
  that is someone other than the reader or the dashed mark where no one is,
  and when it last moved, the agents' mark and then the sub-tasks' progress
  stepping aside before a long name is cut, as Mail's rows keep the
  sender's name, `task-row-fit-model.ts`; a search's finds end in its key; its priority
  stands on the task's own Priority chip, not the row; a parent stands as the
  label of `RowDisclosure`, SwiftUI's own `DisclosureGroup`, whose chevron at
  the line's trailing edge folds its sub-tasks, as Files and Notes fold a
  folder), and `AgentRow` an agent
  on a task's page; an avatar stands only where the panel's row has one.
- **A standard act is the system's symbol; our own things are the panel's glyph**
  (the developer, Nov 27, 2026, refining the Nov 12 rule that every glyph
  is the panel's). Every glyph is named once in `glyph.ts`'s `GLYPH`, by
  what it marks: a tab, a row's and a status's mark, a menu's item, a
  toolbar's button, and a composer's button alike. A standard act iOS has
  its own symbol for (⋯ `ellipsis`, compose `square.and.pencil`, search,
  +, copy, delete, rename, pin, mark read or unread, archive, move, a
  reminder's time, the composer's and a call's buttons) is the SF Symbol
  Apple's own apps draw for the same job, as Mail, Files, Notes and
  Reminders draw it, so a bar, a menu, and a swipe read as theirs do; so
  are Share, a sheet's close, the chevron at the end of a Settings row that
  goes on, the small arrow out at the end of one that leaves the app, and
  the up-and-down chevron at the end of one whose press opens a menu. Our
  own places and things, which the brand draws the same on every client
  (the Inbox, Tasks and Automations, the tab bar's included, an
  automation's runs and triggers, an agent, a Manager, a task, a pull
  request, a branch, an ask's kind, a skill, a memory), and an act SF
  Symbols has no symbol for (Unlink), is the panel's own Lucide glyph for
  the same place:
  `@repo/brand`'s generator outlines each, at the `lucide-react` `@repo/ui`
  pins, into a custom symbol template the app's config writes into the
  asset catalog as a symbol set, so it sizes with Dynamic Type and weighs
  with its words as an SF Symbol does. Where the panel draws a mark of its
  own rather than a Lucide glyph (a check box, a face, an MCP server, the
  panel's product mark), its drawing is SF Symbols' nearest. A glyph is a
  branded `Glyph`, minted only in that table, so no component takes a bare
  SF Symbol's name; `apps/mobile`'s tab icons and toolbar items, which
  expo-router types as plain names, take `GLYPH.X` too (`glyphSymbol` where
  a symbol's name is asked for, `glyphIcon` where the bottom bar or the tab
  bar asks for `sf` or `xcasset`). A task's status ring is the panel's own
  mark, cut into the asset catalog from `@repo/brand`'s table
  (`task-status-marks.mjs`) that `@repo/ui`'s `TaskStatusMark` draws too. A SwiftUI button or menu
  holding a glyph takes it as its label's icon (`glyph-label.tsx`), since
  `systemImage` reads an SF Symbol alone, and a React Native view through
  `expo-symbols`' `SymbolView`, which the app's patch reads from the asset
  catalog too, so a glyph costs no SwiftUI host of its own.

## Vespin's look

Quieter than iOS's defaults, with a muted palette and plain rows (the
developer, Nov 10, 2026), in iOS's standard text sizes (the developer, Nov
18, 2026), on iOS's own navigation, tab bar, swipes, menus, sheets and glass.

- **Type scale** (`tokens/type.ts`'s `TYPE_ROLE`) is iOS's standard text
  styles, read as Mail, Settings and Messages read at the default Dynamic
  Type size, each role a text style and never a fixed size: a row's title,
  a Settings row's words, a message's words and the composer's in the body
  style (17 pt), semibold while unread and regular once read, over a muted
  line in the subheadline style (15 pt); a time, a tag and a group header in
  the footnote style (13 pt); a line that leads a row, such as an Inbox
  thread's task line, the row's largest words, in the headline style (17 pt
  semibold) with its time at that line's end, and the title under it in the
  subheadline style in the ink (`ROW_SUBJECT`) over its muted preview, both
  flush with its ring, as Mail's sender leads its subject; a pushed
  screen's title in the headline style, inline in its bar; and a page's heading, a
  thread's or a task's title, in title 3 (20 pt) semibold. React Native's
  words, a transcript's and Markdown's, take the same styles' sizes
  (`PROSE_SIZE`, the body's, and `ROLE_SIZE`), which React Native scales by
  the reader's setting. A height, an inset, or a mark beside words follows
  the text rather than assuming a size (`ROW_INSET.VERTICAL` stands a row of
  one line 44 pt tall, as iOS's rows stand). The navigation bar's words and
  the tab bar are the system's own (`BAR_TITLE`), as its titles stand.
- **Large titles on the tab roots, inline titles on pages** (the developer,
  Nov 20, 2026). A tab's root (Inbox, Tasks, Search) names itself in the
  stack's large title under its bar, collapsing into the bar as its list
  scrolls, as Mail, Notes and Reminders do, its photo, switcher, ⋯ and View
  options staying in the bar above it. A split view's list stands its title
  large under its bar too (`toolbarTitleDisplayMode("large")`), never
  leading it, since its bar also holds the switcher, ⋯ and the sidebar
  button, which a leading title folds into an overflow, and its search
  is the system's field in its own column, never a lone button over the
  detail, whose bar stays the page's alone. A pushed page shows its path (task › agent, repository › key) small
  and muted in the bar, `PATH_PART` joining it, with the page's own heading
  under it; a split view's detail column draws the same path in its bar, but
  for a thread's, which heads the page over its title (`pathInHead`), so the
  column's narrow bar holds the thread's acts and the path's words stand uncut.
  A thread's path opens its task and its agent, as the panel's crumbs do: in a
  split view the path is a menu of them under a small chevron, as iOS's
  title menus stand (`PathTitle`'s `actions`), and in a compact window, whose
  stack's title holds no menu, they lead its ⋯ menu, headed by the path. A
  compact window's thread names itself in the stack's bar in the ink, as
  Messages names a conversation, since it opens at its newest message with
  its heading out of sight; a split view's detail keeps the path and title
  heading the page, as Mail's message stands. An
  agent's page names the agent in the bar in the ink instead, as Messages
  names a conversation, since its transcript opens at its newest row, with
  where it stands muted under the name ("Working"), its model standing on
  the composer's model chip alone, as the panel's page names it: the
  stack's own title over UIKit's own subtitle (`StackSubtitle`). A page opened from a split view's detail, such as a
  task's agent, its pull request, or a thread's task, is pushed on the
  tab's own stack over the whole window, as a compact window pushes it,
  never inside the detail's column.
- **Glass header buttons.** Back, search, filter and ⋯ are the system's own
  bar items (`Stack.Toolbar`, `Stack.SearchBar` with `integratedButton`, a
  split view's `ToolbarItem`s), which iOS 26 draws as round glass; the back
  button is the chevron alone, and a column's ⋯ is its glyph alone
  (`BarMenuItem`), never a menu's own button inside the bar's glass. One button leads every tab's root bar, as
  Notion's does: the workspace switcher (`WorkspaceSwitcher`, the tile alone
  at the photo's size in the bar's round glass, `SWITCHER_LOOK.TILE`, so the
  screen's title keeps its place beside it, as the App Store's photo does), whose menu, the
  system's own (`Menu` in `Section`s, as Notion's), holds each workspace by
  its photo, read from a file (`MenuPhoto`), or its letter tile in its hue,
  the chosen one checked as a `Toggle`, then New workspace, then the chosen
  workspace's Manage in a section its name heads, and last the account by its
  photo as Settings, every row one line at the default size, in every window; the account's
  photo (`AccountButton`) only before the workspaces are read, opening
  Settings, which the system stands in the same round glass, the photo
  clipped to a circle inside. Settings opens from the switcher's menu and
  ⌘,, as Notion's and Linear's iPad apps keep it. Nothing draws a
  copy of glass, and glass is one layer: a bar's own, one glass view
  (`GlassBar`, `ComposerFoot`, the failure notice, Jump to latest), or a
  control's own glass button style, as the composer's `DockChips` stand, never inside a bar. A
  glass that holds buttons takes no press of its own (not `interactive`),
  so only the button under a finger or the pointer reacts, and no button
  is handed a hover effect: the system draws its own on each style, where
  an added highlight drew a second platter on iPadOS 26.
- **Rows** stand plain and edge to edge on `GROUND`, never as cards, laid
  out as Mail's Inbox, measured from Apple's own screenshot of it, from the
  system's layout margin (`useRowInset`: 16 pt in an iPhone's window, 20 pt
  in a Plus or Pro Max's, on its side, and on an iPad, as UIKit's stand):
  the unread dot in the leading margin, its trailing edge on it, at 9 pt the
  strongest mark a row carries as Mail's is, then Mail's 8 pt gutter
  (`ROW_INSET.GUTTER`), a 16 pt leading mark in a 20 pt column (the status
  ring, or the ask's glyph on an agent's own thread), the words from
  `inset.text`, a hairline in `CHIP_EDGE` that starts under the words, and
  the row's end on the trailing margin; a section's header starts where the
  marks do. An Inbox thread stands as Mail's message rows do, its three
  lines in Mail's type 8 pt from its top and bottom
  (`ROW_INSET.THREAD_VERTICAL`, `THREAD_LINE_GAP` between its lines), while
  a task's row keeps one line 44 pt tall and draws no dot, its ring
  standing where a dotted row's stands past the dot and the gutter
  (`inset.lead`), so the two line up. A row a
  split view's list keeps selected stands on a rounded `SELECTED` fill set in
  from the column's edges (`ROW_INSET.FILL`), its hairlines stepping aside, as
  Mail's selected message does; its words don't move.
- **A list with nothing to show** still stands, its `EmptyState` its one
  row (`RowList`'s `empty`), as iOS stands its content-unavailable view in a
  list's place: a pull anywhere still reads it again, and the state's own
  press, such as Try again, still takes a tap. A screen never swaps its list
  for the state.
- **Select mode** (`RowList`'s `choosing`) is SwiftUI's own edit mode, as
  Mail's Select: a round check leads each row, a tap ticks it, two fingers
  dragged down tick a run, and the swipes step aside. Its screen names the
  count in the title's place with Done, and stands the acts in the bar at the
  foot, a compact window's tab bar stepping aside for it.
- **Group headers** (`ListSection`) are small and muted with a count, or
  finished of all as `2/5` (`progress`), and in a plain list pin under the
  bar as the system's do, standing in the list's automatic top scroll edge
  effect (the opaque edge iOS draws under a pinned header, attached to the
  bar) on no ground of ours; a `foldable` one folds in place on
  a press, its chevron at the header's trailing end (before its +) as Mail's mailboxes and
  Reminders' groups fold, its rows easing away and back; one given a `glyph` leads its title
  with what the group is, as the panel's sidebar leads a section with its icon and a repository with its
  owner's picture (`RepositoryPicture`, its glyph standing in until it draws); and one given `add` ends in a muted +,
  one act or the system's menu of several, as Reminders' groups add, so an
  empty section stands as its header alone rather than a list of add rows;
  a long press on one given a `menu` opens it, as the panel's right-click
  on the sidebar's same header does.
- **Long press** opens one menu everywhere: SwiftUI's own context menu,
  its groups in the panel's order and words, set apart by dividers, red
  where an act takes something away, lifting a preview where the system's
  apps lift one. A row's is built by the app's native module from data
  (`RowFrame`, `rowMenu`): the row hands it one JSON tree of its menu
  (`menuTree`) and its preview (`previewTree`), which SwiftUI reads only as
  a long press opens the menu, so a list's rows hold no views of menus
  nobody opened; a press sends back the item's place (`menuPressAt`), its
  handler staying in JavaScript, and its swipes are SwiftUI's own swipe
  actions from the same kind of tree (`swipeTree`, `rowSwipes`). A
  section's header given a `menu` is the system's menu button around it,
  built natively from the same kind of tree (`headerMenu`), a tap folding
  the section and a long press opening the menu. Held SwiftUI or React
  Native views draw `LongPressMenu` through `HeldSwiftMenu` and
  `HeldMenu`, its menu built natively from the same kind of tree
  (`rowMenu`), headed by its `title` where it has one, so wherever the
  panel opens a right-click menu the app opens the same menu on a long
  press.
- **Color.** Glyphs stand in the muted ink. Copper is only for what wants
  you and what you chose, as the panel draws it: the unread dot, an ask's
  glyph, a count of what needs you, a reminder's time, the selected tab and
  the Inbox count, a picked option or a switch that is on, and a filled
  `Button`. Everything else stands in the ink: an ask's words on a row,
  links, bar buttons, a bordered or plain button, and a row that acts,
  such as New agent. `Screen` tints in `TEXT`, so a piece asks for copper
  by name. Status tones stand on the status marks alone: a task's ring,
  and a pull request's state. A swipe act stands on iOS's own system color
  for what it means, its glyph in white, as Mail colors its swipes: mark
  read or unread blue, Remind me and Archive purple, pin orange (Mail's
  Flag), Resolve and Mark done green, a delete red, and the rest gray
  (Mail's More). The act's `ROW_ACTION_TONE` names its meaning, and
  `SWIPE_FILL` in `list-row.tsx` is the one table of each meaning's color,
  over `SYSTEM_COLOR`'s light, dark and Increase Contrast values.
- **Scopes and capsules.** A list's scopes are the system's segmented
  control under its title, as Mail and the App Store switch a list's views;
  in a split view's 320 pt list column, which cuts the segments' words
  short, the system's menu picker naming the scope chosen
  (`SCOPE_LOOK.MENU`). A list with rows stands them as its first row
  (`RowList`'s `scopes`), so they scroll away with the rows as Mail's
  categories do; one listing nothing stands them over its empty state
  (`ScopePicker`), so another scope is one tap away. The Inbox stands its
  scopes in its ⋯ menu instead, the one shown checked over its other acts,
  as Mail's filter does, the checked one saying which is shown. `Chip` is a capsule an act or a choice stands in, such as a
  pull request card's acts; `FieldChip` and `StatusChip` read a task's
  status, priority and assignee, and where handed a `FieldMenu`, open the
  system's pull-down menu of the field's values, as Reminders' fields do.
  `Chip`, a field's chip that opens a menu, and `FollowingChip` are the
  system's own small bordered capsule; a field's chip that only says stands
  on `SURFACE` inside a hairline, since a bordered button reads as pressable.
- **Grouped forms** (`SettingsForm` and the sheets that pick
  or remind) read as iOS Settings' cards: their rows stand in the panel's
  raised fill (`RAISED`, the brand's `OVERLAY`) on the form's own ground
  (`GROUPED`: the chip's hover gray in light, black in dark), and the sheet
  around them stands on `GROUPED` too; a lifted sheet's form stands on the
  dialog fill (`SURFACE`) with its rows on the hairline's gray (`CHIP_EDGE`),
  but for a short sheet at half height, which iOS floats as Liquid Glass:
  there the glass is its one ground (`Screen` and `SettingsForm` `clear`), as
  Apple's half sheets stand. A row a press takes somewhere is the
  system's default button, so it flashes the row's gray while held, as
  Settings' rows do; a choice among a few is `PickRows`, each a row with
  what it does under its name where it says and the picked one checked in
  copper, the one pick look every form uses; a connection leads with its
  provider's own mark, the desktop's vector (`INTEGRATION_MARK_ASSET`), and
  its one act is a small bordered capsule at its end; what went wrong is a
  `ProblemLine`, muted words led by the alert glyph in the attention ink,
  never red words, wherever a refusal stands under a row or a field, an
  ask's `AskNote` for a send that did not go among them; what a section means is said in its
  footer, never in a line under a switch; a row that leaves the app ends in
  the arrow out; and the Account page heads with the
  account's photo, name and address centered on the ground, closing with
  Sign out and Delete account centered in red, as Apple Account's does. A
  red row never shares a group with the page's other rows: it stands alone
  at the page's foot, centered, as Leave does, or behind a menu, as a
  photo's Delete stands under Change photo.
- **Cards** are kept for what a person acts on: the ask (`ChoiceList`, a
  row per option checked at its end in copper once picked, as `PickRows`
  checks one, a "Recommended" tag before the check, and a detail line, its
  label and detail drawn as Markdown so a link of ours stands as its chip,
  whose press opens it and picks nothing; `StepList`, a round check per step, as Reminders draws one,
  with Mark done and Couldn't do it under it, at the system's regular size,
  Mark done filled as the card's one act and Couldn't do it its words
  alone, the two stacked past the accessibility sizes; `AnswerFields`, a row per
  field: a text or number field under its label, the field plain inside the
  card and prompting "Required" or "Optional" while empty, a number field's
  pad standing one Done over it for the card, a select's options as rows
  under its label, the recommended one tagged as a decide's is and none
  picked until the reader picks, as the panel's pills stand, and a yes or
  no's round check beside its name, as a step's, never the system's switch,
  since the panel's form draws a checkbox (the developer, Nov 27, 2026), the
  rows a SwiftUI `Form` holds, drawn in a card because
  a `Form` scrolls on its own inside the thread's scroll; a card's hairlines
  start where its rows' words do, as iOS insets a list's separator) and the pull request
  (`PullRequestCard`: its state's glyph, its title, its lines in green and
  red, and its acts as pills; a press on it opens its own page). An ask's
  card and a file's chip stand on `CARD`, the soft gray in light, so they
  read off the page's white as iOS's own cards do rather than by a faint
  hairline alone; the pull request card stands on `SURFACE`; each inside a
  hairline.
- **A pull request's page** reads as the panel's Pull request tab, from the
  same model (`@repo/features/pull-request-model`): its state as a chip in
  GitHub's color, the merge queue's in the attention ink with its place
  ("Queued #2"), its branches, and GitHub's sentence of whether it merges;
  its checks, chapters, and files changed as rows counting them as the
  panel's tabs do ("✓ 5", "3", "4"), each pushing a page of its own, the
  chapters' told from `@repo/features/pull-request-chapters-shown` as the
  panel's Chapters view tells them, each glyph the panel's own (`pull-request-look.ts`), the
  lines it changes after its branches; its reviewers as faces in its heading after who
  opened it, each wearing where they stand at its corner, as the panel's
  people line draws them; its Description and Conversation folding under
  their headings (`ListSection`'s `foldable`), as the panel's do; the merge's
  press under the heading in every
  window, as the panel's head stands Merge under the title, a large button
  as wide as its words (`MergeActRow`), and a split button where the
  repository merges more than one way, its chevron choosing the way as the
  panel's merge box does; its title edited from a tap on it and where it
  stands changed from its state chip, as the panel's title and pill change
  them, an act that asks first asking in `ConfirmAsk`; and in the bar's ⋯
  only Copy GitHub link and Open on GitHub, as the panel's toolbar ⋯. The bar holds no press of words,
  which pushed the page's path out of a compact bar.
- **The tab bar** is `NativeTabs`: each tab labeled in every window, since a
  compact window's icons alone read as empty (the developer, Nov 23, 2026),
  the Inbox count in copper, and Search on the system's own round glass,
  with no round + for New task, which each tab root's bar offers as its
  compose instead; a regular window's
  bar, on an iPhone, is `sidebarAdaptable`, so the unfolded Duo stands it as
  a sidebar rail. An iPad stands no tabs: the system's own three-column
  split view stands at the app's root (UISplitViewController, expo-router's
  `SplitView`), as Mail's does: its sidebar column the app's sidebar
  (`SidebarColumn`, the system's sidebar list, `LIST_LOOK.SIDEBAR`, headed
  by the workspace switcher with New task's glyph at its end,
  `WorkspaceSwitcherRow`, whose menu holds the account and Settings, then a
  `PlaceRow` for each place and the tasks), then the list of the place
  picked (`ListColumn`, reading what the place holds above the split view,
  as its page does), then the picked
  row's page with every page pushed over it, standing bare in its screen's
  host under the screen's own native-stack header, as an iPhone's pushed page
  stands, since a SwiftUI column around it left its hosted React Native views
  undrawn there; the system draws
  the sidebar's glass, selection, toggle and swipe, and the columns' edges a
  person drags, the list's never folding away. A compact window hides it while a
  conversation stands in front (a thread, an agent's page, or a pull
  request it opened), as Messages does, so the composer stands alone at
  the foot (the developer, Nov 12, 2026).

## Accessibility

Dynamic Type, VoiceOver, the contrast settings, and Reduce Motion are held
here once, so a screen gets them by composing these pieces.

- **Settings** come from `accessibility.ts`, one store per setting shared by
  every component: `useReduceMotion` (a custom motion is left out, as Jump to
  latest's scroll), `useReduceTransparency` (a short sheet's
  ground; the system's glass on every bar and glass button goes solid on its
  own), `useIncreaseContrast` (`useColors`
  gives the quiet inks the body's, the hairline the quiet ink,
  and danger the words' ink). Bold Text and Button Shapes need nothing of
  ours: SwiftUI's text styles and React Native's system face take Bold Text,
  and the system's buttons draw their own shapes.
- **Dynamic Type.** Past `useAccessibilitySize`, a row stacks its end under
  its title, a page's chips stand one to a line, and a line's words wrap
  rather than cut; a mark drawn at a size of its own grows with
  `useScaledSize`, as `@ScaledMetric` would.
- **VoiceOver.** A row hands `RowFrame` what it is heard as (`RowHeard`): one
  element whose label is its title, so Voice Control and the Maestro flows
  find it by the words on screen, and whose value says its marks in words
  (unread, needs you, its status, its time by `sinceHeard`), and whose
  Actions are its long press menu's acts, each once and in the menu's order,
  a submenu's items worded with their menu or their own `heard` words
  ("Remind me tomorrow", "Set status: Backlog"), as Mail's rows offer theirs,
  never the swipes' copies, read natively from the same tree as its menu
  (each node's `heard` words, `rowHeard`) only while VoiceOver, Switch
  Control, or a hardware keyboard reads them. A row holding a
  button of its own stays apart instead; a row never nests a second press
  over its own, so `AgentRow`'s pull request opens from its long-press menu.
  A group header, a page's heading, and a message's writer line are headings;
  a glyph its words already say is hidden. A message's `Video` that can play
  is one element, its name, which opens the system's player full screen, as
  Messages does, since the inline player's own views stood a thread's
  video in an iPad's split view past the depth XCTest can read. What happens out of the reader's
  sight is told with `useAnnounced`: an agent's change of state,
  a held call, and a send refused (`AskNote`). A line of Markdown offers
  each chip and link it holds as one of its VoiceOver actions ("Open …"),
  since iOS never lists a view standing in a paragraph as its own element.
- **Contrast.** Words stand in an ink that holds WCAG's 4.5:1 on the ground
  they stand on (danger's words in `DANGER_TEXT`, a filled button's in
  `ON_ACCENT`), checked against `@repo/brand`'s table, which
  `@repo/ui`'s `brand-contrast.test.ts` holds.

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
