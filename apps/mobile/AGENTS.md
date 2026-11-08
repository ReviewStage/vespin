# The iOS app

`apps/mobile` is Vespin's iPhone and iPad app: Expo SDK 58 on React Native
0.88, TypeScript, iOS only in v1. It is a shell, as root `AGENTS.md`'s Layout
says: it holds what is specific to iOS and nothing else, its logic lives in
`packages/`, and its screens are written in React but drawn by SwiftUI through
`@expo/ui`. Nothing under `ios/` is committed: `app.config.ts` declares the
whole native project (the bundle identifier `dev.vespin.ios`, the iOS 26
deployment target, the `vespin.dev` associated domain, the `vespin://` scheme),
and `expo prebuild` generates it on every build.

## On the developer's Mac

The app's agents run on the developer's own Mac, which has Xcode 27 and the
simulators; the cloud sandboxes have no Xcode and see the app only through
CI's macOS job below. Every command here runs from `apps/mobile`.

| Command | What it does |
| --- | --- |
| `pnpm ios -- --device "iPhone 18 Pro"` | Generate `ios/` if it is missing, build a Debug app, install it on that simulator, and start Metro for it |
| `pnpm start` | Metro alone, for a Debug app already installed |
| `scripts/simulator-build.sh` | Generate `ios/` and build a Release app for the simulator, its bundle embedded, naming the `.app` on its last line |
| `scripts/simulator-screenshots.sh <app> <output> <simulator>...` | Install that app on each named simulator, run every flow under `maestro/` on it with the screenshots under `<output>/<simulator slug>/`, and shut the simulator down |
| `xcrun simctl io booted screenshot shot.png` | One screenshot of the booted simulator by hand |
| `pnpm export:ios` | Bundle the app with Metro, as CI's Linux job does; it catches a module Hermes cannot resolve |
| `pnpm typecheck`, `pnpm test:vitest` | The TypeScript and the logic tests |
| `pnpm prebuild -- --clean` | Regenerate `ios/` from scratch after an `app.config.ts` change |

The simulators to build against are the iPhone 18 Pro (compact), the iPhone
Duo (iOS 27.1 or later; it boots folded, with a compact outer display), and the
iPad Pro 11-inch (M5) for the regular-width layout the unfolded Duo shows. No
supported command folds or unfolds the Duo simulator: only Device Hub's own
controls do, by hand, so check the unfolded layout on the iPad or by hand.
Name a simulator as `xcrun simctl list devices available` names it; the
screenshot script creates one of that name where none exists.

What the Mac needs once, beyond Xcode:

- **CocoaPods**, `brew install cocoapods`. It refuses a shell whose locale is
  not UTF-8, which an agent's shell is not; the build script sets `LANG`.
- **Maestro**, `brew tap mobile-dev-inc/tap && brew trust mobile-dev-inc/tap
  && brew install mobile-dev-inc/tap/maestro`. It runs on Java 17 or later,
  which the formula brings as Homebrew's keg-only `openjdk`; the screenshot
  script puts it on `JAVA_HOME` where no Java is on the path.

The Mac has little free disk and at most two app agents share it, so keep
your footprint small: one build at a time, `rm -rf ios` once its app has been
installed and shot (the pods and the build together take several gigabytes),
`xcrun simctl shutdown all` when you are done, and a cache you created
(`~/Library/Caches/CocoaPods`, `~/Library/Developer/Xcode/DerivedData`) deleted
with it. Touch nothing of the developer's outside the checkout.

## CI

Two jobs in `.github/workflows/ci.yml` cover the app.

- **Linux** runs the typecheck, the lint, the vitest tests, and `export:ios`
  on every pull request, through the same turbo tasks as every workspace.
- **macOS** (`mobile`, on GitHub's `xcode-27` image) runs only when
  `apps/mobile/**`, `packages/ui-native/**`, or the workflow itself changes,
  in the merge queue too; a run that skips it keeps the `CI` gate green. It
  generates the native project, builds the Release simulator app, runs the
  Maestro flows on the iPhone 18 Pro, the iPhone Duo as it boots, and the iPad
  Pro 11-inch, and uploads their screenshots as the `mobile-screenshots`
  artifact, kept whether or not the flows passed.

Look at CI's screenshots before calling a pull request done, since the gate
is the macOS job and not your own Mac:

```
gh run list --branch <your branch> --workflow CI --limit 1 --json databaseId --jq '.[0].databaseId'
gh run download <run id> --name mobile-screenshots --dir /tmp/mobile-screenshots
```

Each simulator's pictures are under `/tmp/mobile-screenshots/<slug>/takeScreenshot/`,
named as the flow's `takeScreenshot` steps name them.

## Tests

Logic is tested with vitest, under `src/**/*.test.ts`, as root `AGENTS.md`'s
Testing section says. Screens are not unit-tested: each is checked by a Maestro
flow under `maestro/` that drives the simulator and takes a screenshot, which
CI keeps. A new screen adds its steps to a flow, or a flow of its own, and a
pull request with UI shows its screenshots to the developer in a thread.

## Conventions

- **Native components only.** The tab bar is expo-router's `NativeTabs`, a
  screen stack is its native `Stack` with the system's headers, search, and
  toolbars, glass is `expo-glass-effect` (a dependency from the first screen
  that needs it), and everything else is `@expo/ui`.
  Never a tab bar or header drawn in JavaScript, never a hand-drawn copy of
  glass, and never a DOM component (`'use dom'`).
- **SwiftUI first.** A screen is drawn by SwiftUI through `@expo/ui` (`Host`,
  `List`, `Section`, `Form`, `NavigationSplitView`, and the rest), the
  developer's choice of Nov 8, 2026. A React Native view draws only what
  SwiftUI has no piece for: message markdown and the agent transcript.
- **Every control comes from `@repo/ui-native`**, the app's design system
  (the task "Start @repo/ui-native, the app's design system"), as the web's
  come from `@repo/ui`. Until that package lands, the skeleton's placeholder
  screens under `src/screens/` are the one exception, and they move into it.
- **The app is a shell.** A module whose imports name no Expo, React Native,
  or expo-router API is logic and belongs in a package. A relative import ends
  in `.js`, as the packages' do (`scripts/repository-checks.sh` holds it), and
  `metro.config.js` reads it as the `.ts` beside it, as it reads a workspace
  package's `exports`.
- **Layout follows the window, never the device.** `useWindowSizeClass` reads
  the window's width into a compact or regular size class; a regular window
  stands list and detail side by side in `NavigationSplitView`, whether it is
  an iPad's, the unfolded iPhone Duo's, or a Split View pane.
- **Words match the panel's**: Inbox, Tasks, New task, Mark done, ask, and
  `docs/DESIGN.md`'s copy rules.
- **React 19.3** comes through the `mobile` pnpm catalog, since React Native
  0.88 is compiled against it, while the web and desktop apps stand on the
  default catalog's 19.2. A React module from `@repo/panel` or `@repo/ui`
  cannot be drawn here until the default catalog moves to 19.3; a DOM-free
  hook or view model the app needs moves behind a door both can import.
