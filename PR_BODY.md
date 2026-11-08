Leaf 7d-2b of "One place module owns where the window stands" (https://vespin.dev/stage/task/1746). This PR takes **Admin** and the **Automations pages** off `TasksControl`, following #7584's pattern for the Board and a person's page.

## Summary

```diff
 places/routed-doors.ts
+useAdminDoor(tasks)        { open(view?), close, preload }   # useAdminRoute + PlaceLeave.arrive, under tasks.workspace
+useAutomationsDoor(tasks)  { open(place?), close }           # useAutomationsRoute + PlaceLeave.arrive, under tasks.workspace
 admin/admin-route.ts
+AdminRoute (was use-tasks-tab's AdminViewControl)
+useAdminView()             AdminView                          # the view standing, the Overview while Admin does not stand
 automations-route.ts
+useAutomationsPlace()      { open, place, runs, standingIn }  # what useAutomationsRoute reads, alone
 workspace-routes.ts
 useRoutedViews()           { board, person, +automations }    # what a step's name and Copy link read
 tasks/use-tasks-tab.ts  (TasksControl)
-adminView        { open, view, onOpen, onClose, onPreload }
-automationsView  { open, place, runs, onOpen, onRuns, onClose }
+onAutomationRuns(shown)                                        # the one flat member left (Decision 1)
 desktop/mobile-bar.tsx
-mobileBarShown(room, tasks, place)
+mobileBarShown(room, tasks, standing)   + useBarStanding()     # { place, automations, admin }
 navigation-history.ts  (throughHistory, ListBacks)
-automationsView: { ...tasks.automationsView, onRuns: … lists.runs() }
+onAutomationRuns: (shown) => (shown ? tasks.onAutomationRuns(true) : lists.runs())
```

Who reads what now:

| Surface | Read | Door |
| --- | --- | --- |
| sidebar: Admin/Automations rows' current state, the failed-run mark | `useWindowPlace().place`, `useAutomationsPlace()` | `useAdminDoor` (open, preload), `useAutomationsDoor` |
| shell: window title, standing-in, ⌘K Admin / Automations | `useBarStanding()` | `useAdminDoor`, `useAutomationsDoor` |
| shell: Admin's and Automations' loading frames | `useAdminView()` | `useAdminDoor`, `useAutomationsDoor().close` |
| Admin route (`admin-route.lazy.tsx`) | `useAdminView()` | `useAdminDoor` |
| Automations route / pages | `useAutomationsPlace()` | `useAutomationsDoor`, `tasks.onAutomationRuns` |
| mobile bar, Board route | `useBarStanding()` | — |
| tab switcher | `place`, `useRoutedViews().automations` | `useAutomationsDoor` |
| palette, Inbox (pane doors, listing), agent threads, agent page trail, description, person page, `ListedAutomations` | — | `useAutomationsDoor().open` |
| Back-list titles, Copy link | `useRoutedViews().automations` | — |
| `app.tsx` launch | — | `useAutomationsDoor(tasks).open` |

## Decisions

1. **One flat member: `onAutomationRuns`.** It isn't a `useTasksTab` internal; it stays on `TasksControl` because `throughHistory` overrides the way back from the runs (`lists.runs`). That override belongs to leaf 8. With `automationsView` gone, it had to go somewhere, so I moved only the override: from `automationsView.onRuns` to `onAutomationRuns`, and `lists.runs` calls `tasks.onAutomationRuns(false)`. Leaf 8 deletes it along with the rest of the history's narrow-way overrides.
2. **No `useTasksTab` internals were needed.** Opening Automations under the listed workspace is `tasks.workspace` (the old `openAutomations(place)` with no workspace resolved to exactly that). Admin opens under `stepOf(tasks.workspace)`, the `listedSlug` the tab handed `useAdminRoute`. So both are door hooks taking `Pick<TasksControl, "placeLeave" | "workspace">`, like `useBoardDoor`. The tab keeps its own `useAdminRoute`/`useAutomationsRoute` for opening links (`openRouted`).
3. **Admin's close and preload stay unguarded.** `adminView` spread `routedAdmin`, so its `onClose` and `onPreload` never went through `arrive`. Only `onOpen` did. `useAdminDoor` keeps that exactly: `open` goes through `arrive`, while `close`/`preload` are the route's own. The Automations close keeps its up-front ask (`arrive(NOTHING, route.onClose)`).
4. **Reads use the narrowest source.** Admin's open is `useWindowPlace().place === ROUTED_PLACE.ADMIN`, the same source `adminView.open` came from. Automations' open/place comes from `useAutomationsPlace()`, the same leaf parse `useAutomationsRoute` uses. I didn't compare `place === AUTOMATIONS` directly, so an address under the layout that no leaf matches reads exactly as before.
5. **`useAutomationsDoor` calls `useAutomationsRoute({ narrow: false })`.** The room only reaches `onRuns`, which no door presses, and `routed-exits.test.ts` already calls it the same way.
6. **`mobileBarShown` takes a `BarStanding`** (`{ place, automations, admin }`), read by `useBarStanding()`. It stays a pure function its test can call, and doesn't read `TasksControl` for places it no longer holds.
7. **`app.tsx`.** The fixture launch's Automations door is now `useAutomationsDoor(tasks).open`, the same `arrive` the old member made. Its Admin launch and the Admin link branch already used `app.tsx`'s own `useAdminRoute`, not `TasksControl`, so they're unchanged. The Admin link's `transitionalLeaveFirst` is 7e's (`openAppLink`).
8. **No visible change.** There's no TanStack-forced deviation, and the smoke table below matches `main` row for row.

## Doors to convert (carried from #7584)

1. Task selection and resume
   - [x] all (#7559)
2. Tabs within a task
   - [x] all (#7559, #7566)
3. Routed places' doors
   - [x] all (#7573)
   - [x] the five `onClose` doors: off `transitionalLeaveFirst`, but they still ask up front inside `arrive` (item 8)
   - [x] Board and person off `TasksControl` (#7584); Admin and Automations (this PR); the Inbox and version history (7d-3)
4. Settings and app links (`app.tsx`)
   - [ ] `changeTab`, `openSettings`, `chooseSettingsView`, `openAccountLink`, `openAppLink`'s Admin and place branches, `onOpenLink` (7e)
5. Workspace
   - [ ] `onChooseWorkspace`, the new workspace dialog's `onOpen` (7f)
6. History and tab switcher
   - [ ] `navigation-history.ts`'s `goTo`, `tab-switcher.tsx`'s `go`; `throughHistory`'s `onAutomationRuns` (leaf 8)
7. Elsewhere
   - [ ] the sidebar's New task row over Settings (`newTaskOver`)
8. Up-front asks inside `arrive`, where a door's move navigates nowhere while an ask stands
   - [ ] a task with no address yet; a place kept standing beside the task's; a fixture run's task bound for good; the target already standing; every routed place's `onClose`

## Review of #7582 and #7584 against the bug classes

I read both merged diffs against each class:
- the sidebar's current row
- Back-list titles
- a press over an open place
- slug fallback
- Copy link
- leave-guard double or missing asks
- off-screen state
- a link or ⌘K to the place already standing
- a refusal or late read over a place opened since
- held landings
- writes passing the blocker
- route memory split between consumers
- an ask lost on a move that stays

**No new bug found.** Neither PR has inline review comments.

- #7582's `stayed` flag is reset before every `arrive` move and every up-front Leave, so a stale `stays()` from an unguarded door never reaches a later ask. The last smoke row below exercises it: Leave on ⌘K to the automation standing keeps the ask, and the sidebar's Admin asks again.
- In #7584:
  - The person page's Copy-link home (`workspaceOfSlug(…) ?? tasks.workspace`, then `slug ?? id`) reduces to the old `personView.workspaceId ?? workspace.id` in every case.
  - `useBoardDoor`'s `open`/`close` are the old `moveFirst`/`closeFirst` exactly.
  - Every door hook reads the one `RoutedMemory` from the window's `RoutedExitsProvider`.
- The only slip was cosmetic: `VIEWS_AWAY` landed under `AGENT_AWAY`'s doc comment in `testing/tasks-control.ts`. Fixed here.

## Evidence

Browser smoke ran on the web fixture server (`vite` dev, `/app?fixture=…`), with the same Playwright script against `main` @ 2f2346c and against this branch @ 44636f4. Each row runs on a fresh page, one at a time. Each cell shows the address, `history.length` before→after the door, and the sidebar's `aria-current` row. Ctrl stands for ⌘ on Linux. The editor's ask is made by typing into the automation's name. Both runs were **identical**.

| Door | main | branch |
| --- | --- | --- |
| sidebar Automations (`inbox`, from Home) | `/personal/automations`, 2→3, current: Automations | same |
| ⌘K Go to Automations (`inbox`) | `/personal/automations`, 2→3, current: Automations | same |
| ⌘K an automation (`automations`) | `/personal/automation/…0003`, 3→4, current: Automations | same |
| an automation's row in the list | `/personal/automation/…0001`, 3→4, current: Automations | same |
| the list's Runs tab | `/personal/automations/runs`, 3→4, current: Automations | same |
| sidebar Admin (from the Automations list) | `/personal/admin`, 3→4, current: Admin | same |
| ⌘K Admin (`automations`) | `/personal/admin`, 3→4, current: Admin | same |
| editor's ask, sidebar Admin, Cancel | `/personal/automation/…0001`, 3→3, current: Automations, asked | same |
| editor's ask, ⌘K another automation, Cancel | `/personal/automation/…0001`, 3→3, current: Automations, asked | same |
| editor's ask, sidebar Admin, Leave | `/personal/admin`, 3→4, current: Admin, asked | same |
| editor's ask, ⌘K another automation, Leave | `/personal/automation/…0003`, 3→4, current: Automations, asked | same |
| editor's ask, ⌘K the automation standing, Leave, then sidebar Admin | `/personal/automation/…0001`, 3→3, current: Automations, asked again on Admin | same |

## Tests

- **Wiring fakes deleted.** `adminView` and `automationsView` are gone from `testing/tasks-control.ts` (`ADMIN_AWAY` included), from the Inbox harness (`asked.shownAutomations`), and from the hand-built fakes in the shell, palette, agent page, Automations page, sidebar, tab switcher, history, and Tasks-tab tests. Tests that recorded a fake's `onOpen`/`onClose` now press the real door and read where the router went, or hear the close through the window's routed exits (`leavingBy`):
  - `desktop-inbox-navigation.test.ts`: the automation crumb.
  - `command-palette.test.ts`: ⌘K's Automations row, and Copy link on an automation.
  - `desktop-agent-page.test.ts`: the automation sender.
  - `sidebar-admin.test.ts`: the Admin row.
  - `desktop-shell.test.ts`: ⌘K Admin, and the Automations frame's Escape.
  - `automations-page.test.ts`: every page move, recorded from the router's history; `deleted` read through `deletedNow`.
- **Behavior tests that still cover each door:**
  - `use-tasks-tab.test.ts`'s `ROUTED_DOORS` and `TAB_DOORS` press `useAdminDoor`/`useAutomationsDoor` through the real router and leave guard.
  - `navigation-history(-narrow).test.ts` covers the runs' way back through `onAutomationRuns`.
  - `automations-page.test.ts`: "a new automation with something written asks before any way out leaves it".
- **Harness.**
  - Admin and the Automations pages stand only where a test names their address (`SHELL_AT.ADMIN`/`AUTOMATIONS`, `mount({ at })`).
  - `shell-router.ts` now builds the Automations leaves as the window's tree does, since the page standing is read from its leaf.
  - Every test that draws the Tasks or Inbox surfaces now draws them under `windowRouter().provide`, as the window's root does: 16 files, a mechanical wrap.
  - Two `desktop-tasks.test.ts` cases moved from `renderToStaticMarkup` to a client draw. The router's location hook has no server snapshot, and the panel is never server-rendered.
- **No new test.** No behavior changed and no bug was fixed.
- **Ran:**
  - Every touched test file (39).
  - Also: `places/*`, `sidebar-*`, `desktop-inbox*`, `person-page`, `task-list-view`, `tasks-held-order`, `tasks-board`, `tasks-page`, `history-titles`, `panel-spans`.
  - All pass. `sidebar-walk`'s "Home from the last row" timed out once under a 35-file parallel run and passed alone. It isn't touched here; I'm reporting it as possible load sensitivity.
  - `tsc` on `@repo/panel`, `@repo/web`, and `@repo/desktop`; biome, oxlint, the anti-slop guards, and `pnpm discarded-effect` are clean. knip shows nothing in touched files.
  - CI runs the rest.

## Merge Danger

**Door:** two-way. No data, address, wire, or step-format change. A revert restores the two members.

**Blast Radius:** navigation, covering every surface that opens, closes, or reads Admin or the Automations pages:
- the sidebar
- the shell
- the mobile bar
- the tab switcher
- the palette
- the Inbox
- agent pages
- the description
- the person page
- Back-list titles and Copy link
- the fixture launch

🤖 Generated with [Claude Code](https://claude.com/claude-code)
