Leaf 9f, PR 6 of 6 in leaf 9, of "One place module owns where the window stands" (https://vespin.dev/stage/task/1746). The brief asked to put the window's trail onto the router's history, move every move along it through one door owned by the place module (`along(delta, to)` in `place-leave.ts`), delete `transitionalLeaveFirst`, and delete `navigation-history.ts` with its two suites, keeping every behavior they held and changing nothing visible.

## Summary

```diff
 packages/panel/src/
-├── navigation-history.ts               # WindowTrail (base, highest, traveling, waiting), hear, followRouted, landedOn/aloneOn,
-│                                       # keepTrail, writeThrough/inTurn/drainTrail, recordTrail, goAlong, standTrail/listenTo,
-│                                       # written/afterVisit, TRAIL_LIMIT/EMPTY_TRAIL, useHistory, asking/goTo
 └── places/
+    ├── window-history.ts               # (git: renamed from navigation-history.ts)
+    │     StepRecord                    # what history.subscribe reported, keyed by each step's own number; a push clears past it
+    │     hear                          # write: the step saved, or the router's own write stamped in place; move: lands by number
+    │     writeStep / afterWrite        # a visit pushed one past the standing step, or replaced in its place
+    │     useWindowSteps                # visits, landings (stand what the entry saved, pass over unreachable), press counter
+    │     useWindowHistory, useHistoryMouseButtons, useRoutedStanding   # same public shape as before
+    ├── window-history.test.ts          # (git: renamed from navigation-history.test.ts)
+    ├── window-history-narrow.test.ts   # (git: renamed from navigation-history-narrow.test.ts)
     ├── place-leave.ts
+    │     along(delta, to)              # ask up front where `to` leaves the draft, then history.go(delta, { ignoreBlocker: true })
+    │     askUpFront                    # arrive's permanent up-front ask (new workspace, no-navigation doors), named
-    │     transitionalLeaveFirst
     └── window-steps.ts
-          Trail, TrailEntry, TRAIL_WRITE, TrailWrite, HistoryStep.at
+          KnownSteps, StepEntry, STEP_WRITE, StepWrite, HistoryStep.number
```

```text
Back / Forward / list step / Escape / mouse 3-4
  └─ goTo(number) → placeLeave.along(number - standing, path)
        ask standing and path leaves the draft? → ask(Leave → release, go)   (Stay → nothing moves)
        history.flush(); history.go(delta, { ignoreBlocker: true })
browser Back / Forward
  └─ popstate → useBlocker asks (unchanged)
history.subscribe (both)
  └─ StepRecord.hear → listeners → landed step reachable? stand(place) : pass(() => along(skip))
```

## Decisions

1. **One PR, no split.** With renames detected the diff is +646/−747 over 36 files: the module and both suites move with `git mv` and keep their bodies, so the review is the new record, `along`, and the renames.
2. **A step's number is the saved step's own `index`, unchanged in format.** It is one past the step it was pushed after and the same as the step it took the place of. `__TSR_index` is never read. The old trail saved the same positional count there (`base + at`), so a step from an older build is read as it is.
3. **The record is keyed by that number, from what `history.subscribe` reports** (`StepRecord`). A push deletes every number at or past it. A write the router made of its own (a routed navigation, a gate's redirect) is stamped in place with the routed step and its number, as `followRouted` did. The 50-step bound stays (`STEPS_KEPT`, was `TRAIL_LIMIT`), so Back goes no further than on `main`.
4. **A move lands on the step its number says:** a number the record knows, or the number the move's distance counts to (`BACK` −1, `FORWARD` +1, `GO` its index). Otherwise the record stands alone there, as `main`'s `aloneOn` did. A move that leaves the entry's state as it was, as a browser Back the blocker kept (TanStack notifies with the location unchanged), moves nothing.
5. **Why `along` asks up front.** In `@tanstack/history` 1.162.5 (`node_modules/.pnpm/@tanstack+history@1.162.5/node_modules/@tanstack/history/dist/esm/index.js`):
   - `tryNavigation` (line 39) runs blockers only when `args.type === "PUSH" || args.type === "REPLACE"`, so `go`/`back`/`forward` never ask.
   - Memory history's `go` (lines 393–395), the desktop's (`apps/desktop/src/renderer/index.tsx`), only moves its index.
   - Browser history, the web's (`apps/web/src/app/web-root.tsx`), asks on `popstate` (lines 218–239) unless `skipBlockerNextPop` is set, which `go(n, ignoreBlocker)` sets (lines 296–302).

   So `along` asks itself where the target's path leaves the draft (the same check the blocker's `shouldBlockFn` makes, now one `leavesDraft`), flushes, and goes with `ignoreBlocker: true`, so the web asks no second time. The browser's own Back still asks through `useBlocker`. The new test in `place-leave.test.ts` fails with `along` reduced to a plain `go`.
6. **A landing stands what its entry saved, whoever moved the history.** The window's own Back and a browser's go through the same listener. On the web the window's Back now redraws on the `popstate` a task after `history.go`, not before the browser moves, which is TanStack's documented way. The smoke shows the same end state on every row.
7. **Passing over an unreachable landed step goes through `along` inside `pass`**, because the move already asked.
8. **A write the router made of its own stands the window with it**, as `main`'s `routing` branch did. The moved suite caught this.
9. **Saved steps from older builds.** `{kind:"home"}`, `{kind:"plan"}` and untagged tabs are read by `savedStepOf`, unchanged, and their `index` is read as the number. **A step that can't be read lands as an entry holding no step**: the router stands its address, the link landing opens it, and the window writes its step there in place, as on `main`.
10. **`transitionalLeaveFirst` is deleted** (`grep` finds none). `arrive`'s up-front path is now `askUpFront`, which the new workspace's screen and the doors that move nowhere use.
11. **`HistoryStep.at` is now `number`** and `onGoTo` takes a step's number. `HistoryButtons`, its test, and the fakes in `desktop-shell.test.ts`, `desktop-settings.test.ts`, `version-history-phone.test.ts`, `version-history-keys.test.ts`, `sidebar-collapse.test.ts` and `narrow-screens.test.ts` follow; only the step-list fakes needed a change.
12. **The press counter moved with the hook** into `places/window-history.ts`, and its `press-listener-baseline.json` row moved with it.
13. **`testing/window-router.ts` is left as is.** It learns the memory history's entries from the actions `subscribe` reports, which is an oracle independent of the window's own numbers. Reading those numbers there would compute the tests' expectations with the code under test (`CLAUDE.md`, What a test checks).
14. **Renames:** `Trail` → `KnownSteps`, `TrailEntry` → `StepEntry` (`state` → `place`, plus `number`), `TRAIL_WRITE`/`TrailWrite` → `STEP_WRITE`/`StepWrite` (a write carries `address` and `place`). `StepWriteKind` is no longer exported (knip).
15. `"./navigation-history"` is gone from `packages/panel/package.json`. `packages/panel/AGENTS.md`'s Experiments pointer (`places/window-steps.ts`'s `useStepReach`) stays correct, and `window-steps.ts`'s header names `window-history.ts`'s `writeStep` as the rule `takesStepless` mirrors. The `workspaceMembersQuery` read for step titles is untouched.

## Review of #7671 against the bug classes

No defect found, so no fix and no test. Every moved block matches its pre-merge text apart from the export keywords, import paths and type names. One condition was rewritten (`columnSeen && boundFor !== undefined`); its caller hands `columnKnown && …`, and `columnKnown` already implied `boundFor !== undefined`. The three window-lifetime refs stay one set per window, hook order is stable, and `useStepNames`'s `subscribe` identity is unchanged. Not reachable: the sidebar's current row, Back-list titles, a press over an open place, slug fallback, Copy link, double or missing asks, off-screen state, a link or ⌘K to the place standing, a late read or refusal, held landings, a write past the blocker, an ask lost on a stay, a composed press writing two steps, a stepless launch entry, a narrow way back.

## Evidence

### Browser smoke

Setup: Chromium against `apps/web`'s `pnpm exec vite --port 5173 --strictPort`, at 1440×900 and 390×844 for the phone rows. Each row loads `/app?fixture=<profile>` fresh, waits for `nav`, and runs its steps one at a time. After each step it records the address, `history.length`, the sidebar's `aria-current` row, whether Back and Forward are enabled, any "Leave with unsaved changes?" ask, and any open list. Mouse buttons are `MouseEvent("mouseup", {button: 3|4})` on `window`; lists are the buttons' right-click menus.

The same 63 rows ran on this head (`5a185a2eb`) and on `main`'s source (`git checkout origin/main -- <changed source files>`, then HEAD restored). **The outputs are identical bar one line**: the snapshot after a browser Forward that re-entered the app from `about:blank` caught the page mid-reload (`Vespin` vs `-` in the current-row column). Every later row of that walk matches.

- **The one differing row** is `walk-browser`'s first browser Forward after two browser Backs left the app for `about:blank`. `main` recorded `/personal | 10 | Vespin | B-`, the new document drawn far enough to show its Back button; this head recorded `/personal | 10 | - | xx`, the same address and history length, snapshotted before the panel drew any sidebar row or history button. That Forward is a full page load into a fresh document, not a `popstate` the window's history hears, so no code this PR changes runs before the snapshot. The fixed 900 ms wait simply landed on either side of the first paint. The next Forward reads `/personal/inbox | 10 | Vespin | B-` on both sides, and so does every row after it.

| Rows | What they cover | Result (head = main) |
| --- | --- | --- |
| walk × {window button, mouse 3/4, browser} (`inbox`) | Inbox → item → Board → ⌘K person → Automations → Home → Settings, then Back ×10, Forward ×10 | same addresses, lengths, current rows and Back/Forward state at every step |
| task walk × {button, mouse, browser} (`tasks-comments`) | agent row (column tab) → side panel → Board → person → task, Back ×6, Forward ×6 | identical |
| lists (`inbox`, `tasks-comments`) | Back list "Home / Automations / Home / Priya Raman / Tasks / Inbox·Teammate invitations / Inbox / Home", pick 3 → person; Forward list "Home / Automations / Home / Settings", pick 1 → Automations; task Back list "Priya Raman / Tasks / Teammate invitations·Add teammate invitations / Teammate invitations" | identical titles and landings |
| Escape × 11 places | task, column tab, side panel, Inbox, item, Board, person, Automations, automation, Settings, Home | identical (e.g. automation → list → Home; Board → task; Settings → task) |
| reload × 11 places | each place's address reloaded (drops `?fixture`, as on `main`) | identical |
| ⌘K to the place standing | Inbox, Board, person, Automations, item, task, Home | no new entry on any, identical |
| links | each place's address loaded, then the sidebar and Back | identical (the panel did not draw `nav` on these fixture links in time on either side) |
| ask × {window Back, mouse 3, browser Back, list step} × {Cancel, Leave} (`automations-editor`, name edited) | one ask each; Cancel stays on the automation and the next Back asks again; Leave goes to `/personal` and asks nothing more | identical, no double ask |
| phone (390×844) | Inbox item ⇄ its way back and browser moves; the side panel's "Back to Teammate invitations" way back, browser Forward/Back; Settings page ⇄ list; automation → Automations ⇄ browser | identical |

Some steps on both sides didn't reach their target: the column tab and side panel on the `inbox` fixture, whose task row navigates nowhere; the runs row on `automations-runs`. The task rows above cover the column tab and the panel instead.

### Tests

- **New, `places/place-leave.test.ts`:** "the window's own Back over an automation being edited asks on the desktop's memory history, whose move along it asks no blocker, and Stay keeps it". Fails with `along` as a plain `history.go` ("Back asks"), passes with it.
- **Moved, not rewritten:** `places/window-history.test.ts` and `places/window-history-narrow.test.ts` (64 tests) are the deleted suites, renamed by `git mv`, their imports repointed and two names changed from "trail" to "history". Every behavior they held stays covered through `useWindowHistory`'s public face. They caught decision 8 before it shipped.
- **Ran, all passing:** `places/*` (incl. both moved suites and `place-leave`), `tasks/use-tasks-tab`, `desktop/{history-buttons, tab-switcher, desktop-shell, desktop-settings, version-history-phone, version-history-keys, sidebar-collapse, narrow-screens, task-pane-switcher, sidebar-walk, automations-page, command-palette}`, `app-*` (5 files), `history-titles`, `task-route`, `settings-link`: 830 tests in 28 files, then 623 in the 21 touched after formatting. Web: `browser-history-narrow`, `browser-history-narrow-panel`, `web-app-reload`, `load-link`, `handoff-load` (15).
- **Static:** `tsc` on `@repo/panel`, `apps/web`, `apps/desktop`; biome; `pnpm oxlint` (0 errors); `press-guard-check`; `style-guard`; `pnpm discarded-effect`; `scripts/repository-checks.sh`. `knip` reports nothing from this branch; the rest of its list and its `vite.config.ts` load error are already on `main`.
- **Left to CI:** every other suite.

## Merge Danger

**Door:** two-way. The saved step's format (`{place, index}`) is unchanged, so a revert reads every entry this build wrote.

**Blast Radius:** the window's Back, Forward, their lists, Escape, the mouse's buttons, and how the window follows a browser's move. On the web a window Back now redraws on its `popstate` rather than just before it.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
