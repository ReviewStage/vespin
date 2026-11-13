---
title: "Where Vespin agents run: cloud or your Mac"
description: An agent runs in a cloud sandbox or on a machine of yours. Here's how the two differ and how to set up your own.
published: 2026-11-13
updated: 2026-11-13
related: [how-vespin-isolates-coding-agents, how-the-vespin-inbox-works]
faq:
  - q: Can I move an agent to my Mac after it has started in the cloud?
    a: "Yes. Choose **Move to** in the agent's menu. Uncommitted work comes along from the cloud."
  - q: Can automations run on my Mac?
    a: No. Automations run only in the cloud.
---

An agent runs either in the cloud, in a sandbox of its own, or on a machine of yours. That can be **This Mac**, or a Linux server or another Mac you add. You choose with the **Runs on** chip under the message box when you start a task.

## Differences

| | Cloud | Your machine |
| --- | --- | --- |
| Runs with your laptop closed | Yes | Only if the machine stays on and logged in |
| Access | Its sandbox. See [How Vespin isolates coding agents](how-vespin-isolates-coding-agents.md). | Everything the machine's user can reach |
| Model login | The plan or key in **Settings › Agents** | Claude Code or Codex as signed in on the machine |
| GitHub | Your workspace's GitHub App or your token | The machine's `gh` login, Git credentials, and SSH keys |
| Checkout | In the sandbox | A worktree under `~/.vespin` |
| **Cloud environment** variables and scripts | Yes | No |
| Browser, shared ports, `run_on_mac` | Yes | No |
| Automations | Yes | No |

Run an agent on your machine when the work needs something only that machine has, like Xcode, a simulator, or a local database.

## Move an agent

Choose **Move to** in the agent's menu. We stop the agent and continue it in the new place. Moving from the cloud brings uncommitted work along, but moving from your machine brings only what the agent pushed.

## Run agents on this Mac

Turn on **Run agents on this Mac** in **Settings › Machines**. If macOS asks, allow Vespin in **System Settings › General › Login Items**.

To keep the Mac from sleeping while agents work, set **Keep this Mac awake** in **Settings › This Mac**. Closing the lid still puts it to sleep.

## Add a machine

1. In **Settings › Machines**, open **Add a machine**.
2. Run the install command on the machine.
3. Open the link it prints and approve the code.

Before you start an agent there, sign in on that machine to Claude Code or Codex, and to GitHub with `gh auth login` or SSH. A machine only runs its owner's agents.
