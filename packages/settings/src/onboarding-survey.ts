/**
 * onboarding-survey.ts -- what a new account answered in setup's survey: how it heard of us, its role, and what it hopes we help with, and its own words beside any answered Other.
 *
 * Each question takes any answers that apply, kept as a list of one or
 * more, never an empty one. Note that answers kept before the questions
 * took several hold each question's one answer alone, as an older desktop
 * app still sends them, so a lone answer reads as a list of one and is
 * kept as one.
 *
 * The answers are the account's (`APP_SETTING_SCHEMA.onboardingSurvey`), so
 * each is kept with the account it came from, and setup on another machine
 * finds them as they were left. They are stored as their JSON, because a
 * setting holds one plain value. The questions and each answer's words are
 * here too, read by the survey setup draws and by the service, which records
 * each set of answers kept as a response to our onboarding survey in PostHog
 * (`packages/service/src/accounts/onboarding-survey-response.ts`).
 */

import { PRODUCT_NAME } from "@repo/features/product-name";
import type { UnparsedWireValue } from "@repo/wire";
import { Option, Schema, SchemaTransformation } from "effect";

/** The answer every question offers last, which takes the person's own words. */
export const SURVEY_OTHER = "other";

export const SURVEY_REFERRAL = {
  FRIEND_OR_COLLEAGUE: "friend_or_colleague",
  X: "x",
  LINKEDIN: "linkedin",
  HACKER_NEWS: "hacker_news",
  GITHUB: "github",
  SEARCH_ENGINE: "search_engine",
  OTHER: SURVEY_OTHER,
} as const;

export type SurveyReferral = (typeof SURVEY_REFERRAL)[keyof typeof SURVEY_REFERRAL];

export const SURVEY_ROLE = {
  ENGINEER: "engineer",
  ENGINEERING_MANAGER: "engineering_manager",
  FOUNDER: "founder",
  PRODUCT_MANAGER: "product_manager",
  OTHER: SURVEY_OTHER,
} as const;

export type SurveyRole = (typeof SURVEY_ROLE)[keyof typeof SURVEY_ROLE];

export const SURVEY_INTENT = {
  PARALLEL_AGENTS: "parallel_agents",
  AGENT_INBOX: "agent_inbox",
  CLOUD_AGENTS: "cloud_agents",
  TEAM_AGENTS: "team_agents",
  EXPLORING: "exploring",
  OTHER: SURVEY_OTHER,
} as const;

export type SurveyIntent = (typeof SURVEY_INTENT)[keyof typeof SURVEY_INTENT];

/** Each answer's words, in the order the survey offers them. */
export const SURVEY_REFERRAL_LABEL = {
  [SURVEY_REFERRAL.FRIEND_OR_COLLEAGUE]: "Friend or colleague",
  [SURVEY_REFERRAL.X]: "X (Twitter)",
  [SURVEY_REFERRAL.LINKEDIN]: "LinkedIn",
  [SURVEY_REFERRAL.HACKER_NEWS]: "Hacker News",
  [SURVEY_REFERRAL.GITHUB]: "GitHub",
  [SURVEY_REFERRAL.SEARCH_ENGINE]: "Search engine",
  [SURVEY_REFERRAL.OTHER]: "Other",
} as const satisfies Record<SurveyReferral, string>;

export const SURVEY_ROLE_LABEL = {
  [SURVEY_ROLE.ENGINEER]: "Software engineer",
  [SURVEY_ROLE.ENGINEERING_MANAGER]: "Engineering manager",
  [SURVEY_ROLE.FOUNDER]: "Founder",
  [SURVEY_ROLE.PRODUCT_MANAGER]: "Product manager",
  [SURVEY_ROLE.OTHER]: "Other",
} as const satisfies Record<SurveyRole, string>;

export const SURVEY_INTENT_LABEL = {
  [SURVEY_INTENT.PARALLEL_AGENTS]: "Running many agents at once",
  [SURVEY_INTENT.AGENT_INBOX]: "Inbox for agents",
  [SURVEY_INTENT.CLOUD_AGENTS]: "Cloud agents",
  [SURVEY_INTENT.TEAM_AGENTS]: "Working with my team's agents",
  [SURVEY_INTENT.EXPLORING]: "Just exploring",
  [SURVEY_INTENT.OTHER]: "Other",
} as const satisfies Record<SurveyIntent, string>;

/** The survey's questions, as setup asks them and our PostHog survey names them. */
export const SURVEY_QUESTION = {
  REFERRAL: `How did you hear about ${PRODUCT_NAME}?`,
  ROLE: "What's your role?",
  INTENT: `What do you hope ${PRODUCT_NAME} helps with?`,
} as const;

/** The most characters the words beside an answered Other hold. */
export const SURVEY_OTHER_MAX_CHARS = 100;

/** The words beside an Other: some, and no more than the most it holds. */
const otherWords = Schema.String.check(
  Schema.isMaxLength(SURVEY_OTHER_MAX_CHARS),
  Schema.makeFilter((words) => words.trim() !== ""),
);

/** Whether words stand only beside the Other they belong to; an Other may stand without them. */
function wordsBesideOther(
  answers: readonly string[] | undefined,
  words: string | undefined,
): boolean {
  return words === undefined || answers?.includes(SURVEY_OTHER) === true;
}

/**
 * A question's answers: one or more, none twice, or the lone answer kept
 * before the questions took several, read as a list of one. Note that a
 * list is tried first, so answers are always written back as a list.
 */
function answersOf<Value extends string>(values: readonly Value[]) {
  const answer = Schema.Literals(values);
  const answers = Schema.NonEmptyArray(answer).check(Schema.isUnique());

  const lone = answer.pipe(
    Schema.decodeTo(
      answers,
      SchemaTransformation.transform({
        decode: (one): typeof answers.Type => [one],
        encode: (all) => all[0],
      }),
    ),
  );

  return Schema.Union([answers, lone]);
}

/** What the account answered; a question left has no answer, and an Other may carry words. */
const onboardingSurveySchema = Schema.Struct({
  referral: Schema.optionalKey(answersOf(Object.values(SURVEY_REFERRAL))),
  referralOther: Schema.optionalKey(otherWords),
  role: Schema.optionalKey(answersOf(Object.values(SURVEY_ROLE))),
  roleOther: Schema.optionalKey(otherWords),
  intent: Schema.optionalKey(answersOf(Object.values(SURVEY_INTENT))),
  intentOther: Schema.optionalKey(otherWords),
}).check(
  Schema.makeFilter(
    (survey) =>
      wordsBesideOther(survey.referral, survey.referralOther) &&
      wordsBesideOther(survey.role, survey.roleOther) &&
      wordsBesideOther(survey.intent, survey.intentOther),
  ),
);

export type OnboardingSurvey = typeof onboardingSurveySchema.Type;

const onboardingSurveyJson = Schema.fromJsonString(onboardingSurveySchema);

const decodeSurvey = Schema.decodeUnknownOption(onboardingSurveyJson);

const encodeSurvey = Schema.encodeSync(onboardingSurveyJson);

/** Answers in the shape kept before the questions took several: some question holding its one answer alone. */
const olderSurveyJson = Schema.fromJsonString(
  Schema.Union([
    Schema.Struct({ referral: Schema.String }),
    Schema.Struct({ role: Schema.String }),
    Schema.Struct({ intent: Schema.String }),
  ]),
);

const decodeOlderSurvey = Schema.decodeUnknownOption(olderSurveyJson);

/** The answers a stored value holds; nothing where it holds none. */
export function onboardingSurveyFrom(value: UnparsedWireValue): OnboardingSurvey | undefined {
  return Option.getOrUndefined(decodeSurvey(value));
}

/** Guards answers arriving from storage or the wire, as their JSON. */
export function isOnboardingSurveyJson(value: UnparsedWireValue): value is string {
  return onboardingSurveyFrom(value) !== undefined;
}

/** Whether a value holds answers in the shape an older desktop app sends, a lone answer where answers are now a list. */
export function isOlderOnboardingSurveyJson(value: UnparsedWireValue): boolean {
  return Option.isSome(decodeOlderSurvey(value));
}

/** Whether any question is answered; answers all taken back are none. */
export function onboardingSurveyHasAnswer(survey: OnboardingSurvey): boolean {
  return survey.referral !== undefined || survey.role !== undefined || survey.intent !== undefined;
}

/** Answers as they are stored. */
export function onboardingSurveyStored(survey: OnboardingSurvey): string {
  return encodeSurvey(survey);
}
