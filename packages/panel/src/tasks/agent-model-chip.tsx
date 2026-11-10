import { runtimeModelRule, runtimeModels } from "@repo/features/agent-runtime-models";
import type { AgentPayer, AgentUsage } from "@repo/features/agent-wire";
import type { CatalogModel } from "@repo/features/models-wire";
import {
  CHIP_LOOK,
  Chip,
  type ChipLook,
  ChipName,
  type ChipWidth,
  POPOVER_ALIGN,
  Tooltip,
} from "@repo/ui";
import type { Actor } from "@repo/ui/actor-model";
import { useDisclosure } from "@repo/ui/use-disclosure";
import { useId, useRef, useState } from "react";
import { HarnessMark } from "../harness-marks.js";
import { type AgentModeControl, MODE_GLYPH, MODE_WORDS, modeShown } from "./agent-approvals.js";
import { choiceLabel, paidByOf, providerOf } from "./agent-model.js";
import { payerLastLine, usePayerPlan } from "./agent-payer.js";
import { ModelLabel } from "./model-label.js";
import { ModelMenu, settledChoice } from "./model-menu.js";
import type { AgentModelControl } from "./use-agent-model.js";

/**
 * agent-model-chip.tsx -- the chip at the agent box's foot that names what the agent runs on, and the menu that changes it.
 *
 * Drawn along the composer card's foot as the window's toolbar chip
 * (`@repo/ui`'s `Chip`), the task toolbar's repository chip's look, with no
 * border and no fill until the pointer is on it or its menu is open:
 * "Opus 5.5 High" (`model-label.tsx`), with "Fast" after the effort where
 * the fast version is on and the standard context window's size where the
 * agent runs on that rather than its model's whole window ("GPT-5.5 High
 * 272K"), and a chevron saying it opens a menu. A press
 * opens the shared model menu (`model-menu.tsx`) right above the chip,
 * from its trailing edge, since the chip stands at the foot's right
 * (`@repo/ui`'s `SearchableMenu`), the
 * agent's choice checked; what the menu chooses is the agent's model,
 * effort, and context window for its next step, drawn on the chip at once (`use-agent-model.ts`). The chip reads the
 * same whatever the agent is doing, since a change mid-turn applies from
 * the next step and an idle agent's next turn takes it. The models are
 * read as the chip mounts and again as the menu opens, so the menu shows
 * the catalog as it stands. Under the menu's pinned rows, behind a hairline
 * of its own, one muted line says who pays for the agent (`agent-payer.tsx`):
 * whose plan, or whose key and what the run has cost on it so far. The menu closes on a pick, on Escape, and on
 * focus leaving it; Escape stops there, so it closes the menu and not the
 * panel behind it. A composer too narrow for the words has the chip draw
 * its harness's mark in their place (`iconOnly`), so the choice is named by
 * the chip's label and its tooltip rather than by its words. An agent on a
 * provider's own harness is offered only what that harness runs, the rule
 * `list_models` and `update_agent` read too (`agent-runtime-models.ts`): on
 * Claude Code, Claude models alone, with no Fast switch and no Context row.
 * Who pays is read once, the page's payer before the settled turns', and
 * the plan the agent's harness runs on only where neither names one
 * (`paidByOf`), so a Codex agent says its plan before its first turn
 * settles. A Claude Code agent's chip hands its menu the agent's permission
 * mode too, its last pinned row (`agent-approvals.tsx`), and off Full
 * access wears the mode's glyph before the model's name, in the harness
 * mark's place where the composer is narrow, its label naming the mode
 * after the model. The reader's own plan is named where their keys hold the one the
 * page named ("Your Codex plan (ana@work.com)", masked in a screen
 * recording), a new agent's the first of the reader's plans with room left.
 */

export function AgentModelChip({
  model,
  models,
  modelsFailed,
  readModels,
  usage,
  payer,
  payerSubscriptionId,
  owner,
  look = CHIP_LOOK.TOOLBAR,
  width,
  narrow = false,
  startsNew = false,
  permissions,
}: {
  model: AgentModelControl;
  /** The catalog as the host holds it for the account; nothing before it is first read. */
  models: readonly CatalogModel[] | undefined;
  /** Whether the catalog could not be read. */
  modelsFailed: boolean;
  /** Asks the host for the catalog again, as the menu's Retry asks. */
  readModels: () => void;
  /** What the agent has cost, as its transcript's last page said; nothing before a turn settled. */
  usage: AgentUsage | undefined;
  /** Who pays for the agent, as its transcript's last page said, before a turn settled too; nothing where it said none. */
  payer?: AgentPayer | undefined;
  /** The starter's subscription a plan payer runs the agent on, as its transcript's last page said; nothing where it named none. */
  payerSubscriptionId?: string | undefined;
  /** The teammate who started the agent, whose plan or key pays for it; none for the reader's own. */
  owner?: Actor | undefined;
  /** The chip's look: the agent box's toolbar chip, or a form row's field (`@repo/ui`'s `Chip`). */
  look?: ChipLook;
  /** How wide the chip stands; its words' own width where none is named. */
  width?: ChipWidth | undefined;
  /** Whether its place is too narrow for the words, so a chip whose harness has a mark draws that alone. */
  narrow?: boolean;
  /** Whether the choice is what a new agent would start on, on the reader's own credentials, as an automation's is, so one nothing of theirs pays for says it cannot run; never a running agent's, whose starter pays. */
  startsNew?: boolean;
  /** The agent's permission mode and its change, offered in the menu; none for an agent whose harness takes no mode. */
  permissions?: AgentModeControl | undefined;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const drawn = useDisclosure(open);
  const menuId = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  // Note that we hand focus back to the chip, as a native menu returns it to
  // its trigger, because closing takes the focused field away with it.
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };

  const provider = providerOf(model.choice.model);
  const shown = modeShown(permissions);
  const ModeGlyph = shown === undefined ? undefined : MODE_GLYPH[shown];
  const modelWords = choiceLabel(model.choice, models ?? []).trim();
  const label = shown === undefined ? modelWords : `${modelWords} · ${MODE_WORDS[shown].label}`;
  // Note that who pays decides Fast on Codex, which runs a fast version on an OpenAI API key alone.
  const paidBy = payer ?? usage?.payer;
  const paying = paidByOf(payer, usage, model.runtime);
  const offered = models === undefined ? undefined : runtimeModels(models, model.runtime, paidBy);
  const plan = usePayerPlan(paying, payerSubscriptionId, paidBy === undefined, owner);

  return (
    <div className="agent-model-chip relative flex min-w-0" ref={root}>
      <Tooltip label={label}>
        <Chip
          ref={trigger}
          look={look}
          width={width}
          iconOnly={narrow && (provider !== undefined || ModeGlyph !== undefined)}
          chevron
          aria-label={label}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          onClick={() => setOpen(!open)}
        >
          {ModeGlyph !== undefined ? (
            <ModeGlyph />
          ) : narrow && provider !== undefined ? (
            <HarnessMark provider={provider} />
          ) : null}
          <ChipName>
            <ModelLabel choice={model.choice} models={models ?? []} />
          </ChipName>
        </Chip>
      </Tooltip>
      {drawn.mounted ? (
        <ModelMenu
          leaving={drawn.leaving}
          ref={drawn.ref}
          id={menuId}
          align={POPOVER_ALIGN.END}
          models={offered}
          failed={modelsFailed}
          onRetry={readModels}
          chosen={settledChoice(offered, model.choice)}
          startsNew={startsNew}
          offersFast={runtimeModelRule(model.runtime, paidBy).fast}
          permissions={permissions}
          onChoose={model.choose}
          lastLine={payerLastLine(paying, provider, usage, owner, plan)}
          onClose={close}
          onLeave={(left) => {
            if (!(left instanceof Node && root.current?.contains(left))) setOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}
