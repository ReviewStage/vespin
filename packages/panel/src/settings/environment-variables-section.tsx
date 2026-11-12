import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { readingWords } from "@repo/features/words";
import {
  WORKSPACE_ENVIRONMENT_BOUNDS,
  type WorkspaceEnvironmentAnswer,
  workspaceVariableNameSchema,
} from "@repo/features/workspace-environment-wire";
import { managesWorkspace } from "@repo/features/workspace-role";
import type { Workspace } from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import {
  BUTTON_VARIANT,
  Button,
  CONFIRM_LOSS,
  ConfirmDialog,
  DIALOG_TONE,
  Dialog,
  DialogActions,
  FormField,
  PlusIcon,
  SETTINGS_SKELETON_CONTROL,
  SecretField,
  SettingsLine,
  type SettingsRowSkeletonShape,
  SettingsRowsSkeleton,
  SettingsSection,
  Stack,
  TextField,
  TrashIcon,
  useConfirmDialog,
} from "@repo/ui";
import { GLYPH } from "@repo/ui/icons";
import { ReplayMask } from "@repo/ui/session-replay-marks";
import { ACTION_RESULT_STATUS, type ActionResult } from "@repo/wire";
import {
  type QueryClient,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Schema } from "effect";
import { useState } from "react";
import { actFailureWords, askAct, sendAct } from "../act.js";
import { useConfirmAct } from "../confirm-act.js";
import { useFormDialog } from "../desktop/use-form-dialog.js";
import { confirmFailure } from "../failure-report.js";
import { QUERY_ROOT } from "../query-keys.js";
import { ReadFailed, replayMaskedError } from "./marks.js";
import { MenuRow } from "./menu-row.js";

/**
 * environment-variables-section.tsx -- Settings › Cloud environment's Variables: the variables the workspace hands its members' cloud agents, added, replaced, and deleted by its owners and admins.
 *
 * The section reads the variables' names as Skills reads its skills, one row
 * each, and never a value, which the service hands back to no one. An
 * owner or admin adds one from the first section, and replaces or deletes
 * one from its row's ⋯, a delete asking first; a member sees the names
 * alone. Each write answers the names as they then stand, which the section
 * draws at once. A value is typed into a `SecretField`.
 */

/** A variable's row while the names are read. */
export const VARIABLE_ROW_SKELETON: SettingsRowSkeletonShape = {
  described: false,
  controls: [],
  end: [SETTINGS_SKELETON_CONTROL.MORE],
};

/** Whether a name is one the service takes, so Save waits for one it would not refuse by shape. */
const isVariableName = Schema.is(workspaceVariableNameSchema);

const ACCEPTED: ActionResult = { status: ACTION_RESULT_STATUS.ACCEPTED };

function rejected(error: unknown): ActionResult {
  return { status: ACTION_RESULT_STATUS.REJECTED, reason: actFailureWords(error) };
}

/** The workspace's variables by name, read as the page opens and on Try again. */
function environmentQuery(workspaceId: string) {
  return queryOptions({
    queryKey: [QUERY_ROOT.WORKSPACE_ENVIRONMENT, workspaceId],
    queryFn: () => askAct(ACT_KIND.WORKSPACE_ENVIRONMENT_LIST, { workspaceId }),
    retry: false,
  });
}

/** A write's answer drawn over the list, a read still under way canceled first so its older names cannot land over it. */
async function drawAnswer(
  queries: QueryClient,
  workspaceId: string,
  answer: WorkspaceEnvironmentAnswer,
): Promise<void> {
  const { queryKey } = environmentQuery(workspaceId);
  await queries.cancelQueries({ queryKey, exact: true });
  queries.setQueryData(queryKey, answer);
}

/** A put, its answer drawn over the list at once. */
function usePutVariable(workspaceId: string) {
  const queries = useQueryClient();

  return useMutation({
    mutationFn: (variable: { name: string; value: string }) =>
      sendAct(ACT_KIND.WORKSPACE_ENVIRONMENT_PUT, { workspaceId, ...variable }),
    onSuccess: (answer) => drawAnswer(queries, workspaceId, answer),
  });
}

/**
 * Add's card, or a variable's Replace value where `name` is given: a name and
 * a value, or the value alone under the name it replaces.
 */
function useVariableDialog(workspaceId: string, name?: string) {
  const [typedName, setTypedName] = useState("");
  const [value, setValue] = useState("");
  const putting = usePutVariable(workspaceId);
  const shownName = name ?? typedName.trim();

  const act = useConfirmAct(putting, {
    send: () => putting.mutateAsync({ name: shownName, value }),
    answered: () => ACCEPTED,
    failed: rejected,
  });

  const confirm = useConfirmDialog(
    { subject: true, surfaceOpen: true },
    act,
    confirmFailure(FAILURE_SURFACE.WORKSPACE_VARIABLE_SAVE),
  );

  const form = useFormDialog(
    confirm,
    isVariableName(shownName) &&
      value !== "" &&
      value.length <= WORKSPACE_ENVIRONMENT_BOUNDS.MAX_VALUE_CHARS,
  );

  const dialog = (
    <Dialog
      open={form.open}
      title={name === undefined ? "Add variable" : `Replace ${name}`}
      replayUnmasked
      titleReplayMasked={name !== undefined}
      busy={form.settling}
      refused={form.refusal !== undefined}
      onDismiss={form.dismiss}
      onExited={() => {
        setTypedName("");
        setValue("");
      }}
      actions={
        <DialogActions
          onCancel={form.dismiss}
          act={{ verb: "Save", tone: DIALOG_TONE.PRIMARY, running: "Saving", ...form.act }}
        />
      }
    >
      <Stack>
        {name === undefined ? (
          <FormField label="Name">
            {(control) => (
              <ReplayMask>
                <TextField
                  field={control}
                  autoCorrect={false}
                  spellCheck={false}
                  placeholder="API_TOKEN"
                  maxLength={WORKSPACE_ENVIRONMENT_BOUNDS.MAX_NAME_CHARS}
                  disabled={form.settling}
                  value={typedName}
                  onChange={setTypedName}
                  onEnter={form.submit}
                />
              </ReplayMask>
            )}
          </FormField>
        ) : null}
        <SecretField
          label="Value"
          saved={name !== undefined}
          error={replayMaskedError(form.refusal)}
          disabled={form.settling}
          value={value}
          onChange={setValue}
          onEnter={form.submit}
        />
      </Stack>
    </Dialog>
  );

  return { ask: confirm.ask, dialog };
}

/** One variable's row: its name, and for an owner or admin a ⋯ with Replace value and Delete. */
function VariableRow({
  workspaceId,
  name,
  manages,
}: {
  workspaceId: string;
  name: string;
  manages: boolean;
}): React.JSX.Element {
  const queries = useQueryClient();
  const replace = useVariableDialog(workspaceId, name);

  const deleting = useMutation({
    mutationFn: () => sendAct(ACT_KIND.WORKSPACE_ENVIRONMENT_DELETE, { workspaceId, name }),
    onSuccess: (answer) => drawAnswer(queries, workspaceId, answer),
  });

  const deleteAct = useConfirmAct(deleting, {
    send: () => deleting.mutateAsync(),
    answered: () => ACCEPTED,
    failed: rejected,
  });

  const deletion = useConfirmDialog(
    { subject: true, surfaceOpen: true },
    deleteAct,
    confirmFailure(FAILURE_SURFACE.WORKSPACE_VARIABLE_DELETE),
  );

  const actions = manages
    ? [
        { label: "Replace value", icon: <GLYPH.RENAME />, onSelect: replace.ask },
        { label: "Delete", icon: <TrashIcon />, danger: true, onSelect: deletion.ask },
      ]
    : [];

  return (
    <>
      <MenuRow thing={name} actions={actions} row={{ label: <ReplayMask>{name}</ReplayMask> }} />
      {manages ? (
        <>
          {replace.dialog}
          <ConfirmDialog
            open
            confirm={deletion}
            question={{
              title: `Delete ${name}?`,
              verb: "Delete",
              running: "Deleting",
              loss: CONFIRM_LOSS.AFFECTS_OTHERS,
              replayUnmasked: true,
              titleReplayMasked: true,
            }}
          />
        </>
      ) : null}
    </>
  );
}

/** Variables over one workspace, Add variable on its heading for an owner or admin. */
export function EnvironmentVariablesSection({
  workspace,
}: {
  workspace: Workspace;
}): React.JSX.Element {
  const manages = managesWorkspace(workspace);
  const environment = useQuery(environmentQuery(workspace.id));
  const add = useVariableDialog(workspace.id);
  const variables = environment.data?.variables;

  return (
    <>
      <SettingsSection
        title="Variables"
        action={
          manages ? (
            <Button variant={BUTTON_VARIANT.OUTLINE} icon={<PlusIcon />} onClick={add.ask}>
              Add variable
            </Button>
          ) : undefined
        }
      >
        {environment.isError ? (
          <ReadFailed
            line="The variables could not be read."
            surface={FAILURE_SURFACE.WORKSPACE_ENVIRONMENT_READ}
            onRetry={() => void environment.refetch()}
          />
        ) : variables === undefined ? (
          <SettingsRowsSkeleton
            label={readingWords("the variables")}
            rows={[VARIABLE_ROW_SKELETON]}
          />
        ) : variables.length === 0 ? (
          <SettingsLine>No variables yet.</SettingsLine>
        ) : (
          variables.map((variable) => (
            <VariableRow
              key={variable.name}
              workspaceId={workspace.id}
              name={variable.name}
              manages={manages}
            />
          ))
        )}
      </SettingsSection>
      {manages ? add.dialog : null}
    </>
  );
}
