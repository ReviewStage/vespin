import type { AgentToolPin } from "@repo/agent-runner/pins";
import { Effect, Option } from "effect";
import { type LocalAgentClis, LocalAgentClisUnavailable } from "./effect/seams.js";
import { keptToolBinary, localAgentTool } from "./local-agent-tools.js";

/**
 * local-agent-setup.ts -- what a device has before it registers ready to take an agent: the Claude Code, Codex, and GitHub CLI its agents run on, each fetched and kept under the device's own state, and the words it registers its setup failed with.
 *
 * Every host keeps its own copy of each CLI, a Linux host and a Mac's
 * `vespin-host` alike, This Mac's among them, at `agent-tools/` under its
 * state root (`localAgentTool`): the very releases the runner is built
 * against (`@repo/agent-runner/pins`), so nothing of the box's own, and
 * nothing the developer installed, is what an agent runs. A pin moved
 * fetches its new release at the next readiness step, and the old one goes
 * once the new one is kept.
 */

/**
 * What a device says it could not have, as it registers its setup failed
 * (`DEVICE_SETUP.FAILED`): words of our own, never a tool's, so none
 * names a secret.
 */
const SETUP_FAILURE = {
  CLAUDE_CODE: "Claude Code couldn't be downloaded or didn't pass its check",
  CODEX: "Codex couldn't be downloaded or didn't pass its check",
  GH: "GitHub's CLI couldn't be downloaded or didn't pass its check",
} as const;

/** The builds of the agent CLIs a host keeps, one each, for the box it runs on. */
export interface AgentCliPins {
  readonly claude: AgentToolPin;
  readonly codex: AgentToolPin;
  readonly gh: AgentToolPin;
}

/** The agent CLIs a device keeps under its state root, for the builds given (`LocalAgentPlatformSeam.clis`), all fetched side by side. */
export function localAgentClis(stateRoot: string, pins: AgentCliPins): LocalAgentClis {
  const wanted = [
    { pin: pins.claude, failure: SETUP_FAILURE.CLAUDE_CODE },
    { pin: pins.codex, failure: SETUP_FAILURE.CODEX },
    { pin: pins.gh, failure: SETUP_FAILURE.GH },
  ];

  return {
    paths: {
      claude: keptToolBinary(stateRoot, pins.claude),
      codex: keptToolBinary(stateRoot, pins.codex),
      gh: keptToolBinary(stateRoot, pins.gh),
    },
    ready: (preparing) =>
      Effect.gen(function* () {
        // Note that the device says it is getting ready once, whichever of the fetches begins first.
        const once = yield* Effect.cached(preparing);

        // Note that the tools are fetched side by side, and the first that could not be had says why.
        const had = yield* Effect.forEach(
          wanted,
          ({ pin, failure }) =>
            Effect.map(localAgentTool(stateRoot, pin, once), (tool) =>
              Option.isNone(tool) ? failure : undefined,
            ),
          { concurrency: "unbounded" },
        );

        const failed = had.find((failure) => failure !== undefined);

        if (failed !== undefined) return yield* new LocalAgentClisUnavailable({ detail: failed });
      }),
  };
}
