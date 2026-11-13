---
title: "Running 10 coding agents at once: who answers them?"
description: "When many coding agents run at once, their questions and pull requests wait on you. How to get those questions in one place and answer them quickly."
published: 2026-11-12
updated: 2026-11-12
faq:
  - q: How many agents can one person supervise?
    a: "There is no fixed number. It depends on how often each agent needs you and how long each answer takes. If questions wait longer than the agents take to work, you are running more agents than you can answer."
  - q: Do I have to watch my agents while they work?
    a: "No. Set them up to notify you when they need input, and review the pull request when they finish. Reading a transcript as it runs is rarely worth the time."
  - q: Can I answer agents from my phone or Slack?
    a: "It depends on the tool. Cursor can send you a Slack message when an agent finishes ([Cursor docs](https://cursor.com/docs/integrations/slack)). Vespin's Slack bot sends you each question as a DM, so you can answer it from Slack on your phone, with a button for each option on a decision."
  - q: What should an agent ask me, and what should it decide alone?
    a: "Ask about product and design choices, trade-offs that cost something either way, steps that are hard to undo, and anything only you can do, such as adding a secret. Have it decide the rest itself."
  - q: Do I still need worktrees or sandboxes?
    a: "Yes. They keep agents from overwriting each other's changes. They don't help you answer them."
---

Running agents in parallel is solved, and isolating each in a worktree or sandbox is easy. The bottleneck is you: every agent stops to ask, decide, or get reviewed, and those asks pile up across terminals.

## Running agents in parallel

Each agent needs its own checkout. With Claude Code, `claude --worktree <name>` starts a session in its own [git worktree](https://git-scm.com/docs/git-worktree) on a new branch ([Claude Code docs](https://code.claude.com/docs/en/common-workflows#run-parallel-sessions-with-worktrees)). [Conductor](https://www.conductor.build/docs/guides/parallel-agents/run-multiple-claude-code-sessions) creates a worktree and branch for each workspace. [Cursor's cloud agents](https://cursor.com/docs/cloud-agent) run each task on a remote machine.

## What goes wrong

An agent stops for a permission prompt, a question, a choice between two approaches, a step only you can do (adding a secret, changing a repository setting), and a pull request to review. With ten agents, these come in faster than one person handles them in separate terminals:

- You switch between terminals to check which agent is waiting, and most of them aren't.
- A question sits in the middle of a long transcript, and you don't see it until much later.
- A question written as several paragraphs takes a while to read and answer.
- Pull requests arrive faster than you review them.
- Every question goes to the person who started the agent, even when someone else knows the answer.

## How to fix it

### Get notified

Have each agent tell you when it needs you. Claude Code runs a `Notification` hook when it needs permission or is waiting for input, and you can point it at a script or a desktop notification ([hooks reference](https://code.claude.com/docs/en/hooks)). Cursor can message you on Slack when an agent finishes ([Cursor's Slack integration](https://cursor.com/docs/integrations/slack)).

A notification you dismiss is gone, though, so notifications work best alongside a list.

### Keep one list of what's waiting

Put every open question from every agent in one list, and keep each one there until it's answered. Claude Code's agent view does this for background sessions on your machine: sessions that need input are listed first, and you can filter to only those ([agent view docs](https://code.claude.com/docs/en/agent-view)).

### Ask in a fixed format

Most questions are one of three kinds:

- a choice between a few options,
- steps for you to do by hand,
- a value only you know, such as a name or an ID.

Ask the agent to say which kind it's asking, list the options, and say which one it recommends. You can then answer in a word, and you can answer from a phone.

### Let the agent keep working

Tell the agent to ask its question and keep working on anything that doesn't depend on the answer.

### Send questions to the right person

If a teammate owns the code or the decision, the question should go to them.

### Review small pull requests as they're ready

Split the work so each pull request is small enough to review in one sitting, and have the agent say what it changed and how it tested it. If one agent splits the work and starts other agents on the parts, they can report to it, and it reports to you.

## Where Vespin fits

In Vespin, every agent, whether on your Mac or in the cloud, posts what it needs from you to one Inbox, as a thread separate from its transcript.

A post can end with one of three kinds of question: decide (pick one option, or several if the agent allows, with its recommendation marked), do (steps to tick off, then mark done or say you couldn't), or answer (text, a number, a choice from a list, yes or no, or a free reply). An option can include screenshots, recordings, or a page to compare.

The Inbox's Needs me view shows only the threads waiting on you. A thread stays open until you answer it or the agent withdraws the question. You can snooze a thread until later, and on the Mac the Dock icon shows how many are waiting.

Posting a question doesn't stop the agent. It keeps working, and your answer reaches it as a message. An agent can address a question to a teammate; otherwise it goes to the task's assignee, or to whoever started the agent.

You can also answer from Slack, where Vespin's bot sends you each thread as a DM, with buttons to answer decisions and to-dos ([Slack docs](https://vespin.dev/docs/slack)). Agents post their pull requests to the same Inbox when they're ready for review.
