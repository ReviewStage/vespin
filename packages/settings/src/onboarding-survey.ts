/**
 * onboarding-survey.ts -- what a new account answered in setup's survey: how it heard of us, its role, and what it hopes we help with, and its own words beside any answered Other.
 *
 * The answers are the account's (`APP_SETTING_SCHEMA.onboardingSurvey`), so
 * each is kept with the account it came from whether or not the account
 * shares usage data, and setup on another machine finds them as they were
 * left. They are stored as their JSON, because a setting holds one plain
 * value. Each answer is one of the counted event's own sets
 * (`@repo/features/analytics`), bar the `skipped` a question left is counted
 * as; the words beside Other are kept here alone, never counted.
 */

import {
  PRODUCT_REFERRAL_SOURCE,
  PRODUCT_ROLE,
  PRODUCT_SIGNUP_INTENT,
  PRODUCT_SURVEY_ANSWER,
} from "@repo/features/analytics";
import type { UnparsedWireValue } from "@repo/wire";
import { Option, Schema } from "effect";

/** The most characters the words beside an answered Other hold. */
export const SURVEY_OTHER_MAX_CHARS = 100;

/** One of a set's values, bar the `skipped` the counted event says of a question left. */
function answeredOf<Value extends string>(values: Record<string, Value>) {
  return Schema.Literals(
    Object.values(values).filter(
      (value): value is Exclude<Value, typeof PRODUCT_SURVEY_ANSWER.SKIPPED> =>
        value !== PRODUCT_SURVEY_ANSWER.SKIPPED,
    ),
  );
}

const otherWords = Schema.String.check(Schema.isMaxLength(SURVEY_OTHER_MAX_CHARS));

/** What the account answered; a question left has no answer, and Other may carry words. */
const onboardingSurveySchema = Schema.Struct({
  referral: Schema.optionalKey(answeredOf(PRODUCT_REFERRAL_SOURCE)),
  referralOther: Schema.optionalKey(otherWords),
  role: Schema.optionalKey(answeredOf(PRODUCT_ROLE)),
  roleOther: Schema.optionalKey(otherWords),
  intent: Schema.optionalKey(answeredOf(PRODUCT_SIGNUP_INTENT)),
  intentOther: Schema.optionalKey(otherWords),
});

export type OnboardingSurvey = typeof onboardingSurveySchema.Type;

const onboardingSurveyJson = Schema.fromJsonString(onboardingSurveySchema);

const decodeSurvey = Schema.decodeUnknownOption(onboardingSurveyJson);

const encodeSurvey = Schema.encodeSync(onboardingSurveyJson);

/** The answers a stored value holds; nothing where it holds none. */
export function onboardingSurveyFrom(value: UnparsedWireValue): OnboardingSurvey | undefined {
  return Option.getOrUndefined(decodeSurvey(value));
}

/** Guards answers arriving from storage or the wire, as their JSON. */
export function isOnboardingSurveyJson(value: UnparsedWireValue): value is string {
  return onboardingSurveyFrom(value) !== undefined;
}

/** Answers as they are stored. */
export function onboardingSurveyStored(survey: OnboardingSurvey): string {
  return encodeSurvey(survey);
}
