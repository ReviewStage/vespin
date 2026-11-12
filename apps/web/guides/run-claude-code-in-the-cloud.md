---
title: How to run Claude Code in the cloud
description: Four ways to run Claude Code off your laptop (Anthropic's cloud sessions, GitHub Actions, your own server, or Vespin) and how each handles your plan, pull requests, and watching the work.
published: 2026-11-12
updated: 2026-11-12
faq:
  - q: Can it use my Claude Max plan?
    a: Yes. Anthropic's cloud sessions run on Pro, Max, Ultra, and Team plans, and on Enterprise premium or Chat + Claude Code seats. GitHub Actions and your own server can use a token from `claude setup-token`, which needs a Pro, Max, Ultra, Team, or Enterprise plan. Vespin uses the same kind of token. Every option counts toward your plan's usage limits.
  - q: Can it run tests and a dev server?
    a: Yes. A cloud session runs commands in its own VM, with a setup script to install what your project needs. Network access is Limited by default. A Vespin agent runs in its own sandbox, can start a dev server and share it with you by link, and can open the page in its own browser.
  - q: How do I watch it work?
    a: Cloud sessions show up at claude.ai/code and in the Code tab of the Claude app. A GitHub Action replies in a comment on the issue or pull request. On your own server, use Remote Control to follow a session from your phone or browser. In Vespin, each agent's transcript is open in the Mac app and the web app, and its questions come to your inbox.
  - q: Can I run several at once?
    a: Yes. Each `claude --cloud` command starts its own session, and they run side by side. In Vespin you can start as many agents as you like, and an agent can start more agents for parts of a task. Running several at once uses up your plan's limits faster.
---

You can run Claude Code in the cloud with Anthropic's Claude Code on the web, or with a cloud workspace such as Vespin, which runs Claude Code on your own Claude plan in a sandbox per task and opens a pull request.

You can also run it in GitHub Actions, or on a server of your own. This guide covers all four, then lists Vespin's steps.

## Why run Claude Code in the cloud

On your laptop, a Claude Code session stops when the lid closes, and two sessions in the same checkout step on each other. In the cloud:

- The session keeps going while you are away, and you check on it from any device.
- Each task gets its own machine and its own copy of the repository, so you can run several at once.
- The agent pushes a branch, so you review its work as a pull request.

## Option 1: Claude Code on the web

[Claude Code on the web](https://code.claude.com/docs/en/claude-code-on-the-web) is Anthropic's own. Each session runs in an isolated VM that Anthropic manages. It is included in Pro, Max, Ultra, and Team plans, and in Enterprise premium or Chat + Claude Code seats, with no separate charge for the VM.

1. Open [claude.ai/code](https://claude.ai/code) and connect GitHub: authorize the Claude GitHub App, or run `/web-setup` in your terminal to use your `gh` login.
2. Accept the Default environment, or set network access, environment variables, and a setup script in a [cloud environment](https://code.claude.com/docs/en/cloud-environments).
3. Pick a repository and describe the task. From a terminal, `claude --cloud "Fix the flaky test in auth.spec.ts"` starts a session on your current repository and branch.
4. Review the diff in the session, then create a pull request. Turn on Auto-fix to have Claude respond to failing checks and review comments.
5. To keep working locally, run `claude --teleport` to pull the session into your terminal.

Limits to know, from [Anthropic's docs](https://code.claude.com/docs/en/claude-code-on-the-web#limitations): sessions share your plan's rate limits, cloning and pull requests need GitHub, and an idle session's VM is reclaimed after a while (your conversation is restored when you reopen it).

## Option 2: GitHub Actions

The [Claude Code GitHub Action](https://code.claude.com/docs/en/github-actions) runs Claude Code inside your repository's workflows. Mention `@claude` in an issue or pull request comment and it replies there, pushes commits, or opens a pull request.

1. Run `/install-github-app` in Claude Code, or install the Claude GitHub App by hand.
2. Add a secret: `ANTHROPIC_API_KEY` for an API key, or `CLAUDE_CODE_OAUTH_TOKEN` for your Claude plan. Create the plan token with `claude setup-token`.
3. Add the workflow file, then mention `@claude` in a comment.

Each run uses GitHub Actions minutes as well as tokens. It suits short tasks you start from an issue more than a long back-and-forth.

## Option 3: Your own server

Any Linux VM can run Claude Code.

1. [Install Claude Code](https://code.claude.com/docs/en/setup) on the server and clone your repository.
2. Sign in with `/login`. On a machine with no browser, press `c` to copy the login link and open it on your own computer.
3. Start `claude` inside `tmux` so it keeps running after you disconnect.
4. Run `/remote-control` to follow and steer the session from your phone or browser ([Remote Control](https://code.claude.com/docs/en/remote-control)).

You get full control of the machine. You also patch it, keep it isolated, and set up a new checkout for every parallel task yourself.

## Comparing the options

| | Claude Code on the web | GitHub Actions | Your own server | Vespin |
| --- | --- | --- | --- | --- |
| Runs on | Anthropic's VMs | GitHub's runners | Your machine | A Vercel Sandbox per agent, or your own Mac |
| Pays with | Your Claude plan | API key or Claude plan | API key or Claude plan | Your Claude plan or API key |
| Starts from | Browser, Claude app, terminal | An `@claude` comment or workflow | SSH | Mac app, web app |
| Pull requests | Yes | Yes | You set it up | Yes |
| Several at once | Yes | Yes | You set it up | Yes |

## Where Vespin fits

[Vespin](https://vespin.dev) is a workspace for running many coding agents at once. Each cloud agent runs Claude Code on your own Claude plan in its own sandbox, with its own checkout of your repository. It works on a branch, opens a pull request, and fixes failing checks. When it needs a decision or a review, it posts to one inbox instead of waiting in a chat you have to find.

To run Claude Code in the cloud with Vespin:

1. Download the Mac app or open [vespin.dev/app](https://vespin.dev/app), sign in, and connect GitHub in Settings › Workspace.
2. In Settings › Agents, add your Claude plan: run `claude setup-token` in a terminal and paste what it prints. You can add an Anthropic API key instead, or as well.
3. Make a task, describe the work, and start an agent on it.
4. Answer its questions in your inbox, and review the pull request it opens.

Agents can also run on your own Mac, or on another machine you add, instead of in the cloud.
