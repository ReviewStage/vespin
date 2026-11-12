---
title: How to run Codex in the cloud
description: Codex cloud runs Codex in OpenAI's sandboxes from ChatGPT. Here is how it works, how to run Codex CLI in a sandbox of your own instead, and how to run it beside Claude Code.
published: 2026-11-12
updated: 2026-11-12
faq:
  - q: Does Vespin use my ChatGPT plan?
    a: Yes, if you connect it. Vespin signs Codex in with your ChatGPT plan through Codex's own device-code login, which your workspace admin may need to allow, and Codex's usage counts against that plan. Without a plan, it runs on your OpenAI API key. One or the other is needed. Vespin doesn't pay for agents.
  - q: Is Vespin Codex cloud or Codex CLI in a sandbox?
    a: Codex CLI in a sandbox. Vespin starts Codex in a cloud sandbox of its own for each agent, signed in as you. It doesn't call Codex cloud.
  - q: Can I use Codex cloud with an API key?
    a: No. OpenAI's pricing page says an API key gets [no cloud-based features](https://learn.chatgpt.com/docs/pricing). Codex CLI, run yourself or by Vespin, takes an API key.
  - q: Do cloud tasks use the same limits as Codex on my laptop?
    a: On Codex cloud, yes. [Local messages and cloud chats share your plan's usage allowance](https://learn.chatgpt.com/docs/pricing). Codex run by Vespin on your plan counts against that plan the same way, as Codex CLI does on your laptop.
  - q: Can Codex and Claude review each other?
    a: Yes. In Vespin, start a second agent on the task on the other lab's model and ask it to review the first agent's pull request. It reads the diff and leaves its review on the pull request.
  - q: Can Codex run several tasks at once?
    a: Yes, on Codex cloud and on Vespin. On Vespin, each agent runs in its own sandbox, so starting more agents runs more at once.
---

OpenAI's Codex cloud runs Codex tasks in OpenAI's own sandboxes, started from ChatGPT on the web, desktop, or phone. Vespin runs Codex CLI on your ChatGPT plan or OpenAI API key in a sandbox of its own for each agent, beside Claude Code agents.

Both let a task keep running while your laptop is closed, and both let you run several tasks at once. They differ in who runs the agent, what pays for it, and which other agents can work beside it.

## Option 1: Codex cloud, from ChatGPT

Codex cloud is OpenAI's hosted version of Codex. You connect GitHub or GitLab, pick a repository, and describe the task. [Each task has its own workspace and can keep working while your computer is asleep](https://learn.chatgpt.com/docs/cloud), and you review the diff and open a pull request when you're ready.

To set it up:

1. Sign in to ChatGPT on a plan that includes cloud tasks. [OpenAI's pricing page](https://learn.chatgpt.com/docs/pricing) lists cloud features for Plus, Pro, Business, and Enterprise/Edu, not Free or Go.
2. Connect GitHub (or GitLab) and pick a repository.
3. Set up an environment: its install script, environment variables, secrets, and network access. [A published environment lets you reuse the same setup across tasks](https://learn.chatgpt.com/docs/cloud).
4. Start a task, and start more from the same environment to run them in parallel.

Things to know:

- **It needs a ChatGPT sign-in.** An API key covers the CLI, SDK, and IDE extension, but [lists no cloud-based features](https://learn.chatgpt.com/docs/pricing).
- **Cloud tasks share your plan's limits.** [Local messages and cloud chats share your plan's usage allowance](https://learn.chatgpt.com/docs/pricing), and a cloud task may use more of it than a local message.
- **Network access is yours to set.** In the legacy environments that still back Code Review and the GitHub and Linear integrations, [agent internet access is off by default](https://learn.chatgpt.com/docs/environments/cloud-environment), and secrets reach only the setup script.
- **It runs Codex only.** Claude Code or another agent runs somewhere else.

## Option 2: Codex CLI in a sandbox you run

[Codex CLI is open source](https://github.com/openai/codex) and runs on any machine you control: a VM, a container, a CI job, or a cloud sandbox. [Run it non-interactively with `codex exec`](https://learn.chatgpt.com/docs/non-interactive-mode) and it works through the task and exits.

To set it up:

1. Start a machine or container with your repository checked out and its dependencies installed.
2. Install Codex CLI (`npm install -g @openai/codex`).
3. Sign in. [OpenAI favors an API key for automation](https://developers.openai.com/codex/auth); on a ChatGPT plan, `codex login --device-auth` signs in a machine with no browser, once device-code login is turned on in your ChatGPT security settings or by your workspace admin.
4. Run `codex exec` with the task, then push a branch and open the pull request yourself, or let the agent do it with a GitHub token.

This gives you full control of the machine, the network, and the bill, and costs you the plumbing: starting and stopping machines, keeping credentials off them, telling when an agent needs you, and collecting its pull requests.

## Option 3: Codex beside Claude Code

Some work goes better on one agent than the other, and a second agent from another lab makes a useful reviewer. Running both means two setups in Option 1 (Codex cloud for Codex, another service for Claude Code), or one sandbox image with both CLIs in Option 2.

## Where Vespin fits

In Vespin, you describe a task, and Codex or Claude Code agents work on it in cloud sandboxes and open pull requests. When an agent needs a decision, a to-do, or your review, it posts a thread to your Inbox.

For Codex, that means:

- **Your plan or your key.** Connect your ChatGPT plan in **Settings › Agents** through Codex's own sign-in, which works for Business plans too, or save an OpenAI API key. Vespin's own key pays for no agent.
- **A sandbox per agent.** Each agent gets its own cloud sandbox with its own checkout of the repository, and keeps its work there between turns. You can run an agent on your own Mac instead.
- **Codex and Claude Code side by side.** Pick a GPT model for one agent and a Claude model for the next, on the same task or across tasks, all in one Inbox.
- **Slack and automations.** Start an agent by mentioning @Vespin in Slack, and answer its questions there. [Automations](/docs/automations) start one on a schedule, on a GitHub or Sentry event, or from a webhook.

Vespin doesn't replace Codex cloud's environments or OpenAI's GitHub code review; it runs Codex CLI itself, on your account.
