// cloud-environment.tsx -- Settings' Cloud environment page for the workspace the app works in, in the panel's order and words: its sandbox's size, chosen by an owner or admin; its variables, each by its name and who changed it when, a value never shown, a secret added and a variable deleted, asked first, by an owner or admin; and its install and setup scripts, read whole and never edited here.

import { signedInAccountId } from "@repo/credentials/snapshot";
import {
  CLOUD_ENVIRONMENT_HEAD,
  CLOUD_SCRIPT_WORDS,
  SANDBOX_SIZE_WORDS,
  scriptLastRunWords,
  setByVespinNote,
  VARIABLE_WORDS,
  variableAddProblem,
  variableChanger,
  variableChangeWord,
  variableDeleteTitle,
} from "@repo/features/cloud-environment-words";
import {
  SANDBOX_SIZE,
  SANDBOX_VCPU_SIZES,
  type SandboxVcpus,
  sandboxSizeWords,
  sandboxVcpusOf,
} from "@repo/features/sandbox-size";
import { agoText } from "@repo/features/time-format";
import { readingWords } from "@repo/features/words";
import type {
  WorkspaceEnvironmentAnswer,
  WorkspaceVariable,
} from "@repo/features/workspace-environment-wire";
import { managesWorkspace } from "@repo/features/workspace-role";
import type { WorkspaceSandboxSetupAnswer } from "@repo/features/workspace-sandbox-setup-wire";
import type { Workspace } from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import { selectAccount, selectWorkspaces } from "@repo/host/app-state-reads";
import {
  ActionRow,
  askForWords,
  BUZZ,
  ConfirmAsk,
  FOOTER_TONE,
  GLYPH,
  ListSection,
  LoadingRow,
  MenuPickRow,
  NoteRow,
  SCREEN_GROUND,
  Screen,
  ScriptRow,
  SettingsForm,
  TRY_AGAIN_WORDS,
  ValueRow,
  WORDS_KIND,
} from "@repo/ui-native";
import {
  type QueryKey,
  type UseQueryResult,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { type ReactNode, useState } from "react";
import { useChosenWorkspace } from "../../../chosen-workspace.js";
import { cloudSetupKey, sandboxSizeKey, variablesKey } from "../../../cloud-environment-query.js";
import { appStateQuery } from "../../../host/app-state-query.js";
import { useHostActs } from "../../../host/host-provider.js";
import { SETTINGS_ROUTE } from "../../../settings-button.js";
import { useWrite, WRITE_SUBJECT } from "../../../use-write.js";

export { ScreenBoundary as ErrorBoundary } from "../../../screen-boundary.js";

/** What the size's menu says of each size, the one a workspace starts at marked as the default, as the panel's select tags it. */
const SIZE_OPTIONS = SANDBOX_VCPU_SIZES.map((vcpus) => ({
  id: String(vcpus),
  label:
    vcpus === SANDBOX_SIZE.VCPUS
      ? `${sandboxSizeWords(vcpus)} (${SANDBOX_SIZE_WORDS.DEFAULT})`
      : sandboxSizeWords(vcpus),
}));

/** Who a variable's line names: you, inside its sentence, for the reader's own change. */
function changerWords(
  variable: WorkspaceVariable,
  readerId: string | undefined,
): string | undefined {
  const changer = variableChanger(variable);

  if (changer === undefined) return undefined;

  return changer.userId === readerId ? "you" : changer.name;
}

/** The line under a variable's name, as the panel's reads: Added or Updated, when, and by whom where the service names them. */
function variableLine(variable: WorkspaceVariable, readerId: string | undefined, now: number) {
  const said = `${variableChangeWord(variable)} ${agoText(variable.updatedAt, now)}`;
  const who = changerWords(variable, readerId);

  return who === undefined ? said : `${said} ${VARIABLE_WORDS.BY} ${who}`;
}

/** A saved script's line: how it last ran, where it has. */
function scriptLine(
  saved: {
    readonly updatedAt: number;
    readonly lastRun?: WorkspaceSandboxSetupAnswer["setups"][number]["lastRun"];
  },
  now: number,
): string | undefined {
  const run = saved.lastRun;

  return run === undefined
    ? undefined
    : scriptLastRunWords(run, saved.updatedAt, agoText(run.ranAt, now));
}

/**
 * A section's rows while its read stands open: the read's words beside the
 * spinner while it is out, its failure in the footer with Try again where
 * it failed, and the rows once it answered.
 */
function ReadSection<Answer>({
  title,
  footer,
  read,
  reading,
  failed,
  add,
  rows,
}: {
  readonly title: string;
  readonly footer: (answer: Answer) => string;
  readonly read: UseQueryResult<Answer>;
  readonly reading: string;
  readonly failed: string;
  readonly add?: Parameters<typeof ListSection>[0]["add"];
  readonly rows: (answer: Answer) => ReactNode;
}) {
  if (read.isError) {
    return (
      <ListSection title={title} footer={failed} footerTone={FOOTER_TONE.FAILURE}>
        <ActionRow label={TRY_AGAIN_WORDS} onPress={() => void read.refetch()} />
      </ListSection>
    );
  }

  if (read.data === undefined) {
    return (
      <ListSection title={title}>
        <LoadingRow words={reading} />
      </ListSection>
    );
  }

  return (
    <ListSection title={title} footer={footer(read.data)} add={add}>
      {rows(read.data)}
    </ListSection>
  );
}

export default function CloudEnvironmentScreen() {
  const { data: workspaces = [] } = useQuery({ ...appStateQuery, select: selectWorkspaces });
  const { data: account } = useQuery({ ...appStateQuery, select: selectAccount });
  const { chosen } = useChosenWorkspace(workspaces);
  const accountId = account === undefined ? undefined : signedInAccountId(account);

  if (chosen === undefined || accountId === undefined) return null;

  // Note that the page is drawn anew for each workspace, so a question never carries into another.
  return <CloudEnvironmentPage key={chosen.id} workspace={chosen} accountId={accountId} />;
}

function CloudEnvironmentPage({
  workspace,
  accountId,
}: {
  readonly workspace: Workspace;
  readonly accountId: string;
}) {
  const acts = useHostActs();
  const queries = useQueryClient();
  const write = useWrite();
  const workspaceId = workspace.id;
  const manages = managesWorkspace(workspace);
  const now = Date.now();
  // The size a press asked for, drawn until its write settles, so the menu never snaps back meanwhile.
  const [asked, setAsked] = useState<SandboxVcpus | undefined>(undefined);
  const [deleting, setDeleting] = useState<WorkspaceVariable | undefined>(undefined);
  const [addRefusal, setAddRefusal] = useState<string | undefined>(undefined);
  const router = useRouter();
  const sizeKey = sandboxSizeKey(accountId, workspaceId);
  const listKey = variablesKey(accountId, workspaceId);

  const size = useQuery({
    queryKey: sizeKey,
    queryFn: () => acts[ACT_KIND.WORKSPACE_SANDBOX_SIZE_READ]({ workspaceId }),
    retry: false,
  });

  const environment = useQuery({
    queryKey: listKey,
    queryFn: () => acts[ACT_KIND.WORKSPACE_ENVIRONMENT_LIST]({ workspaceId }),
    retry: false,
  });

  const setup = useQuery({
    queryKey: cloudSetupKey(accountId, workspaceId),
    queryFn: () => acts[ACT_KIND.WORKSPACE_SANDBOX_SETUP_READ]({ workspaceId }),
    retry: false,
  });

  /** A write's answer drawn over its read, a read still out canceled first so its older answer cannot land over it. */
  const drawn =
    <Answer,>(queryKey: QueryKey) =>
    async (answer: Answer): Promise<Answer> => {
      await queries.cancelQueries({ queryKey, exact: true });
      queries.setQueryData(queryKey, answer);

      return answer;
    };

  const chooseSize = (id: string) => {
    const vcpus = sandboxVcpusOf(id);

    if (vcpus === undefined) return;
    setAsked(vcpus);
    void write(
      () => acts[ACT_KIND.WORKSPACE_SANDBOX_SIZE_PUT]({ workspaceId, vcpus }).then(drawn(sizeKey)),
      {
        retry: true,
        went: BUZZ.SELECTION,
        subject: { kind: WRITE_SUBJECT.SANDBOX_SIZE, id: workspaceId },
      },
    ).then(() => setAsked(undefined));
  };

  // Note that a name is checked before its value's sheet opens, so a name the service would refuse, or one saved already, says why under Variables and asks for nothing typed in vain.
  const addVariable = (saved: readonly WorkspaceVariable[]) =>
    askForWords({
      title: VARIABLE_WORDS.ADD,
      kind: WORDS_KIND.NAME,
      acts: [
        {
          label: VARIABLE_WORDS.NEXT,
          onWords: (name) => {
            const problem = variableAddProblem(name, saved);
            setAddRefusal(problem);

            if (problem !== undefined) return;
            router.push({ pathname: SETTINGS_ROUTE.VARIABLE_VALUE, params: { workspaceId, name } });
          },
        },
      ],
    });

  const deleteVariable = (name: string) =>
    void write(
      () =>
        acts[ACT_KIND.WORKSPACE_ENVIRONMENT_DELETE]({ workspaceId, name }).then(
          drawn<WorkspaceEnvironmentAnswer>(listKey),
        ),
      { retry: true, went: BUZZ.SUCCESS },
    );

  const saved = environment.data?.variables;

  const shownSize =
    asked ?? (size.data === undefined ? undefined : sandboxVcpusOf(String(size.data.vcpus)));

  return (
    <>
      <Screen ground={SCREEN_GROUND.GROUPED}>
        <SettingsForm>
          <ReadSection
            title={CLOUD_ENVIRONMENT_HEAD.SANDBOX}
            read={size}
            reading={readingWords("the sandbox size")}
            failed={SANDBOX_SIZE_WORDS.READ_FAILED}
            footer={() =>
              manages
                ? SANDBOX_SIZE_WORDS.CAPTION
                : `${SANDBOX_SIZE_WORDS.CAPTION} ${SANDBOX_SIZE_WORDS.LOCKED}.`
            }
            rows={() =>
              manages ? (
                <MenuPickRow
                  label={SANDBOX_SIZE_WORDS.SIZE}
                  options={SIZE_OPTIONS}
                  picked={String(shownSize ?? SANDBOX_SIZE.VCPUS)}
                  onPick={chooseSize}
                />
              ) : (
                <ValueRow
                  label={SANDBOX_SIZE_WORDS.SIZE}
                  value={sandboxSizeWords(shownSize ?? SANDBOX_SIZE.VCPUS)}
                />
              )
            }
          />
          <ReadSection
            title={CLOUD_ENVIRONMENT_HEAD.VARIABLES}
            read={environment}
            reading={readingWords("the variables")}
            failed={VARIABLE_WORDS.READ_FAILED}
            footer={({ variables }) =>
              [
                addRefusal,
                variables.length === 0 ? VARIABLE_WORDS.NONE : undefined,
                VARIABLE_WORDS.CAPTION,
              ]
                .filter((words) => words !== undefined)
                .join(" ")
            }
            add={
              manages && saved !== undefined
                ? {
                    label: VARIABLE_WORDS.ADD,
                    acts: [
                      {
                        label: VARIABLE_WORDS.ADD,
                        symbol: GLYPH.ADD,
                        onPress: () => addVariable(saved),
                      },
                    ],
                  }
                : undefined
            }
            rows={({ variables }) =>
              variables.map((variable) => (
                <NoteRow
                  key={variable.name}
                  words={variable.name}
                  detail={setByVespinNote(variable.name)}
                  line={variableLine(variable, accountId, now)}
                  remove={
                    manages
                      ? { label: VARIABLE_WORDS.DELETE, onPress: () => setDeleting(variable) }
                      : undefined
                  }
                />
              ))
            }
          />
          <ReadSection
            title={CLOUD_ENVIRONMENT_HEAD.INSTALL}
            read={setup}
            reading={readingWords("the scripts")}
            failed={CLOUD_SCRIPT_WORDS.READ_FAILED}
            footer={({ install }) =>
              install == null
                ? `${CLOUD_SCRIPT_WORDS.INSTALL_NONE} ${CLOUD_SCRIPT_WORDS.INSTALL_CAPTION}`
                : CLOUD_SCRIPT_WORDS.INSTALL_CAPTION
            }
            rows={({ install }) =>
              install == null ? null : (
                <ScriptRow
                  name={CLOUD_SCRIPT_WORDS.INSTALL_NAME}
                  script={install.script}
                  line={scriptLine(install, now)}
                />
              )
            }
          />
          <ReadSection
            title={CLOUD_ENVIRONMENT_HEAD.SETUP}
            read={setup}
            reading={readingWords("the scripts")}
            failed={CLOUD_SCRIPT_WORDS.READ_FAILED}
            footer={({ setups }) =>
              setups.length === 0
                ? `${CLOUD_SCRIPT_WORDS.SETUP_NONE} ${CLOUD_SCRIPT_WORDS.SETUP_CAPTION}`
                : CLOUD_SCRIPT_WORDS.SETUP_CAPTION
            }
            rows={({ setups }) =>
              setups.map((each) => (
                <ScriptRow
                  key={each.repository}
                  name={each.repository}
                  script={each.script}
                  line={scriptLine(each, now)}
                />
              ))
            }
          />
        </SettingsForm>
      </Screen>
      <ConfirmAsk
        title={deleting === undefined ? "" : variableDeleteTitle(deleting.name)}
        act={VARIABLE_WORDS.DELETE}
        destructive
        presented={deleting !== undefined}
        onDismiss={() => setDeleting(undefined)}
        onAct={() => {
          if (deleting === undefined) return;
          const { name } = deleting;
          setDeleting(undefined);
          deleteVariable(name);
        }}
      />
    </>
  );
}
