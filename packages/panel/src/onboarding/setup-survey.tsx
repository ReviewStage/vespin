import {
  PRODUCT_REFERRAL_SOURCE,
  PRODUCT_ROLE,
  PRODUCT_SIGNUP_INTENT,
  PRODUCT_SURFACE_EVENT,
  PRODUCT_SURVEY_ANSWER,
} from "@repo/features/analytics";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { ACT_KIND } from "@repo/host/acts";
import {
  APP_SETTING_SCHEMA,
  type OnboardingSurvey,
  onboardingSurveyFrom,
  onboardingSurveyStored,
  SURVEY_OTHER_MAX_CHARS,
} from "@repo/settings";
import {
  CHOICE_LOOK,
  ChoiceList,
  type ChoiceOption,
  FormField,
  GAP,
  Stack,
  TextField,
} from "@repo/ui";
import { ReplayMask } from "@repo/ui/session-replay-marks";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { actMutation } from "../act-mutations.js";
import { appPlatform } from "../app-platform.js";
import { appStateQuery, selectAppSettingsView } from "../use-app-state.js";

/**
 * setup-survey.tsx -- setup's survey step: how a new account heard of us, its role, and what it hopes we help with, each a row of pills to pick one from, and a line for its own words under any Other picked.
 *
 * Every question may be left, and the step skipped whole. As setup goes on
 * past the step, the answers are kept on the account
 * (`APP_SETTING_SCHEMA.onboardingSurvey`), so they stand with the account
 * they came from and setup on another machine finds them as they were left,
 * and counted, as one `onboarding:survey` event, where the account shares
 * usage data. The words beside an Other are kept on the account alone: the
 * count says only `other`, since a counted value is one of a fixed set. A
 * walk back and forth keeps and counts the answers again only where they
 * changed, and a keep the account refused is tried again on the next
 * Continue without counting the same answers twice. Note that, as setup's
 * other writes, nothing waits on the keep or says it failed: setup goes on
 * either way.
 */

/* Each question's answers, as the account keeps them. */
type Referral = NonNullable<OnboardingSurvey["referral"]>;
type Role = NonNullable<OnboardingSurvey["role"]>;
type Intent = NonNullable<OnboardingSurvey["intent"]>;

const REFERRALS: readonly ChoiceOption<Referral>[] = [
  { value: PRODUCT_REFERRAL_SOURCE.FRIEND_OR_COLLEAGUE, label: "Friend or colleague" },
  { value: PRODUCT_REFERRAL_SOURCE.X, label: "X (Twitter)" },
  { value: PRODUCT_REFERRAL_SOURCE.LINKEDIN, label: "LinkedIn" },
  { value: PRODUCT_REFERRAL_SOURCE.HACKER_NEWS, label: "Hacker News" },
  { value: PRODUCT_REFERRAL_SOURCE.YOUTUBE, label: "YouTube" },
  { value: PRODUCT_REFERRAL_SOURCE.GITHUB, label: "GitHub" },
  { value: PRODUCT_REFERRAL_SOURCE.SEARCH_ENGINE, label: "Search engine" },
  { value: PRODUCT_REFERRAL_SOURCE.OTHER, label: "Other" },
];

const ROLES: readonly ChoiceOption<Role>[] = [
  { value: PRODUCT_ROLE.ENGINEER, label: "Software engineer" },
  { value: PRODUCT_ROLE.ENGINEERING_MANAGER, label: "Engineering manager" },
  { value: PRODUCT_ROLE.FOUNDER, label: "Founder or CTO" },
  { value: PRODUCT_ROLE.PRODUCT_MANAGER, label: "Product manager" },
  { value: PRODUCT_ROLE.OTHER, label: "Other" },
];

const INTENTS: readonly ChoiceOption<Intent>[] = [
  { value: PRODUCT_SIGNUP_INTENT.PARALLEL_AGENTS, label: "Running many agents at once" },
  { value: PRODUCT_SIGNUP_INTENT.AGENT_INBOX, label: "Inbox for agents" },
  { value: PRODUCT_SIGNUP_INTENT.CLOUD_AGENTS, label: "Cloud agents" },
  { value: PRODUCT_SIGNUP_INTENT.TEAM_AGENTS, label: "Working with my team's agents" },
  { value: PRODUCT_SIGNUP_INTENT.EXPLORING, label: "Just exploring" },
  { value: PRODUCT_SIGNUP_INTENT.OTHER, label: "Other" },
];

/** The survey as setup holds it across its steps. */
export interface Survey {
  readonly answers: OnboardingSurvey;
  /** Whether any question is answered, which turns the step's Skip into Continue. */
  readonly answered: boolean;
  readonly answer: (change: OnboardingSurvey) => void;
  /** Keeps the answers on the account unless they stand there, and counts them unless they were counted. */
  readonly keep: () => void;
}

/** The answers as they are kept: words only beside an Other picked, trimmed, and none where none were written. */
function kept(answers: OnboardingSurvey): OnboardingSurvey {
  const words = (picked: string | undefined, other: string | undefined) => {
    const trimmed = other?.trim();
    return picked === PRODUCT_SURVEY_ANSWER.OTHER && trimmed ? trimmed : undefined;
  };
  const referralOther = words(answers.referral, answers.referralOther);
  const roleOther = words(answers.role, answers.roleOther);
  const intentOther = words(answers.intent, answers.intentOther);
  return {
    ...(answers.referral === undefined ? undefined : { referral: answers.referral }),
    ...(referralOther === undefined ? undefined : { referralOther }),
    ...(answers.role === undefined ? undefined : { role: answers.role }),
    ...(roleOther === undefined ? undefined : { roleOther }),
    ...(answers.intent === undefined ? undefined : { intent: answers.intent }),
    ...(intentOther === undefined ? undefined : { intentOther }),
  };
}

/** Whether two sets of answers answer every question alike, in the same words. */
function sameAnswers(one: OnboardingSurvey | undefined, other: OnboardingSurvey): boolean {
  return one !== undefined && onboardingSurveyStored(one) === onboardingSurveyStored(other);
}

/** One question: its words over its pills, and a line for the person's own words under Other once picked. */
function Question<Value extends string>({
  label,
  options,
  value,
  other,
  onPick,
  onOther,
}: {
  label: string;
  options: readonly ChoiceOption<Value>[];
  value: Value | undefined;
  other: string | undefined;
  onPick: (picked: Value) => void;
  onOther: (words: string) => void;
}): React.JSX.Element {
  return (
    <Stack gap={GAP.TIGHT}>
      <FormField label={label}>
        {(control) => (
          <ChoiceList
            legend={label}
            describedBy={control["aria-describedby"]}
            options={options}
            value={value === undefined ? [] : [value]}
            look={CHOICE_LOOK.PILL}
            onChange={([picked]) => {
              if (picked !== undefined) onPick(picked);
            }}
          />
        )}
      </FormField>
      {value === PRODUCT_SURVEY_ANSWER.OTHER ? (
        <ReplayMask>
          <TextField
            label={`${label} Other`}
            value={other ?? ""}
            placeholder="Tell us more"
            maxLength={SURVEY_OTHER_MAX_CHARS}
            autoFocus
            onChange={onOther}
          />
        </ReplayMask>
      ) : null}
    </Stack>
  );
}

/** The survey's answers, held by setup so Back finds them as they were left, and the account's once kept. */
export function useSurvey(): Survey {
  const { mutate: updateSetting } = useMutation(actMutation(ACT_KIND.SETTING_UPDATE));
  const stored = onboardingSurveyFrom(
    useQuery({ ...appStateQuery, select: selectAppSettingsView }).data?.onboardingSurvey,
  );
  const [draft, setDraft] = useState<OnboardingSurvey>();
  const saving = useRef<OnboardingSurvey | undefined>(undefined);
  const counted = useRef<OnboardingSurvey | undefined>(undefined);
  // Note that the account's answers stand until a pick here, so setup on another machine opens on them.
  const answers = draft ?? stored ?? {};
  const answered =
    answers.referral !== undefined || answers.role !== undefined || answers.intent !== undefined;
  const keep = () => {
    const keeping = kept(answers);
    if (!answered) return;
    if (!sameAnswers(saving.current ?? stored, keeping)) {
      saving.current = keeping;
      updateSetting(
        {
          field: APP_SETTING_SCHEMA.onboardingSurvey.field,
          value: onboardingSurveyStored(keeping),
        },
        {
          // A keep refused leaves the answers to be kept again on the next Continue.
          onError: () => {
            if (saving.current === keeping) saving.current = undefined;
          },
        },
      );
    }
    if (sameAnswers(counted.current ?? stored, keeping)) return;
    counted.current = keeping;
    appPlatform().recordSurfaceEvent(PRODUCT_SURFACE_EVENT.ONBOARDING_SURVEY, {
      referral_source: keeping.referral ?? PRODUCT_REFERRAL_SOURCE.SKIPPED,
      role: keeping.role ?? PRODUCT_ROLE.SKIPPED,
      signup_intent: keeping.intent ?? PRODUCT_SIGNUP_INTENT.SKIPPED,
    });
  };
  return {
    answers,
    answered,
    answer: (change) => setDraft({ ...answers, ...change }),
    keep,
  };
}

/** The survey's three questions. */
export function SurveyQuestions({ survey }: { survey: Survey }): React.JSX.Element {
  const { answers, answer } = survey;
  return (
    <Stack gap={GAP.FIELD}>
      <Question
        label={`How did you hear about ${PRODUCT_NAME}?`}
        options={REFERRALS}
        value={answers.referral}
        other={answers.referralOther}
        onPick={(referral) => answer({ referral })}
        onOther={(referralOther) => answer({ referralOther })}
      />
      <Question
        label="What's your role?"
        options={ROLES}
        value={answers.role}
        other={answers.roleOther}
        onPick={(role) => answer({ role })}
        onOther={(roleOther) => answer({ roleOther })}
      />
      <Question
        label={`What do you hope ${PRODUCT_NAME} helps with?`}
        options={INTENTS}
        value={answers.intent}
        other={answers.intentOther}
        onPick={(intent) => answer({ intent })}
        onOther={(intentOther) => answer({ intentOther })}
      />
    </Stack>
  );
}
