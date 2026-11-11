import type { LocalAgentCommand } from "./effect/seams.js";

/**
 * local-agent-box.ts -- a local agent as a host runs it straight on the box: each of its processes started as the host's own user, on the machine's own home and its own logins, with the pinned `gh` on its `PATH` behind the machine's own.
 *
 * The agent runs on the box user's real `HOME`, so its Claude Code and
 * Codex read the logins signed in on the machine, and its `git` and `gh`
 * the box user's own settings, credential helper, gh sign-in, and SSH keys.
 * Nothing is written into that home for it, and nothing of the agent's
 * stands outside its folder under `~/.vespin` but what its own commands
 * put there. So an agent holds the box user's whole GitHub sign-in, every
 * repository it reaches and not one alone, and its global installs change
 * the box user's own environment, as anything they run themselves does.
 * Nothing hides the box from it: it runs as the host's user, with full
 * access to whatever that user reaches.
 *
 * The pinned `gh` the host keeps stands behind the `PATH` the agent was
 * handed, so a box with its own `gh` runs that one, signed in as the box
 * user keeps it, and a box with none still has one.
 */

/** The folder a path stands in, as `/` joins it. */
function parentOf(file: string): string {
  return file.slice(0, Math.max(file.lastIndexOf("/"), 1));
}

/**
 * A command run as the agent on the box, with the environment given, the
 * folder of the `gh` given behind the `PATH` it was handed.
 */
export function agentOnBox(
  command: {
    readonly command: string;
    readonly args: readonly string[];
    readonly env: Readonly<Record<string, string>>;
  },
  gh: string,
): LocalAgentCommand {
  const path = [command.env.PATH, parentOf(gh)]
    .filter((each) => each !== undefined && each.length > 0)
    .join(":");
  return { command: command.command, args: command.args, env: { ...command.env, PATH: path } };
}
