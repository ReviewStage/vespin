import {
  terminalAgentParamsSchema,
  terminalAttachParamsSchema,
  terminalShellParamsSchema,
} from "@repo/features/terminal-acts";
import { WORKSPACE_SANDBOX_SETUP_BOUNDS } from "@repo/features/workspace-sandbox-setup-wire";
import { Schema as EffectSchema } from "effect";
import { actProcedure, exactInput } from "./base.js";
import { MAC_SHELL_ACT_KIND } from "./kinds.js";

/**
 * mac-shells.ts -- a shell on this Mac, opened in a folder for the asking panel, attached, and closed, and a local agent's run action run, stopped, and listed there, as procedures.
 *
 * Main answers them itself (`../act-port/mac-shell-procedures.ts`), and a
 * browser tab refuses them. A shell is named as a cloud shell is, by its
 * agent and its own id, so an attach takes the cloud's attach as it stands
 * and posts the same port: what the shell prints, how it stands, and what
 * the panel types, resizes, and acks travel on it, never on these.
 *
 * A run action of an agent that runs on this Mac runs in that agent's
 * worktree as a process of its own, named by its agent and its action, and
 * attached and closed as any shell here is; its tab takes nothing typed.
 */

/** The longest folder a shell opens in, as macOS's `PATH_MAX` bounds a path. */
const FOLDER_MAX_CHARS = 1024;

/** A shell opened for an agent, in a folder named by its absolute path, at the size its screen was first fitted to. */
const macShellOpenParamsSchema = EffectSchema.Struct({
  agentId: terminalShellParamsSchema.fields.agentId,
  folder: EffectSchema.String.check(
    EffectSchema.isPattern(/^\//u),
    EffectSchema.isMaxLength(FOLDER_MAX_CHARS),
  ),
  cols: terminalAttachParamsSchema.fields.cols,
  rows: terminalAttachParamsSchema.fields.rows,
});

/** The agent's mirror, by the absolute path of its folder. */
const macShellMirrorSchema = EffectSchema.Struct({ folder: EffectSchema.String });

/** The shell opened, by the id an attach and a close name it by. */
const macShellOpenedSchema = EffectSchema.Struct({
  terminalId: terminalShellParamsSchema.fields.terminalId,
});

/** A local agent's run action as the panel asks for it: the agent, the action's id, and its label and command as the workspace keeps them. */
const macRunActionParamsSchema = EffectSchema.Struct({
  agentId: terminalShellParamsSchema.fields.agentId,
  actionId: terminalShellParamsSchema.fields.agentId,
  title: EffectSchema.String.check(
    EffectSchema.isMinLength(1),
    EffectSchema.isMaxLength(WORKSPACE_SANDBOX_SETUP_BOUNDS.MAX_RUN_ACTION_LABEL_CHARS),
  ),
  command: EffectSchema.String.check(
    EffectSchema.isMinLength(1),
    EffectSchema.isMaxLength(WORKSPACE_SANDBOX_SETUP_BOUNDS.MAX_RUN_ACTION_COMMAND_CHARS),
  ),
});

/** A local agent's run action named by its agent and its id, as a stop names it. */
const macRunActionNamedSchema = EffectSchema.Struct({
  agentId: terminalShellParamsSchema.fields.agentId,
  actionId: terminalShellParamsSchema.fields.agentId,
});

/**
 * One run action's process on this Mac: the id its tab attaches by, its
 * title, the action it runs, whether its process runs, and how it ended
 * once it has, its output kept for the tab to go on showing.
 */
const macRunActionShellSchema = EffectSchema.Struct({
  id: terminalShellParamsSchema.fields.terminalId,
  title: EffectSchema.String,
  runAction: EffectSchema.String,
  running: EffectSchema.Boolean,
  exited: EffectSchema.optionalKey(
    EffectSchema.Union([
      EffectSchema.Struct({ code: EffectSchema.Int }),
      EffectSchema.Struct({ signal: EffectSchema.Int }),
    ]),
  ),
});

export type MacRunActionShell = typeof macRunActionShellSchema.Type;

export const macShellActsContract = {
  [MAC_SHELL_ACT_KIND.MAC_SHELL_MIRROR]: actProcedure("Could not mirror this agent’s files.")
    .input(exactInput(terminalAgentParamsSchema))
    .output(macShellMirrorSchema),
  [MAC_SHELL_ACT_KIND.MAC_SHELL_OPEN]: actProcedure("Could not open a shell in that folder.")
    .input(exactInput(macShellOpenParamsSchema))
    .output(macShellOpenedSchema),
  [MAC_SHELL_ACT_KIND.MAC_SHELL_ATTACH]: actProcedure("Could not open that shell.")
    .input(exactInput(terminalAttachParamsSchema))
    .output(EffectSchema.Void),
  [MAC_SHELL_ACT_KIND.MAC_SHELL_CLOSE]: actProcedure("Could not close that shell.")
    .input(exactInput(terminalShellParamsSchema))
    .output(EffectSchema.Void),
  [MAC_SHELL_ACT_KIND.MAC_SHELL_RUN_ACTION]: actProcedure("Could not run that action on this Mac.")
    .input(exactInput(macRunActionParamsSchema))
    .output(EffectSchema.Struct({ terminal: macRunActionShellSchema })),
  [MAC_SHELL_ACT_KIND.MAC_SHELL_STOP_ACTION]: actProcedure(
    "Could not stop that action on this Mac.",
  )
    .input(exactInput(macRunActionNamedSchema))
    .output(EffectSchema.Void),
  [MAC_SHELL_ACT_KIND.MAC_SHELL_ACTIONS]: actProcedure("Could not read this agent’s run actions.")
    .input(exactInput(terminalAgentParamsSchema))
    .output(EffectSchema.Struct({ terminals: EffectSchema.Array(macRunActionShellSchema) })),
};
