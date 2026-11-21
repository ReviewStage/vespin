# The step bench

`bench.ts` times what one step of a moving row costs the web client's
window. A step is one agent's row moving, or one task's row moving as its
agents' turns start and end. It times builds side by side, so a change is
measured against the commit it is based on. It is a tool, not a test:
nothing is asserted, no CI job runs it, and nothing it writes is committed.

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
- **`--top N`:** lists each build's N components rendered most per step, to
  find what to name.
- **Interleaving:** each round opens every scene on every build in turn, so
  a sandbox that slows down halfway weighs on both sides alike.
  `--rounds` (3), `--steps` (20), `--warm` (3), and `--settle` (150 ms
  waited after each step) set the run's size.

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
- **commits:** how many commits React made.

The window is 1280×840, the size Vespin opens at. A sandbox's numbers
compare only with each other, so quote both sides from the same run.
