/**
 * manager-settings-dialog.tsx -- a Manager's Settings: the card its menu's Settings… opens, wherever its menu stands, which sets how it is named.
 *
 * A Manager is configured in one place, so its menu offers Settings… where
 * a coder's offers Rename (`agent-actions.tsx`). The card asks its Name,
 * the agent's title, which New Manager set (`new-manager-dialog.tsx`), and
 * saves it through the agent's own rename (`AgentsControl.rename`), the
 * act a coder's Rename sends; a Save with the name unchanged sends nothing.
 * A refusal stands in the card saying why, the name typed kept for another
 * try. Its fields stand in a `Stack`, so a field added after Name, the
 * Manager's face, slots in beside it.
 */

import { AGENT_BOUNDS, type AgentSummary } from "@repo/features/agent-wire";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import {
  DIALOG_TONE,
  Dialog,
  DialogActions,
  FormField,
  Stack,
  TextField,
  useConfirmDialog,
} from "@repo/ui";
import { ACTION_RESULT_STATUS, type ActionResult } from "@repo/wire";
import { useMutation } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { ANSWER_ACCEPTED, refusedWith, useConfirmAct } from "../confirm-act.js";
import { confirmFailure } from "../failure-report.js";
import { RENAME_FAILED } from "../tasks/agent-model.js";
import type { AgentsControl } from "../tasks/use-agents.js";
import { useFormDialog } from "./use-form-dialog.js";

/** The card's title. */
const MANAGER_SETTINGS = "Manager settings";

/** What the card says where Save is pressed with no name. */
const NAME_ASKED = "Name the Manager.";

/** A Manager's Settings: the press that opens the card, and the card. */
export interface ManagerSettingsAsk {
  readonly ask: () => void;
  readonly dialog: React.JSX.Element;
}

/** The Settings card for `agent`, a Manager, saved through `agents`; the card stands only while `shown`. */
export function useManagerSettingsDialog(
  agent: Pick<AgentSummary, "id" | "title">,
  agents: Pick<AgentsControl, "rename">,
  shown: boolean,
): ManagerSettingsAsk {
  const [name, setName] = useState("");
  const field = useRef<HTMLInputElement | null>(null);
  const saving = useMutation(agents.rename.options);
  const trimmed = name.trim();

  const confirmAct = useConfirmAct(saving, {
    refusedFirst: (): ActionResult | undefined =>
      trimmed === "" ? { status: ACTION_RESULT_STATUS.REJECTED, reason: NAME_ASKED } : undefined,
    // Note that an unchanged name sends nothing, so a Save that changed nothing lands at once.
    send: () =>
      trimmed === agent.title
        ? Promise.resolve()
        : saving.mutateAsync(agents.rename.ask(agent.id, trimmed)),
    answered: (answer): ActionResult =>
      agents.rename.refused(answer)
        ? { status: ACTION_RESULT_STATUS.REJECTED, reason: RENAME_FAILED }
        : ANSWER_ACCEPTED,
    failed: refusedWith,
  });

  const confirm = useConfirmDialog(
    { subject: true, surfaceOpen: shown },
    confirmAct,
    confirmFailure(FAILURE_SURFACE.MANAGER_SETTINGS),
  );

  const form = useFormDialog(confirm, trimmed !== "");

  const dialog = (
    <Dialog
      open={form.open}
      title={MANAGER_SETTINGS}
      replayUnmasked
      busy={form.settling}
      refused={form.refusal !== undefined}
      initialFocus={field}
      onDismiss={form.dismiss}
      actions={
        <DialogActions
          onCancel={form.dismiss}
          act={{ verb: "Save", tone: DIALOG_TONE.PRIMARY, running: "Saving", ...form.act }}
        />
      }
    >
      <Stack>
        <FormField label="Name" error={form.refusal}>
          {(control) => (
            <TextField
              ref={field}
              field={control}
              spellCheck={false}
              maxLength={AGENT_BOUNDS.MAX_TITLE_CHARS}
              value={name}
              disabled={form.settling}
              onEnter={form.submit}
              onChange={(next) => {
                setName(next);

                // Note that a refusal alone holds the card up, so an edit asks the question again rather than clearing it.
                if (confirm.rejection !== undefined) confirm.ask();
              }}
            />
          )}
        </FormField>
      </Stack>
    </Dialog>
  );

  return {
    ask: () => {
      setName(agent.title ?? "");
      saving.reset();
      confirm.ask();
    },
    dialog,
  };
}
