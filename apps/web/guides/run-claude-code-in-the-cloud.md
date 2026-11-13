---
title: How to run Claude Code in the cloud
description: Run Claude Code off your laptop with Anthropic's cloud sessions, GitHub Actions, your own server, or Vespin.
published: 2026-11-12
updated: 2026-11-13
faq:
  - q: Can it use my Claude Max plan?
    a: Yes. Anthropic's cloud sessions run on Pro, Max, Ultra, and Team plans, and on Enterprise premium or Chat + Claude Code seats. GitHub Actions, your own server, and Vespin can all use a token from `claude setup-token`, which needs a Pro, Max, Ultra, Team, or Enterprise plan.
  - q: Can it run tests and a dev server?
    a: Yes. A cloud session runs commands in its own VM, and a setup script installs what your project needs, though its network access starts out Limited. In Vespin, an agent can start a dev server in its sandbox, share it with you by link, and open it in its own browser to look at the page.
  - q: How do I watch it work?
    a: Anthropic lists your cloud sessions at claude.ai/code and in the Code tab of the Claude app. A GitHub Action answers in comments on the issue or pull request. On your own server, Remote Control shows the session on your phone or in a browser. In Vespin, you open the agent's transcript in the Mac app or the web app.
  - q: Can I run several at once?
    a: Yes, but they all draw on one plan. Each `claude --cloud` command starts its own session, and in Vespin each agent gets its own sandbox and can start other agents. Every session counts toward your plan's usage limits, so running several at once uses them up faster.
---

You can run Claude Code in the cloud with Anthropic's Claude Code on the web, or with a cloud workspace such as Vespin, which runs Claude Code on your own Claude plan in a sandbox per agent and opens a pull request.

We build Vespin, so we have a stake in this. Most of this page is about the other ways to do it, though, and for a lot of people one of them is the better choice. The reason to leave your laptop at all is that a cloud session keeps going after you close the lid. Each one also gets its own machine and its own copy of the repository, so you can run several without them editing the same checkout, and each pushes its work to a branch you review as a pull request.

## Claude Code on the web

[Claude Code on the web](https://code.claude.com/docs/en/claude-code-on-the-web) is Anthropic's own, and if you already pay for a Claude plan it's the shortest way in. Each session runs in an isolated VM that Anthropic manages, and the VM costs nothing on top of your plan.

1. Open [claude.ai/code](https://claude.ai/code) and connect GitHub: authorize the Claude GitHub App, or run `/web-setup` in your terminal to use your `gh` login.
2. Keep the Default environment, or set network access, environment variables, and a setup script in a [cloud environment](https://code.claude.com/docs/en/cloud-environments).
3. Pick a repository and describe the task. From a terminal, `claude --cloud "<task>"` starts a session on your current repository and branch.
4. Review the diff in the session and create a pull request. With Auto-fix on, Claude responds to failing checks and review comments.
5. Run `claude --teleport` to carry on with the session in your terminal.

Cloning and pull requests need GitHub, so a repository hosted somewhere else is harder going. A session that sits idle also loses its VM. When you reopen it you get the conversation back, but on a fresh machine ([limitations](https://code.claude.com/docs/en/claude-code-on-the-web#limitations)). If you run one or two sessions at a time and you like working in claude.ai, this is what we'd tell a friend to use.

## GitHub Actions

The [Claude Code GitHub Action](https://code.claude.com/docs/en/github-actions) runs Claude Code inside your repository's workflows. You mention `@claude` in a comment on an issue or pull request, and it answers in that thread, pushes commits, or opens a pull request.

1. Run `/install-github-app` in Claude Code, or install the Claude GitHub App yourself.
2. Add a repository secret: `ANTHROPIC_API_KEY` for an API key, or `CLAUDE_CODE_OAUTH_TOKEN` for your Claude plan, made with `claude setup-token`.
3. Add the workflow file, then mention `@claude` in a comment.

Each run spends GitHub Actions minutes on top of tokens. Because every exchange happens in comments, we'd reach for it for small, well-described jobs that start from an issue, and less for work that needs a lot of back-and-forth.

## On a server you run

If you want the machine to be yours, any Linux VM will run Claude Code.

1. [Install Claude Code](https://code.claude.com/docs/en/setup) on the VM and clone your repository.
2. Sign in with `/login`. On a machine with no browser, press `c` to copy the login link and open it on another computer.
3. Start `claude` inside `tmux` so it keeps running after you disconnect.
4. Run `/remote-control` to follow and steer the session from your phone or browser ([Remote Control](https://code.claude.com/docs/en/remote-control)).

The cost of that control is upkeep. You patch and secure the server yourself, and if you want two sessions going at once, you set up a second checkout so they don't edit the same files.

## The four side by side

| | Claude Code on the web | GitHub Actions | Your own server | Vespin |
| --- | --- | --- | --- | --- |
| Runs on | Anthropic's VMs | GitHub's runners | Your machine | A Vercel Sandbox per agent, or your own Mac |
| Pays with | Your Claude plan | API key or Claude plan | API key or Claude plan | Your Claude plan or API key |
| Starts from | Browser, Claude app, terminal | An `@claude` comment or workflow | SSH | Mac app, web app |
| Pull requests | Yes | Yes | You set it up | Yes |
| Several at once | Yes | Yes | You set it up | Yes |

## How we run it in Vespin

[Vespin](https://vespin.dev) is what we built for running many coding agents at once. Each cloud agent runs Claude Code on your Claude plan in a sandbox of its own, with its own checkout of your repository. It works on a branch, opens a pull request, and fixes the checks that fail on it. When it has a question or wants a review, it posts to your inbox, so you don't have to keep opening sessions to find the one that's waiting on you. We wrote these guides that way: seven agents worked in parallel, one per page, each with its own pull request, and a person approved every page before it went up.

1. Download the Mac app or open [vespin.dev/app](https://vespin.dev/app), sign in, and connect GitHub in Settings › Workspace.
2. In Settings › Agents, add your Claude plan: run `claude setup-token` in a terminal and paste the token it prints. You can also add an Anthropic API key.
3. Make a task, describe the work, and start an agent on it.
4. Answer its questions in your inbox and review its pull request.

Agents can also run on your own Mac, or on another machine you add, if you'd rather keep the work there. And if you only ever run one session at a time, Claude Code on the web asks less of you, since there's no token to paste.
