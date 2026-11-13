import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SHARED_FILES_DIRECTORY } from "@repo/agent-runner/pins";
import { AGENT_TOOL } from "@repo/features/agent-tools";
import { AGENT_BRIEF, type AgentBrief } from "@repo/features/agent-wire";
import { Schema } from "effect";
import { test } from "vitest";
import { standingFor } from "../../testing/agent-standing.js";
import { COMMIT_BY } from "./checkout.js";
import { INBOX_TOOLS } from "./inbox.js";
import { CODER_HARNESS, coderInstructions, type OwnTask } from "./instructions.js";

/** The task an agent on one works on, its link and its id, as its instructions are handed them. */
const TASK_ADDRESS = {
  link: "https://vespin.dev/acme/task/42",
  id: "5f3c2a1e-9b8d-4c7a-8e6f-1a2b3c4d5e6f",
} as const;

test("a Claude Code agent is told of Claude Code's own tools and never of Vespin's it is not offered", () => {
  // The tools Claude Code owns in place of ours, named as instructions would name ours.
  const LUKES = [
    "`bash`",
    "`read_file`",
    "`write_file`",
    "`apply_patch`",
    "`glob`",
    "`grep`",
    `\`${AGENT_TOOL.SLEEP}\``,
    `\`${AGENT_TOOL.WEB_SEARCH}\``,
    `\`${AGENT_TOOL.READ_WEB_PAGE}\``,
    `\`${AGENT_TOOL.LOAD_SKILL}\``,
    "`write_todos`",
    "`delegate`",
    "task_wait",
  ];

  const CLAUDE_CODES = ["TaskCreate", "WebSearch", "WebFetch", "Skill tool", "Agent tool"];

  for (const brief of Object.values(AGENT_BRIEF)) {
    for (const repository of ["Acme/Relay", null]) {
      for (const memberToken of [false, true]) {
        const args = [
          repository,
          brief,
          TASK_ADDRESS,
          standingFor(repository),
          undefined,
          null,
          memberToken,
        ] as const;

        const claudeCode = coderInstructions(...args, CODER_HARNESS.CLAUDE_CODE);
        const label = `${brief} ${repository ?? "no repository"} ${memberToken ? "token" : "app"}`;
        assert.deepEqual(
          LUKES.filter((tool) => claudeCode.includes(tool)),
          [],
          label,
        );
        assert.deepEqual(
          // An agent with no repository is offered no skills.
          CLAUDE_CODES.filter(
            (tool) => !claudeCode.includes(tool) && (repository !== null || tool !== "Skill tool"),
          ),
          [],
          label,
        );

        // The tools that touch the app stay ours, under their own names.
        for (const kept of [INBOX_TOOLS.POST.name, AGENT_TOOL.START_AGENT, AGENT_TOOL.SHOW_IMAGE]) {
          assert.ok(claudeCode.includes(`\`${kept}\``), `${label}: ${kept}`);
        }
      }
    }
  }
});

test("a Claude Code or Codex agent is told of its browser, which Vespin's MCP server serves it, with Playwright run from its own shell", () => {
  const BROWSER = `\`${AGENT_TOOL.BROWSER}\` drives a Chromium in your own sandbox`;

  const SHELL_OF = [
    [CODER_HARNESS.CLAUDE_CODE, "on Playwright from Bash."],
    [CODER_HARNESS.CODEX, "on Playwright from your shell."],
  ] as const;

  for (const brief of Object.values(AGENT_BRIEF)) {
    for (const repository of ["Acme/Relay", null]) {
      for (const [harness, shell] of SHELL_OF) {
        const words = coderInstructions(
          repository,
          brief,
          TASK_ADDRESS,
          standingFor(repository),
          undefined,
          null,
          false,
          harness,
        );

        const label = `${harness} ${brief} ${repository ?? "no repository"}`;
        assert.ok(words.includes("## Your browser"), label);
        assert.ok(words.includes(BROWSER), label);
        assert.ok(words.includes(shell), label);
      }
    }
  }
});

test("a local agent is told its folders on its machine, and no browser and no skills of the app's", () => {
  const MAC = {
    local: true,
    checkoutPath: "/Users/dev/.vespin/agents/a1/repository",
    sharedFiles: "/Users/dev/.vespin/agents/a1/tmp",
  };

  for (const repository of ["Acme/Relay", null]) {
    for (const harness of [CODER_HARNESS.CLAUDE_CODE, CODER_HARNESS.CODEX]) {
      const words = coderInstructions(
        repository,
        AGENT_BRIEF.PROMPT,
        TASK_ADDRESS,
        standingFor(repository, { local: MAC.local }),
        undefined,
        null,
        false,
        harness,
        MAC,
      );

      const label = `${harness} ${repository ?? "no repository"}`;
      assert.ok(!words.includes("## Your browser"), label);
      // Note that its harness finds whatever skills the machine's own home holds, so it is told of none.
      assert.ok(!words.includes("A word like `/name`"), label);

      if (repository !== null) assert.ok(words.includes(`\`${MAC.checkoutPath}\``), label);
    }
  }
});

test("a local agent is told it runs straight on its machine with full access to it, how to work a branch its machine's clone holds, and to save pages where its machine reads them", () => {
  const HOST = {
    local: true,
    checkoutPath: "/home/vespin-host/.vespin/agents/a1/repository",
    sharedFiles: "/home/vespin-host/.vespin/agents/a1/tmp",
  };

  const told = ["straight on one of the developer's own machines", "full access"];

  // Note that its worktree shares the machine's one clone, whose branches another agent's worktree may hold.
  const toldWithRepository = [
    "`git switch --detach origin/<branch>`",
    "`git push origin HEAD:<branch>`",
  ];

  for (const repository of ["Acme/Relay", null]) {
    const words = coderInstructions(
      repository,
      AGENT_BRIEF.PROMPT,
      TASK_ADDRESS,
      standingFor(repository, { local: HOST.local }),
      undefined,
      null,
      false,
      CODER_HARNESS.CLAUDE_CODE,
      HOST,
    );

    const label = repository ?? "no repository";

    for (const each of told) assert.ok(words.includes(each), `${label}: ${each}`);
    assert.ok(!words.includes("## Your browser"), label);

    if (repository !== null) assert.ok(words.includes(`\`${HOST.checkoutPath}\``), label);

    for (const each of toldWithRepository) {
      assert.equal(words.includes(each), repository !== null, `${label}: ${each}`);
    }

    // The machine reads back only inside the agent's folder, never its own `/tmp`.
    assert.ok(words.includes(`under \`${HOST.sharedFiles}/\``), label);
    assert.ok(!words.includes(SHARED_FILES_DIRECTORY), label);
  }
});

test("a Codex agent is told of Codex's own tools and never of Vespin's it is not offered, nor of Claude Code's", () => {
  // Our tools Codex owns its own of; \`apply_patch\` is Codex's own too, under the same name.
  const LUKES = [
    "`bash`",
    "`read_file`",
    "`write_file`",
    "`glob`",
    "`grep`",
    `\`${AGENT_TOOL.SLEEP}\``,
    `\`${AGENT_TOOL.WEB_SEARCH}\``,
    `\`${AGENT_TOOL.READ_WEB_PAGE}\``,
    `\`${AGENT_TOOL.LOAD_SKILL}\``,
    "`write_todos`",
    "`delegate`",
    "task_wait",
  ];

  const CLAUDE_CODES = ["TaskCreate", "WebSearch", "WebFetch", "Skill tool", "Agent tool", "Bash"];

  const CODEXES = [
    "`apply_patch`",
    "`update_plan`",
    "Codex's own web search",
    "Codex's subagent tools",
  ];

  for (const brief of Object.values(AGENT_BRIEF)) {
    for (const repository of ["Acme/Relay", null]) {
      for (const memberToken of [false, true]) {
        const codex = coderInstructions(
          repository,
          brief,
          TASK_ADDRESS,
          standingFor(repository),
          undefined,
          null,
          memberToken,
          CODER_HARNESS.CODEX,
        );

        const label = `${brief} ${repository ?? "no repository"} ${memberToken ? "token" : "app"}`;
        assert.deepEqual(
          LUKES.filter((tool) => codex.includes(tool)),
          [],
          label,
        );
        assert.deepEqual(
          CLAUDE_CODES.filter((tool) => codex.includes(tool)),
          [],
          label,
        );
        assert.deepEqual(
          CODEXES.filter((tool) => !codex.includes(tool)),
          [],
          label,
        );
        // An agent with a repository is pointed at its skills where Codex keeps them.
        assert.equal(codex.includes("`.agents/skills`"), repository !== null, label);

        for (const kept of [INBOX_TOOLS.POST.name, AGENT_TOOL.START_AGENT, AGENT_TOOL.SHOW_IMAGE]) {
          assert.ok(codex.includes(`\`${kept}\``), `${label}: ${kept}`);
        }
      }
    }

    // An agent on either harness waits on its checks with our wakeup, never the CLI's, which its launch denies, nor a watch.
    for (const harness of Object.values(CODER_HARNESS)) {
      for (const memberToken of [false, true]) {
        const waiting = coderInstructions(
          "Acme/Relay",
          brief,
          TASK_ADDRESS,
          standingFor("Acme/Relay"),
          undefined,
          null,
          memberToken,
          harness,
        );

        const label = `${brief} ${harness} ${memberToken ? "token" : "app"}`;
        assert.ok(waiting.includes(`wait with \`${AGENT_TOOL.SCHEDULE_WAKEUP}\``), label);
        // GitHub's message that the checks finished reaches an agent on the App alone, so only it is told to cancel the wakeup then.
        assert.equal(waiting.includes("cancel the wakeup with `stop: true`"), !memberToken, label);
        assert.ok(!waiting.includes("ScheduleWakeup"), label);
        assert.ok(!waiting.includes("--watch --fail-fast"), label);
      }
    }
  }
});

test("an agent on a task is told of the task's links, pages, and comments", () => {
  const TASK_LINK = "`https://vespin.dev/<workspace>/task/<number or id>` link";
  const PAGES = `a self-contained HTML page with \`${AGENT_TOOL.SHOW_PAGE}\``;
  const COMMENTS = `answered in its own thread with \`${AGENT_TOOL.REPLY_TO_COMMENT}\``;

  for (const brief of Object.values(AGENT_BRIEF)) {
    const onTask = coderInstructions("Acme/Relay", brief, TASK_ADDRESS, standingFor("Acme/Relay"));
    const told = [onTask.includes(TASK_LINK), onTask.includes(PAGES), onTask.includes(COMMENTS)];
    assert.deepEqual(told, [true, true, true], brief);
  }
});

test("every agent on a task is told how to update its description, one handed a prompt told to read it first", () => {
  const UPDATING = `**The description** (\`${AGENT_TOOL.EDIT_DESCRIPTION}\`)`;
  const READ_FIRST = `read it with \`${AGENT_TOOL.READ_TASK}\``;

  const told = (brief: AgentBrief, task: OwnTask) => {
    const words = coderInstructions("Acme/Relay", brief, task, standingFor("Acme/Relay"));

    return [
      words.includes(UPDATING),
      words.includes(AGENT_TOOL.EDIT_DESCRIPTION),
      words.includes(READ_FIRST),
    ];
  };

  assert.deepEqual(told(AGENT_BRIEF.DESCRIPTION, TASK_ADDRESS), [true, true, false]);
  assert.deepEqual(told(AGENT_BRIEF.PROMPT, TASK_ADDRESS), [true, true, true]);
});

test("an agent on a task with no repository names what it decided in its message, never in a pull request's description, which it opens none of", () => {
  const IN_PULL_REQUEST =
    "Its description says what the task's description asked and what you decided";

  const decided = (repository: string | null) =>
    coderInstructions(
      repository,
      AGENT_BRIEF.DESCRIPTION,
      TASK_ADDRESS,
      standingFor(repository),
    ).includes(IN_PULL_REQUEST);

  assert.deepEqual([decided("Acme/Relay"), decided(null)], [true, false]);
});

test("every agent on a task is told to keep its task's status with update_task, on to done once its work and subtasks are, a helper on its starter's task leaving it to the starter, and one on no task told of no status", () => {
  const STATUS = "## Your task's status";

  const told = (brief: AgentBrief, task: OwnTask) => {
    const words = coderInstructions("Acme/Relay", brief, task, standingFor("Acme/Relay"));
    const at = words.indexOf(STATUS);

    if (at === -1) return [false, false, false, false];
    const section = words.slice(at, words.indexOf("\n\n## ", at + STATUS.length));

    return [
      true,
      section.includes(AGENT_TOOL.UPDATE_TASK),
      section.includes("its subtasks are Done or Canceled"),
      section.includes(
        "Where another agent started you on its task, leave the status to that agent",
      ),
    ];
  };

  for (const brief of Object.values(AGENT_BRIEF)) {
    assert.deepEqual(told(brief, TASK_ADDRESS), [true, true, true, true], brief);
  }
});

test("an agent asked for a plan, a proposal, or research opens no pull request of a document, and writes it where it can: the description, or a page on its task", () => {
  const NO_DOCUMENT = "commit no document and open no pull request for it";
  const PLAN = `write it into the description with \`${AGENT_TOOL.EDIT_DESCRIPTION}\``;
  const PAGE = `show it as a page with \`${AGENT_TOOL.SHOW_PAGE}\``;

  const told = (brief: AgentBrief, task: OwnTask) => {
    const words = coderInstructions("Acme/Relay", brief, task, standingFor("Acme/Relay"));
    assert.ok(words.includes(NO_DOCUMENT), brief);

    return [words.includes(PLAN), words.includes(PAGE)];
  };

  assert.deepEqual(told(AGENT_BRIEF.DESCRIPTION, TASK_ADDRESS), [true, true]);
  assert.deepEqual(told(AGENT_BRIEF.PROMPT, TASK_ADDRESS), [false, true]);
});

test("the thread post tool tells the session never to ask for a credential or a secret in a form, since the answer reaches the transcript", () => {
  assert.ok(
    INBOX_TOOLS.POST.description.includes("never ask for a credential or a secret in a form"),
  );
});

test("the session sends whatever is ready for the developer to look at or review to a thread, a pull request among it, and a test only the developer can run, and an agent another coding agent started posts its own and sends that agent their mentions", () => {
  const READY = "ready for them to look at";

  for (const brief of Object.values(AGENT_BRIEF)) {
    const inbox = coderInstructions(
      "Acme/Relay",
      brief,
      TASK_ADDRESS,
      standingFor("Acme/Relay"),
    ).split("## Talking to the developer")[1];

    assert.ok(inbox?.includes(READY), brief);
    assert.ok(inbox?.includes("a pull request, a page, or a screenshot"), brief);
    assert.ok(inbox?.includes("testing what your own checks cannot reach"), brief);
    // An agent another coding agent started posts its own threads and names them to it, so the developer never hears of one thing twice.
    assert.ok(
      inbox?.includes(
        "Where another agent started you, as your first message says, still post your own threads",
      ),
      brief,
    );
  }
});

test("an agent is told whose its commits are and to end each on the trailer it is handed, never to add one where it is handed none, and to open a pull request through the service, never gh", () => {
  const BOT_TRAILER = "Co-authored-by: luke[bot] <90001+luke[bot]@users.noreply.github.com>";
  const DEVELOPER_TRAILER = "Co-authored-by: Ada Lovelace <7001+ada@users.noreply.github.com>";

  const cases = [
    {
      by: COMMIT_BY.DEVELOPER,
      coAuthor: BOT_TRAILER,
      says: "set to their GitHub account",
    },
    {
      by: COMMIT_BY.DEVELOPER,
      coAuthor: undefined,
      says: "set to their GitHub account",
    },
    { by: COMMIT_BY.APP, coAuthor: DEVELOPER_TRAILER, says: "set to its bot" },
    { by: COMMIT_BY.APP, coAuthor: undefined, says: "set to its bot" },
  ] as const;

  for (const brief of Object.values(AGENT_BRIEF)) {
    for (const authorship of cases) {
      const words = coderInstructions(
        "Acme/Relay",
        brief,
        TASK_ADDRESS,
        standingFor("Acme/Relay"),
        authorship,
      );

      const named = `${brief}, ${authorship.by}, ${authorship.coAuthor ?? "no co-author"}`;
      assert.ok(words.includes(authorship.says), named);
      assert.equal(
        words.includes("The service opens your pull request as the developer too."),
        authorship.by === COMMIT_BY.DEVELOPER,
        named,
      );

      if (authorship.coAuthor === undefined) {
        assert.ok(words.includes("add no `Co-authored-by` trailer"), named);
        assert.ok(!words.includes("exactly as written: `Co-authored-by"), named);
      } else {
        assert.ok(words.includes(`exactly as written: \`${authorship.coAuthor}\``), named);
        assert.ok(!words.includes("add no `Co-authored-by` trailer"), named);
      }

      assert.ok(
        words.includes(
          `open the pull request with \`${AGENT_TOOL.OPEN_PULL_REQUEST}\`, never \`gh pr create\``,
        ),
        named,
      );
    }
  }
});

test("an agent on its starter's own token reads its checks and its pull request over GitHub's REST API under its repository, never gh pr, is told a draft cannot be marked ready from its sandbox, and is told nothing on its pull request wakes it without the App", () => {
  const TRAILER = "Co-authored-by: luke[bot] <90001+luke[bot]@users.noreply.github.com>";

  for (const brief of Object.values(AGENT_BRIEF)) {
    const words = (memberToken: boolean) =>
      coderInstructions(
        "Acme/Relay",
        brief,
        TASK_ADDRESS,
        standingFor("Acme/Relay"),
        { by: COMMIT_BY.DEVELOPER, coAuthor: TRAILER },
        null,
        memberToken,
      );

    const onToken = words(true);

    for (const cli of ["`gh pr checks", "`gh run view", "marking a draft ready"]) {
      assert.ok(!onToken.includes(cli), `${brief}: ${cli}`);
      assert.ok(words(false).includes(cli), `${brief}: ${cli}`);
    }

    assert.ok(onToken.includes("`gh api repos/{owner}/{repo}/commits/<sha>/check-runs`"), brief);
    assert.ok(onToken.includes("`gh api repos/{owner}/{repo}/pulls/<number>/reviews`"), brief);
    assert.ok(onToken.includes("A draft cannot be marked ready from here"), brief);
    assert.ok(!onToken.includes("reach you as messages from GitHub"), brief);
    assert.ok(onToken.includes("GitHub App on the repository gets you woken"), brief);
  }
});

test("every agent is told that what happens on its pull request after its turn reaches it from GitHub, and to read its reviews before it ends a turn", () => {
  for (const brief of Object.values(AGENT_BRIEF)) {
    const instructions = coderInstructions(
      "Acme/Relay",
      brief,
      TASK_ADDRESS,
      standingFor("Acme/Relay"),
    );

    assert.ok(instructions.includes("reach you as messages from GitHub"), brief);
    assert.ok(instructions.includes("Before you end a turn on an open pull request"), brief);
  }
});

test("every agent is told to reply on an inbox thread to a question or a request done there, never in its own message alone, and never to post how the work is going", () => {
  for (const brief of Object.values(AGENT_BRIEF)) {
    const instructions = coderInstructions(
      "Acme/Relay",
      brief,
      TASK_ADDRESS,
      standingFor("Acme/Relay"),
    );

    assert.ok(
      instructions.includes(
        "answer a question or a request there, on that thread, never in your reply alone",
      ),
      brief,
    );
    // Note that a request acted on in silence leaves the member asking again, so its end is said on the thread.
    assert.ok(
      instructions.includes("once a request is done, say there in a line what you did"),
      brief,
    );
    // Note that a progress note on a thread is noise the developer must acknowledge, so none is asked for.
    assert.ok(instructions.includes("Never post progress"), brief);
    assert.ok(!instructions.includes("saying what you did with it"), brief);
  }
});

test("every agent is told to look at a UI it built in the image's Chromium and show the developer what it saw", () => {
  for (const brief of Object.values(AGENT_BRIEF)) {
    const instructions = coderInstructions(
      "Acme/Relay",
      brief,
      TASK_ADDRESS,
      standingFor("Acme/Relay"),
    );

    assert.ok(instructions.includes("playwright screenshot"), brief);
    assert.ok(
      instructions.includes('NODE_PATH="/usr/local/lib/node_modules:$(npm root -g)"'),
      brief,
    );
    assert.ok(instructions.includes(`with \`${AGENT_TOOL.SHOW_IMAGE}\``), brief);
  }
});

/** The task the golden's on-task prompts were composed with: its link, by its number, and its id. */
const TASK_LINK = {
  link: "https://vespin.dev/acme/task/42",
  id: "5f3c2a1e-9b8d-4c7a-8e6f-1a2b3c4d5e6f",
} as const;

/** A coding agent's instructions, recorded for each brief, byte for byte. */
const CODER_PATH = fileURLToPath(
  new URL("../../../fixtures/coder-instructions/coder.json", import.meta.url),
);

/** The instructions for each brief, as the golden records them. */
function briefInstructions(): Record<string, { onTask: string }> {
  return Object.fromEntries(
    Object.values(AGENT_BRIEF).map((brief) => [
      brief,
      { onTask: coderInstructions("Acme/Relay", brief, TASK_LINK, standingFor("Acme/Relay")) },
    ]),
  );
}

// Note that the golden is written again only under APP_UPDATE_FIXTURES=1, and the diff explained in the PR.
if (process.env.APP_UPDATE_FIXTURES === "1") {
  writeFileSync(CODER_PATH, `${JSON.stringify(briefInstructions(), null, 2)}\n`);
}

const CODER_GOLDEN = Schema.decodeUnknownSync(
  Schema.Record(Schema.String, Schema.Struct({ onTask: Schema.String })),
)(JSON.parse(readFileSync(CODER_PATH, "utf8")));

test("a coding agent's instructions are the golden's, byte for byte, for each brief", () => {
  for (const brief of Object.values(AGENT_BRIEF)) {
    const recorded = CODER_GOLDEN[brief];
    assert.ok(recorded, brief);
    assert.equal(
      coderInstructions("Acme/Relay", brief, TASK_LINK, standingFor("Acme/Relay")),
      recorded.onTask,
      brief,
    );
  }
});

test("with Memory off the instructions say nothing of the workspace's memory; with it on they add its section before the one on messages, and nothing else", () => {
  for (const brief of Object.values(AGENT_BRIEF)) {
    const off = coderInstructions("Acme/Relay", brief, TASK_LINK, standingFor("Acme/Relay"));

    const on = coderInstructions(
      "Acme/Relay",
      brief,
      TASK_LINK,
      standingFor("Acme/Relay", { memory: true }),
      undefined,
      null,
      false,
      CODER_HARNESS.CLAUDE_CODE,
    );

    assert.ok(!off.includes("## The workspace's memory"), brief);
    assert.ok(!off.includes(`\`${AGENT_TOOL.SAVE_MEMORY}\``), brief);
    const start = on.indexOf("## The workspace's memory\n\n");
    const end = on.indexOf("## Writing", start);
    assert.ok(start > 0 && end > start, brief);
    assert.ok(on.slice(start, end).includes(`\`${AGENT_TOOL.SEARCH_MEMORY}\``), brief);
    assert.equal(on.slice(0, start) + on.slice(end), off, brief);
  }
});

test("with Done and follow-ups off the instructions say nothing of ending a turn; with it on they add its section before the one on messages, and nothing else", () => {
  for (const brief of Object.values(AGENT_BRIEF)) {
    const off = coderInstructions("Acme/Relay", brief, TASK_LINK, standingFor("Acme/Relay"));

    const on = coderInstructions(
      "Acme/Relay",
      brief,
      TASK_LINK,
      standingFor("Acme/Relay", { turnEnd: true }),
    );

    assert.ok(!off.includes(`\`${AGENT_TOOL.END_TURN}\``), brief);
    const start = on.indexOf("## Ending a turn\n\n");
    const end = on.indexOf("## Writing", start);
    assert.ok(start > 0 && end > start, brief);
    assert.ok(on.slice(start, end).includes(`\`${AGENT_TOOL.END_TURN}\``), brief);
    assert.equal(on.slice(0, start) + on.slice(end), off, brief);
  }
});

test("with Suggestions off the instructions say nothing of add_suggestion; with it on they add its section before the memory's, and nothing else", () => {
  const off = coderInstructions(
    "Acme/Relay",
    AGENT_BRIEF.PROMPT,
    TASK_LINK,
    standingFor("Acme/Relay"),
  );

  const on = coderInstructions(
    "Acme/Relay",
    AGENT_BRIEF.PROMPT,
    TASK_LINK,
    standingFor("Acme/Relay", { replyButtons: true }),
  );

  assert.ok(!off.includes(AGENT_TOOL.ADD_SUGGESTION));
  const start = on.indexOf("## Suggestions in your reply\n\n");
  const end = on.indexOf("## Writing", start);
  assert.ok(start > 0 && end > start);
  assert.ok(on.slice(start, end).includes(`\`${AGENT_TOOL.ADD_SUGGESTION}\``));
  assert.equal(on.slice(0, start) + on.slice(end), off);
});

test("with Task descriptions off the instructions say nothing of a description: no edit_description, no description handed with a task's link or read_task, no description to name or write a write-up into, and comments on pages alone", () => {
  const DESCRIPTION_WORDS = [
    `\`${AGENT_TOOL.EDIT_DESCRIPTION}\``,
    "**The description**",
    "take that decision into the description",
    "write it into the description",
    "a section of its description",
    "Your task's description:",
    "keep a mention in the description",
    "A comment on the description",
  ];

  for (const brief of Object.values(AGENT_BRIEF)) {
    const told = (descriptions: boolean) =>
      coderInstructions(
        "Acme/Relay",
        brief,
        TASK_LINK,
        standingFor("Acme/Relay", { descriptions }),
        undefined,
        null,
        false,
        CODER_HARNESS.CLAUDE_CODE,
      );

    const on = told(true);
    const off = told(false);
    assert.equal(
      on,
      coderInstructions("Acme/Relay", brief, TASK_LINK, standingFor("Acme/Relay")),
      brief,
    );
    assert.deepEqual(
      DESCRIPTION_WORDS.filter((words) => off.includes(words)),
      [],
      brief,
    );
    assert.ok(
      off.includes(
        `A comment on a page that reaches you is answered in its own thread with \`${AGENT_TOOL.REPLY_TO_COMMENT}\``,
      ),
      brief,
    );
    assert.ok(off.includes(`show it as a page with \`${AGENT_TOOL.SHOW_PAGE}\``), brief);
  }

  const planned = coderInstructions(
    "Acme/Relay",
    AGENT_BRIEF.DESCRIPTION,
    TASK_LINK,
    standingFor("Acme/Relay"),
  );

  assert.deepEqual(
    DESCRIPTION_WORDS.filter((words) => !planned.includes(words)),
    [],
  );
});
