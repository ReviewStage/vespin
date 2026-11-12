/**
 * mcp-parity.test.ts -- every command `MEMBER_MCP_CLI_PARITY` names is one `vespin` parses, so a renamed or removed command cannot leave its tool's row standing.
 */

import { describe, expect, it } from "vitest";
import { COMMANDS } from "./commands/index.js";
import { MEMBER_MCP_CLI_PARITY } from "./mcp-parity.js";

/** A command of the tree, as far as its path is read. */
interface CommandNode {
  readonly name: string;
  readonly subcommands: ReadonlyArray<{ readonly commands: ReadonlyArray<CommandNode> }>;
}

/** Whether `path` names a command under `commands`, one name per level. */
function reaches(commands: ReadonlyArray<CommandNode>, path: ReadonlyArray<string>): boolean {
  const [head, ...rest] = path;
  const command = commands.find((candidate) => candidate.name === head);

  if (command === undefined) return false;

  if (rest.length === 0) return true;

  return reaches(
    command.subcommands.flatMap((group) => group.commands),
    rest,
  );
}

describe("MEMBER_MCP_CLI_PARITY", () => {
  it("names only commands vespin has", () => {
    const missing = Object.values(MEMBER_MCP_CLI_PARITY).flatMap((row) =>
      "command" in row && !reaches(COMMANDS, row.command) ? [row.command.join(" ")] : [],
    );

    expect(missing).toEqual([]);
  });
});
