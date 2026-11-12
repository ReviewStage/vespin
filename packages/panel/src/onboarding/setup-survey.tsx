import { ACT_KIND } from "@repo/host/acts";
import {
  APP_SETTING_SCHEMA,
  type OnboardingSurvey,
  onboardingSurveyFrom,
  onboardingSurveyStored,
  SURVEY_INTENT_LABEL,
  SURVEY_OTHER,
  SURVEY_OTHER_MAX_CHARS,
  SURVEY_QUESTION,
  SURVEY_REFERRAL_LABEL,
  SURVEY_ROLE_LABEL,
} from "@repo/settings";
import {
  CHOICE_LOOK,
  CHOICE_SELECT,
  ChoiceList,
  type ChoiceOption,
  type ChoiceSelect,
  FormField,
  GAP,
  Stack,
  TextField,
} from "@repo/ui";
import { ReplayMask } from "@repo/ui/session-replay-marks";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { actMutation } from "../act-mutations.js";
import { appStateQuery, selectAppSettingsView } from "../use-app-state.js";

/**
 * setup-survey.tsx -- setup's survey step: how a new account heard of us, its role, and what it hopes we help with, each a row of pills, one picked for the first two and any that apply for the last, and a line for its own words under any Other picked.
 *
 * Every question may be left, and the step skipped whole. As setup goes on
 * past the step, the answers are kept on the account
 * (`APP_SETTING_SCHEMA.onboardingSurvey`), so they stand with the account
 * they came from and setup on another machine finds them as they were left;
 * the service records each set it keeps as a response to our onboarding
 * survey in PostHog, which posts it to the team's Slack. A walk back and
 * forth keeps the answers again only where they changed, and a keep the
 * account refused is tried again on the next Continue. Note that, as setup's
 * other writes, nothing waits on the keep or says it failed: setup goes on
 * either way.
 */

/* Each question's answers, as the account keeps them. */
type Referral = NonNullable<OnboardingSurvey["referral"]>;

type Role = NonNullable<OnboardingSurvey["role"]>;

type Intent = NonNullable<OnboardingSurvey["intent"]>[number];

/** A question's options, in the order its words are declared. */
function optionsOf<Value extends string>(
  labels: Readonly<Record<Value, string>>,
): readonly ChoiceOption<Value>[] {
  // SAFETY: the keys are exactly the answers the words are declared for.
  return (Object.keys(labels) as Value[]).map((value) => ({ value, label: labels[value] }));
}

const REFERRALS = optionsOf<Referral>(SURVEY_REFERRAL_LABEL);
const ROLES = optionsOf<Role>(SURVEY_ROLE_LABEL);
const INTENTS = optionsOf<Intent>(SURVEY_INTENT_LABEL);

/** The answers as setup holds them before they are kept, where a question whose picks were all taken back holds none. */
type SurveyDraft = { readonly [Key in keyof OnboardingSurvey]?: OnboardingSurvey[Key] | undefined };

/** The survey as setup holds it across its steps. */
export interface Survey {
  readonly answers: SurveyDraft;
  /** Whether any question is answered, which turns the step's Skip into Continue. */
  readonly answered: boolean;
  readonly answer: (change: SurveyDraft) => void;
  /** Keeps the answers on the account, unless they stand there already. */
  readonly keep: () => void;
}

/** What it hopes we help with as picked, in the order the survey offers them, so the same picks made in another order are kept alike; none where every pick was taken back. */
function intentsPicked(picked: readonly Intent[]): OnboardingSurvey["intent"] {
  const [first, ...rest] = INTENTS.filter((option) => picked.includes(option.value)).map(
    (option) => option.value,
  );

  return first === undefined ? undefined : [first, ...rest];
}

/** The answers as they are kept: words only beside an Other picked, trimmed, and none where none were written. */
function kept(answers: SurveyDraft): OnboardingSurvey {
  const words = (otherPicked: boolean, other: string | undefined) => {
    const trimmed = other?.trim();

    return otherPicked && trimmed ? trimmed : undefined;
  };

  const referralOther = words(answers.referral === SURVEY_OTHER, answers.referralOther);
  const roleOther = words(answers.role === SURVEY_OTHER, answers.roleOther);
  const intentOther = words(answers.intent?.includes(SURVEY_OTHER) === true, answers.intentOther);

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

/** A question of one answer's pick, as a list of picks holds it. */
function picks<Value extends string>(picked: Value | undefined): readonly Value[] {
  return picked === undefined ? [] : [picked];
}

/** One question: its words over its pills, one picked or any that apply, and a line for the person's own words under Other once picked. */
function Question<Value extends string>({
  label,
  options,
  select = CHOICE_SELECT.ONE,
  value,
  other,
  onPick,
  onOther,
}: {
  label: string;
  options: readonly ChoiceOption<Value>[];
  select?: ChoiceSelect;
  value: readonly Value[];
  other: string | undefined;
  onPick: (picked: readonly Value[]) => void;
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
            select={select}
            value={value}
            look={CHOICE_LOOK.PILL}
            onChange={onPick}
          />
        )}
      </FormField>
      {value.some((picked) => picked === SURVEY_OTHER) ? (
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

  const [draft, setDraft] = useState<SurveyDraft>();
  const saving = useRef<OnboardingSurvey | undefined>(undefined);
  // Note that the account's answers stand until a pick here, so setup on another machine opens on them.
  const answers = draft ?? stored ?? {};

  const answered =
    answers.referral !== undefined || answers.role !== undefined || answers.intent !== undefined;

  const keep = () => {
    if (!answered) return;
    const keeping = kept(answers);

    if (sameAnswers(saving.current ?? stored, keeping)) return;
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
        label={SURVEY_QUESTION.REFERRAL}
        options={REFERRALS}
        value={picks(answers.referral)}
        other={answers.referralOther}
        onPick={([referral]) => answer({ referral })}
        onOther={(referralOther) => answer({ referralOther })}
      />
      <Question
        label={SURVEY_QUESTION.ROLE}
        options={ROLES}
        value={picks(answers.role)}
        other={answers.roleOther}
        onPick={([role]) => answer({ role })}
        onOther={(roleOther) => answer({ roleOther })}
      />
      <Question
        label={SURVEY_QUESTION.INTENT}
        options={INTENTS}
        select={CHOICE_SELECT.MANY}
        value={answers.intent ?? []}
        other={answers.intentOther}
        onPick={(intents) => answer({ intent: intentsPicked(intents) })}
        onOther={(intentOther) => answer({ intentOther })}
      />
    </Stack>
  );
}
