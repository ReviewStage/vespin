---
title: How to run Codex in the cloud
description: Run Codex in the cloud with OpenAI's Codex cloud, with Codex CLI on a machine you run, or with Vespin.
published: 2026-11-12
updated: 2026-11-13
faq:
  - q: Does Vespin use my ChatGPT plan?
    a: Yes, if you connect it in Settings › Agents. Codex's usage then counts against that plan. If your ChatGPT workspace turns off device-code login, an admin has to allow it first.
  - q: Does Vespin use Codex cloud?
    a: No. Vespin runs Codex CLI in its own sandboxes and signs it in as you.
  - q: Can Codex and Claude review each other in Vespin?
    a: Yes. Start a second agent on the task with the other model and ask it to review the first agent's pull request.
---

OpenAI's Codex cloud runs Codex tasks in OpenAI's sandboxes. Vespin runs Codex CLI on your ChatGPT plan or API key in a sandbox per agent, beside Claude Code agents. You can also run Codex CLI on a machine of your own.

## Codex cloud

You start Codex cloud tasks from ChatGPT on the web, the desktop app, or your phone. Connect GitHub or GitLab, pick a repository, and describe the task. [Each task has its own workspace and can keep working while your computer is asleep](https://learn.chatgpt.com/docs/cloud). When it's done, you review the diff and open a pull request.

[OpenAI's pricing page](https://learn.chatgpt.com/docs/pricing) lists cloud features for the Plus, Pro, Business, and Enterprise/Edu plans, not Free or Go. An API key gets [no cloud-based features](https://learn.chatgpt.com/docs/pricing), so you sign in with ChatGPT. [Local messages and cloud chats share your plan's usage allowance](https://learn.chatgpt.com/docs/pricing), and a cloud task may use more of it than a local message.

Tasks run in an environment, which holds the install script, environment variables, secrets, and network settings. [A published environment lets you reuse the same setup across tasks](https://learn.chatgpt.com/docs/cloud), and you run tasks in parallel by starting several from it. Code Review and the GitHub and Linear integrations still use legacy environments, where [agent internet access is off by default](https://learn.chatgpt.com/docs/environments/cloud-environment) and secrets reach only the setup script.

Codex cloud runs Codex only.

## Codex CLI on your own machine

[Codex CLI is open source](https://github.com/openai/codex), so you can run it in a VM, a container, a CI job, or a cloud sandbox. [`codex exec`](https://learn.chatgpt.com/docs/non-interactive-mode) runs a task without prompts and exits when it's done.

1. Start a machine with the repository checked out and its dependencies installed.
2. Install Codex CLI with `npm install -g @openai/codex`.
3. Sign in. [OpenAI recommends an API key for automation](https://developers.openai.com/codex/auth). To use a ChatGPT plan on a machine with no browser, run `codex login --device-auth`. Device-code login has to be turned on first, in your ChatGPT security settings or by your workspace admin.
4. Run `codex exec` with the task.
5. Push the branch and open the pull request, or give the agent a GitHub token and have it do both.

You manage the machines and the credentials on them, and you check on each run yourself. To run Claude Code too, install it on the same machine.

## Where Vespin fits

In Vespin, you describe a task and Codex or Claude Code agents work on it. Each agent has its own cloud sandbox with its own checkout of the repository, which it keeps between turns, or it can run on your Mac. You pick a GPT or Claude model for each agent, and several agents can work on one task.

Codex runs on your ChatGPT plan, connected in Settings › Agents through Codex's own device-code login, which works for Business plans. Without a plan, it runs on your OpenAI API key. Vespin doesn't pay for agents.

When an agent needs a decision, a to-do, or your review, it posts to your Inbox. You can start agents and answer them in Slack, and [automations](/docs/automations) start agents on a schedule, on a GitHub or Sentry event, or from a webhook.
