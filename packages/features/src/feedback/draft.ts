/**
 * draft.ts -- a note being written to the people who make the app, as every client's form holds it: its words, screenshots, and whether it is signed, the words the form says it in, and exactly what a send of it carries.
 *
 * The panel's dialog (`@repo/panel`'s `feedback-dialog.tsx`) and the iOS
 * app's Send feedback page draw it each their own way, and read it here, so
 * the two say the same words and a note sends the same submission from
 * either: only what the form shows, the signature only while it is ticked.
 */

import { PRODUCT_NAME } from "../product-name.js";
import {
  FEEDBACK_KIND,
  FEEDBACK_LIMITS,
  type FeedbackImage,
  type FeedbackKind,
  type FeedbackSubmission,
} from "./submission.js";

/** What the form and its parts are called, whichever client draws it. */
export const FEEDBACK_WORDS = {
  TITLE: "Send feedback",
  SIGN: "Include my name and email",
  /** What the signature's line says while the note goes unsigned. */
  UNSIGNED: "Sent without your name or email",
  ATTACH: "Attach screenshots",
  SEND: "Send",
  SENDING: "Sending",
  /** What a send that did not go says where the service gave no reason of its own. */
  SEND_REFUSAL: "Could not send that. Try again.",
  UNREADABLE: "That file could not be attached.",
  FULL: `You can attach up to ${FEEDBACK_LIMITS.MAX_IMAGES} screenshots.`,
} as const;

/**
 * Each kind in its own words: the field's name, said to a screen reader
 * since the choice above it shows the kind, and the hint the empty field
 * shows. The wire still calls the second kind a prompt; to the person
 * writing it, it is a feature they would like the app to have.
 */
export const FEEDBACK_COPY = {
  [FEEDBACK_KIND.FEEDBACK]: {
    field: "Feedback",
    placeholder: "What happened, and what did you expect?",
  },
  [FEEDBACK_KIND.PROMPT]: {
    field: "Prompt",
    placeholder: `Write a prompt for what you would want built into ${PRODUCT_NAME}`,
  },
} as const;

/** The choice at the form's head, one option per kind, named as the person writing it would. */
export const FEEDBACK_KIND_CHOICES = [
  { value: FEEDBACK_KIND.FEEDBACK, label: "Feedback" },
  { value: FEEDBACK_KIND.PROMPT, label: "Prompt" },
] as const;

/** The note as it stands between openings: its words, its screenshots, and whether it is signed. */
export interface FeedbackDraft {
  readonly message: string;
  readonly images: readonly FeedbackImage[];
  readonly signed: boolean;
}

/** A note not yet written, signed until the person unticks it. */
export const FRESH_FEEDBACK_DRAFT: FeedbackDraft = { message: "", images: [], signed: true };

/** The credit a signed note carries: the signed-in account's own name and address. */
export interface FeedbackSignature {
  readonly name?: string;
  readonly email: string;
}

/** The credit a signed-in account signs a note with; none where no account is signed in. */
export function feedbackSignature(
  account: { readonly name?: string | null | undefined; readonly email: string } | undefined,
): FeedbackSignature | undefined {
  if (account === undefined) return undefined;

  return { ...(account.name ? { name: account.name } : undefined), email: account.email };
}

/** The line under "Include my name and email": who the note is signed by while it is ticked, or that it goes unsigned. */
export function signatureLine(signature: FeedbackSignature, signed: boolean): string {
  return signed
    ? [signature.name, signature.email].filter(Boolean).join(" · ")
    : FEEDBACK_WORDS.UNSIGNED;
}

/** Whether the note has words, without which it is never sent. */
export function draftHasWords(draft: FeedbackDraft): boolean {
  return draft.message.trim().length > 0;
}

/** What a send carries: the draft's words and screenshots, the experiment it is about where one is, and the signature only while it is ticked. */
export function draftSubmission(
  kind: FeedbackKind,
  draft: FeedbackDraft,
  signature: FeedbackSignature | undefined,
  about?: string | undefined,
): FeedbackSubmission {
  const credit = draft.signed ? signature : undefined;

  return {
    kind,
    message: draft.message.trim(),
    ...(credit?.name ? { name: credit.name } : undefined),
    ...(credit ? { email: credit.email } : undefined),
    images: draft.images,
    ...(about === undefined ? undefined : { experiment: about }),
  };
}
