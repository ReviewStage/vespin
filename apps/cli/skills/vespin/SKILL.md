---
name: vespin
description: "Drive Vespin from a shell with the `vespin` command: create tasks, read and write their descriptions, start coding agents and wait on them, check out an agent's branch, share a cloud agent's port by preview link, answer the inbox threads agents post, read and keep the workspace's shared memory, make and run automations, and list the workspace's GitHub repositories, read their files, and check the GitHub connection. Load it when asked to work with Vespin tasks, their descriptions, agents, inbox, memory, automations, or the workspace's GitHub repositories from a terminal, to script or pipe Vespin, or to wait on an agent and bring its branch local. Prefer Vespin's MCP server only when you have no shell."
---

# vespin

`vespin` is Vespin's command-line tool. It is never interactive when stdin is not a terminal, so you can run it from a shell tool.

## Setup

```sh
npx vespin login          # or: npm i -g vespin && vespin login
vespin whoami             # who is signed in, and their workspaces
vespin workspace use acme # default workspace; or -w acme / VESPIN_WORKSPACE per command
```

`login` opens a browser. Over SSH, or with no browser, run `vespin login --no-browser` and paste back the address the browser ends on; ask the person to do this, since only they can sign in. If `VESPIN_TOKEN` is set it is used first. Exit 3 means sign in again.

## Core loop

```sh
echo "Fix the login redirect" | vespin task create "Login redirect" --start --prompt -
vespin agent wait <agent-id> --timeout 1800   # exit code says how the turn ended
vespin agent checkout <agent-id>              # fetch its branch and check it out here
```

- `task create` takes the repository from this folder's `origin` (override with `-R owner/name`). With `-q` it prints the task id, then the agent id. `--start` hands the agent the description (`-F description.md`); `--prompt <file|->` hands it a prompt instead.
- To see the work live, use `vespin agent logs <id> --follow`. Without `--follow` it prints the transcript so far.
- `agent checkout` must run inside a clone of the task's repository. `agent view <id>` prints the branch, pull request, and checks.
- Tasks are named by id, number, or key (`ACME-42`). Agents and threads are named by id.

Other commands:

| Command | What it does |
| --- | --- |
| `task list [--mine] [--status s]` · `task view <task>` · `task update <task> [--status] [--priority] [--assignee] [--name]` | Find, read, and change tasks; `--status done` marks one done |
| `task update <task> [--parent <task\|none>] [--blocked-by <task>] [--blocks <task>] [--remove-blocked-by <task>] [--remove-blocks <task>] [--section <section\|none>]` | Put a task under a parent or back at the top; add or take away the tasks it waits on and that wait on it (each flag again for each task); keep it in one of your sidebar sections |
| `workspace members` · `workspace slug <slug>` | The workspace's members (account id, role, name, email) and who left it; change its slug, the first step of its links, which only its owner may (links under the old slug still open it) |
| `section list` · `section create <title> [--emoji e]` · `section delete <section>` | Your sidebar sections in the workspace, with the tasks in each; make one; delete one (its tasks go back under Tasks). A section is named by id or title |
| `task cat <task> <path> [--commit sha]` · `task ls <task> [path] [-r]` | Read a file or list a folder of the task's repository as GitHub holds it, at the default branch's head or a commit (`cat`), never an agent's unpushed work in its sandbox |
| `description show <task>` · `description edit <task> -F <file\|->` | Print the description as Markdown; replace it whole |
| `agent start <task> [-F prompt] [--model m --effort e] [--branch b] [--cloud\|--on <device>] [--follow\|--wait]` | Start an agent; `vespin models` lists `--model` and `--effort` values |
| `agent continue <id> [-F note] [--at <message-id>] [--model m --effort e] [--cloud\|--on <device>] [--follow\|--wait]` | Continue an agent as the app's Continue does: it is stopped, and a new agent on its task is handed its brief and transcript, then the note. The new agent runs as you, on your own Claude or ChatGPT plan, so a teammate's agent is handed over to you. `--at` forks at one of its assistant messages instead (ids from `agent logs --json`), and it goes on. It runs on the agent's model and where it runs unless you name them |
| `agent list [<task>] [--offset n]` · `agent view <id>` | Agents, newest first, the workspace's 50 a page (`--offset` the `nextOffset` it printed); one agent's status |
| `agent send <id> -F <msg\|->` · `agent stop <id>` | Message an agent; stop its turn (what it pushed stays) |
| `agent logs <id> [--worker <call-id>] [--call <call-id>]` | The whole transcript; `--worker` reads one of its workers' instead, by the `toolCallId` of the call that started it, and `--call` prints one call whole, its input and output (ids from `agent logs --json`) |
| `agent diff <id> [--stat] [--number n]` | The diff of an agent's pull request as GitHub holds it, every file's patch; `--stat` one line a file, `-q` the paths; `--number` another pull request of its repository |
| `agent pr <id> ready\|draft\|merge\|auto-merge [--method merge\|squash\|rebase] [--head sha] [--off] [--number n]` | Change the pull request on GitHub as you: mark it ready, turn it back into a draft, merge it now, or turn auto-merge on (`--off` turns it off). A merge is made against the head as it stands now unless `--head` pins the one you reviewed, by the first method the repository allows unless `--method` names one |
| `pr chapters <pr\|agent> [--generate] [--number n]` | A pull request's chapters, the story of its diff in reading order, as its Pull request tab shows them. Name it by its GitHub link or `owner/name#n` (in the workspace `-w` names), or by an agent's id for its own pull request (`--number` another of its repository). `--generate` makes them for the head now: one model call on your own API key, which costs money and takes a minute or more, so read first and generate only where none stand or they are stale |
| `agent ports <id>` | Ports a server listens on in a cloud agent's sandbox, and the one shared by link; none unless the sandbox is running |
| `agent share <id> <port>` · `agent share <id>` · `agent share <id> --stop` | Share a port by public link (replacing any shared before), print the link shared now, or close it; `-q` prints the link alone |
| `agent forward <id> [port…] [--local <port>]` | Serve a cloud agent's ports on `localhost` (the ones it listens on now, or those named) until Ctrl-C or its sandbox stops; a local port that will not listen is refused, so pick another with `--local` |
| `agent tabs <id>` · `agent tabs open <id> <address>` · `agent tabs take <id> <tab>` · `agent tabs hand-back <id> <tab>` | A cloud agent's browser tabs, each by id, who drives it, title, and address (never the page itself); open a page in its browser, such as a sign-in for a person to finish; take a tab over so the agent leaves it alone (it lapses a minute after the last `take`, which renews it); hand it back. `open` takes the new tab over for you |
| `inbox list [--unread]` · `inbox view <thread>` | Threads agents posted, and one thread with its open ask |
| `inbox answer <thread> <option>` · `inbox answer <thread> -F <json\|->` · `inbox reply <thread> -F <msg\|->` · `inbox close <thread>` | Answer a decide's option, `done` for a to-do, or a form as JSON by field; write on the thread; close it |
| `memory list` · `memory search [words…]` · `memory save <text…> [--replaces <id>]` · `memory forget <id>` | The workspace's shared memory: every memory, the few some words find, one kept as your words (or `-F <file\|->`; `--replaces` corrects one in place), one forgotten for good. Search and save are refused while the workspace has Memory off |
| `automation list [--task <task>]` · `automation view <id>` | Automations you may read, and one with its prompt and newest runs |
| `automation create <name> --prompt <file\|-> (--cron <expr> [--timezone tz] \| --github <event> [--label l] [--branch b] \| --sentry <event> \| --trigger <json>) [-R owner/name…] [--task <task>] [--model m --effort e] [--scope personal\|workspace]` | Make an automation that starts an agent on its prompt each time it fires; `--cron` is read in this machine's time zone unless `--timezone` names one. A webhook trigger is made only in the app, which shows its secret once |
| `automation update <id> [--name] [--prompt] [--enable\|--disable] [trigger flags] [-R…] [--model m --effort e] [--scope]` · `automation run <id>` · `automation delete <id>` | Change one (what you leave out stands), run one now (`-q` prints the agent it started), delete one |
| `agent shells <id>` · `agent shell <id> [<shell>] [--title t]` | An agent's Terminal tab shells; open a new one, or attach to one, in this terminal (Ctrl-] detaches). `shell` is interactive and refuses to run piped, so a coding agent hands it to the person |
| `repo list` · `repo add <owner/name>` · `repo remove <owner/name>` | The GitHub repositories you can choose for a task in the workspace, each marked `app` (the workspace's installation) or `token` (added on a member's own GitHub token), and those your token may add; add one on your token, or remove one added on a token (its adder or an owner or admin) |
| `repo cat <owner/name> <path> [--commit sha]` · `repo ls <owner/name> [path] [-r]` · `repo skills <owner/name>` | Read a file or list a folder of a repository the workspace reaches, as GitHub holds it at the default branch's head (or a commit, for `cat`), with no task naming it; the skills an agent may load by name there, the repository's then your installed ones |
| `repo issue <owner/name> <number>` | The title, state, and link of an issue or pull request by its number |
| `keys list` · `keys set <anthropic\|openai> [--plan]` · `keys remove <provider> [--plan] [--id id] [--yes]` · `keys for-agents <provider> on\|off [--id id]` | Your own provider keys and plans, which pay for your agents: which are set and how each stands (never a key); add an API key from stdin, checked with the provider first, or with `--plan` your Claude plan as `claude setup-token` printed it (a ChatGPT plan connects in the app alone); remove one (the first unless `--id`, which `list` prints); whether your plan pays for agents by default |
| `github status` | Whether your GitHub account is connected to Vespin, and its login; connecting is done in Vespin's Settings. Your token is never printed |
| `github token show` · `github token set` · `github token remove [--yes]` | Your own classic GitHub token: the login it belongs to, its status, and expiry (never the token); save one from stdin, replacing the one set, which GitHub checks first; remove it |

A key or token is read from stdin alone, never from an argument, and no command prints one back; Vespin's MCP server has no tool for either. Pipe one in only where the person handed it to you; otherwise ask them to run `keys set` or `github token set` themselves. `keys remove` and `github token remove` ask at a terminal; piped they need `--yes`, so remove only when the person asked.

`description edit` replaces the whole description, so run `description show` first and edit that; piped, `show` prints JSON, so take its `body` (`jq -r .body`). Run `vespin <group> --help` for any flag not listed here.

## Conventions

- **Output:** stdout is JSON when piped or captured (what you get from a shell tool), or with `--json`; `-q` prints ids only, one a line. Notes and errors go to stderr, so stdout is the answer alone.
- **Input:** `-F -` (or `--prompt -`) reads stdin; only one flag may read stdin per command. Pass text through a pipe or file, never as a long argument.
- **Exit codes:** 0 ok, 1 refused (missing task, bad input, a limit), 2 usage, 3 not signed in, 4 network or server error, 5 the agent's turn failed or was stopped, 6 `--timeout` passed with the turn still running. `agent wait` and `--wait` use 5 and 6; their JSON says which.
- **Never wait on a prompt:** every id is an explicit argument. If a command needs a person (sign-in, an answer only they can give), stop and ask them.

## Anything without a command

`vespin api <GET|POST|PUT|PATCH|DELETE> <path> [-F <json|->]` calls any hosted procedure and prints its JSON:

```sh
vespin api GET /api/workspaces
echo '{"name":"Research"}' | vespin api POST /api/workspaces -F -
```

## CLI or MCP

Use the CLI when you have a shell: scripting, piping and filtering output (`--json | jq`), waiting on an agent with `agent wait`, streaming with `agent logs --follow`, and checking out an agent's branch locally. It also knows your working folder's repository.

Use Vespin's MCP server when you have no shell, or can only call tools. `vespin mcp install claude-code|codex|cursor|vscode` connects an agent to it.

## Examples

Fan out two agents, wait on both, then check out the first:

```sh
a=$(echo "Add tests for the redirect" | vespin agent start ACME-42 -F - -q)
b=$(echo "Update the docs for the redirect" | vespin agent start ACME-42 -F - -q)
vespin agent wait "$a" && vespin agent wait "$b" && vespin agent checkout "$a"
```

Edit a description in a pipe:

```sh
vespin description show ACME-42 | jq -r .body | sed 's/- \[ \] Tests/- [x] Tests/' | vespin description edit ACME-42 -F -
```

Hand someone a preview of the server a cloud agent runs on port 3000 (its sandbox must be running):

```sh
vespin agent ports "$id"                  # what listens, and what is shared
url=$(vespin agent share "$id" 3000 -q)   # the public link; anyone holding it can open it
vespin agent share "$id" --stop           # close it when done
```

Review an agent's pull request, then merge it once its checks pass, against the head you read:

```sh
vespin agent diff "$id" --stat                          # the files it changes
vespin agent diff "$id" | less                          # every patch
head=$(vespin agent diff "$id" --json | jq -r .pullRequest.headSha)
vespin agent pr "$id" auto-merge --head "$head"         # refused if it pushed since
```

Answer the first unread thread:

```sh
t=$(vespin inbox list --unread -q | head -1)
vespin inbox view "$t" --json     # read the ask
vespin inbox answer "$t" Approve
```

Continue an agent whose turn failed or was stopped (exit 5 alone, since continuing stops it), with a note, and wait on the new one:

```sh
status=0; vespin agent wait "$id" || status=$?
if [ "$status" -eq 5 ]; then
  next=$(echo "Pick up where it stopped" | vespin agent continue "$id" -F - -q) && vespin agent wait "$next"
fi
```

React to how a wait ended:

```sh
vespin agent wait "$id" --timeout 600; case $? in
  0) vespin agent checkout "$id" ;;
  5) vespin agent logs "$id" | tail -50 ;;
  6) vespin agent send "$id" -F - <<< "Status?" ;;
esac
```

Read a pull request's chapters, generating them only where none stand yet:

```sh
state=$(vespin pr chapters acme/app#42 --json | jq -r .pullRequest.chapters.status)
[ "$state" = none ] && vespin pr chapters acme/app#42 --generate   # slow; spends your API key
```
