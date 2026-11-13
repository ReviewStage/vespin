---
title: How to run Codex in the cloud
description: Three ways to run Codex in the cloud. OpenAI's Codex cloud, Codex CLI on a machine you control, or Vespin.
published: 2026-11-12
updated: 2026-11-13
faq:
  - q: Does Vespin use my ChatGPT plan?
    a: Yes, and Codex's usage counts against that plan the same way it would on your laptop. If your ChatGPT workspace has device-code login turned off, an admin has to turn it on before you can connect.
  - q: Does Vespin use Codex cloud?
    a: No. We run Codex CLI in sandboxes of our own and sign it in as you.
  - q: Can Codex and Claude review each other in Vespin?
    a: Yes, but you set it up yourself. Start a second agent on the task with the other model and ask it to review the first agent's pull request.
---

There are three ways to run Codex somewhere other than your laptop. OpenAI's Codex cloud runs it in OpenAI's sandboxes, and you start tasks from ChatGPT. Vespin, which we build, runs Codex CLI on your ChatGPT plan or API key in a sandbox per agent, next to Claude Code agents. And you can run Codex CLI on a machine of your own, which is more work but leaves every choice to you.

## Codex cloud, from ChatGPT

You start a Codex cloud task from ChatGPT on the web, in the desktop app, or on your phone. You connect GitHub or GitLab, pick a repository, and describe what you want. [Each task has its own workspace and can keep working while your computer is asleep](https://learn.chatgpt.com/docs/cloud), so you can close the laptop and come back to a diff. When you're happy with it, you open a pull request from there.

It needs a paid plan. [OpenAI's pricing page](https://learn.chatgpt.com/docs/pricing) lists cloud features for Plus, Pro, Business, and Enterprise/Edu but not Free or Go, and an API key gets [no cloud-based features](https://learn.chatgpt.com/docs/pricing) at all. Cloud tasks also come out of the same budget as Codex on your laptop. [Local messages and cloud chats share your plan's usage allowance](https://learn.chatgpt.com/docs/pricing), and a cloud task may use more of it than a local message does.

The setup lives in an environment: the install script, environment variables, secrets, and network settings. [A published environment lets you reuse the same setup across tasks](https://learn.chatgpt.com/docs/cloud), and running tasks in parallel is a matter of starting several from it. Watch out for one thing. Code Review and the GitHub and Linear integrations still run on legacy environments, where [agent internet access is off by default](https://learn.chatgpt.com/docs/environments/cloud-environment) and secrets reach only the setup script.

If Codex is the only agent you use and you already pay for ChatGPT, Codex cloud is the simplest of the three, and we'd start there. It runs Codex only, though, so you'll need something else to put Claude Code on the same work.

## Running Codex CLI on a machine you control

[Codex CLI is open source](https://github.com/openai/codex), so nothing stops you from running it in a VM, a container, a CI job, or a cloud sandbox. [`codex exec`](https://learn.chatgpt.com/docs/non-interactive-mode) runs one task without prompting you and exits when it's done, which is what you want on a machine nobody is watching.

1. Start a machine with the repository checked out and its dependencies installed.
2. Install Codex CLI with `npm install -g @openai/codex`.
3. Sign in. [OpenAI recommends an API key for automation](https://developers.openai.com/codex/auth). To use a ChatGPT plan on a machine with no browser, run `codex login --device-auth`, after you turn on device-code login in your ChatGPT security settings or your workspace admin does.
4. Run `codex exec` with the task.
5. Push the branch and open the pull request yourself, or give the agent a GitHub token and let it do both.

This gets you the most control, and you pay for it in upkeep. The machines and the credentials on them are yours to look after, and nothing tells you a run is stuck or finished unless you build that yourself. If you want Claude Code too, install it on the same machine.

## How we run Codex in Vespin

We built Vespin so you can run agents like this without looking after the machines. You describe a task, and Codex or Claude Code agents work on it. Each agent gets its own cloud sandbox with its own checkout of the repository and keeps it between turns, so a follow-up picks up where the last turn stopped. An agent can run on your Mac instead if you'd rather. You pick a GPT or Claude model for each agent, and several agents can work on one task. That's how we wrote these guides: seven agents in parallel, one per page, each with its own pull request, and a person approving every page.

Codex runs on your ChatGPT plan, which you connect in Settings › Agents through Codex's own device-code login. That works on Business plans too. Without a plan, it runs on your OpenAI API key. We don't pay for agents, so you need one or the other.

When an agent needs a decision, a to-do, or your review, it posts to your Inbox and waits for you. You can also start agents and answer them from Slack, and [automations](/docs/automations) start them on a schedule, on a GitHub or Sentry event, or from a webhook.
