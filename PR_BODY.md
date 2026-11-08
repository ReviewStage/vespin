Leaf 9d, PR 4 of 6 in leaf 9, of "One place module owns where the window stands" (https://vespin.dev/stage/task/1746). The routed places' closes and `changeTab(TASKS)` now navigate to the bound task's own place, or Home, through `PlaceLeave.arrive`, so the router's blocker holds them. The window history's `leaving` state and its `onLeaveRouted`/`onStayRouted` are gone.

## Summary

```diff
 tasks/use-tasks-tab.ts
+onLeaveRouted() = standTaskPlace(boundForNow(), over = true, takesStepless = true)   # navigation to the bound task, or Home
-agentView.onClose = closeFirst(close)          # arrive(NOTHING, close): asked up front
+agentView.onClose = arrive(close, NOTHING)     # the blocker holds it
 places/routed-doors.ts
-Board / person / Automations close = arrive(NOTHING, route.onClose)
+Board / person / Automations close = arrive(route.onClose, NOTHING)
 app.tsx
 routedExits.leave = tasks.onLeaveRouted        # was history.onLeaveRouted (set `leaving`)
 routedExits.stay  = placeLeave.stays           # was history.onStayRouted + stays
-changeTab(TASKS) = arrive(NOTHING, () => { routedExits.leave(); count })
+changeTab(TASKS) = arrive(() => { if !stayed && router still at the press's address: routedExits.leave() }, count)
 onToBound        = placeLeave.pass(tasks.onLeaveRouted)   # was history.onLeaveRouted
 account switch   = leavePast(onGoHome)                     # was leave(); onGoHome()
 desktop-shell.tsx
 Go home (unknown workspace) = tasks.onLeaveRouted
-⌘⇧H / ⌘⇧I / ⌘⇧B / ⇧⌘T / setup's Finish = changeTab(TASKS); door()
+                                       = arrive(door, () => changeTab(TASKS))
 command-palette.tsx  onTasks(run)  = arrive(run, () => changeTab(TASKS))      # was changeTab; run
 tab-switcher.tsx     go(stop)      = arrive(free => openStop(stop, over = !free), () => { changeTab(TASKS); … })
 navigation-history.ts
-leaving state, leftForNone → home.onOpen, onLeaveRouted, onStayRouted, `home` input
 places/place-leave.ts
+stayed(): whether the move whose landing runs now said it `stays`  # false outside a landing
 places/place-binding.ts   useTaskAsk(): + boundForNow()
 task-route.ts             onOpen(at, takesStepless?)   # replace an entry holding no saved step
```

## Decisions

1. **The leave is the Tasks tab's `onLeaveRouted`, a router navigation.** It goes to the own place of the task bound *as the window stands at the call* (`boundForNow`), `over` any place, or Home where no task is bound. Every route's `onClose` reaches it through `RoutedExits.leave`, so Admin's and the version history's unasked closes are navigations too. No ask can stand on those places, so nothing visible changes.
2. **A press that brings the Tasks tab forward with a door moves the door first** (⌘⇧H, ⌘⇧I, ⌘⇧B, ⇧⌘T, setup's Finish, ⌘K's `onTasks`, the tab switcher). `changeTab(TASKS)` runs on landing, which is the sidebar's `arriveFor` shape. On `main` the tab change came first and only set `leaving`, a state the door's own move overwrote in the same batch. Once `changeTab` navigates, that order would write two steps. A door that only asks for a task, like ⌘K's agent of a task over the Board, moves nowhere, and the landing's leave then goes to the task just asked for.
3. **The trap: `changeTab(TASKS)` inside `landed`.** It leaves only where the router still stands at the address the press was drawn at (`routedHere.address`, read from the closure), and where the door did not ask for the place standing (`PlaceLeave.stayed()`). If the door moved the window, or kept the place it asked for, the press goes there, and the tab is only counted. `stayed()` is scoped to the landing that runs, so a Cancel never leaves a stale mark.
4. **`onToBound` passes the guard** (`placeLeave.pass`), as the history's write past the blocker did. It follows the host, which no page's ask is about.
5. **An entry holding no saved step is taken in place** (`TaskRoute.onOpen(at, takesStepless)`). A launch on `/app` with a task bound stands Home, which is no step there, and `main`'s visit replaced that entry. A plain push would have left `/app` behind the task, which the history tests caught. It replaces only an entry with no saved step, so a routed place's close (whose entry always holds one) pushes, as `main` did.
6. **The account switch is `leavePast(onGoHome)`.** Home is the router's move from wherever the window stands, so `main`'s `leave()` before it was always overwritten. Doing both now would write two steps.
7. **Go home on an unknown workspace calls `tasks.onLeaveRouted`** directly. No ask can stand there, and the blocker holds the navigation anyway.
8. **Counted Tasks-tab change with an ask standing.** On `main`, a palette or chord press over the edited automation asked up front for `changeTab` and then again through the blocker, and the first ask's count was dropped (#7593's follow-up). Now there is one ask, and Leave counts the tab once. Over the place it stands on (⌘⇧I over the Inbox), `main` counted a Tasks-tab change and this branch doesn't, because the door kept the place. This is analytics only; nothing visible changes.
9. **No TanStack-forced visible change.** The browser table below matches `main` row for row.

## Up-front checklist (item 8)

- [x] every routed place's `onClose` and `changeTab(TASKS)`: router navigations now (this PR)
- [x] the no-navigation cases (a task with no address yet, a fixture run's task, the target already standing, a held switch with no turn): kept on purpose (#7664 Decision 3)
- [ ] `navigation-history.ts`'s `goTo`/`asking`, the last `transitionalLeaveFirst` user: PR 6
- [x] the new-workspace screen: permanent case, kept

## Review of #7666 against the bug classes

No defect found, so no fix and no test. #7666 changed no press logic. Its one runtime change is where three readers get the tab's address: `history.location` instead of `window.location`. In `@tanstack/history`'s browser history (1.162.5), `parseLocation` builds `href` from `pathname + search + hash`, which is the string `addressHere()` built. It also wraps `window.history.replaceState`, so `mac-app-handoff.ts`'s raw `replaceState` updates `history.location` before `withLoadLink` reads it. `linkHere`'s panel-path test now reads the handed location's `pathname`, which is the same value. I checked every class (current row, Back titles, a press over an open place, slug fallback, Copy link, double or missing asks, off-screen state, a link or ⌘K to the place standing, a late read or refusal, held landings, writes past the blocker, an ask lost on a stay, reload and sign-in addresses). None reaches the changed lines differently.

## Evidence

### Browser smoke check

Setup: Chromium against `apps/web`'s `pnpm exec vite --port 5173 --strictPort`, at 1440×900. Each row loads `/app?fixture=<profile>` fresh, waits for `nav`, then runs one step at a time. Rows ran one at a time, on this head and on `main`'s source (`git checkout origin/main -- <changed source files>`, then HEAD restored). The two outputs are **byte-identical** (`diff` empty). `len` is `history.length`, `current` is the sidebar's `aria-current` row, and Ctrl stands for ⌘. Task 42 is "Teammate invitations".

| Profile | Steps | After the last step (main = branch) |
| --- | --- | --- |
| tasks-comments | Tasks row (Board) → Escape | `/personal/task/42` len 2→3→4, current: Teammate invitations |
| tasks-comments | Board → task row | `/personal/task/42` len 4, current: Teammate invitations |
| tasks-comments | Board → ⌘⇧H | `/personal/task/42` len 4 (task bound, so Home holds it) |
| tasks-comments | Automations → Escape | `/personal/task/42` len 4 |
| tasks-comments | Automations → task row | `/personal/task/42` len 4 |
| tasks-comments | Inbox → task row | `/personal/task/42` len 4 |
| tasks-comments | Inbox → ⌘⇧B | `/personal/tasks` len 4, current: Tasks |
| tasks-comments | ⌘K Priya (person) → Escape | `/personal/task/42` len 4 |
| tasks-comments | person → task row | `/personal/task/42` len 4 |
| tasks-comments | ⌘, → Escape (plain `changeTab(TASKS)`) | `/personal/task/42` len 3 |
| tasks-comments | ⌘, → ⌘⇧H | `/personal/task/42` len 4 |
| tasks-comments | Board → ⌘K Billing export | `/personal/task/42` len 4 |
| inbox (no task bound) | Board → Escape | `/personal` len 4, current: Home |
| inbox | Automations → Escape | `/personal` len 4, current: Home |
| inbox | person → Escape | `/personal` len 4, current: Home |
| automations-editor | Runs row (agent page) → Escape | `/personal` len 5, current: Home |
| automations-editor | agent page → task row | `/personal` len 5 |
| automations-editor | agent page → ⌘⇧H | `/personal` len 5 |
| automations-editor, edited | task row → **Cancel** | asked; automation unchanged, len 3, still edited |
| automations-editor, edited | task row → **Leave** | asked; `/personal` len 4, current: Home |
| automations-editor, edited | ⌘⇧H → **Cancel** | asked; unchanged, still edited |
| automations-editor, edited | ⌘⇧H → **Leave** | asked; `/personal` len 4 |
| automations-editor, edited | ⌘⇧I → **Leave** | asked; `/personal/inbox` len 4 |
| automations-editor, edited | ⌘K Billing export → **Cancel** | asked; unchanged, still edited |
| automations-editor, edited | ⌘K Billing export → **Leave** | asked; `/personal` len 4 |
| automations-editor, edited | ⌘K the automation being edited → **Leave** | asked; stays on the automation, len 3, still edited |
| automations-runs, edited | ⌘⇧H / ⌘⇧I / ⌘⇧B → **Leave** | `/personal`, `/personal/inbox`, `/personal/tasks`, each len 4; Back after ⌘⇧I returns to the run |

Not reachable in the browser: a close **with** the editor's ask standing. Escape in the edited editor is the editor's own key, and nothing else on that page closes it. The tests below cover it.

### Tests

- **`tasks/use-tasks-tab.test.ts` (real router, `usePlaceLeave`, binding and window history):**
  - The `ROUTED_DOORS` close rows (Board, person, agent page, Automations) now run the real `onLeaveRouted`, since the harness wires `exits.leave = control.onLeaveRouted` as `App` does.
  - New row: the Inbox's close.
  - New `test.each`: every close with **no task bound**, which arrives on Home.
  - Each row: it asks once, Cancel leaves the window as it stood, and Leave arrives as the press does with no ask.
- **`app-fixture-places.test.ts` (real `App`, edited-automation fixture):**
  - New rows "⌘⇧H / ⌘⇧I / ⌘⇧B / a person chosen in ⌘K over an edited automation asks, Cancel leaves the automation as it stood, and Leave arrives as the press does".
  - On `main`'s source, the three chord rows fail in this jsdom harness: an extra `/personal` step before the target. The browser on `main` doesn't show it (table above, and Back), so it's a timing difference in the harness, not a browser bug I can claim.
  - New test "the automation being edited chosen in ⌘K over its own edit asks, and Leave keeps it standing, edit and all". It fails with `changeTab`'s `stayed()` guard removed.
  - **The trap:** "Home pressed in the sidebar over an edited automation goes Home in one step once Leave is pressed" (existing), plus the new chord and person rows, fail with the router-moved check removed from `changeTab`. Each runs `onTabChange(TASKS)` in `landed`, inside `history.subscribe`, before React redraws.
- **Fake-`TasksControl` rows:** no fake rows for these closes were left. #7573/#7584 had already moved them to the real router. The fakes gain only the new members (`stayed`, `onLeaveRouted`).
- **Harnesses rewired:** `navigation-history(-narrow).test.ts` now leave by a task-route or Home navigation, as the real door does, and take an entry holding no step in place. This is what caught Decision 5.
- **Ran:** `use-tasks-tab`, `navigation-history`, `navigation-history-narrow`, `places/*`, `tab-switcher`, `desktop-shell`, `command-palette`, `app-*` (5 files), `narrow-screens`, `shell-room`, `sidebar-collapse`, `automations-page`, `read-failure`, `new-workspace-steps` and `task-route`: 776 tests, all passing.
  - `desktop-shell`'s "while Settings is still loading its frame stands…" failed once under that 23-file parallel run. It passed alone three times. It asserts Settings' loading placeholder before any press, so it's load-dependent and untouched by this diff.
- **Static checks:** `tsc` on `@repo/panel`, biome, `pnpm oxlint` (0 errors), `pnpm discarded-effect`, `scripts/repository-checks.sh`. CI runs the rest.

## Merge Danger

**Door:** two-way. No address, wire, data or step-format change, and a revert restores `leaving`.

**Blast Radius:** navigation. Leaving any routed place (its close, the Tasks tab, the chords, ⌘K, the tab switcher, the binding following the host, Go home, an account switch) is now one router navigation the blocker sees. The launch on `/app` with a task bound replaces its stepless entry, as before.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
