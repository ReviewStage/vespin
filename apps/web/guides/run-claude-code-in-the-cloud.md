---
title: How to run Claude Code in the cloud
description: Run Claude Code off your laptop with Anthropic's cloud sessions, GitHub Actions, your own server, or Vespin.
published: 2026-11-12
updated: 2026-11-13
faq:
  - q: Can it use my Claude Max plan?
    a: Yes. Anthropic's cloud sessions run on Pro, Max, Ultra, and Team plans, and on Enterprise premium or Chat + Claude Code seats. GitHub Actions, your own server, and Vespin can use a token from `claude setup-token`, which needs a Pro, Max, Ultra, Team, or Enterprise plan.
  - q: Can it run tests and a dev server?
    a: Yes. A cloud session runs commands in its own VM, and a setup script installs what your project needs. Its network access is Limited by default. A Vespin agent can start a dev server in its sandbox, share it with you by link, and open it in its own browser.
  - q: How do I watch it work?
    a: Cloud sessions are listed at claude.ai/code and in the Code tab of the Claude app. A GitHub Action replies in a comment on the issue or pull request. On your own server, Remote Control shows the session in your phone or browser. In Vespin, an agent's transcript is open in the Mac app and the web app.
  - q: Can I run several at once?
    a: Yes. Each `claude --cloud` command starts its own session. In Vespin, each agent gets its own sandbox, and an agent can start other agents. Every session counts toward your plan's usage limits, so several at once use them up faster.
---

You can run Claude Code in the cloud with Anthropic's Claude Code on the web, or with a cloud workspace such as Vespin, which runs Claude Code on your own Claude plan in a sandbox per agent and opens a pull request.

A cloud session keeps running after you close your laptop. Each one has its own machine and its own copy of the repository, and it pushes its work to a branch.

## Claude Code on the web

[Claude Code on the web](https://code.claude.com/docs/en/claude-code-on-the-web) runs each session in an isolated VM that Anthropic manages. It comes with your Claude plan, with no separate charge for the VM.

1. Open [claude.ai/code](https://claude.ai/code) and connect GitHub: authorize the Claude GitHub App, or run `/web-setup` in your terminal to use your `gh` login.
2. Keep the Default environment, or set network access, environment variables, and a setup script in a [cloud environment](https://code.claude.com/docs/en/cloud-environments).
3. Pick a repository and describe the task. From a terminal, `claude --cloud "<task>"` starts a session on your current repository and branch.
4. Review the diff in the session and create a pull request. With Auto-fix on, Claude responds to failing checks and review comments.
5. Run `claude --teleport` to continue the session in your terminal.

Sessions share your plan's rate limits, cloning and pull requests need GitHub, and an idle session's VM is reclaimed. Reopening the session restores the conversation ([limitations](https://code.claude.com/docs/en/claude-code-on-the-web#limitations)).

## GitHub Actions

The [Claude Code GitHub Action](https://code.claude.com/docs/en/github-actions) runs Claude Code in your repository's workflows. When you mention `@claude` in an issue or pull request comment, it replies there, pushes commits, or opens a pull request.

1. Run `/install-github-app` in Claude Code, or install the Claude GitHub App yourself.
2. Add a repository secret: `ANTHROPIC_API_KEY` for an API key, or `CLAUDE_CODE_OAUTH_TOKEN` for your Claude plan, made with `claude setup-token`.
3. Add the workflow file, then mention `@claude` in a comment.

Each run uses GitHub Actions minutes as well as tokens.

## Your own server

1. [Install Claude Code](https://code.claude.com/docs/en/setup) on a Linux VM and clone your repository.
2. Sign in with `/login`. On a machine with no browser, press `c` to copy the login link and open it on another computer.
3. Start `claude` inside `tmux` so it keeps running after you disconnect.
4. Run `/remote-control` to follow and steer the session from your phone or browser ([Remote Control](https://code.claude.com/docs/en/remote-control)).

You maintain and secure the server, and you set up a separate checkout for each session you run at once.

## Comparison

| | Claude Code on the web | GitHub Actions | Your own server | Vespin |
| --- | --- | --- | --- | --- |
| Runs on | Anthropic's VMs | GitHub's runners | Your machine | A Vercel Sandbox per agent, or your own Mac |
| Pays with | Your Claude plan | API key or Claude plan | API key or Claude plan | Your Claude plan or API key |
| Starts from | Browser, Claude app, terminal | An `@claude` comment or workflow | SSH | Mac app, web app |
| Pull requests | Yes | Yes | You set it up | Yes |
| Several at once | Yes | Yes | You set it up | Yes |

## Where Vespin fits

[Vespin](https://vespin.dev) runs many coding agents at once. Each cloud agent runs Claude Code on your Claude plan in its own sandbox, with its own checkout of your repository. It works on a branch, opens a pull request, and fixes failing checks. Its questions and review requests go to your inbox.

1. Download the Mac app or open [vespin.dev/app](https://vespin.dev/app), sign in, and connect GitHub in Settings › Workspace.
2. In Settings › Agents, add your Claude plan: run `claude setup-token` in a terminal and paste the token it prints. You can also add an Anthropic API key.
3. Make a task, describe the work, and start an agent on it.
4. Answer its questions in your inbox and review its pull request.

Agents can also run on your own Mac, or on another machine you add.
