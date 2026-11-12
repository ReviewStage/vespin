import {
  CONDUCTOR_IMPORT_FAILURE,
  CONDUCTOR_IMPORT_KIND,
  CONDUCTOR_IMPORT_REFUSAL,
  CONDUCTOR_IMPORT_STATUS,
  type ConductorImportFailure,
  type ConductorImportItem,
  type ConductorImportProgressAnswer,
  type ConductorImportRefusal,
} from "@repo/features/conductor-import-wire";
import { LINK_DESTINATION, linkOf } from "@repo/features/link-grammar";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { managesWorkspace } from "@repo/features/workspace-role";
import type { Workspace } from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import {
  BUTTON_VARIANT,
  Button,
  Inline,
  OutsideLink,
  PROGRESS_WIDTH,
  Progress,
  SecretField,
  SettingsBlock,
  SettingsLine,
  SettingsRow,
  SettingsSection,
  Stack,
  TEXT_LINK_LOOK,
  TextLink,
} from "@repo/ui";
import { rejectionWords, useAsyncAction } from "@repo/ui/use-async-action";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { actFailureWords, askAct, sendAct } from "../act.js";
import { refusedShown } from "../failure-report.js";
import { QUERY_ROOT } from "../query-keys.js";
import { useOpenLink } from "../tasks/use-open-link.js";
import { usePageFocused } from "../use-page-focused.js";
import { ReadFailed, replayMaskedError } from "./marks.js";

/**
 * conductor-import-section.tsx -- Settings › Cloud environment's Conductor: one Conductor key pasted, its workspaces and chats imported as tasks and agents, and the run's progress read until it ends.
 *
 * A paste checks the key (`conductorImport.check`), which says how many
 * workspaces it sees and which of their repositories the workspace's GitHub
 * App does not reach yet; an owner or admin is offered GitHub's own page to
 * add them, and the key is checked again once the window has the focus back.
 * Import begins the run (`conductorImport.run`), which goes on on the service
 * if the page is closed, and the section reads the caller's newest run while
 * any of it is queued, its tasks listed as links once each lands.
 *
 * The key is held in this section's state alone: it is handed to the check
 * and the run as an act's payload and kept by no query, mutation, or store,
 * and dropped once the run begins. Its field is a `SecretField`, masked on
 * screen and in session replay as every word of the panel is.
 */

/** How often a run still queued is read again. */
const PROGRESS_POLL_MS = 3_000;

/** Where a Conductor key is made. */
const CONDUCTOR_KEYS_URL = "https://app.conductor.build/home/api-keys";

/** What a refusal of Conductor's says. */
const REFUSAL_WORDS = {
  [CONDUCTOR_IMPORT_REFUSAL.BAD_KEY]: "Conductor refused that key.",
  [CONDUCTOR_IMPORT_REFUSAL.RATE_LIMITED]:
    "Conductor asked us to slow down. Try again in a minute.",
  [CONDUCTOR_IMPORT_REFUSAL.UNAVAILABLE]: "Conductor did not answer. Try again in a minute.",
} as const satisfies Record<ConductorImportRefusal, string>;

/** Why one workspace or chat was not imported. */
const FAILURE_WORDS = {
  [CONDUCTOR_IMPORT_FAILURE.REPOSITORY_UNREACHED]: "Its repository isn't connected to Vespin",
  [CONDUCTOR_IMPORT_FAILURE.CONDUCTOR_REFUSED]: "Conductor refused the key or no longer has it",
  [CONDUCTOR_IMPORT_FAILURE.CONDUCTOR_UNAVAILABLE]: "Conductor did not answer",
  [CONDUCTOR_IMPORT_FAILURE.TASK_NOT_MADE]: "Its task could not be made",
  [CONDUCTOR_IMPORT_FAILURE.TASK_GONE]: "Its task was deleted since an earlier import",
  [CONDUCTOR_IMPORT_FAILURE.CHAT_NOT_WRITTEN]: "Its transcript could not be written",
  [CONDUCTOR_IMPORT_FAILURE.RUN_EXPIRED]: "The import expired before it was reached",
} as const satisfies Record<ConductorImportFailure, string>;

/** What a check found: how many workspaces the key sees, and the repositories not reached yet. */
interface Checked {
  readonly workspaces: number;
  readonly unreachedRepositories: readonly string[];
}

/** The caller's newest run in the workspace, read as the page opens and again while any of it is queued. */
function progressQuery(workspaceId: string) {
  return queryOptions({
    queryKey: [QUERY_ROOT.CONDUCTOR_IMPORT, workspaceId],
    queryFn: () => askAct(ACT_KIND.WORKSPACE_CONDUCTOR_IMPORT_PROGRESS, { workspaceId }),
    retry: false,
    refetchInterval: (query) => {
      const run = query.state.data?.run;

      return run !== undefined && run !== null && !run.ended ? PROGRESS_POLL_MS : false;
    },
  });
}

/** "1 workspace", "3 chats". */
function counted(count: number, one: string, many: string): string {
  return `${count.toLocaleString()} ${count === 1 ? one : many}`;
}

/** How many of a kind are still queued and how many there are. */
function tally(items: readonly ConductorImportItem[], kind: ConductorImportItem["kind"]) {
  const ofKind = items.filter((item) => item.kind === kind);
  const queued = ofKind.filter((item) => item.status === CONDUCTOR_IMPORT_STATUS.QUEUED).length;

  return { total: ofKind.length, settled: ofKind.length - queued };
}

/** A workspace's row's line: its chats, and why it or any of them failed. */
function workspaceLine(
  workspace: ConductorImportItem,
  chats: readonly ConductorImportItem[],
): string {
  if (workspace.failure !== null) return FAILURE_WORDS[workspace.failure];

  if (workspace.status === CONDUCTOR_IMPORT_STATUS.QUEUED) return "Importing";

  const failed = chats.filter((chat) => chat.failure !== null);
  const queued = chats.some((chat) => chat.status === CONDUCTOR_IMPORT_STATUS.QUEUED);
  const parts = [counted(chats.length, "chat", "chats")];

  if (queued) parts.push("importing");

  for (const chat of failed) {
    // Note that the failure is never null here, since the filter kept only those with one.
    if (chat.failure !== null)
      parts.push(`${chat.name ?? "A chat"}: ${FAILURE_WORDS[chat.failure]}`);
  }

  return parts.join(" · ");
}

/** One workspace of the run: its task as a link once it has one, and its chats. */
function ImportedWorkspaceRow({
  workspace,
  chats,
  slug,
}: {
  workspace: ConductorImportItem;
  chats: readonly ConductorImportItem[];
  slug: string;
}): React.JSX.Element {
  const openLink = useOpenLink();
  const name = workspace.name ?? "Untitled workspace";

  const href =
    workspace.taskId === null
      ? undefined
      : linkOf({ kind: LINK_DESTINATION.TASK, planId: workspace.taskId }, slug);

  return (
    <SettingsRow
      label={
        href === undefined ? (
          name
        ) : (
          <TextLink
            look={TEXT_LINK_LOOK.UNDERLINED}
            href={href}
            onClick={(event) => {
              event.preventDefault();
              openLink(href);
            }}
          >
            {name}
          </TextLink>
        )
      }
      description={workspaceLine(workspace, chats)}
    />
  );
}

/** The run's progress, its bar while any of it is queued, and each workspace it took. */
function RunProgress({
  run,
  slug,
}: {
  run: NonNullable<ConductorImportProgressAnswer["run"]>;
  slug: string;
}): React.JSX.Element {
  const workspaces = tally(run.items, CONDUCTOR_IMPORT_KIND.WORKSPACE);
  const chats = tally(run.items, CONDUCTOR_IMPORT_KIND.CHAT);
  const total = workspaces.total + chats.total;
  const percent = total === 0 ? 100 : ((workspaces.settled + chats.settled) / total) * 100;

  const summary = run.ended
    ? `Imported ${counted(workspaces.total, "workspace", "workspaces")} and ${counted(chats.total, "chat", "chats")}.`
    : `${workspaces.settled.toLocaleString()} of ${counted(workspaces.total, "workspace", "workspaces")}, ${chats.settled.toLocaleString()} of ${counted(chats.total, "chat", "chats")}. It goes on if you close Settings.`;

  return (
    <>
      <SettingsRow
        label={run.ended ? "Import finished" : "Importing from Conductor"}
        description={summary}
        below={
          run.ended
            ? undefined
            : () => (
                <Progress
                  value={percent}
                  label="Importing from Conductor"
                  width={PROGRESS_WIDTH.FILL}
                />
              )
        }
      />
      {run.items
        .filter((item) => item.kind === CONDUCTOR_IMPORT_KIND.WORKSPACE)
        .map((workspace) => (
          <ImportedWorkspaceRow
            key={workspace.conductorId}
            workspace={workspace}
            chats={run.items.filter(
              (item) =>
                item.kind === CONDUCTOR_IMPORT_KIND.CHAT &&
                item.workspaceConductorId === workspace.conductorId,
            )}
            slug={slug}
          />
        ))}
    </>
  );
}

/** The repositories the workspace's GitHub App does not reach yet, with GitHub's page to add them for an owner or admin. */
function UnreachedRepositories({
  workspace,
  repositories,
  onOpened,
}: {
  workspace: Workspace;
  repositories: readonly string[];
  /** Hears that GitHub's page opened, so the key is checked again on the way back. */
  onOpened: () => void;
}): React.JSX.Element {
  const manages = managesWorkspace(workspace);
  const opening = useAsyncAction(rejectionWords);

  const open = () =>
    void opening.run(() =>
      sendAct(ACT_KIND.WORKSPACE_GITHUB_CONNECT, { workspaceId: workspace.id }).then(() => {
        onOpened();
      }),
    );

  return (
    <SettingsRow
      label={`Add ${counted(repositories.length, "repository", "repositories")} to Vespin's GitHub App`}
      description={`${repositories.join(", ")}. ${
        manages
          ? "Their workspaces are skipped until the App reaches them."
          : "Ask an owner or admin of this workspace to add them, or their workspaces are skipped."
      }`}
      error={replayMaskedError(refusedShown(opening.refusal, FAILURE_SURFACE.WORKSPACE_GITHUB))}
    >
      {() =>
        manages ? (
          <Button
            variant={BUTTON_VARIANT.OUTLINE}
            busy={opening.running}
            busyLabel="Opening"
            onClick={open}
          >
            Open GitHub
          </Button>
        ) : null
      }
    </SettingsRow>
  );
}

/** Settings › Cloud environment's Conductor over one workspace. */
export function ConductorImportSection({ workspace }: { workspace: Workspace }): React.JSX.Element {
  const openLink = useOpenLink();
  const progress = useQuery(progressQuery(workspace.id));
  const [apiKey, setApiKey] = useState("");
  const [checked, setChecked] = useState<Checked | undefined>(undefined);
  const checking = useAsyncAction(actFailureWords);
  const starting = useAsyncAction(actFailureWords);
  const awayOnGitHub = useRef(false);
  const focused = usePageFocused();
  const run = progress.data?.run ?? null;
  const running = run !== null && !run.ended;

  const check = (key: string) => {
    setChecked(undefined);

    if (key.trim() === "") return;

    void checking.run(async () => {
      const answer = await askAct(ACT_KIND.WORKSPACE_CONDUCTOR_IMPORT_CHECK, {
        workspaceId: workspace.id,
        apiKey: key.trim(),
      });

      if ("refused" in answer) return REFUSAL_WORDS[answer.refused];
      setChecked(answer);

      return undefined;
    });
  };

  const checkAgain = useEffectEvent(() => check(apiKey));

  // Note that the key is checked again as the window comes back from GitHub's page, so the repositories just added leave the list.
  useEffect(() => {
    if (!focused || !awayOnGitHub.current) return;
    awayOnGitHub.current = false;
    checkAgain();
  }, [focused]);

  const start = () =>
    void starting.run(async () => {
      const answer = await sendAct(ACT_KIND.WORKSPACE_CONDUCTOR_IMPORT_RUN, {
        workspaceId: workspace.id,
        apiKey: apiKey.trim(),
      });

      if ("refused" in answer) return REFUSAL_WORDS[answer.refused];
      // The run holds its own sealed copy of the key, so this one is let go at once.
      setApiKey("");
      setChecked(undefined);
      await progress.refetch();

      return undefined;
    });

  const keyError = checking.refusal ?? starting.refusal;

  return (
    <SettingsSection
      title="Import from Conductor"
      caption="Bring your team's Conductor workspaces and chats over, archived ones included. Each workspace becomes a task and each chat an agent with its whole transcript, and repository scripts come with them."
    >
      {running ? null : (
        <SettingsBlock>
          <Stack>
            <SecretField
              label="Conductor API key"
              description={
                <>
                  A personal or team key.{" "}
                  <OutsideLink href={CONDUCTOR_KEYS_URL} open={openLink}>
                    Make one in Conductor
                  </OutsideLink>
                </>
              }
              placeholder="Paste a key"
              value={apiKey}
              disabled={starting.running}
              error={replayMaskedError(
                refusedShown(keyError, FAILURE_SURFACE.WORKSPACE_CONDUCTOR_IMPORT),
              )}
              onChange={(next) => {
                setApiKey(next);
                setChecked(undefined);
                checking.clear();
                starting.clear();
              }}
              onPasted={check}
              onEnter={() => check(apiKey)}
            />
            {checked === undefined ? (
              <Inline>
                <Button
                  variant={BUTTON_VARIANT.OUTLINE}
                  busy={checking.running}
                  busyLabel="Checking"
                  disabled={apiKey.trim() === ""}
                  onClick={() => check(apiKey)}
                >
                  Check key
                </Button>
              </Inline>
            ) : null}
          </Stack>
        </SettingsBlock>
      )}
      {checked === undefined || running ? null : (
        <SettingsLine>
          {checked.workspaces === 0
            ? "That key sees no workspaces."
            : `${counted(checked.workspaces, "workspace", "workspaces")} ready to import, with their chats.`}
        </SettingsLine>
      )}
      {checked === undefined || running || checked.unreachedRepositories.length === 0 ? null : (
        <UnreachedRepositories
          workspace={workspace}
          repositories={checked.unreachedRepositories}
          onOpened={() => {
            awayOnGitHub.current = true;
          }}
        />
      )}
      {checked === undefined || running || checked.workspaces === 0 ? null : (
        <SettingsBlock>
          <Inline>
            <Button
              variant={BUTTON_VARIANT.PRIMARY}
              busy={starting.running}
              busyLabel="Starting"
              onClick={start}
            >
              {`Import ${counted(checked.workspaces, "workspace", "workspaces")}`}
            </Button>
          </Inline>
        </SettingsBlock>
      )}
      {progress.isError ? (
        <ReadFailed
          line="The import from Conductor could not be read."
          surface={FAILURE_SURFACE.WORKSPACE_CONDUCTOR_IMPORT}
          onRetry={() => void progress.refetch()}
        />
      ) : run === null ? null : (
        <RunProgress run={run} slug={workspace.slug ?? workspace.id} />
      )}
    </SettingsSection>
  );
}
