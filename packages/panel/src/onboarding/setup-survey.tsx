import { ACT_KIND } from "@repo/host/acts";
import {
  APP_SETTING_SCHEMA,
  type OnboardingSurvey,
  onboardingSurveyFrom,
  onboardingSurveyStored,
  SURVEY_OPTIONS,
  SURVEY_OTHER,
  SURVEY_OTHER_MAX_CHARS,
  SURVEY_QUESTION,
  type SurveyDraft,
  type SurveyIntent,
  type SurveyReferral,
  type SurveyRole,
  sameSurveyAnswers,
  surveyDraftAnswered,
  surveyInOfferedOrder,
  surveyKept,
} from "@repo/settings";
import {
  CHOICE_LOOK,
  CHOICE_SELECT,
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
import { appStateQuery, selectAppSettingsView } from "../use-app-state.js";

/**
 * setup-survey.tsx -- setup's survey step: how a new account heard of us, its role, and what it hopes we help with, each a row of pills to pick any that apply from, and a line for its own words under any Other picked.
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

/** Each question's options, as `@repo/ui`'s choices. */
const REFERRALS: readonly ChoiceOption<SurveyReferral>[] = SURVEY_OPTIONS.REFERRAL;
const ROLES: readonly ChoiceOption<SurveyRole>[] = SURVEY_OPTIONS.ROLE;
const INTENTS: readonly ChoiceOption<SurveyIntent>[] = SURVEY_OPTIONS.INTENT;

/** The survey as setup holds it across its steps. */
export interface Survey {
  readonly answers: SurveyDraft;
  /** Whether any question is answered, which turns the step's Skip into Continue. */
  readonly answered: boolean;
  readonly answer: (change: SurveyDraft) => void;
  /** Keeps the answers on the account, none among them where every pick was taken back, unless they stand there already. */
  readonly keep: () => void;
}

/** One question: its words over its pills to pick any that apply from, and a line for the person's own words under Other once picked. */
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
            select={CHOICE_SELECT.MANY}
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

  const answered = surveyDraftAnswered(answers);

  // Note that answers all taken back are kept too, as none, so the account's earlier answers do not come back; a survey never answered keeps nothing.
  const keep = () => {
    if (!answered && (saving.current ?? stored) === undefined) return;
    const keeping = surveyKept(answers);

    if (sameSurveyAnswers(saving.current ?? stored, keeping)) return;
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
        value={answers.referral ?? []}
        other={answers.referralOther}
        onPick={(picked) => answer({ referral: surveyInOfferedOrder(REFERRALS, picked) })}
        onOther={(referralOther) => answer({ referralOther })}
      />
      <Question
        label={SURVEY_QUESTION.ROLE}
        options={ROLES}
        value={answers.role ?? []}
        other={answers.roleOther}
        onPick={(picked) => answer({ role: surveyInOfferedOrder(ROLES, picked) })}
        onOther={(roleOther) => answer({ roleOther })}
      />
      <Question
        label={SURVEY_QUESTION.INTENT}
        options={INTENTS}
        value={answers.intent ?? []}
        other={answers.intentOther}
        onPick={(picked) => answer({ intent: surveyInOfferedOrder(INTENTS, picked) })}
        onOther={(intentOther) => answer({ intentOther })}
      />
    </Stack>
  );
}
