/**
 * onboarding-survey-response.ts -- records the answers a new account kept from setup's survey as a response to our onboarding survey in PostHog, which posts it to the team's Slack.
 *
 * The survey is an API survey in PostHog, shown to no one: setup asks its
 * questions, the account keeps its answers (`@repo/settings`'s
 * `OnboardingSurvey`), and each set the service saves is recorded here under
 * the account's person, each answer in its own words and an Other in the
 * person's words where they wrote some. A PostHog destination posts each
 * production response to #signups. Setup
 * keeps a set only where it changed, so a walk back and forth posts once.
 */

import {
  type OnboardingSurvey,
  SURVEY_INTENT_LABEL,
  SURVEY_OTHER,
  SURVEY_QUESTION,
  SURVEY_REFERRAL_LABEL,
  SURVEY_ROLE_LABEL,
} from "@repo/settings";
import type { Effect } from "effect";
import { recordSurveyResponse, type SurveyAnswer } from "../events/server-events.js";

/**
 * Our onboarding survey in PostHog: its id, its name, and each question's id
 * and the property PostHog keys its answer by. The questions' words are
 * setup's own (`SURVEY_QUESTION`), which the survey in PostHog repeats.
 */
const ONBOARDING_SURVEY = {
  ID: "01a1bc2c-e85a-0000-cff1-9061c31dd971",
  NAME: "Onboarding",
  REFERRAL: {
    ID: "e1bfce32-292a-4a8c-a63c-751003d06501",
    RESPONSE_KEY: "$survey_response_e1bfce32-292a-4a8c-a63c-751003d06501",
  },
  ROLE: {
    ID: "977afcf0-6d7b-4b69-a758-3e8487161ea1",
    RESPONSE_KEY: "$survey_response_977afcf0-6d7b-4b69-a758-3e8487161ea1",
  },
  INTENT: {
    ID: "b5f283ca-a870-4fc9-ae2a-a0b673b4fda0",
    RESPONSE_KEY: "$survey_response_b5f283ca-a870-4fc9-ae2a-a0b673b4fda0",
  },
} as const;

/** What a question was answered, in the words the survey offers it, or the person's own beside an Other. */
function responseOf<Value extends string>(
  labels: Readonly<Record<Value, string>>,
  answer: Value | undefined,
  other: string | undefined,
): string | undefined {
  if (answer === undefined) return undefined;

  return answer === SURVEY_OTHER && other !== undefined ? other : labels[answer];
}

/** Records the account's kept answers as one response to the onboarding survey, once the request has answered. */
export function onboardingSurveyAnswered(
  userId: string,
  survey: OnboardingSurvey,
): Effect.Effect<void> {
  const answers: readonly SurveyAnswer[] = [
    {
      id: ONBOARDING_SURVEY.REFERRAL.ID,
      responseKey: ONBOARDING_SURVEY.REFERRAL.RESPONSE_KEY,
      question: SURVEY_QUESTION.REFERRAL,
      response: responseOf(SURVEY_REFERRAL_LABEL, survey.referral, survey.referralOther),
    },
    {
      id: ONBOARDING_SURVEY.ROLE.ID,
      responseKey: ONBOARDING_SURVEY.ROLE.RESPONSE_KEY,
      question: SURVEY_QUESTION.ROLE,
      response: responseOf(SURVEY_ROLE_LABEL, survey.role, survey.roleOther),
    },
    {
      id: ONBOARDING_SURVEY.INTENT.ID,
      responseKey: ONBOARDING_SURVEY.INTENT.RESPONSE_KEY,
      question: SURVEY_QUESTION.INTENT,
      response: responseOf(SURVEY_INTENT_LABEL, survey.intent, survey.intentOther),
    },
  ];

  return recordSurveyResponse({
    userId,
    surveyId: ONBOARDING_SURVEY.ID,
    surveyName: ONBOARDING_SURVEY.NAME,
    answers,
  });
}
