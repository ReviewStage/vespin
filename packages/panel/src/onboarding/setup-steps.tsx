import { PRODUCT_NAME } from "@repo/features/product-name";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { ACT_KIND } from "@repo/host/acts";
import {
  APP_SETTING_SCHEMA,
  SETUP_AUDIENCE,
  type SetupAudience,
  type SetupPlace,
  setupPlaceFrom,
  setupPlaceStored,
} from "@repo/settings";
import {
  AuthPage,
  AuthStepFoot,
  ChoiceList,
  type ChoiceOption,
  CONFIRM_LOSS,
  ConfirmConsequences,
  ConfirmDialog,
  ProductMark,
  useConfirmDialog,
} from "@repo/ui";
import { ReplayUnmask } from "@repo/ui/session-replay-marks";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Schema } from "effect";
import { useCallback, useEffect, useRef, useState } from "react";
import { actMutation } from "../act-mutations.js";
import { ANSWER_ACCEPTED, refusedWith, useConfirmAct } from "../confirm-act.js";
import { welcomed } from "../desktop/desktop-welcome.js";
import { confirmFailure } from "../failure-report.js";
import { workspaceMembersQuery } from "../live-reads.js";
import { signOutSayingFailure } from "../settings/account-section.js";
import { AgentConnectSection } from "../settings/agent-auth-section.js";
import { DELETE_WORDS } from "../settings/workspace-page.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { useHoldToasts } from "../toast.js";
import { appStateQuery, selectAppSettingsView, selectWorkspacesFailed } from "../use-app-state.js";
import { keptKey, useKept } from "../use-kept.js";
import { GITHUB_PURPOSE, GitHubSetup } from "./setup-github.js";
import { SETUP_GATE, SETUP_STEP, type SetupGate, setupGate, setupSteps } from "./setup-model.js";
import { SurveyQuestions, useSurvey } from "./setup-survey.js";
import { TeamForm, useTeamForm } from "./setup-team.js";
import { TOOLS_PURPOSE, ToolRows } from "./setup-tools.js";

/**
 * setup-steps.tsx -- a new account's setup, alone in the window after sign-in: who it is for, a few questions about the person, a team's workspace where there is one, an agent, GitHub, and the tools, one card each.
 *
 * Each card is the sign-in's own, so setup reads as the sign-in going on,
 * and each offers a quiet Sign out, since setup stands with no sidebar.
 * An account invited into a team's workspace walks the survey and Connect
 * an agent alone. An agent is required: its step goes on only once Claude or Codex
 * is connected. A team's workspace is required too, once With my team is
 * chosen, since Back leads to Just me for anyone who changed their mind;
 * once made, its step coming back holds it to change rather than make again,
 * and setup finished as Just me deletes it, asking first, in red, where
 * anyone else joined it, and offering to keep it.
 * The survey and GitHub may be skipped, and the tools need nothing done. Where setup
 * stands is kept on the account (`APP_SETTING_SCHEMA.setupPlace`), so setup
 * left partway resumes at the same step on another machine or on the web,
 * and a team's workspace made is not offered to be made again. Finish lets
 * the app in and keeps, on the account (`APP_SETTING_SCHEMA.setupFinished`),
 * that it finished setup, so it stands once on every machine.
 */

/**
 * The accounts that finished setup on this device, by id: the account's own
 * `setupFinished` read ahead of its preferences arriving.
 */
const SETUP_FINISHED = keptKey(
  "app.setupFinished",
  Schema.fromJsonString(Schema.Array(Schema.String)),
);

/**
 * What Finish asks where the team's workspace setup made and left for Just
 * me has anyone else in it, or had: its title, the people named, and its two
 * ways on, the delete in red and a keep that finishes all the same.
 */
const TEAM_DELETE_WORDS = {
  TITLE: (name: string) => `Delete ${name}?`,
  BODY: "You chose Just me. Others joined it, so deleting it deletes it for them too. This can't be undone.",
  JOINED: (names: readonly string[]) => `${NAMES_LISTED.format(names)} joined it.`,
  VERB: "Delete and finish",
  KEEP: "Keep it and finish",
  RUNNING: "Deleting",
  /** The workspace's name where the window's list no longer holds it. */
  UNNAMED: "your team workspace",
} as const;

/** People named in a sentence, "Ana, Bo, and Cy". */
const NAMES_LISTED = new Intl.ListFormat("en", { type: "conjunction" });

/** Where setup starts, for an account of its own or one a team invited. */
const SETUP_START: SetupPlace = { audience: SETUP_AUDIENCE.ME, at: 0 };
const INVITED_START: SetupPlace = { audience: SETUP_AUDIENCE.INVITED, at: 0 };

/** Whether the account belongs to a team's workspace; nothing before its workspaces are read, and none where that read failed. */
function invitedOf(tasks: TasksControl, workspacesFailed: boolean): boolean | undefined {
  const { workspaces } = tasks.newTask;

  if (workspaces.length === 0) return workspacesFailed ? false : undefined;

  return workspaces.some((workspace) => workspace.personal !== true);
}

/**
 * What the window does about setup for the account signed in (`setupGate`):
 * it reads whether an agent is connected, asking for the models where no
 * read has, only for an account that could still be new.
 */
export function useSetupGate(
  tasks: TasksControl,
  accountId: string | undefined,
  /** Whether setup was finished in this window, before the account's setting comes back from its write. */
  finishedHere: boolean,
): SetupGate {
  const [finishedOnDevice] = useKept(SETUP_FINISHED, []);
  const [startedHere, setStartedHere] = useState<string>();
  const settings = useQuery({ ...appStateQuery, select: selectAppSettingsView }).data;

  const workspacesFailed =
    useQuery({ ...appStateQuery, select: selectWorkspacesFailed }).data === true;

  const finishedOnAccount = settings?.setupFinished === true;

  // Note that this device's own record stands beside the account's, because the account's arrives only once its preferences are read, and a device clears them at every sign-out.
  const finished =
    finishedHere ||
    finishedOnAccount ||
    (accountId !== undefined && finishedOnDevice.includes(accountId));

  // Note that the models are the ones the host holds for the account, so nothing here asks for them.
  const { models, modelsFailed } = tasks.newTask;
  const fresh = welcomed(tasks);

  // Note that a read that failed is taken as an agent standing, so a hitch never stands setup before an account that has worked.
  const agent =
    models !== undefined
      ? models.some((model) => model.credentialMissing !== true)
      : modelsFailed
        ? true
        : undefined;

  const gate = setupGate({
    id: accountId,
    fresh,
    finished,
    accountRead: settings?.accountRead === true,
    // Note that the place is the account's, so setup started on another machine stands here once its preferences are read.
    started:
      accountId !== undefined &&
      (startedHere === accountId || setupPlaceFrom(settings?.setupPlace) !== undefined),
    invited: invitedOf(tasks, workspacesFailed),
    agent,
  });

  // Setup once standing in this window stays until finished, whatever it connects meanwhile, though the account keeps its place only from its first move.
  useEffect(() => {
    if (gate === SETUP_GATE.OWED && accountId !== undefined) setStartedHere(accountId);
  }, [gate, accountId]);

  return gate;
}

const AUDIENCES: readonly ChoiceOption<SetupAudience>[] = [
  { value: SETUP_AUDIENCE.ME, label: "Just me" },
  { value: SETUP_AUDIENCE.TEAM, label: "With my team" },
];

/**
 * Setup, step by step; `onFinish` lets the app in. Note that its words show
 * in a screen recording, because they are the app's own, but for a person's,
 * which each step masks where it draws them. The window's toasts wait until
 * it finishes, because on a phone they stand over each step's foot, and a
 * connection whose sign-in lapsed is reconnected in place on its steps.
 */
export function SetupSteps(props: SetupStepsProps): React.JSX.Element {
  useHoldToasts();

  return (
    <ReplayUnmask>
      <SetupStep {...props} />
    </ReplayUnmask>
  );
}

/** What setup is handed. */
interface SetupStepsProps {
  tasks: TasksControl;
  /** The account set up, whose finish this device keeps under its id. */
  accountId: string;
  onFinish: () => void;
}

/** The step setup stands at. */
function SetupStep({ tasks, accountId, onFinish }: SetupStepsProps): React.JSX.Element {
  const { mutate: updateSetting } = useMutation(actMutation(ACT_KIND.SETTING_UPDATE));
  const { mutateAsync: signOut } = useMutation(actMutation(ACT_KIND.ACCOUNT_SIGN_OUT));

  // Note that a refused or failed delete is logged on the mutation rather than the call, because Finish has let the app in and setup is gone by the time it answers.
  const { mutate: deleteWorkspace } = useMutation({
    ...actMutation(ACT_KIND.WORKSPACE_DELETE),
    onError: (error) => console.warn("Setup's team workspace was left standing.", error),
  });

  const { mutateAsync: sendTeamDelete, ...deletingTeam } = useMutation(
    actMutation(ACT_KIND.WORKSPACE_DELETE),
  );

  const [, , keepFinished] = useKept(SETUP_FINISHED, []);
  const stored = useQuery({ ...appStateQuery, select: selectAppSettingsView }).data?.setupPlace;
  const kept = setupPlaceFrom(stored);

  const workspacesFailed =
    useQuery({ ...appStateQuery, select: selectWorkspacesFailed }).data === true;

  // Note that where setup starts is decided as it first stands, so a team's workspace made midway keeps the steps it was making.
  const start = invitedOf(tasks, workspacesFailed) === true ? INVITED_START : SETUP_START;
  const place = kept ?? start;
  const { audience, team } = place;
  const personal = tasks.newTask.workspaces.find((workspace) => workspace.personal === true)?.id;
  // Note that each move is merged over the last one written, because two may land before the account's place comes back, as a team's workspace made and the step after it do.
  const written = useRef<SetupPlace | undefined>(undefined);
  useEffect(() => {
    written.current = setupPlaceFrom(stored);
  }, [stored]);

  const keep = useCallback(
    (next: SetupPlace) => {
      written.current = next;
      updateSetting({ field: APP_SETTING_SCHEMA.setupPlace.field, value: setupPlaceStored(next) });
    },
    [updateSetting],
  );

  // Note that the place is first kept on the first move rather than as setup opens, because a preferences read that failed lets setup open without the account's place, and nothing written unasked may then put back another machine's.
  const move = (change: Partial<SetupPlace>) => keep({ ...(written.current ?? place), ...change });

  // A team's workspace made stands listed only while setup is for the team, so Just me goes back to the account's own.
  const setAudience = (chosen: SetupAudience) => {
    move({ audience: chosen });
    const listed = chosen === SETUP_AUDIENCE.TEAM ? team : personal;

    if (team !== undefined && listed !== undefined) tasks.onChooseWorkspace(listed);
  };

  const setAt = (step: number) => move({ at: step });
  const [agent, setAgent] = useState(false);
  const [reached, setReached] = useState(false);
  const onConnected = useCallback((connected: boolean) => setAgent(connected), []);
  const onReached = useCallback((now: boolean) => setReached(now), []);
  const survey = useSurvey();
  const steps = setupSteps(audience);
  // A place kept by another window or an earlier build may stand past the last step, which is held to it.
  const at = Math.min(Math.max(place.at, 0), steps.length - 1);
  const step = steps[at] ?? SETUP_STEP.TOOLS;
  const last = at === steps.length - 1;
  // The team's workspace setup made and then left for Just me, which Finish deletes or asks about; none otherwise.
  const leftTeam = audience === SETUP_AUDIENCE.ME ? team : undefined;

  const leftRead = useQuery({
    ...workspaceMembersQuery(leftTeam),
    enabled: leftTeam !== undefined && last,
  });

  const leftMembers = leftRead.data;
  // Note that Finish waits on the members, because a read still under way would skip the question; a read that failed lets it go on to the delete the service refuses where anyone else is in it, so setup is never stood still.
  const leftUnread = leftTeam !== undefined && leftMembers === undefined && !leftRead.isError;

  // Note that whoever left it is named too, because their agents and tasks may still stand in it.
  const joined =
    leftMembers === undefined
      ? []
      : [
          ...leftMembers.members.filter((member) => member.userId !== accountId),
          ...(leftMembers.former ?? []),
        ].map((member) => member.name);

  const teamDeleteAct = useConfirmAct(deletingTeam, {
    send: () =>
      leftTeam === undefined
        ? Promise.resolve()
        : sendTeamDelete({ workspaceId: leftTeam }).then(finishNow),
    answered: () => ANSWER_ACCEPTED,
    failed: refusedWith,
  });

  const teamDelete = useConfirmDialog(
    { subject: leftTeam !== undefined, surfaceOpen: last },
    teamDeleteAct,
    confirmFailure(FAILURE_SURFACE.WORKSPACE_DELETE),
  );

  // Note that a team's workspace made and then left for Just me is deleted only at Finish, where Just me is final. One nobody else joined goes without a word, while the service still finds nobody else in it and no agent, rather than this window's list, and stays as made where it is refused or fails; one anyone joined asks first, in red, and may be kept.
  const finish = () => {
    if (leftTeam === undefined) return finishNow();

    if (joined.length > 0) return teamDelete.ask();
    deleteWorkspace({ workspaceId: leftTeam, ifAlone: true });
    finishNow();
  };

  function finishNow(): void {
    // Note that the account's place stands once finished, since finished is read ahead of it on every machine.
    // Note that nothing waits on the write: the window lets the app in at once, and a write lost asks for setup again next time.
    updateSetting({ field: APP_SETTING_SCHEMA.setupFinished.field, value: true });
    keepFinished((finished) => [...finished, accountId]);
    onFinish();
  }

  const forward = () => (last ? finish() : setAt(at + 1));
  const back = at === 0 ? undefined : () => setAt(at - 1);

  // A team's workspace made and then left for Just me is not the one GitHub is installed on.
  const workspaceId =
    (audience === SETUP_AUDIENCE.TEAM ? team : personal) ?? tasks.newTask.workspaceId;

  // Note that a skippable step offers Skip until done and Continue after it; the team's draws its own foot.
  const foot = (done: boolean, label = "Continue", skippable = false) => (
    <AuthStepFoot
      at={at + 1}
      total={steps.length}
      onBack={back}
      onSkip={skippable && !done ? forward : undefined}
      next={done || !skippable ? { label, onPress: forward, disabled: !done } : undefined}
    />
  );

  const exit = {
    label: "Sign out",
    onPress: () =>
      void signOutSayingFailure(async () => {
        await signOut();
      }),
  };

  const teamForm = useTeamForm({
    made:
      team === undefined
        ? undefined
        : { id: team, name: tasks.newTask.workspaces.find((one) => one.id === team)?.name },
    onCreated: (made) => {
      move({ team: made });
      tasks.onChooseWorkspace(made);
    },
    // Note that the step stays where something was refused, so each refusal is read beside its address.
    onDone: (failed) => {
      if (failed.length === 0) setAt(at + 1);
    },
  });

  if (step === SETUP_STEP.WELCOME) {
    return (
      <AuthPage
        mark={<ProductMark />}
        exit={exit}
        title={`Welcome to ${PRODUCT_NAME}`}
        foot={foot(true)}
      >
        <ChoiceList
          legend="Who you'll use it with"
          options={AUDIENCES}
          value={[audience]}
          onChange={([chosen]) => {
            if (chosen !== undefined) setAudience(chosen);
          }}
        />
      </AuthPage>
    );
  }

  if (step === SETUP_STEP.SURVEY) {
    return (
      <AuthPage
        mark={<ProductMark />}
        exit={exit}
        title="Tell us about yourself"
        foot={
          <AuthStepFoot
            at={at + 1}
            total={steps.length}
            onBack={back}
            onSkip={survey.answered ? undefined : forward}
            next={
              survey.answered
                ? {
                    label: "Continue",
                    onPress: () => {
                      survey.keep();
                      forward();
                    },
                  }
                : undefined
            }
          />
        }
      >
        <SurveyQuestions survey={survey} />
      </AuthPage>
    );
  }

  if (step === SETUP_STEP.TEAM) {
    // Note that the press makes the workspace until it stands, then saves what was changed in it, or goes on.
    return (
      <AuthPage
        mark={<ProductMark />}
        exit={exit}
        title={team === undefined ? "Create a team workspace" : "Your team workspace"}
        foot={
          <AuthStepFoot
            at={at + 1}
            total={steps.length}
            onBack={teamForm.busy ? undefined : back}
            next={{
              label: teamForm.label,
              onPress: teamForm.create,
              disabled: !teamForm.ready,
              busy: teamForm.busy,
              busyLabel: teamForm.busyLabel,
            }}
          />
        }
      >
        <TeamForm form={teamForm} disabled={teamForm.busy} />
      </AuthPage>
    );
  }

  if (step === SETUP_STEP.AGENT) {
    return (
      <AuthPage
        mark={<ProductMark />}
        exit={exit}
        title="Connect an agent"
        description="Set up a plan or an API key. Pick which one new agents use."
        foot={foot(agent, last ? "Finish" : "Continue")}
      >
        <AgentConnectSection onConnected={onConnected} />
      </AuthPage>
    );
  }

  if (step === SETUP_STEP.GITHUB) {
    return (
      <AuthPage
        mark={<ProductMark />}
        exit={exit}
        title="Connect GitHub"
        description={GITHUB_PURPOSE}
        foot={foot(reached, "Continue", true)}
      >
        {workspaceId === undefined ? null : (
          <GitHubSetup key={workspaceId} workspaceId={workspaceId} onReached={onReached} />
        )}
      </AuthPage>
    );
  }

  const teamName =
    tasks.newTask.workspaces.find((one) => one.id === leftTeam)?.name ?? TEAM_DELETE_WORDS.UNNAMED;

  return (
    <>
      <AuthPage
        mark={<ProductMark />}
        title="Connect your tools"
        description={TOOLS_PURPOSE}
        foot={foot(!leftUnread, "Finish")}
        exit={exit}
      >
        <ToolRows />
      </AuthPage>
      <ConfirmDialog
        open
        confirm={teamDelete}
        other={{ verb: TEAM_DELETE_WORDS.KEEP, onPress: finishNow }}
        question={{
          title: TEAM_DELETE_WORDS.TITLE(teamName),
          body: TEAM_DELETE_WORDS.BODY,
          verb: TEAM_DELETE_WORDS.VERB,
          running: TEAM_DELETE_WORDS.RUNNING,
          loss: CONFIRM_LOSS.IRREVERSIBLE,
          replayUnmasked: true,
          titleReplayMasked: true,
        }}
      >
        <ConfirmConsequences
          lines={[
            TEAM_DELETE_WORDS.JOINED(joined),
            DELETE_WORDS.GONE,
            DELETE_WORDS.AGENTS,
            DELETE_WORDS.INSTALLED,
          ]}
        />
      </ConfirmDialog>
    </>
  );
}
