/**
 * failure-copy.tsx -- a failure's Copy details: says the failure was shown as it first stands, which reports it, and offers the details that answers through the window's one Copy, its glyph alone, named "Copy details", after Investigate where the app offers it.
 *
 * Every component that says a failure of the app's in place draws this
 * beside its words, so a person can send what failed with a report of the
 * problem, as a failure toast offers it. It is the copy glyph alone, after the
 * failure's own presses, so the words keep their room; it answers on
 * itself, as every copy button does, and leaves the failure standing.
 *
 * It says the failure was shown as it is drawn for a failure, and hidden as
 * it goes, never on every render: the failure's `shown` answers the same
 * details for as long as the app holds it to be the same failure, and
 * reports only the first time, which is the app's to keep
 * (`../../reported-failure.ts`). A failure the app answers no details for
 * offers nothing: a refusal, whose words already say what happened, and one
 * whose details could not be read, as where the app has nothing to report
 * through and no clipboard to copy to, rather than a copy that could only fail. Words that
 * are no failure of the app's (`UNREPORTED`) offer nothing to copy, and draw
 * nothing.
 *
 * Where the app offers Investigate on a failure it answered details for
 * (`ReportedFailure`'s `investigation`), asked as it is said shown, its
 * glyph stands before Copy details (`InvestigateButton`).
 */

import { useLayoutEffect, useState } from "react";
import {
  type FailureInvestigate,
  isReported,
  type ReportedFailure,
  type Unreported,
} from "../../reported-failure.js";
import type { ButtonSize } from "../button/button.js";
import { CopyButton } from "../copy-button/copy-button.js";
import { InvestigateButton } from "../investigate-button/investigate-button.js";

/** What Copy details copies, as "Copy details" names it. */
const DETAILS_WHAT = "details";

/** What a failure standing on screen offers: its details to copy, and Investigate where the app offers it. */
interface FailureOffers {
  readonly details: string | undefined;
  readonly investigate: FailureInvestigate | undefined;
}

/** What a failure offers before it is said shown. */
const NO_OFFERS: FailureOffers = { details: undefined, investigate: undefined };

/**
 * What `failure` offers as it stands on screen, said shown once it stands
 * and anew only for another failure: its details, and Investigate where the
 * app offers it for a failure it answered details for; nothing until read.
 */
function useFailureOffers(failure: ReportedFailure | undefined): FailureOffers {
  const [read, setRead] = useState<{
    readonly of: ReportedFailure;
    readonly offers: FailureOffers;
  }>();
  // Note that it is said shown before the first paint, so a glyph that will stand is drawn at once and none flashes in.
  useLayoutEffect(() => {
    if (failure === undefined) return undefined;
    const details = failure.shown();
    const investigate = details === undefined ? undefined : failure.investigation?.();
    setRead({ of: failure, offers: { details, investigate } });
    return () => failure.hidden();
  }, [failure]);
  return read !== undefined && read.of === failure ? read.offers : NO_OFFERS;
}

/**
 * The details of `failure` as it stands on screen, said shown once it
 * stands and anew only for another failure, or nothing until they are read.
 */
export function useFailureDetails(failure: ReportedFailure | undefined): string | undefined {
  return useFailureOffers(failure).details;
}

/** Copy details for `failure`, after Investigate where the app offers it, where it is a failure of the app's; nothing for words that are none. */
export function FailureCopy({
  failure,
  size,
}: {
  failure: ReportedFailure | Unreported | undefined;
  size?: ButtonSize | undefined;
}): React.JSX.Element | null {
  const reported = isReported(failure) ? failure : undefined;
  const { details, investigate } = useFailureOffers(reported);
  if (reported === undefined || details === undefined) return null;
  const sized = size === undefined ? {} : { size };
  return (
    <>
      {investigate === undefined ? null : <InvestigateButton onPress={investigate} {...sized} />}
      <CopyButton text={details} what={DETAILS_WHAT} copy={reported.copy} {...sized} />
    </>
  );
}
