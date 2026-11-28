// setup-screens.tsx -- a new account's setup, alone in the app after sign-in, one screen per step of setup's stack: who it is for, a few questions about the person, a team's workspace where there is one, an agent, GitHub, and the tools, as the panel's setup walks them.

import { LINK_PAGE } from "@repo/features/link-home";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { ACT_UNREACHED_WORDS } from "@repo/features/words";
import { ACT_KIND } from "@repo/host/acts";
import { selectWorkspaces } from "@repo/host/app-state-reads";
import {
  APP_SETTING_SCHEMA,
  SETUP_AUDIENCE,
  SETUP_STEP,
  type SetupAudience,
  type SetupStep,
  SURVEY_OPTIONS,
  SURVEY_OTHER,
  SURVEY_OTHER_MAX_CHARS,
  SURVEY_QUESTION,
  type SurveyOption,
  surveyInOfferedOrder,
} from "@repo/settings";
import {
  ActionRow,
  EmptyState,
  FOOTER_TONE,
  footerToneOf,
  GLYPH,
  glyphSymbol,
  ListSection,
  PickRows,
  SCREEN_GROUND,
  Screen,
  SettingsForm,
  useAsyncAction,
  useColors,
  ValueRow,
  WORDS_LOOK,
  WordsField,
} from "@repo/ui-native";
import { actionRefused } from "@repo/wire";
import { useQuery } from "@tanstack/react-query";
import { Redirect, Stack, useFocusEffect, useNavigation, useRouter } from "expo-router";
import { type ReactNode, useCallback, useEffectEvent, useState } from "react";
import {
  AgentKeySections,
  agentConnected,
  useAgentKeyRemoval,
  useAgentKeys,
} from "../agent-keys/agent-keys.js";
import { useChosenWorkspace } from "../chosen-workspace.js";
import { GitHubSection } from "../github/github-connection.js";
import { appStateQuery } from "../host/app-state-query.js";
import { useHostActs } from "../host/host-provider.js";
import {
  askNewTaskAfterSetup,
  letGoNewTaskAfterSetup,
  SETUP_STEP_ROUTE,
  type SetupPlaceRead,
  useSetupPlace,
} from "../setup/setup-place.js";
import { useSurvey } from "../setup/use-survey.js";
import { useSignOut } from "../sign-out.js";
import { useWorkspaceRepositories } from "../tasks/use-start.js";
import { useUsageDataSwitch } from "../usage-data-switch.js";
import { useWrite } from "../use-write.js";

/** Setup's words, as the panel's setup says them. */
const WORDS = {
  READING: "Reading your account",
  WELCOME: `Welcome to ${PRODUCT_NAME}`,
  AUDIENCE: "Who you'll use it with",
  SURVEY: "Tell us about yourself",
  OTHER: "Tell us more",
  TEAM_NEW: "Create a team workspace",
  TEAM_MADE: "Your team workspace",
  TEAM_NAME: "Team name",
  WORKSPACE: "Workspace",
  AGENT: "Connect an agent",
  AGENT_PURPOSE: "Set up a plan or an API key.",
  GITHUB: "Connect GitHub",
  TOOLS: "Connect your tools",
  TOOLS_PURPOSE:
    "Agents read and update Linear, Slack, Sentry, and Notion with your own access. Connect them anytime in Settings › Integrations.",
  USAGE_DATA: "Usage data",
  // Note that these keep to `PRIVACY.md`'s words for the iOS app, which records nothing, so they name no recordings as the desktop's and the web's do.
  USAGE_DATA_NOTE: `${PRODUCT_NAME} collects counts of the features you use, and error and crash reports. This app's counts and crash reports are anonymous: they never name your account.`,
  PRIVACY_POLICY: "Privacy policy",
  CONTINUE: "Continue",
  SKIP: "Skip",
  FINISH: "Finish",
  CREATE: "Create",
  CREATING: "Creating",
  BACK: "Back",
  SIGN_OUT: "Sign out",
} as const;

/** Who setup's first step offers it is for. */
const AUDIENCES = [
  { id: SETUP_AUDIENCE.ME, label: "Just me" },
  { id: SETUP_AUDIENCE.TEAM, label: "With my team" },
] as const satisfies readonly { id: SetupAudience; label: string }[];

/** What a flow finds the team's name field by. */
const TEAM_NAME_FIELD_ID = "setup-team-name";

type Said = { words?: string };

/** The press a step's bar ends with: its way on, filled, or Skip, plain, for a step that may be left. */
interface StepPress {
  readonly label: string;
  readonly onPress: () => void;
  readonly disabled?: boolean | undefined;
  readonly skip?: boolean | undefined;
}

/** The workspace setup works in: the team's it made while it is for a team, else the account's own, else the one the phone works in; and the choice of another. */
function useSetupWorkspace(read: SetupPlaceRead) {
  const { data: workspaces = [] } = useQuery({ ...appStateQuery, select: selectWorkspaces });
  const { chosen, choose } = useChosenWorkspace(workspaces);
  const personal = workspaces.find((workspace) => workspace.personal === true)?.id;
  const { audience, team } = read.place;

  return {
    workspaces,
    personal,
    choose,
    // A team's workspace made and then left for Just me is not the one GitHub is installed on.
    workspaceId: (audience === SETUP_AUDIENCE.TEAM ? team : personal) ?? chosen?.id,
  };
}

/**
 * What usage data the app sends, on setup's first step, with Settings ›
 * Account's own switch under it and a link to the privacy policy: a notice
 * rather than a question, as the panel's setup says it, so the switch stands
 * as it is set and turning it off here turns it off in Settings.
 */
function UsageDataSection() {
  const usage = useUsageDataSwitch();

  return (
    <ListSection
      title={WORDS.USAGE_DATA}
      footer={usage.refusal ?? WORDS.USAGE_DATA_NOTE}
      footerTone={footerToneOf(usage.refusal)}
      footerLink={{ label: WORDS.PRIVACY_POLICY, address: LINK_PAGE.PRIVACY }}
    >
      {usage.row}
    </ListSection>
  );
}

/** Sign out, alone at the foot of setup's first step, since setup stands with no Settings to sign out from. */
function SignOutSection() {
  const signOut = useSignOut();

  return (
    <ListSection>
      <ActionRow label={WORDS.SIGN_OUT} destructive centered onPress={() => void signOut()} />
    </ListSection>
  );
}

/**
 * A step's frame: its title in the bar, its way on at the bar's end, and its
 * rows in a form, usage data and Sign out at the foot of the first, Welcome
 * or an invited account's survey alike. Back is the stack's own;
 * a step setup resumed at, with no step under it, offers a Back of its own,
 * which stands the step before in its place.
 */
function StepFrame({
  read,
  at,
  title,
  subtitle,
  press,
  children,
}: {
  readonly read: SetupPlaceRead;
  readonly at: number;
  readonly title: string;
  readonly subtitle?: string | undefined;
  readonly press: StepPress;
  readonly children: ReactNode;
}) {
  const colors = useColors();
  const router = useRouter();
  const navigation = useNavigation();
  const before = read.steps[at - 1];

  return (
    <>
      <Stack.Screen options={{ title }} />
      {navigation.canGoBack() || before === undefined ? null : (
        <Stack.Toolbar placement="left">
          <Stack.Toolbar.Button
            icon={glyphSymbol(GLYPH.BACK)}
            accessibilityLabel={WORDS.BACK}
            onPress={() => router.replace({ pathname: SETUP_STEP_ROUTE, params: { step: before } })}
          >
            {WORDS.BACK}
          </Stack.Toolbar.Button>
        </Stack.Toolbar>
      )}
      <Stack.Toolbar placement="right">
        {press.skip === true ? (
          <Stack.Toolbar.Button onPress={press.onPress}>{press.label}</Stack.Toolbar.Button>
        ) : (
          <Stack.Toolbar.Button
            variant="prominent"
            tintColor={colors.ACCENT}
            disabled={press.disabled === true}
            onPress={press.onPress}
          >
            {press.label}
          </Stack.Toolbar.Button>
        )}
      </Stack.Toolbar>
      <Screen ground={SCREEN_GROUND.GROUPED} subtitle={subtitle}>
        <SettingsForm>
          {children}
          {at === 0 ? (
            <>
              <UsageDataSection />
              <SignOutSection />
            </>
          ) : null}
        </SettingsForm>
      </Screen>
    </>
  );
}

/** What each step is handed: where setup stands, the step's place among its steps, and the way on to the next. */
interface StepProps {
  readonly read: SetupPlaceRead;
  readonly at: number;
  readonly forward: () => void;
}

/** Who setup is for, as the panel's first card asks it. Note that a team's workspace already made stands chosen only while setup is for the team, so Just me goes back to the account's own. */
function WelcomeStep({ read, at, forward }: StepProps) {
  const { personal, choose } = useSetupWorkspace(read);
  const { audience, team } = read.place;

  const pick = (id: string) => {
    const chosen = AUDIENCES.find((one) => one.id === id)?.id;

    if (chosen === undefined || chosen === audience) return;
    read.move({ audience: chosen });
    const listed = chosen === SETUP_AUDIENCE.TEAM ? team : personal;

    if (team !== undefined && listed !== undefined) choose(listed);
  };

  return (
    <StepFrame
      read={read}
      at={at}
      title={WORDS.WELCOME}
      press={{ label: WORDS.CONTINUE, onPress: forward }}
    >
      <ListSection title={WORDS.AUDIENCE}>
        <PickRows options={AUDIENCES} picked={audience} onPick={pick} />
      </ListSection>
    </StepFrame>
  );
}

/** One question: its answers to pick any that apply from, and a line for the person's own words under Other once picked. */
function SurveyQuestion<Value extends string>({
  title,
  options,
  picked,
  other,
  onPick,
  onOther,
}: {
  readonly title: string;
  readonly options: readonly SurveyOption<Value>[];
  readonly picked: readonly Value[];
  readonly other: string | undefined;
  readonly onPick: (picked: readonly Value[]) => void;
  readonly onOther: (words: string) => void;
}) {
  const toggle = (id: string) => {
    const value = options.find((option) => option.value === id)?.value;

    if (value === undefined) return;
    onPick(picked.includes(value) ? picked.filter((one) => one !== value) : [...picked, value]);
  };

  return (
    <ListSection title={title}>
      <PickRows
        options={options.map((option) => ({ id: option.value, label: option.label }))}
        picked={picked}
        onPick={toggle}
      />
      {picked.some((one) => one === SURVEY_OTHER) ? (
        <WordsField
          look={WORDS_LOOK.LINE}
          placeholder={WORDS.OTHER}
          label={`${title} Other`}
          initialWords={other}
          maxLength={SURVEY_OTHER_MAX_CHARS}
          onWords={onOther}
        />
      ) : null}
    </ListSection>
  );
}

/** The survey's three questions, Skip until one is answered and Continue after, each keeping the answers as the panel's step does. */
function SurveyStep({ read, at, forward }: StepProps) {
  const { answers, answered, answer, keep } = useSurvey();

  // Skipping after taking every pick back keeps that, so the account's earlier answers do not come back.
  const onward = () => {
    keep();
    forward();
  };

  return (
    <StepFrame
      read={read}
      at={at}
      title={WORDS.SURVEY}
      press={{ label: answered ? WORDS.CONTINUE : WORDS.SKIP, onPress: onward, skip: !answered }}
    >
      <SurveyQuestion
        title={SURVEY_QUESTION.REFERRAL}
        options={SURVEY_OPTIONS.REFERRAL}
        picked={answers.referral ?? []}
        other={answers.referralOther}
        onPick={(picked) =>
          answer({ referral: surveyInOfferedOrder(SURVEY_OPTIONS.REFERRAL, picked) })
        }
        onOther={(referralOther) => answer({ referralOther })}
      />
      <SurveyQuestion
        title={SURVEY_QUESTION.ROLE}
        options={SURVEY_OPTIONS.ROLE}
        picked={answers.role ?? []}
        other={answers.roleOther}
        onPick={(picked) => answer({ role: surveyInOfferedOrder(SURVEY_OPTIONS.ROLE, picked) })}
        onOther={(roleOther) => answer({ roleOther })}
      />
      <SurveyQuestion
        title={SURVEY_QUESTION.INTENT}
        options={SURVEY_OPTIONS.INTENT}
        picked={answers.intent ?? []}
        other={answers.intentOther}
        onPick={(picked) => answer({ intent: surveyInOfferedOrder(SURVEY_OPTIONS.INTENT, picked) })}
        onOther={(intentOther) => answer({ intentOther })}
      />
    </StepFrame>
  );
}

/**
 * The team's workspace, named and made by Create, which keeps it on the
 * place, so a reload or another device never makes it again, moves the phone
 * to it, and goes on; once made, the step coming back shows it and goes on.
 * Its teammates are invited from Workspace settings, as New workspace leaves
 * them. A refusal says why under the name and keeps the step.
 */
function TeamStep({ read, at, forward }: StepProps) {
  const acts = useHostActs();
  const write = useWrite();
  const { workspaces, choose } = useSetupWorkspace(read);
  const [name, setName] = useState("");
  const create = useAsyncAction(() => ACT_UNREACHED_WORDS);
  const { team } = read.place;

  const make = () => {
    void create.run(() => {
      const said: Said = {};

      return write(
        () =>
          acts[ACT_KIND.WORKSPACE_CREATE]({ name: name.trim() }).then((workspace) => {
            read.move({ team: workspace.id });
            choose(workspace.id);
            forward();
          }),
        {
          inPlace: (words) => {
            said.words = words;
          },
        },
      ).then(() => said.words);
    });
  };

  if (team !== undefined) {
    const made = workspaces.find((workspace) => workspace.id === team)?.name ?? name.trim();

    return (
      <StepFrame
        read={read}
        at={at}
        title={WORDS.TEAM_MADE}
        press={{ label: WORDS.CONTINUE, onPress: forward }}
      >
        <ListSection>
          <ValueRow label={WORDS.WORKSPACE} value={made} />
        </ListSection>
      </StepFrame>
    );
  }

  return (
    <StepFrame
      read={read}
      at={at}
      title={WORDS.TEAM_NEW}
      press={{
        label: create.running ? WORDS.CREATING : WORDS.CREATE,
        onPress: make,
        disabled: name.trim() === "" || create.running,
      }}
    >
      <ListSection title={WORDS.WORKSPACE} footer={create.refusal} footerTone={FOOTER_TONE.FAILURE}>
        <WordsField
          look={WORDS_LOOK.LINE}
          placeholder={WORDS.TEAM_NAME}
          onWords={(words) => {
            setName(words);
            // A refusal speaks of the name it refused, so an edit lets it go.
            create.clear();
          }}
          testId={TEAM_NAME_FIELD_ID}
        />
      </ListSection>
    </StepFrame>
  );
}

/** Connect an agent, as Settings › Agents connects one, going on only once one can start an agent, since nothing runs without one. */
function AgentStep({ read, at, forward }: StepProps) {
  const removal = useAgentKeyRemoval();
  const connected = agentConnected(useAgentKeys().answer) === true;

  return (
    <>
      <StepFrame
        read={read}
        at={at}
        title={WORDS.AGENT}
        subtitle={WORDS.AGENT_PURPOSE}
        press={{
          label: at === read.steps.length - 1 ? WORDS.FINISH : WORDS.CONTINUE,
          onPress: forward,
          disabled: !connected,
        }}
      >
        <AgentKeySections onRemove={removal.remove} />
      </StepFrame>
      {removal.ask}
    </>
  );
}

/** Connect GitHub for the workspace setup works in, Skip until it reaches a repository and Continue after. */
function GitHubStep({ read, at, forward }: StepProps) {
  const { workspaceId } = useSetupWorkspace(read);
  const reached = useWorkspaceRepositories(workspaceId).listed.length > 0;

  return (
    <StepFrame
      read={read}
      at={at}
      title={WORDS.GITHUB}
      press={{ label: reached ? WORDS.CONTINUE : WORDS.SKIP, onPress: forward, skip: !reached }}
    >
      {workspaceId === undefined ? null : (
        <GitHubSection key={workspaceId} workspaceId={workspaceId} />
      )}
    </StepFrame>
  );
}

/**
 * The tools, which the phone connects from Settings › Integrations, and
 * Finish. Where the workspace reaches a repository, New task opens over the
 * app once it is let in, on that repository, as the panel's setup ends.
 */
function ToolsStep({ read, at, forward }: StepProps) {
  const { workspaceId } = useSetupWorkspace(read);
  const reached = useWorkspaceRepositories(workspaceId).listed.length > 0;

  const finish = () => {
    if (reached) askNewTaskAfterSetup();
    forward();
  };

  return (
    <StepFrame
      read={read}
      at={at}
      title={WORDS.TOOLS}
      press={{ label: WORDS.FINISH, onPress: finish }}
    >
      <ListSection footer={WORDS.TOOLS_PURPOSE}>{null}</ListSection>
    </StepFrame>
  );
}

/**
 * Finish: keeps on the account that setup is finished, so it stands once on
 * every device, and the app is let in as the write is drawn. Note that a
 * finish refused says why in the failure notice, with Try again, and leaves
 * setup standing; New task asked for is let go with it.
 */
function useFinishSetup(): () => void {
  const acts = useHostActs();
  const write = useWrite();

  return () =>
    void write(
      () =>
        acts[ACT_KIND.SETTING_UPDATE]({
          field: APP_SETTING_SCHEMA.setupFinished.field,
          value: true,
        }),
      { refused: actionRefused, retry: true },
    ).then((went) => {
      if (!went) letGoNewTaskAfterSetup();
    });
}

/** While what setup stands on is read: the system's spinner and what it reads. */
export function SetupWaitScreen() {
  return (
    <Screen ground={SCREEN_GROUND.GROUPED}>
      <EmptyState loading title={WORDS.READING} symbol={GLYPH.WAIT} />
    </Screen>
  );
}

/**
 * The screen of `step`, at its place among the steps setup's audience walks,
 * every client's alike. Continue keeps the next step's place and pushes its
 * screen; a step come back to, by the stack's Back or its own, keeps its
 * place, so setup resumes there on any device. A step the audience does not
 * walk, as a team's left for Just me on another device, goes back to where
 * setup stands.
 */
export function SetupStepScreen({ step }: { readonly step: SetupStep }) {
  const router = useRouter();
  const read = useSetupPlace();
  const finish = useFinishSetup();
  const at = read.steps.indexOf(step);

  // Note that the place is read as the step comes into focus, not as it was when the screen first drew, since a step under another stood while that one moved the place on.
  const keep = useEffectEvent(() => {
    if (at >= 0) read.keepAt(at);
  });

  useFocusEffect(useCallback(() => keep(), []));

  if (at < 0) return <Redirect href="/setup" />;

  const next = read.steps[at + 1];

  const forward = () => {
    if (next === undefined) return finish();
    read.move({ at: at + 1 });
    router.push({ pathname: SETUP_STEP_ROUTE, params: { step: next } });
  };

  const props = { read, at, forward };

  switch (step) {
    case SETUP_STEP.WELCOME:
      return <WelcomeStep {...props} />;
    case SETUP_STEP.SURVEY:
      return <SurveyStep {...props} />;
    case SETUP_STEP.TEAM:
      return <TeamStep {...props} />;
    case SETUP_STEP.AGENT:
      return <AgentStep {...props} />;
    case SETUP_STEP.GITHUB:
      return <GitHubStep {...props} />;
    case SETUP_STEP.TOOLS:
      return <ToolsStep {...props} />;
  }
}
