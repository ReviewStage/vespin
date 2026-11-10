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
the macOS run below. Every command here runs from `apps/mobile`.

| Command | What it does |
| --- | --- |
| `pnpm ios -- --device "iPhone 18 Pro"` | Generate `ios/` if it is missing, build a Debug app, install it on that simulator, and start Metro for it |
| `pnpm start` | Metro alone, for a Debug app already installed |
| `xcrun simctl launch booted dev.vespin.ios -fixture inbox` | Launch the installed app on the host's Inbox fixture, as the Maestro flows do, so it reads no server |
| `xcrun simctl launch booted dev.vespin.ios -authServer stub` | Launch it signed out against the stubbed account service, as `maestro/sign-in.yaml` does |
| `scripts/simulator-build.sh` | Generate `ios/` and build a Release app for the simulator, its bundle embedded, naming the `.app` on its last line |
| `scripts/simulator-screenshots.sh <app> <output> <simulator>...` | Install that app on each named simulator, run every flow under `maestro/` on it in the light appearance and the dark, with the screenshots under `<output>/<simulator slug>/<appearance>/`, and shut the simulator down |
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

- **Linux** (`.github/workflows/ci.yml`) runs the typecheck, the lint, the
  vitest tests, and `export:ios` on every pull request, through the same turbo
  tasks as every workspace. It is the pull request's only gate.
- **macOS** (`.github/workflows/ios-simulators.yml`, on GitHub's `xcode-27`
  image) runs only by hand, on any branch, in about 100 minutes. It generates
  the native project, builds the Release simulator app, runs the Maestro flows
  on the iPhone 18 Pro, the iPhone Duo as it boots, and the iPad Pro 11-inch,
  and uploads their screenshots as the `mobile-screenshots` artifact, kept
  whether or not the flows passed.

On the Mac, run the flows your change touches on the simulators yourself
before you push. In the cloud, where there is no Xcode, ask for a run on your
branch; Vespin's GitHub App cannot dispatch a workflow, so it is started from
the developer's Mac (`gh workflow run ios-simulators.yml --ref <branch>`).
Then read its screenshots:

```
gh run list --branch <your branch> --workflow "iOS simulators" --limit 1 --json databaseId --jq '.[0].databaseId'
gh run download <run id> --name mobile-screenshots --dir /tmp/mobile-screenshots
```

Each simulator's pictures, in each appearance, are under
`/tmp/mobile-screenshots/<slug>/<light|dark>/debug/<flow>/takeScreenshot/`,
named as the flow's `takeScreenshot` steps name them; a failed step's own
screenshot is under `debug/<flow>/screenshots/` beside them.

## The host

The app runs the shared client host in its own process, as the web app runs
it in a tab (`apps/web/src/app/web-host.ts`): `src/host/compose-mobile.ts`
is `composeWeb`'s twin, started once by the app's one runtime edge
(`src/host/mobile-runtime.ts`) over the device's seams
(`src/host/device-seams.ts`): the settings file under the app's Documents
through `expo-file-system`, ids from `expo-crypto`, the relay socket over
React Native's `WebSocket` with the bearer header, and the service at
`https://vespin.dev` unless `EXPO_PUBLIC_SERVICE_ORIGIN` names a Preview at
build time. The screens read the document as the panel does, with
`useQuery({ ...appStateQuery, select })` (`src/host/app-state-query.ts`) and
the selects of `@repo/host/app-state-reads`, and send acts on the host's act
port, served in-process over `src/host/in-process-channel.ts` in place of a
`MessageChannel`.

The account is the desktop's OAuth source signed in as the `ios` client
(`OAUTH_ACCOUNT_CLIENT.IOS`), whose bearer every v1 write and the socket
take, so no session is handed off. Its consent is the system's
authentication session (`src/host/auth-session.ts`, under
`@repo/credentials`' `authSessionConsent`), which catches the sign-in's
HTTPS callback on `vespin.dev` through the `webcredentials:` associated
domain, and its tokens are sealed in the settings file under a key the
Keychain keeps (`src/host/keychain-cipher.ts`). The
root layout stands the tabs and Settings behind the account and the
sign-in screen in front of them otherwise. A `vespin.dev` link the app
draws is routed by `src/app/+native-intent.tsx` through
`@repo/features/ios-app-links`, the same list the host's association file
claims for the app; any other opens in Safari.

A `-fixture <profile>` launch argument (`src/host/launch-arguments.ts`)
stands the host on the desktop's synthetic data instead of the service, the
Inbox profile's threads and the tasks holding them among it
(`@repo/host/fixture-inbox`), the acts the profile stages, such as a mark
or a thread's file read, answered by the fixture (`fixtureActs` in
`src/host/fixture-host.ts`), which is how the Maestro flows run with no
server. A `-authServer stub` launch argument
instead signs in against an account service the app answers itself
(`src/host/stub-auth-server.ts`), whose authorization page grants at once,
which is how `maestro/sign-in.yaml` signs in, relaunches signed in, and
signs out. What Hermes lacks of the web platform
the host stands on is polyfilled in one place, `src/host/polyfills.ts`, each
with a line on why; Shiki stays out of the app, and a fenced block is drawn
plain.

## Tests

Logic is tested with vitest, under `src/**/*.test.ts`, as root `AGENTS.md`'s
Testing section says. Screens are not unit-tested: each is checked by a Maestro
flow under `maestro/` that drives the simulator and takes a screenshot. A new screen adds its steps to a flow, or a flow of its own, and a
pull request with UI shows its screenshots to the developer in a thread.

## Conventions

- **Native components only.** The tab bar is expo-router's `NativeTabs`, a
  screen stack is its native `Stack` with the system's headers, search, and
  toolbars, glass is `expo-glass-effect` through `@repo/ui-native`'s
  `GlassBar`, and everything else is `@expo/ui`.
  Never a tab bar or header drawn in JavaScript, never a hand-drawn copy of
  glass, and never a DOM component (`'use dom'`).
- **SwiftUI first.** A screen is drawn by SwiftUI through `@expo/ui` (`Host`,
  `List`, `Section`, `Form`, `NavigationSplitView`, and the rest), the
  developer's choice of Nov 8, 2026. A React Native view draws only what
  SwiftUI has no piece for: message markdown and the agent transcript.
- **Every control comes from `@repo/ui-native`**, the app's design system
  (`packages/ui-native/AGENTS.md`), as the web's come from `@repo/ui`. A
  screen composes its components and imports neither `@expo/ui` nor
  `expo-glass-effect`, which lint refuses
  (`anti-slop/no-raw-press-outside-ui-native`); the app still declares both,
  since Expo links a native module from the app's own dependencies.
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
