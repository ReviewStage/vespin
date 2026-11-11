# Agent guide

Vespin is a macOS Electron app, with a web app beside it, for working through a
task with coding agents: the developer works a task through with them in typed
conversations, and they write its plan down as they go and open its pull
requests.

## Commands

| Command | What it does |
| --- | --- |
| `./scripts/bootstrap.sh` | Install pinned workspace dependencies |
| `pnpm check:affected` | The portable checks for what changed since `origin/main`, replayed from cache where they already passed; optional before a push, since CI runs every check |
| `./scripts/check.sh` | Every portable repository, migration, lint, type, and test check: before a release, for a broad refactor, or on request |
| `./scripts/run.sh` | Launch against live sessions, replacing the running plain instance (`--fixture smoke`, `--keep-running`); `--instance <name>` runs a named one beside it, with its own profile, and `--preview` is one named for its Preview |
| `./scripts/evidence.sh` | Write the fixture PNG under `artifacts/` |
| `pnpm release:macos` | Local signed, notarized, verified DMG, zip, and update manifest |
| `pnpm lint:fix` | Repository formatting and safe lint fixes |
| `pnpm --filter @repo/mobile ios -- --device "iPhone 18 Pro"` | Build the iOS app and run it on that simulator, from a Mac with Xcode (`apps/mobile/AGENTS.md`) |
| `apps/mobile/scripts/simulator-screenshots.sh` | Run the iOS app's Maestro flows on the named simulators and keep their screenshots |

CI runs the portable check on Linux, where `export:ios` bundles the iOS app
with Metro beside the typecheck. The iOS app's simulators run by hand, never
on a PR (`ios-simulators.yml`, on GitHub's `xcode-27` image): it builds the
app for the simulator, runs its Maestro flows on an iPhone, the iPhone Duo,
and an iPad, and uploads their screenshots as the `mobile-screenshots`
artifact, which `apps/mobile/AGENTS.md` says how to read. No workflow runs the
desktop app's tests on a Mac: the release job (`release.yml`'s `macos-15` job,
run on a `v*` tag push or a manual dispatch) only builds, signs, notarizes,
and verifies the app. A green PR says nothing about either app on a device.

A release is dated in Eastern time (America/New_York), never UTC or the
author's own zone: its `CHANGELOG.md` heading carries the day its tag is
pushed there (`TZ=America/New_York date +%F`), and `.github/RELEASE.md` is
the rest of cutting one.

## Layout

Application logic lives in `packages/`. An app holds what is specific to
its platform or deployment and nothing else: Electron's main and preload
processes, the window and page roots, the Vercel function routes under
`apps/web/server/routes/`, the deployment shell beside them, and build and
release scripts. A React component, control, or
repeated UI shape must live in `packages/ui` whatever app mounts it, even one
app alone, with no exceptions, and a duplicate is folded into one; an app or
`packages/panel` must compose those components and never hand-builds a control
(a raw `<button>`, input, tab, or card with its own press handling) outside
`@repo/ui`: the design system is one rigid set that every agent must use. The iOS app's
components live in `packages/ui-native` the same way, as React Native
components wrapping `@expo/ui`'s SwiftUI: `apps/mobile` composes them and
never builds a control, imports `@expo/ui` or `expo-glass-effect`, or draws
React Native's own controls itself. A hook or DOM-free view
model lives in `packages/ui` when more than one app can mount it, the panel every client mounts, the desktop's panel window and the
web's tab alike, in `packages/panel`, the hosted service's logic in
`packages/service`, its contract and clients in `packages/features`, and a
wire value in `packages/wire`. A
`.ts` module whose imports name no module of its app and no platform
library (`electron`, `react-dom`, a DOM API, `better-auth`, `eve`,
`@vercel/*`) is logic and belongs in a package unless it is shell: an app
entry in `knip.json`, a runtime edge that runs its Effects, or a
deployment or test-support file.
Review places a module and a component alike under this rule.

Lint holds the UI half of this (`anti-slop/no-raw-press-outside-ui`): outside
`packages/ui`, every app, test, and the catalog included, an intrinsic
(lowercase) JSX element is never a control. A raw `button`, `input` (bar
`type="hidden"`), `select`, `textarea`, or `summary`, a pressable `role`
(`button`, `tab`, `option`, `menuitem*`, `radio`, `checkbox`, `switch`,
`slider`, `link` off an `<a>`, or one that is no literal), and a press event (`onClick`, `onDoubleClick`,
`onAuxClick`, `onContextMenu`, `onMouseDown`/`Up`, `onPointerDown`/`Up`,
`onTouchStart`/`End`, and their `Capture` forms) are errors, as is
`onKeyDown`/`onKeyUp` on an element with `tabIndex` or `contentEditable`.
Hover, drag and drop, focus, wheel, scroll, and clipboard events, keys on a
container that takes no focus, and a spread from a ui helper
(`menu.contextMenu()`) stay allowed. There is no escape hatch: `pnpm lint` runs
`tools/anti-slop/press-guard-check.ts`, which fails on a disable comment that
would silence the rule and on an `.oxlintrc.json` that weakens it. Where it
fires, use a `@repo/ui` component, or add the component or variant there.

A loading skeleton draws through the components its loaded state draws with,
never a copy of their boxes, and takes its counts, order, and sizes from the
declaration the loaded surface reads, never literals of its own. Lint holds
the first half (`anti-slop/skeleton-through-components`, under the same
no-suppression check): `Skeleton` and `SkeletonRegion` are drawn only by a
component named `*Skeleton`, in which an intrinsic element's class must be a
literal naming itself a skeleton's (`…-skeleton…`); every other box is a
component, factored out of the surface where it builds the box by hand.

What a row does lives in its row component, never in the page that draws
it: its menu, its rename, its selection, and its muted and unread states
are built inside the one component every list of that kind draws
(`TaskListRow`, `AgentListRow`), so a list that draws the row gets all of
it, and no page hands a shared row a menu, an editor, or a selection of its
own. `[check: anti-slop/row-behavior-in-row]`, under the same no-suppression
check: outside the row components `tools/anti-slop/row-behavior.json` names,
each with its reason, handing `@repo/ui`'s `TaskRow` its `menu`, `editor`,
`note`, `choosable`, `settled`, or `unread`, or `TaskListRow` or
`AgentListRow` a `menu`, `editor`, or `note`, is an error, as is a spread
onto one. `ListRow` is not held: it is the row of many kinds, each drawn
where it is listed. A menu shows a shortcut exactly where pressing it would act on the
menu's subject, so a key it prints always works and one it leaves out does
not act there. `[check: anti-slop/no-shortcut-flag]`, under the same
no-suppression check: `commandAction` and its siblings take the menu's
subject, and the place offering a key says what it acts on
(`useShortcutTarget`, `packages/panel/src/shortcut-target.ts`); a literal
`true` or `false`, a negation, a comparison, `&&` or `||`, or a condition
choosing between the subject and nothing where they take it is an error.

Lint holds the iOS half too (`anti-slop/no-raw-press-outside-ui-native`,
under the same no-suppression check): outside `packages/ui-native`, an
import of React Native's `Pressable`, `TextInput`, `Switch`, `Button`, or a
touchable, a press prop (`onPress`, `onPressIn`, `onPressOut`,
`onLongPress`) on a React Native primitive, and an import of `@expo/ui` or
`expo-glass-effect` are errors. Where it fires, use a `@repo/ui-native`
component, or add the component or variant there.

## Never

- Never let a credential or account secret enter a Gateway answer or event, a
  counted event, a trace, or a fixture. The repository check
  (`scripts/repository-checks.sh`) refuses a tracked literal shaped like a
  provider's credential; nothing else scans for secrets, so past that this rule
  is the whole of the check. The carve-outs: the output of `run_on_mac`, a
  command an agent ran on the developer's own Mac, may reach the conversation,
  the model, and the tool's events as it printed; a trace, a counted event, and
  a fixture still never carry it where that can be avoided. And an integration's
  MCP tool calls and results, a credential its provider answers among them, may
  reach the conversation, the model, an agent's transcript, and its traces. And
  a Terminal tab's bytes go only to the tab that opened them: through the
  terminal relay (`apps/web/server/terminal/`) and the host to that panel's
  window, never into a trace, a counted event, a fixture, or app state. And a
  webhook body an automation's caller sends, or an
  integration trigger's event (a Sentry issue or alert as Vespin's Sentry
  integration delivers it), may reach that run's agent task, transcript and
  traces. And a workspace environment variable, which the workspace's owners
  and admins set, may reach that workspace's cloud agents: their sandbox's
  environment, the model, and the agent's transcript and traces. And a Slack message a member addresses to Vespin's Slack bot (an
  @Vespin mention or a DM), with the earlier messages of the Slack thread it
  stands in, may reach the agent it starts or is sent to: that agent's task,
  transcript and traces. And an automation webhook secret may be shown once, in the window that
  minted it, at creation or rotation; never anywhere else. And an agent's cloud
  browser, a
  Chromium in that agent's own Vercel Sandbox, shows its pages, their live-view
  frames, address, title, screenshots, and text snapshots to that agent and its
  workers, the model, the agent's transcript, and the panels of the workspace
  members who open the task or the agent's own page; the service keeps the tab list, each tab's address
  and title. The model is handed a small copy of each screenshot, whose base64
  is left out of the stored conversation, and the service keeps a full-size copy
  beside the transcript the call is written to, the agent's or its worker's, as
  `show_image`'s pictures are
  (`packages/service/src/agents/browser/browser-tool.ts`), which the stored
  conversation names by id, which that transcript shows to the members who can
  open the task, and which is deleted with the conversation, at once on a
  delete of its task or agent or of the account. None of it ever goes into a
  trace, a counted event, or a fixture, and session replay
  masks the live view and the transcript's screenshots; the cookies a member
  types into it stay in that agent's sandbox, and its snapshots, for the
  sandbox's life. An agent may record its browser as a video (`record` and
  `stop_recording`), whose frames the recorder in its sandbox writes to that
  sandbox's disk until the next recording clears them, and whose WebM the
  service keeps beside the transcript the call is written to as it keeps a
  screenshot (`packages/service/src/agents/browser/browser-tool.ts`), shown and
  deleted on the same terms; the model is never handed the video, the
  transcript's player is left out of session replay, and none of it goes into a
  trace, a counted event, or a fixture. An agent may also
  post such a recording, or any WebM it recorded in its sandbox, to a thread in
  one of its workspace's channels
  (`packages/service/src/agents/coder-host/inbox-image.ts`), kept beside the
  thread's message, up to 4 MB, as a picture posted there is, shown to whoever
  may read that thread and deleted with it; the thread's player is left out of
  session replay, and none of it goes into a trace, a counted event, or a
  fixture. Such a recording may also be added to its
  task's plan, from the file viewer's Add to plan or an agent's `edit_plan`,
  at most ten to a plan, kept beside the plan as its pictures are
  (`packages/database/src/models/plan-attachments.ts`), shown to the members
  who can open the task and deleted with the plan; `look_at_picture` refuses
  it (`packages/service/src/tasks/picture-look.ts`), so no model is handed it,
  the plan's player is left out of session replay, and none of it goes into a
  trace, a counted event, or a fixture. And Sentry's SDKs run
  with their default data collection, but that the service's
  leaves out model inputs and outputs and request bodies
  (`packages/service/src/observability/sentry.ts`, the desktop's
  `Sentry.init`, the web app's
  browser SDK, `apps/web/src/app/web-sentry-sdk.ts`, and the iOS app's React
  Native SDK, `apps/mobile/src/crash-reports.ts`, with the desktop renderer's
  token filters, `@repo/features/sentry-breadcrumbs`), so what a request, a log
  line, a local variable, or an error's words carries may still reach Sentry
  from the desktop, the browser, and the iOS app, and a log line, a local variable, or an
  error's words from any of them; a credential among it is replaced only where
  Sentry's denylist catches it by name, and `PRIVACY.md` says so.
- Session replay records the rendered panel with every word masked
  (`packages/panel/src/session-replay.ts`) unless it sits under `@repo/ui`'s
  unmask mark (`ReplayUnmask`) with no nearer mask mark (`ReplayMask`), so
  what leaves the machine is layout and the app's own words, not a person's;
  an unmasked attribute or a new way of drawing words is what would change
  that.
- Never push PR media to a branch but `pr-assets`, under `pr-<number>/`, if
  you add any; a fresh `pr-assets-<topic>` branch mails a failed Vercel Preview
  on every push. PR media is not required.
- Never add to this file (`AGENTS.md`, which `CLAUDE.md` links to) unless the
  user explicitly approved the addition.

## The scheduled sweep

Vercel's cron calls `/api/maintenance/sweep` once a minute (the root `vercel.json`;
`packages/service/src/maintenance/maintenance-sweep.ts`) under the deployment's own
`CRON_SECRET`, compared in constant time; a deployment missing that secret
answers unavailable and sweeps nothing. A turn past the deadline its row holds
(`packages/database/src/models/turn-state.ts`) is the sweep's: it fails it with
why (`packages/service/src/agents/coder-host/reconcile.ts`); no read settles one.

## Testing

A test is a cost every push pays for as long as it exists. Write one only
where it pays that back by catching a regression nothing else would catch.

Each rule names what holds it: `[check: …]` is a lint rule or script that
fails the build, so the words are only its reason; `[review]` is held by the
reader alone. Move a rule from `[review]` to a check wherever one can hold it.

### Running tests

```
pnpm exec vitest run <path>              # the file you changed
pnpm check:affected                      # what changed since origin/main, from cache
./scripts/check.sh                       # everything CI runs bar Postgres
```

- `[review]` Run the test files you touched, then push: CI runs the rest and
  gates the PR. Never run a whole workspace's suite to check one change.
  `check.sh` is for a release, a broad refactor, or when asked, and must exit
  0 when it runs.
- `[review]` Run a suite once and keep its output in a file to read, rather
  than running it again with a different filter.
- `[review]` Say in the PR which tests you ran and which you left to CI.

### Deciding to add a test

- `[review]` Name the regression first: the change a future author could make
  that this test, and no existing one, would catch. If you cannot name it, do
  not write the test.
- `[review]` Look for the test that already covers the behavior. Extend it,
  or add a row to its `it.each` table, before adding a file or a case.
- `[review]` Test what the diff changes, and only that: not code it leaves
  alone, a dependency, or the platform.
- `[review]` A bug fix comes with the one test that reproduces it. Run it
  before the fix and see it fail; a test that passes without the fix proves
  nothing and is not committed.
- `[review]` One case per behavior. Inputs that take the same path (spellings,
  flags, variants, sizes, themes) are one case, not a matrix.
- `[review]` A test you wrote to explore the code while working is deleted
  before the push unless it passes this section.
- `[check: anti-slop/no-source-read-in-test]` `[review]` Reach for the cheapest guard that holds: a type, then a lint rule
  in `tools/anti-slop/`, then a test. A rule about source text, such as a
  banned class or import, is a lint rule, never a test that reads source
  files.

### What a test checks

- `[review]` Behavior a caller can see through the public export: what it
  returns, renders as text or accessible role, stores, emits, or throws.
- `[review]` The expected value comes from somewhere other than the code under
  test: the requirement, a hand-worked example, or an independent oracle.
  Never compute it with the implementation's own helpers, and never paste it
  from the output.
- `[review]` These are not behavior, so no test asserts them: private state;
  call, render, or redraw counts; that a double was called; constants, token
  tables, getters, types, and re-exports; a Schema round-trip of a valid
  value; class names, stylesheet declarations, `var(--ui-*)` values,
  computed styles, and markup shape. Appearance is held by `@repo/ui`, its
  lint rules, and the catalog.
- `[review]` Nothing is exported only so a test can reach it.

### How a test is written

- `[check: anti-slop/no-node-test]` Tests run on vitest.
- `[review]` A test owns its world: one process, a temp directory it created
  (`temporaryDirectory` from `@repo/runtime/testing`), its own database
  (`getTestDB()` from `@repo/database/testing`), and `TestClock` for time. It
  never touches the network, a live provider, real time, or personal data,
  and passes alone or in any order.
- `[review]` A test finishes in about a second, and a file in about ten, on
  CI. One that cannot says why in a comment.
- `[check: anti-slop/no-internal-vi-mock]` `[review]` Use real code first, then a fake, then a stub, and replace only
  what crosses a process boundary: provider HTTP, Apple, the model, the OS,
  the clock. An Effect service is replaced by a test `Layer` on its tag;
  anything else by `vi.spyOn`, restored with `vi.restoreAllMocks()`. Never
  `vi.mock` a module of this repository.
- `[review]` An Effect test is `it.effect` and moves time with
  `TestClock.adjust`. It never runs an effect itself (`Effect.run*`,
  `Runtime.run*`, `ManagedRuntime.make`) or waits on the clock (`setTimeout`,
  `setInterval`, `Effect.sleep`, `it.live`).
- `[review]` A query over account rows comes with a test that one user cannot
  read another's. A model or repository in `packages/database/src/` has a
  sibling `__tests__/<name>.test.ts` from the PR that adds it.
- `[review]` Set up through the shared builders (`apps/web/tests/support/`,
  `packages/wire/src/testing/`) before writing setup inline. A helper joins
  them once it has a second caller.

### Changing and removing tests

- `[check: anti-slop/no-focused-or-skipped-test]` `[review]` Never make a test pass by weakening it: no `.only`, `.skip`,
  `.todo`, or `it.flakyTest`, no looser assertion, and no longer timeout or
  extra retry without evidence of what was slow. A flaky test is fixed or
  deleted.
- `[review]` A golden is rewritten only by `APP_UPDATE_FIXTURES=1` through
  the shared helpers, never by hand, and the PR explains its diff. A JSON
  Schema golden exists only for a schema a model sees as a tool's input.
- `[review]` A test that breaks under a refactor because it pinned wiring is
  deleted, and the PR names the behavior test that still covers it.
- `[review]` A feature's tests leave with the feature. Nothing asserts that a
  removed thing is gone.
- `[check: scripts/repository-checks.sh]` Every workspace with a
  `vitest.config.ts` is on the root `vitest.config.ts` projects list, and each
  workspace's tests run in exactly one CI job.

## Learning more about Effect

This repository uses the Effect Typescript library.

Before writing any Effect code, first read `node_modules/effect/AGENTS.md`
**completely**, and follow the links in the file when required.

If you need to learn more about particular Effect apis and concepts that the
guide doesn't cover, search through the source code in `node_modules/effect/src`.

## Code style

The model is Redis. Full rules with sources and examples in `docs/STYLE.md`.

- `[check: scripts/repository-checks.sh]` Write American English: prose,
  comments, identifiers, user-facing words, and file names (`color`,
  `canceled`, `labeled`, `center`, `gray`, `-ize`). A value already stored or
  on the wire keeps the spelling it shipped with (`AGENT_STATUS.CANCELED` is
  `"cancelled"`), as does a name an outside spec or API owns
  (`aria-labelledby`, `AnalyserNode`, GitHub's `cancelled`).

- Fight complexity by not creating it. Every dependency, layer, and
  abstraction earns its lines or is refused.
- Order a file: header, imports, constants, private helpers, public API,
  entry points last. Line one: `name.ts -- one line of purpose.`
- Name by layer then verb. Guard early, one exit. Assert invariants.
- A function is read in one pass. Files may be long; functions may not.
- One-line guide comments inside functions. Why comments talk: "Note that
  we X, because Y." Design comments sit above the function. No trivial
  comments.
- UI draws with `@repo/ui` (`packages/ui/README.md`): its components, page
  patterns and `--ui-*` tokens; no raw controls where a component exists,
  no literal colors or sizes, no `className` on its controls. A missing
  variant is added to `@repo/ui` as an `as const` option. Third-party engines
  are the exception. `@repo/ui` is built on shadcn/ui over Base UI: its
  controls vendor shadcn's source
  (`packages/ui/src/shadcn/`) and are written in Tailwind utilities over the
  one theme in `@repo/ui/tailwind/theme.css`, which no app restates.

## Commits

Commit messages and PR titles follow Conventional Commits 1.0.0
(https://www.conventionalcommits.org/en/v1.0.0/) and branch names follow
Conventional Branch 1.1.0 (https://conventionalbranch.org/), both exactly.

## Merging

Do not rebase onto or merge in `main` to bring a branch up to date unless the
user asks or the branch cannot go on without it: a conflict GitHub reports,
or a change on `main` the work needs. Being behind `main` is not a reason: CI
runs on the PR's merge with `main`, and the merge queue tests each PR against
the latest `main` before it lands, so an up-to-date branch buys nothing and
costs a rebuild, a re-run of CI, and a force-push. This holds before a push,
while CI runs, before arming auto-merge, and while a PR waits in the queue.
Restacking a stack onto the PR beneath it after that PR changed is the one
routine rebase.

Open a PR ready for review, never as a draft, so CI and review start on it at
once. To merge a PR, run `gh pr merge --auto` right away; the merge queue waits
on CI, so do not wait on it yourself, and do not update the branch first. In a
stack, arm a PR only once it targets `main`.

## TypeScript

- No stringly typed fixed value sets. Use `as const` SCREAMING_SNAKE_CASE objects,
  derive unions with `typeof VALUE_SET[keyof typeof VALUE_SET]`, and use the
  constants at call sites. Raw strings are only for freeform user-facing text.
- Never build a key by concatenating or interpolating identifiers. Use nested
  objects or nested `Map`s keyed by the original identifiers.
