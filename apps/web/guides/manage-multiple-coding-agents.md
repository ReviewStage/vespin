---
title: "Running 10 coding agents at once: who answers them?"
description: "When many coding agents run at once, their questions and pull requests wait on you. How to get those questions in one place and answer them quickly."
published: 2026-11-12
updated: 2026-11-13
faq:
  - q: How many agents can one person supervise?
    a: "It depends on how often your agents need you, more than on the agents themselves. Watch how long a question sits before you get to it. Once questions sit longer than the agents spend working, you're running more agents than you can answer, and another one only adds to the wait."
  - q: Do I have to watch my agents while they work?
    a: "No. Have them tell you when they need input, and judge the work by its pull request and checks. The transcript is worth reading when something went wrong."
  - q: Can I answer agents from my phone or Slack?
    a: "Yes, if you connect Vespin's Slack bot. It sends you each thread that waits on you as a DM, so you can answer from Slack on your phone. A decision comes with a button for each option and a to-do with Mark done, and anything else links back to the thread in Vespin ([Slack docs](https://vespin.dev/docs/slack))."
  - q: What should an agent ask me, and what should it decide alone?
    a: "It should ask you about product and design choices, trade-offs that cost something whichever way it goes, and steps that are hard to undo. It should also hand you anything only you can do, such as adding a secret. Everything else it should decide itself, because every small question it sends you is one more thing in your queue."
  - q: Do I still need worktrees or sandboxes?
    a: "Yes. Without them, two agents edit the same files and break each other's work. They just don't do anything about the questions."
---

Running agents in parallel is solved, and isolating each in a worktree or sandbox is easy. The bottleneck is you: every agent stops to ask, decide, or get reviewed, and those asks pile up across terminals.

We wrote the guides on this site that way. Seven agents ran at once, one per page, each with its own pull request, and a person approves every page before it goes up. Starting them was quick. What took the time was the part this guide is about: reading what each agent sent back and answering it.

## Give each agent its own checkout first

Before anything else, agents need to stop stepping on each other's files, and that part is easy now. In Claude Code, `claude --worktree <name>` starts a session in its own [git worktree](https://git-scm.com/docs/git-worktree) on a new branch ([Claude Code docs](https://code.claude.com/docs/en/common-workflows#run-parallel-sessions-with-worktrees)). [Conductor](https://www.conductor.build/docs/guides/parallel-agents/run-multiple-claude-code-sessions) makes a worktree and a branch for every workspace you open. [Cursor's cloud agents](https://cursor.com/docs/cloud-agent) skip your machine entirely and run each task on a remote one.

## Why ten agents are harder than one

With one agent, you answer its permission prompt or its question as it comes up, because you're already looking at it. With ten, you spend your time finding out which one is waiting. Most of the terminals you check are still working, and the one that needs you has a question halfway up a long transcript that you scroll past.

The questions themselves get harder to answer, too. An agent that explains a choice in four paragraphs makes you read all four before you can type a reply. Then the pull requests start landing faster than you can review them, and every one of them, along with every question, goes to whoever started the agent, even when a teammate knows that code better.

## Make the agent come to you

The first fix is to stop checking. Claude Code runs a `Notification` hook when it needs permission or is waiting for input, and you can point that hook at a script or a desktop notification ([hooks reference](https://code.claude.com/docs/en/hooks)). Cursor can message you on Slack when an agent finishes ([Cursor's Slack integration](https://cursor.com/docs/integrations/slack)).

Notifications have a weakness, though. Once you dismiss one, the question it told you about is back to being lost in a terminal.

## Keep a list that only shrinks when you answer

What fixes that is a single list of every open question, where a question stays until it's answered. If every agent you run is a Claude Code session on your own machine, its agent view already does this: sessions that need input are listed first, and you can filter down to only those ([agent view docs](https://code.claude.com/docs/en/agent-view)). We'd start there before reaching for anything else.

## Ask questions you can answer in a word

Most of what an agent asks you is a choice between a few options, a set of steps you have to do by hand, or a value only you know, like a name or an ID. So tell your agents to say which of those they're asking, to list the options, and to say which one they'd pick. A question in that shape takes seconds, and you can answer it from a phone.

## Let it keep working while it waits

An agent that stops dead at every question wastes the time you take to answer. Tell it to ask, then carry on with whatever doesn't depend on the answer. When the question is about code a teammate owns, it should go to that teammate rather than to you.

Review goes the same way. Small pull requests that each fit in one sitting get reviewed sooner than one big one, especially when the agent says what it changed and how it tested it. If one agent splits the work and starts others on the parts, have them report to it, so you hear from one agent instead of five.

## How we built this into Vespin

We built Vespin around that list. Every agent, on your Mac or in the cloud, posts what it needs from you to one Inbox, as a thread kept apart from its transcript. A post can end with one of three kinds of question. A decide asks you to pick one option, or several if the agent allows it, with the one it recommends marked, and an option can carry screenshots, recordings, or a page to compare. A do lists steps for you to tick off before you mark it done or say you couldn't. An answer asks for text, a number, a choice from a list, a yes or no, or a reply in your own words.

The Inbox's Needs me view shows only the threads waiting on you, and a thread stays open until you answer it or the agent withdraws the question. You can snooze one until later, and on the Mac the Dock icon counts how many are waiting.

Posting a question doesn't stop the agent. It keeps working, and your answer reaches it as a message. It can address the question to a teammate; if it doesn't, the question goes to the task's assignee, or to whoever started the agent. When a pull request is ready for review, the agent posts it to the same Inbox.
