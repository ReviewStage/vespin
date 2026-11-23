/**
 * agent-box.tsx -- what a composer writing to a started agent reads off that agent, read in one place for every such composer: the agent's own page's and an Inbox thread's reply.
 *
 * The desktop's `@repo/panel` reads it once (`agent-box.tsx`'s
 * `useAgentBox`) so its agent tab's box and an Inbox thread's box stand
 * alike, and the phone does the same: the Machine chip after the +, saying
 * where the agent works and, where it is offered `run_on_mac`, where its
 * commands go; the model chip at the row's end, whose choices hold the
 * model, its effort, Fast, and the permission mode, popping over the chip in
 * a regular window and rising as a sheet in a compact one; and the + menu's
 * MCP servers. Note that a chip a later change gives an agent's composer
 * belongs here rather than at one screen's call, because each screen reading
 * the agent for itself is how the thread's composer fell behind the agent's.
 */

import { modelLabel, providerOf } from "@repo/features/model-label";
import { agentRunsOnWords, RUNS_ON_WORDS } from "@repo/features/task-agents-model";
import { MCP_SERVER_LABEL } from "@repo/features/words";
import type { FollowedAgent } from "@repo/host/app-state-reads";
import { PERMISSION_MODE_WORDS } from "@repo/settings";
import {
  type BarMenu,
  CHOICE_MARK,
  GLYPH,
  MENU_CHIP_LOOK,
  MenuChip,
  ModelChoicePopover,
  ModelChoiceSheet,
  type ModelChoices,
  PERMISSION_MODE_GLYPH,
  runsOnGlyph,
  useWindowSizeClass,
  WINDOW_SIZE_CLASS,
} from "@repo/ui-native";
import { type ReactNode, useState } from "react";
import { type AgentMode, useAgentMode } from "./use-agent-mode.js";
import { type AgentModelPick, useAgentModelPick } from "./use-agent-model.js";
import { useAgentPlaceGlyph } from "./use-agent-place.js";
import { type AgentServers, useAgentServers } from "./use-agent-servers.js";
import { type AgentCommandsPlace, useAgentCommandsPlace } from "./use-agent-tools.js";

/** The name a flow finds the composer's model chip by. */
const MODEL_CHIP_ID = "agent-model-chip";

/** The name a flow finds the composer's Machine chip by. */
const MACHINE_CHIP_ID = "agent-machine-chip";

/** What the Machine chip's menu heads where commands go, as the panel's place chip names its Default machine row. */
const COMMANDS_WORDS = { LABEL: "Terminal and computer use" } as const;

/** No servers to offer, held as one value so a menu with none reads the same each time. */
const NO_SUBMENUS: readonly BarMenu[] = [];

/**
 * The model chip at the end of the composer's row, as the desktop's stands
 * at its box's foot: the model's name in words alone, "Opus 5.5", with no
 * harness mark, as the desktop's chip stands, and no effort, since a
 * phone's row has no room for it, as Claude's and Cursor's chips name the
 * model alone; a press opens the model's choices,
 * where the model, its effort, Fast and the permission mode are chosen; none
 * before the agent's model is known.
 */
function AgentModelChip({
  pick,
  onOpen,
}: {
  readonly pick: AgentModelPick;
  readonly onOpen: (() => void) | undefined;
}) {
  if (pick.model === undefined || onOpen === undefined) return null;

  const model =
    pick.models.find((option) => option.id === pick.model)?.label ?? modelLabel(pick.model);

  return (
    <MenuChip look={MENU_CHIP_LOOK.COMPOSER} label={model} onOpen={onOpen} testId={MODEL_CHIP_ID} />
  );
}

/**
 * Where the agent works, as the desktop's Machine chip stands after the +:
 * Cloud or its device's name, led by the panel's runs-on mark; its menu,
 * where the agent is offered `run_on_mac`, says where its terminal commands
 * and computer use go, each machine the agent may send them to, the one
 * they go to now checked, a pick setting it (`useAgentCommandsPlace`). A
 * chip with no machine to choose says where the agent works alone.
 */
function AgentMachineChip({
  agent,
  commands,
}: {
  readonly agent: Pick<FollowedAgent, "machine" | "mac" | "workspaceId">;
  readonly commands: AgentCommandsPlace | undefined;
}) {
  const symbol = useAgentPlaceGlyph(agent);

  const menu =
    commands === undefined || commands.machines.length === 0
      ? undefined
      : {
          groups: [
            {
              title: COMMANDS_WORDS.LABEL,
              choices: commands.machines.map((machine) => ({
                label: machine.name,
                symbol: runsOnGlyph({ cloud: false }),
                on: machine.id === commands.machine?.id,
                onPress: () => commands.choose(machine.id),
              })),
            },
          ],
        };

  return (
    <MenuChip
      look={MENU_CHIP_LOOK.COMPOSER}
      label={agentRunsOnWords(agent) || RUNS_ON_WORDS.LABEL}
      symbol={symbol}
      {...(menu === undefined ? {} : { menu })}
      testId={MACHINE_CHIP_ID}
    />
  );
}

/**
 * The agent's model choices, as the panel's model chip menu offers them:
 * each model its harness runs, led by the harness's mark; the model's
 * efforts and Fast, where it takes them, which take effect from its next
 * step; and last its permission mode, each with its glyph and what it does,
 * where its harness takes one, which takes effect from its next turn.
 */
function agentModelChoices(pick: AgentModelPick, mode: AgentMode | undefined): ModelChoices {
  const models = pick.models.flatMap((option) => {
    const provider = providerOf(option.id);

    return provider === undefined ? [] : [{ ...option, provider }];
  });

  return {
    models,
    model: pick.model,
    onModel: pick.pickModel,
    efforts: pick.efforts,
    effort: pick.effort,
    onEffort: pick.pickEffort,
    fast: pick.fast === undefined ? undefined : { on: pick.fast.on, onSwitch: pick.fast.toggle },
    note: pick.note,
    mode:
      mode === undefined
        ? undefined
        : {
            title: PERMISSION_MODE_WORDS.QUESTION,
            options: mode.modes.map((option) => ({
              ...option,
              symbol: PERMISSION_MODE_GLYPH[option.id],
            })),
            picked: mode.mode,
            onPick: (picked) => {
              const chosen = mode.modes.find((option) => option.id === picked);

              if (chosen !== undefined) mode.choose(chosen.id);
            },
            footer: PERMISSION_MODE_WORDS.APPLIES,
            note: mode.note,
          },
  };
}

/**
 * The + menu's MCP servers ›, as the desktop composer's + offers them: each
 * server the agent is handed led by its provider's mark, checked while it is
 * on, a press switching it, once they are read and where any is connected;
 * none before the task list holds the agent, since a switch then changes
 * nothing.
 */
function serverMenus(servers: AgentServers, listed: boolean): readonly BarMenu[] {
  if (!listed || !servers.read || servers.servers.length === 0) return NO_SUBMENUS;

  return [
    {
      label: MCP_SERVER_LABEL.many,
      symbol: GLYPH.MCP_SERVER,
      choices: servers.servers.map((server) => ({
        label: server.name,
        mark: { kind: CHOICE_MARK.INTEGRATION, provider: server.provider },
        on: server.on,
        onPress: () => servers.toggle(server.connection, !server.on),
      })),
      actions: [],
    },
  ];
}

/** What a composer writing to a started agent takes from that agent, handed to `Composer` and its + menu as it is. */
export interface AgentBox {
  /** What leads the row under the field after the +: the Machine chip; none before the agent is read. */
  readonly tools: ReactNode;
  /** What stands at the row's end before Send: the model chip, its choices popping over it in a regular window. */
  readonly trailing: ReactNode;
  /** The model's choices as a sheet, which a compact window raises from the chip; drawn by the screen beside its dock, since a sheet stands outside the bar. None where they pop over the chip. */
  readonly sheet: ReactNode;
  /** Opens the model's choices; none before the agent is read. */
  readonly openModels: (() => void) | undefined;
  /** The + menu's MCP servers ›, after its Photos. */
  readonly submenus: readonly BarMenu[];
  /** Why the last change of a server, the permission mode, or the model did not take, in that order, for the screen's newest note (`useNewestNote`). */
  readonly notes: readonly (string | undefined)[];
}

/**
 * What a composer writing to the agent `id` names reads off it, as the
 * desktop's `useAgentBox` reads it for both its boxes. `agent` is the agent
 * as the task list holds it, none where the list doesn't; `popover` says
 * the model's choices pop over the chip whatever the window, as a SwiftUI
 * column's foot needs, where no sheet of React Native's can stand.
 */
export function useAgentBox(
  id: string,
  agent: FollowedAgent | undefined,
  popover = false,
): AgentBox {
  const mode = useAgentMode(id);
  const pick = useAgentModelPick(id);
  const servers = useAgentServers(id);
  const commands = useAgentCommandsPlace(id);
  const [shown, setShown] = useState(false);
  const regular = useWindowSizeClass() === WINDOW_SIZE_CLASS.REGULAR;
  const openModels = agent === undefined ? undefined : () => setShown(true);
  // Note that a regular window's model choices pop over from the model chip rather than rising as a sheet; with no chip standing they keep the sheet.
  const pops = (popover || regular) && openModels !== undefined && pick.model !== undefined;
  const chip = <AgentModelChip pick={pick} onOpen={openModels} />;
  const choices = agentModelChoices(pick, mode);

  return {
    tools: agent === undefined ? undefined : <AgentMachineChip agent={agent} commands={commands} />,
    trailing: pops ? (
      <ModelChoicePopover
        chip={chip}
        presented={shown}
        onDismiss={() => setShown(false)}
        {...choices}
      />
    ) : (
      chip
    ),
    sheet: pops ? null : (
      <ModelChoiceSheet presented={shown} onDismiss={() => setShown(false)} {...choices} />
    ),
    openModels,
    submenus: serverMenus(servers, agent !== undefined),
    notes: [servers.note, mode?.note, pick.note],
  };
}
