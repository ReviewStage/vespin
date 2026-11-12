---
title: "Running 10 coding agents at once: who answers them?"
description: "How to keep many coding agents moving when each one stops to ask, decide, or get reviewed: the failure modes, and the patterns that fix them with any tool."
published: 2026-11-12
updated: 2026-11-12
faq:
  - q: How many agents can one person supervise?
    a: "It depends less on the agents than on how often they need you and how fast you answer. If every ask lands in one queue and most are a tap to answer, one person can keep many more agents moving than by switching between terminals. Watch the queue: if it grows faster than you clear it, you're running more agents than you can answer, and the extra ones are only waiting."
  - q: Do I have to watch my agents while they work?
    a: "No. Watching is the polling failure mode. Have agents push what they need to you, and check in when something is waiting. Review what they produce, the pull request and its checks, rather than their transcript as it scrolls."
  - q: Can I answer agents from my phone or Slack?
    a: "With some tools, yes. Cursor can notify you on Slack when an agent finishes ([Cursor docs](https://docs.cursor.com/background-agent/web-and-mobile)). In Vespin, the iOS app and the Slack bot both let you answer a decision with a button, and a reply typed on either reaches the agent."
  - q: What should go to the human, and what should the agent decide?
    a: "Send people what only they can do or decide: product and design choices, trade-offs with real cost either way, risky or irreversible steps, and things only they can do by hand. Let the agent decide everything small itself, or the queue fills with noise."
  - q: Do I still need worktrees or sandboxes?
    a: "Yes. Isolation keeps parallel agents from breaking each other's work. It just doesn't solve the human side, which is what the queue is for."
---

Running agents in parallel is solved, and isolating each in a worktree or sandbox is easy. The bottleneck is you: every agent stops to ask, decide, or get reviewed, and those asks pile up across terminals.

This guide is about that bottleneck. It covers how it shows up, the patterns that fix it with any tool, and where Vespin fits.

## Parallel is the easy part

Give each agent its own checkout and they stop stepping on each other. Claude Code does this with one flag, `claude --worktree <name>`, which starts a session in its own [git worktree](https://git-scm.com/docs/git-worktree) on its own branch ([Claude Code docs](https://code.claude.com/docs/en/common-workflows#run-parallel-sessions-with-worktrees)). Desktop apps such as [Conductor](https://www.conductor.build/docs/guides/parallel-agents/run-multiple-claude-code-sessions) make a worktree and branch for every workspace for you. Cloud agents, such as [Cursor's](https://docs.cursor.com/background-agent/web-and-mobile), run each task on a remote machine.

So starting ten agents takes a minute. Keeping all ten moving is harder.

## Where it breaks: the human in the loop

Each agent needs you a few times per task: a permission prompt, a question it can't settle alone, a design choice, a to-do only you can do (add a secret, change a repository setting), and a pull request to review. One agent, and you answer as it asks. Ten agents, and the questions come in faster than you can find them.

The usual failure modes:

1. **Polling terminals.** You cycle through tabs to see who is stuck. Most checks find an agent still working, so you've switched context for nothing. The one that is stuck has been stuck for twenty minutes.
2. **Missed questions.** An agent asks something in the middle of a long transcript, then goes idle. Nothing tells you. You find it an hour later, or never.
3. **Questions you can't answer quickly.** "Should I do A or B?" in prose, with the trade-offs buried in paragraphs. You have to read the whole thing, then type an answer the agent has to read back.
4. **PR pile-ups.** Agents finish faster than you review. Ten pull requests wait, each needing you to rebuild context on a task you started hours ago.
5. **Everything waits on one person.** Every question goes to whoever started the agent, even when a teammate owns that code or that decision.

Your throughput is no longer how many agents you run. It's how fast the asks reach you, and how fast you can answer each one.

## The patterns that fix it

These work with any tool. Some you can build with scripts, and some need a tool designed for them.

### 1. Get pushed, never poll

Stop checking agents. Have each agent tell you when it needs you, and stay quiet otherwise.

The simplest version is a notification hook. Claude Code fires a `Notification` hook, filterable to permission prompts or to a session waiting for input, and you can point it at a desktop notification or a script ([hooks reference](https://code.claude.com/docs/en/hooks)). Cloud agents often notify you on Slack when a run finishes ([Cursor's Slack integration](https://docs.cursor.com/slack)).

Pushes alone don't scale, though. Ten agents send ten separate notifications, and once one is dismissed, the question is lost again.

### 2. One queue for everything that waits on you

Put every open ask from every agent in one list, sorted with what needs you at the top. Answer down the list, and you're done when it's empty.

Claude Code's agent view is one such list for local background sessions: it groups sessions that need input at the top and lets you filter to everything waiting on you ([agent view docs](https://code.claude.com/docs/en/agent-view)). The property to look for in any tool: an ask stays in the queue until it's answered, so dismissing a notification never loses it.

A good queue also lets you put an ask away until later (snooze it) without losing it, and counts what's waiting somewhere you'll see it.

### 3. Typed asks, not prose

Most of what an agent needs from you fits one of three shapes:

- **A decision.** Pick one of a few options, ideally with the agent's recommendation marked.
- **A to-do.** Steps only you can do by hand, which you tick off and then mark done, or say you couldn't.
- **An answer.** A value only you know: a name, an ID, a number, a yes or no.

When the agent asks in one of these shapes, you answer with a tap instead of a paragraph, and the agent gets back exactly what it asked for. Typed asks are also what make answering from a phone notification or a Slack message practical.

Write it into your agents' instructions even if your tool has no such feature: "When you need a decision, list the options as a numbered list, mark the one you recommend, and stop."

### 4. Keep working around the question

An agent that stops dead at every question idles most of the day. Tell it to ask, then carry on with whatever doesn't depend on the answer, and come back when the answer arrives. Then an unanswered question costs you part of a task, not the whole task.

### 5. Route each ask to the person who can answer it

Not every question is yours. An agent working on billing code should be able to send its question to the person who owns billing. A tool that lets an ask name who it's for, and falls back to the task's owner, spreads the load across the team instead of piling it on whoever typed the prompt.

### 6. Hand off review in small pieces

PR pile-ups are a planning problem. Small, independent pull requests are faster to review than one large one, and the agent should post each one for review as it's ready, with what it changed and what it tested. If one agent splits the work and starts others on the pieces, those agents report back to it, and only it reports to you, so ten agents' worth of status reaches you as one.

## Where Vespin fits

Vespin is built around the queue. Every agent, running on your Mac or in the cloud, posts what it needs from you to one Inbox, as a thread apart from its transcript.

- **Typed asks.** An agent's post ends with one of three asks: **decide** (pick one option, or several where the agent allows, with the ones it recommends marked; an option can carry its own screenshots, recordings, or pages to compare), **do** (steps to do by hand, ticked off, then marked done or "couldn't do it"), or **answer** (typed fields: text, number, a choice, or yes/no, or a reply in your own words).
- **One queue.** The Inbox's **Needs me** scope shows only the threads waiting on you. A thread stays open until its ask is answered or the agent withdraws it. You can snooze a thread, and it comes back to the top when its time comes, or sooner if someone writes on it. On the Mac, the Dock badge counts what's waiting.
- **The agent keeps going.** Posting an ask doesn't hold the agent's turn. It carries on with what doesn't depend on the answer, and your answer reaches it as a message.
- **The right person.** An agent can address an ask to a teammate. Otherwise it waits on the task's assignee, or on whoever started the agent.
- **Answer from your phone or Slack.** The iOS app pushes asks that wait on you, with a button per option on a decision and a reply you can type in place. Vespin's Slack bot DMs you each thread, with a button per option, **Mark done** and **Couldn't do it** on a to-do, and **Open in Vespin** ([Slack docs](https://vespin.dev/docs/slack)).
- **Review as it lands.** An agent posts its pull request to the Inbox when it's ready for review, so PRs reach you one at a time, in the same queue as everything else.
