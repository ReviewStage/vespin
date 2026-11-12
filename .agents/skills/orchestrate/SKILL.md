---
name: orchestrate
description: Roll out a plan or Linear issue as a set of PRs by acting as an orchestrator, from a Vespin coding agent. Splits the plan into small PRs, makes each PR a subtask of the task it works on, gives each subtask its own worker (a Vespin coding agent) on a model and effort the orchestrator picks for that PR, runs independent PRs in parallel, has each worker babysit its PR and merge it on green unless the PR needs the user's attention, restacks a stack through a short-lived worker, monitors the workers through messages rather than polling, and closes every subtask and archives every worker once its work is done, so the user never has to clean up after a rollout. Use when the user says "orchestrate", "roll out this plan", or asks you to farm a plan or issue out to workspaces or agents instead of doing the work here.
---

# Orchestrate

You do no implementation work here. You are the orchestrator: the plan or
Linear issue describes the work; you split it into PRs, kick each of them off
with a new worker, and manage the rollout to merge.

You are a coding agent, and a worker is another coding agent, driven by your
agent tools. Prefer subtasks to agents on your own task: every PR gets a
child task of yours, and its worker starts on it, so the user sees the
rollout as a tree of tasks under yours. Only a helper with no PR, such as a
restack worker, starts on your own task. Where you work on no task (an
automation may start you on none), first make one task for the whole rollout
with `create_task`, named for the plan or the issue, and take "your own task"
below as that one. You and the workers talk by `message_agent`.

| Action | How |
| --- | --- |
| Ask the user | `post_thread` with a `decide` or `answer` ask, which waits for the reply; where another coding agent started you, also send it the thread's mention with `message_agent` and its agent id |
| Tell the user | `post_thread` without an ask, and your reply; where another coding agent started you, also send it the thread's mention, as above |
| Valid model ids | `list_models` |
| Your id, for reports | Nothing to record: a started agent is told your id and your mention link |
| Make a PR's subtask | `create_task` with `parentTaskId` set to your own task's id, `name` set to the PR title, and the PR's scope as `description` |
| Draw a dependency | `update_task` on the subtask of the PR that builds on another, with `blockedBy: { add: [<the other PR's subtask id>] }` |
| Start a worker | `start_agent` with `taskId` set to its PR's subtask, `title` set to the PR title, no `prompt` (it works from the subtask's description), the rest of the brief as `note`, plus `model` and `effort` (below) |
| Start a helper | `start_agent` on your own task (no `taskId`, or the rollout task's id where you work on none), with the brief as `prompt` |
| Worker's base branch | `start_agent`'s `branch` |
| Open a PR | `open_pull_request` with `base` |
| Message a worker | `message_agent` with the worker's agent id |
| Worker reports back | `message_agent` with the orchestrator's agent id |
| Check on a silent worker | `read_agent` with its agent id |
| Stop a worker | `stop_agent` with its agent id |
| Continue a dead or stalled worker | `start_agent` with `from: { agentId }` and a `note` repeating the PR url and its branch, "keep this PR and open no second one", your mention link, and "report to me" |
| Close a PR's subtask | `update_task` with `status: done` once its PR merged, unless its worker already marked it done, or `canceled` for a PR cut from the plan, once its worker is stopped and its PR closed; then archive its worker |
| Archive a worker | `update_agent` with `archived: true` and a short `reason`, once the agent is idle |
| List the rollout's agents | `list_agents` with a subtask's `taskId` for its workers, and with `thisTask` (or the rollout task's `taskId`) for the helpers |
| Point the user at a subtask, worker, or PR | The mentions `create_task` and `start_agent` answered, and the PR's URL |

Arguments: the plan (a file path, a Linear issue key such as `LUKE-159`, or
inline text), optionally followed by the model and effort the user wants the
workers on, or by a word on merging. They are the words after `/orchestrate`
in the developer's message, and the task's plan is the plan where those words
name none. Pull an issue with the Linear tools; read a plan file with `cat`.

Do not ask the user for a model, an effort, or a merge policy before you
start; decide them yourself, as below, and say what you chose in your first
report. What the user named in the arguments or the conversation wins.

- **Model and effort**: pick them per PR, from the valid ids for the agent
  (the table's "Valid model ids" row), never a guessed id. Match them to the
  PR: the strongest model at high effort for a PR that is hard to get right
  (a cross-cutting refactor, a migration or backfill, concurrency, security,
  auth, a subtle bug), and a faster or cheaper one at lower effort for a
  mechanical or well-specified PR (a rename, a copy change, a config or docs
  edit, a test added to a pattern already there). When nothing sets a PR
  apart, use the user's default model and effort where the host names one
  (`list_models`' default), and the strongest model at its default
  effort otherwise. A restack worker runs on a fast model.
- **Merging**: workers merge their PRs on green by default. Hold a PR for
  the user's explicit go only when it needs their attention: it changes
  data or infrastructure irreversibly (a destructive migration or backfill,
  a production setting, a secret), it settles a product, design, or
  security question the plan left open, it changes what users see in a way
  the plan did not spell out, or the user asked to review it. Mark each
  held PR in its brief, saying why: its worker asks the user for the go
  itself, in one thread of its own with its screenshots, once the PR is
  open and green, and tells you the answer.

**Cleaning up is your job.** Close each subtask and archive each worker as
soon as its work is done, never in a batch at the end: a PR's subtask and
its worker once its PR has merged (or been closed because it was cut from
the plan), a restack worker once it reports the restack done, and a stopped
or dead worker once a continuation has taken its PR over. Nothing marks a
subtask done by itself: its worker or you mark it done once its PR merges.
You mark your own task done at the end (Step 4).

Split the plan into small PRs and draw the dependency graph. Every PR gets
its own subtask and its own worker on it, which builds, opens, and babysits
that one PR, so review comments on several PRs are fixed in parallel.
Independent PRs start in
parallel from `main`. A PR that builds on another is based on that PR's
branch; a linear chain of them is a stack, and where chains branch off a
shared PR (a tree), each branch-off chain is a stack of its own. Prefer small
PRs and deep stacks over a few large PRs. Workers never restack: a
short-lived restack worker restacks a whole stack in one pass (Step 3).

**One thing, one thread.** The user hears of each thing once, from the agent
that holds it. A worker posts in a thread of its own what the user should
see or settle of its PR: the go for a held PR, a screenshot or a recording
of what it built, a question about its PR only the user can answer, a to-do
only they can do by hand, such as adding a secret. It has the pictures and
the context, so its thread carries them, and it sends you the thread's
mention by `message_agent`. You post nothing on a thing a worker's thread
already holds; mention that thread where you need to. Your own threads are
for what no one worker holds: a decision that spans PRs, a change to the plan
itself, and the final report (Step 4). Nobody posts routine milestones
(opened, fix pushed, CI green, merged); a merge-on-green PR that needs nothing
of the user gets no thread of its own, and the final report covers it. The service tells every agent
another agent starts the same: post its own threads, and send its starter
their mentions.

## Step 1: Make each subtask and kick off its worker

There is nothing to record: every agent you start is told your agent id and
how to reach you by `message_agent`.

Make every PR's subtask up front, as the table says, its `description` the
brief's first item (below) under `##` headings, and draw the dependency
graph on them with blocks. Make no sidebar section for the rollout; the
subtasks stand under your task. Where the workspace has Task descriptions
off, `create_task` offers no `description` and `start_agent` refuses a start
with no `prompt`: make each subtask by its name alone, and start its worker
with the brief's first item as `prompt` instead.

Start one worker per subtask, but only for PRs whose base exists. Kick off
every PR that starts from `main` now. Do not kick off a PR that builds on
another until that PR's worker reports it open and its branch pushed; a
worker started earlier would have nothing to build on. Then start it with
that PR's branch as its base.

Start each worker on its PR's subtask, as the table's "Start a worker" row
says, `title` at most 80 characters. Set `branch` to the base branch when it
is not `main`; the worker starts on it and is told to pass it as `base` when
it opens its PR. Give the rest of the brief (its items 2 to 5) as `note`,
which holds at most 64,000 characters, and the chosen `model` and `effort`,
checked against `list_models`. The call carries everything the worker is
told; do not follow it with a message.

Every brief must contain:

1. **The task**, the subtask's description: the PR's scope, acceptance
   criteria, and the plan or issue text this PR comes from (its own part,
   not the whole plan, where the plan is long, naming the plan's file in the
   repository, if it has one), plus a line on each PR below and above it in
   its stack. Say plainly what is out of scope.
2. **Branching**: the base branch, the PR's branch, and how to open it
   against that base (the table's "Open a PR" row for the host). The worker
   never restacks.
   When the orchestrator says a restack is pending, it pushes or discards any
   work in flight, stops pushing, and replies "holding". When told the
   restack is done, it runs `git fetch origin <branch>` and `git reset
   --hard FETCH_HEAD` before touching the branch again (its clone may track
   no other branch than the one it started on).
3. **Babysit and merge**: watch CI and review comments on the PR, fix what
   fails, and merge as root `AGENTS.md`'s "Merging" says. Say which of the
   two applies: merge on green, taking the kickoff as the go (the default),
   or hold for the user's explicit go, for a PR that needs the user's
   attention, saying why: once the PR is open and green, the worker asks the
   user for the go itself, in one thread of its own with its screenshots
   (an Approve or Request changes `decide`), and merges on the answer. A
   worker on merge-on-green that finds the PR needs the user after all (a
   review comment it should not settle alone, a change that grew past its
   brief) does not merge: it first disarms the merge it armed (`gh pr merge
   --disable-auto`, which also takes the PR out of the merge queue), asks the
   user in a thread of its own, reports blocked on that thread, and re-arms
   it only on the user's go. A PR based on another PR merges only once that
   PR has merged and the restack has retargeted it to `main`.
4. **Report back, do not wait to be asked**: on each milestone (opened, fix
   pushed, CI green, blocked, merged) tell the orchestrator, as the table's
   "Worker reports back" row says, in this shape (as a short
   message in a teammate's words rather than a form):

   ```text
   <PR title>: <status>. PR: <url>. <what happened / what is blocking>
   ```

   Also tell it to answer any message the orchestrator sends it, and the
   other workers' PRs and agent ids, and that it messages them too, where
   their work meets: a shared file, an interface, a PR it builds on. What
   the user should see or settle of its PR it posts in a thread of its own,
   pictures drawn in it, and sends the orchestrator that thread's mention;
   it posts no routine milestone, and no thread at all for a merge-on-green
   PR that needs nothing of the user.
5. **Ask, do not guess**: when the task is ambiguous, the plan and the code
   disagree, or a choice would change a PR's shape, send the question to the
   orchestrator the same way and wait for the answer instead of picking an
   interpretation. The orchestrator holds the whole plan and the user's
   intent; the worker holds one PR. What only the user can settle or do of
   its own PR (a secret, a repository setting, a test on their Mac) the
   worker asks the user in a thread of its own, as item 4 says. Small
   judgment calls stay with the worker.

Keep each PR's subtask (its id and its mention), its worker's ids (its agent
id and its mention), branch, and PR url; you need them to reply, to kick off
the PRs above, to restack, and to close and archive.

## Step 2: Monitor by messages, not polling

Do not poll workers in a loop. Workers message you when something happens,
and each message arrives as a new turn; a worker's
`message_agent` arrives the same way. On each report:

- **PR opened**: if a PR is waiting on this one, kick its worker off now
  (Step 1) with this PR's branch as its base.
- **Fix pushed**: if any PR builds on this one, restack (Step 3).
- **Asked the user**: a worker sends you the mention of a thread it posted.
  Post nothing of your own on that thing; its answer reaches the worker,
  which tells you.
- **Question or blocked**: answer from the plan and the other PRs' state,
  replying to that worker as the table's "Message a worker" row says. Where
  the question is the user's and is about that one PR, tell the worker to
  ask the user in a thread of its own; where it spans PRs or changes the
  plan, ask the user yourself through the table's "Ask the user" row, and
  relay the answer to each worker it concerns. A merge-on-green PR that
  turns out to need the user becomes a held PR: tell its worker to disarm
  its merge and ask the user for the go itself.
- **Merged**: if any PR builds on this one, restack (Step 3), which also
  retargets the PR above to `main`. Close the merged PR's subtask and archive
  its worker now, as the table says.
- **Worker ended**: a line from Vespin, not the worker, naming a
  worker of yours whose turn failed, or that someone else stopped or
  archived. No report will come from it on its own, so act now unless its PR
  already merged or was cut: read it with `read_agent`, then continue a failed worker
  as the table's "Continue a dead or stalled worker" row says. For one the
  user stopped or archived, ask the user whether to go on before you
  continue it. Each ending is told once, so do not wait for a second line.

A worker that fails, is stopped, or is archived is reported to you
as above, but one whose runner hangs is reported only once Vespin abandons its
turn, a day later. So if a worker has gone quiet far longer than its work
plausibly takes, send it one message asking for status, and check on it as
the table says. If the
message is refused because its session has ended, the worker is dead (in
Vespin it now reads `failed`). Continue it yourself, as the table's "Continue
a dead or stalled worker" row says; do not ask the user to.

If a worker is alive but going the wrong way (out of scope, or against an
answer you gave it) or stuck, and a message does not turn it, stop it as the
table says, then continue it the same way, with the correction in the note.

The continued agent runs on the old one's task and model, with its
transcript and a copy of its work. While the old worker's PR is open, the
new agent carries that work onto the PR's branch and opens no second PR;
the note says so too, since Vespin may not have recorded the PR yet. If
`start_agent` refuses because the old worker is still running, stop it,
wait until `list_agents` no longer reads it `running`, and call again. An
agent already continued is continued again, and the answer's
`earlierContinuations` names the earlier ones: if one of them is the worker
you meant, archive the agent you just started and continue that one instead.

Track the new worker in the old one's place, by its id and mention, and
archive the old one. Never start a replacement worker from scratch: the brief's
work lives in the old worker's transcript.

## Step 3: Restack

Run one restack at a time per stack. Tell every worker in the stack, and in
each branch-off stack based on it, that a restack is pending, and wait for
each to reply "holding"; stop one that does not hold, as the table says. Then
start a short-lived restack worker (the table's "Start a helper" row, named
"Restack <stack title>"; without `branch`, on
`main`, since a Vespin agent never pushes the branch it was started on, so its
checkout is a single-branch clone of `main`, possibly shallow, and its brief
has it first run `git remote set-branches origin '*'`, then `git fetch
origin`, with `--unshallow` when `git rev-parse --is-shallow-repository` says
`true`) whose brief names the
trunk (`main`, or the parent PR's branch for a branch-off stack whose parent
has not merged), every unmerged branch bottom to top, and, after a merge, the
PR to retarget with `gh pr edit <number> --base main`. It first points a
local branch at each one's remote tip, bottom to top (`git checkout -B
<branch> origin/<branch>`), then adopts them with `gh stack init --base <trunk> <branch> ...` and
restacks them in one pass: `gh stack sync` (fetch, cascading rebase, atomic
push, and relink) when nothing conflicts. When `gh stack sync` reports a
conflict, it restores every branch; the worker then runs `gh stack rebase`,
resolves each conflict and runs `gh stack rebase --continue` (or `--abort` to
give up), and after a successful rebase runs `gh stack push`, which pushes
each branch with `--force-with-lease`. Only when `gh stack` is missing or
fails, the fallback is to note the cutoff, which is the old trunk tip (`git
rev-parse origin/<trunk>`) or, after a merge, the merged PR's last head (`gh
pr view <number> --json headRefOid`), then `git fetch` and run `git rebase
--update-refs --onto origin/<trunk> <cutoff>` from the top branch, so neither
a rewritten trunk's old commits nor a squash-merged PR's commits are
replayed; on a conflict, resolve and stage it, then `git rebase --continue`
(or `--abort`), and only after the rebase succeeds push every branch with
`--force-with-lease`. It restacks each branch-off stack the same way onto its
parent's new head (or onto `main`, past the parent's last head, once the
parent has merged), asks you when a conflict needs a judgment call, opens no
PR of its own, and reports when done. Then archive it and tell every held worker to reset and resume.

## Step 4: Finish

Before you report, check that nothing you started is left standing: every
subtask reads done or canceled, and the table's "List the rollout's agents"
row shows no worker unarchived, restack and replaced workers among them.
Close and archive whatever is left. Then report to the user, as the table's
"Tell the user" row says (one inbox post without an ask, mentioning each
PR):
the merged PRs with links, anything that was cut or changed from the plan,
and any follow-ups the workers surfaced. If the rollout came from a Linear
issue, update the issue with the merged PRs. Then mark your own task done,
unless another coding agent started you on it.

## Rules

- Never do the PR's implementation work yourself.
- One thing, one thread. A worker posts what the user should see or settle
  of its PR, pictures included, and sends you the mention; you never post a
  second thread on something a worker's thread holds, and keep your own
  threads to what spans PRs and the final report. Nobody posts routine
  milestones, and a merge-on-green PR that needs nothing of the user gets no
  thread.
- Point the user at a worker or PR with a deep link or mention, not an id.
- One PR per subtask and per worker. Do not reuse a worker or a subtask for
  a second PR; a continuation of a worker takes over its source's PR on its
  subtask.
- A PR that builds on another gets its worker only after that PR is open.
- Workers never restack; a restack runs only in a restack worker, while
  every affected worker holds.
- Every PR's worker runs on its own subtask of your task; only a helper
  with no PR runs on your own task.
- You clean up what you made: every subtask closed and every worker
  archived, as soon as its work is done, and your own task done at the end.
  The user never cleans up after a rollout.
- Do not archive a worker while its PR is unmerged, unless a continuation
  has taken the PR over or the PR was closed because it was cut.
- Stop a worker only when it goes the wrong way, is stuck, will not hold
  for a restack, or its PR is cut. Continue a dead or stopped worker unless
  its PR was cut; never start a fresh one to replace it.
