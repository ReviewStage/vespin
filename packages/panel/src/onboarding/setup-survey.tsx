import {
  PRODUCT_REFERRAL_SOURCE,
  PRODUCT_ROLE,
  PRODUCT_SIGNUP_INTENT,
  PRODUCT_SURFACE_EVENT,
  type ProductReferralSource,
  type ProductRole,
  type ProductSignupIntent,
} from "@repo/features/analytics";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { CHOICE_LOOK, ChoiceList, type ChoiceOption, FormField, GAP, Stack } from "@repo/ui";
import { useRef, useState } from "react";
import { appPlatform } from "../app-platform.js";

/**
 * setup-survey.tsx -- setup's survey step: how a new account heard of us, its role, and what it hopes we help with, each a row of pills to pick one from.
 *
 * Every question may be left, and the step skipped whole. The answers are
 * counted, as one `onboarding:survey` event, where the account shares usage
 * data, never kept on the account: each answer is one of a fixed set, and
 * "Other" takes no words, so nothing typed has a shape it could travel in.
 * They are counted as setup goes on past the step, and again only where
 * Back led to them changed, so a walk back and forth counts one answer.
 */

/* Each question's answers, bar the `skipped` it is counted as while unanswered. */
type Referral = Exclude<ProductReferralSource, typeof PRODUCT_REFERRAL_SOURCE.SKIPPED>;
type Role = Exclude<ProductRole, typeof PRODUCT_ROLE.SKIPPED>;
type Intent = Exclude<ProductSignupIntent, typeof PRODUCT_SIGNUP_INTENT.SKIPPED>;

const REFERRALS: readonly ChoiceOption<Referral>[] = [
  { value: PRODUCT_REFERRAL_SOURCE.HACKER_NEWS, label: "Hacker News" },
  { value: PRODUCT_REFERRAL_SOURCE.X, label: "X" },
  { value: PRODUCT_REFERRAL_SOURCE.GITHUB, label: "GitHub" },
  { value: PRODUCT_REFERRAL_SOURCE.WORD_OF_MOUTH, label: "A colleague or friend" },
  { value: PRODUCT_REFERRAL_SOURCE.SEARCH, label: "Search" },
  { value: PRODUCT_REFERRAL_SOURCE.ARTICLE, label: "An article or post" },
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
  { value: PRODUCT_SIGNUP_INTENT.CLOUD_AGENTS, label: "Running agents in the cloud" },
  { value: PRODUCT_SIGNUP_INTENT.TEAM_AGENTS, label: "Working with my team's agents" },
  { value: PRODUCT_SIGNUP_INTENT.REVIEW_AGENT_WORK, label: "Reviewing what agents write" },
  { value: PRODUCT_SIGNUP_INTENT.EXPLORING, label: "Just exploring" },
  { value: PRODUCT_SIGNUP_INTENT.OTHER, label: "Other" },
];

/** What the survey's questions were answered with so far; a question left has none. */
interface SurveyAnswers {
  readonly referral?: Referral | undefined;
  readonly role?: Role | undefined;
  readonly intent?: Intent | undefined;
}

/** The survey as setup holds it across its steps. */
export interface Survey {
  readonly answers: SurveyAnswers;
  /** Whether any question is answered, which turns the step's Skip into Continue. */
  readonly answered: boolean;
  readonly answer: (change: SurveyAnswers) => void;
  /** Counts the answers, unless they are the ones last counted. */
  readonly count: () => void;
}

/** Whether two sets of answers answer every question alike. */
function sameAnswers(one: SurveyAnswers | undefined, other: SurveyAnswers): boolean {
  return (
    one !== undefined &&
    one.referral === other.referral &&
    one.role === other.role &&
    one.intent === other.intent
  );
}

/** One question: its words over its pills. */
function Question<Value extends string>({
  label,
  options,
  value,
  onPick,
}: {
  label: string;
  options: readonly ChoiceOption<Value>[];
  value: Value | undefined;
  onPick: (picked: Value) => void;
}): React.JSX.Element {
  return (
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
  );
}

/** The survey's answers, held by setup so Back finds them as they were left. */
export function useSurvey(): Survey {
  const [answers, setAnswers] = useState<SurveyAnswers>({});
  const counted = useRef<SurveyAnswers | undefined>(undefined);
  const answered =
    answers.referral !== undefined || answers.role !== undefined || answers.intent !== undefined;
  const count = () => {
    if (!answered || sameAnswers(counted.current, answers)) return;
    counted.current = answers;
    appPlatform().recordSurfaceEvent(PRODUCT_SURFACE_EVENT.ONBOARDING_SURVEY, {
      referral_source: answers.referral ?? PRODUCT_REFERRAL_SOURCE.SKIPPED,
      role: answers.role ?? PRODUCT_ROLE.SKIPPED,
      signup_intent: answers.intent ?? PRODUCT_SIGNUP_INTENT.SKIPPED,
    });
  };
  return {
    answers,
    answered,
    answer: (change) => setAnswers((held) => ({ ...held, ...change })),
    count,
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
        onPick={(referral) => answer({ referral })}
      />
      <Question
        label="What's your role?"
        options={ROLES}
        value={answers.role}
        onPick={(role) => answer({ role })}
      />
      <Question
        label={`What do you hope ${PRODUCT_NAME} helps with?`}
        options={INTENTS}
        value={answers.intent}
        onPick={(intent) => answer({ intent })}
      />
    </Stack>
  );
}
