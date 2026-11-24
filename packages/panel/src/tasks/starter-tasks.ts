/**
 * starter-tasks.ts -- the jobs Home offers a workspace with few tasks yet, each one press that fills New task's box with what the agent will do: what each needs, and which a workspace is offered.
 *
 * A box that asks someone to think of something leaves them thinking of
 * nothing, so a new workspace's Home names a few narrow jobs instead, each
 * one the app does well and others don't: an app built and shared by link
 * from the agent's own sandbox, a site walked through and recorded in its
 * browser, three workers racing one fix, one small fix opened as a pull
 * request, a morning briefing an automation posts to the Inbox, and the
 * threads left open in Codex and Claude Code on the member's own Mac turned
 * into Inbox items. Each ends in something to open, a link, a video, a pull
 * request, or Inbox items, rather than a chat to read. They stand in the
 * order declared here; one needing a repository the workspace has none of
 * keeps its place, its card asking for GitHub, since connecting it is the
 * way to run it, while one needing a Mac is offered only to a member who
 * has one, since that is no press away. Its prompt is the words a press writes into the box, which
 * the member reads, edits, and starts; one that needs something typed, such
 * as the site's address, ends where it goes.
 */

/** How many tasks the workspace holds before Home shows no starters. */
export const STARTER_BOUNDS = {
  UNTIL_TASKS: 3,
} as const;

/** What a starter needs before it can run: nothing but an agent, a repository the workspace reaches, or a Mac of the member's an agent can run on. */
export const STARTER_NEED = {
  NONE: "none",
  REPOSITORY: "repository",
  MAC: "mac",
} as const;

export type StarterNeed = (typeof STARTER_NEED)[keyof typeof STARTER_NEED];

/** Each starter, by the name it is known by. */
export const STARTER = {
  AGENT_HISTORY: "agent-history",
  SITE_WALKTHROUGH: "site-walkthrough",
  DAILY_BRIEFING: "daily-briefing",
  RACE_FIXES: "race-fixes",
  SMALL_FIX: "small-fix",
  LIVE_APP: "live-app",
} as const;

export type Starter = (typeof STARTER)[keyof typeof STARTER];

/** One starter: what its card says, what it needs, and the words its press writes into the box. */
export interface StarterTask {
  readonly starter: Starter;
  readonly name: string;
  /** What it does, in a line. */
  readonly detail: string;
  readonly needs: StarterNeed;
  readonly prompt: string;
}

/** Every starter, in the order Home offers them. */
export const STARTER_TASKS: readonly StarterTask[] = [
  {
    starter: STARTER.AGENT_HISTORY,
    name: "Clean up your Codex and Claude Code threads",
    detail: "Turns the threads on your Mac that are still waiting on you into Inbox items.",
    needs: STARTER_NEED.MAC,
    prompt:
      "Read my Codex and Claude Code history on this Mac (~/.codex/sessions and ~/.claude/projects). Find the threads that stopped on an open question or unfinished work, and post one Inbox thread for each: where it stood, in a line, and the one decision it needs from me. Then show me a page listing the threads that look finished, so I can archive them. Only read those files; don't change or delete anything.",
  },
  {
    starter: STARTER.SITE_WALKTHROUGH,
    name: "Record a walkthrough of my site",
    detail:
      "Clicks through your site in its browser, records a video, and shows the 5 issues it hit.",
    needs: STARTER_NEED.NONE,
    prompt:
      "Open my site in your browser and record a video walking through it the way a first-time visitor would. Then show me the 5 issues you hit, worst first, each with a screenshot. My site: ",
  },
  {
    starter: STARTER.DAILY_BRIEFING,
    name: "Put a daily briefing in my Inbox",
    detail:
      "Sets up an automation that posts what needs your call in this repository every weekday morning.",
    needs: STARTER_NEED.REPOSITORY,
    prompt:
      "Set up an automation that runs every weekday at 9 AM: it reads this repository's open pull requests and issues, and posts one Inbox thread listing what needs my call, each with the decision it needs. Run it once now so I can see the first briefing.",
  },
  {
    starter: STARTER.RACE_FIXES,
    name: "Try 3 fixes at once",
    detail:
      "Finds one real bug, has three agents fix it three ways, and opens a pull request with the best.",
    needs: STARTER_NEED.REPOSITORY,
    prompt:
      "Find one real bug or rough edge in this repository that's worth fixing. Then start three workers, each fixing it a different way, compare their diffs and test results, and open a pull request with the best one. Tell me in a few lines why it won.",
  },
  {
    starter: STARTER.SMALL_FIX,
    name: "Fix one small thing",
    detail: "Picks one small, safe fix in this repository and opens a pull request for it.",
    needs: STARTER_NEED.REPOSITORY,
    prompt:
      "Look through this repository and pick one small, safe fix worth making: a failing test, a broken link in the docs, a stale TODO, or a lint error. Tell me in a line why you picked it, make the fix, and open a pull request.",
  },
  {
    starter: STARTER.LIVE_APP,
    name: "Build a tiny app and send me a link",
    detail:
      "Builds a small web app in the agent's own sandbox and shares a live link you can open on your phone.",
    needs: STARTER_NEED.NONE,
    prompt:
      "Build me a small, genuinely useful web app (you pick: a tip splitter, a pomodoro timer, or a unit converter), run it in your sandbox, and send me a live link I can open on my phone. Show me a screenshot of it too.",
  },
];

/** A starter as Home offers it: whether the workspace can run it now, or must connect GitHub first. */
export interface OfferedStarter {
  readonly task: StarterTask;
  readonly runnable: boolean;
}

/**
 * The starters a workspace is offered, in the order declared: each it can
 * run, each needing a repository it lacks where GitHub can be connected
 * (`connectable`), and one needing a Mac only where the member has one.
 */
export function startersFor(has: {
  /** Whether the workspace reaches a repository. */
  readonly repository: boolean;
  /** Whether the workspace could be given one, its GitHub connected or its repositories chosen. */
  readonly connectable: boolean;
  /** Whether the member has a Mac an agent can run on. */
  readonly mac: boolean;
}): readonly OfferedStarter[] {
  const met = {
    [STARTER_NEED.NONE]: true,
    [STARTER_NEED.REPOSITORY]: has.repository,
    [STARTER_NEED.MAC]: has.mac,
  } as const satisfies Record<StarterNeed, boolean>;

  // A job needing a repository stays offered where one can be connected, its card asking for GitHub.
  const offered = STARTER_TASKS.filter(
    (task) => met[task.needs] || (task.needs === STARTER_NEED.REPOSITORY && has.connectable),
  );

  return offered.map((task) => ({ task, runnable: met[task.needs] }));
}

/**
 * The box's words once a starter is pressed: the starter's own where the
 * box holds nothing or another starter's words untouched, so pressing one
 * after another swaps them, and otherwise what the member typed with the
 * starter's words after it, so a press never loses a draft.
 */
export function draftWithStarter(typed: string, task: StarterTask): string {
  const kept = typed.trim();

  if (kept === "" || STARTER_TASKS.some(({ prompt }) => prompt.trim() === kept)) return task.prompt;

  return `${kept}\n\n${task.prompt}`;
}
