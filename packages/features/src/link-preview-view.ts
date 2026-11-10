import { Schema as EffectSchema } from "effect";
import { failureFactsSchema } from "./failure-facts.js";
import { HOSTED_CALL_FAILURE } from "./hosted-failure.js";
import { linkPreviewAnswerSchema, linkPreviewUrlSchema } from "./link-preview-wire.js";

/**
 * link-preview-view.ts -- a web page's preview as the window asks the host for it, and as the host answers: the service's own answer, or unanswered with why.
 */

/** The page whose preview the window asks for, by its address. */
export const linkPreviewParamsSchema = EffectSchema.Struct({
  url: linkPreviewUrlSchema,
});

/** A preview as the window hears it: the service's answer, or no answer, with the facts of what failed beneath it where the host caught them. */
export const linkPreviewViewSchema = EffectSchema.Union([
  ...linkPreviewAnswerSchema.members,
  EffectSchema.Struct({
    failure: EffectSchema.Literal(HOSTED_CALL_FAILURE.UNANSWERED),
    cause: EffectSchema.optionalKey(failureFactsSchema),
  }),
]);

export type LinkPreviewView = typeof linkPreviewViewSchema.Type;

/** What the window hears where the host asked nothing. */
export const LINK_PREVIEW_UNANSWERED: LinkPreviewView = {
  failure: HOSTED_CALL_FAILURE.UNANSWERED,
};
