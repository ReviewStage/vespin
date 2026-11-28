# The step bench

`bench.ts` times what one step of a moving row costs the web client's
window. A step is one agent's row moving, one task's row moving as its
agents' turns start and end, or a press on a row, opening a task from the
sidebar say. It times builds side by side, so a change is
measured against the commit it is based on. It is a tool, not a test:
nothing is asserted, no CI job runs it, and nothing it writes is committed.
It times the window only; `host-bench.ts` times the host's own task-list live
queries (the last section).

It drives the large stage of the `tasks-open` fixture
(`packages/panel/src/tasks/open-tasks-fixture.ts`), which an address asks
for:

```
/app?fixture=tasks-open&scale=large&move=<row>&every=<ms>
```

- **The stage:** the profile's own 24 tasks, with task 0 open on its running
  agent's tab. Beside them are 3,200 light tasks and 5,400 agents, the size
  of a real account at its largest. A Manager (`Bench manager`) started
  every 20th task's first agent. The first six light tasks are sub-tasks of
  task 0.
- **`move`:** the row each step moves.
  - `agent` (the default): a background task's agent.
  - `shown-agent`: the open task's first agent, the one its tab shows.
  - `task-agent`: the open task's second agent.
  - `task`: a background task's own row.
  - `sub-task`: the open task's first sub-task's row.
  - `tasks`: background tasks in turn, oldest first, each step ending a turn on the next, so each step moves another task to the top of the activity order.
  - `none`: nothing moves.

  An agent's step moves its `runStartedAt` by a millisecond, a row change
  that nothing drawn shows. A task's steps alternate between a turn
  starting (`agents.working` 0 → 1) and a turn ending (`working` 1 → 0,
  `agents.activityAt` moved to now).
- **`every`:** milliseconds between steps, 400 unless named. `every=0`
  starts no timer, and the page steps only when `vespinFixtureStep()` is
  called, which is how the bench steps it.

## The local lift

`?fixture=` works only in a development build: `web-fixture.ts` gates it on
Vite's `DEV`, which a production build replaces with `false`. A
development build is no place to time React, so for a bench, lift the gate
**locally** in each worktree you build. Never commit the lift:

```sh
sed -i.bak 's/if (!import.meta.env.DEV) return undefined;/if (false) return undefined;/' \
  apps/web/src/app/web-fixture.ts          # lift
mv apps/web/src/app/web-fixture.ts.bak apps/web/src/app/web-fixture.ts   # put it back
```

## Running it

Build each side for production, unminified so components keep their names,
and serve it:

```sh
git worktree add ../vespin-before origin/main      # the base, after `./scripts/bootstrap.sh` there
# lift the gate in both worktrees, then in each:
(cd apps/web && NODE_OPTIONS=--max-old-space-size=8192 npx vite build --minify false --outDir /tmp/bench-after)
(cd apps/web && npx vite preview --outDir /tmp/bench-after --port 4311 --strictPort) &
# and the same in ../vespin-before into /tmp/bench-before on port 4310
```

Then time the scenes, each a label and an address:

```sh
node tools/bench/bench.ts \
  --build before=http://localhost:4310 --build after=http://localhost:4311 \
  --scene 'task=/app?fixture=tasks-open&scale=large&move=task&every=0' \
  --scene 'overview=/app?fixture=tasks-open&scale=large&move=task&every=0' \
  --setup "overview=[...document.querySelectorAll('button')].find((b) => b.textContent === 'Invite links: redesign').click()" \
  --names DescriptionDocument,OverviewRelations,RelatedTasks --top 10
```

- **`--setup label=<script>`:** runs on that scene's page once it stands. The
  one above opens the open task's Overview by its title. A step to another
  place works too, such as
  `history.pushState(null, '', '/personal/agent/<id>'); dispatchEvent(new PopStateEvent('popstate'))`.
- **`--names`:** adds a row for each named component: how many times it
  rendered per step.
- **`--top N`:** lists each build's N components rendered most per step,
  and the N rendered again most, to find what to name.
- **Interleaving:** each round opens every scene on every build in turn, so
  a sandbox that slows down halfway weighs on both sides alike.
  `--rounds` (3), `--steps` (20), `--warm` (3), and `--settle` (150 ms
  waited after each step) set the run's size.

## Presses: opening a task, a new task, an Inbox item

A press scene steps by pressing rows rather than through the stage's door:
`--press label=<selector>` makes each of that scene's steps click, with the
mouse as a person does, the next of the elements the selector matches, in
turn. The selector is read again before each press, so one that leaves out
the open row never presses it. `--back label=<selector>` presses the next
of its elements after each timed press, untimed, where the window must
stand somewhere else before the next press does anything. These three are
the window's presses that matter most:

```sh
STAGE='/app?fixture=tasks-open&scale=large&move=none&every=0'
MY_TASKS='nav[aria-label="My tasks"] li.ui-list-row:not([data-current]) .ui-list-row-main'
node tools/bench/bench.ts \
  --build before=http://localhost:4310 --build after=http://localhost:4311 \
  --scene "open=$STAGE" --press "open=$MY_TASKS" \
  --scene "new=$STAGE" --press 'new=button[aria-label="New task"]' --back "new=$MY_TASKS" \
  --scene "inbox=$STAGE" --press 'inbox=main li.ui-list-row:not([data-current]) .ui-list-row-main' \
  --setup "inbox=[...document.querySelectorAll('button')].find((b) => b.textContent.startsWith('Inbox')).click()" \
  --warm 5 --steps 15 --settle 400 --rounds 3 --top 20
```

- **`open`:** the sidebar's My tasks rows, five tasks round and round.
- **`new`:** the sidebar's New task (`+`), then back to the next of those
  tasks.
- **`inbox`:** the Inbox's items in turn, each opened beside the list.

`--warm 5` opens each task once before any press is counted, so every
counted press lands on a page opened before, as most do. `--settle 400`
waits for what a press draws after its paint, the transcript and the tab
strip, before the next.

## What it reports

A cell is the range of the rounds' medians, one median step per round:

- **script ms:** CDP's `ScriptDuration` across the step. This includes
  the fixture re-staging its 8,600-row lists, which both sides pay alike,
  about 0.5 ms here.
- **components rendered:** the function and class components React ran in
  the step's commits. A shim standing in for React DevTools' hook counts
  them: a component counts where it mounted or was marked as having done
  work. Like DevTools, it walks only the children of a fiber whose children
  changed, since a bailed-out subtree keeps its flags from the commit it
  last rendered in.
- **· rendered again:** of those, the ones that stood before the step and
  ran again rather than mounted. Opening a task mounts its page, which is
  its work; what renders again is where to cut.
- **commits:** how many commits React made.

A press scene adds the press's Event Timing first, as the window's
`press.row` span reads it: **press → paint ms**, from the press to the
paint after it (the browser rounds it to 8 ms), and its parts, **input
delay** (before the handlers ran), **handlers** (the handlers, and React's
render of the update they made, which it runs before the event ends), and
**presentation** (from then to the paint). A press painted within 16 ms is
not reported and counts as 0. Then **press → last commit ms**, from the
press to React's last commit in the step: when what the press opened stands
drawn, transcript pages and late reads included. A change that defers the
opened page's draw shortens press → paint and must not lengthen this; one
that lands past `--settle` lands in the next step instead, so settle longer
when timing one.

The window is 1280×840, the size Vespin opens at. A sandbox's numbers
compare only with each other, so quote both sides from the same run.

## The host's live queries

`bench.ts` cannot see the host's task-list live queries
(`taskListCollections`, `taskListFollowing`): its fixture lays its lists
over the window's document, so they never run under it. A change to shared
host code, such as the tallies, the pull-request lines, or the summaries,
or a cost it adds while agents work, is invisible to it. `host-bench.ts`
runs the real `taskListCollections` in Node (V8 with its JIT, as the
desktop's main process runs it) over a busy account's rows, and draws every
list a window would read.

- **The seed** (`host-seed.ts`): 3,240 plans and 5,400 agents, every word
  invented. 220 plans are open and the rest Done, and the agents of a Done
  plan are archived, so about 93% of the agents are archived and 440 are
  live. Two in three agents hold a pull request, every 40th is on no task,
  and the first 12 are at work. The clock is pinned, so one process's rows
  equal another's.
- **A build** is a worktree of the repository, with its own
  `node_modules` (`./scripts/bootstrap.sh`). Each measurement is a fresh
  process of `host-worker.ts` that loads that worktree's own host, sync, and
  Effect, so the numbers are that build's code:

```sh
git worktree add /tmp/vespin-before origin/main       # the base, then ./scripts/bootstrap.sh there
node tools/bench/host-bench.ts --build before=/tmp/vespin-before --build after=. \
  --rounds 6 --steps 400
```

  With no `--build`, it times this checkout as `here`. `--only kept` or
  `--only answer` runs one kind of process; `--agents` (5,400) and
  `--kept-agents` (4,831, a phone's) set the account's size; `--steps` (400)
  how many moves each process takes.
- **Interleaving:** each round runs every build's processes in turn, so a
  sandbox that slows down halfway weighs on every build alike. A cell is the
  range of the rounds' figures, one per fresh process. A 4-core sandbox
  varies about ±0.5 ms a step and ±25 ms a draw, with the occasional round
  far out, so compare builds from one run and use 6 or more rounds.

What it reports:

- **kept draw:** the list stands over a local copy holding every plan and
  agent, as a phone's launch and a desktop's start do. Timed from standing
  to the tasks drawn (`keptDrawn`), then to the draw holding every agent,
  and the two together.
- **first whole answer:** one answer of the follow's whole rows with no kept
  list, as a desktop's or the web's first draw.
- **first whole answer in pages:** the same rows as a build that reads
  pages takes them: its first page (80 plans, the newest, with their agents)
  joined on at once, then every other page together with the last, each
  drawn once the draw tick passes. Reported as each of the two.
- **per moved live agent:** an answer past a sync id that moves one live
  agent's row, a turn starting and then ending in turn through the 440, and
  the draw tick passing. The median and p95 of the steps after the first 20.
- **per moved task:** the same for one live plan's own row, its status
  alternating and its update time advancing.
